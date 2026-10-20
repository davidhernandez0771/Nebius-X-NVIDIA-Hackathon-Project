"""SANT's pick-place as an Isaac Lab Mimic env, SANT-PickPlace-Franka-IK-Abs-Mimic-v0: the config and the terms.

The env class is sim_worker/mimic_env.py. They are apart because Mimic's generate_dataset.py builds the config
*before* it launches Isaac Sim, and ManagerBasedRLMimicEnv imports USD (pxr): importing it first loads the pip
USD build, and Kit's own USD libraries then fail to load (Windows 0xc0000139, "omni.usd has no attribute
get_context"). Nothing here may import the env class or anything else that pulls in pxr (a test checks).

Mimic (isaaclab_mimic, the engine of NVIDIA's GR00T-Mimic blueprint) multiplies source demos by replaying their
subtask segments relative to where the objects are now. This env is SANT's scene (scene_cfg.py: Franka high PD,
the cube, the five-box bin, the table; no cameras) with what Mimic needs, matching scripts/export_mimic.py's files:

- the action: an absolute tool pose (x, y, z, quaternion x y z w) for differential IK on the tool centre
  (panda_hand + TCP_OFFSET, as SANT's replay drives it), then a binary gripper (< 0 closes);
- observations: the tool pose, joints and cube position (policy), and the `grasp` subtask signal;
- the subtasks: grasp relative to the cube, then place relative to the bin (demo_pipeline.mimic.SUBTASKS);
- success, each step: check_success's end state (mimic.placed: the cube in the bin, settled, the gripper open).
  Mimic stops a generated demo at the first step it holds. check_success's history checks (collision force,
  drops, the release height, the time limit) need the whole run: re-verify Mimic's output with SANT afterwards.
- reset: the robot at its default joints, the cube and bin sampled in SANT's Franka ranges (multiply.sample_scene),
  as sim_worker.placement.place_scene does it.
- recording: besides Isaac Lab's default (actions, policy observations, states), the `sant` group after each step
  (the cube and the contact forces, read as sim_worker.replay reads them), so demo_pipeline.mimic.verify_generated
  can run SANT's check_success on the generated demos without a GPU.

It steps at SANT's 50 Hz (physics 0.01 s, decimation 2). Registered by sim_worker/mimic_register.py. Importing it
needs Isaac Lab, not the app: the tests build the config and run the terms on stand-in tensors.
Isaac Lab 3.0 quaternions are (x, y, z, w).
"""

from __future__ import annotations

import numpy as np
import torch

import isaaclab.envs.mdp as mdp
import isaaclab.utils.math as PoseUtils
from isaaclab.controllers.differential_ik_cfg import DifferentialIKControllerCfg
from isaaclab.envs import ManagerBasedRLEnvCfg
from isaaclab.envs.mdp.actions.actions_cfg import BinaryJointPositionActionCfg, DifferentialInverseKinematicsActionCfg
from isaaclab.envs.mdp.recorders.recorders_cfg import ActionStateRecorderManagerCfg
from isaaclab.envs.mimic_env_cfg import MimicEnvCfg, SubTaskConfig
from isaaclab.managers import EventTermCfg as EventTerm
from isaaclab.managers import ObservationGroupCfg as ObsGroup
from isaaclab.managers import ObservationTermCfg as ObsTerm
from isaaclab.managers import RecorderTerm, RecorderTermCfg, SceneEntityCfg
from isaaclab.managers import TerminationTermCfg as DoneTerm
from isaaclab.utils import configclass

from demo_pipeline import mimic
from demo_pipeline.multiply import sample_scene

from .scene_cfg import ARM_CONTACT_SENSORS, make_scene_cfg

HAND = "panda_hand"
PHYSICS_DT = 0.01
DECIMATION = 2
GRIPPER_TERM = "gripper_action"

# --- observations, terms and events (functions of the env, torch) -----------------------------------------


def _hand_pose(env) -> tuple[torch.Tensor, torch.Tensor]:
    robot = env.scene["robot"]
    ids, _ = robot.find_bodies(HAND)
    pose = robot.data.body_pose_w.torch[:, ids[0]]
    return pose[:, :3] - env.scene.env_origins, pose[:, 3:7]


def tcp_pos(env) -> torch.Tensor:
    """The tool centre (panda_hand + TCP_OFFSET in the hand frame), env frame."""
    pos, quat = _hand_pose(env)
    offset = torch.tensor(mimic.TCP_OFFSET, dtype=pos.dtype, device=pos.device).expand_as(pos)
    return pos + PoseUtils.quat_apply(quat, offset)


def tcp_quat(env) -> torch.Tensor:
    """The tool's orientation (x, y, z, w): the hand's, which the Franka's tool frame doesn't turn."""
    return _hand_pose(env)[1]


