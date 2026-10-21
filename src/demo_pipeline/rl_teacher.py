"""The RL teacher's task, pure: its reward, its action space and its success signals. numpy or torch.

The teacher is a state-based PPO policy trained in Isaac Lab (sim_worker/rl_env_cfg.py) on SANT's own scene, and
it is the only teacher: no hand-written task logic, only this reward, SANT-verified human demo starts
(demo_pipeline.rl_demo_bank) and physics. Its rollouts are distilled into the camera policy (ACT).

**Reward.** Staged terms that mirror demo_pipeline.success.check_success:
- progress, as a potential: reach (tool -> cube), a centred grasp (closed, the fingers on the cube, the tool over
  its centre), lifted (the cube 4 cm up in the fingers, as Isaac Lab's lift), carry (the lifted cube toward the bin,
  coarse and fine, clear of the rim or already over the bin), rim clear, low over the bin (held inside the bin's
  footprint, at most check_success's release height), placed (check_success's end state: in the bin, settled, the
  gripper open). Each step pays the change of the potential Phi = sum(POTENTIAL[k] * term_k), never the level: a
  level reward can be farmed (an episode of 500 steps hovering with the cube lifted over the bin would out-earn the
  success bonus, and the policy would learn never to let go). An episode's progress reward is Phi(end) - Phi(start),
  so a demo start mid-task earns nothing for where it starts. placed outweighs the whole held stage (30 > about 21),
  so letting go in the right place raises Phi;
- penalties, one per check_success failure that a step can show: arm contact with the bin or table over 5 N
  (collision, per step), the cube lost while closed outside the bin (dropped), the gripper opened with the cube over
  the bin higher than 0.18 m (high_release);
- SUCCESS_BONUS, once, when the cube has been placed for SETTLE_S (check_success's settle time) and nothing in the
  episode has failed check_success yet (no collision, drop or high release: they fail the episode, so they forfeit
  the bonus); the env ends the episode there. Calibrated on 196 recorded episodes (the note).
The reward only shapes learning. **Success is always the unchanged check_success** on the episode (the env runs it
when an episode ends; the teacher's eval runs it in SANT's eval env), never this reward: shaped rewards get hacked.

**Action.** The teacher acts in the space SANT's trajectories live in: an absolute tool target and a binary gripper,
as teleop, SANT's repairs and replay use. Its rollouts are therefore Trajectories, and SANT's replay -> verify ->
LeRobot export turns them into the ACT student's training data exactly as it does human demos. A policy action is 5
numbers in [-1, 1]: a step of the tool from where it is now, x, y, z (at most DELTA_M each) and yaw (at most
DELTA_YAW, about the vertical, the gripper pointing down as every SANT demo holds it), and the gripper (< 0 closes,
as Isaac Lab's binary gripper action). The target is the tool's current pose plus that step, kept in the WORKSPACE
box and within +-YAW_MAX: an absolute tool target, as SANT's Trajectories hold.

Relative, not absolute (2026-10-21, demo_v1): with absolute targets a new policy's random actions sent the arm across
the workspace on the first step of every episode, so demo starts were thrown away at once and nothing was learned in
300 iterations (no grasp, no lift). A zero action now means "stay", as in Isaac Lab's IK-Rel lift.

Plain operators and a small array shim only, so the same functions run on numpy (tests, recorded episodes) and on
torch (the Isaac Lab env).
"""

from __future__ import annotations

import math
from typing import NamedTuple

import numpy as np

from .scene_geometry import BIN_INNER, BIN_RIM_HEIGHT, BIN_WALL, CUBE_HALF, TABLE_TOP_Z
from .soft_floor import FLOOR_BELOW_RIM, FOOTPRINT_MARGIN
from .success import COLLISION_FORCE_N

