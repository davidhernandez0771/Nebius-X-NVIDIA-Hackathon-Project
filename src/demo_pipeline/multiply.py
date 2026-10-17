"""Multiplier math (spec 8.6): move one perfected demo into new scenes. numpy only.

Up to the grasp the hand path is rigid in the cube's frame; from the release on it is rigid in
the bin's frame. In between (the carry) it follows the new grasp-to-release chord. Only
translation and yaw change between scenes (the table stays flat).
"""

from __future__ import annotations

import math
from typing import NamedTuple

import numpy as np

from .measure import gripper_events
from .repair import _slerp
from .schemas import Pose, RobotName, Scene, Trajectory

LIFT_S = 1.0  # degrade's grasp offset fades out from this long after the first close
MIN_CHORD = 1e-3  # m; a grasp and release closer than this leave no carry to map


class SceneRanges(NamedTuple):
    """Uniform sampling ranges for one robot's scenes (m, rad; world frame, robot base at the origin)."""

    cube_x: tuple[float, float]
    cube_y: tuple[float, float]
    cube_yaw: tuple[float, float]
    bin_x: tuple[float, float]
    bin_y: tuple[float, float]


_FRANKA = SceneRanges(cube_x=(0.40, 0.60), cube_y=(-0.20, 0.20), cube_yaw=(-math.pi / 2, math.pi / 2),
                      bin_x=(0.40, 0.65), bin_y=(-0.30, 0.30))  # spec 8.6; confirmed reachable by T2 (2026-10-16)
# The other arms' ranges are fitted on T2's measured runs (T1 status note, sprint 3c Task 1): each axis
# spans the observed successes +-0.02 m, rounded outward to the cm and clipped to the tested (Franka) ranges.
SCENE_RANGES: dict[RobotName, SceneRanges] = {
    "franka": _FRANKA,
    # 17 successes over the whole Franka range except bins below y -0.224, where all 4 scripted runs failed
    # unreachable. Elsewhere the failures are grip drag, not place: the same scene both failed and succeeded.
    "flexiv": _FRANKA._replace(bin_y=(-0.25, 0.30)),
    # Only 2 of 30 scripted runs succeeded (lift_z 0.18; at 0.25 none do): the ranges are the small box around
    # them, which excludes all 28 unreachable failures. The +-45 deg wrist allows no more (T2 note, Task 5).
    "openarm": _FRANKA._replace(cube_x=(0.40, 0.59), cube_y=(-0.20, -0.17), bin_x=(0.40, 0.52), bin_y=(0.10, 0.16)),
}
CUBE_X, CUBE_Y, CUBE_YAW = _FRANKA.cube_x, _FRANKA.cube_y, _FRANKA.cube_yaw  # the Franka's, for older callers
BIN_X, BIN_Y = _FRANKA.bin_x, _FRANKA.bin_y
CUBE_HALF, BIN_HALF = 0.025, 0.11  # m, footprint half-sizes
MIN_EDGE_GAP = 0.15  # m between the cube's and the bin's footprints
CUBE_Z, BIN_Z = 0.025, 0.0
MAX_SAMPLE_TRIES = 10_000


def _yaw(q) -> float:
    w, x, y, z = q
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def _yaw_quat(yaw: float) -> tuple[float, float, float, float]:
    return (math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2))


def _quat_mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """a (4,) times each row of b ([N, 4]), wxyz."""
    w1, x1, y1, z1 = a
    w2, x2, y2, z2 = b.T
    return np.stack([
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
    ], axis=1)