def bin_frame(env) -> tuple[torch.Tensor, torch.Tensor]:
    """The bin's origin (the centre of its floor's underside) and orientation, from the floor box, env frame."""
    floor = env.scene["bin_floor"]
    quat = floor.data.root_quat_w.torch
    center = torch.tensor(mimic.BIN_PART_CENTERS["bin_floor"], dtype=quat.dtype, device=quat.device).expand(quat.shape[0], 3)
    return floor.data.root_pos_w.torch - env.scene.env_origins - PoseUtils.quat_apply(quat, center), quat


def _cube_pos(env) -> torch.Tensor:
    return env.scene["cube"].data.root_pos_w.torch - env.scene.env_origins


def _gripper_command(env) -> torch.Tensor:
    return env.action_manager.get_term(GRIPPER_TERM).raw_actions[:, 0]


def sant_success(env) -> torch.Tensor:
    """check_success's end state per environment: the cube in the bin, settled, and the gripper open."""
    bin_pos, bin_quat = bin_frame(env)
    cube_in_bin = PoseUtils.quat_apply_inverse(bin_quat, _cube_pos(env) - bin_pos)
    speed = torch.linalg.norm(env.scene["cube"].data.root_lin_vel_w.torch, dim=-1)
    return mimic.placed(cube_in_bin, speed, _gripper_command(env) >= 0)


def grasp_signal(env) -> torch.Tensor:
    """The grasp subtask is done: the gripper closed and the cube a centimetre up (the export's signal)."""
    return mimic.grasped(_cube_pos(env)[:, 2], _gripper_command(env) < 0)


def _pair_force(sensor) -> torch.Tensor:
    """Per environment: the largest filtered normal-force magnitude over the last control step's substeps
    (sim_worker.replay._max_pair_force, per environment)."""
    hist = sensor.data.normal_force_matrix_w_history
    forces = hist.torch if hist is not None else sensor.data.normal_force_matrix_w.torch
    return torch.linalg.norm(forces, dim=-1).flatten(1).amax(dim=1)


def sant_contact_forces(env) -> torch.Tensor:
    """[num_envs, 3]: the fingers on the cube, the arm on the bin (any of its boxes), the arm on the table (N)."""
    groups = [("cube_contact",), ARM_CONTACT_SENSORS["bin"], ARM_CONTACT_SENSORS["table"]]
    return torch.stack([torch.stack([_pair_force(env.scene[n]) for n in names]).amax(dim=0) for names in groups], dim=1)


def sampled_scene_poses(rng: np.random.Generator) -> dict[str, tuple[list[float], list[float]]]:
    """The cube and the five bin boxes for one random SANT scene: (position, (w, x, y, z)), env frame."""
    s = sample_scene(rng, "franka", seed=0)
    poses = mimic.scene_objects({"pos": s.cube_pose.pos, "quat_wxyz": s.cube_pose.quat_wxyz},
                                {"pos": s.bin_pose.pos, "quat_wxyz": s.bin_pose.quat_wxyz})
    poses.pop("table")
    return poses


def reset_sant_scene(env, env_ids: torch.Tensor | slice | None, seed: int = 0) -> None:
    """Event (reset), as sim_worker.placement.place_scene: the robot at its default joints, at rest; a new cube and
    bin for each environment being reset, as SANT samples them. Isaac Lab passes slice(None) for all environments.
    Only the cube gets a velocity: the bin boxes are kinematic, and PhysX refuses a velocity on them."""
    rng = getattr(env, "_sant_rng", None)
    if rng is None:
        rng = env._sant_rng = np.random.default_rng(seed)
    if env_ids is None or isinstance(env_ids, slice):
        ids = list(range(env.num_envs))[env_ids or slice(None)]
    else:
        ids = [int(i) for i in env_ids]
    robot = env.scene["robot"]
    for i in ids:
        robot.write_joint_position_to_sim_index(position=robot.data.default_joint_pos.torch[i:i + 1].clone(), env_ids=[i])
        robot.write_joint_velocity_to_sim_index(velocity=robot.data.default_joint_vel.torch[i:i + 1].clone(), env_ids=[i])
        for name, (pos, q) in sampled_scene_poses(rng).items():
            w, x, y, z = q
            p = torch.tensor(pos, dtype=torch.float32, device=env.device) + env.scene.env_origins[i]
            pose = torch.cat([p, torch.tensor([x, y, z, w], dtype=torch.float32, device=env.device)])[None]
            obj = env.scene[name]
            obj.write_root_pose_to_sim_index(root_pose=pose, env_ids=[i])
            if name == "cube":
                obj.write_root_velocity_to_sim_index(root_velocity=torch.zeros(1, 6, device=env.device), env_ids=[i])


# --- the config -------------------------------------------------------------------------------------------


