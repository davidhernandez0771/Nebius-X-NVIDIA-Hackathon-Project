"""demo_pipeline.rules: the code-only detector (spec 8.4) that Nemotron is compared against."""
from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline import rules
from demo_pipeline.degrade import degrade
from demo_pipeline.measure import compute_windows, gripper_events, speed_profile, position_noise
from demo_pipeline.rules import TASK_TEXT, detect_rules
from demo_pipeline.schemas import Pose, Scene, SimSignals, Trajectory
from scripts.score_rules_on_degraded import make_case
from sim_worker.scripted import scripted_expert

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
WAYPOINTS = [np.array(p) for p in [
    (0.35, -0.10, 0.250),  # start
    (0.50, 0.00, 0.175),   # above the cube
    (0.50, 0.00, 0.025),   # at the cube
    (0.50, 0.00, 0.250),   # lifted
    (0.50, 0.30, 0.250),   # above the bin
    (0.50, 0.30, 0.180),   # in the bin
    (0.50, 0.30, 0.330),   # retreated
]]
# ("move", waypoint, seconds) with a minimum-jerk profile, or ("hold", new gripper value, seconds)
# with the gripper switching halfway through the hold.
PLAN = [("move", 1, 1.2), ("move", 2, 1.0), ("hold", 1, 0.5), ("move", 3, 1.5),
        ("move", 4, 2.0), ("move", 5, 1.0), ("hold", 0, 0.5), ("move", 6, 1.0)]


def _clean_arrays():
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
    return np.array(pos), np.array(grip)


def _traj(pos, grip) -> Trajectory:
    n = len(pos)
    return Trajectory.from_arrays(np.arange(n) * DT, pos, np.tile(IDENTITY, (n, 1)), grip)


def _hold_inserted(pos, grip, at_index: int, seconds: float):
    k = int(round(seconds / DT))
    return (np.concatenate([pos[: at_index + 1], np.repeat(pos[at_index : at_index + 1], k, axis=0), pos[at_index + 1 :]]),
            np.concatenate([grip[: at_index + 1], np.repeat(grip[at_index : at_index + 1], k), grip[at_index + 1 :]]))


def _sim(n: int) -> SimSignals:
    return SimSignals(np.zeros((n, 3)), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n))


def _detect(tr: Trajectory):
    return detect_rules(tr, compute_windows(tr, _sim(len(tr.t))))


def _issues(diag, kind):
    return [i for i in diag.issues if i.type == kind]


def _repairs(diag, op):
    return [r for r in diag.repairs if r.op == op]


def test_clean_scripted_demo_is_keep_with_three_segments():
    tr = _traj(*_clean_arrays())
    diag = _detect(tr)
    assert diag.decision == "keep"
    assert diag.issues == [] and diag.repairs == []
    assert diag.label == TASK_TEXT == "pick up the red cube and place it in the blue bin"
    t_close, t_open = gripper_events(tr)
    assert [(s.name, s.t0, s.t1) for s in diag.segments] == pytest.approx(
        [("approach", 0.0, t_close), ("carry", t_close, t_open), ("retreat", t_open, tr.t[-1])])


def test_pause_of_0_9_s_is_found_and_removed():
    pos, grip = _hold_inserted(*_clean_arrays(), at_index=75, seconds=0.9)  # t = 1.5 s, mid-descent
    diag = _detect(_traj(pos, grip))
    assert diag.decision == "repair"
    [pause] = _issues(diag, "pause")
    assert pause.t0 == pytest.approx(1.5, abs=0.04)
    assert pause.t1 == pytest.approx(2.4, abs=0.04)
    [fix] = _repairs(diag, "remove_pause")
    assert (fix.t0, fix.t1) == (pause.t0, pause.t1)
    # The fixture stops instantly from ~0.2 m/s, a real jerk spike, so a jitter finding may come with it.
    assert {i.type for i in diag.issues} <= {"pause", "jitter"}


