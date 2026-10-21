"""The RL teacher's Isaac Lab env, SANT-PickPlace-Franka-RL-v0 (and -NoDemo-v0, the "RL without demos" arm): the
config and its terms. Registered by sim_worker/rl_register.py; trained with Isaac Lab's rsl_rl PPO runner.

Built like Isaac Lab 3.0's IsaacContrib-Lift-Cube-Franka (manager-based, 50 Hz policy: physics 0.01 s, decimation
2, many parallel envs, rsl_rl PPO), but on SANT's task and scene:
- **scene**: scene_cfg.make_scene_cfg(cameras=False): SANT's high-PD Franka, the 5 cm cube, the five-box bin, the
  table and their contact sensors; the physics settings SANT replays and evaluates with. State only, no cameras.
  Envs sit ENV_SPACING apart (8 m: whole multiples of 2 m, as memory/multi-env-ground-checker requires for
  anything rendered; it costs nothing here);
- **observations** (privileged, exact; rl_teacher.OBS_SPEC, which sim_worker/rl_policy.py rebuilds from a
  TeacherState): joints and their velocities, the tool's pose, the cube's pose, the bin's place and yaw, the cube
  relative to the tool and in the bin's frame, the last action;
- **actions** (demo_pipeline.rl_teacher): 4 for the arm (an absolute tool target, sim_worker/rl_action.py through
  SANT's tracking IK, the target held at or above the record-time soft floor as the sim worker holds teleop
  targets) and 1 for the gripper (< 0 closes): the space SANT's Trajectories live in, so the teacher's rollouts
  replay, verify and export into the ACT student's data like any demo;
- **reward** (demo_pipeline.rl_teacher): the potential of check_success's stages, penalties for its failures, and a
  success bonus; the env ends an episode at success (the cube placed and settled for 0.5 s with nothing fouled),
  at the time limit, or if the cube falls off the table;
- **success** is the unchanged check_success: the env records every TRACK_EVERY-th environment's episode and runs
  check_success on it when it ends (Metrics/check_success in the training log). The teacher's real test is SANT's
  eval env (scripts/rl_eval_teacher.py);
- **resets** (demo_pipeline.rl_demo_bank): with demo_prob, a state along a SANT-verified episode, picked by the
  late-to-early curriculum; otherwise SANT's home (rl_teacher.HOME_JOINTS, where SANT's eval starts) in a random
  training-side scene (multiply.sample_scene).

Nothing here imports USD (the action term is named by string), so the config builds before Isaac Sim starts and the
tests run the terms on stand-in tensors in Isaac Lab's Python without the app.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

import isaaclab.envs.mdp as mdp
import isaaclab.utils.math as PoseUtils
from isaaclab.controllers.differential_ik_cfg import DifferentialIKControllerCfg
from isaaclab.envs import ManagerBasedRLEnvCfg
from isaaclab.envs.mdp.actions.actions_cfg import BinaryJointPositionActionCfg, DifferentialInverseKinematicsActionCfg
from isaaclab.managers import CurriculumTermCfg as CurrTerm
from isaaclab.managers import EventTermCfg as EventTerm
from isaaclab.managers import ObservationGroupCfg as ObsGroup
from isaaclab.managers import ObservationTermCfg as ObsTerm
from isaaclab.managers import RewardTermCfg as RewTerm
from isaaclab.managers import TerminationTermCfg as DoneTerm
from isaaclab.utils import configclass

from demo_pipeline import mimic
from demo_pipeline import rl_demo_bank as bank_mod
from demo_pipeline import rl_teacher as rt
from demo_pipeline.schemas import Pose, SimSignals, Trajectory
from demo_pipeline.success import check_success

from .mimic_env_cfg import SantTrackingIKActionCfg, bin_frame, sant_contact_forces, tcp_pos, tcp_quat
from .robots import robot_spec
from .scene_cfg import make_scene_cfg

REPO = Path(__file__).resolve().parents[1]
HAND = "panda_hand"
PHYSICS_DT = 0.01
DECIMATION = 2
EPISODE_S = 12.0  # a home start does the whole task in 6-9 s (the verified demos: median 5.6 s, retimed 9.2 s)
NUM_ENVS = 4096
ENV_SPACING = 8.0
TRACK_EVERY = 8  # check_success runs on every 8th environment's episodes
CUBE_FELL_Z = -0.05
DEFAULT_BANK = REPO / "data" / "rl" / "bank_mouse20261020.npz"
GRIPPER_TERM, ARM_TERM = "gripper_action", "arm_action"
TELEMETRY = ("reach", "centred_grasp", "lifted", "carry", "low_over_bin", "placed", "collision", "dropped",
             "high_release")


# --- what the reward and check_success read, per step (torch) ------------------------------------------------


def _cube(env) -> torch.Tensor:
    return env.scene["cube"].data.root_pos_w.torch - env.scene.env_origins


def _cube_quat(env) -> torch.Tensor:
    return env.scene["cube"].data.root_quat_w.torch  # x y z w


def _closed(env) -> torch.Tensor:
    return env.action_manager.get_term(GRIPPER_TERM).raw_actions[:, 0] < 0


def step_state(env) -> rt.StepState:
    """This step of every environment as demo_pipeline.rl_teacher reads it (contacts as sim_worker.replay reads
    them)."""
    bin_pos, bin_quat = bin_frame(env)
    cube = _cube(env)
    forces = sant_contact_forces(env)  # fingers-cube, arm-bin, arm-table (N)
    arm_force = torch.maximum(forces[:, 1], forces[:, 2])
    return rt.StepState(
        tcp=tcp_pos(env), cube=cube, cube_speed=torch.linalg.norm(env.scene["cube"].data.root_lin_vel_w.torch, dim=-1),
        cube_in_bin=PoseUtils.quat_apply_inverse(bin_quat, cube - bin_pos), closed=_closed(env),
        finger_contact=forces[:, 0] > rt.CONTACT_N, arm_contact=arm_force > rt.CONTACT_N, arm_force=arm_force)


class EpisodeMonitor:
    """Per environment, once per step: the reward's parts (rl_teacher's potential change, penalties, bonus), the
    episode's fouls and success, and for every TRACK_EVERY-th environment the record check_success needs. Pure
    torch over a StepState, so the tests drive it with stand-in tensors."""

    FIELDS = ("tcp", "closed", "cube", "finger", "arm_bin", "arm_table", "force")

    def __init__(self, num_envs: int, device, max_steps: int, track_every: int = TRACK_EVERY):
        z = lambda dtype=torch.float32: torch.zeros(num_envs, dtype=dtype, device=device)  # noqa: E731
        self.device = device
        self.step = None
        self.prev: rt.StepState | None = None
        self.fresh = torch.ones(num_envs, dtype=torch.bool, device=device)
        self.phi_prev, self.progress, self.penalty, self.bonus = z(), z(), z(), z()
        # the lift preset's parts (rl_teacher.lift_*): its level reward, its foul penalty, its bonus
        self.lift_level, self.lift_penalty, self.lift_bonus = z(), z(), z()
        self.placed_steps = z(torch.int32)
        self.length = z(torch.int32)
        self.fouled, self.success = z(torch.bool), z(torch.bool)
        self.terms: dict = {}
        self.tracked = torch.arange(0, num_envs, max(1, track_every), device=device)
        self.slot = torch.full((num_envs,), -1, dtype=torch.long, device=device)
        self.slot[self.tracked] = torch.arange(len(self.tracked), device=device)
        n, m = len(self.tracked), max_steps + 1
        self.rec = {"tcp": torch.zeros(n, m, 3, device=device), "cube": torch.zeros(n, m, 3, device=device),
                    **{k: torch.zeros(n, m, dtype=torch.bool, device=device) for k in ("closed", "finger", "arm_bin",
                                                                                       "arm_table")},
                    "force": torch.zeros(n, m, device=device)}
        self.results: list[dict] = []  # check_success verdicts of finished tracked episodes, until logged

    def update(self, s: rt.StepState, arm_bin: torch.Tensor, arm_table: torch.Tensor,
               remaining: torch.Tensor | None = None) -> None:
        """remaining: steps left in each environment's episode (the lift preset's bonus pays for them)."""
        terms = rt.reward_terms(s, self.prev)
        keep = (~self.fresh).float()
        for k in ("dropped", "high_release"):  # nothing to compare with on an episode's first step
            terms[k] = terms[k] * keep
        phi = rt.potential(terms)
        self.progress = (phi - self.phi_prev) * keep
        self.penalty = rt.penalty(terms)
        self.fouled |= rt.fouled(terms)
        self.placed_steps = torch.where(terms["placed"] > 0, self.placed_steps + 1, torch.zeros_like(self.placed_steps))
        done = (self.placed_steps.float() * rt.STEP_S >= rt.SETTLE_S - 1e-6) & ~self.fouled & ~self.success
        self.bonus = done.float() * rt.SUCCESS_BONUS
        self.lift_level = rt.lift_level(rt.lift_level_terms(s))
        self.lift_penalty = rt.penalty(terms, rt.LIFT_PENALTY)
        left = torch.zeros_like(self.bonus) if remaining is None else remaining.float()
        self.lift_bonus = done.float() * rt.lift_bonus(left)
        self.success |= done
        self.terms = terms
        # the tracked environments' record for check_success
        t, ln = self.tracked, self.length[self.tracked].long()
        ok = ln < self.rec["tcp"].shape[1]
        rows, cols = torch.nonzero(ok).flatten(), ln[ok]
        idx = t[ok]
        self.rec["tcp"][rows, cols] = s.tcp[idx].float()
        self.rec["cube"][rows, cols] = s.cube[idx].float()
        self.rec["closed"][rows, cols] = s.closed[idx]
        self.rec["finger"][rows, cols] = s.finger_contact[idx]
        self.rec["arm_bin"][rows, cols] = arm_bin[idx]
        self.rec["arm_table"][rows, cols] = arm_table[idx]
        self.rec["force"][rows, cols] = s.arm_force[idx].float()
        self.length += 1
        self.phi_prev = phi
        self.prev = s
        self.fresh[:] = False

    def finish(self, env_ids: torch.Tensor, bin_pos: torch.Tensor, bin_quat_xyzw: torch.Tensor) -> None:
        """The episodes of env_ids end: check_success on the tracked ones (bin_pos/quat: their bins, env frame,
        [len(env_ids), ...]); then clear them for the next episode."""
        for j, e in enumerate(env_ids.tolist()):
            k = int(self.slot[e])
            n = int(self.length[e])
            if k < 0 or n < 2:
                continue
            n = min(n, self.rec["tcp"].shape[1])
            r = {f: self.rec[f][k, :n].cpu().numpy() for f in self.FIELDS}
            traj = Trajectory.from_arrays(np.arange(n) * rt.STEP_S, r["tcp"].astype(np.float64),
                                          np.tile(rt.DOWN_WXYZ, (n, 1)), r["closed"].astype(int))
            sim = SimSignals(cube_pos=r["cube"].astype(np.float64), contact_gripper_cube=r["finger"],
                             contact_arm_bin=r["arm_bin"], contact_arm_table=r["arm_table"],
                             max_contact_force=r["force"].astype(np.float64))
            x, y, z, w = bin_quat_xyzw[j].tolist()
            v = check_success(traj, sim, Pose(pos=tuple(bin_pos[j].tolist()), quat_wxyz=(w, x, y, z)))
            self.results.append({"env": e, "success": v.success, "reasons": v.reasons, "bonus": bool(self.success[e]),
                                 "steps": n})
        self.reset(env_ids)

    def reset(self, env_ids: torch.Tensor) -> None:
        self.fresh[env_ids] = True
        for buf in (self.phi_prev, self.progress, self.penalty, self.bonus, self.lift_level, self.lift_penalty,
                    self.lift_bonus):
            buf[env_ids] = 0.0
        self.placed_steps[env_ids] = 0
        self.length[env_ids] = 0
        self.fouled[env_ids] = False
        self.success[env_ids] = False

    def log(self) -> dict:
        """Training-log entries: check_success on the tracked episodes that ended since the last call, and how
        often the reward's bonus agreed with it."""
        if not self.results:
            return {}
        res, self.results = self.results, []
        out = {"Metrics/check_success": float(np.mean([r["success"] for r in res])),
               "Metrics/bonus_agrees_with_check_success": float(np.mean([r["success"] == r["bonus"] for r in res])),
               "Metrics/tracked_episodes": float(len(res))}
        for reason in ("not_in_bin", "gripper_closed", "not_settled", "collision", "dropped", "high_release"):
            out[f"Failures/{reason}"] = float(np.mean([reason in r["reasons"] for r in res]))
        return out


