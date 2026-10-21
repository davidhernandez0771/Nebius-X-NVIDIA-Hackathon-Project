"""scripts/stage0_inference.py: the pre-registered Stage-0 test (docs/superpowers/notes/2026-10-20-stage0-inference-prereg.md).

Existing checkpoints, inference-only variants: practice seeds first for every variant, then the best non-baseline
variant per checkpoint on the final seeds, compared with that checkpoint's existing result there."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from lerobot_tools.inference import InferenceOptions

REPO = Path(__file__).resolve().parents[1]
PLAN = REPO / "docs/superpowers/notes/2026-10-20-stage0-inference-plan.json"


@pytest.fixture(scope="module")
def s0():
    spec = importlib.util.spec_from_file_location("stage0_inference", REPO / "scripts/stage0_inference.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _plan(tmp_path, **over) -> Path:
    plan = {"run_id": "stage0_test", "practice": {"seed0": 5300, "n": 30}, "final": {"seed0": 5020, "n": 40},
            "targets": [{"name": "mouse_pm10", "checkpoint": "C:/ck/m", "start_state": "C:/ds/m", "primary": True,
                         "baseline": {"successes": 3, "n": 40, "source": "m.json"}},
                        {"name": "scripted_rm10", "checkpoint": "C:/ck/s", "start_state": "C:/ds/s", "primary": False,
                         "baseline": {"successes": 17, "n": 40, "source": "s.json"}}]}
    plan.update(over)
    path = tmp_path / "plan.json"
    path.write_text(json.dumps(plan), encoding="utf-8")
    return path


def test_the_variants_are_the_pre_registered_five_in_order(s0):
    assert list(s0.VARIANTS) == ["S0_baseline", "S1_binarize", "S2_replan20", "S3_ensemble", "S4_binarize_replan20"]
    assert s0.VARIANTS["S0_baseline"] == InferenceOptions()
    assert s0.VARIANTS["S1_binarize"] == InferenceOptions(binarize_gripper=True)
    assert s0.VARIANTS["S2_replan20"] == InferenceOptions(n_action_steps=20)
    assert s0.VARIANTS["S3_ensemble"] == InferenceOptions(temporal_ensemble_coeff=0.01)
    assert s0.VARIANTS["S4_binarize_replan20"] == InferenceOptions(binarize_gripper=True, n_action_steps=20)


def test_the_committed_plan_loads_and_keeps_practice_off_the_final_seeds(s0):
    plan = s0.load_plan(PLAN)
    assert (plan["practice"]["seed0"], plan["practice"]["n"]) == (5300, 30)
    assert (plan["final"]["seed0"], plan["final"]["n"]) == (5020, 40)
    assert [t["name"] for t in plan["targets"]] == ["mouse_pm10", "scripted_rm10"]
    assert [t["primary"] for t in plan["targets"]] == [True, False]
    assert [t["baseline"]["successes"] for t in plan["targets"]] == [3, 17]


def test_an_overlapping_plan_is_refused(s0, tmp_path):
    with pytest.raises(ValueError, match="overlap"):
        s0.load_plan(_plan(tmp_path, practice={"seed0": 5050, "n": 30}))
    with pytest.raises(ValueError, match="one primary"):
        s0.load_plan(_plan(tmp_path, targets=[{"name": "a", "checkpoint": "c", "start_state": "s", "primary": False,
                                               "baseline": {"successes": 1, "n": 40, "source": "x"}}]))


def test_each_eval_is_one_eval_cells_command_with_the_variants_flags(s0, tmp_path):
    plan = s0.load_plan(_plan(tmp_path))
    target = plan["targets"][0]
    cmd = s0.eval_cells_command("py", plan, target, "S4_binarize_replan20", "practice")
    assert cmd[:2] == ["py", str(REPO / "sim_eval/scripts/eval_cells.py")]
    assert cmd[cmd.index("--run-id") + 1] == "stage0_test"
    assert cmd[cmd.index("--checkpoint") + 1] == "mouse_pm10__S4_binarize_replan20__practice=C:/ck/m"
    assert (cmd[cmd.index("--seed0") + 1], cmd[cmd.index("--n") + 1]) == ("5300", "30")
    assert cmd[cmd.index("--start-state") + 1] == "C:/ds/m" and cmd[cmd.index("--start-pose") + 1] == "dataset"
    assert "--binarize-gripper" in cmd and cmd[cmd.index("--n-action-steps") + 1] == "20"
    base = s0.eval_cells_command("py", plan, target, "S0_baseline", "final")
    assert (base[base.index("--seed0") + 1], base[base.index("--n") + 1]) == ("5020", "40")
    assert not {"--binarize-gripper", "--n-action-steps", "--temporal-ensemble"} & set(base)


def test_every_flag_it_passes_is_declared_by_eval_cells(s0, tmp_path):
    import re

    src = (REPO / "sim_eval/scripts/eval_cells.py").read_text("utf-8")
    declared = set(re.findall(r'add_argument\(\s*"(--[a-z0-9_-]+)"', src))
    declared |= set(re.findall(r'add_argument\(\s*"(--[a-z0-9_-]+)"', (REPO / "lerobot_tools/inference.py").read_text("utf-8")))
    plan = s0.load_plan(_plan(tmp_path))
    for variant in s0.VARIANTS:
        flags = {a for a in s0.eval_cells_command("py", plan, plan["targets"][0], variant, "practice") if a.startswith("--")}
        assert flags <= declared, flags - declared


def test_the_best_non_baseline_variant_wins_and_a_tie_goes_to_the_earlier_one(s0):
    practice = {"S0_baseline": (2, 30), "S1_binarize": (4, 30), "S2_replan20": (6, 30), "S3_ensemble": (6, 30),
                "S4_binarize_replan20": (5, 30)}
    assert s0.choose_variant(practice) == "S2_replan20"
    assert s0.choose_variant({**practice, "S0_baseline": (9, 30)}) == "S2_replan20"  # the baseline is never chosen
    with pytest.raises(ValueError, match="missing"):
        s0.choose_variant({"S0_baseline": (2, 30), "S1_binarize": (4, 30)})


def test_the_summary_tests_the_final_result_against_the_existing_baseline(s0, tmp_path):
    plan = s0.load_plan(_plan(tmp_path))
    practice = {t["name"]: {v: (1, 30) for v in s0.VARIANTS} for t in plan["targets"]}
    final = {"mouse_pm10": ("S1_binarize", 11, 40), "scripted_rm10": ("S1_binarize", 18, 40)}
    out = s0.summarize(plan, practice, final)
    m = out["targets"][0]
    assert m["chosen"] == "S1_binarize" and m["final"] == {"successes": 11, "n": 40}
    assert m["baseline"]["successes"] == 3
    assert m["fisher_p"] == pytest.approx(0.0371, abs=1e-3) and m["significant"] is True
    assert out["primary"] == "mouse_pm10" and out["targets"][1]["significant"] is False
    assert m["practice"]["S0_baseline"] == {"successes": 1, "n": 30}
