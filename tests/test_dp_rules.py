"""demo_pipeline.rules: the code-only detector (spec 8.4) that Nemotron is compared against."""
from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.measure import compute_windows, gripper_events
from demo_pipeline.rules import TASK_TEXT, detect_rules
from demo_pipeline.schemas import SimSignals, Trajectory

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
