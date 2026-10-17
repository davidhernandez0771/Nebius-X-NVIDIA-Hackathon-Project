"""scripts/build_results_json.py: collect the measured inputs from disk and write DATA_DIR/results/results.json."""
from __future__ import annotations

import json
import os

import pytest

from scripts import build_results_json as brj


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")


def _row(condition, n, eval_success, status="ok"):
    return {"run_id": "g1", "cell": {"condition": condition, "n_human": n, "name": f"{condition}_{n}"},
            "checkpoint": f"C:/ck/{condition}_{n}", "status": status, "eval_success": eval_success,
            "eval": {"success_rate": eval_success, "n": 50, "evaluated_at": "2026-10-17T10:00:00+00:00"}
            if eval_success is not None else None}


def _populate(data, t2):
    reg = data / "results" / "registry.jsonl"
    lines = [json.dumps(_row("raw", 5, 0.2)), "{not json", "", json.dumps(_row("raw_multiply", 5, None))]
    _write(reg, "\n".join(lines) + "\n")
    _write(data / "evals" / "raw_multiply_5_20261017.json",
           {"run": {"cell": "raw_multiply_5", "checkpoint": "C:/ck/raw_multiply_5", "started": "2026-10-17"},
            "summary": {"n": 50, "successes": 15, "success_rate": 0.3}})
    _write(data / "sets" / "s1" / "pipeline" / "rules" / "scores.json",
           {"set": "s1", "diagnoser": "rules", "scored": 4, "not_scored": [], "counts": {}, "per_type": {},
            "rules_types": {}, "all": {}})
    _write(t2 / "multiply_franka" / "yield.json", {"robot": "franka", "attempts": 30, "successes": 27, "yield": 0.9})
    _write(t2 / "multiply_openarm" / "yield.json", {"robot": "openarm", "attempts": 30, "successes": 0, "yield": 0.0})
    _write(t2 / "multiply_franka" / "rejected" / "var_0115" / "verification.json", {"success": False})


def test_collects_every_input_and_writes_results_json(tmp_path):
    data, t2 = tmp_path / "data", tmp_path / "t2data"
    _populate(data, t2)
    out = brj.build(data, t2_data=[t2])
    assert out == data / "results" / "results.json"
    r = json.loads(out.read_text(encoding="utf-8"))
    assert r["sample"] is False
    assert r["series"][0]["success"] == [0.2, None, None]  # raw_5 from the registry
    assert r["series"][1]["success"][0] == 0.3  # raw_multiply_5 from its eval file (registry not updated)
    assert r["multiply_yield"]["ours"] == 0.9
    reg = str(data / "results" / "registry.jsonl")
    assert r["sources"]["series.raw.success[0]"]["file"] == f"{reg}#L1"
    assert r["sources"]["multiply_yield.ours"]["file"] == str(t2 / "multiply_franka" / "yield.json")
    assert r["diagnosis"][0]["source"] == str(data / "sets" / "s1" / "pipeline" / "rules" / "scores.json")
    assert r["skipped_inputs"] == [{"file": f"{reg}#L2", "error": r["skipped_inputs"][0]["error"]}]
    assert sorted(r["inputs"]) == ["ablations", "evals", "registry", "scores", "yields"]
    assert len(r["inputs"]["yields"]) == 2 and r["generated_at"]


def test_with_nothing_measured_the_file_is_all_pending(tmp_path):
    r = json.loads(brj.build(tmp_path / "empty").read_text(encoding="utf-8"))
    assert r["multiply_yield"]["ours"] is None and len(r["pending"]) == 12
    assert r["inputs"] == {"registry": [], "evals": [], "yields": [], "scores": [], "ablations": []}


def test_a_corrupt_input_file_is_skipped_and_recorded(tmp_path):
    data = tmp_path / "data"
    _write(data / "evals" / "broken.json", "{")
    r = json.loads(brj.build(data).read_text(encoding="utf-8"))
    assert [s["file"] for s in r["skipped_inputs"]] == [str(data / "evals" / "broken.json")]


def test_a_tie_in_yield_size_goes_to_the_newest_file(tmp_path):
    data = tmp_path / "data"
    _write(data / "old" / "yield.json", {"robot": "franka", "attempts": 30, "successes": 27, "yield": 0.9})
    _write(data / "new" / "yield.json", {"robot": "franka", "attempts": 30, "successes": 30, "yield": 1.0})
    os.utime(data / "old" / "yield.json", (1_000_000_000, 1_000_000_000))
    r = json.loads(brj.build(data).read_text(encoding="utf-8"))
    assert r["multiply_yield"]["ours"] == 1.0


def test_cli_defaults_to_data_dir(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "dd"))
    assert brj.main([]) == 0
    assert (tmp_path / "dd" / "results" / "results.json").is_file()
    assert "pending" in capsys.readouterr().out


