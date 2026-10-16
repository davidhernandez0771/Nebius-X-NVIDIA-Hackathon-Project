"""scripted_expert: a pure function, tested in Isaac's python without starting the sim."""

from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, Scene, Trajectory
from sim_worker.scripted import scripted_expert


def _scene(cube_xy=(0.5, 0.0), bin_xy=(0.5, 0.3), cube_yaw=0.0) -> Scene:
    return Scene(
        cube_pose=Pose(pos=(*cube_xy, 0.025), quat_wxyz=(math.cos(cube_yaw / 2), 0.0, 0.0, math.sin(cube_yaw / 2))),
        bin_pose=Pose(pos=(*bin_xy, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
        robot="franka",
        seed=0,
    )


def _events(traj: Trajectory) -> tuple[int, int]:
    g = np.asarray(traj.gripper)
    close = int(np.flatnonzero(np.diff(g) == 1)[0] + 1)
    opening = int(np.flatnonzero(np.diff(g) == -1)[-1] + 1)
    return close, opening


def test_trajectory_validates_on_an_even_50hz_grid():
    traj = scripted_expert(_scene())
    Trajectory.model_validate(traj.model_dump())
    assert traj.t[0] == 0.0
    assert np.allclose(np.diff(traj.t), 0.02)
    assert traj.gripper[0] == 0 and traj.gripper[-1] == 0


def test_gripper_closes_once_at_the_cube_and_opens_once_above_the_bin():
    scene = _scene(cube_xy=(0.45, -0.1), bin_xy=(0.55, 0.25))
    traj = scripted_expert(scene)
    g = np.asarray(traj.gripper)
    assert np.count_nonzero(np.diff(g) == 1) == 1
    assert np.count_nonzero(np.diff(g) == -1) == 1
    close, opening = _events(traj)
    ee = np.asarray(traj.ee_pos)
    assert np.allclose(ee[close], scene.cube_pose.pos, atol=1e-6)
    assert np.allclose(ee[opening], (0.55, 0.25, 0.10), atol=1e-6)


def test_gripper_is_held_half_a_second_at_each_event():
    traj = scripted_expert(_scene())
    close, opening = _events(traj)
    ee = np.asarray(traj.ee_pos)
    # 25 steps after each event the hand has not moved yet
    assert np.allclose(ee[close : close + 26], ee[close], atol=1e-9)
    assert np.allclose(ee[opening : opening + 26], ee[opening], atol=1e-9)


def test_duration_under_15_s_and_speeds_bounded():
    traj = scripted_expert(_scene(cube_xy=(0.4, -0.2), bin_xy=(0.65, 0.3)))
    assert traj.duration < 15.0
    speed = np.linalg.norm(np.diff(np.asarray(traj.ee_pos), axis=0), axis=1) / 0.02
    # minimum-jerk peak = 1.875 x the 0.15 m/s average
    assert speed.max() <= 1.875 * 0.15 + 1e-3


def test_gripper_points_down_and_follows_cube_yaw_until_grasp():
    yaw = math.radians(30)
    traj = scripted_expert(_scene(cube_yaw=yaw))
    close, _ = _events(traj)
    q = np.asarray(traj.ee_quat)
    want = np.array([0.0, math.cos(yaw / 2), math.sin(yaw / 2), 0.0])  # yaw(z) * (0, 1, 0, 0)
    assert abs(abs(q[close] @ want) - 1.0) < 1e-6
    assert abs(abs(q[0] @ want) - 1.0) < 1e-6
    assert abs(abs(q[-1] @ np.array([0.0, 1.0, 0.0, 0.0])) - 1.0) < 1e-6


@pytest.mark.parametrize("yaw_deg, wrapped_deg", [(80, -10), (-60, 30), (40, 40), (170, -10)])
def test_cube_yaw_is_wrapped_to_the_nearest_square_face(yaw_deg, wrapped_deg):
    """The cube looks the same every 90 degrees, so the wrist turns at most 45 degrees."""
    traj = scripted_expert(_scene(cube_yaw=math.radians(yaw_deg)))
    close, _ = _events(traj)
    w = math.radians(wrapped_deg)
    want = np.array([0.0, math.cos(w / 2), math.sin(w / 2), 0.0])
    assert abs(abs(np.asarray(traj.ee_quat[close]) @ want) - 1.0) < 1e-6


@pytest.mark.parametrize("hold_s, steps", [(0.5, 25), (0.15, 8)])
def test_hold_s_sets_how_long_the_hand_waits_at_each_gripper_event(hold_s, steps):
    traj = scripted_expert(_scene(), hold_s=hold_s)
    close, opening = _events(traj)
    ee = np.asarray(traj.ee_pos)
    for event in (close, opening):
        assert np.allclose(ee[event : event + steps + 1], ee[event], atol=1e-9)
        assert not np.allclose(ee[event + steps + 2], ee[event], atol=1e-6)


def test_fast_variant_is_shorter_by_the_two_saved_holds():
    slow, fast = scripted_expert(_scene()), scripted_expert(_scene(), hold_s=0.15)
    assert len(slow.t) - len(fast.t) == 2 * (25 - 8)


def test_default_demo_is_unchanged_by_the_lift_z_option():
    traj = scripted_expert(_scene())
    ee = np.asarray(traj.ee_pos)
    assert len(traj.t) == 376  # sprint 1 smoke length
    assert ee[:, 2].max() == pytest.approx(0.25)
    assert ee[-1, 2] == pytest.approx(0.25)


@pytest.mark.parametrize("lift_z", [0.18, 0.30])
def test_lift_z_sets_the_carry_and_retreat_height(lift_z):
    traj = scripted_expert(_scene(), lift_z=lift_z)
    ee = np.asarray(traj.ee_pos)
    close, opening = _events(traj)
    assert ee[close:opening, 2].max() == pytest.approx(lift_z)
    assert ee[-1, 2] == pytest.approx(lift_z)
    assert ee[:, 2].max() == pytest.approx(max(lift_z, 0.175))  # the start above the cube stays at 0.175


def test_lift_z_must_clear_the_bin_rim_with_the_cube():
    with pytest.raises(ValueError):
        scripted_expert(_scene(), lift_z=0.12)


# --- home start (sprint 5 Task 1): one fixed start pose, so the start state no longer encodes the cube ---

from sim_worker.scripted import DOWN_WXYZ, HOME_TCP  # noqa: E402


@pytest.mark.parametrize("cube_xy,yaw", [((0.40, -0.20), 0.7), ((0.60, 0.20), -1.2), ((0.5, 0.0), 0.0)])
def test_home_start_begins_every_demo_at_the_same_pose_pointing_down(cube_xy, yaw):
    traj = scripted_expert(_scene(cube_xy=cube_xy, cube_yaw=yaw), home_start=True)
    assert np.allclose(traj.ee_pos[0], HOME_TCP)
    assert np.allclose(traj.ee_quat[0], DOWN_WXYZ)
    assert traj.gripper[0] == 0


def test_home_start_then_follows_the_default_demo_from_above_the_cube():
    scene = _scene(cube_xy=(0.45, -0.1), bin_xy=(0.55, 0.25), cube_yaw=0.4)
    plain, home = scripted_expert(scene), scripted_expert(scene, home_start=True)
    k = len(home.t) - len(plain.t)  # the extra home -> above-cube move
    assert k > 0
    assert np.allclose(np.asarray(home.ee_pos)[k:], plain.ee_pos)
    assert np.allclose(np.asarray(home.ee_quat)[k:], plain.ee_quat)
    assert list(home.gripper[k:]) == list(plain.gripper) and not any(home.gripper[:k])


def test_home_start_move_is_smooth_and_within_the_speed_bound():
    traj = scripted_expert(_scene(cube_xy=(0.40, -0.20)), home_start=True)
    p = np.asarray(traj.ee_pos)
    speed = np.linalg.norm(np.diff(p, axis=0), axis=1) / 0.02
    assert speed.max() <= 1.875 * 0.15 + 1e-3  # min-jerk peak at SPEED average, as for the other moves
    assert np.all(p[:, 2] >= 0.025 - 1e-9)


def test_default_demo_is_unchanged_by_the_home_start_option():
    scene = _scene()
    assert scripted_expert(scene, home_start=False) == scripted_expert(scene)
