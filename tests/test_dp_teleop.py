"""Teleop mapping: webcam hand measurements -> end-effector target pose + latched gripper."""
from __future__ import annotations

import json
import math

import numpy as np
import pytest
from pydantic import ValidationError

from demo_pipeline.teleop import Calibration, GripperLatch, HandPoseMsg, to_ee_target

CAL = Calibration()


def _msg(**overrides) -> HandPoseMsg:
    fields = dict(
        t_ms=1000.0, tracking_ok=True, wrist_uv=(0.5, 0.5), palm_width=0.10,
        pinch_ratio=1.0, yaw_rad=0.0, frame_w=1280, frame_h=720,
    )
    fields.update(overrides)
    return HandPoseMsg(**fields)


def _rotate(q, v):
    """Rotate vector v by unit quaternion q = (w, x, y, z)."""
    w, x, y, z = q
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return r @ np.asarray(v, dtype=float)


# --- to_ee_target: position --------------------------------------------------------------------

def test_center_of_region_maps_to_workspace_center():
    pose = to_ee_target(_msg(wrist_uv=(0.5, 0.5), palm_width=0.10))

    assert pose.pos == pytest.approx((0.50, 0.0, 0.21))


def test_moving_hand_up_in_image_raises_z():
    low = to_ee_target(_msg(wrist_uv=(0.5, 0.7)))
    high = to_ee_target(_msg(wrist_uv=(0.5, 0.3)))  # smaller v = higher in the image

    assert high.pos[2] > low.pos[2]
    assert to_ee_target(_msg(wrist_uv=(0.5, CAL.v_min))).pos[2] == pytest.approx(CAL.z_range[1])
    assert to_ee_target(_msg(wrist_uv=(0.5, CAL.v_max))).pos[2] == pytest.approx(CAL.z_range[0])


def test_bigger_palm_moves_forward_in_x():
    far = to_ee_target(_msg(palm_width=CAL.palm_far))
    near = to_ee_target(_msg(palm_width=CAL.palm_near))

    assert far.pos[0] == pytest.approx(0.30)
    assert near.pos[0] == pytest.approx(0.70)


def test_mirror_hand_moving_to_raw_image_right_moves_robot_toward_positive_y():
    # Raw u goes up -> mirrored u' = 1 - u goes down -> robot y goes up (toward y_range max).
    left = to_ee_target(_msg(wrist_uv=(0.4, 0.5)))
    right = to_ee_target(_msg(wrist_uv=(0.6, 0.5)))

    assert right.pos[1] > left.pos[1]
    assert to_ee_target(_msg(wrist_uv=(1 - CAL.u_min, 0.5))).pos[1] == pytest.approx(CAL.y_range[1])


def test_invert_flags_flip_their_axis():
    flipped = Calibration(invert_y=True, invert_z=True)
    pose = to_ee_target(_msg(wrist_uv=(0.6, 0.3)))
    inverted = to_ee_target(_msg(wrist_uv=(0.6, 0.3)), flipped)

    assert inverted.pos[1] == pytest.approx(-pose.pos[1])
    assert inverted.pos[2] == pytest.approx(CAL.z_range[0] + CAL.z_range[1] - pose.pos[2])
    assert inverted.pos[0] == pytest.approx(pose.pos[0])


@pytest.mark.parametrize("uv", [(0.0, 0.0), (1.0, 1.0), (0.0, 1.0), (1.0, 0.0)])
@pytest.mark.parametrize("palm", [1e-6, 0.5, 3.0])
def test_targets_are_clamped_and_finite_at_extremes(uv, palm):
    pose = to_ee_target(_msg(wrist_uv=uv, palm_width=palm, yaw_rad=math.pi))

    assert all(math.isfinite(c) for c in (*pose.pos, *pose.quat_wxyz))
    for value, (lo, hi) in zip(pose.pos, (CAL.x_range, CAL.y_range, CAL.z_range)):
        assert lo <= value <= hi


def test_untracked_message_with_zero_fields_still_gives_a_finite_in_workspace_pose():
    pose = to_ee_target(_msg(tracking_ok=False, wrist_uv=(0.0, 0.0), palm_width=0.0, pinch_ratio=0.0))

    assert all(math.isfinite(c) for c in pose.pos)
    assert pose.pos[0] == pytest.approx(CAL.x_range[0])


