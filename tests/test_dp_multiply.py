"""demo_pipeline.multiply: move one perfected demo into new scenes (spec 8.6)."""
from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.measure import gripper_events
from demo_pipeline.multiply import sample_scene, transform_trajectory
from demo_pipeline.schemas import Pose, Scene, Trajectory

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)  # gripper pointing down
WAYPOINTS = [np.array(p) for p in [
    (0.35, -0.10, 0.250), (0.50, 0.00, 0.175), (0.50, 0.00, 0.025), (0.50, 0.00, 0.250),
    (0.50, 0.30, 0.250), (0.50, 0.30, 0.180), (0.50, 0.30, 0.330),
]]
# close at 2.46 s (lift ends 3.46, blend until 3.96), open at 7.46 s
PLAN = [("move", 1, 1.2), ("move", 2, 1.0), ("hold", 1, 0.5), ("move", 3, 1.5),
        ("move", 4, 2.0), ("move", 5, 1.0), ("hold", 0, 0.5), ("move", 6, 1.0)]
CUBE = (0.5, 0.0, 0.025)
BIN = (0.5, 0.3, 0.0)


def _demo() -> Trajectory:
    pos, grip, cur, g = [WAYPOINTS[0]], [0], WAYPOINTS[0], 0
    for kind, arg, secs in PLAN:
        n = int(round(secs / DT))
        if kind == "move":
            s = np.arange(1, n + 1) / n
            b = 10 * s**3 - 15 * s**4 + 6 * s**5
            pos += list(cur + (WAYPOINTS[arg] - cur) * b[:, None])
            grip += [g] * n
            cur = WAYPOINTS[arg]
        else:
            pos += [cur] * n
            grip += [g] * (n // 2) + [arg] * (n - n // 2)
            g = arg
    n = len(pos)
    return Trajectory.from_arrays(np.arange(n) * DT, np.array(pos), np.tile(DOWN, (n, 1)), grip)


def _yaw_quat(yaw: float):
    return (math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2))


def _scene(cube=CUBE, bin_=BIN, cube_yaw=0.0) -> Scene:
    return Scene(cube_pose=Pose(pos=cube, quat_wxyz=_yaw_quat(cube_yaw)),
                 bin_pose=Pose(pos=bin_, quat_wxyz=IDENTITY), robot="franka", seed=0)


def _at(tr: Trajectory, t: float) -> int:
    return int(np.argmin(np.abs(np.asarray(tr.t) - t)))


def test_identity_transform_returns_same_trajectory():
    tr = _demo()
    out = transform_trajectory(tr, _scene(), _scene())
    assert np.allclose(out.ee_pos, tr.ee_pos, atol=1e-9)
    assert np.allclose(out.ee_quat, tr.ee_quat, atol=1e-9)
    assert out.t == tr.t and out.gripper == tr.gripper


def test_cube_translation_moves_grasp_point():
    tr = _demo()
    out = transform_trajectory(tr, _scene(), _scene(cube=(0.55, -0.05, 0.025)))
    p, q = np.asarray(out.ee_pos), np.asarray(tr.ee_pos)
    t_close, t_open = gripper_events(tr)
    i_close = _at(tr, t_close)
    assert np.allclose(p[: _at(tr, t_close + 1.0) + 1] - q[: _at(tr, t_close + 1.0) + 1], (0.05, -0.05, 0.0), atol=1e-9)
    assert np.allclose(p[i_close], (0.55, -0.05, 0.025), atol=1e-9)
    after_blend = np.asarray(tr.t) >= t_close + 1.5 - 1e-9
    assert np.allclose(p[after_blend], q[after_blend], atol=1e-9)  # bin unchanged -> release unchanged


def test_bin_translation_moves_release_point():
    tr = _demo()
    out = transform_trajectory(tr, _scene(), _scene(bin_=(0.45, 0.25, 0.0)))
    p, q = np.asarray(out.ee_pos), np.asarray(tr.ee_pos)
    t_close, t_open = gripper_events(tr)
    i_open = _at(tr, t_open)
    assert np.allclose(p[i_open], q[i_open] + (-0.05, -0.05, 0.0), atol=1e-9)
    upto_lift = np.asarray(tr.t) <= t_close + 1.0 + 1e-9
    assert np.allclose(p[upto_lift], q[upto_lift], atol=1e-9)  # cube unchanged -> grasp unchanged


