"""demo_pipeline.results: the real results.json, in the shape web/src/pm/results/results.ts parses."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from demo_pipeline.results import MIMICGEN, build_results

SAMPLE = Path(__file__).resolve().parents[1] / "web" / "src" / "pm" / "mocks" / "results.sample.json"
REG = "C:/data/results/registry.jsonl"


def _row(condition, n, eval_success=None, status="ok", checkpoint=None, evaluated_at="2026-10-17T10:00:00+00:00",
         line=1):
    row = {"run_id": f"grid_{line}", "cell": {"condition": condition, "n_human": n, "name": f"{condition}_{n}"},
           "checkpoint": checkpoint or f"C:/data/experiments/grid/train/{condition}_{n}/pretrained_model",
           "status": status, "eval_success": eval_success, "created": "2026-10-17T09:00:00+00:00"}
    if eval_success is not None:
        row["eval"] = {"success_rate": eval_success, "n": 50, "successes": round(eval_success * 50),
                       "evaluated_at": evaluated_at, "results_file": f"C:/data/evals/{condition}_{n}.json"}
    return (f"{REG}#L{line}", row)


def _eval_file(cell, rate, checkpoint, started="2026-10-17T11:00:00+00:00"):
    return (f"C:/data/evals/{cell}_x.json",
            {"run": {"cell": cell, "checkpoint": checkpoint, "started": started},
             "summary": {"n": 50, "successes": round(rate * 50), "success_rate": rate}})


def _yield(robot, attempts, successes, path=None):
    return (path or f"C:/t2/data/multiply_{robot}/yield.json",
            {"robot": robot, "attempts": attempts, "successes": successes,
             "yield": successes / attempts if attempts else 0.0})


def _types(v):
    """A JSON value's shape: numbers (and null, which stands for a number not yet measured) are 'number'."""
    if isinstance(v, dict):
        return {k: _types(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_types(x) for x in v]
    if v is None or (isinstance(v, (int, float)) and not isinstance(v, bool)):
        return "number"
    return type(v).__name__


def test_shape_matches_the_sample_the_page_parses():
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    out = build_results([], [], [], [])
    for key in ("demos", "series", "ablation", "multiply_yield"):
        assert _types(out[key]) == _types(sample[key]), key
    assert out["sample"] is False and sample["sample"] is True
    assert [(s["key"], s["label"]) for s in out["series"]] == [(s["key"], s["label"]) for s in sample["series"]]
    assert [(b["key"], b["label"]) for b in out["ablation"]["bars"]] == \
        [(b["key"], b["label"]) for b in sample["ablation"]["bars"]]
    assert out["multiply_yield"]["mimicgen"] == sample["multiply_yield"]["mimicgen"] == list(MIMICGEN)
    json.dumps(out)  # plain JSON


def test_nothing_measured_is_all_null_never_zero_and_listed_as_pending():
    out = build_results([], [], [], [])
    assert all(v is None for s in out["series"] for v in s["success"])
    assert all(b["success"] is None for b in out["ablation"]["bars"])
    assert out["multiply_yield"]["ours"] is None
    assert len(out["pending"]) == 3 * 3 + 2 + 1
    for key in out["pending"]:
        src = out["sources"][key]
        assert src["value"] is None and src["file"] is None and src["missing"]


def test_an_evaluated_registry_cell_fills_its_point_with_its_source():
    out = build_results([_row("raw", 5, 0.4, line=3), _row("perfected_multiply", 20, 0.66, line=4)], [], [], [])
    by_key = {s["key"]: s["success"] for s in out["series"]}
    assert by_key["raw"] == [0.4, None, None] and by_key["ours"] == [None, None, 0.66]
    src = out["sources"]["series.raw.success[0]"]
    assert src["value"] == 0.4 and src["file"] == f"{REG}#L3"
    assert src["detail"]["n"] == 50 and src["detail"]["checkpoint"].endswith("raw_5/pretrained_model")
    assert "series.raw.success[0]" not in out["pending"] and "series.raw.success[1]" in out["pending"]


def test_failed_and_unevaluated_cells_stay_null():
    rows = [_row("raw", 5, None, line=1), _row("raw", 10, 0.5, status="failed", line=2)]
    out = build_results(rows, [], [], [])
    assert out["series"][0]["success"] == [None, None, None]
    assert "eval_success" in out["sources"]["series.raw.success[0]"]["missing"]
    # a null still says which records were consulted
    assert out["sources"]["series.raw.success[0]"]["checked"] == [rows[0][0]]
    assert out["sources"]["series.raw.success[1]"]["checked"] == [rows[1][0]]
    assert out["sources"]["series.raw.success[2]"]["checked"] == []


@pytest.mark.parametrize("bad", [1.5, -0.1, "0.4", True, float("nan")])
def test_a_value_that_is_not_a_rate_is_rejected_not_used(bad):
    rows = [(f"{REG}#L1", {**_row("raw", 5, None)[1], "eval_success": bad})]
    out = build_results(rows, [], [], [])
    assert out["series"][0]["success"][0] is None
    assert out["sources"]["series.raw.success[0]"]["rejected"]


def test_the_newest_evaluation_wins_and_the_others_are_listed():
    rows = [_row("raw", 5, 0.3, evaluated_at="2026-10-17T10:00:00+00:00", line=1),
            _row("raw", 5, 0.5, evaluated_at="2026-10-18T10:00:00+00:00", line=2)]
    out = build_results(rows, [], [], [])
    src = out["sources"]["series.raw.success[0]"]
    assert out["series"][0]["success"][0] == 0.5 and src["file"] == f"{REG}#L2"
    assert [o["value"] for o in src["others"]] == [0.3]


def test_an_eval_file_fills_a_cell_the_registry_has_no_eval_for_when_the_checkpoint_matches():
    ck = "C:/data/experiments/grid/train/raw_5/pretrained_model"
    rows = [_row("raw", 5, None, checkpoint=ck), _row("raw", 10, None)]
    evals = [_eval_file("raw_5", 0.42, "c:\\data\\experiments\\grid\\train\\raw_5\\pretrained_model"),
             _eval_file("raw_10", 0.9, "C:/somewhere/else")]
    out = build_results(rows, evals, [], [])
    assert out["series"][0]["success"][:2] == [0.42, None]
    assert out["sources"]["series.raw.success[0]"]["file"] == "C:/data/evals/raw_5_x.json"
    assert "checkpoint" in out["sources"]["series.raw.success[1]"]["rejected"][0]["why"]


def test_an_eval_file_for_a_cell_missing_from_the_registry_is_used_and_flagged():
    out = build_results([], [_eval_file("raw_multiply_10", 0.25, "C:/ck")], [], [])
    assert out["series"][1]["success"][1] == 0.25
    assert out["sources"]["series.raw_multiply.success[1]"]["detail"]["registry_row"] is False


def test_ablation_uses_the_largest_demo_count_with_both_bars_measured():
    rows = [_row("rules_multiply", 5, 0.3, line=1), _row("perfected_multiply", 5, 0.4, line=2),
            _row("rules_multiply", 20, 0.5, line=3), _row("perfected_multiply", 10, 0.45, line=4),
            _row("perfected_multiply", 20, 0.55, line=5), _row("rules_multiply", 40, 0.6, line=6)]
    out = build_results(rows, [], [], [])
    assert out["ablation"]["demos"] == 20  # 5 and 20 have both bars; 10 and 40 have one
    assert [b["success"] for b in out["ablation"]["bars"]] == [0.5, 0.55]
    assert out["sources"]["ablation.bars.rules.success"]["file"] == f"{REG}#L3"


def test_ablation_falls_back_to_the_planned_demo_count_when_no_pair_is_measured():
    out = build_results([_row("rules_multiply", 20, 0.5)], [], [], [], ablation_demos=10)
    assert out["ablation"]["demos"] == 10 and [b["success"] for b in out["ablation"]["bars"]] == [None, None]
    assert "no demo count" in out["sources"]["ablation.demos"]["detail"]["rule"]


def test_multiply_yield_is_the_robots_largest_run():
    ys = [_yield("franka", 2, 2, "C:/t2/data/smoke/yield.json"), _yield("franka", 30, 27),
          _yield("openarm", 30, 0)]
    out = build_results([], [], ys, [])
    assert out["multiply_yield"]["ours"] == 0.9
    src = out["sources"]["multiply_yield.ours"]
    assert src["file"] == "C:/t2/data/multiply_franka/yield.json" and src["detail"]["attempts"] == 30
    assert [o["file"] for o in src["others"]] == ["C:/t2/data/smoke/yield.json"]
    assert build_results([], [], ys, [], robot="flexiv")["multiply_yield"]["ours"] is None


def test_mimicgen_is_the_published_range_with_its_citation():
    src = build_results([], [], [], [])["sources"]["multiply_yield.mimicgen"]
    assert src["value"] == [0.38, 0.74] and "spec" in src["file"]


def test_diagnosis_scores_are_carried_with_their_source():
    scores = [("C:/data/sets/s1/pipeline/rules/scores.json",
               {"set": "C:/data/sets/s1", "diagnoser": "rules", "scored": 10, "not_scored": [{"id": "x"}],
                "counts": {"perfected": 8, "kept": 2, "discarded": 0, "error": 0, "pending": 0},
                "per_type": {"pause": {"tp": 3, "fp": 0, "fn": 1, "ignored": 0, "precision": 1.0, "recall": 0.75,
                                       "f1": 0.857, "mean_iou": 0.8}},
                "rules_types": {"f1": 0.9}, "all": {"f1": 0.7}, "demos": [{"id": "big"}]})]
    d = build_results([], [], [], scores)["diagnosis"]
    assert d == [{"set": "C:/data/sets/s1", "diagnoser": "rules", "scored": 10, "not_scored": 1,
                  "counts": {"perfected": 8, "kept": 2, "discarded": 0, "error": 0, "pending": 0},
                  "per_type": scores[0][1]["per_type"], "rules_types": {"f1": 0.9}, "all": {"f1": 0.7},
                  "source": "C:/data/sets/s1/pipeline/rules/scores.json"}]


def test_demo_counts_on_the_axis_come_from_the_plan_not_the_data():
    out = build_results([_row("raw", 3, 0.1)], [], [], [], demos=(5, 10))
    assert out["demos"] == [5, 10] and all(len(s["success"]) == 2 for s in out["series"])


def _arm(f1, calls=0, cost=0.0, r1=None):
    return {"per_type": {"drop": {"tp": 6, "fp": 0, "fn": 0, "f1": 1.0}}, "total": {"f1": f1},
            "negatives_fp_rate": {"drop": {"episodes": 26, "with_fp": 0, "rate": 0.0}},
            "grasp_fp_rate_on_centered": {"episodes": 8, "with_fp": 1, "rate": 0.125},
            "r1_bar": r1, "model_calls": calls, "est_cost_usd": cost, "fallbacks": 0, "pending": 0,
            "gated_items": 3, "cases_done": 32}


def _ablation(scored, created, arms=None, rejected=()):
    return {"created": created, "out": "x", "manifest": "C:/dev/pm-t1/data/sets/v2/manifest.json",
            "episodes": len(scored), "scored_episodes": list(scored), "rejected": list(rejected), "stopped": None,
            "diagnosers": arms or {}}


def test_diagnosis_ablation_runs_are_carried_per_arm_with_their_source():
    arms = {"code_all": _arm(0.90), "hybrid": _arm(0.86, 35, 0.054, {"recall": 1.0, "passes": True})}
    runs = [("C:/t4/ablation/run2/scores.json", _ablation([f"v2_{i}" for i in range(31)], "2026-10-16T20:24:44-04:00", arms,
                                                         rejected=[{"episode": "v2_31", "reason": "edited"}]))]
    [run] = build_results([], [], [], [], ablations=runs)["diagnosis_ablation"]
    assert run["source"] == "C:/t4/ablation/run2/scores.json"
    assert run["created"] == "2026-10-16T20:24:44-04:00" and run["scored"] == 31 and run["rejected"] == 1
    assert run["manifest"] == "C:/dev/pm-t1/data/sets/v2/manifest.json" and run["stopped"] is None
    assert list(run["arms"]) == ["code_all", "hybrid"]
    h = run["arms"]["hybrid"]
    assert h == {k: arms["hybrid"][k] for k in ("per_type", "total", "negatives_fp_rate", "grasp_fp_rate_on_centered",
                                                "r1_bar", "model_calls", "est_cost_usd", "fallbacks", "pending")}


def test_an_ablation_run_that_scored_nothing_is_listed_with_why_not_as_numbers():
    runs = [("C:/t4/ablation/run1/scores.json",
             _ablation([], "2026-10-16T20:19:28-04:00", {"rules": _arm(None)},
                       rejected=[{"episode": "v2_2000", "reason": "demo.json does not match the manifest"}] * 32)),
            ("C:/t4/ablation/run2/scores.json", _ablation(["a"], "2026-10-16T20:24:44-04:00", {"rules": _arm(0.8)}))]
    out = build_results([], [], [], [], ablations=runs)
    assert [r["source"] for r in out["diagnosis_ablation"]] == ["C:/t4/ablation/run2/scores.json"]
    assert out["diagnosis_ablation_unscored"] == [
        {"file": "C:/t4/ablation/run1/scores.json", "why": "no episode scored (32 rejected)"}]


def test_ablation_runs_are_listed_oldest_first_and_default_to_none():
    runs = [("b", _ablation(["a"], "2026-10-16T21:00:00-04:00")), ("a", _ablation(["a"], "2026-10-16T20:00:00-04:00"))]
    assert [r["source"] for r in build_results([], [], [], [], ablations=runs)["diagnosis_ablation"]] == ["a", "b"]
    out = build_results([], [], [], [])
    assert out["diagnosis_ablation"] == [] and out["diagnosis_ablation_unscored"] == []


def test_a_sprint4_ablation_run_counts_its_episodes_list_as_scored():
    """Before the manifest check (sprint 5), scores.json had no scored_episodes: "episodes" listed what was scored."""
    old = {"created": "2026-10-16T17:21:04-04:00", "episodes": [f"degraded_{i:04d}" for i in range(20)],
           "n_degraded": 20, "clean": "smoke_cam", "stopped": None, "diagnosers": {"rules": _arm(0.7)}}
    out = build_results([], [], [], [], ablations=[("C:/t4/ablation/20261016_s4/scores.json", old)])
    [run] = out["diagnosis_ablation"]
    assert run["scored"] == 20 and run["rejected"] == 0 and out["diagnosis_ablation_unscored"] == []
    assert run["arms"]["rules"]["r1_bar"] is None  # a key the old format lacks stays null
