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


# --- per-robot sampling ranges (sprint 3, T1 Task 2) ---

from demo_pipeline import multiply  # noqa: E402


def test_franka_ranges_are_the_confirmed_ones():
    r = multiply.SCENE_RANGES["franka"]
    assert (r.cube_x, r.cube_y, r.bin_x, r.bin_y) == ((0.40, 0.60), (-0.20, 0.20), (0.40, 0.65), (-0.30, 0.30))
    assert r.cube_yaw == (-math.pi / 2, math.pi / 2)


def test_franka_scenes_are_unchanged_by_the_table():
    # T2's yield seeds must keep naming the same scenes (seed 115: one of its three failures).
    s = sample_scene(np.random.default_rng(115), "franka", 115)
    np.testing.assert_allclose(s.cube_pose.pos, (0.540467604837756, 0.041483628586139604, 0.025), atol=1e-15)
    np.testing.assert_allclose(s.cube_pose.quat_wxyz, (0.9975941315822444, 0.0, 0.0, 0.06932494956844566), atol=1e-15)
    np.testing.assert_allclose(s.bin_pose.pos, (0.6052868061282477, -0.2995369307149335, 0.0), atol=1e-15)


# --- per-robot ranges fitted from T2's measured runs (sprint 3c, T1 Task 1) ---
# (run, cube x, cube y, bin x, bin y) read from C:/dev/pm-t2/data/*/scene.json + verification.json on 2026-10-16.
# Successes come from every run; unreachable failures only from scripted-expert runs (batch_*, corners_*):
# the multiply runs predate the handover fix and fail on its swing (T1 status note, sprint 3c Task 1).

