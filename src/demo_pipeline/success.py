"""Verifier success check (spec 8.5): did a replayed demo put the cube in the bin, cleanly?

Reason codes: not_in_bin, gripper_closed, not_settled, too_slow, collision, dropped,
unreachable (the arm could not follow the commanded pose: IK residual > 2 cm for > 1 s; needs tcp_error), and
high_release (the gripper let go of the cube over the bin with the cube's center > 0.18 m above the bin origin: it
fell in rather than being placed. The scripted expert opens at 0.10 m; opening at the 0.25 m carry height is the
sprint 5 bad_release. A cube that lands in the bin passes in_bin, so only this catches it).
"""

from __future__ import annotations

import numpy as np

from .schemas import Pose, SimSignals, Trajectory, VerificationResult

_EPS = 1e-9
COLLISION_FORCE_N = 5.0  # arm (incl. gripper) contact with the bin or table above this is a collision


def _to_bin_frame(points: np.ndarray, bin_pose: Pose) -> np.ndarray:
    """World points [N, 3] -> bin frame (rotate by the inverse of the bin's wxyz quaternion)."""
    w, x, y, z = bin_pose.quat_wxyz
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return (points - np.asarray(bin_pose.pos)) @ rot  # row-vector form of rot.T @ p


def _longest_run_s(t: np.ndarray, mask: np.ndarray) -> float:
    """Duration of the longest run of consecutive True steps, counting each step as one sample period."""
    if not mask.any():
        return 0.0
    edges = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    longest = int((np.flatnonzero(edges == -1) - np.flatnonzero(edges == 1)).max())
    return longest * float(np.median(np.diff(t)))


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
    force_limit: float = COLLISION_FORCE_N,
    tcp_error: np.ndarray | None = None,
    unreachable_tol: float = 0.02,
    unreachable_s: float = 1.0,
    release_height_max: float = 0.18,
) -> VerificationResult:
    """tcp_error: optional per-step distance (m) between the commanded and the reached tool point."""
    arr = traj.to_arrays()
    t, ee, grip = arr["t"], arr["ee_pos"], arr["gripper"]
    if sim.n_steps != len(t):
        raise ValueError(f"SimSignals has {sim.n_steps} steps but the trajectory has {len(t)}")
    if tcp_error is not None and np.shape(tcp_error) != (len(t),):
        raise ValueError(f"tcp_error has shape {np.shape(tcp_error)} but the trajectory has {len(t)} steps")
    half_x, half_y, height = bin_inner[0] / 2, bin_inner[1] / 2, bin_inner[2]

    cube_b = _to_bin_frame(sim.cube_pos, bin_pose)
    over_bin = (np.abs(cube_b[:, 0]) <= half_x + _EPS) & (np.abs(cube_b[:, 1]) <= half_y + _EPS)
    in_bin = over_bin[-1] and -_EPS <= cube_b[-1, 2] <= height + _EPS

    settle_time = _settle_time(t, sim.cube_pos, settle_speed)
    arm_contact = sim.contact_arm_bin | sim.contact_arm_table
    lost = sim.contact_gripper_cube[:-1] & ~sim.contact_gripper_cube[1:]
    dropped = lost & (grip[1:] == 1) & ~over_bin[1:]
    # the step before each opening, with the cube still in the fingers
    released = (grip[:-1] == 1) & (grip[1:] == 0) & sim.contact_gripper_cube[:-1]
    high_release = released & over_bin[:-1] & (cube_b[:-1, 2] > release_height_max + _EPS)

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
    if np.any(high_release):
        reasons.append("high_release")
    if tcp_error is not None and _longest_run_s(t, np.asarray(tcp_error) > unreachable_tol) > unreachable_s + _EPS:
        reasons.append("unreachable")

    return VerificationResult(
        success=not reasons,
        reasons=reasons,
        duration=traj.duration,
        path_length=float(np.linalg.norm(np.diff(ee, axis=0), axis=1).sum()),
        max_contact_force=float(sim.max_contact_force.max(initial=0.0)),
        settle_time=settle_time,
    )
