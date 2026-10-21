"""The example plans the GPU smoke test builds (sim_worker/scene_examples) and the smoke script's commands, without
Isaac."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest

from demo_pipeline.scene_plan import ScenePlan, validate_plan
from sim_worker.plan_layout import layout_for_plan

REPO = Path(__file__).resolve().parents[1]
EXAMPLES = sorted((REPO / "sim_worker" / "scene_examples").glob("*.json"))


def _smoke():
    spec = importlib.util.spec_from_file_location("scene_smoke", REPO / "sim_worker" / "scripts" / "scene_smoke.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_three_example_plans():
    assert [p.stem for p in EXAMPLES] == ["1_today", "2_stack_of_three_two_bins", "3_three_sizes_two_bins"]


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_each_example_plan_is_valid_and_builds(path):
    plan = ScenePlan.model_validate_json(path.read_text(encoding="utf-8"))
    assert validate_plan(plan) == []
    lay = layout_for_plan(plan)
    assert len(lay.cube_ids()) >= 1 and len(lay.bin_ids()) >= 1


def test_todays_example_is_todays_scene_names():
    lay = layout_for_plan(ScenePlan.model_validate_json(EXAMPLES[0].read_text(encoding="utf-8")))
    assert lay.legacy and lay.cube_ids() == ["cube"]


def test_settle_commands_one_per_example_with_a_screenshot_and_no_lock(tmp_path):
    cmds = _smoke().settle_commands(tmp_path, python="isaac-python")
    assert [n for n, _ in cmds] == [p.stem for p in EXAMPLES]
    for name, cmd in cmds:
        assert cmd[0] == "isaac-python" and cmd[1].endswith("settle_plan.py") and "--no-lock" in cmd
        assert cmd[cmd.index("--screenshot") + 1].endswith(f"{name}.png")


class FakeLock:
    events: list = []

    def __init__(self, **kw):
        FakeLock.events.append(("make", kw.get("task")))

    def __enter__(self):
        FakeLock.events.append("taken")
        return self

    def __exit__(self, *exc):
        FakeLock.events.append("released")


def _fake_world(tmp_path, *, branch_cube_dx=0.0, crash_settle=None, raise_in=None):
    """A runner that plays every stage: the unit tests pass, the replays write episode folders, the settles write
    their results."""
    from test_sim_regression import _write

    eps = [_write(tmp_path / "stored" / n) for n in ("ep_a", "ep_b")]
    calls = []

    def run(cmd, cwd=None, **kw):
        calls.append(cmd)
        if raise_in and raise_in in " ".join(map(str, cmd)):
            raise RuntimeError("boom")
        if "replay_regression.py" in cmd[1]:
            label = cmd[cmd.index("--label") + 1]
            out = Path(cmd[cmd.index("--out") + 1])
            for k in (1, 2):
                for ep in eps:
                    _write(out / label / f"run{k}" / ep.name, cube_dx=branch_cube_dx if label == "branch" else 0.0)
        elif "settle_plan.py" in cmd[1]:
            out = Path(cmd[cmd.index("--out") + 1])
            if crash_settle and crash_settle in out.name:
                return subprocess.CompletedProcess(cmd, 1)
            out.write_text(json.dumps({"errors": [], "moved": {"a": 0.001}}), encoding="utf-8")
        return subprocess.CompletedProcess(cmd, 0)

    return eps, calls, run


def _main(tmp_path, eps, run):
    FakeLock.events = []
    return _smoke().main(["--out", str(tmp_path / "out"), "--episodes", *map(str, eps)], run=run, lock=FakeLock,
                         export=lambda dest: dest.mkdir(parents=True, exist_ok=True) or "abc1234")


def test_one_command_unit_tests_then_replay_regression_then_settles_under_one_lock(tmp_path):
    eps, calls, run = _fake_world(tmp_path)
    assert _main(tmp_path, eps, run) == 0
    assert FakeLock.events == [("make", "scene-smoke"), "taken", "released"]
    kinds = [("pytest" if "pytest" in c else Path(c[1]).name) for c in calls]
    assert kinds == ["pytest", "replay_regression.py", "replay_regression.py", "settle_plan.py", "settle_plan.py", "settle_plan.py"]
    base, branch = calls[1], calls[2]
    assert base[base.index("--label") + 1] == "base" and branch[branch.index("--label") + 1] == "branch"
    assert Path(base[base.index("--code") + 1]).name == "base_code" and "--no-lock" in base and "--no-lock" in branch
    out = tmp_path / "out"
    summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    assert summary["regression"]["verdicts"] == {"ep_a": "identical", "ep_b": "identical"}
    assert summary["regression"]["base_commit"] == "abc1234"
    assert "identical" in (out / "regression.md").read_text(encoding="utf-8")


def test_the_unit_tests_import_this_checkout_and_write_their_log(tmp_path):
    # Isaac's venv has an editable install of the project pointing at another worktree's src (C:\dev\pm-t2\src on
    # 2026-10-20), so the pytest stage must put this checkout's src first or it tests someone else's demo_pipeline.
    eps, calls, run = _fake_world(tmp_path)
    seen = {}

    def run_logged(cmd, cwd=None, **kw):
        if "pytest" in cmd:
            seen.update(kw)
            kw["stdout"].write("1 passed\n")
        return run(cmd, cwd=cwd, **kw)

    assert _main(tmp_path, eps, run_logged) == 0
    src = str(_smoke().REPO / "src")
    assert seen["env"]["PYTHONPATH"].split(os.pathsep)[0] == src
    assert "1 passed" in (tmp_path / "out" / "unit_tests.log").read_text(encoding="utf-8")


def test_a_replay_that_differs_from_the_base_fails_the_smoke_test(tmp_path):
    eps, calls, run = _fake_world(tmp_path, branch_cube_dx=0.01)
    assert _main(tmp_path, eps, run) == 1
    summary = json.loads((tmp_path / "out" / "summary.json").read_text(encoding="utf-8"))
    assert set(summary["regression"]["verdicts"].values()) == {"DIFFERS"}


def test_the_lock_is_released_when_a_stage_blows_up(tmp_path):
    eps, calls, run = _fake_world(tmp_path, raise_in="replay_regression")
    with pytest.raises(RuntimeError, match="boom"):
        _main(tmp_path, eps, run)
    assert FakeLock.events[-1] == "released"


def test_an_unsettled_plan_is_reported_and_a_crashed_settle_fails(tmp_path):
    eps, calls, run = _fake_world(tmp_path, crash_settle="3_three")
    assert _main(tmp_path, eps, run) == 1
    summary = json.loads((tmp_path / "out" / "summary.json").read_text(encoding="utf-8"))
    rows = summary["settle"]
    assert rows[0]["settled"] and not rows[2]["ran"]


def test_the_base_code_is_the_branch_point_exported_read_only(tmp_path):
    commit = _smoke().export_base(tmp_path / "base_code")
    assert len(commit) == 40
    want = subprocess.run(["git", "show", f"{commit}:sim_worker/replay.py"], cwd=REPO, capture_output=True, check=True).stdout
    got = (tmp_path / "base_code" / "sim_worker" / "replay.py").read_bytes()
    assert got.replace(b"\r\n", b"\n") == want.replace(b"\r\n", b"\n")
    assert b"ObjectRecorder" not in got  # the code before this branch's replay change
    assert (tmp_path / "base_code" / "src" / "demo_pipeline" / "success.py").exists()
