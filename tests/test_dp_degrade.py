"""demo_pipeline.degrade: webcam-like human demos with ground-truth issue times."""
from __future__ import annotations

import math

import numpy as np
import pytest
from pydantic import ValidationError

from demo_pipeline.degrade import InjectedIssue, degrade
from demo_pipeline.measure import compute_windows, gripper_events, jerk_rms, speed_profile
from demo_pipeline.rules import detect_rules
from demo_pipeline.schemas import Pose, Scene, SimSignals, Trajectory
from sim_worker.scripted import scripted_expert

DT = 0.02
CLEAN_OFF = dict(n_pauses=0, jitter_mm=0.0, grasp_offset_mm=0.0)


def _scene() -> Scene:
    return Scene(
        cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
        bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
        robot="franka",
        seed=0,
    )


@pytest.fixture(scope="module")
def clean() -> Trajectory:
    return scripted_expert(_scene())


def _rng(seed: int = 0) -> np.random.Generator:
    return np.random.default_rng(seed)


def _of(issues, kind):
    return [i for i in issues if i.type == kind]


def _steps_within(tr: Trajectory, t0: float, t1: float) -> np.ndarray:
    t = np.asarray(tr.t)
    return np.flatnonzero((t > t0 + 1e-9) & (t < t1 - 1e-9))


def _runs(g) -> list[int]:
    g = list(g)
    return [v for i, v in enumerate(g) if i == 0 or g[i - 1] != v]


def _sim(n: int) -> SimSignals:
    return SimSignals(np.zeros((n, 3)), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n))


def test_injected_issue_rejects_reversed_times():
    with pytest.raises(ValidationError):
        InjectedIssue(type="pause", t0=2.0, t1=1.0)
    InjectedIssue(type="grasp_off_center", t0=1.0, t1=1.0)  # a point issue


def test_nothing_injected_returns_the_same_demo(clean):
    out, issues = degrade(clean, _rng(), **CLEAN_OFF)
    assert issues == []
    assert out.t == pytest.approx(clean.t)
    np.testing.assert_allclose(out.ee_pos, clean.ee_pos, atol=1e-9)
    np.testing.assert_allclose(out.ee_quat, clean.ee_quat, atol=1e-9)
    assert out.gripper == clean.gripper


def test_pauses_are_exact_holds_of_the_sampled_length_away_from_gripper_events(clean):
    out, issues = degrade(clean, _rng(1), **{**CLEAN_OFF, "n_pauses": 2})
    pauses = _of(issues, "pause")
    assert len(pauses) == 2
    events = [e for e in gripper_events(out) if e is not None]
    pos = np.asarray(out.ee_pos)
    for p in pauses:
        assert 0.5 - 1e-9 <= p.t1 - p.t0 <= 1.2 + 1e-9
        inside = _steps_within(out, p.t0, p.t1)
        assert len(inside) >= 20
        assert np.ptp(pos[inside], axis=0).max() < 1e-9  # the hand does not move during the hold
        for e in events:
            assert min(abs(p.t0 - e), abs(p.t1 - e)) >= 0.3 and not p.t0 <= e <= p.t1
    # pausing adds about the hold plus the ramps' lost half
    assert out.duration > clean.duration + sum(p.t1 - p.t0 for p in pauses)


def test_pauses_over_many_seeds_start_while_moving_away_from_events_with_smooth_stops(clean):
    clean_step = np.linalg.norm(np.diff(np.asarray(clean.ee_pos), axis=0), axis=1).max()
    for seed in range(30):
        out, issues = degrade(clean, _rng(seed), **{**CLEAN_OFF, "n_pauses": 2})
        pos, t = np.asarray(out.ee_pos), np.asarray(out.t)
        steps = np.linalg.norm(np.diff(pos, axis=0), axis=1)
        assert steps.max() <= clean_step + 1e-9  # slowing down never makes the hand jump
        events = [e for e in gripper_events(out) if e is not None]
        for p in _of(issues, "pause"):
            assert all(min(abs(p.t0 - e), abs(p.t1 - e)) >= 0.3 for e in events), (seed, p, events)
            i0 = int(round(p.t0 / DT))
            assert steps[i0 - 1] / DT < 0.01  # it has already slowed to rules-still when the hold starts
            i1 = int(round(p.t1 / DT))
            assert steps[i1] / DT < 0.01  # ...and starts again gently
            travel = np.linalg.norm(pos[i0] - pos[i0 - 10])  # the 0.2 s ramp before the hold
            assert travel > 0.002, (seed, p)  # it was moving, not already resting