# what check_success uses
RELEASE_HEIGHT_MAX = 0.18  # m, the cube's centre above the bin origin when it is let go
SETTLE_SPEED = 0.01  # m/s
SETTLE_S = 0.5
CONTACT_N = 0.1  # sim_worker.replay: a pair below this force is not in contact
STEP_S = 0.02  # 50 Hz, as every SANT episode

# the shaping (Isaac Lab's lift uses reach std 0.1 and lifted at 0.04 m)
REACH_STD = 0.10
CENTRE_STD = 0.01
CARRY_STD, CARRY_FINE_STD = 0.10, 0.03
LIFT_M = 0.04
RIM_CLEAR_M = 0.01  # the held cube's bottom this far above the rim counts as clear of it
POTENTIAL = {"reach": 1.0, "centred_grasp": 2.0, "lifted": 4.0, "carry": 6.0, "carry_fine": 4.0, "rim_clear": 1.0,
             "low_over_bin": 4.0, "placed": 30.0}
PENALTY = {"collision": 1.0, "dropped": 10.0, "high_release": 10.0}  # subtracted; each also forfeits the bonus
FOULS = tuple(PENALTY)
SUCCESS_BONUS = 400.0

# SANT's start pose: the first frame of every SANT training episode (the replay's home, HOME_TCP pointing down), the
# pose SANT's eval and T6's distillation start from. Measured on the 110 verified mouse20261020 episodes (spread
# 1.8 mrad); the RL env's home starts use it, not Isaac Lab's default Franka pose.
HOME_JOINTS = (-0.015617, -0.338396, 0.014439, -2.384963, 0.004375, 2.104908, 0.778867, 0.04, 0.04)

# the action (edit_plan's WORKSPACE, the Franka on SANT's table)
WORKSPACE = {"x": (0.20, 0.80), "y": (-0.45, 0.45), "z": (0.01, 0.50)}
YAW_MAX = math.pi / 2
DELTA_M = 0.02  # m per step: 1 m/s at 50 Hz, the tracking feed-forward's own cap
DELTA_YAW = 0.1  # rad per step
ACTION_DIM = 5
DOWN_WXYZ = (0.0, 1.0, 0.0, 0.0)  # SANT's gripper pointing down (sim_worker.scripted.DOWN_WXYZ)

# The policy's observation, in order (sim_worker/rl_env_cfg.py's PolicyCfg terms; a test pins them): what the env
# reads and what the teacher adapter (sim_worker/rl_policy.py) rebuilds from a TeacherState. Env frame, absolute
# joints; Isaac Lab's quaternions (x y z w); the bin as its origin and the (cos, sin) of its yaw.
OBS_SPEC = (("joint_pos", 9), ("joint_vel", 9), ("tcp_pos", 3), ("tcp_quat", 4), ("cube_pos", 3), ("cube_quat", 4),
            ("bin", 5), ("cube_from_tcp", 3), ("cube_in_bin", 3), ("actions", ACTION_DIM))
OBS_DIM = sum(n for _, n in OBS_SPEC)


def _is_np(a) -> bool:
    return isinstance(a, (np.ndarray, np.generic, float, int, bool))


def _tanh(a):
    return np.tanh(a) if _is_np(a) else a.tanh()


def _norm(a):
    return (a * a).sum(-1) ** 0.5


def _f(b):
    """bool -> float, either library."""
    return b * 1.0


class StepState(NamedTuple):
    """One step of every environment, in the env (= SANT world) frame; arrays [N, ...]."""

    tcp: object  # [N, 3] the tool centre the arm reached
    cube: object  # [N, 3]
    cube_speed: object  # [N]
    cube_in_bin: object  # [N, 3] the cube's centre in the bin frame (origin: the floor's underside)
    closed: object  # [N] bool: the gripper command is closed
    finger_contact: object  # [N] bool: a finger touches the cube (> CONTACT_N)
    arm_contact: object  # [N] bool: the arm touches the bin or the table (> CONTACT_N)
    arm_force: object  # [N] the largest arm-bin/table contact force (N)


