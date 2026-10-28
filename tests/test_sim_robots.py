"""sim_worker.robots: per-robot constants and the tool <-> hand frame math (pure, no sim)."""

from __future__ import annotations

import math

import numpy as np
import pytest

from sim_worker.robots import ROBOTS, hand_from_tool, robot_spec, tool_from_hand


def _quat_from_axis_angle(axis, angle) -> np.ndarray:
    axis = np.asarray(axis, dtype=float) / np.linalg.norm(axis)
    return np.array([math.cos(angle / 2), *(math.sin(angle / 2) * axis)])


def _rotate(q, v) -> np.ndarray:
    w, x, y, z = q
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return r @ np.asarray(v, dtype=float)


def test_franka_spec_keeps_the_sprint1_constants():
    f = robot_spec("franka")
    assert f.hand_body == "panda_hand"
    assert f.finger_joints == ("panda_finger_joint1", "panda_finger_joint2")
    assert (f.gripper_open, f.gripper_closed) == (0.04, 0.0)
    assert f.tcp_offset == (0.0, 0.0, 0.1034)
    assert f.hand_in_tool_wxyz == (1.0, 0.0, 0.0, 0.0)
    assert f.base_pos == (0.0, 0.0, 0.0)


def test_all_sim_arms_are_registered():
    assert set(ROBOTS) == {"franka", "openarm", "flexiv"}
    with pytest.raises(KeyError):
        robot_spec("so101")


@pytest.mark.parametrize("name", ["franka", "openarm", "flexiv"])
def test_tool_hand_round_trip(name):
    spec = robot_spec(name)
    pos = np.array([0.5, -0.1, 0.2])
    q = _quat_from_axis_angle([0.3, -1.0, 0.2], 2.1)
    hand_pos, hand_q = hand_from_tool(spec, pos, q)
    back_pos, back_q = tool_from_hand(spec, hand_pos, hand_q)
    assert np.allclose(back_pos, pos, atol=1e-12)
    assert abs(abs(back_q @ q) - 1.0) < 1e-12


def test_franka_hand_sits_0_1034_m_behind_the_tcp_along_the_approach_axis():
    spec = robot_spec("franka")
    down = np.array([0.0, 1.0, 0.0, 0.0])  # tool z points down
    hand_pos, hand_q = hand_from_tool(spec, np.array([0.5, 0.0, 0.025]), down)
    assert np.allclose(hand_pos, [0.5, 0.0, 0.025 + 0.1034])
    assert np.allclose(hand_q, down)


def test_openarm_tool_frame_maps_approach_to_tool_z():
    """Whatever the hand's own axes, the tool frame's +z is the fingers' approach direction."""
    spec = robot_spec("openarm")
    down = np.array([0.0, 1.0, 0.0, 0.0])
    hand_pos, hand_q = hand_from_tool(spec, np.array([0.5, 0.0, 0.025]), down)
    approach_w = _rotate(hand_q, spec.tcp_offset) / np.linalg.norm(spec.tcp_offset)
    assert np.allclose(approach_w, [0.0, 0.0, -1.0], atol=1e-9)


def test_openarm_fingers_close_along_tool_x():
    """Measured (T2 note, Task 5): OpenArm reaches top-down poses with its fingers turned 90 degrees from the
    Franka's; the cube is 90-degree symmetric, so the grasp is equivalent."""
    spec = robot_spec("openarm")
    q = np.asarray(spec.hand_in_tool_wxyz)
    assert np.allclose(np.abs(_rotate(q, [0.0, 1.0, 0.0])), [1.0, 0.0, 0.0], atol=1e-9)
    assert np.allclose(_rotate(q, [0.0, 0.0, 1.0]), [0.0, 0.0, 1.0], atol=1e-9)


def test_openarm_start_pose_names_every_arm_joint_and_respects_limits():
    spec = robot_spec("openarm")
    limits = {1: (-1.396, 3.491), 2: (-1.745, 1.745), 3: (-1.571, 1.571), 4: (0.0, 2.443),
              5: (-1.571, 1.571), 6: (-0.785, 0.785), 7: (-1.571, 1.571)}  # probed 2026-10-16
    assert set(spec.init_joint_pos) >= {f"openarm_joint{i}" for i in limits}
    for i, (lo, hi) in limits.items():
        assert lo + 0.1 < spec.init_joint_pos[f"openarm_joint{i}"] < hi - 0.1


def test_franka_keeps_its_asset_start_pose():
    assert robot_spec("franka").init_joint_pos is None


def test_only_openarm_uses_ik_joint_limit_avoidance():
    """Measured (T2 note, Task 5): gain 0.5 halves the OpenArm's worst tracking error (joint5 saturates without it)."""
    assert robot_spec("franka").ik_limit_gain == 0.0
    assert robot_spec("openarm").ik_limit_gain == pytest.approx(0.5)


def test_flexiv_spec_matches_the_probed_stage():
    """Probed 2026-10-16 (FLEXIV_RIZON4S_GRAV_GRIPPER_CFG): link7 points down like panda_hand at the default pose,
    the Grav fingertips slide along link7 y, and their midpoint is 0.288 m along link7 +z at finger_joint = 0. The TCP is
    the held cube's center, measured 1.7 cm beyond that: at 0.288 the closing linkage jams the fingers on the table."""
    f = robot_spec("flexiv")
    assert (f.arm_joints, f.hand_body, f.finger_joints) == ("joint[1-7]", "link7", ("finger_joint",))
    assert (f.gripper_open, f.gripper_closed) == (0.785, -0.155)
    assert f.tcp_offset == (0.0, 0.0, 0.305)
    assert f.hand_in_tool_wxyz == (1.0, 0.0, 0.0, 0.0)
    assert f.init_joint_pos is None and f.ik_limit_gain == 0.0


def test_flexiv_hand_sits_0_305_m_above_a_downward_tcp():
    hand_pos, _ = hand_from_tool(robot_spec("flexiv"), np.array([0.5, 0.0, 0.025]), np.array([0.0, 1.0, 0.0, 0.0]))
    assert np.allclose(hand_pos, [0.5, 0.0, 0.330])


def test_an_uploaded_robot_is_found_by_name_but_is_not_a_builtin():
    from dataclasses import replace

    from sim_worker.robots import register_robot

    spec = replace(robot_spec("franka"), name="byor_test000001")
    register_robot(spec)
    assert robot_spec("byor_test000001") is spec
    assert "byor_test000001" not in ROBOTS
    with pytest.raises(ValueError, match="built-in"):
        register_robot(replace(spec, name="franka"))


def test_finger_targets_repeat_one_value_or_take_one_per_joint():
    from dataclasses import replace

    from sim_worker.robots import finger_targets

    f = robot_spec("franka")
    assert finger_targets(f, closed=False) == (0.04, 0.04) and finger_targets(f, closed=True) == (0.0, 0.0)
    two = replace(f, gripper_open=(0.035, -0.035), gripper_closed=(0.0, 0.0))
    assert finger_targets(two, closed=False) == (0.035, -0.035)