def test_short_hold_of_0_2_s_is_not_a_pause():
    pos, grip = _hold_inserted(*_clean_arrays(), at_index=75, seconds=0.2)
    diag = _detect(_traj(pos, grip))
    assert _issues(diag, "pause") == []
    assert _repairs(diag, "remove_pause") == []


def test_never_closed_gripper_is_discard():
    pos, grip = _clean_arrays()
    tr = _traj(pos, np.zeros_like(grip))
    diag = _detect(tr)
    assert diag.decision == "discard"
    assert [r.op for r in diag.repairs] == ["discard"]
    diag.check_times(tr.duration)


def test_idle_start_is_trimmed_to_the_active_range():
    pos, grip = _hold_inserted(*_clean_arrays(), at_index=0, seconds=1.0)
    tr = _traj(pos, grip)
    diag = _detect(tr)
    [idle] = _issues(diag, "idle_start_end")
    # the min-jerk start stays under 0.01 m/s for ~0.05 s more, so stillness really ends just after 1.0 s
    assert idle.t0 == pytest.approx(0.0) and idle.t1 == pytest.approx(1.05, abs=0.04)
    [trim] = _repairs(diag, "trim")
    assert trim.t0 == pytest.approx(idle.t1)
    assert trim.t1 == pytest.approx(tr.t[-1])
    assert _issues(diag, "pause") == []


def test_jitter_in_one_window_gets_a_medium_smooth_there():
    pos, grip = _clean_arrays()
    noisy = pos.copy()
    noisy[250:275] += np.random.default_rng(3).normal(0.0, 0.001, size=(25, 3))  # t in [5.0, 5.5), mid-carry
    diag = _detect(_traj(noisy, grip))
    [jitter] = _issues(diag, "jitter")
    assert 4.5 - 1e-9 <= jitter.t0 <= 5.0 + 1e-9 and 5.5 - 1e-9 <= jitter.t1 <= 6.0 + 1e-9
    [smooth] = _repairs(diag, "smooth")
    assert (smooth.t0, smooth.t1, smooth.strength) == (jitter.t0, jitter.t1, "med")
    assert diag.decision == "repair"


def test_rules_never_emit_semantic_issues():
    pos, grip = _hold_inserted(*_clean_arrays(), at_index=75, seconds=0.9)
    diag = _detect(_traj(pos, grip))
    assert not {"grasp_off_center", "wrong_object", "rim_contact", "bad_release"} & {i.type for i in diag.issues}


def test_output_passes_diagnosis_check_times():
    pos, grip = _hold_inserted(*_clean_arrays(), at_index=75, seconds=0.9)
    pos, grip = _hold_inserted(pos, grip, at_index=0, seconds=1.0)
    pos, grip = _hold_inserted(pos, grip, at_index=len(pos) - 1, seconds=1.0)
    tr = _traj(pos, grip)
    diag = _detect(tr)
    assert {"pause", "idle_start_end"} <= {i.type for i in diag.issues}
    diag.check_times(tr.duration)  # raises on any time past the end or overlapping segments


# --- stillness under webcam-like tremor ---------------------------------------------------------

BASE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
             bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=0)


def _paused(jitter_mm: float, seed: int = 2, **kw):
    """The base-scene expert with one 0.9 s pause (or kw), degraded with the given tremor."""
    settings = {"n_pauses": 1, "pause_s": (0.9, 0.9), "grasp_offset_mm": 0.0, **kw}
    return degrade(scripted_expert(BASE), np.random.default_rng(seed), jitter_mm=jitter_mm, **settings)


def test_the_noise_gate_separates_clean_demos_from_quarter_millimetre_tremor():
    for seed in range(20):
        clean, _, _ = make_case(seed, 0.0)
        shaky, _, _ = make_case(seed, 0.25)
        assert position_noise(clean) < rules.NOISE_GATE_M < position_noise(shaky), seed


def test_noise_free_demos_take_the_raw_path_unchanged(monkeypatch):
    clean = [make_case(seed, 0.0)[0] for seed in range(20)]
    default = [_detect(tr) for tr in clean]
    monkeypatch.setattr(rules, "NOISE_GATE_M", float("inf"))  # force the raw-speed path
    assert [_detect(tr) for tr in clean] == default