def over_bin(cube_in_bin):
    """The cube's centre over the bin's inner footprint (check_success's over_bin)."""
    half_x, half_y = BIN_INNER[0] / 2, BIN_INNER[1] / 2
    return (abs(cube_in_bin[..., 0]) <= half_x + 1e-9) & (abs(cube_in_bin[..., 1]) <= half_y + 1e-9)


def placed(s: StepState):
    """check_success's end state for one step: in the bin's inner box, settled, the gripper open."""
    z = s.cube_in_bin[..., 2]
    inside = over_bin(s.cube_in_bin) & (z >= -1e-9) & (z <= BIN_INNER[2] + 1e-9)
    return inside & (s.cube_speed < SETTLE_SPEED) & ~s.closed


def reward_terms(s: StepState, prev: StepState | None = None) -> dict:
    """Each term per environment (unweighted, 0 or 1 or in between). prev: the step before (None at an episode's
    first step: no drop or release can be seen yet)."""
    held = s.closed & s.finger_contact
    d_reach = _norm(s.tcp - s.cube)
    d_centre = _norm(s.tcp[..., :2] - s.cube[..., :2])
    lifted = held & (s.cube[..., 2] - CUBE_HALF >= LIFT_M)
    d_bin = _norm(s.cube_in_bin[..., :2])
    z_b = s.cube_in_bin[..., 2]
    clear = z_b - CUBE_HALF >= BIN_RIM_HEIGHT + RIM_CLEAR_M
    inside = over_bin(s.cube_in_bin)
    terms = {
        "reach": 1 - _tanh(d_reach / REACH_STD),
        "centred_grasp": _f(held) * (1 - _tanh(d_centre / CENTRE_STD)),
        "lifted": _f(lifted),
        # carrying counts while the cube is clear of the rim, or already over the bin's inside
        "carry": _f(lifted & (clear | inside)) * (1 - _tanh(d_bin / CARRY_STD)),
        "carry_fine": _f(lifted & (clear | inside)) * (1 - _tanh(d_bin / CARRY_FINE_STD)),
        "rim_clear": _f(lifted & clear),
        "low_over_bin": _f(held & inside & (z_b <= RELEASE_HEIGHT_MAX)),
        "placed": _f(placed(s)),
        "collision": _f(s.arm_contact & (s.arm_force > COLLISION_FORCE_N)),
    }
    if prev is None:
        zero = terms["reach"] * 0.0
        terms["dropped"] = zero
        terms["high_release"] = zero
    else:
        lost = prev.finger_contact & ~s.finger_contact
        terms["dropped"] = _f(lost & s.closed & ~inside)
        let_go = prev.closed & ~s.closed & prev.finger_contact
        high = prev.cube_in_bin[..., 2] > RELEASE_HEIGHT_MAX
        terms["high_release"] = _f(let_go & over_bin(prev.cube_in_bin) & high)
    return terms


def potential(terms: dict, weights: dict = POTENTIAL):
    """Phi per environment: the progress terms, weighted."""
    total = terms["reach"] * 0.0
    for k, w in weights.items():
        total = total + w * terms[k]
    return total


def penalty(terms: dict, weights: dict = PENALTY):
    """The step's penalty per environment (a positive number, subtracted)."""
    total = terms["reach"] * 0.0
    for k, w in weights.items():
        total = total + w * terms[k]
    return total


def fouled(terms: dict):
    """The step shows a check_success failure (collision, dropped, high_release): the episode can't succeed."""
    out = terms["collision"] > 0
    for k in FOULS[1:]:
        out = out | (terms[k] > 0)
    return out


# --- the action -------------------------------------------------------------------------------------


def _quat_mul_wxyz(a, b):
    """Row-wise wxyz product, either library (b may be a constant 4-tuple)."""
    aw, ax, ay, az = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bw, bx, by, bz = b
    return (aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw)