def test_cube_yaw_rotates_the_approach_about_the_cube():
    tr = _demo()
    out = transform_trajectory(tr, _scene(), _scene(cube_yaw=math.pi / 2))
    p, q = np.asarray(out.ee_pos), np.asarray(tr.ee_pos)
    # the start pose is (-0.15, -0.10) from the cube; a +90 deg yaw puts it at (+0.10, -0.15)
    assert np.allclose(p[0], (0.5 + 0.10, 0.0 - 0.15, 0.25), atol=1e-9)
    i_close = _at(tr, gripper_events(tr)[0])
    assert np.allclose(p[i_close], CUBE, atol=1e-9)
    # gripper still points down, turned 90 deg about z: (0,1,0,0) -> (0, cos 45, sin 45, 0)
    assert np.allclose(np.abs(out.ee_quat[i_close]), (0.0, math.sqrt(0.5), math.sqrt(0.5), 0.0), atol=1e-9)


def test_blend_has_no_jump():
    tr = _demo()
    out = transform_trajectory(tr, _scene(), _scene(cube=(0.6, -0.2, 0.025), bin_=(0.45, 0.3, 0.0), cube_yaw=0.7))
    steps = np.linalg.norm(np.diff(np.asarray(out.ee_pos), axis=0), axis=1)
    # The cube and bin transforms disagree by ~0.25 m at the lift end; a 0.5 s min-jerk blend
    # peaks near 1.9 cm/step there, while an unblended switch would jump the full 25 cm.
    assert steps.max() < 0.03
    np.testing.assert_allclose(np.linalg.norm(out.ee_quat, axis=1), 1.0, atol=1e-9)


def test_transform_rejects_a_demo_that_never_grasps():
    tr = _demo()
    never = Trajectory.from_arrays(tr.t, tr.ee_pos, tr.ee_quat, np.zeros(len(tr.t), int))
    with pytest.raises(ValueError):
        transform_trajectory(never, _scene(), _scene(cube=(0.55, 0.0, 0.025)))


def _yaw(q) -> float:
    w, x, y, z = q
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def _edge_gap(cube_xy, cube_yaw, bin_xy) -> float:
    """Distance between the cube's and the bin's axis-aligned footprints."""
    hc = 0.025 * (abs(math.cos(cube_yaw)) + abs(math.sin(cube_yaw)))
    gx = max(abs(cube_xy[0] - bin_xy[0]) - (hc + 0.11), 0.0)
    gy = max(abs(cube_xy[1] - bin_xy[1]) - (hc + 0.11), 0.0)
    return math.hypot(gx, gy)


def test_sampled_scenes_respect_ranges_and_gap():
    rng = np.random.default_rng(123)
    scenes = [sample_scene(rng, "franka", seed=i) for i in range(1000)]
    yaws = []
    for i, s in enumerate(scenes):
        cx, cy, cz = s.cube_pose.pos
        bx, by, bz = s.bin_pose.pos
        yaw = _yaw(s.cube_pose.quat_wxyz)
        yaws.append(yaw)
        assert 0.40 <= cx <= 0.60 and -0.20 <= cy <= 0.20 and cz == pytest.approx(0.025)
        assert 0.40 <= bx <= 0.65 and -0.30 <= by <= 0.30 and bz == pytest.approx(0.0)
        assert abs(yaw) <= math.pi / 2 + 1e-9
        assert s.bin_pose.quat_wxyz == pytest.approx(IDENTITY)
        assert _edge_gap((cx, cy), yaw, (bx, by)) >= 0.15 - 1e-9
        assert s.robot == "franka" and s.seed == i
    assert min(yaws) < -1.3 and max(yaws) > 1.3  # the whole +-90 deg range is used


def test_sample_scene_is_reproducible_from_the_rng():
    a = sample_scene(np.random.default_rng(7), "openarm", seed=3)
    b = sample_scene(np.random.default_rng(7), "openarm", seed=3)
    assert a == b