def test_json_that_is_not_an_object_is_skipped_too(tmp_path):
    data = tmp_path / "data"
    _write(data / "evals" / "list.json", "[1, 2]")
    _write(data / "results" / "registry.jsonl", "3\n" + json.dumps(_row("raw", 5, 0.2)) + "\n")
    r = json.loads(brj.build(data).read_text(encoding="utf-8"))
    reg = str(data / "results" / "registry.jsonl")
    assert sorted(s["file"] for s in r["skipped_inputs"]) == sorted([str(data / "evals" / "list.json"), f"{reg}#L1"])
    assert r["series"][0]["success"][0] == 0.2


def test_input_roots_add_their_registry_evals_yields_and_scores_with_true_provenance(tmp_path):
    data, t3, t4 = tmp_path / "data", tmp_path / "t3data", tmp_path / "t4data"
    _write(t3 / "results" / "registry.jsonl", json.dumps(_row("raw", 5, 0.25)) + "\n")
    _write(t4 / "sets" / "s1" / "pipeline" / "rules" / "scores.json",
           {"set": "s1", "diagnoser": "rules", "scored": 5, "not_scored": [], "counts": {}, "per_type": {},
            "rules_types": {}, "all": {}})
    _write(t4 / "multiply_franka" / "yield.json", {"robot": "franka", "attempts": 10, "successes": 9, "yield": 0.9})
    r = json.loads(brj.build(data, input_roots=[t3, t4]).read_text(encoding="utf-8"))
    assert r["series"][0]["success"][0] == 0.25
    assert r["sources"]["series.raw.success[0]"]["file"] == f"{t3 / 'results' / 'registry.jsonl'}#L1"
    assert r["diagnosis"][0]["source"] == str(t4 / "sets" / "s1" / "pipeline" / "rules" / "scores.json")
    assert r["multiply_yield"]["ours"] == 0.9
    assert (data / "results" / "results.json").is_file() and not (t3 / "results" / "results.json").exists()


def _eval(cell, rate, ck=None):
    return {"run": {"cell": cell, "checkpoint": ck or f"C:/ck/{cell}", "started": "2026-10-17"},
            "summary": {"n": 20, "successes": round(rate * 20), "success_rate": rate}}


def test_eval_files_in_per_run_folders_are_read(tmp_path):
    """sim_eval writes evals/<run_id>/<cell>.json (sprint 5); an eval whose registry update failed still counts."""
    data, t3 = tmp_path / "data", tmp_path / "t3data"
    _write(t3 / "evals" / "g2" / "raw_10.json", _eval("raw_10", 0.15))
    _write(t3 / "evals" / "g2" / "raw_10.episodes.jsonl", "{}\n")  # not a results file
    r = json.loads(brj.build(data, input_roots=[t3]).read_text(encoding="utf-8"))
    assert r["series"][0]["success"][1] == 0.15
    assert r["sources"]["series.raw.success[1]"]["file"] == str(t3 / "evals" / "g2" / "raw_10.json")
    assert r["inputs"]["evals"] == [str(t3 / "evals" / "g2" / "raw_10.json")]


def _two_runs(t3):
    old = {**_row("raw", 10, 0.0), "run_id": "old"}
    new = {**_row("raw", 10, 0.3), "run_id": "home"}
    new["eval"] = {**new["eval"], "evaluated_at": "2026-10-17T11:00:00+00:00"}
    five = {**_row("raw", 5, 0.0), "run_id": "old"}
    _write(t3 / "results" / "registry.jsonl", "\n".join(json.dumps(x) for x in (old, five, new)) + "\n")
    _write(t3 / "evals" / "old" / "raw_5.json", _eval("raw_5", 0.0))
    _write(t3 / "evals" / "home" / "raw_multiply_10.json", _eval("raw_multiply_10", 0.5))


def test_without_a_run_id_every_run_counts_and_the_newest_wins(tmp_path):
    data, t3 = tmp_path / "data", tmp_path / "t3data"
    _two_runs(t3)
    r = json.loads(brj.build(data, input_roots=[t3]).read_text(encoding="utf-8"))
    assert r["series"][0]["success"][:2] == [0.0, 0.3]


def test_run_ids_keep_one_experiment_on_the_chart_and_record_what_was_left_out(tmp_path):
    data, t3 = tmp_path / "data", tmp_path / "t3data"
    _two_runs(t3)
    reg = t3 / "results" / "registry.jsonl"
    r = json.loads(brj.build(data, input_roots=[t3], run_ids=["home"]).read_text(encoding="utf-8"))
    assert r["series"][0]["success"][:2] == [None, 0.3]  # old's raw_5 is not mixed in
    assert r["series"][1]["success"][1] == 0.5  # home's eval file (no registry row) still counts
    assert r["sources"]["series.raw.success[1]"]["file"] == f"{reg}#L3"
    assert "others" not in r["sources"]["series.raw.success[1]"]
    assert r["run_ids"] == ["home"]
    assert r["inputs"]["registry"] == [f"{reg}#L3"]
    assert sorted(r["excluded_by_run_id"]) == sorted(
        [f"{reg}#L1", f"{reg}#L2", str(t3 / "evals" / "old" / "raw_5.json")])


