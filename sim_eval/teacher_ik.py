"""How a teacher's tool target becomes joint targets: the RL teacher's own tracking, in numpy. Pure (no Isaac, no torch).

T3's RL env (pm/rl-teacher: sim_worker/rl_action.py on sim_worker/mimic_tracking.py) drives the arm with Isaac Lab's
absolute DifferentialInverseKinematicsAction on the tool frame (panda_hand + the TCP offset as body_offset) plus SANT's
joint velocity feed-forward:
- once per 50 Hz step (process_actions): the feed-forward joint velocities, one damped-least-squares solve of the twist
  from the previous command to this one over the step (0.02 s), the twist clamped to 1 m/s and 3 rad/s; none on the
  first step after a reset;
- at every physics substep (apply_actions, twice per step): one damped-least-squares IK step from the current joints
  toward the commanded tool pose, as the position target; the feed-forward as the velocity target.
Our distill env (sim_eval/isaac_distill_env.py) executes teacher commands with exactly this, so the teacher behaves as
in its training env (the 50-scene gate then measures transfer to our scene, not a different controller). These are the
same formulas as Isaac Lab 3.0's (controllers/differential_ik.py "dls", utils/math.compute_pose_error "axis_angle",
envs/mdp/actions/task_space_actions._compute_frame_jacobian), checked against finite differences in the tests.

Frames: everything here is in the robot root frame; quaternions are wxyz (Isaac Lab 3.0's own tensors are xyzw).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

LAMBDA = 0.01  # DifferentialIKControllerCfg's "dls" default, which T3's env keeps
MAX_FF_SPEED = 1.0  # m/s, SantTrackingIKActionCfg.max_ff_speed
MAX_FF_ANG_SPEED = 3.0  # rad/s, SantTrackingIKActionCfg.max_ff_ang_speed
STEP_DT = 0.02  # s: physics 0.01 x decimation 2
_EPS = 1e-9


def quat_mul(a, b) -> np.ndarray:
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return np.array([aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw])


def quat_conj(q) -> np.ndarray:
    return np.array([q[0], -q[1], -q[2], -q[3]], dtype=np.float64)


def quat_rotate(q, v) -> np.ndarray:
    return quat_mul(quat_mul(q, np.r_[0.0, v]), quat_conj(q))[1:]


def axis_angle_from_quat(q, eps: float = 1e-6) -> np.ndarray:
    """isaaclab.utils.math.axis_angle_from_quat, wxyz: the shorter way round (w >= 0 first)."""
    q = np.asarray(q, dtype=np.float64)
    if q[0] < 0:
        q = -q
    mag = float(np.linalg.norm(q[1:]))
    half = np.arctan2(mag, q[0])
    angle = 2.0 * half
    s = np.sin(half) / angle if abs(angle) > eps else 0.5 - angle * angle / 48
    return q[1:] / s


def pose_error(pos, quat, pos_des, quat_des) -> np.ndarray:
    """compute_pose_error(..., "axis_angle"): (target - current position, axis-angle of q_des * q^-1), shape (6,)."""
    q = np.asarray(quat, dtype=np.float64)
    q_inv = quat_conj(q) / float(q @ q)
    return np.r_[np.asarray(pos_des, dtype=np.float64) - pos, axis_angle_from_quat(quat_mul(quat_des, q_inv))]


def tool_pose(hand_pos, hand_quat, offset) -> tuple[np.ndarray, np.ndarray]:
    """combine_frame_transforms(hand, (offset, identity)): the tool point and its (= the hand's) orientation."""
    return np.asarray(hand_pos, dtype=np.float64) + quat_rotate(hand_quat, offset), np.asarray(hand_quat, dtype=float)


def tool_jacobian(hand_jacobian, hand_quat, offset) -> np.ndarray:
    """_compute_frame_jacobian: the hand's geometric Jacobian [6, J] moved to the tool point (v += w x r)."""
    j = np.array(hand_jacobian, dtype=np.float64, copy=True)
    r = quat_rotate(hand_quat, offset)
    j[:3] += np.cross(j[3:].T, r).T
    return j


def dls(jacobian, error, lam: float = LAMBDA) -> np.ndarray:
    """One damped-least-squares step: J^T (J J^T + lam^2 I)^-1 e."""
    j = np.asarray(jacobian, dtype=np.float64)
    return j.T @ np.linalg.solve(j @ j.T + lam**2 * np.eye(j.shape[0]), np.asarray(error, dtype=np.float64))


def ik_target(arm_q, jacobian, pos, quat, pos_des, quat_des, lam: float = LAMBDA) -> np.ndarray:
    """DifferentialIKController.compute ("pose", absolute, "dls", no joint-limit term): the arm's position target."""
    return np.asarray(arm_q, dtype=np.float64) + dls(jacobian, pose_error(pos, quat, pos_des, quat_des), lam)


def feedforward(prev_pos, prev_quat, pos, quat, jacobian, *, dt: float = STEP_DT, lam: float = LAMBDA,
                max_lin: float = MAX_FF_SPEED, max_ang: float = MAX_FF_ANG_SPEED) -> np.ndarray:
    """mimic_tracking.feedforward_joint_vel: the joint velocities moving the tool from the previous command to this
    one in one step, the twist scaled down to max_lin / max_ang."""
    err = pose_error(prev_pos, prev_quat, pos, quat)
    lin, ang = err[:3] / dt, err[3:] / dt
    scale = min(1.0, max_lin / max(float(np.linalg.norm(lin)), _EPS), max_ang / max(float(np.linalg.norm(ang)), _EPS))
    return dls(jacobian, np.r_[lin, ang] * scale, lam)


@dataclass
class TeacherTracker:
    """The per-episode state of the teacher's tracking: the previous command, for the feed-forward."""

    prev: tuple[np.ndarray, np.ndarray] | None = field(default=None)

    def reset(self) -> None:
        self.prev = None

    def command(self, pos, quat, jacobian) -> np.ndarray:
        """Called once per step with the new tool command (root frame) and the current tool Jacobian: the
        feed-forward joint velocities for this step (zeros on the first step after a reset)."""
        pos, quat = np.asarray(pos, dtype=np.float64), np.asarray(quat, dtype=np.float64)
        ff = (np.zeros(np.asarray(jacobian).shape[1]) if self.prev is None
              else feedforward(self.prev[0], self.prev[1], pos, quat, jacobian))
        self.prev = (pos, quat)
        return ff
