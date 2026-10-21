"""Wrist yaw from the keyboard and the mouse (the lead's addition): the page sends yaw_rad; the sim turns the gripper,
smoothed like position for keyboard and mouse (the page's messages arrive as a staircase), as is for the camera, and
clamped to +-90 degrees (to_ee_target). The yaw is in each demo's commanded and reached orientations."""

from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, Scene
from demo_pipeline.teleop import HandPoseMsg
from sim_worker.teleop_session import TELEOP_DT, StepState, TeleopSession

SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=7)


def yaw_of(q) -> float:
    """The gripper-down quaternion (0, cos(y/2), sin(y/2), 0) -> y."""
    return 2 * math.atan2(q[2], q[1])


class Driver:
    def __init__(self):
        self.applied: list[Pose] = []

    def reset(self, scene):
        self.q = (0.0, 1.0, 0.0, 0.0)

    def apply(self, target: Pose, gripper: int):
        self.applied.append(target)
        self.q = target.quat_wxyz

    def read_state(self) -> StepState:
        return StepState(joint_pos=np.zeros(2), action=np.zeros(2), ee_pos=np.array((0.4, 0.0, 0.3)),
                         ee_quat=np.array(self.q), cube_pos=np.array((0.5, 0.0, 0.025)), contact_gripper_cube=False,
                         contact_arm_bin=False, contact_arm_table=False, max_contact_force=0.0)


def hand(yaw: float) -> HandPoseMsg:
    return HandPoseMsg(t_ms=0.0, tracking_ok=True, wrist_uv=(0.5, 0.5), palm_width=0.1, pinch_ratio=0.8, yaw_rad=yaw,
                       frame_w=640, frame_h=480, control=(0.5, 0.5, 0.5))


def session(input: str):
    t = [0.0]
    s = TeleopSession(Driver(), SCENE, lambda rec: "saved", clock=lambda: t[0])
    s.on_control("set_input", input)
    return s


def run(s, steps, yaw):
    for _ in range(steps):
        s.on_hand(hand(yaw))
        s.step()


@pytest.mark.parametrize("input", ["keyboard", "mouse"])
def test_keyboard_and_mouse_yaw_is_smoothed_and_gets_there(input):
    s = session(input)
    run(s, 1, 0.0)
    run(s, 1, 0.6)  # a step from 0 to ~34 degrees
    first = yaw_of(s.driver.applied[-1].quat_wxyz)
    assert 0 < first < 0.2  # not a jump
    run(s, 60, 0.6)
    yaws = [yaw_of(p.quat_wxyz) for p in s.driver.applied]
    assert yaws[-1] == pytest.approx(0.6, abs=1e-3)
    assert max(np.diff(yaws)) < 0.1  # under ~6 degrees per 20 ms step
    assert max(yaws) <= 0.6 + 0.02  # a critically damped filter: no real overshoot


def test_the_camera_yaw_is_not_smoothed():
    s = session("camera")
    run(s, 1, 0.6)
    assert yaw_of(s.driver.applied[-1].quat_wxyz) == pytest.approx(0.6)


@pytest.mark.parametrize("input", ["keyboard", "camera"])
def test_yaw_is_clamped_to_90_degrees(input):
    s = session(input)
    run(s, 80, 2.5)
    assert yaw_of(s.driver.applied[-1].quat_wxyz) == pytest.approx(math.pi / 2, abs=1e-3)


def test_switching_input_starts_the_yaw_filter_from_where_the_wrist_is():
    s = session("camera")
    run(s, 1, 0.8)
    s.on_control("set_input", "keyboard")
    run(s, 1, 0.8)
    assert yaw_of(s.driver.applied[-1].quat_wxyz) == pytest.approx(0.8, abs=1e-3)  # no swing back to 0 and out again


def test_the_start_orientation_passes_through_untouched():
    """Before any hand the target is the arm's own start pose, which isn't exactly gripper-down: kept as it is."""
    s = session("keyboard")
    tilted = (0.01, 0.9999, 0.0, 0.0)
    s._target = Pose(pos=(0.4, 0.0, 0.3), quat_wxyz=tilted)
    s._latest = None
    s.step()
    assert s.driver.applied[-1].quat_wxyz == tilted
