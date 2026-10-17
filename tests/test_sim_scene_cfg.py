"""sim_worker.scene_cfg per-robot choices (Isaac's python without the app; skipped elsewhere)."""

from __future__ import annotations

import pytest

pytest.importorskip("isaaclab")
pytest.importorskip("isaaclab_assets")

from isaaclab_assets.robots.flexiv import FLEXIV_RIZON4S_CFG  # noqa: E402

from sim_worker.scene_cfg import grav_gripper_joints, make_scene_cfg  # noqa: E402


def test_flexiv_uses_the_bare_arm_gains_and_no_arm_gravity():
    """Measured (T2 note, sprint 3 Task 3): the gripper variant's soft gains lag 21 mm (max 73) carrying the cube;
    the asset's own bare-arm gains bring the base scene to 4.0 mm (max 18.6) and success."""
    robot = make_scene_cfg(cameras=False, robot="flexiv").robot
    for group in ("shoulder", "elbow", "wrist"):
        assert robot.actuators[group].stiffness == FLEXIV_RIZON4S_CFG.actuators[group].stiffness
        assert robot.actuators[group].damping == FLEXIV_RIZON4S_CFG.actuators[group].damping
    assert robot.spawn.rigid_props.disable_gravity is True


def test_flexiv_starts_with_the_gripper_open_and_its_mimic_joints_consistent():
    joints = make_scene_cfg(cameras=False, robot="flexiv").robot.init_state.joint_pos
    assert joints["finger_joint"] == pytest.approx(0.785)
    assert joints["left_outer_finger_joint"] == pytest.approx(-0.785)
    assert grav_gripper_joints(0.2)["right_inner_knuckle_joint"] == pytest.approx(0.2)


def test_franka_scene_is_unchanged():
    robot = make_scene_cfg(cameras=False, robot="franka").robot
    assert robot.actuators["panda_arm"].stiffness == 400.0 and robot.actuators["panda_arm"].damping == 80.0


def test_unknown_robot_is_refused():
    with pytest.raises(ValueError):
        make_scene_cfg(cameras=False, robot="so101")


def test_building_a_flexiv_scene_leaves_the_isaac_asset_config_untouched():
    from isaaclab_assets.robots.flexiv import FLEXIV_RIZON4S_GRAV_GRIPPER_CFG as GRAV

    make_scene_cfg(cameras=False, robot="flexiv")
    assert GRAV.actuators["shoulder"].stiffness == 1320.0
    assert GRAV.spawn.rigid_props.disable_gravity is False