def test_without_smoothing_tremor_hides_the_pause(monkeypatch):
    tr, _ = _paused(2.0)
    assert _issues(_detect(tr), "pause")
    monkeypatch.setattr(rules, "NOISE_GATE_M", float("inf"))
    assert _issues(_detect(tr), "pause") == []


@pytest.mark.parametrize("jitter_mm", [1.0, 2.0, 4.0])
def test_a_pause_under_tremor_is_found_close_to_its_true_times(jitter_mm):
    tr, truth = _paused(jitter_mm)
    [p] = [i for i in truth if i.type == "pause"]
    diag = _detect(tr)
    [found] = [i for i in _issues(diag, "pause") if i.t0 < p.t1 and p.t0 < i.t1]
    assert found.t0 == pytest.approx(p.t0, abs=0.15) and found.t1 == pytest.approx(p.t1, abs=0.15)
    assert [(r.t0, r.t1) for r in _repairs(diag, "remove_pause") if r.t0 < p.t1 and p.t0 < r.t1] == [(found.t0, found.t1)]


def test_idle_start_and_end_under_tremor_are_found_and_trimmed():
    tr, truth = _paused(2.0, n_pauses=0, idle_start_s=1.0, idle_end_s=1.0)
    diag = _detect(tr)
    got = sorted((i.t0, i.t1) for i in _issues(diag, "idle_start_end"))
    want = sorted((i.t0, i.t1) for i in truth if i.type == "idle_start_end")
    np.testing.assert_allclose(got, want, atol=0.15)
    [trim] = _repairs(diag, "trim")
    assert (trim.t0, trim.t1) == pytest.approx((got[0][1], got[1][0]))


def test_tremor_never_invents_a_pause_where_the_hand_was_moving():
    for seed in range(30):
        shaky, truth, _ = make_case(seed, 2.0)
        calm, _, _ = make_case(seed, 0.0)  # the same demo without the noise (noise is drawn last)
        calm_speed, t = speed_profile(calm), np.asarray(calm.t)
        for p in _issues(_detect(shaky), "pause"):
            inside = (t >= p.t0 - 1e-9) & (t <= p.t1 + 1e-9)
            assert calm_speed[inside].min() < rules.STILL_SPEED, (seed, p)  # the real hand did stop there


def test_widened_still_runs_that_overlap_become_one_pause():
    pos, grip = _hold_inserted(*_clean_arrays(), at_index=250, seconds=0.9)  # t = 5.0 s, mid-carry
    pos, grip = _hold_inserted(pos, grip, at_index=250 + 45 + 2, seconds=0.9)  # 0.04 s of motion between
    pos = pos + np.random.default_rng(0).normal(0.0, 0.002, size=pos.shape)
    diag = _detect(_traj(pos, grip))
    spans = sorted((i.t0, i.t1) for i in _issues(diag, "pause"))
    # smoothing sees two still cores 7 steps apart; widened by 10 steps each they overlap
    assert [s for s in spans if s[1] > 4.9 and s[0] < 7.0] == [pytest.approx((5.08, 6.74), abs=0.05)]
    assert all(a[1] <= b[0] for a, b in zip(spans, spans[1:]))
    cuts = sorted((r.t0, r.t1) for r in _repairs(diag, "remove_pause"))
    assert all(a[1] <= b[0] for a, b in zip(cuts, cuts[1:]))


@pytest.mark.parametrize("jitter_mm", [0.5, 1.0, 4.0])
def test_tremor_over_the_whole_demo_is_one_jitter_finding_and_one_smooth(jitter_mm):
    # a limit relative to the demo's own median window can never flag noise that is everywhere
    tr, _ = _paused(jitter_mm, n_pauses=0)
    diag = _detect(tr)
    [jit] = _issues(diag, "jitter")
    assert (jit.t0, jit.t1) == pytest.approx((0.0, tr.t[-1]))
    [sm] = _repairs(diag, "smooth")
    assert (sm.t0, sm.t1, sm.strength) == (jit.t0, jit.t1, "med")