def monitor(env) -> EpisodeMonitor:
    """The env's monitor, brought up to this step (once per step, whichever term asks first)."""
    m = getattr(env, "_sant_rl_monitor", None)
    if m is None:
        m = env._sant_rl_monitor = EpisodeMonitor(env.num_envs, env.device, int(env.max_episode_length))
    if m.step != env.common_step_counter:
        m.step = env.common_step_counter
        forces = sant_contact_forces(env)
        m.update(step_state(env), forces[:, 1] > rt.CONTACT_N, forces[:, 2] > rt.CONTACT_N,
                 remaining=env.max_episode_length - env.episode_length_buf)
        log = env.extras.setdefault("log", {})
        log.update(m.log())
        if m.step % 10 == 0:  # how often each stage is reached, now and then (each mean is a GPU sync)
            for k in TELEMETRY:
                log[f"Stages/{k}"] = float(m.terms[k].float().mean())
    return m


# --- terms -----------------------------------------------------------------------------------------------


def done_success(env) -> torch.Tensor:
    return monitor(env).success


def cube_fell(env) -> torch.Tensor:
    return _cube(env)[:, 2] < CUBE_FELL_Z


def reward_progress(env) -> torch.Tensor:
    return monitor(env).progress


def reward_penalty(env) -> torch.Tensor:
    return monitor(env).penalty