FLEXIV_SUCCESSES = [
    ('batch_flexiv/ep_0103', 0.4625, -0.1103, 0.6150, 0.2145),
    ('batch_flexiv/ep_0110', 0.5439, 0.1796, 0.4457, -0.1205),
    ('batch_flexiv/ep_0111', 0.4307, -0.1323, 0.5645, 0.1605),
    ('batch_flexiv/ep_0117', 0.5724, -0.0739, 0.6201, 0.2400),
    ('batch_flexiv/ep_0118', 0.4288, -0.1689, 0.4882, 0.2533),
    ('corners_flexiv/bin_0.40_+0.30', 0.5000, -0.1500, 0.4000, 0.3000),
    ('corners_flexiv/bin_0.65_+0.30', 0.5000, -0.1500, 0.6500, 0.3000),
    ('multiply_flexiv/source', 0.5000, 0.0000, 0.5000, 0.3000),
    ('multiply_flexiv/var_0101', 0.5845, 0.1477, 0.6433, -0.1653),
    ('multiply_flexiv/var_0103', 0.4625, -0.1103, 0.6150, 0.2145),
    ('multiply_flexiv/var_0106', 0.5965, -0.1838, 0.5161, 0.2787),
    ('multiply_flexiv/var_0109', 0.4389, -0.1394, 0.5357, 0.2996),
    ('multiply_flexiv/var_0111', 0.4307, -0.1323, 0.5645, 0.1605),
    ('multiply_flexiv/var_0116', 0.4553, 0.1791, 0.5523, -0.2236),
    ('multiply_flexiv/var_0117', 0.5724, -0.0739, 0.6201, 0.2400),
    ('multiply_flexiv/var_0118', 0.4288, -0.1689, 0.4882, 0.2533),
    ('multiply_flexiv/var_0120', 0.4277, -0.1320, 0.4545, 0.2363),
]
FLEXIV_UNREACHABLE = [  # scripted expert runs only
    ('batch_flexiv/ep_0101', 0.5845, 0.1477, 0.6433, -0.1653),
    ('batch_flexiv/ep_0102', 0.4928, 0.1565, 0.6483, -0.1545),
    ('batch_flexiv/ep_0113', 0.5309, -0.1294, 0.5049, 0.2667),
    ('batch_flexiv/ep_0114', 0.4998, 0.1374, 0.4344, -0.1679),
    ('batch_flexiv/ep_0115', 0.5405, 0.0415, 0.6053, -0.2995),
    ('batch_flexiv/ep_0116', 0.4553, 0.1791, 0.5523, -0.2236),
    ('batch_flexiv/ep_0125', 0.5560, 0.1145, 0.4805, -0.2287),
    ('batch_flexiv/ep_0126', 0.4012, 0.1767, 0.6448, -0.2262),
    ('batch_flexiv/ep_0129', 0.5730, 0.1290, 0.6434, -0.2444),
    ('corners_flexiv/bin_0.40_-0.30', 0.5000, 0.1500, 0.4000, -0.3000),
    ('corners_flexiv/bin_0.65_-0.30', 0.5000, 0.1500, 0.6500, -0.3000),
    ('corners_flexiv/cube_0.40_+0.20', 0.4000, 0.2000, 0.5250, -0.3000),
    ('corners_flexiv/cube_0.60_+0.20', 0.6000, 0.2000, 0.5250, -0.3000),
]
OPENARM_SUCCESSES = [
    ('batch_openarm_lift018/ep_0000', 0.5632, -0.1989, 0.4084, 0.1378),
    ('batch_openarm_lift018/ep_0018', 0.4251, -0.1932, 0.4987, 0.1216),
]
OPENARM_UNREACHABLE = [  # scripted expert runs only
    ('batch_openarm_lift018/ep_0001', 0.4847, 0.1311, 0.5374, -0.2835),
    ('batch_openarm_lift018/ep_0002', 0.5266, 0.1870, 0.4979, -0.1876),
    ('batch_openarm_lift018/ep_0003', 0.4959, -0.1415, 0.4730, 0.2227),
    ('batch_openarm_lift018/ep_0004', 0.5804, -0.0091, 0.5972, 0.2905),
    ('batch_openarm_lift018/ep_0005', 0.5610, 0.1232, 0.4715, -0.2676),
    ('batch_openarm_lift018/ep_0006', 0.5076, -0.0627, 0.4936, 0.2925),
    ('batch_openarm_lift018/ep_0007', 0.5484, -0.1634, 0.5269, 0.2228),
    ('batch_openarm_lift018/ep_0008', 0.4368, -0.0637, 0.5194, 0.2804),
    ('batch_openarm_lift018/ep_0009', 0.4970, -0.1739, 0.6077, 0.2900),
    ('batch_openarm_lift018/ep_0010', 0.5867, -0.1420, 0.4348, 0.2439),
    ('batch_openarm_lift018/ep_0011', 0.4066, -0.1197, 0.5172, 0.2437),
    ('batch_openarm_lift018/ep_0012', 0.5341, 0.1786, 0.6201, -0.2614),
    ('batch_openarm_lift018/ep_0013', 0.5730, 0.1421, 0.4654, -0.2537),
    ('batch_openarm_lift018/ep_0014', 0.4153, -0.1386, 0.4188, 0.2935),
    ('batch_openarm_lift018/ep_0015', 0.5563, 0.1375, 0.6354, -0.2890),
    ('batch_openarm_lift018/ep_0016', 0.4153, 0.0920, 0.6005, -0.2106),
    ('batch_openarm_lift018/ep_0017', 0.5307, 0.0169, 0.6272, -0.2897),
    ('batch_openarm_lift018/ep_0019', 0.4096, -0.1641, 0.5149, 0.1663),
    ('batch_openarm_lift018/ep_0020', 0.5615, 0.1253, 0.4825, -0.2465),
    ('batch_openarm_lift018/ep_0021', 0.4803, 0.1272, 0.5583, -0.2928),
    ('batch_openarm_lift018/ep_0022', 0.5318, -0.1894, 0.5787, 0.1334),
    ('batch_openarm_lift018/ep_0023', 0.5363, -0.1499, 0.5185, 0.1961),
    ('batch_openarm_lift018/ep_0024', 0.5453, -0.1246, 0.4364, 0.1925),
    ('batch_openarm_lift018/ep_0025', 0.4386, 0.1963, 0.4303, -0.1645),
    ('batch_openarm_lift018/ep_0026', 0.4983, -0.1062, 0.5782, 0.1879),
    ('batch_openarm_lift018/ep_0027', 0.5395, -0.0745, 0.4809, 0.2587),
    ('batch_openarm_lift018/ep_0028', 0.5704, 0.1540, 0.4080, -0.2699),
    ('batch_openarm_lift018/ep_0029', 0.5932, -0.1125, 0.4108, 0.1757),
]


