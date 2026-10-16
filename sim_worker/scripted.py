"""Scripted expert: a clean pick-place Trajectory computed from the Scene alone (no sim).

ee_pos is the gripper's tool-center point (between the fingertips), world frame; ee_quat is wxyz.
"""

from __future__ import annotations

import math

import numpy as np

from demo_pipeline.schemas import Scene, Trajectory

DOWN_WXYZ = np.array([0.0, 1.0, 0.0, 0.0])  # gripper pointing down
SPEED = 0.15  # m/s, average over each move
MIN_MOVE_S = 0.4
HOLD_S = 0.5
ABOVE_CUBE = 0.15
LIFT_Z = 0.25
RELEASE_ABOVE_FLOOR = 0.10
RETREAT_UP = 0.15
MIN_LIFT_Z = 0.145  # held cube's bottom (z - 0.025) clears the 0.09 m bin rim by 3 cm


def _yaw_of(q_wxyz) -> float:
    w, x, y, z = q_wxyz
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def _down_with_yaw(yaw: float) -> np.ndarray:
    """yaw about world z, applied after DOWN: (cos, 0, 0, sin) * (0, 1, 0, 0)."""
    return np.array([0.0, math.cos(yaw / 2), math.sin(yaw / 2), 0.0])


def _slerp(q0: np.ndarray, q1: np.ndarray, s: np.ndarray) -> np.ndarray:
    if q0 @ q1 < 0:
        q1 = -q1
    dot = min(float(q0 @ q1), 1.0)
    theta = math.acos(dot)
    if theta < 1e-9:
        return np.tile(q0, (len(s), 1))
    s = s[:, None]
    return (np.sin((1 - s) * theta) * q0 + np.sin(s * theta) * q1) / math.sin(theta)


def _min_jerk(tau: np.ndarray) -> np.ndarray:
    return 10 * tau**3 - 15 * tau**4 + 6 * tau**5


def scripted_expert(scene: Scene, rate_hz: int = 50, hold_s: float = HOLD_S, lift_z: float = LIFT_Z) -> Trajectory:
    """hold_s: how long the hand waits at the close and at the open (0.15 is closer to human demos).
    lift_z: carry and retreat height (0.18 keeps the OpenArm's top-down grasp in reach; see the T2 note)."""
    if lift_z < MIN_LIFT_Z:
        raise ValueError(f"lift_z {lift_z} m would drag the cube through the bin rim (min {MIN_LIFT_Z} m)")
    dt = 1.0 / rate_hz
    cube = np.asarray(scene.cube_pose.pos, dtype=float)
    bin_c = np.asarray(scene.bin_pose.pos, dtype=float)
    # The cube looks the same every 90 degrees: turn the wrist at most 45.
    yaw = _yaw_of(scene.cube_pose.quat_wxyz)
    yaw -= (math.pi / 2) * round(yaw / (math.pi / 2))
    q_grasp = _down_with_yaw(yaw)

    above_cube = cube + [0, 0, ABOVE_CUBE]
    lifted = np.array([cube[0], cube[1], lift_z])
    above_bin = np.array([bin_c[0], bin_c[1], lift_z])
    release = bin_c + [0, 0, RELEASE_ABOVE_FLOOR]
    retreat = np.array([release[0], release[1], lift_z])  # = release + RETREAT_UP at the default height

    # (target pos, target quat, gripper during this segment, hold seconds or None for a move)
    plan = [
        (cube, q_grasp, 0, None),            # 2. descend to cube center
        (cube, q_grasp, 1, hold_s),          # 3. close
        (lifted, DOWN_WXYZ, 1, None),        # 4. lift
        (above_bin, DOWN_WXYZ, 1, None),     # 5. above the bin
        (release, DOWN_WXYZ, 1, None),       # 6. descend
        (release, DOWN_WXYZ, 0, hold_s),     # 7. open
        (retreat, DOWN_WXYZ, 0, None),       # 8. retreat
    ]

    pos, quat, grip = [above_cube], [q_grasp], [0]  # 1. start above the cube
    p0, q0 = above_cube, q_grasp
    for p1, q1, g, hold in plan:
        span = hold if hold is not None else max(np.linalg.norm(p1 - p0) / SPEED, MIN_MOVE_S)
        n = max(1, math.ceil(span * rate_hz - 1e-9))
        s = _min_jerk(np.arange(1, n + 1) / n)
        pos.extend(p0 + s[:, None] * (p1 - p0))
        quat.extend(_slerp(q0, q1, s))
        # the gripper value applies from the segment's first sample: the event happens at p0
        grip[-1] = g
        grip.extend([g] * n)
        p0, q0 = p1, q1

    t = np.arange(len(pos)) * dt
    q = np.asarray(quat)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    return Trajectory.from_arrays(t, np.asarray(pos), q, grip)