def _move_with(src: Pose, dst: Pose, pos: np.ndarray, quat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Carry poses rigidly along with an object moving from src to dst (translation + yaw)."""
    dyaw = _yaw(dst.quat_wxyz) - _yaw(src.quat_wxyz)
    c, s = math.cos(dyaw), math.sin(dyaw)
    rel = pos - np.asarray(src.pos)
    moved = np.stack([c * rel[:, 0] - s * rel[:, 1], s * rel[:, 0] + c * rel[:, 1], rel[:, 2]], axis=1) + np.asarray(dst.pos)
    return moved, _quat_mul(np.asarray(_yaw_quat(dyaw)), quat)


def _chord_map(x: np.ndarray, a: np.ndarray, b: np.ndarray, a2: np.ndarray, b2: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Map points from the chord a->b onto a2->b2: progress along the chord (xy) scales with the
    chord's length, sideways and vertical offsets from it are kept (turned with the chord's heading).
    Returns the mapped points and each point's progress u (0 at a, 1 at b)."""
    d, d2 = (b - a)[:2], (b2 - a2)[:2]
    L, L2 = float(np.linalg.norm(d)), float(np.linalg.norm(d2))
    if L < MIN_CHORD or L2 < MIN_CHORD:
        raise ValueError(f"the grasp and the release are {min(L, L2) * 1000:.1f} mm apart, so there is no carry to map")
    e, e2 = d / L, d2 / L2
    n, n2 = np.array([-e[1], e[0]]), np.array([-e2[1], e2[0]])
    r = x - a
    u = (r[:, :2] @ e) / L
    side = r[:, :2] @ n
    xy = a2[:2] + np.outer(u * L2, e2) + np.outer(side, n2)
    z = a2[2] + r[:, 2] + u * ((b2[2] - a2[2]) - (b[2] - a[2]))
    return np.column_stack([xy, z]), u


def transform_trajectory(traj: Trajectory, src: Scene, dst: Scene) -> Trajectory:
    """The demo as it would be in dst. Through the grasp the hand is rigid in the cube's frame, from
    the release on in the bin's; the carry between them (lift, move, descent) is re-planned along
    the new grasp-to-release chord, keeping the source's timing and its sideways and vertical shape.

    The handover is at the gripper events, where the hand is at the grasp or release point, so the
    path is continuous. A fixed-time handover (1.0 s + 0.5 s after the close) swung every variant
    to the source cube's place relative to the new bin, past the Franka's reach for bins on the -y
    side (T2 status note, 2026-10-16, Task 4). With no release, the carry runs to the last step.
    """
    t_close, t_open = gripper_events(traj)
    if t_close is None:
        raise ValueError("the demo never closes the gripper, so it has no grasp to transform")
    a = traj.to_arrays()
    t, pos = a["t"], a["ee_pos"]
    i_close = int(np.argmin(np.abs(t - t_close)))
    i_open = len(t) - 1 if t_open is None else int(np.argmin(np.abs(t - t_open)))
    p_cube, q_cube = _move_with(src.cube_pose, dst.cube_pose, pos, a["ee_quat"])
    p_bin, q_bin = _move_with(src.bin_pose, dst.bin_pose, pos, a["ee_quat"])
    p_carry, u = _chord_map(pos, pos[i_close], pos[i_open], p_cube[i_close], p_bin[i_open])
    idx = np.arange(len(t))
    before, after = idx < i_close, idx >= i_open
    if t_open is None:
        after[:] = False
    out = np.where(before[:, None], p_cube, np.where(after[:, None], p_bin, p_carry))
    s = np.clip(u, 0.0, 1.0)
    b = np.where(before, 0.0, np.where(after, 1.0, 10 * s**3 - 15 * s**4 + 6 * s**5))
    quat = np.where((b == 0)[:, None], q_cube, np.where((b == 1)[:, None], q_bin, _slerp(q_cube, q_bin, b)))
    return Trajectory.from_arrays(t, out, quat, a["gripper"])


def _edge_gap(cube_xy, cube_yaw: float, bin_xy) -> float:
    """Distance between the cube's (yawed, so its axis-aligned bound) and the bin's footprints."""
    reach = CUBE_HALF * (abs(math.cos(cube_yaw)) + abs(math.sin(cube_yaw))) + BIN_HALF
    gx = max(abs(cube_xy[0] - bin_xy[0]) - reach, 0.0)
    gy = max(abs(cube_xy[1] - bin_xy[1]) - reach, 0.0)
    return math.hypot(gx, gy)


def sample_scene(rng: np.random.Generator, robot: RobotName, seed: int) -> Scene:
    """A random scene in the robot's SCENE_RANGES, rejection-sampled until the cube and bin are 0.15 m apart."""
    r = SCENE_RANGES.get(robot)
    if r is None:
        raise ValueError(f"no scene sampling ranges for robot {robot!r} (have: {', '.join(SCENE_RANGES)})")
    for _ in range(MAX_SAMPLE_TRIES):
        cube_xy = (float(rng.uniform(*r.cube_x)), float(rng.uniform(*r.cube_y)))
        yaw = float(rng.uniform(*r.cube_yaw))
        bin_xy = (float(rng.uniform(*r.bin_x)), float(rng.uniform(*r.bin_y)))
        if _edge_gap(cube_xy, yaw, bin_xy) >= MIN_EDGE_GAP:
            return Scene(
                cube_pose=Pose(pos=(*cube_xy, CUBE_Z), quat_wxyz=_yaw_quat(yaw)),
                bin_pose=Pose(pos=(*bin_xy, BIN_Z), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                robot=robot,
                seed=seed,
            )
    raise RuntimeError(f"no {robot} scene with a {MIN_EDGE_GAP} m cube-bin gap in {MAX_SAMPLE_TRIES} tries")
