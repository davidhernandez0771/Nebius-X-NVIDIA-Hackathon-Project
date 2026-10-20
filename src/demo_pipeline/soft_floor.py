"""The soft floor: a record-time safety limit on the teleop target (on by default; the Record page's "soft floor").

Live webcam demos pressed the gripper into the bin at 75-927 N (9 of 10): the person can't feel the arm push. So
while recording, the tool target the sim worker applies can't go lower than:
  - FLOOR_BELOW_RIM under the bin's rim inside the bin's footprint (widened by FOOTPRINT_MARGIN, so fingers that
    straddle a wall also stop at the rim), or
  - the table top everywhere else.
The heights come from scene_geometry and the scene's bin pose; nothing is per demo. The target is the tool point
(the fingertip centre, sim_worker.robots tcp_offset), in the env frame (metres, z up). A held cube can still be
placed: its centre is then ~1 cm under the rim, well below check_success's 0.18 m high-release limit.

Demos recorded with it carry Demo.assist (soft_floor, and how many recorded steps it held the target), so
assisted demos stay labelled. Pure numpy: no Isaac.
"""

from __future__ import annotations

import numpy as np

from .schemas import Pose
from .scene_geometry import BIN_FOOTPRINT_HALF, BIN_RIM_HEIGHT, TABLE_TOP_Z

FLOOR_BELOW_RIM = 0.01  # m: the target may go this far under the rim inside the bin
FOOTPRINT_MARGIN = 0.02  # m: the finger pads' half width and a little more, around the bin's outside


def _rotation(quat_wxyz) -> np.ndarray:
    w, x, y, z = quat_wxyz
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def floor_z(pos, bin_pose: Pose) -> float:
    """The lowest target z allowed at this x, y (the z of `pos` is ignored)."""
    rot = _rotation(bin_pose.quat_wxyz)
    origin = np.asarray(bin_pose.pos, dtype=float)
    local = (np.asarray(pos, dtype=float) - origin) @ rot  # world -> bin frame
    half = BIN_FOOTPRINT_HALF + FOOTPRINT_MARGIN
    if abs(local[0]) <= half and abs(local[1]) <= half:
        rim = origin + rot @ np.array([0.0, 0.0, BIN_RIM_HEIGHT])
        return float(rim[2] - FLOOR_BELOW_RIM)
    return TABLE_TOP_Z


def clamp_to_floor(pos, bin_pose: Pose) -> tuple[tuple[float, float, float], bool]:
    """The target raised to the floor if it is below it, and whether it was."""
    p = [float(v) for v in pos]
    floor = floor_z(p, bin_pose)
    if p[2] >= floor:
        return (p[0], p[1], p[2]), False
    return (p[0], p[1], floor), True