def tool_yaw(quat_wxyz):
    """The yaw of SANT's pointing-down tool (wxyz [..., 4], either library): its x axis's heading."""
    w, x, y, z = quat_wxyz[..., 0], quat_wxyz[..., 1], quat_wxyz[..., 2], quat_wxyz[..., 3]
    num, den = 2 * (x * y + w * z), 1 - 2 * (y * y + z * z)
    return np.arctan2(num, den) if _is_np(num) else _torch().atan2(num, den)


def _down_turned(yaw):
    """SANT's pointing-down gripper turned by yaw about the vertical, wxyz [..., 4]."""
    half = yaw / 2
    c, s = (np.cos(half), np.sin(half)) if _is_np(half) else (half.cos(), half.sin())
    zero = half * 0.0
    w, qx, qy, qz = _quat_mul_wxyz(_stack4(c, zero, zero, s), DOWN_WXYZ)  # the yaw turn, then pointing down
    return _stack4(w, qx, qy, qz)


def _clip(v, lo, hi):
    return v.clip(lo, hi) if _is_np(v) else v.clamp(lo, hi)


def action_to_target(a, tcp_pos, tcp_yaw):
    """Policy actions [N, 5] in [-1, 1], the tool's position [N, 3] and yaw [N] now -> (tool targets [N, 3], their
    quaternions wxyz [N, 4], closed [N] bool): the step added to the current pose, kept in WORKSPACE and +-YAW_MAX.
    Out-of-range actions are clipped."""
    a = _clip(a, -1.0, 1.0)
    target = tcp_pos + a[..., :3] * DELTA_M
    x, y, z = (_clip(target[..., i], *WORKSPACE[k]) for i, k in enumerate("xyz"))
    yaw = _clip(tcp_yaw + a[..., 3] * DELTA_YAW, -YAW_MAX, YAW_MAX)
    pos = np.stack([x, y, z], -1) if _is_np(x) else _torch().stack([x, y, z], -1)
    return pos, _down_turned(yaw), a[..., 4] < 0


def gripper_closed(grip, prev_closed, deadband: float = 0.0):
    """The gripper's state after the policy's gripper output [N]: with no deadband, closed when < 0 (Isaac Lab's
    binary gripper). With one, it switches only when the output crosses it: closed below -deadband, open above
    +deadband, else as it was (prev_closed [N] bool), so exploration noise can't flick it open mid-carry."""
    if deadband <= 0:
        return grip < 0
    return (grip < -deadband) | (prev_closed & (grip <= deadband))


def grace_gripper(grip, grace):
    """The gripper action [N] with a held start's grace applied: closed (-1) while grace [N] > 0, else as given. The
    env counts grace down once per step (sim_worker/rl_action.py SantGraceGripperAction)."""
    closed = grip * 0.0 - 1.0
    return closed * (grace > 0) + grip * (grace <= 0)


def target_to_action(target_pos, target_yaw, closed, tcp_pos, tcp_yaw):
    """The inverse (numpy): the action that steps from the tool's pose now to a target (clipped to one step)."""
    d = (np.asarray(target_pos, dtype=np.float64) - np.asarray(tcp_pos, dtype=np.float64)) / DELTA_M
    dyaw = (np.asarray(target_yaw, dtype=np.float64) - np.asarray(tcp_yaw, dtype=np.float64)) / DELTA_YAW
    grip = np.where(np.asarray(closed), -1.0, 1.0)
    return np.clip(np.concatenate([d, dyaw[..., None], grip[..., None]], -1), -1.0, 1.0)


def _stack4(w, x, y, z):
    xs = (w, x, y, z)
    return np.stack(xs, -1) if _is_np(w) else _torch().stack(xs, -1)


def _torch():
    import torch

    return torch


# --- episodes (numpy): the signals check_success reads, and the reward of a recorded episode -----------------


