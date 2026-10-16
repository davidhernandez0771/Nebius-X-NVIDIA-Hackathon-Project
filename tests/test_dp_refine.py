"""demo_pipeline.refine: snap Nemotron's window-aligned times to the per-step data."""
from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.refine import refine_diagnosis
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Diagnosis, Trajectory

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _traj(duration: float, still: list[tuple[float, float]], close: float = 3.0, open_: float = 4.0) -> Trajectory:
    """Moves along x at 0.1 m/s except during the given still spans; closes at `close`, opens at `open_`."""
    t = np.round(np.arange(int(round(duration / DT)) + 1) * DT, 10)
    moving = np.ones_like(t, dtype=bool)
    for a, b in still:
        moving &= ~((t > a + 1e-9) & (t <= b + 1e-9))  # step i covers the motion from t[i-1] to t[i]
    moving[0] = False
    x = np.cumsum(np.where(moving, 0.1 * DT, 0.0))
    pos = np.stack([0.3 + x, np.zeros_like(x), np.full_like(x, 0.2)], axis=1)
    grip = ((t >= close - 1e-9) & (t < open_ - 1e-9)).astype(int)
    return Trajectory.from_arrays(t, pos, np.tile(IDENTITY, (len(t), 1)), grip)


def _diag(issues, repairs, end: float, decision: str = "repair") -> Diagnosis:
    return Diagnosis.model_validate({
        "segments": [{"name": "approach", "t0": 0.0, "t1": 3.0}, {"name": "carry", "t0": 3.0, "t1": 4.0},
                     {"name": "retreat", "t0": 4.0, "t1": end}],
        "issues": issues, "repairs": repairs, "decision": decision, "label": TASK_TEXT,
    })


def _pause(t0, t1):
    return {"type": "pause", "t0": t0, "t1": t1, "evidence": "the hand stops"}


def _remove(t0, t1):
    return {"op": "remove_pause", "t0": t0, "t1": t1}


def _near(actual, expected, tol: float = 0.04) -> None:
    np.testing.assert_allclose(np.asarray(actual, dtype=float).reshape(-1, 2), np.asarray(expected, dtype=float).reshape(-1, 2), atol=tol, rtol=0)


def _ranges(items, kind):
    return [(i.t0, i.t1) for i in items if getattr(i, "type", getattr(i, "op", None)) == kind]


@pytest.mark.parametrize("window", [(1.0, 1.5), (1.5, 2.0)])
def test_window_aligned_pause_snaps_to_the_true_still_run(window):
    tr = _traj(5.0, still=[(1.0, 1.9)])
    out = refine_diagnosis(_diag([_pause(*window)], [_remove(*window)], 5.0), tr)
    [p] = _ranges(out.issues, "pause")
    [r] = _ranges(out.repairs, "remove_pause")
    assert p == pytest.approx((1.0, 1.9), abs=0.04)
    assert r == p
    assert out.decision == "repair"
    out.check_times(tr.duration)


def test_point_pause_snaps_to_a_range():
    tr = _traj(5.0, still=[(1.0, 1.9)])
    out = refine_diagnosis(_diag([{"type": "pause", "t": 1.2, "evidence": "stops"}], [_remove(1.0, 1.5)], 5.0), tr)
    [p] = [i for i in out.issues if i.type == "pause"]
    assert (p.t, p.t0, p.t1) == (None, pytest.approx(1.0, abs=0.04), pytest.approx(1.9, abs=0.04))


def test_spurious_pause_over_real_motion_is_dropped_with_its_repair():
    tr = _traj(5.0, still=[(1.0, 1.9)])
    out = refine_diagnosis(_diag([_pause(2.5, 3.0)], [_remove(2.5, 3.0)], 5.0), tr)
    assert out.issues == [] and out.repairs == []
    assert out.decision == "keep"  # nothing left to repair


def test_a_still_run_shorter_than_a_pause_does_not_rescue_a_spurious_pause():
    tr = _traj(5.0, still=[(2.0, 2.2)])  # 0.2 s: too short to be a pause
    out = refine_diagnosis(_diag([_pause(2.0, 2.5)], [_remove(2.0, 2.5)], 5.0), tr)
    assert out.issues == [] and out.repairs == []


def test_a_hold_while_the_gripper_closes_is_not_a_pause():
    tr = _traj(5.0, still=[(2.8, 3.5)], close=3.0)
    out = refine_diagnosis(_diag([_pause(2.5, 3.5)], [_remove(2.5, 3.5)], 5.0), tr)
    assert out.issues == [] and out.repairs == []