def reward_lift_level(env) -> torch.Tensor:
    return monitor(env).lift_level


def reward_lift_penalty(env) -> torch.Tensor:
    return monitor(env).lift_penalty


def reward_lift_success(env) -> torch.Tensor:
    return monitor(env).lift_bonus


def reward_success(env) -> torch.Tensor:
    return monitor(env).bonus


def obs_tcp_pos(env) -> torch.Tensor:
    return tcp_pos(env)


def obs_tcp_quat(env) -> torch.Tensor:
    return tcp_quat(env)


def obs_cube_pos(env) -> torch.Tensor:
    return _cube(env)


def obs_cube_quat(env) -> torch.Tensor:
    return _cube_quat(env)


def obs_bin(env) -> torch.Tensor:
    """The bin's origin (env frame) and its yaw as (cos, sin)."""
    pos, q = bin_frame(env)  # x y z w
    yaw = torch.atan2(2 * (q[:, 3] * q[:, 2] + q[:, 0] * q[:, 1]), 1 - 2 * (q[:, 1] ** 2 + q[:, 2] ** 2))
    return torch.cat([pos, torch.cos(yaw)[:, None], torch.sin(yaw)[:, None]], dim=-1)


def obs_cube_from_tcp(env) -> torch.Tensor:
    return _cube(env) - tcp_pos(env)