def test_idle_start_and_end_are_holds_with_their_times(clean):
    out, issues = degrade(clean, _rng(), **CLEAN_OFF, idle_start_s=1.0, idle_end_s=0.8)
    idle = sorted(_of(issues, "idle_start_end"), key=lambda i: i.t0)
    np.testing.assert_allclose([(i.t0, i.t1) for i in idle], [(0.0, 1.0), (out.t[-1] - 0.8, out.t[-1])], atol=DT)
    pos = np.asarray(out.ee_pos)
    assert np.ptp(pos[: 50], axis=0).max() < 1e-9  # the first 1.0 s
    assert np.ptp(pos[-40:], axis=0).max() < 1e-9  # the last 0.8 s
    assert np.allclose(pos[0], clean.ee_pos[0]) and np.allclose(pos[-1], clean.ee_pos[-1])


def test_slow_factor_stretches_the_demo_and_is_reported(clean):
    out, issues = degrade(clean, _rng(), **CLEAN_OFF, slow_factor=1.5)
    assert out.duration == pytest.approx(1.5 * clean.duration, abs=DT)
    [slow] = _of(issues, "slow")
    assert (slow.t0, slow.t1) == pytest.approx((0.0, out.t[-1]))
    # same path, just slower: the gripper still closes at the cube
    i_close = out.gripper.index(1)
    assert np.allclose(out.ee_pos[i_close], clean.ee_pos[clean.gripper.index(1)], atol=0.002)


def test_jitter_is_low_pass_noise_of_the_given_size_that_raises_jerk(clean):
    out, issues = degrade(clean, _rng(), **{**CLEAN_OFF, "jitter_mm": 2.0})
    [jit] = _of(issues, "jitter")
    assert (jit.t0, jit.t1) == pytest.approx((0.0, out.t[-1]))
    noise = np.asarray(out.ee_pos) - np.asarray(clean.ee_pos)
    assert noise.std(axis=0) == pytest.approx([0.002] * 3, rel=0.1)
    lag1 = [np.corrcoef(noise[:-1, k], noise[1:, k])[0, 1] for k in range(3)]
    assert min(lag1) > 0.6  # tremor-like (about 6 Hz), not white noise (lag-1 correlation near 0)
    assert jerk_rms(out, 0.0, out.t[-1]) > 5 * jerk_rms(clean, 0.0, clean.t[-1])


def test_grasp_offset_moves_the_close_point_by_the_offset_in_xy(clean):
    out, issues = degrade(clean, _rng(4), **{**CLEAN_OFF, "grasp_offset_mm": 8.0})
    i_close, j_close = out.gripper.index(1), clean.gripper.index(1)
    shift = np.asarray(out.ee_pos[i_close]) - np.asarray(clean.ee_pos[j_close])
    assert math.hypot(shift[0], shift[1]) == pytest.approx(0.008, abs=0.001)
    assert abs(shift[2]) < 1e-9
    [off] = _of(issues, "grasp_off_center")
    assert off.t0 == off.t1 == pytest.approx(out.t[i_close])
    # the release over the bin is back on the original path
    assert np.allclose(out.ee_pos[-1], clean.ee_pos[-1], atol=1e-9)


