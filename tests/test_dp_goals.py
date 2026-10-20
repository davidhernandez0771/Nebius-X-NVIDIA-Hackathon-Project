"""demo_pipeline.goals: multi-object, multi-step goals.

1. The single cube + bin case gives exactly check_success's reasons (so the same verdict): on every fixture of
   test_dp_success (re-run through a wrapper), on random perturbations of its clean demo, and on real episodes'
   signals (tests/data/goals, extracted from C:\\dev\\pm-t6\\data by scripts/make_goal_fixtures.py).
2. Two- and three-object scenes (goal_scenes): done / not done / dropped / done out of order, with timestamps.
"""

from __future__ import annotations

import dataclasses
import inspect
from pathlib import Path

import numpy as np
import pytest

import test_dp_success as single
from demo_pipeline.goals import Goal, GoalReport, SceneSignals, check_goals, object_series, goals_from_plan
from demo_pipeline.scene_geometry import BIN_INNER
from demo_pipeline.schemas import Pose, Trajectory
from demo_pipeline.success import check_success
import goal_scenes as gs

DATA = Path(__file__).parent / "data" / "goals"


def _goals_reasons(traj, sim, bin_pose, **kw) -> list[str]:
    tcp = kw.pop("tcp_error", None)
    sig = SceneSignals.single(traj, sim, bin_pose, bin_inner=kw.pop("bin_inner", BIN_INNER), tcp_error=tcp)
    return list(check_goals([Goal("cube", "bin")], sig, **kw).reasons)


# --- 1. the single cube + bin case is today's check ---------------------------------------------------

def _single_cases():
    """Every test of test_dp_success, with each of its parametrize cases."""
    for name, f in inspect.getmembers(single, inspect.isfunction):
        if not name.startswith("test_"):
            continue
        marks = [m for m in getattr(f, "pytestmark", []) if m.name == "parametrize"]
        if not marks:
            yield pytest.param(f, {}, id=name)
            continue
        (m,) = marks
        names = [n.strip() for n in m.args[0].split(",")] if isinstance(m.args[0], str) else list(m.args[0])
        for k, values in enumerate(m.args[1]):
            values = values if len(names) > 1 else (values,)
            yield pytest.param(f, dict(zip(names, values)), id=f"{name}[{k}]")


@pytest.mark.parametrize(("test", "params"), list(_single_cases()))
def test_every_check_success_fixture_gives_the_same_reasons(test, params, monkeypatch):
    seen = []

    def both(traj, sim, bin_pose, **kw):
        res = check_success(traj, sim, bin_pose, **kw)
        assert _goals_reasons(traj, sim, bin_pose, **dict(kw)) == res.reasons
        seen.append(res.reasons)
        return res

    monkeypatch.setattr(single, "check_success", both)
    test(**params)
    if "raises" not in test.__name__:
        assert seen, f"{test.__name__} never called check_success"