def obs_cube_in_bin(env) -> torch.Tensor:
    pos, q = bin_frame(env)
    return PoseUtils.quat_apply_inverse(q, _cube(env) - pos)


def _wxyz_to_xyzw(q: np.ndarray) -> np.ndarray:
    return np.concatenate([q[..., 1:], q[..., :1]], axis=-1)


def reset_rl_scene(env, env_ids, bank_path: str = "", demo_prob: float = 0.5, curriculum_start: float = 0.75,
                   curriculum_end: float = 0.0, curriculum_steps: int = 24_000, seed: int = 0, bank_phase: str = "",
                   held_grace_steps: int = 0, uniform_share: float = 0.0) -> None:
    """Event (reset). check_success for the tracked episodes that end, then each resetting environment starts
    from rl_demo_bank.plan_resets: a demo state (the curriculum's floor at this step) or home in a random scene.
    Batched per object: the robot's joints (and their targets, so the arm holds the restored pose), the cube, and
    the five bin boxes placed round the bin's pose (as sim_worker.placement does). Velocities zero. The curriculum
    counts the env's own steps (common_step_counter: 24 per PPO iteration at 24 steps per env), so the floor falls
    from curriculum_start to curriculum_end over curriculum_steps whatever the number of envs.

    bank_phase ("free" / "held", for diagnostics) keeps only those bank states. held_grace_steps: a start that holds
    the cube keeps the gripper closed for that many steps whatever the policy says (SantGraceGripperAction), and its
    fingers are commanded closed at once, so a new policy's random gripper doesn't drop what the demo held; 0 = off.
    env._sant_rl_start_row keeps each env's bank row (-1: home), for diagnostics. uniform_share: that share of the demo
    starts samples the whole episode, the rest follows the curriculum (rl_demo_bank.plan_resets; 0 = all curriculum)."""
    ids = torch.arange(env.num_envs, device=env.device) if env_ids is None or isinstance(env_ids, slice) else env_ids
    ids = torch.as_tensor(ids, device=env.device, dtype=torch.long)
    if len(ids) == 0:
        return
    mon = getattr(env, "_sant_rl_monitor", None)  # absent at the env's first reset, before any step
    if mon is not None:
        bin_pos, bin_quat = bin_frame(env)
        mon.finish(ids, bin_pos[ids], bin_quat[ids])
    if getattr(env, "_sant_rl_rng", None) is None:
        env._sant_rl_rng = np.random.default_rng(seed)
        env._sant_rl_bank = bank_mod.load_bank(Path(bank_path)) if (bank_path and demo_prob > 0) else None
        if env._sant_rl_bank is not None and bank_phase:
            keep = env._sant_rl_bank["phase"] == {"free": bank_mod.FREE, "held": bank_mod.HELD}[bank_phase]
            env._sant_rl_bank = {k: v[keep] for k, v in env._sant_rl_bank.items()}
        env._sant_rl_start_row = torch.full((env.num_envs,), -1, dtype=torch.long, device=env.device)
        env._sant_rl_grace = torch.zeros(env.num_envs, dtype=torch.long, device=env.device)
    rng, bank = env._sant_rl_rng, env._sant_rl_bank
    floor = bank_mod.min_progress(env.common_step_counter, start=curriculum_start, end=curriculum_end,
                                  steps=curriculum_steps)
    robot = env.scene["robot"]
    plan = bank_mod.plan_resets(rng, len(ids), bank, demo_prob, floor, np.asarray(rt.HOME_JOINTS),
                                uniform_share=uniform_share)
    dev = env.device
    joints = torch.as_tensor(plan["joint_pos"], device=dev)
    rows = torch.as_tensor(plan["row"], device=dev)
    held = torch.zeros(len(ids), dtype=torch.bool, device=dev)
    if bank is not None and plan["demo"].any():
        held_np = np.zeros(len(ids), dtype=bool)
        held_np[plan["demo"]] = bank["phase"][plan["row"][plan["demo"]]] == bank_mod.HELD
        held = torch.as_tensor(held_np, device=dev)
    env._sant_rl_start_row[ids] = rows
    env._sant_rl_grace[ids] = torch.where(held, held_grace_steps, 0)
    targets = joints.clone()
    if held_grace_steps > 0:
        targets[held, 7:] = 0.0  # the fingers commanded closed at once on a held start
    robot.write_joint_position_to_sim_index(position=joints, env_ids=ids)
    robot.write_joint_velocity_to_sim_index(velocity=torch.zeros_like(joints), env_ids=ids)
    robot.set_joint_position_target_index(target=targets, env_ids=ids)
    origins = env.scene.env_origins[ids].cpu().numpy()
    poses: dict[str, list] = {}
    for i in range(len(ids)):
        objs = mimic.scene_objects({"pos": plan["cube_pos"][i], "quat_wxyz": plan["cube_quat_wxyz"][i]},
                                   {"pos": plan["bin_pos"][i], "quat_wxyz": plan["bin_quat_wxyz"][i]})
        objs.pop("table")
        for name, (pos, q) in objs.items():
            poses.setdefault(name, []).append(np.r_[np.asarray(pos) + origins[i], _wxyz_to_xyzw(np.asarray(q))])
    for name, rows in poses.items():
        obj = env.scene[name]
        obj.write_root_pose_to_sim_index(root_pose=torch.as_tensor(np.asarray(rows), dtype=torch.float32, device=dev),
                                         env_ids=ids)
        if name == "cube":  # the bin boxes are kinematic: PhysX refuses a velocity on them
            obj.write_root_velocity_to_sim_index(root_velocity=torch.zeros(len(ids), 6, device=dev), env_ids=ids)
    log = env.extras.setdefault("log", {})
    log["Curriculum/demo_min_progress"] = floor
    log["Curriculum/demo_start_share"] = float(plan["demo"].mean())
    log["Curriculum/held_start_share"] = float(held.float().mean())