def _inside(r: multiply.SceneRanges, cx, cy, bx, by) -> bool:
    return (r.cube_x[0] <= cx <= r.cube_x[1] and r.cube_y[0] <= cy <= r.cube_y[1]
            and r.bin_x[0] <= bx <= r.bin_x[1] and r.bin_y[0] <= by <= r.bin_y[1])


@pytest.mark.parametrize("robot,successes", [("flexiv", FLEXIV_SUCCESSES), ("openarm", OPENARM_SUCCESSES)])
def test_fitted_ranges_contain_every_observed_success(robot, successes):
    r = multiply.SCENE_RANGES[robot]
    assert [run for run, *p in successes if not _inside(r, *p)] == []


def test_openarm_ranges_exclude_every_observed_unreachable_failure():
    r = multiply.SCENE_RANGES["openarm"]
    assert len(OPENARM_UNREACHABLE) == 28
    assert [run for run, *p in OPENARM_UNREACHABLE if _inside(r, *p)] == []


def test_flexiv_ranges_exclude_the_unreachable_failures_that_separate_by_place():
    # Only the far -y bins separate: no success below bin y -0.224, and every scripted run there failed.
    r = multiply.SCENE_RANGES["flexiv"]
    excluded = sorted(run for run, *p in FLEXIV_UNREACHABLE if not _inside(r, *p))
    assert excluded == ["batch_flexiv/ep_0115", "corners_flexiv/bin_0.40_-0.30", "corners_flexiv/bin_0.65_-0.30",
                        "corners_flexiv/cube_0.40_+0.20", "corners_flexiv/cube_0.60_+0.20"]
    assert (r.cube_x, r.cube_y, r.bin_x) == ((0.40, 0.60), (-0.20, 0.20), (0.40, 0.65))  # Franka's elsewhere


def test_flexiv_unreachable_does_not_separate_elsewhere_the_same_scene_both_failed_and_succeeded():
    # T2: the Flexiv's carry failures are grip drag, not reach. Seeds 101 and 116 failed unreachable as
    # scripted runs and succeeded as multiply variants, on the very same scene.
    succ = {tuple(p) for _, *p in FLEXIV_SUCCESSES}
    both = sorted(run for run, *p in FLEXIV_UNREACHABLE if tuple(p) in succ)
    assert both == ["batch_flexiv/ep_0101", "batch_flexiv/ep_0116"]


@pytest.mark.parametrize("robot", ["openarm", "flexiv"])
def test_fitted_ranges_are_inside_the_tested_franka_ranges_and_sample(robot):
    r, f = multiply.SCENE_RANGES[robot], multiply.SCENE_RANGES["franka"]
    for ax in ("cube_x", "cube_y", "cube_yaw", "bin_x", "bin_y"):
        lo, hi = getattr(r, ax)
        assert getattr(f, ax)[0] <= lo < hi <= getattr(f, ax)[1], ax
    rng = np.random.default_rng(0)
    for i in range(200):
        s = sample_scene(rng, robot, i)
        assert _inside(r, *s.cube_pose.pos[:2], *s.bin_pose.pos[:2])


def test_ranges_are_honored_per_robot(monkeypatch):
    narrow = multiply.SceneRanges(cube_x=(0.30, 0.32), cube_y=(0.10, 0.12), cube_yaw=(0.0, 0.1),
                                  bin_x=(0.30, 0.32), bin_y=(-0.30, -0.28))
    monkeypatch.setitem(multiply.SCENE_RANGES, "openarm", narrow)
    rng = np.random.default_rng(5)
    for i in range(200):
        s = sample_scene(rng, "openarm", i)
        cx, cy, _ = s.cube_pose.pos
        bx, by, _ = s.bin_pose.pos
        assert 0.30 <= cx <= 0.32 and 0.10 <= cy <= 0.12 and 0.0 <= _yaw(s.cube_pose.quat_wxyz) <= 0.1 + 1e-12
        assert 0.30 <= bx <= 0.32 and -0.30 <= by <= -0.28
        f = sample_scene(rng, "franka", i)  # franka keeps its own table
        assert f.bin_pose.pos[0] >= 0.40 and f.cube_pose.pos[0] >= 0.40