def test_grasp_offset_direction_is_random(clean):
    dirs = set()
    for seed in range(4):
        out, _ = degrade(clean, _rng(seed), **{**CLEAN_OFF, "grasp_offset_mm": 8.0})
        i = out.gripper.index(1)
        d = np.asarray(out.ee_pos[i])[:2] - np.asarray(clean.ee_pos[i])[:2]
        dirs.add(round(math.degrees(math.atan2(d[1], d[0]))))
    assert len(dirs) == 4


def test_rules_find_an_injected_0_9_s_pause_within_0_06_s(clean):
    out, issues = degrade(clean, _rng(2), **{**CLEAN_OFF, "n_pauses": 1}, pause_s=(0.9, 0.9))
    [truth] = _of(issues, "pause")
    assert truth.t1 - truth.t0 == pytest.approx(0.9)
    diag = detect_rules(out, compute_windows(out, _sim(len(out.t))))
    [found] = [i for i in diag.issues if i.type == "pause"]
    assert found.t0 == pytest.approx(truth.t0, abs=0.06)
    assert found.t1 == pytest.approx(truth.t1, abs=0.06)


def test_gripper_events_survive_every_degradation(clean):
    out, issues = degrade(clean, _rng(5), n_pauses=2, jitter_mm=2.0, grasp_offset_mm=8.0,
                          slow_factor=1.3, idle_start_s=0.6, idle_end_s=0.6)
    assert _runs(out.gripper) == _runs(clean.gripper) == [0, 1, 0]
    assert {i.type for i in issues} == {"pause", "jitter", "grasp_off_center", "slow", "idle_start_end"}
    assert np.allclose(np.diff(out.t), DT)
    for i in issues:
        assert 0.0 <= i.t0 <= i.t1 <= out.t[-1] + 1e-9


def test_same_seed_same_output_and_another_seed_differs(clean):
    kw = dict(n_pauses=1, jitter_mm=2.0, grasp_offset_mm=8.0)
    a, ia = degrade(clean, _rng(7), **kw)
    b, ib = degrade(clean, _rng(7), **kw)
    c, _ = degrade(clean, _rng(8), **kw)
    assert a == b and ia == ib
    assert a != c


def test_too_many_pauses_for_the_demo_raise(clean):
    with pytest.raises(ValueError, match="pause"):
        degrade(clean, _rng(), **{**CLEAN_OFF, "n_pauses": 50})


# --- the expert's own stops, reported as don't-care so scoring stays honest ---------------------

def _stops(issues):
    return [i for i in issues if i.dont_care]


def test_expert_stops_are_not_reported_unless_asked(clean):
    _, issues = degrade(clean, _rng(1), n_pauses=1)
    assert _stops(issues) == []
    assert all(i.dont_care is False for i in issues)


def test_expert_stops_mark_where_the_noise_free_hand_nearly_stops_between_moves(clean):
    out, issues = degrade(clean, _rng(1), **CLEAN_OFF, expert_stops=True)
    stops = _stops(issues)
    # the expert rests between lift and carry and between carry and descent; its other waypoints are
    # the close and open holds (gripper changes) and the end of the demo (idle time, not a pause)
    assert len(stops) == 2
    t_close, t_open = gripper_events(out)
    assert all(t_close < s.t0 < s.t1 < t_open for s in stops)
    t, speed, g = np.asarray(out.t), speed_profile(out), np.asarray(out.gripper)
    for s in stops:
        assert s.type == "pause" and s.t1 - s.t0 >= 0.1 - 1e-9
        inside = (t > s.t0 + 1e-9) & (t <= s.t1 + 1e-9)
        assert speed[inside].max() < 0.03  # the hand is (nearly) still throughout
        assert len(set(g[(t >= s.t0 - 1e-9) & (t <= s.t1 + 1e-9)])) == 1  # not a gripper hold
        assert 0.0 < s.t0 and s.t1 < out.t[-1]  # interior: the ends are idle time, not pauses
    assert [i for i in issues if not i.dont_care] == []  # nothing was injected