def bin_frame_points(points: np.ndarray, bin_pos, bin_quat_wxyz) -> np.ndarray:
    """World points -> the bin frame (as check_success's _to_bin_frame)."""
    w, x, y, z = bin_quat_wxyz
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return (np.asarray(points) - np.asarray(bin_pos)) @ rot


def episode_states(tcp, cube, gripper, contact_gripper_cube, contact_arm_bin, contact_arm_table, max_contact_force,
                   bin_pos, bin_quat_wxyz) -> list[StepState]:
    """A recorded SANT episode (steps.npz + signals.npz + scene.json) as one StepState per step (N = 1)."""
    cube = np.asarray(cube, dtype=np.float64)
    speed = np.r_[0.0, np.linalg.norm(np.diff(cube, axis=0), axis=1) / STEP_S]
    cube_b = bin_frame_points(cube, bin_pos, bin_quat_wxyz)
    arm = np.asarray(contact_arm_bin) | np.asarray(contact_arm_table)
    return [StepState(tcp=np.asarray(tcp[k:k + 1], dtype=np.float64), cube=cube[k:k + 1], cube_speed=speed[k:k + 1],
                      cube_in_bin=cube_b[k:k + 1], closed=np.asarray(gripper[k:k + 1]) == 1,
                      finger_contact=np.asarray(contact_gripper_cube[k:k + 1], dtype=bool), arm_contact=arm[k:k + 1],
                      arm_force=np.asarray(max_contact_force[k:k + 1], dtype=np.float64)) for k in range(len(cube))]


def episode_return(states: list[StepState]) -> dict:
    """What an RL episode through these states would score, step by step as the env pays it: the potential's
    change, minus the penalties, plus the success bonus when the cube has been placed for SETTLE_S with no foul
    before (the env ends the episode there, so nothing after it counts)."""
    total, phi_prev, prev, still, foul = 0.0, None, None, 0, False
    events = {k: 0 for k in PENALTY}
    bonus_at = None
    for k, s in enumerate(states):
        terms = reward_terms(s, prev)
        phi = float(potential(terms)[0])
        total += (phi - phi_prev if phi_prev is not None else 0.0) - float(penalty(terms)[0])
        for name in PENALTY:
            events[name] += int(terms[name][0] > 0)
        foul = foul or bool(fouled(terms)[0])
        still = still + 1 if bool(terms["placed"][0]) else 0
        phi_prev, prev = phi, s
        if still * STEP_S >= SETTLE_S - 1e-9 and not foul:
            bonus_at = k
            total += SUCCESS_BONUS
            break
    return {"return": total, "success_bonus_at": bonus_at, "fouled": foul, "events": events,
            "steps": len(states) if bonus_at is None else bonus_at + 1}


# --- the soft floor (demo_pipeline.soft_floor, today's single upright bin), either library -----------------------


def _relu(x):
    return (x + abs(x)) * 0.5


def soft_floor_z(pos, bin_pos, bin_yaw):
    """soft_floor.floor_z for many targets at once: inside the bin's outside footprint plus FOOTPRINT_MARGIN,
    FLOOR_BELOW_RIM under its rim; the table top elsewhere. pos, bin_pos [N, 3]; bin_yaw [N] (an upright bin)."""
    c, s = (np.cos(bin_yaw), np.sin(bin_yaw)) if _is_np(bin_yaw) else (bin_yaw.cos(), bin_yaw.sin())
    dx, dy = pos[..., 0] - bin_pos[..., 0], pos[..., 1] - bin_pos[..., 1]
    lx, ly = c * dx + s * dy, -s * dx + c * dy
    hx = BIN_INNER[0] / 2 + BIN_WALL + FOOTPRINT_MARGIN
    hy = BIN_INNER[1] / 2 + BIN_WALL + FOOTPRINT_MARGIN
    inside = (abs(lx) <= hx) & (abs(ly) <= hy)
    rim_floor = bin_pos[..., 2] + BIN_WALL + BIN_INNER[2] - FLOOR_BELOW_RIM
    return TABLE_TOP_Z + _f(inside) * _relu(rim_floor - TABLE_TOP_Z)


