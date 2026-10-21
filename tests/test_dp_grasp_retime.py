"""The grasp retime Neaten op (2026-10-20 research note, finding 4): a human "swoop" grasp (closes while moving, a few
frames near the cube, lifts at once) rewritten into the scripted expert's style within the repair budget."""
from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline import edit_plan, rules
from demo_pipeline.grasp_retime import (BUDGET_M, HOLD_S, HOVER_ABOVE_M, HOVER_S, JITTER_LIMIT, LIFT_M, SLOW_M,
                                        SLOW_SPEED, GraspRetimeError, grasp_stats, is_swoop, retime_grasp)
from demo_pipeline.measure import _jerk_norms, gripper_events
from demo_pipeline.schemas import Pose, Scene, Trajectory
from sim_worker.scripted import scripted_expert

DT = 0.02
DOWN = (0.0, 1.0, 0.0, 0.0)
CUBE = (0.5, 0.0, 0.025)


def _min_jerk(p0, p1, secs):
    n = int(round(secs / DT))
    s = np.arange(1, n + 1) / n
    b = 10 * s**3 - 15 * s**4 + 6 * s**5
    return list(np.asarray(p0) + (np.asarray(p1) - np.asarray(p0)) * b[:, None])


def _swoop(lean=(0.0, 0.0)) -> Trajectory:
    """Like the mouse demos: from home straight down at speed, the close while still descending at ~0.2 m/s (the
    gripper's close step is the lowest point), up at once, carry, release over the bin. lean: the descent comes in
    from this xy offset (m) above the grasp point."""
    home, grasp = np.array([0.45, 0.0, 0.35]), np.array([0.5, 0.0, 0.03])
    above = grasp + [lean[0], lean[1], 0.20]
    pos = [home] + _min_jerk(home, above, 1.0)
    # a smooth straight descent that is still moving fast at the bottom: a min-jerk move toward a point 6 cm under
    # the grasp, cut where it reaches the grasp height (about 0.2 m/s there)
    target = grasp + (grasp - above) * (0.06 / 0.20)
    down = _min_jerk(above, target, 0.9)
    pos += [x for x in down if x[2] > grasp[2] + 1e-9] + [grasp]
    grip = [0] * len(pos)
    grip[-1] = 1  # closes on arrival, still moving
    k = len(pos) - 1
    up = grasp + [0, 0, 0.22]
    pos += _min_jerk(grasp, up, 0.6)
    pos += _min_jerk(up, (0.5, 0.3, 0.25), 1.5)
    pos += _min_jerk((0.5, 0.3, 0.25), (0.5, 0.3, 0.18), 0.6)
    grip += [1] * (len(pos) - len(grip))
    pos += [pos[-1]] * 10
    grip += [0] * 10
    pos += _min_jerk((0.5, 0.3, 0.18), (0.5, 0.3, 0.30), 0.6)
    grip += [0] * (len(pos) - len(grip))
    assert grip[k] == 1 and grip[k - 1] == 0
    n = len(pos)
    return Trajectory.from_arrays(np.arange(n) * DT, np.array(pos), np.tile(DOWN, (n, 1)), grip)


def _scene() -> Scene:
    return Scene(cube_pose=Pose(pos=CUBE, quat_wxyz=(1, 0, 0, 0)), bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1, 0, 0, 0)),
                 robot="franka", seed=0)


def _close(tr: Trajectory) -> int:
    g = np.asarray(tr.gripper)
    return int(np.flatnonzero((g[1:] == 1) & (g[:-1] == 0))[0] + 1)


def test_the_stats_tell_a_swoop_from_the_scripted_grasp():
    s = grasp_stats(_swoop())
    assert s.frames_near < 10 and s.close_speed > 0.15
    assert is_swoop(s)
    e = grasp_stats(scripted_expert(_scene(), home_start=True))
    assert e.frames_near >= 15 and e.close_speed < 0.02  # the research note: 16 frames, 0.01 m/s
    assert not is_swoop(e)
    assert grasp_stats(Trajectory.from_arrays(np.arange(3) * DT, np.zeros((3, 3)) + 0.2, np.tile(DOWN, (3, 1)),
                                              [0, 0, 0])) is None