def test_expert_stops_avoid_injected_holds_and_ignore_the_tremor(clean):
    kw = dict(n_pauses=2, grasp_offset_mm=0.0, idle_start_s=1.0, idle_end_s=1.0, expert_stops=True)
    calm, truth = degrade(clean, _rng(3), jitter_mm=0.0, **kw)
    shaky, shaky_truth = degrade(clean, _rng(3), jitter_mm=4.0, **kw)
    held = [(i.t0, i.t1) for i in truth if not i.dont_care and i.type in ("pause", "idle_start_end")]
    for s in _stops(truth):
        assert all(s.t1 <= h0 + 1e-9 or s.t0 >= h1 - 1e-9 for h0, h1 in held), (s, held)
    # computed on the path before the noise, so the tremor does not move them
    assert [(s.t0, s.t1) for s in _stops(shaky_truth)] == [(s.t0, s.t1) for s in _stops(truth)]


def test_a_slow_factor_stretches_the_expert_stops(clean):
    _, normal = degrade(clean, _rng(1), **CLEAN_OFF, expert_stops=True)
    _, slowed = degrade(clean, _rng(1), **CLEAN_OFF, slow_factor=1.5, expert_stops=True)
    longest = lambda issues: max(s.t1 - s.t0 for s in _stops(issues))  # noqa: E731
    # time stretches by 1.5, and the slower hand also spends more of each ramp under the fixed threshold
    assert longest(slowed) >= 1.5 * longest(normal) - DT


def test_slowed_start_and_end_of_the_expert_are_not_reported_as_stops(clean):
    out, issues = degrade(clean, _rng(1), **CLEAN_OFF, slow_factor=1.6, expert_stops=True)
    assert all(DT < s.t0 and s.t1 < out.t[-1] - DT for s in _stops(issues))  # those are idle time


# --- drop and bad_release (sprint 5): the semantic failures a diagnoser must see ----------------

G = 9.81
BIN_HALF, CUBE_HALF, BIN_RIM_Z = 0.11, 0.025, 0.09  # bin footprint half-size, cube half-size, bin rim height (m)


def _cube_gap(xy, scene: Scene = None) -> float:
    """Horizontal gap (m) between the held cube (any yaw: its half-diagonal) and the bin footprint."""
    b = np.asarray((scene or _scene()).bin_pose.pos[:2])
    d = np.maximum(np.abs(np.asarray(xy)[:2] - b) - BIN_HALF - CUBE_HALF * math.sqrt(2), 0.0)
    return float(np.hypot(*d))


def _opens(tr: Trajectory) -> list[int]:
    g = np.asarray(tr.gripper)
    return [int(i) + 1 for i in np.flatnonzero((g[:-1] == 1) & (g[1:] == 0))]


def test_a_centered_grasp_with_timing_issues_reports_no_grasp_issue(clean):
    """The negatives of set v2: timing issues, and the cube grasped at its center."""
    out, issues = degrade(clean, _rng(3), n_pauses=2, jitter_mm=0.0, grasp_offset_mm=0.0, slow_factor=1.3,
                          idle_start_s=0.7)
    assert {i.type for i in issues} == {"pause", "slow", "idle_start_end"}
    np.testing.assert_allclose(out.ee_pos[out.gripper.index(1)], clean.ee_pos[clean.gripper.index(1)], atol=1e-9)


@pytest.mark.parametrize("kw", [dict(drop=True), dict(bad_release="outside"), dict(bad_release="high")])
def test_drop_and_bad_release_need_the_scene(clean, kw):
    with pytest.raises(ValueError, match="scene"):
        degrade(clean, _rng(), **CLEAN_OFF, **kw)


def test_a_drop_and_a_bad_release_do_not_go_together(clean):
    with pytest.raises(ValueError, match="drop"):
        degrade(clean, _rng(), **CLEAN_OFF, drop=True, bad_release="outside", scene=_scene())


def test_an_unknown_bad_release_kind_raises(clean):
    with pytest.raises(ValueError, match="bad_release"):
        degrade(clean, _rng(), **CLEAN_OFF, bad_release="sideways", scene=_scene())


