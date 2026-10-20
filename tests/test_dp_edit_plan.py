"""demo_pipeline.edit_plan: the strict edit language, apply_edits' safety rules and the what-changed report."""
from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from demo_pipeline.edit_plan import (
    REPAIR_BUDGET_M,
    EditError,
    EditPlan,
    apply_edits,
    blend_s,
)
from demo_pipeline.measure import gripper_events
from demo_pipeline.schemas import Trajectory

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
# (time, position) knots; min-jerk between them. A 1 s hold over the bin (5.5-6.5) is the "pause" to cut.
KNOTS = [
    (0.0, (0.35, -0.10, 0.25)),
    (2.0, (0.50, 0.00, 0.025)),   # at the cube; close at 2.2
    (2.5, (0.50, 0.00, 0.025)),
    (3.5, (0.50, 0.00, 0.25)),    # lifted
    (5.5, (0.50, 0.30, 0.25)),    # above the bin
    (6.5, (0.50, 0.30, 0.25)),    # pause
    (7.5, (0.50, 0.30, 0.06)),    # pressed down into the bin; open at 7.8
    (8.0, (0.50, 0.30, 0.06)),
    (9.0, (0.50, 0.30, 0.30)),    # retreat
]
T_CLOSE, T_OPEN = 2.2, 7.8


def _demo() -> Trajectory:
    t = np.arange(round(KNOTS[-1][0] / DT) + 1) * DT
    pos = np.zeros((len(t), 3))
    for (ta, pa), (tb, pb) in zip(KNOTS, KNOTS[1:]):
        m = (t >= ta - 1e-9) & (t <= tb + 1e-9)
        u = (t[m] - ta) / (tb - ta)
        s = u ** 3 * (10 - 15 * u + 6 * u ** 2)
        pos[m] = np.asarray(pa) + s[:, None] * (np.asarray(pb) - np.asarray(pa))
    grip = ((t >= T_CLOSE - 1e-9) & (t < T_OPEN - 1e-9)).astype(int)
    return Trajectory.from_arrays(t, pos, np.tile(IDENTITY, (len(t), 1)), grip)


def _pos(traj: Trajectory, t: float) -> np.ndarray:
    return np.asarray(traj.ee_pos)[int(round(t / DT))]


def test_no_edits_returns_the_demo_unchanged():
    demo = _demo()
    out = apply_edits(demo, [])
    assert out.trajectory == demo
    assert out.report.max_moved_cm == 0 and out.report.moved_steps == 0
    assert out.report.duration_after_s == pytest.approx(9.0)


def test_shift_segment_lifts_the_place_and_blends_outside_it():
    demo = _demo()
    out = apply_edits(demo, [{"op": "shift_segment", "t0": 7.0, "t1": 8.2, "dx": 0, "dy": 0, "dz": 0.04}])
    new = out.trajectory
    for t in (7.0, 7.5, 8.0, 8.2):
        assert _pos(new, t) == pytest.approx(_pos(demo, t) + [0, 0, 0.04], abs=1e-9)
    r = blend_s(0.04)
    for t in (7.0 - r - 0.02, 8.2 + r + 0.02, 2.2):
        assert _pos(new, t) == pytest.approx(_pos(demo, t), abs=1e-12)
    assert out.report.max_moved_cm == pytest.approx(4.0)
    assert new.gripper == demo.gripper and new.t == demo.t


def test_move_point_hits_the_target_at_t():
    demo = _demo()
    target = (0.51, 0.31, 0.10)
    out = apply_edits(demo, [{"op": "move_point", "t": 7.6, "x": target[0], "y": target[1], "z": target[2]}])
    assert _pos(out.trajectory, 7.6) == pytest.approx(target, abs=1e-9)
    assert out.report.max_moved_at == pytest.approx(7.6)


def test_insert_waypoints_passes_through_each_point_and_returns_to_the_path():
    demo = _demo()
    pts = [{"t": t, "x": p[0], "y": p[1], "z": p[2] + 0.03} for t in (4.0, 5.0) for p in [_pos(demo, t)]]
    out = apply_edits(demo, [{"op": "insert_waypoints", "t0": 3.5, "t1": 5.8, "points": pts}])
    for p in pts:
        assert _pos(out.trajectory, p["t"]) == pytest.approx((p["x"], p["y"], p["z"]), abs=1e-9)
    for t in (3.5, 5.8, 1.0, 8.0):
        assert _pos(out.trajectory, t) == pytest.approx(_pos(demo, t), abs=1e-12)