@configclass
class ActionsCfg:
    arm_action = DifferentialInverseKinematicsActionCfg(
        asset_name="robot",
        joint_names=["panda_joint.*"],
        body_name=HAND,
        controller=DifferentialIKControllerCfg(command_type="pose", use_relative_mode=False, ik_method="dls"),
        body_offset=DifferentialInverseKinematicsActionCfg.OffsetCfg(pos=mimic.TCP_OFFSET),
    )
    gripper_action = BinaryJointPositionActionCfg(
        asset_name="robot",
        joint_names=["panda_finger.*"],
        open_command_expr={"panda_finger_.*": 0.04},
        close_command_expr={"panda_finger_.*": 0.0},
    )


@configclass
class ObservationsCfg:
    @configclass
    class PolicyCfg(ObsGroup):
        actions = ObsTerm(func=mdp.last_action)
        joint_pos = ObsTerm(func=mdp.joint_pos)
        eef_pos = ObsTerm(func=tcp_pos)
        eef_quat = ObsTerm(func=tcp_quat)
        cube_pos = ObsTerm(func=mdp.root_pos_w, params={"asset_cfg": SceneEntityCfg("cube")})

        def __post_init__(self):
            self.enable_corruption = False
            self.concatenate_terms = False

    @configclass
    class SubtaskCfg(ObsGroup):
        grasp = ObsTerm(func=grasp_signal)

        def __post_init__(self):
            self.enable_corruption = False
            self.concatenate_terms = False

    @configclass
    class SantCfg(ObsGroup):
        """What SANT's check_success needs, recorded after each step (SantSignalsRecorder)."""

        cube_pos = ObsTerm(func=mdp.root_pos_w, params={"asset_cfg": SceneEntityCfg("cube")})
        contact_forces = ObsTerm(func=sant_contact_forces)

        def __post_init__(self):
            self.enable_corruption = False
            self.concatenate_terms = False

    policy: PolicyCfg = PolicyCfg()
    subtask_terms: SubtaskCfg = SubtaskCfg()
    sant: SantCfg = SantCfg()


class SantSignalsRecorder(RecorderTerm):
    """Records the `sant` observation group after each step, as obs/sant/..."""

    def record_post_step(self):
        return "obs/sant", self._env.obs_buf["sant"]


@configclass
class SantRecorderManagerCfg(ActionStateRecorderManagerCfg):
    """Isaac Lab's default recording for generation, plus the sant group."""

    record_post_step_sant = RecorderTermCfg(class_type=SantSignalsRecorder)


@configclass
class EventCfg:
    # Not mdp.reset_scene_to_default: it writes a velocity to every rigid object, kinematic bin boxes included.
    reset_scene = EventTerm(func=reset_sant_scene, mode="reset", params={"seed": 0})


@configclass
class TerminationsCfg:
    time_out = DoneTerm(func=mdp.time_out, time_out=True)
    success = DoneTerm(func=sant_success)


@configclass
class SantPickPlaceMimicEnvCfg(ManagerBasedRLEnvCfg, MimicEnvCfg):
    scene = make_scene_cfg(cameras=False)
    observations: ObservationsCfg = ObservationsCfg()
    actions: ActionsCfg = ActionsCfg()
    events: EventCfg = EventCfg()
    terminations: TerminationsCfg = TerminationsCfg()
    rewards = None
    commands = None
    mimic_recorder_config: SantRecorderManagerCfg = SantRecorderManagerCfg()

    def __post_init__(self):
        self.decimation = DECIMATION
        self.episode_length_s = 30.0  # check_success's time limit
        self.sim.dt = PHYSICS_DT
        self.sim.render_interval = DECIMATION
        self.scene.env_spacing = 3.0

        # Mimic: as Isaac Lab's Franka IK-abs stack task, with SANT's two subtasks.
        self.datagen_config.name = "sant_pick_place"
        self.datagen_config.generation_guarantee = True
        self.datagen_config.generation_keep_failed = True
        self.datagen_config.generation_num_trials = 10
        self.datagen_config.generation_select_src_per_subtask = True
        self.datagen_config.generation_transform_first_robot_pose = False
        self.datagen_config.generation_interpolate_from_last_target_pose = True
        self.datagen_config.seed = 1
        self.subtask_configs[mimic.EEF] = [
            SubTaskConfig(
                object_ref=s["object_ref"],
                subtask_term_signal=s["term_signal"],
                subtask_term_offset_range=tuple(s["term_offset"]),
                selection_strategy="nearest_neighbor_object",
                selection_strategy_kwargs={"nn_k": 3},
                action_noise=0.01,
                num_interpolation_steps=5,
                num_fixed_steps=0,
                apply_noise_during_interpolation=False,
                description=s["description"],
            )
            for s in mimic.SUBTASKS
        ]