def test_other_issues_and_ops_pass_through_unchanged():
    tr = _traj(5.0, still=[(1.0, 1.9)])
    others_i = [{"type": "jitter", "t0": 2.0, "t1": 2.5, "evidence": "shaky"},
                {"type": "grasp_off_center", "t": 3.0, "evidence": "off center"},
                {"type": "slow", "t0": 0.0, "t1": 5.0, "evidence": "slow"}]
    others_r = [{"op": "smooth", "t0": 2.0, "t1": 2.5, "strength": "high"},
                {"op": "recenter_grasp", "t": 3.0},
                {"op": "retime", "t0": 0.5, "t1": 4.5, "target_speed": 0.2},
                {"op": "replan_transit", "t0": 3.2, "t1": 3.8}]
    diag = _diag([_pause(2.5, 3.0)] + others_i, [_remove(2.5, 3.0)] + others_r, 5.0)
    out = refine_diagnosis(diag, tr)
    assert [i.model_dump() for i in out.issues] == [i.model_dump() for i in diag.issues[1:]]
    assert [r.model_dump() for r in out.repairs] == [r.model_dump() for r in diag.repairs[1:]]
    assert out.segments == diag.segments and out.label == diag.label
    assert out.decision == "repair"


def test_discard_passes_through():
    tr = _traj(5.0, still=[])
    diag = _diag([{"type": "drop", "t": 3.5, "evidence": "fell"}], [{"op": "discard"}], 5.0, decision="discard")
    assert refine_diagnosis(diag, tr) == diag


def test_idle_start_and_end_and_the_trim_snap_to_the_still_ends():
    tr = _traj(6.0, still=[(0.0, 0.8), (5.0, 6.0)])
    diag = _diag([{"type": "idle_start_end", "t0": 0.0, "t1": 0.5, "evidence": "idle"},
                  {"type": "idle_start_end", "t0": 5.5, "t1": 6.0, "evidence": "idle"}],
                 [{"op": "trim", "t0": 0.5, "t1": 5.5}], 6.0)
    out = refine_diagnosis(diag, tr)
    _near(_ranges(out.issues, "idle_start_end"), [(0.0, 0.8), (5.0, 6.0)])
    _near(_ranges(out.repairs, "trim"), [(0.8, 5.0)])
    out.check_times(tr.duration)


def test_trim_keeps_time_to_release_after_the_last_open():
    tr = _traj(6.0, still=[(4.2, 6.0)], open_=4.0)  # still from 4.2, but the release needs until 4.5
    diag = _diag([{"type": "idle_start_end", "t0": 4.5, "t1": 6.0, "evidence": "idle"}],
                 [{"op": "trim", "t0": 0.0, "t1": 5.0}], 6.0)
    out = refine_diagnosis(diag, tr)
    _near(_ranges(out.repairs, "trim"), [(0.0, 4.5)])
    _near(_ranges(out.issues, "idle_start_end"), [(4.5, 6.0)])


def test_idle_and_trim_on_a_demo_with_no_idle_are_dropped():
    tr = _traj(5.0, still=[(2.0, 2.6)])  # an interior pause is not idle time
    diag = _diag([{"type": "idle_start_end", "t0": 0.0, "t1": 0.5, "evidence": "idle"},
                  {"type": "idle_start_end", "t0": 2.0, "t1": 2.5, "evidence": "idle"}],
                 [{"op": "trim", "t0": 0.5, "t1": 4.5}], 5.0)
    out = refine_diagnosis(diag, tr)
    assert out.issues == [] and out.repairs == []
    assert out.decision == "keep"


def test_a_range_over_two_still_runs_snaps_to_the_one_it_overlaps_most():
    tr = _traj(5.0, still=[(1.0, 1.9), (2.2, 2.8)])
    out = refine_diagnosis(_diag([_pause(1.7, 2.5)], [_remove(1.7, 2.5)], 5.0), tr)  # 0.2 s vs 0.3 s overlap
    _near(_ranges(out.issues, "pause"), [(2.2, 2.8)])
    _near(_ranges(out.repairs, "remove_pause"), [(2.2, 2.8)])


def test_idle_start_never_runs_past_the_first_close():
    tr = _traj(5.0, still=[(0.0, 1.5)], close=1.0)  # starts at the cube and grasps while still
    diag = _diag([{"type": "idle_start_end", "t0": 0.0, "t1": 1.5, "evidence": "idle"}],
                 [{"op": "trim", "t0": 1.5, "t1": 5.0}], 5.0)
    out = refine_diagnosis(diag, tr)
    _near(_ranges(out.issues, "idle_start_end"), [(0.0, 1.0)])
    _near(_ranges(out.repairs, "trim"), [(1.0, 5.0)])


def test_two_model_pauses_on_one_still_run_become_one():
    tr = _traj(5.0, still=[(1.0, 1.9)])
    out = refine_diagnosis(_diag([_pause(1.0, 1.5), _pause(1.5, 2.0)], [_remove(1.0, 1.5), _remove(1.5, 2.0)], 5.0), tr)
    assert len(_ranges(out.issues, "pause")) == 1
    assert len(_ranges(out.repairs, "remove_pause")) == 1