# --- the config --------------------------------------------------------------------------------------------


@configclass
class SantTcpTargetActionCfg(SantTrackingIKActionCfg):
    """4 policy numbers -> SANT's absolute tool target (sim_worker/rl_action.py, named by string: it imports USD)."""

    class_type: type | str = "sim_worker.rl_action:SantTcpTargetAction"


@configclass
class SantGraceGripperActionCfg(BinaryJointPositionActionCfg):
    """Isaac Lab's binary gripper with the held-start grace (sim_worker/rl_action.py, named by string: it imports USD)."""

    class_type: type | str = "sim_worker.rl_action:SantGraceGripperAction"
    deadband: float = 0.0
    """The gripper switches only when the policy's output crosses +-deadband (0: Isaac Lab's < 0 closes)."""


@configclass
class ActionsCfg:
    arm_action = SantTcpTargetActionCfg(
        asset_name="robot",
        joint_names=["panda_joint.*"],
        body_name=HAND,
        # replay's IK (sim_worker.replay): dls, default damping, the robot spec's joint-limit avoidance (Franka: 0)
        controller=DifferentialIKControllerCfg(command_type="pose", use_relative_mode=False, ik_method="dls",
                                               joint_limit_avoidance_gain=robot_spec("franka").ik_limit_gain),
        body_offset=DifferentialInverseKinematicsActionCfg.OffsetCfg(pos=mimic.TCP_OFFSET),
    )
    gripper_action = SantGraceGripperActionCfg(
        asset_name="robot",
        joint_names=["panda_finger.*"],
        open_command_expr={"panda_finger_.*": 0.04},
        close_command_expr={"panda_finger_.*": 0.0},
    )


