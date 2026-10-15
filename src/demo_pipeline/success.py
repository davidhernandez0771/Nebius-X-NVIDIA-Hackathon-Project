"""Verifier success check (spec 8.5): did a replayed demo put the cube in the bin, cleanly?"""

from __future__ import annotations

import numpy as np

from .schemas import Pose, SimSignals, Trajectory, VerificationResult

_EPS = 1e-9


def _to_bin_frame(points: np.ndarray, bin_pose: Pose) -> np.ndarray:
    """World points [N, 3] -> bin frame (rotate by the inverse of the bin's wxyz quaternion)."""
    w, x, y, z = bin_pose.quat_wxyz
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return (points - np.asarray(bin_pose.pos)) @ rot  # row-vector form of rot.T @ p


def _settle_time(t: np.ndarray, cube_pos: np.ndarray, settle_speed: float) -> float:
    """Seconds the cube has been below settle_speed at the end of the demo."""
    speed = np.linalg.norm(np.diff(cube_pos, axis=0), axis=1) / np.diff(t)
    moving = np.flatnonzero(speed >= settle_speed)
    start = 0 if moving.size == 0 else moving[-1] + 1
    return float(t[-1] - t[start])


def check_success(
    traj: Trajectory,
    sim: SimSignals,
    bin_pose: Pose,
    bin_inner: tuple[float, float, float] = (0.20, 0.20, 0.08),
    time_limit: float = 30.0,
    settle_speed: float = 0.01,
    settle_s: float = 0.5,
    force_limit: float = 5.0,
) -> VerificationResult:
    arr = traj.to_arrays()
    t, ee, grip = arr["t"], arr["ee_pos"], arr["gripper"]
    if sim.n_steps != len(t):
        raise ValueError(f"SimSignals has {sim.n_steps} steps but the trajectory has {len(t)}")
    half_x, half_y, height = bin_inner[0] / 2, bin_inner[1] / 2, bin_inner[2]

    cube_b = _to_bin_frame(sim.cube_pos, bin_pose)
    over_bin = (np.abs(cube_b[:, 0]) <= half_x + _EPS) & (np.abs(cube_b[:, 1]) <= half_y + _EPS)
    in_bin = over_bin[-1] and -_EPS <= cube_b[-1, 2] <= height + _EPS

    settle_time = _settle_time(t, sim.cube_pos, settle_speed)
    arm_contact = sim.contact_arm_bin | sim.contact_arm_table
    lost = sim.contact_gripper_cube[:-1] & ~sim.contact_gripper_cube[1:]
    dropped = lost & (grip[1:] == 1) & ~over_bin[1:]

    reasons = []
    if not in_bin:
        reasons.append("not_in_bin")
    if grip[-1] != 0:
        reasons.append("gripper_closed")
    if settle_time < settle_s - _EPS:
        reasons.append("not_settled")
    if traj.duration > time_limit + _EPS:
        reasons.append("too_slow")
    if np.any(arm_contact & (sim.max_contact_force > force_limit)):
        reasons.append("collision")
    if np.any(dropped):
        reasons.append("dropped")

    return VerificationResult(
        success=not reasons,
        reasons=reasons,
        duration=traj.duration,
        path_length=float(np.linalg.norm(np.diff(ee, axis=0), axis=1).sum()),
        max_contact_force=float(sim.max_contact_force.max(initial=0.0)),
        settle_time=settle_time,
    )
