"""Multiplier math (spec 8.6): move one perfected demo into new scenes. numpy only.

Up to the end of the lift the hand path is rigid in the cube's frame; from then on it is rigid
in the bin's frame. Only translation and yaw change between scenes (the table stays flat).
"""

from __future__ import annotations

import math

import numpy as np

from .measure import gripper_events
from .repair import _slerp
from .schemas import Pose, RobotName, Scene, Trajectory

LIFT_S = 1.0  # the lift ends this long after the first close
BLEND_S = 0.5  # minimum-jerk blend from the cube-relative to the bin-relative part

CUBE_X, CUBE_Y, CUBE_YAW = (0.40, 0.60), (-0.20, 0.20), (-math.pi / 2, math.pi / 2)
BIN_X, BIN_Y = (0.40, 0.65), (-0.30, 0.30)
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


def transform_trajectory(traj: Trajectory, src: Scene, dst: Scene) -> Trajectory:
    """The demo as it would be in dst: cube-relative through the lift, bin-relative after, min-jerk blend between."""
    t_close, _ = gripper_events(traj)
    if t_close is None:
        raise ValueError("the demo never closes the gripper, so it has no grasp to transform")
    a = traj.to_arrays()
    t = a["t"]
    p_cube, q_cube = _move_with(src.cube_pose, dst.cube_pose, a["ee_pos"], a["ee_quat"])
    p_bin, q_bin = _move_with(src.bin_pose, dst.bin_pose, a["ee_pos"], a["ee_quat"])
    s = np.clip((t - (t_close + LIFT_S)) / BLEND_S, 0.0, 1.0)
    b = 10 * s**3 - 15 * s**4 + 6 * s**5
    pos = (1 - b)[:, None] * p_cube + b[:, None] * p_bin
    quat = np.where((b == 0)[:, None], q_cube, np.where((b == 1)[:, None], q_bin, _slerp(q_cube, q_bin, b)))
    return Trajectory.from_arrays(t, pos, quat, a["gripper"])


def _edge_gap(cube_xy, cube_yaw: float, bin_xy) -> float:
    """Distance between the cube's (yawed, so its axis-aligned bound) and the bin's footprints."""
    reach = CUBE_HALF * (abs(math.cos(cube_yaw)) + abs(math.sin(cube_yaw))) + BIN_HALF
    gx = max(abs(cube_xy[0] - bin_xy[0]) - reach, 0.0)
    gy = max(abs(cube_xy[1] - bin_xy[1]) - reach, 0.0)
    return math.hypot(gx, gy)


def sample_scene(rng: np.random.Generator, robot: RobotName, seed: int) -> Scene:
    """A random scene in the spec 8.6 ranges, rejection-sampled until the cube and bin are 0.15 m apart."""
    for _ in range(MAX_SAMPLE_TRIES):
        cube_xy = (float(rng.uniform(*CUBE_X)), float(rng.uniform(*CUBE_Y)))
        yaw = float(rng.uniform(*CUBE_YAW))
        bin_xy = (float(rng.uniform(*BIN_X)), float(rng.uniform(*BIN_Y)))
        if _edge_gap(cube_xy, yaw, bin_xy) >= MIN_EDGE_GAP:
            return Scene(
                cube_pose=Pose(pos=(*cube_xy, CUBE_Z), quat_wxyz=_yaw_quat(yaw)),
                bin_pose=Pose(pos=(*bin_xy, BIN_Z), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                robot=robot,
                seed=seed,
            )
    raise RuntimeError(f"no scene with a {MIN_EDGE_GAP} m cube-bin gap in {MAX_SAMPLE_TRIES} tries")