def test_an_edit_over_the_budget_is_rejected_by_the_schema():
    with pytest.raises(ValidationError):
        EditPlan.model_validate({"edits": [{"op": "shift_segment", "t0": 7, "t1": 8, "dz": 0.06}]})
    with pytest.raises(EditError, match="dz"):
        apply_edits(_demo(), [{"op": "shift_segment", "t0": 7, "t1": 8, "dz": 6}])  # centimetres by mistake


def test_edits_that_add_up_past_the_budget_are_rejected():
    edits = [{"op": "shift_segment", "t0": 7.0, "t1": 8.0, "dz": 0.03},
             {"op": "shift_segment", "t0": 7.2, "t1": 7.8, "dz": 0.03}]
    with pytest.raises(EditError, match="over the repair budget: a step moves 6.0 cm"):
        apply_edits(_demo(), edits)


def test_a_move_point_far_from_the_path_is_over_the_budget():
    with pytest.raises(EditError, match="over the repair budget: a step moves 14.0 cm"):
        apply_edits(_demo(), [{"op": "move_point", "t": 7.6, "x": 0.5, "y": 0.3, "z": 0.20}])  # 14 cm up


def test_a_custom_budget():
    edit = [{"op": "shift_segment", "t0": 7.0, "t1": 8.0, "dz": 0.03}]
    apply_edits(_demo(), edit)
    with pytest.raises(EditError, match="max 2 cm"):
        apply_edits(_demo(), edit, budget_m=0.02)


def test_leaving_the_workspace_is_rejected():
    with pytest.raises(EditError, match="outside the workspace"):
        apply_edits(_demo(), [{"op": "move_point", "t": 2.2, "x": 0.5, "y": 0.0, "z": 0.0}])


def test_an_abrupt_edit_is_rejected_as_not_smooth():
    pts = [{"t": 4.00, "x": 0.50, "y": 0.10, "z": 0.29}, {"t": 4.06, "x": 0.50, "y": 0.06, "z": 0.21}]
    with pytest.raises(EditError, match="not smooth"):
        apply_edits(_demo(), [{"op": "insert_waypoints", "t0": 3.9, "t1": 4.2, "points": pts}])


def test_blends_keep_the_edit_under_the_jerk_limit_at_the_full_budget():
    out = apply_edits(_demo(), [{"op": "shift_segment", "t0": 4.0, "t1": 4.02, "dx": 0.05}])
    assert out.report.max_moved_cm == pytest.approx(REPAIR_BUDGET_M * 100)


def test_set_gripper_keeps_holding_when_asked_to_close_at_the_release():
    # "closed at the recorded open" means hold on: it must not move the close at 2.2 and drop the cube mid-carry
    out = apply_edits(_demo(), [{"op": "set_gripper", "t": 7.8, "state": "closed"},
                                {"op": "set_gripper", "t": 8.2, "state": "open"}])
    assert gripper_events(out.trajectory) == (pytest.approx(T_CLOSE), pytest.approx(8.2))


def test_set_gripper_moves_the_release_earlier_or_later():
    demo = _demo()
    earlier = apply_edits(demo, [{"op": "set_gripper", "t": 7.6, "state": "open"}])
    assert gripper_events(earlier.trajectory) == (pytest.approx(T_CLOSE), pytest.approx(7.6))
    assert earlier.report.gripper[0].moved_from == pytest.approx(T_OPEN)
    later = apply_edits(demo, [{"op": "set_gripper", "t": 8.1, "state": "open"}])
    assert gripper_events(later.trajectory)[1] == pytest.approx(8.1)
    assert later.trajectory.ee_pos == demo.ee_pos


def test_set_gripper_adds_a_switch_when_there_is_none():
    demo = _demo()
    never_opens = Trajectory.from_arrays(demo.t, demo.ee_pos, demo.ee_quat, [int(t >= T_CLOSE) for t in demo.t])
    out = apply_edits(never_opens, [{"op": "set_gripper", "t": 7.9, "state": "open"}])
    assert gripper_events(out.trajectory)[1] == pytest.approx(7.9)
    assert out.report.gripper[0].moved_from is None
    regrip = apply_edits(demo, [{"op": "set_gripper", "t": 8.5, "state": "closed"}])  # closes again; never the 2.2 one
    g = np.asarray(regrip.trajectory.gripper)
    assert g[int(round(2.2 / DT))] == 1 and g[int(round(8.0 / DT))] == 0 and g[-1] == 1
    assert regrip.report.gripper[0].moved_from is None
    same = apply_edits(demo, [{"op": "set_gripper", "t": T_CLOSE, "state": "closed"}])  # the switch is already there
    assert same.trajectory == demo and same.report.gripper == []
    with pytest.raises(EditError, match="already open"):
        apply_edits(never_opens, [{"op": "set_gripper", "t": 1.0, "state": "open"}])


