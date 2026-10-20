"""SANT's pick-place as an Isaac Lab Mimic env: SANT-PickPlace-Franka-IK-Abs-Mimic-v0.

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
- reset: the robot at its default joints, the cube and bin sampled in SANT's Franka ranges (multiply.sample_scene).

It steps at SANT's 50 Hz (physics 0.01 s, decimation 2). Registered by sim_worker/mimic_register.py. Importing it
needs Isaac Lab, not the app: the tests build the config and run the methods on stand-in tensors.
Isaac Lab 3.0 quaternions are (x, y, z, w).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import torch

import isaaclab.envs.mdp as mdp
import isaaclab.utils.math as PoseUtils
from isaaclab.controllers.differential_ik_cfg import DifferentialIKControllerCfg
from isaaclab.envs import ManagerBasedRLEnvCfg, ManagerBasedRLMimicEnv
from isaaclab.envs.mdp.actions.actions_cfg import BinaryJointPositionActionCfg, DifferentialInverseKinematicsActionCfg
from isaaclab.envs.mimic_env_cfg import MimicEnvCfg, SubTaskConfig
from isaaclab.managers import EventTermCfg as EventTerm
from isaaclab.managers import ObservationGroupCfg as ObsGroup
from isaaclab.managers import ObservationTermCfg as ObsTerm
from isaaclab.managers import SceneEntityCfg
from isaaclab.managers import TerminationTermCfg as DoneTerm
from isaaclab.utils import configclass

from demo_pipeline import mimic
from demo_pipeline.multiply import sample_scene

from .scene_cfg import make_scene_cfg

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


def sampled_scene_poses(rng: np.random.Generator) -> dict[str, tuple[list[float], list[float]]]:
    """The cube and the five bin boxes for one random SANT scene: (position, (w, x, y, z)), env frame."""
    s = sample_scene(rng, "franka", seed=0)
    poses = mimic.scene_objects({"pos": s.cube_pose.pos, "quat_wxyz": s.cube_pose.quat_wxyz},
                                {"pos": s.bin_pose.pos, "quat_wxyz": s.bin_pose.quat_wxyz})
    poses.pop("table")
    return poses


def reset_sant_scene(env, env_ids: torch.Tensor | None, seed: int = 0) -> None:
    """Event (reset): a new cube and bin for each environment being reset, as SANT samples them."""
    rng = getattr(env, "_sant_rng", None)
    if rng is None:
        rng = env._sant_rng = np.random.default_rng(seed)
    ids = range(env.num_envs) if env_ids is None else [int(i) for i in env_ids]
    for i in ids:
        for name, (pos, q) in sampled_scene_poses(rng).items():
            w, x, y, z = q
            p = torch.tensor(pos, dtype=torch.float32, device=env.device) + env.scene.env_origins[i]
            pose = torch.cat([p, torch.tensor([x, y, z, w], dtype=torch.float32, device=env.device)])[None]
            obj = env.scene[name]
            obj.write_root_pose_to_sim_index(root_pose=pose, env_ids=[i])
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

    policy: PolicyCfg = PolicyCfg()
    subtask_terms: SubtaskCfg = SubtaskCfg()


@configclass
class EventCfg:
    reset_all = EventTerm(func=mdp.reset_scene_to_default, mode="reset")
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


# --- the env ----------------------------------------------------------------------------------------------


class SantPickPlaceMimicEnv(ManagerBasedRLMimicEnv):
    """The Mimic API on SANT's pick-place: one eef, absolute tool-pose actions, the cube and the bin as objects."""

    def get_robot_eef_pose(self, eef_name: str, env_ids: Sequence[int] | None = None) -> torch.Tensor:
        """The tool pose [len(env_ids), 4, 4], env frame (the frame the IK drives)."""
        if env_ids is None:
            env_ids = slice(None)
        pos = self.obs_buf["policy"]["eef_pos"][env_ids]
        quat = self.obs_buf["policy"]["eef_quat"][env_ids]
        return PoseUtils.make_pose(pos, PoseUtils.matrix_from_quat(quat))

    def target_eef_pose_to_action(
        self,
        target_eef_pose_dict: dict,
        gripper_action_dict: dict,
        action_noise_dict: dict | None = None,
        env_id: int = 0,
    ) -> torch.Tensor:
        """A 4x4 tool target and a gripper action -> [x, y, z, qx, qy, qz, qw, gripper]. Noise (if any) moves the
        target by a normal offset of that scale (m) and turns it by a random rotation of that scale (rad)."""
        (target,) = target_eef_pose_dict.values()
        pos, rot = PoseUtils.unmake_pose(target)
        if action_noise_dict is not None:
            scale = float(action_noise_dict[mimic.EEF])
            pos = pos + scale * torch.randn_like(pos)
            turn = scale * torch.randn(3, device=rot.device, dtype=rot.dtype)
            angle = torch.linalg.norm(turn)
            if angle > 0:
                rot = PoseUtils.matrix_from_quat(PoseUtils.quat_from_angle_axis(angle, turn / angle)) @ rot
        (gripper,) = gripper_action_dict.values()
        return torch.cat([pos, PoseUtils.quat_from_matrix(rot), gripper], dim=0)

    def action_to_target_eef_pose(self, action: torch.Tensor) -> dict[str, torch.Tensor]:
        """[num_envs, 8] actions -> the 4x4 tool targets they ask for."""
        rot = PoseUtils.matrix_from_quat(action[:, 3:7])
        return {mimic.EEF: PoseUtils.make_pose(action[:, :3], rot).clone()}

    def actions_to_gripper_actions(self, actions: torch.Tensor) -> dict[str, torch.Tensor]:
        """The gripper column of a demo's actions [steps, 8] -> [steps, 1]."""
        return {mimic.EEF: actions[:, -1:]}

    def get_object_poses(self, env_ids: Sequence[int] | None = None) -> dict[str, torch.Tensor]:
        """The cube and the bin frame as 4x4 poses, env frame. The base class would list every rigid object; SANT's
        bin is five boxes, and Mimic's subtasks refer to the bin as one frame."""
        if env_ids is None:
            env_ids = slice(None)
        cube = self.scene["cube"].data
        bin_pos, bin_quat = bin_frame(self)
        return {
            "cube": PoseUtils.make_pose(
                (cube.root_pos_w.torch - self.scene.env_origins)[env_ids], PoseUtils.matrix_from_quat(cube.root_quat_w.torch[env_ids])
            ),
            "bin": PoseUtils.make_pose(bin_pos[env_ids], PoseUtils.matrix_from_quat(bin_quat[env_ids])),
        }

    def get_subtask_term_signals(self, env_ids: Sequence[int] | None = None) -> dict[str, torch.Tensor]:
        """grasp: the cube held a centimetre up (for annotate_demos --auto; the place subtask runs to the end)."""
        if env_ids is None:
            env_ids = slice(None)
        return {"grasp": self.obs_buf["subtask_terms"]["grasp"][env_ids]}