def test_random_perturbations_give_the_same_reasons():
    rng = np.random.default_rng(7)
    traj, sim = single._clean()
    n = sim.n_steps
    hits = set()
    for _ in range(400):
        cube = sim.cube_pos + rng.normal(0, rng.choice([0.0, 0.005, 0.05]), size=(n, 3)) * (rng.random((n, 1)) < 0.2)
        contact = sim.contact_gripper_cube ^ (rng.random(n) < rng.choice([0.0, 0.01, 0.05]))
        arm_bin, arm_table = rng.random(n) < 0.02, rng.random(n) < 0.02
        force = rng.choice([0.0, 4.9, 5.0, 5.1, 30.0], size=n) * (arm_bin | arm_table | (rng.random(n) < 0.05))
        grip = traj.to_arrays()["gripper"].copy()
        if rng.random() < 0.3:
            grip[-rng.integers(1, 40):] = 1
        t2 = Trajectory.from_arrays(traj.to_arrays()["t"], traj.to_arrays()["ee_pos"], traj.to_arrays()["ee_quat"], grip)
        sim2 = dataclasses.replace(sim, cube_pos=cube, contact_gripper_cube=contact, contact_arm_bin=arm_bin,
                                   contact_arm_table=arm_table, max_contact_force=force)
        bin_pose = Pose(pos=(0.5, 0.3 + rng.normal(0, 0.03), 0.0), quat_wxyz=tuple(np.r_[np.cos(a := rng.uniform(-0.4, 0.4)), 0, 0, np.sin(a)]))
        tcp = None
        if rng.random() < 0.5:
            # Noise plus, sometimes, a run over the 2 cm tolerance either side of the 1 s limit.
            tcp = np.abs(rng.normal(0, 0.005, n))
            if rng.random() < 0.6:
                a, run = rng.integers(0, n // 2), rng.choice([45, 50, 51, 60, 90])
                tcp[a:a + run] = 0.03
        want = check_success(t2, sim2, bin_pose, tcp_error=tcp).reasons
        assert _goals_reasons(t2, sim2, bin_pose, tcp_error=tcp) == want
        hits.update(want)
    # The fuzz reached every reason check_success has.
    assert hits >= {"not_in_bin", "gripper_closed", "not_settled", "collision", "dropped", "high_release", "unreachable"}


REAL = sorted(DATA.glob("*.npz"))


def test_real_episode_fixtures_are_there():
    assert len(REAL) >= 6


@pytest.mark.parametrize("path", REAL, ids=lambda p: p.stem)
def test_real_episodes_give_the_stored_verdict(path):
    with np.load(path, allow_pickle=False) as z:
        traj = Trajectory.from_arrays(z["t"], z["ee_pos"], z["ee_quat"], z["gripper"])
        sim = single.SimSignals(cube_pos=z["cube_pos"], contact_gripper_cube=z["contact_gripper_cube"],
                                contact_arm_bin=z["contact_arm_bin"], contact_arm_table=z["contact_arm_table"],
                                max_contact_force=z["max_contact_force"])
        bin_pose = Pose(pos=tuple(z["bin_pos"]), quat_wxyz=tuple(z["bin_quat_wxyz"]))
        stored = [str(r) for r in z["reasons"]]
        tcp = z["tcp_error"]
    today = check_success(traj, sim, bin_pose, bin_inner=BIN_INNER, tcp_error=tcp).reasons
    assert sorted(today) == sorted(stored)
    assert _goals_reasons(traj, sim, bin_pose, tcp_error=tcp) == today


# --- 2. multi-object scenes ---------------------------------------------------------------------------

def _check(script, goals, **kw) -> GoalReport:
    return check_goals([Goal(*g) for g in goals], gs.build(script), **kw)


TWO = [("red", "left_bin"), ("blue", "right_bin")]


def test_two_cubes_in_order_succeed_with_times():
    rep = _check(gs.two_in_order(), TWO)
    assert rep.success, rep.reasons
    assert [g.state for g in rep.goals] == ["done", "done"]
    red, blue = rep.goals
    assert red.grasped_at == pytest.approx(1.0)
    assert red.released_at == pytest.approx(4.5 - gs.DT)
    # In the bin from the step its centre falls below the rim, part way down.
    assert 4.5 < red.done_at < 4.5 + gs.FALL_S
    assert blue.grasped_at == pytest.approx(6.5)
    assert blue.done_at > red.done_at


def test_reversed_order_is_done_out_of_order_unless_any_order():
    rep = _check(gs.two_reversed(), TWO)
    assert not rep.success
    assert [g.state for g in rep.goals] == ["done", "out_of_order"]
    assert rep.reasons == ("out_of_order",)
    anyway = _check(gs.two_reversed(), TWO, ordered=False)
    assert anyway.success and [g.state for g in anyway.goals] == ["done", "done"]


def test_a_dropped_cube_is_dropped_and_fails_the_scene():
    rep = _check(gs.three_with_drop(), [("red", "left_bin"), ("green", "left_bin"), ("blue", "right_bin")])
    assert [g.state for g in rep.goals] == ["done", "dropped", "out_of_order"]
    green = rep.goals[1]
    assert green.dropped_at == pytest.approx((5.5 + 2.6,))
    assert "dropped" in green.reasons and "not_in_bin" in green.reasons
    assert rep.reasons == ("not_in_bin", "dropped", "out_of_order")
    # In any order, blue is plainly done; green still fails the scene.
    anyway = _check(gs.three_with_drop(), [("red", "left_bin"), ("green", "left_bin"), ("blue", "right_bin")], ordered=False)
    assert [g.state for g in anyway.goals] == ["done", "dropped", "done"]
    assert not anyway.success


def test_a_drop_then_a_regrasp_ends_done_but_still_reports_the_drop():
    rep = _check(gs.drop_then_regrasp(), [("red", "left_bin")])
    (red,) = rep.goals
    assert red.state == "done"
    assert red.dropped_at == pytest.approx((2.6,))
    # Today's check fails any drop off the bin, even one recovered from: so does this one.
    assert rep.reasons == ("dropped",) and not rep.success


def test_the_wrong_bin_is_not_done():
    rep = _check(gs.wrong_bin(), TWO)
    assert [g.state for g in rep.goals] == ["not_done", "out_of_order"]
    assert rep.goals[0].reasons == ("not_in_bin",)
    assert rep.goals[0].done_at is None


def test_a_hard_arm_contact_is_a_collision_for_the_whole_scene():
    s = gs.two_in_order()
    s.force = [(7.0, 7.1, 5.0)]
    assert _check(s, TWO).success  # 5 N is not over the limit
    s.force = [(7.0, 7.1, 5.5)]
    rep = _check(s, TWO)
    assert rep.reasons == ("collision",)
    assert [g.state for g in rep.goals] == ["done", "done"]


def test_object_series_reports_lifted_held_and_in_container():
    sig = gs.build(gs.two_in_order())
    red = object_series(sig, "red")
    t = sig.t
    assert not red.lifted[t < 1.0].any() and red.lifted[(t > 1.5) & (t < 4.4)].all()
    assert red.held[(t >= 1.0) & (t < 4.5 - 1e-9)].all() and not red.held[t >= 4.5].any()
    assert red.in_container["left_bin"][-1] and not red.in_container["right_bin"].any()


def test_unknown_ids_and_bad_shapes_are_refused():
    sig = gs.build(gs.two_in_order())
    with pytest.raises(ValueError, match="no object 'pink'"):
        check_goals([Goal("pink", "left_bin")], sig)
    with pytest.raises(ValueError, match="no container 'top_bin'"):
        check_goals([Goal("red", "top_bin")], sig)
    with pytest.raises(ValueError, match="shape"):
        dataclasses.replace(sig, gripper=sig.gripper[:-1])


def test_goals_come_from_a_scene_plan_shaped_object():
    class PlanGoal:
        def __init__(self, o, b):
            self.object, self.bin = o, b

    class Plan:
        goals = [PlanGoal("red", "left_bin"), PlanGoal("blue", "right_bin")]

    assert goals_from_plan(Plan()) == [Goal("red", "left_bin"), Goal("blue", "right_bin")]
