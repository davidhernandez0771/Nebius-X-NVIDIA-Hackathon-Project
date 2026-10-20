"""The example plans the GPU smoke test builds (sim_worker/scene_examples) and the smoke script's commands, without
Isaac."""

from __future__ import annotations

import importlib.util
import json
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


def test_the_smoke_script_runs_settle_plan_once_per_example_with_a_screenshot(tmp_path):
    cmds = _smoke().commands(tmp_path, python="isaac-python")
    assert [n for n, _ in cmds] == [p.stem for p in EXAMPLES]
    for name, cmd in cmds:
        assert cmd[0] == "isaac-python" and cmd[1].endswith("settle_plan.py")
        assert cmd[cmd.index("--screenshot") + 1].endswith(f"{name}.png")


def test_the_smoke_summary_reports_unsettled_plans_and_fails_only_on_crashes(tmp_path):
    def run(cmd):
        out = Path(cmd[cmd.index("--out") + 1])
        if "3_three" in out.name:
            return subprocess.CompletedProcess(cmd, 1)
        errors = ["cube_red fell off cube_green: ..."] if "2_stack" in out.name else []
        out.write_text(json.dumps({"errors": errors, "moved": {"a": 0.001}}), encoding="utf-8")
        return subprocess.CompletedProcess(cmd, 0)

    assert _smoke().main(["--out", str(tmp_path)], run=run) == 1
    rows = json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))
    assert [r["plan"] for r in rows] == [p.stem for p in EXAMPLES]
    assert rows[0]["settled"] and not rows[1]["settled"] and not rows[2]["ran"]