@configclass
class ObservationsCfg:
    @configclass
    class PolicyCfg(ObsGroup):
        # absolute, not relative to Isaac Lab's default pose: the adapter rebuilds them from a TeacherState
        joint_pos = ObsTerm(func=mdp.joint_pos)
        joint_vel = ObsTerm(func=mdp.joint_vel)
        tcp_pos = ObsTerm(func=obs_tcp_pos)
        tcp_quat = ObsTerm(func=obs_tcp_quat)
        cube_pos = ObsTerm(func=obs_cube_pos)
        cube_quat = ObsTerm(func=obs_cube_quat)
        bin = ObsTerm(func=obs_bin)
        cube_from_tcp = ObsTerm(func=obs_cube_from_tcp)
        cube_in_bin = ObsTerm(func=obs_cube_in_bin)
        actions = ObsTerm(func=mdp.last_action)

        def __post_init__(self):
            self.enable_corruption = False
            self.concatenate_terms = True

    policy: PolicyCfg = PolicyCfg()


@configclass
class EventCfg:
    # not mdp.reset_scene_to_default: it writes a velocity to every rigid object, the kinematic bin boxes included
    reset_scene = EventTerm(func=reset_rl_scene, mode="reset",
                            params={"bank_path": str(DEFAULT_BANK), "demo_prob": 0.5, "curriculum_start": 0.75,
                                    "curriculum_end": 0.0, "curriculum_steps": 24_000, "seed": 0})