def test_the_retimed_grasp_hovers_descends_slowly_stops_closes_holds_and_lifts_straight():
    src = _swoop()
    out = retime_grasp(src, gripper_events(src)[0])
    tr = out.trajectory
    p, g = np.asarray(tr.ee_pos), np.asarray(tr.gripper)
    k = _close(tr)
    grasp = np.asarray(src.ee_pos)[_close(src)]
    np.testing.assert_allclose(p[k], grasp, atol=1e-9)  # the person's own grasp point
    # stopped before closing, closed and still for HOLD_S, then straight up LIFT_M before anything else
    assert np.linalg.norm(p[k] - p[k - 1]) < 1e-6
    n_hold = round(HOLD_S / DT)
    np.testing.assert_allclose(p[k : k + n_hold], np.tile(grasp, (n_hold, 1)), atol=1e-9)
    assert np.all(g[k : k + n_hold] == 1)
    rise = np.flatnonzero(p[k:, 2] >= grasp[2] + LIFT_M - 1e-9)[0] + k
    np.testing.assert_allclose(p[k : rise + 1, :2], np.tile(grasp[:2], (rise - k + 1, 1)), atol=1e-9)
    # the last SLOW_M of the descent at no more than SLOW_SPEED, straight down over the grasp point
    speed = np.linalg.norm(np.diff(p, axis=0), axis=1) / DT
    low = np.flatnonzero((p[:k, 2] <= grasp[2] + SLOW_M + 1e-9) & (np.arange(k) > k - 200))
    low = low[low >= np.flatnonzero(p[:k, 2] > grasp[2] + SLOW_M + 1e-9)[-1]]
    assert speed[low[0] : k].max() <= SLOW_SPEED + 1e-9
    # a hover, still, HOVER_ABOVE_M over the grasp point, for HOVER_S
    hover = grasp + [0, 0, HOVER_ABOVE_M]
    at_hover = np.flatnonzero(np.linalg.norm(p[:k] - hover, axis=1) < 1e-9)
    assert len(at_hover) >= round(HOVER_S / DT) and np.all(g[at_hover] == 0)
    # and the stats now match the scripted expert's style
    assert out.after.frames_near >= 15 and out.after.close_speed < 0.02 and not is_swoop(out.after)
    assert out.before == grasp_stats(src)


def test_the_retime_keeps_the_rest_of_the_demo_and_maps_its_times():
    src = _swoop()
    out = retime_grasp(src, gripper_events(src)[0])
    tr, s = out.trajectory, np.asarray(out.source_t)
    # The start of the approach is the person's own, step for step.
    np.testing.assert_allclose(np.asarray(tr.ee_pos)[:20], np.asarray(src.ee_pos)[:20], atol=1e-12)
    # The release happens where it did, later by the time the grasp took.
    t_open_src, t_open_new = gripper_events(src)[1], gripper_events(tr)[1]
    assert out.tmap(np.array([t_open_src]))[0] == pytest.approx(t_open_new, abs=DT)
    i_src, i_new = round(t_open_src / DT), round(t_open_new / DT)
    np.testing.assert_allclose(np.asarray(tr.ee_pos)[i_new:], np.asarray(src.ee_pos)[i_src:], atol=1e-9)
    assert out.added_s == pytest.approx(tr.t[-1] - src.t[-1], abs=1e-9) and out.added_s > 1.0
    # source times only move forward
    assert np.all(np.diff(s) >= -1e-12) and len(s) == len(tr.t)


def test_the_retime_stays_in_the_budget_and_passes_the_jitter_rule():
    src = _swoop(lean=(0.02, -0.01))
    out = retime_grasp(src, gripper_events(src)[0])
    tr = out.trajectory
    base = np.stack([np.interp(out.source_t, src.t, np.asarray(src.ee_pos)[:, k]) for k in range(3)], axis=1)
    moved = np.linalg.norm(np.asarray(tr.ee_pos) - base, axis=1)
    assert moved.max() <= BUDGET_M + 1e-9 and out.max_moved_m == pytest.approx(moved.max())
    windows = edit_plan._window_jerk(np.asarray(tr.t), np.asarray(tr.ee_pos))
    assert max(j for _, _, j in windows) <= JITTER_LIMIT
    assert _jerk_norms(tr).max() < 60  # no single-step spike either


def test_the_budget_and_jitter_limits_are_the_rules():
    assert BUDGET_M == edit_plan.REPAIR_BUDGET_M
    assert JITTER_LIMIT == rules.JITTER_MIN_JERK


def test_a_grasp_that_cannot_be_retimed_in_budget_is_refused():
    with pytest.raises(GraspRetimeError, match="budget"):
        retime_grasp(_swoop(lean=(0.20, 0.0)), 0.0)  # 6 cm off even at the lowest hover tried (6 cm up)


def test_a_demo_that_never_closes_is_refused():
    tr = _swoop()
    flat = Trajectory.from_arrays(tr.t, tr.ee_pos, tr.ee_quat, [0] * len(tr.t))
    with pytest.raises(GraspRetimeError, match="close"):
        retime_grasp(flat, 1.0)


def test_the_scripted_expert_is_left_alone_by_the_rules_and_a_swoop_is_retimed_only_when_asked():
    expert = scripted_expert(_scene(), home_start=True)
    assert not any(r.op == "retime_grasp" for r in rules.detect_rules(expert, [], retime_grasp=True).repairs)
    src = _swoop()
    assert not any(r.op == "retime_grasp" for r in rules.detect_rules(src, []).repairs)  # off by default
    diag = rules.detect_rules(src, [], retime_grasp=True)
    ops = [r for r in diag.repairs if r.op == "retime_grasp"]
    assert len(ops) == 1 and ops[0].t == pytest.approx(gripper_events(src)[0])
    issue = next(i for i in diag.issues if i.type == "swoop_grasp")
    assert "m/s" in issue.evidence and "frames" in issue.evidence
    assert diag.decision == "repair"