def test_the_cli_takes_run_ids(tmp_path, capsys):
    data, t3 = tmp_path / "data", tmp_path / "t3data"
    _two_runs(t3)
    brj.main(["--data-dir", str(data), "--input-root", str(t3), "--run-id", "old", "--demos", "5,10"])
    r = json.loads((data / "results" / "results.json").read_text(encoding="utf-8"))
    assert r["series"][0]["success"] == [0.0, 0.0] and r["run_ids"] == ["old"]


def test_input_roots_add_t4s_ablation_runs(tmp_path):
    data, t4 = tmp_path / "data", tmp_path / "t4data"
    _write(t4 / "ablation" / "v2_run2" / "scores.json",
           {"created": "2026-10-16T20:24:44-04:00", "scored_episodes": ["v2_2000"], "rejected": [],
            "diagnosers": {"rules": {"total": {"f1": 0.81}}}})
    _write(t4 / "ablation" / "v2_run2" / "cases" / "v2_2000__rules.json", {"x": 1})
    r = json.loads(brj.build(data, input_roots=[t4]).read_text(encoding="utf-8"))
    [run] = r["diagnosis_ablation"]
    assert run["source"] == str(t4 / "ablation" / "v2_run2" / "scores.json")
    assert run["arms"]["rules"]["total"] == {"f1": 0.81}
    assert r["inputs"]["ablations"] == [str(t4 / "ablation" / "v2_run2" / "scores.json")]


def test_t2_roots_add_the_yield_folder_and_dataset_manifests_but_not_per_demo_yields(tmp_path):
    data, t2 = tmp_path / "data", tmp_path / "t2data"
    _write(t2 / "yield" / "clean_franka_s4.json", {"robot": "franka", "attempts": 30, "successes": 30, "yield": 1.0})
    _write(t2 / "yield" / "s4_s1" / "s1_0000.json", {"robot": "franka", "attempts": 40, "successes": 10, "yield": 0.25})
    _write(t2 / "episodes" / "home_v1_manifest.json",
           {"name": "home_v1", "robot": "franka", "variant_attempts": 100, "variant_successes": 100, "yield": 1.0})
    _write(t2 / "episodes" / "home_v1_grid.json", {"name": "home_mult", "cells": []})
    _write(t2 / "episodes" / "v2_manifest.json", {"name": "v2", "robot": "franka", "demos": []})  # a set, no yield
    r = json.loads(brj.build(data, t2_data=[t2]).read_text(encoding="utf-8"))
    assert sorted(r["inputs"]["yields"]) == sorted(
        [str(t2 / "yield" / "clean_franka_s4.json"), str(t2 / "episodes" / "home_v1_manifest.json")])
    assert r["multiply_yield"]["ours"] == 1.0
    assert r["sources"]["multiply_yield.ours"]["file"] == str(t2 / "episodes" / "home_v1_manifest.json")
    assert "rejected" not in r["sources"]["multiply_yield.ours"]


def test_the_cli_prints_each_points_counts_and_wilson_ci(tmp_path, capsys):
    data, t2 = tmp_path / "data", tmp_path / "t2"
    _populate(data, t2)
    brj.main(["--data-dir", str(data), "--t2-data", str(t2)])
    lines = {ln.split(" = ")[0].strip(): ln for ln in capsys.readouterr().out.splitlines() if " = " in ln}
    assert "0.3 (15/50, Wilson 95% CI 19.1-43.8%)" in lines["series.raw_multiply.success[0]"]
    assert "no CI: successes is not an integer" in lines["series.raw.success[0]"]  # the row has no counts
    assert "CI" not in lines["multiply_yield.ours"]


def test_the_cli_takes_comparisons_and_prints_each_arm(tmp_path, capsys):
    data, t3 = tmp_path / "data", tmp_path / "t3data"
    for cell, k in (("raw_10_30k", 4), ("raw_multiply_10_30k", 15)):
        _write(t3 / "evals" / "r7" / f"{cell}.json",
               {"run": {"cell": cell, "checkpoint": f"C:/ck/{cell}", "started": "2026-10-17T12:00"},
                "summary": {"n": 70, "successes": k, "success_rate": k / 70}})
    brj.main(["--data-dir", str(data), "--input-root", str(t3), "--compare", "raw_10_30k:raw_multiply_10_30k"])
    out = capsys.readouterr().out
    r = json.loads((data / "results" / "results.json").read_text(encoding="utf-8"))
    assert [a["cell"] for a in r["comparisons"][0]["arms"]] == ["raw_10_30k", "raw_multiply_10_30k"]
    assert "comparisons[0].raw_multiply_10_30k = " in out and "(15/70, Wilson 95% CI" in out
    assert "raw_10_30k vs raw_multiply_10_30k: Fisher exact p = 0.012" in out


def test_a_comparison_that_is_not_two_cells_is_refused(tmp_path):
    with pytest.raises(SystemExit):
        brj.main(["--data-dir", str(tmp_path), "--compare", "raw_10_30k"])