def clamp_to_soft_floor(pos, bin_pos, bin_yaw):
    """Targets raised to the soft floor where they are below it (z only), as the sim worker clamps teleop targets."""
    z = pos[..., 2] + _relu(soft_floor_z(pos, bin_pos, bin_yaw) - pos[..., 2])
    return np.stack([pos[..., 0], pos[..., 1], z], -1) if _is_np(z) else _torch().stack([pos[..., 0], pos[..., 1], z], -1)


# --- the observation from a TeacherState (numpy, the adapter's) ------------------------------------------------


def _xyzw(q_wxyz) -> np.ndarray:
    q = np.asarray(q_wxyz, dtype=np.float64)
    return np.r_[q[1:4], q[0]]


def yaw_of_wxyz(q_wxyz) -> float:
    w, x, y, z = (float(v) for v in q_wxyz)
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def policy_observation(state, last_action) -> np.ndarray:
    """The env's policy observation (OBS_SPEC order) from a teacher state: anything with sim_eval.teacher.TeacherState's
    fields (joint_pos, joint_vel, tcp_pos, tcp_quat_wxyz, cube_pos, cube_quat_wxyz, bin_pos, bin_quat_wxyz), env
    frame, wxyz quaternions. last_action: the policy's previous output (zeros after a reset, as the env's)."""
    tcp, cube, bin_pos = (np.asarray(v, dtype=np.float64) for v in (state.tcp_pos, state.cube_pos, state.bin_pos))
    yaw = yaw_of_wxyz(state.bin_quat_wxyz)
    parts = {
        "joint_pos": np.asarray(state.joint_pos, dtype=np.float64), "joint_vel": np.asarray(state.joint_vel, dtype=np.float64),
        "tcp_pos": tcp, "tcp_quat": _xyzw(state.tcp_quat_wxyz), "cube_pos": cube, "cube_quat": _xyzw(state.cube_quat_wxyz),
        "bin": np.r_[bin_pos, math.cos(yaw), math.sin(yaw)], "cube_from_tcp": cube - tcp,
        "cube_in_bin": bin_frame_points(cube[None], bin_pos, state.bin_quat_wxyz)[0],
        "actions": np.asarray(last_action, dtype=np.float64),
    }
    for name, n in OBS_SPEC:
        if parts[name].shape != (n,):
            raise ValueError(f"teacher state's {name} has shape {parts[name].shape}, expected ({n},)")
    return np.concatenate([parts[name] for name, _ in OBS_SPEC])


# --- the "lift" reward preset (2026-10-21, the user's directive): Isaac Lab's stock lift, plus our parts ------------
#
# Level rewards as IsaacContrib-Lift-Cube-Franka pays them (isaaclab_tasks/contrib/lift/lift_env_cfg.py: reaching_object
# line 138 std 0.1 weight 1; lifting_object line 140 minimal_height 0.04 weight 15; object_goal_tracking lines 142-146
# std 0.3 weight 16; object_goal_tracking_fine_grained lines 148-152 std 0.05 weight 5; action_rate line 155 and
# joint_vel lines 157-160 -1e-4, raised to -0.1 over 10,000 steps by its curriculum, lines 180 and 184), with the goal a
# point above the bin (over its centre, the held cube's bottom 2.5 cm clear of the rim and under check_success's
# 0.18 m release height). Ours on top: a placed level term; the foul penalties, which forfeit the bonus; and the success
# bonus, once, exactly when check_success's end state holds for SETTLE_S with nothing fouled, worth LIFT_BONUS_BASE plus
# LIFT_BONUS_RATE (more than the most any step can pay) for every step left in the episode, so finishing always beats
# hovering at the goal until the time limit. One deviation: "lifted" also needs the cube held (closed, a finger on it),
# so a cube knocked onto the bin's wall top never counts as lifted at the goal.
LIFT_HEIGHT = 0.04  # m, the cube's centre above the table (stock minimal_height, line 140)
GOAL_STD, GOAL_FINE_STD = 0.3, 0.05  # stock lines 144 and 150
GOAL_ABOVE_BIN = BIN_RIM_HEIGHT + 0.05  # m above the bin's origin: the held cube's centre (its bottom 2.5 cm over the rim)
LIFT_WEIGHTS = {"reach": 1.0, "lifted": 15.0, "goal": 16.0, "goal_fine": 5.0, "placed": 38.0}  # placed: ours
LIFT_LEVEL_MAX = max(LIFT_WEIGHTS["reach"] + LIFT_WEIGHTS["lifted"] + LIFT_WEIGHTS["goal"] + LIFT_WEIGHTS["goal_fine"],
                     LIFT_WEIGHTS["placed"] + LIFT_WEIGHTS["reach"])  # the most any one step can pay