def test_a_drop_opens_the_gripper_mid_carry_and_only_edits_the_gripper(clean):
    out, issues = degrade(clean, _rng(1), **CLEAN_OFF, drop=True, scene=_scene())
    [drop] = issues
    assert drop.type == "drop" and drop.t0 == drop.t1
    [k] = _opens(out)
    assert drop.t0 == pytest.approx(out.t[k])
    assert _runs(out.gripper) == [0, 1, 0]  # the hand stays open from the drop to the end
    np.testing.assert_allclose(out.ee_pos, clean.ee_pos, atol=1e-12)  # same path: the hand goes on without the cube
    assert k < _opens(clean)[0]


def test_a_drop_happens_in_the_carry_well_away_from_the_bin_over_many_seeds(clean):
    pos, t = np.asarray(clean.ee_pos), np.asarray(clean.t)
    v = np.gradient(pos, t, axis=0)
    i_close = clean.gripper.index(1)
    times = set()
    for seed in range(30):
        out, [drop] = degrade(clean, _rng(seed), **CLEAN_OFF, drop=True, scene=_scene())
        [k] = _opens(out)
        p = pos[k]
        assert k > i_close
        assert p[2] - CUBE_HALF >= 0.05 - 1e-9  # the cube is at least 5 cm above the table
        assert _cube_gap(p) >= 0.05 - 1e-9  # and at least 5 cm from the bin footprint
        assert np.hypot(*v[k, :2]) >= 0.05  # mid-carry: the hand is moving sideways, not lifting
        land = p[:2] + v[k, :2] * math.sqrt(2 * (p[2] - CUBE_HALF) / G)
        assert _cube_gap(land) >= 0.05 - 1e-9  # where the falling cube lands, ignoring bounces
        times.add(round(drop.t0, 2))
    assert len(times) >= 10  # the drop time is random


def test_a_drop_survives_the_timing_degradations_and_pauses_keep_clear_of_it(clean):
    out, issues = degrade(clean, _rng(4), n_pauses=2, jitter_mm=2.0, grasp_offset_mm=0.0, slow_factor=1.3,
                          idle_start_s=0.5, idle_end_s=0.5, drop=True, scene=_scene())
    [drop] = _of(issues, "drop")
    [k] = _opens(out)
    assert drop.t0 == drop.t1 == pytest.approx(out.t[k])
    for p in _of(issues, "pause"):
        assert min(abs(p.t0 - drop.t0), abs(p.t1 - drop.t0)) >= 0.3 - 1e-9
        assert not p.t0 <= drop.t0 <= p.t1