def test_a_robot_without_ranges_is_refused():
    with pytest.raises(ValueError, match="so101"):
        sample_scene(np.random.default_rng(0), "so101", 0)


def test_ranges_that_cannot_keep_the_gap_fail_clearly(monkeypatch):
    same = multiply.SceneRanges(cube_x=(0.5, 0.5), cube_y=(0.0, 0.0), cube_yaw=(0.0, 0.0), bin_x=(0.5, 0.5), bin_y=(0.0, 0.0))
    monkeypatch.setitem(multiply.SCENE_RANGES, "flexiv", same)
    monkeypatch.setattr(multiply, "MAX_SAMPLE_TRIES", 50)
    with pytest.raises(RuntimeError, match="flexiv"):
        sample_scene(np.random.default_rng(0), "flexiv", 0)


@pytest.mark.parametrize("robot,successes", [("flexiv", FLEXIV_SUCCESSES), ("openarm", OPENARM_SUCCESSES)])
def test_fitted_ranges_follow_the_documented_rule(robot, successes):
    # Each axis: the observed successes +-0.02 m, rounded outward to the cm, clipped to the tested Franka range.
    franka, r = multiply.SCENE_RANGES["franka"], multiply.SCENE_RANGES[robot]
    for k, ax in enumerate(("cube_x", "cube_y", "bin_x", "bin_y")):
        v = [p[k] for _, *p in successes]
        lo = max(math.floor(round((min(v) - 0.02) * 100, 6)) / 100, getattr(franka, ax)[0])
        hi = min(math.ceil(round((max(v) + 0.02) * 100, 6)) / 100, getattr(franka, ax)[1])
        assert getattr(r, ax) == pytest.approx((lo, hi)), ax
    assert r.cube_yaw == franka.cube_yaw  # no evidence that yaw matters for reach


# --- sprint 4: the s1 multiply yield (40-48%) as pure geometry (T1 status note, sprint 4 Task 1) ---
# T4's s1 sources are make_experiment_set.make_demo("s1", k) (checked bit for bit against T4's store), and the
# variant scenes are sample_scene(default_rng(seed)) for seed 100000 + 1000 k + j, j < 5. The worker that ran
# them still had the fixed-time handover: all 36 failures lost tracking 1.12-1.30 s after the close, in its
# 1.0-1.5 s blend.

from scripts.make_experiment_set import make_demo  # noqa: E402

S1_RAW_FAILED = [100000, 100001, 100004, 101000, 101001, 101002, 101004, 102001, 102002, 102003, 102004, 103004,
                 104004]


def _s1_case(k: int, j: int):
    demo, _, _ = make_demo("s1", k)
    seed = 100000 + 1000 * k + j
    return demo, seed, sample_scene(np.random.default_rng(seed), "franka", seed)


def _reach(p) -> float:
    return float(np.linalg.norm(np.asarray(p) - FRANKA_SHOULDER, axis=-1).max())


def test_s1_failures_are_the_variants_the_fixed_time_handover_swung_out_of_reach():
    # The old handover put the hand at new_bin + (source hand at close + 1.5 s - source bin) with the hand still
    # above the source cube; for every failed raw variant that point is past anything the expert reaches by >= 80 mm
    # (measured minimum 79.99 mm, seed 100004).
    for seed in S1_RAW_FAILED:
        k, j = divmod(seed - 100000, 1000)
        demo, _, dst = _s1_case(k, j)
        t, p = np.asarray(demo.trajectory.t), np.asarray(demo.trajectory.ee_pos)
        t_close, _ = gripper_events(demo.trajectory)
        swing = p[int(np.argmin(np.abs(t - (t_close + 1.5))))] - demo.scene.bin_pose.pos + np.asarray(dst.bin_pose.pos)
        assert _reach(swing) >= _reach(scripted_expert(dst).ee_pos) + 0.075, seed