LIFT_BONUS_BASE = 400.0
LIFT_BONUS_RATE = 1.1 * LIFT_LEVEL_MAX  # per step left in the episode
LIFT_PENALTY = {"collision": 5.0, "dropped": 50.0, "high_release": 50.0}  # each also forfeits the bonus


def lift_level_terms(s: StepState) -> dict:
    """The lift preset's level terms per environment (unweighted)."""
    held = s.closed & s.finger_contact
    lifted = held & (s.cube[..., 2] > LIFT_HEIGHT)
    d_goal = _norm(s.cube_in_bin - _goal_in_bin(s.cube_in_bin))
    return {
        "reach": 1 - _tanh(_norm(s.tcp - s.cube) / REACH_STD),
        "lifted": _f(lifted),
        "goal": _f(lifted) * (1 - _tanh(d_goal / GOAL_STD)),
        "goal_fine": _f(lifted) * (1 - _tanh(d_goal / GOAL_FINE_STD)),
        "placed": _f(placed(s)),
    }


def _goal_in_bin(cube_in_bin):
    """The goal, in the bin's frame, shaped like cube_in_bin: over the bin's centre, GOAL_ABOVE_BIN up."""
    g = cube_in_bin * 0.0
    if _is_np(g):
        g[..., 2] = GOAL_ABOVE_BIN
        return g
    return g + g.new_tensor([0.0, 0.0, GOAL_ABOVE_BIN])


def lift_level(terms: dict):
    total = terms["reach"] * 0.0
    for k, w in LIFT_WEIGHTS.items():
        total = total + w * terms[k]
    return total


def lift_bonus(remaining_steps):
    """The success bonus with remaining_steps left in the episode (see LIFT_BONUS_RATE)."""
    return LIFT_BONUS_BASE + LIFT_BONUS_RATE * remaining_steps


def episode_return_lift(states: list[StepState], max_steps: int = 600) -> dict:
    """What an RL episode through these states would score under the lift preset (before Isaac's dt): the level
    reward each step, minus the foul penalties, plus the success bonus (for the steps left of max_steps) when the cube
    has been placed for SETTLE_S with no foul before; the env ends the episode there."""
    total, prev, still, foul, bonus_at = 0.0, None, 0, False, None
    for k, s in enumerate(states[:max_steps]):
        terms = reward_terms(s, prev)
        total += float(lift_level(lift_level_terms(s))[0]) - float(penalty(terms, LIFT_PENALTY)[0])
        foul = foul or bool(fouled(terms)[0])
        still = still + 1 if bool(terms["placed"][0]) else 0
        prev = s
        if still * STEP_S >= SETTLE_S - 1e-9 and not foul:
            bonus_at = k
            total += float(lift_bonus(max_steps - (k + 1)))
            break
    return {"return": total, "success_bonus_at": bonus_at, "fouled": foul}