def test_a_swoop_out_of_budget_is_reported_but_not_repaired():
    diag = rules.detect_rules(_swoop(lean=(0.20, 0.0)), [], retime_grasp=True)
    assert any(i.type == "swoop_grasp" and "not retimed" in i.evidence for i in diag.issues)
    assert not any(r.op == "retime_grasp" for r in diag.repairs)


def test_apply_repairs_runs_the_retime_in_order_and_maps_later_ops():
    from demo_pipeline.repair import apply_repairs
    from demo_pipeline.schemas import ReleaseAboveBin, RetimeGrasp

    src = _swoop()
    t_close, t_open = gripper_events(src)
    alone = apply_repairs(src, [RetimeGrasp(op="retime_grasp", t=t_close)], _scene(), 0.09)
    assert alone == retime_grasp(src, t_close).trajectory
    both = apply_repairs(src, [ReleaseAboveBin(op="release_above_bin", t=t_open),
                               RetimeGrasp(op="retime_grasp", t=t_close)], _scene(), 0.09)
    # the grasp is retimed, and the release (mapped through the retime's time change) still anchors on the open
    assert grasp_stats(both).frames_near >= 15
    assert gripper_events(both)[1] is not None and both.t[-1] > alone.t[-1] - 1.0


def test_nemotrons_prompts_do_not_change():
    """The new op and issue are rules-only, like release_above_bin: Nemotron's prompts never list them, so earlier
    runs and their pre-registrations keep the prompts they were run with. The hashes were taken before the change."""
    import hashlib

    from app.ai.diagnose import _repair_menu, build_diagnosis_prompt, build_hybrid_prompt
    from demo_pipeline.schemas import Diagnosis, MetricsWindow

    assert not any("retime_grasp" in line for line in _repair_menu())
    w = [MetricsWindow(t0=0.0, t1=0.5, speed=0.1, jerk_rms=3.0, gripper=0, dist_ee_cube=0.2, cube_height=0.025,
                       contact_gripper_cube=False, contact_arm_bin=False, contact_arm_table=False)]
    task = "pick up the red cube and place it in the blue bin"
    plain = build_diagnosis_prompt(task, w, [0.0, 0.5], True, False, ["dropped"])
    hybrid = build_hybrid_prompt(task, w, [0.0, 0.5], True, False,
                                 Diagnosis(segments=[], issues=[], repairs=[], decision="keep", label=task), 1.0,
                                 offset_mm=4.0, failure_reasons=["dropped"])
    assert "swoop" not in plain + hybrid
    assert hashlib.sha256(plain.encode()).hexdigest() == "80aafc08abfa8930ba356bdc3fb5575317bdfd3d16ae8705ce42fd8da3ffa819"
    assert hashlib.sha256(hybrid.encode()).hexdigest() == "9266b6af886da46a760b0fa32f157e1ad064150bd07a5668aec4aae40921d777"


def test_an_emitted_retime_applies_after_the_rules_other_ops():
    """The dry run on the mouse demos (2026-10-20) found a swoop the rules could retime on the raw demo but not after
    their own smooth ops: perfect_demo would then have discarded the whole demo. The rule now checks the demo as the
    earlier ops leave it, so whatever it emits applies."""
    from demo_pipeline.repair import apply_repairs
    from demo_pipeline.schemas import MetricsWindow

    src = _swoop()
    t = np.asarray(src.t)
    rng = np.random.default_rng(3)
    shaky = Trajectory.from_arrays(t, np.asarray(src.ee_pos) + rng.normal(0, 4e-4, (len(t), 3)), src.ee_quat,
                                   src.gripper)
    windows = [MetricsWindow(t0=a, t1=min(a + 0.5, t[-1]), speed=0.1, jerk_rms=60.0, gripper=0, dist_ee_cube=0.1,
                             cube_height=0.025, contact_gripper_cube=False, contact_arm_bin=False,
                             contact_arm_table=False) for a in np.arange(0, t[-1], 0.5)]
    diag = rules.detect_rules(shaky, windows, retime_grasp=True)
    ops = [r.op for r in diag.repairs]
    assert "smooth" in ops
    if "retime_grasp" in ops:
        out = apply_repairs(shaky, diag.repairs, _scene(), 0.09)
        assert grasp_stats(out).frames_near >= 15
    else:  # reported, not repaired: never a repair that would fail
        assert any(i.type == "swoop_grasp" and "not retimed" in i.evidence for i in diag.issues)