@pytest.mark.parametrize("k", range(5))
def test_s1_degraded_variants_now_carry_within_the_experts_reach(k):
    for j in range(5):
        demo, seed, dst = _s1_case(k, j)
        out = np.asarray(transform_trajectory(demo.trajectory, demo.scene, dst).ee_pos)
        expert = np.asarray(scripted_expert(dst).ee_pos)
        assert _reach(out) <= _reach(expert) + 0.01, seed  # measured: <= 7.2 mm over (old code: up to 284 mm)
        t_close, t_open = gripper_events(demo.trajectory)
        t = np.asarray(demo.trajectory.t)
        carry = (t >= t_close) & (t <= t_open)
        # the human's tremor (up to 2.9 mm std) and fading grasp offset stay; measured <= 20.4 mm
        assert _dist_to_path(out[carry], expert).max() < 0.025, seed


# --- yaw wrap (2026-10-20 research note, finding 5): the cube looks the same every 90 degrees -------------------

from demo_pipeline.multiply import nearest_face_yaw  # noqa: E402


def _wrist_yaw(q) -> float:
    """The gripper's turn about the vertical (pointing down: (0, cos a/2, sin a/2, 0) is a turn of a)."""
    w, x, y, z = q
    return math.atan2(2 * (x * y + w * z), 1 - 2 * (y * y + z * z))


@pytest.mark.parametrize("deg, wrapped", [(0, 0), (30, 30), (-44, -44), (60, -30), (-60, 30), (89, -1), (-89, 1),
                                          (90, 0), (135, -45), (180, 0)])
def test_nearest_face_yaw_turns_at_most_45_degrees(deg, wrapped):
    """As the scripted expert wraps the cube's yaw (sim_worker.scripted: yaw - 90 round(yaw / 90))."""
    assert math.degrees(nearest_face_yaw(math.radians(deg))) == pytest.approx(wrapped, abs=1e-9)


@pytest.mark.parametrize("cube_yaw", [0.0, 0.3, -0.5, math.radians(44.9)])
def test_yaw_wrap_changes_nothing_within_45_degrees(cube_yaw):
    """The regression: yaw-0 scenes (and any turn of 45 degrees or less) give exactly the old output."""
    tr = _demo()
    dst = _scene(cube=(0.55, -0.1, 0.025), bin_=(0.45, 0.25, 0.0), cube_yaw=cube_yaw)
    old = transform_trajectory(tr, _scene(), dst)
    new = transform_trajectory(tr, _scene(), dst, wrap_yaw=True)
    assert new == old


def test_yaw_wrap_grasps_the_nearest_face():
    """A cube turned 80 degrees is grasped like one turned -10: the same grasp, so the same labels."""
    tr = _demo()
    turned = transform_trajectory(tr, _scene(), _scene(cube_yaw=math.radians(80)), wrap_yaw=True)
    same = transform_trajectory(tr, _scene(), _scene(cube_yaw=math.radians(-10)))
    np.testing.assert_allclose(turned.ee_pos, same.ee_pos, atol=1e-12)
    np.testing.assert_allclose(turned.ee_quat, same.ee_quat, atol=1e-12)
    i_close = _at(tr, gripper_events(tr)[0])
    assert math.degrees(_wrist_yaw(turned.ee_quat[i_close])) == pytest.approx(-10, abs=1e-6)


def test_yaw_wrap_gives_look_alike_cubes_one_wrist_label():
    """Of many sampled scenes, cubes that look the same (yaw mod 90) get wrist turns at the close that agree, and
    no turn is over 45 degrees; without the wrap the same pairs disagree by up to 90 (research note: 46%)."""
    tr = _demo()
    i_close = _at(tr, gripper_events(tr)[0])
    rng = np.random.default_rng(7)
    for _ in range(40):
        dst = sample_scene(rng, "franka", 0)
        out = transform_trajectory(tr, _scene(), dst, wrap_yaw=True)
        cube_yaw = _yaw(dst.cube_pose.quat_wxyz)
        wrist = _wrist_yaw(out.ee_quat[i_close])
        assert abs(math.degrees(wrist)) <= 45 + 1e-6
        assert math.degrees(wrist) == pytest.approx(math.degrees(nearest_face_yaw(cube_yaw)), abs=1e-6)