# --- to_ee_target: orientation ----------------------------------------------------------------

def test_neutral_yaw_points_gripper_down():
    pose = to_ee_target(_msg(yaw_rad=0.0))

    assert pose.quat_wxyz == pytest.approx((0.0, 1.0, 0.0, 0.0))
    assert _rotate(pose.quat_wxyz, (0, 0, 1)) == pytest.approx([0, 0, -1])


def test_yaw_rotates_about_world_z_and_is_clamped():
    pose = to_ee_target(_msg(yaw_rad=0.5))
    assert _rotate(pose.quat_wxyz, (1, 0, 0)) == pytest.approx([math.cos(0.5), math.sin(0.5), 0])
    assert _rotate(pose.quat_wxyz, (0, 0, 1)) == pytest.approx([0, 0, -1])

    offset = to_ee_target(_msg(yaw_rad=0.5), Calibration(yaw0=0.2))
    assert _rotate(offset.quat_wxyz, (1, 0, 0)) == pytest.approx([math.cos(0.3), math.sin(0.3), 0])

    clamped = to_ee_target(_msg(yaw_rad=3.0))
    assert _rotate(clamped.quat_wxyz, (1, 0, 0)) == pytest.approx([0, 1, 0], abs=1e-9)
    clamped_neg = to_ee_target(_msg(yaw_rad=-3.0))
    assert _rotate(clamped_neg.quat_wxyz, (1, 0, 0)) == pytest.approx([0, -1, 0], abs=1e-9)


@pytest.mark.parametrize("yaw", [-math.pi, -1.0, 0.0, 0.3, 1.5, math.pi])
def test_quaternion_is_unit(yaw):
    q = to_ee_target(_msg(yaw_rad=yaw)).quat_wxyz

    assert math.sqrt(sum(c * c for c in q)) == pytest.approx(1.0, abs=1e-12)


# --- GripperLatch ------------------------------------------------------------------------------

def test_latch_starts_open_and_closes_and_opens_past_thresholds():
    latch = GripperLatch()
    assert latch.update(_msg(pinch_ratio=0.8)) == 0
    assert latch.update(_msg(pinch_ratio=0.30)) == 1
    assert latch.update(_msg(pinch_ratio=0.50)) == 0


def test_latch_hysteresis_no_chatter():
    for start, expected in ((0.30, 1), (0.50, 0)):
        latch = GripperLatch()
        latch.update(_msg(pinch_ratio=start))
        states = [latch.update(_msg(pinch_ratio=p)) for p in (0.38, 0.42, 0.38, 0.42, 0.38)]
        assert states == [expected] * 5


def test_latch_holds_when_tracking_lost():
    latch = GripperLatch()
    latch.update(_msg(pinch_ratio=0.2))

    # An untracked message carries 0 or stale values; a stale "open" pinch must not open it either.
    assert latch.update(_msg(tracking_ok=False, pinch_ratio=0.9)) == 1
    assert latch.update(_msg(tracking_ok=False, pinch_ratio=0.0, palm_width=0.0)) == 1


# --- HandPoseMsg validation --------------------------------------------------------------------

@pytest.mark.parametrize(
    "overrides",
    [
        {"wrist_uv": (1.2, 0.5)},
        {"wrist_uv": (0.5, -0.1)},
        {"palm_width": 0.0},
        {"palm_width": -0.05},
        {"palm_width": float("nan")},
        {"frame_w": 0},
        {"extra_field": 1},
    ],
)
def test_msg_rejects_out_of_range_uv_and_nonpositive_palm_when_tracking(overrides):
    with pytest.raises(ValidationError):
        _msg(**overrides)


def test_msg_allows_zero_palm_when_not_tracking():
    msg = _msg(tracking_ok=False, wrist_uv=(0.0, 0.0), palm_width=0.0, pinch_ratio=0.0, yaw_rad=0.0)

    assert msg.tracking_ok is False


def test_msg_json_round_trip_uses_the_shared_field_names():
    text = _msg().model_dump_json()

    assert set(json.loads(text)) == {
        "t_ms", "tracking_ok", "wrist_uv", "palm_width", "pinch_ratio", "yaw_rad", "frame_w", "frame_h",
    }
    assert HandPoseMsg.model_validate_json(text) == _msg()