def test_no_room_for_a_drop_raises(clean):
    near = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                 bin_pose=Pose(pos=(0.5, 0.17, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=0)
    with pytest.raises(ValueError, match="drop"):
        degrade(scripted_expert(near), _rng(), **CLEAN_OFF, drop=True, scene=near)


def test_a_bad_release_outside_lets_go_clearly_beside_the_bin_over_many_seeds(clean):
    pos = np.asarray(clean.ee_pos)
    [j] = _opens(clean)
    i_close = clean.gripper.index(1)
    dirs = set()
    for seed in range(20):
        out, issues = degrade(clean, _rng(seed), **CLEAN_OFF, bad_release="outside", scene=_scene())
        [bad] = issues
        assert bad.type == "bad_release" and bad.t0 == bad.t1
        [k] = _opens(out)
        assert k == j and bad.t0 == pytest.approx(out.t[k])
        q = np.asarray(out.ee_pos)
        assert _cube_gap(q[k]) >= 0.05 - 1e-9  # clearly outside the footprint
        assert q[k, 2] == pytest.approx(pos[j, 2], abs=1e-9)  # at the usual release height
        assert 0.40 - 1e-9 <= q[k, 0] <= 0.65 + 1e-9 and -0.30 - 1e-9 <= q[k, 1] <= 0.30 + 1e-9  # Franka's table
        np.testing.assert_allclose(q[: i_close + 1], pos[: i_close + 1], atol=1e-12)  # same approach and grasp
        assert np.linalg.norm(np.diff(q, axis=0), axis=1).max() <= 2 * np.linalg.norm(np.diff(pos, axis=0), axis=1).max()
        d = q[k, :2] - pos[j, :2]
        dirs.add(round(math.degrees(math.atan2(d[1], d[0])), 0))
    assert len(dirs) >= 5


def test_a_bad_release_high_lets_go_over_the_bin_more_than_12_cm_above_its_rim(clean):
    pos = np.asarray(clean.ee_pos)
    [j] = _opens(clean)
    i_close = clean.gripper.index(1)
    for seed in range(10):
        out, [bad] = degrade(clean, _rng(seed), **CLEAN_OFF, bad_release="high", scene=_scene())
        assert bad.type == "bad_release"
        [k] = _opens(out)
        q = np.asarray(out.ee_pos)
        assert bad.t0 == bad.t1 == pytest.approx(out.t[k])
        assert q[k, 2] - CUBE_HALF - BIN_RIM_Z > 0.12  # the cube's bottom, above the rim
        np.testing.assert_allclose(q[k, :2], pos[j, :2], atol=1e-9)  # over the bin center
        np.testing.assert_allclose(q[: i_close + 1], pos[: i_close + 1], atol=1e-12)
        assert np.linalg.norm(np.diff(q, axis=0), axis=1).max() <= 2 * np.linalg.norm(np.diff(pos, axis=0), axis=1).max()


def test_a_bad_release_survives_the_timing_degradations(clean):
    out, issues = degrade(clean, _rng(6), n_pauses=1, jitter_mm=2.0, grasp_offset_mm=8.0, slow_factor=1.2,
                          idle_end_s=0.8, bad_release="outside", scene=_scene())
    [bad] = _of(issues, "bad_release")
    [k] = _opens(out)
    assert bad.t0 == pytest.approx(out.t[k])
    assert {i.type for i in issues} == {"pause", "jitter", "grasp_off_center", "slow", "idle_start_end", "bad_release"}


def test_without_drop_or_bad_release_the_draws_are_unchanged(clean):
    """Old sets (s1, pilot) rebuild bit for bit: the new options draw nothing when they are off."""
    kw = dict(n_pauses=1, jitter_mm=2.0, grasp_offset_mm=8.0)
    a, ia = degrade(clean, _rng(7), **kw)
    b, ib = degrade(clean, _rng(7), **kw, drop=False, bad_release=None, scene=_scene())
    assert a == b and ia == ib


def test_a_carry_below_5_cm_has_no_room_for_a_drop(clean):
    a = clean.to_arrays()
    a["ee_pos"][:, 2] = np.minimum(a["ee_pos"][:, 2], CUBE_HALF + 0.045)  # the cube's bottom 4.5 cm up, at most
    low = Trajectory.from_arrays(a["t"], a["ee_pos"], a["ee_quat"], a["gripper"])
    with pytest.raises(ValueError, match="drop"):
        degrade(low, _rng(), **CLEAN_OFF, drop=True, scene=_scene())


def test_a_bad_release_leaves_an_approach_from_the_bin_side_alone(clean):
    """A start pose on the bin's side (like a fixed home pose) moves toward the bin's side of the carry
    before the grasp; only the carry and what follows may change."""
    a = clean.to_arrays()
    i_close = int(np.argmax(a["gripper"] == 1))
    start = np.array([0.5, 0.3, 0.25])  # over the bin
    s = np.linspace(0.0, 1.0, i_close + 1)[:, None]
    a["ee_pos"][: i_close + 1] = start + s * (a["ee_pos"][i_close] - start)
    home = Trajectory.from_arrays(a["t"], a["ee_pos"], a["ee_quat"], a["gripper"])
    for kind in ("outside", "high"):
        out, _ = degrade(home, _rng(2), **CLEAN_OFF, bad_release=kind, scene=_scene())
        np.testing.assert_allclose(np.asarray(out.ee_pos)[: i_close + 1], a["ee_pos"][: i_close + 1], atol=1e-12)