@configclass
class RewardsCfg:
    progress = RewTerm(func=reward_progress, weight=1.0)
    penalty = RewTerm(func=reward_penalty, weight=-1.0)
    success = RewTerm(func=reward_success, weight=1.0)
    action_rate = RewTerm(func=mdp.action_rate_l2, weight=-1e-3)
    joint_vel = RewTerm(func=mdp.joint_vel_l2, weight=-1e-4)


@configclass
class LiftRewardsCfg:
    """The "lift" preset (rl_teacher, the lift section): Isaac Lab's stock lift level rewards and penalties
    (isaaclab_tasks/contrib/lift/lift_env_cfg.py lines 138-160) with our placed term, fouls and success bonus."""

    level = RewTerm(func=reward_lift_level, weight=1.0)
    penalty = RewTerm(func=reward_lift_penalty, weight=-1.0)
    success = RewTerm(func=reward_lift_success, weight=1.0)
    action_rate = RewTerm(func=mdp.action_rate_l2, weight=-1e-4)  # stock line 155
    joint_vel = RewTerm(func=mdp.joint_vel_l2, weight=-1e-4)  # stock lines 157-160


@configclass
class LiftCurriculumCfg:
    """Stock (lift_env_cfg.py lines 180 and 184): the two penalties raised to -0.1 after 10,000 steps."""

    action_rate = CurrTerm(func=mdp.modify_reward_weight, params={"term_name": "action_rate", "weight": -1e-1,
                                                                    "num_steps": 10000})
    joint_vel = CurrTerm(func=mdp.modify_reward_weight, params={"term_name": "joint_vel", "weight": -1e-1,
                                                                  "num_steps": 10000})


@configclass
class TerminationsCfg:
    success = DoneTerm(func=done_success)  # first: it brings the monitor up to this step
    time_out = DoneTerm(func=mdp.time_out, time_out=True)
    cube_fell = DoneTerm(func=cube_fell)


@configclass
class SantPickPlaceRLEnvCfg(ManagerBasedRLEnvCfg):
    scene = make_scene_cfg(cameras=False)
    observations: ObservationsCfg = ObservationsCfg()
    actions: ActionsCfg = ActionsCfg()
    events: EventCfg = EventCfg()
    rewards: RewardsCfg = RewardsCfg()
    terminations: TerminationsCfg = TerminationsCfg()
    commands = None

    def __post_init__(self):
        self.decimation = DECIMATION
        self.episode_length_s = EPISODE_S
        self.sim.dt = PHYSICS_DT
        self.sim.render_interval = DECIMATION
        self.scene.num_envs = NUM_ENVS
        self.scene.env_spacing = ENV_SPACING


@configclass
class SantPickPlaceRLLiftEnvCfg(SantPickPlaceRLEnvCfg):
    """The task with the "lift" reward preset (rl_train.py --reward lift)."""

    rewards: LiftRewardsCfg = LiftRewardsCfg()
    curriculum: LiftCurriculumCfg = LiftCurriculumCfg()


@configclass
class SantPickPlaceRLNoDemoEnvCfg(SantPickPlaceRLEnvCfg):
    """The control arm: every episode starts from home; no human demo is used."""

    def __post_init__(self):
        super().__post_init__()
        self.events.reset_scene.params["demo_prob"] = 0.0
        self.events.reset_scene.params["bank_path"] = ""


@configclass
class SantPickPlaceRLPlayEnvCfg(SantPickPlaceRLEnvCfg):
    """For playing a checkpoint: few envs, home starts only."""

    def __post_init__(self):
        super().__post_init__()
        self.scene.num_envs = 40
        self.events.reset_scene.params["demo_prob"] = 0.0
        self.events.reset_scene.params["bank_path"] = ""
