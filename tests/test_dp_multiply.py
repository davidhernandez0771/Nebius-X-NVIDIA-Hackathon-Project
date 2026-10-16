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
# close at 2.46 s, lift until 4.2, above the bin at 6.2, open at 7.46 s
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
    after_open = np.asarray(tr.t) >= t_open - 1e-9  # the bin frame takes over at the release
    assert np.allclose(p[after_open], q[after_open], atol=1e-9)  # bin unchanged -> release unchanged


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


# --- handover at the gripper events (T2 status note, 2026-10-16, Task 4) ---

from sim_worker.scripted import scripted_expert  # noqa: E402

T2_SRC = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
               bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=0)
FRANKA_SHOULDER = np.array([0.0, 0.0, 0.333])


def _dist_to_path(points: np.ndarray, path: np.ndarray) -> np.ndarray:
    """Distance from each point to the polyline through path."""
    a, b = path[:-1], path[1:]
    ab = b - a
    L2 = np.maximum((ab**2).sum(axis=1), 1e-18)
    out = np.empty(len(points))
    for i, p in enumerate(points):
        s = np.clip(((p - a) * ab).sum(axis=1) / L2, 0.0, 1.0)
        out[i] = np.linalg.norm(a + s[:, None] * ab - p, axis=1).min()
    return out


@pytest.mark.parametrize("seed", [115, 126, 129])
def test_t2_unreachable_variants_now_carry_along_the_experts_path(seed):
    # T2's multiply_run: the scripted expert on T2_SRC, moved to sample_scene(default_rng(seed)).
    # The fixed-time handover swung these to 0.84-0.86 m from the shoulder (past the Franka's reach).
    src = scripted_expert(T2_SRC)
    dst = sample_scene(np.random.default_rng(seed), "franka", seed)
    out = np.asarray(transform_trajectory(src, T2_SRC, dst).ee_pos)
    expert = np.asarray(scripted_expert(dst).ee_pos)
    assert np.linalg.norm(out - FRANKA_SHOULDER, axis=1).max() <= np.linalg.norm(expert - FRANKA_SHOULDER, axis=1).max() + 1e-3
    t_close, t_open = gripper_events(src)
    t = np.asarray(src.t)
    carry = (t >= t_close - 1e-9) & (t <= t_open + 1e-9)
    assert _dist_to_path(out[carry], expert).max() < 1e-3  # the cube goes where the expert would take it


def test_no_variant_reaches_further_than_the_expert():
    src = scripted_expert(T2_SRC)
    for seed in range(100, 130):
        dst = sample_scene(np.random.default_rng(seed), "franka", seed)
        out = np.asarray(transform_trajectory(src, T2_SRC, dst).ee_pos)
        expert = np.asarray(scripted_expert(dst).ee_pos)
        assert (np.linalg.norm(out - FRANKA_SHOULDER, axis=1).max()
                <= np.linalg.norm(expert - FRANKA_SHOULDER, axis=1).max() + 1e-3), seed


def test_a_slow_lift_stays_above_the_new_cube():
    # A long hold at the close: the lift starts 2 s after it, after the old fixed-time handover.
    src = scripted_expert(T2_SRC, hold_s=2.0)
    dst = _scene(cube=(0.45, -0.15, 0.025), bin_=(0.55, 0.25, 0.0))
    out = np.asarray(transform_trajectory(src, T2_SRC, dst).ee_pos)
    p = np.asarray(src.ee_pos)
    t_close, _ = gripper_events(src)
    i_close = _at(src, t_close)
    lift = np.flatnonzero(np.all(np.abs(p[:, :2] - p[i_close, :2]) < 1e-9, axis=1))
    lift = lift[lift >= i_close]
    assert lift.size > 100 and p[lift, 2].max() > 0.2  # the hold and the vertical lift
    np.testing.assert_allclose(out[lift, :2], np.tile((0.45, -0.15), (lift.size, 1)), atol=1e-9)
    np.testing.assert_allclose(out[lift, 2], p[lift, 2], atol=1e-9)


def test_carry_keeps_the_sources_sideways_detour():
    # The test demo's carry is straight; bend it sideways by 3 cm and the variant bends the same 3 cm.
    tr = _demo()
    p = np.asarray(tr.ee_pos).copy()
    t = np.asarray(tr.t)
    t_close, t_open = gripper_events(tr)
    carry = (t > t_close + 1.5) & (t < t_close + 3.5)  # the move from above the cube to above the bin
    s = (t[carry] - (t_close + 1.5)) / 2.0
    p[carry, 0] += 0.03 * np.sin(np.pi * s)  # source chord is +y; the detour is along +x
    bent = Trajectory.from_arrays(t, p, tr.ee_quat, tr.gripper)
    # The new bin is 0.4 m along +x from the same cube: the chord turns from +y to +x and grows
    # from 0.3 to 0.4 m. Progress along it stretches by 4/3; the detour (on the right of the
    # travel) turns from +x to -y and keeps its 3 cm.
    dst = _scene(bin_=(0.9, 0.0, 0.0))
    out = np.asarray(transform_trajectory(bent, _scene(), dst).ee_pos)
    q = np.asarray(tr.ee_pos)[carry]
    expected = np.stack([0.5 + q[:, 1] * 4 / 3, -(p[carry, 0] - 0.5), q[:, 2]], axis=1)
    np.testing.assert_allclose(out[carry], expected, atol=1e-9)


def test_carry_absorbs_a_height_change_between_grasp_and_release():
    tr = _demo()
    out = np.asarray(transform_trajectory(tr, _scene(), _scene(cube=(0.5, 0.0, 0.035))).ee_pos)
    p = np.asarray(tr.ee_pos)
    t_close, t_open = gripper_events(tr)
    i_close, i_open = _at(tr, t_close), _at(tr, t_open)
    np.testing.assert_allclose(out[i_close], (0.5, 0.0, 0.035), atol=1e-9)  # a 1 cm taller cube
    np.testing.assert_allclose(out[i_open:], p[i_open:], atol=1e-9)  # the bin did not move
    assert np.abs(np.diff(out[:, 2])).max() < 0.01


def test_wrist_turns_from_the_cube_frame_to_the_bin_frame_over_the_carry():
    tr = _demo()
    out = transform_trajectory(tr, _scene(), _scene(cube_yaw=math.pi / 2))
    q, q0 = np.asarray(out.ee_quat), np.asarray(tr.ee_quat)
    t_close, t_open = gripper_events(tr)
    i_close, i_open = _at(tr, t_close), _at(tr, t_open)
    np.testing.assert_allclose(np.abs(q[i_close]), (0.0, math.sqrt(0.5), math.sqrt(0.5), 0.0), atol=1e-9)
    np.testing.assert_allclose(q[i_open:], q0[i_open:], atol=1e-9)  # bin unchanged -> release pose unchanged
    turn = 2 * np.degrees(np.arccos(np.clip(np.abs((q[1:] * q[:-1]).sum(axis=1)), 0, 1)))
    # 90 deg over the 2 s carry peaks at ~3.2 deg/step (the old 0.5 s blend: ~6.8); a snap would be 90
    assert turn.max() < 4.0