def test_cut_removes_a_pause_and_reports_the_timing():
    demo = _demo()
    out = apply_edits(demo, [{"op": "cut", "t0": 5.6, "t1": 6.4}])
    assert out.report.duration_after_s == pytest.approx(9.0 - 0.8)
    assert out.report.timing[0].model_dump() == {"op": "cut", "t0": 5.6, "t1": 6.4, "before_s": pytest.approx(0.8),
                                                 "after_s": 0.0}
    assert out.report.max_moved_cm < 0.1  # the hand was still, so the stitch hardly moves anything
    assert gripper_events(out.trajectory)[1] == pytest.approx(T_OPEN - 0.8)
    assert out.source_t[int(round(5.6 / DT))] == pytest.approx(6.4)


def test_a_cut_over_a_gripper_switch_or_in_mid_motion_is_rejected():
    with pytest.raises(EditError, match="gripper switches inside"):
        apply_edits(_demo(), [{"op": "cut", "t0": 7.6, "t1": 7.9}])
    with pytest.raises(EditError, match="not smooth"):
        apply_edits(_demo(), [{"op": "cut", "t0": 4.0, "t1": 4.6}])  # the carry at full speed


def test_retime_slows_a_span_and_later_edits_keep_original_times():
    demo = _demo()
    out = apply_edits(demo, [{"op": "retime", "t0": 6.5, "t1": 7.5, "factor": 2.0},
                             {"op": "cut", "t0": 5.6, "t1": 6.4}])
    change = out.report.timing[0]
    assert change.before_s == pytest.approx(1.0) and change.after_s == pytest.approx(1.7, abs=0.05)
    assert out.report.duration_after_s == pytest.approx(9.0 + change.after_s - 1.0 - 0.8, abs=0.03)
    assert out.report.max_moved_cm < 0.1  # same path, other timing
    assert gripper_events(out.trajectory)[1] == pytest.approx(T_OPEN + change.after_s - 1.0 - 0.8, abs=0.03)


def test_retime_factor_bounds_and_overlapping_timing_edits():
    with pytest.raises(EditError):
        apply_edits(_demo(), [{"op": "retime", "t0": 6.5, "t1": 7.5, "factor": 0.1}])
    with pytest.raises(EditError, match="overlap"):
        apply_edits(_demo(), [{"op": "retime", "t0": 5.0, "t1": 6.0, "factor": 1.5},
                              {"op": "cut", "t0": 5.8, "t1": 6.3}])


def test_times_past_the_end_and_bad_shapes_are_rejected():
    with pytest.raises(EditError, match="past the demo's end"):
        apply_edits(_demo(), [{"op": "set_gripper", "t": 12.0, "state": "open"}])
    with pytest.raises(EditError):
        apply_edits(_demo(), [{"op": "teleport", "t": 1.0}])
    with pytest.raises(EditError):
        apply_edits(_demo(), [{"op": "shift_segment", "t0": 3.0, "t1": 2.0, "dz": 0.01}])
    with pytest.raises(EditError):
        apply_edits(_demo(), [{"op": "insert_waypoints", "t0": 3.0, "t1": 4.0,
                               "points": [{"t": 4.5, "x": 0.5, "y": 0.0, "z": 0.3}]}])


def test_every_problem_is_reported_at_once():
    edits = [{"op": "move_point", "t": 7.6, "x": 0.5, "y": 0.3, "z": 0.20},
             {"op": "cut", "t0": 7.6, "t1": 7.9}]
    with pytest.raises(EditError) as e:
        apply_edits(_demo(), edits)
    assert len(e.value.errors) == 2


def test_the_what_changed_report_text():
    out = apply_edits(_demo(), [{"op": "shift_segment", "t0": 7.0, "t1": 8.2, "dz": 0.03},
                                {"op": "set_gripper", "t": 7.9, "state": "open"},
                                {"op": "cut", "t0": 5.6, "t1": 6.4}])
    text = out.report.text()
    assert "moved up to 3.0 cm" in text
    assert "duration 9.00 s -> 8.20 s" in text
    assert "cut [5.60, 6.40] 0.80 s -> 0.00 s" in text
    assert "gripper open at 7.90 (was 7.80)" in text
    assert out.report.n_edits == 3
