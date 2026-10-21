"""sim_worker.settle: after the plan is built, ~1 s of physics; an object that moved, fell or tipped is a readable
problem for the scene creator's Nemotron loop. Pure; the Isaac run is behind a subprocess (faked here)."""

from __future__ import annotations

import json
import math
import subprocess

import pytest

from demo_pipeline.scene_plan import ScenePlan
from sim_worker.plan_layout import layout_for_plan
from sim_worker.settle import MOVE_TOL_M, SETTLE_S, TILT_TOL_DEG, SettleUnavailable, settle_errors, settle_in_isaac


def _plan() -> ScenePlan:
    return ScenePlan.model_validate({
        "objects": [
            {"id": "red", "kind": "cube", "color": "red", "pose": {"x": 0.45, "y": -0.1}},
            {"id": "green", "kind": "cube", "color": "green", "size": 0.04, "on": "red"},
            {"id": "blue", "kind": "cube", "color": "blue", "pose": {"x": 0.55, "y": 0.05}},
            {"id": "left_bin", "kind": "bin", "color": "yellow", "pose": {"x": 0.5, "y": 0.28}},
        ],
        "goals": [{"object": "green", "bin": "left_bin"}, {"object": "red", "bin": "left_bin"}],
    })


def _poses(plan):
    lay = layout_for_plan(plan)
    return {c: (lay.cube(c).pos, lay.cube(c).quat_wxyz) for c in lay.cube_ids()}


def _yawed(deg):
    return (math.cos(math.radians(deg) / 2), 0.0, 0.0, math.sin(math.radians(deg) / 2))


def _tilted(deg):
    return (math.cos(math.radians(deg) / 2), math.sin(math.radians(deg) / 2), 0.0, 0.0)


def test_a_scene_that_stays_put_has_no_problems():
    before = _poses(_plan())
    assert settle_errors(_plan(), before, dict(before)) == []


def test_a_little_creep_or_a_spin_about_the_vertical_is_fine():
    before = _poses(_plan())
    after = dict(before)
    (x, y, z), _q = before["blue"]
    after["blue"] = ((x + MOVE_TOL_M * 0.9, y, z), _yawed(20))
    assert settle_errors(_plan(), before, after) == []


def test_a_cube_that_slid_is_named_with_how_far():
    before = _poses(_plan())
    after = dict(before)
    (x, y, z), q = before["blue"]
    after["blue"] = ((x + 0.03, y, z), q)
    (err,) = settle_errors(_plan(), before, after)
    assert err.startswith("blue moved 3.0 cm")
    assert f"{SETTLE_S:.0f} s" in err


def test_a_stacked_cube_that_fell_says_which_cube_it_fell_off():
    before = _poses(_plan())
    after = dict(before)
    (x, y, z), q = before["green"]
    after["green"] = ((x + 0.05, y, 0.02), q)
    (err,) = settle_errors(_plan(), before, after)
    assert err.startswith("green fell off red")
    assert "centre it on red" in err


def test_a_tipped_cube():
    before = _poses(_plan())
    after = dict(before)
    pos, _q = before["blue"]
    after["blue"] = (pos, _tilted(TILT_TOL_DEG + 20))
    (err,) = settle_errors(_plan(), before, after)
    assert err.startswith("blue tipped over (30 degrees in 1 s")


def test_a_cube_that_fell_off_the_table():
    before = _poses(_plan())
    after = dict(before)
    after["blue"] = ((0.9, 0.05, -0.6), before["blue"][1])
    (err,) = settle_errors(_plan(), before, after)
    assert err.startswith("blue fell off the table")


def test_missing_poses_are_refused():
    before = _poses(_plan())
    with pytest.raises(ValueError, match="green"):
        settle_errors(_plan(), before, {k: v for k, v in before.items() if k != "green"})


# --- the Isaac run, behind a subprocess ---------------------------------------------------------------

def test_settle_in_isaac_runs_the_script_and_reads_its_errors(tmp_path):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        plan_path = cmd[cmd.index("--plan") + 1]
        out = cmd[cmd.index("--out") + 1]
        assert ScenePlan.model_validate_json(open(plan_path, encoding="utf-8").read()) == _plan()
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"errors": ["green fell off red ..."], "moved": {}}, f)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    errs = settle_in_isaac(_plan(), python="isaac-python", run=run, work_dir=tmp_path)
    assert errs == ["green fell off red ..."]
    assert calls[0][0] == "isaac-python" and calls[0][1].endswith("settle_plan.py")


def test_a_failed_isaac_run_is_not_blamed_on_the_plan(tmp_path):
    def run(cmd, **kw):
        return subprocess.CompletedProcess(cmd, 1, "", "CUDA error")

    with pytest.raises(SettleUnavailable, match="CUDA error"):
        settle_in_isaac(_plan(), python="isaac-python", run=run, work_dir=tmp_path)
