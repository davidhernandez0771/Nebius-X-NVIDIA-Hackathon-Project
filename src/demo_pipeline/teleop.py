"""Webcam teleop: hand measurements from the browser -> end-effector target pose + gripper (spec 8.1).

The browser (web/src/teleop/handPoseMessage.ts) sends one `HandPoseMsg` per tracked
frame; the backend relays it unchanged; the sim worker calls `to_ee_target()` and a
`GripperLatch` on every message. JSON field names are identical in Python and TS.

Image conventions: `wrist_uv` is raw (unmirrored) MediaPipe normalized coordinates,
u left->right, v top->bottom. The user watches a mirrored view, so u is mirrored here.
The optional `control` is the browser's control-region mapping of the palm center, in the
same raw orientation; when present it replaces the image-region and palm-width fractions.
Robot conventions: Isaac Lab world frame, Z-up, meters, quaternions (w, x, y, z).
"""

from __future__ import annotations

import math

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .schemas import Pose

GRIPPER_DOWN_WXYZ = (0.0, 1.0, 0.0, 0.0)  # 180 deg about world x: gripper z-axis points down


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class HandPoseMsg(_Model):
    """One hand measurement from the browser. When tracking_ok is false, the other fields are stale or 0."""

    t_ms: float = Field(ge=0)  # performance.now()
    tracking_ok: bool
    wrist_uv: tuple[float, float]  # landmark 0, raw normalized image coords in [0, 1]
    palm_width: float = Field(ge=0)  # |lm5 - lm17| in px / frame_w
    pinch_ratio: float = Field(ge=0)  # |lm4 - lm8| in px / palm width in px
    yaw_rad: float = Field(ge=-math.pi, le=math.pi)  # atan2(dx, -dy) of lm0 -> lm9 in px; up = 0, raw right = +pi/2
    frame_w: int = Field(gt=0)
    frame_h: int = Field(gt=0)
    # Optional (web/src/teleop/controlRegion.ts): the palm center remapped into the user's control
    # region and clamped, raw unmirrored like wrist_uv, plus depth from palm width (0 far, 1 near).
    control: tuple[float, float, float] | None = None

    @model_validator(mode="after")
    def _ranges(self) -> "HandPoseMsg":
        if not all(0.0 <= c <= 1.0 for c in self.wrist_uv):
            raise ValueError(f"wrist_uv must lie in [0, 1], got {self.wrist_uv}")
        if self.control is not None and not all(0.0 <= c <= 1.0 for c in self.control):
            raise ValueError(f"control must lie in [0, 1], got {self.control}")
        if self.tracking_ok and self.palm_width <= 0:
            raise ValueError("palm_width must be > 0 while tracking_ok")
        return self


class Calibration(_Model):
    """Image region and palm-width range -> robot workspace. Tuned in the first live session."""

    u_min: float = 0.2
    u_max: float = 0.8
    v_min: float = 0.15
    v_max: float = 0.85
    palm_far: float = 0.06  # hand far from the camera -> x_range[0]
    palm_near: float = 0.14  # hand near the camera -> x_range[1]
    x_range: tuple[float, float] = (0.30, 0.70)
    y_range: tuple[float, float] = (-0.35, 0.35)
    z_range: tuple[float, float] = (0.02, 0.40)
    yaw0: float = 0.0
    yaw_limit: float = math.pi / 2
    invert_y: bool = False
    invert_z: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> "Calibration":
        pairs = {
            "u": (self.u_min, self.u_max), "v": (self.v_min, self.v_max), "palm": (self.palm_far, self.palm_near),
            "x_range": self.x_range, "y_range": self.y_range, "z_range": self.z_range,
        }
        for name, (lo, hi) in pairs.items():
            if not lo < hi:
                raise ValueError(f"{name}: the first value must be smaller than the second, got ({lo}, {hi})")
        if self.yaw_limit < 0:
            raise ValueError("yaw_limit must be >= 0")
        return self


def _fraction(value: float, lo: float, hi: float) -> float:
    """Where value lies between lo and hi, clamped to [0, 1]."""
    return float(np.clip((value - lo) / (hi - lo), 0.0, 1.0))


def _lerp(s: float, rng: tuple[float, float]) -> float:
    return rng[0] + s * (rng[1] - rng[0])


def to_ee_target(msg: HandPoseMsg, calib: Calibration = Calibration()) -> Pose:
    """Map a hand measurement to a gripper-down end-effector target inside the workspace.

    y follows the mirrored image u (u_min..u_max -> y max..min), z follows image height
    (1 - v), x follows palm width (palm_far..palm_near). When msg.control is present, its
    (u, v, depth) are already fractions of the user's control region and depth range, so they
    are used directly (still mirrored and inverted the same way). Every axis is clamped to the
    workspace. Yaw rotates the gripper about world z, clamped to +-yaw_limit.

    The pose is computed from whatever the message holds; the caller should hold its
    last target while msg.tracking_ok is false.
    """
    if msg.control is not None:
        u, v, depth = msg.control
        s_y = _fraction(1.0 - u, 0.0, 1.0)
        s_z = _fraction(1.0 - v, 0.0, 1.0)
        s_x = _fraction(depth, 0.0, 1.0)
    else:
        u_mirrored = 1.0 - msg.wrist_uv[0]
        s_y = _fraction(u_mirrored, calib.u_min, calib.u_max)
        s_z = _fraction(1.0 - msg.wrist_uv[1], 1.0 - calib.v_max, 1.0 - calib.v_min)
        s_x = _fraction(msg.palm_width, calib.palm_far, calib.palm_near)
    if calib.invert_y:
        s_y = 1.0 - s_y
    if calib.invert_z:
        s_z = 1.0 - s_z

    x = _lerp(s_x, calib.x_range)
    y = _lerp(s_y, (calib.y_range[1], calib.y_range[0]))
    z = _lerp(s_z, calib.z_range)

    # q = Rz(yaw) * gripper_down = (c, 0, 0, s) * (0, 1, 0, 0) = (0, c, s, 0)
    yaw = float(np.clip(msg.yaw_rad - calib.yaw0, -calib.yaw_limit, calib.yaw_limit))
    quat = (0.0, math.cos(yaw / 2), math.sin(yaw / 2), 0.0)
    return Pose(pos=(x, y, z), quat_wxyz=quat)


class GripperLatch:
    """Pinch -> gripper command with hysteresis: closes below close_below, opens above open_above.

    Starts open (0). Holds its state while tracking is lost, whatever the stale pinch says.
    """

    def __init__(self, close_below: float = 0.35, open_above: float = 0.45) -> None:
        if not close_below < open_above:
            raise ValueError("close_below must be smaller than open_above")
        self.close_below = close_below
        self.open_above = open_above
        self.state: int = 0

    def update(self, msg: HandPoseMsg) -> int:
        if msg.tracking_ok:
            if msg.pinch_ratio < self.close_below:
                self.state = 1
            elif msg.pinch_ratio > self.open_above:
                self.state = 0
        return self.state
