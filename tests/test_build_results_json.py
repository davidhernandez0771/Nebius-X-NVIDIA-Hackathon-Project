"""scripts/build_results_json.py: collect the measured inputs from disk and write DATA_DIR/results/results.json."""
from __future__ import annotations

import json
import os

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
    assert sorted(r["inputs"]) == ["evals", "registry", "scores", "yields"]
    assert len(r["inputs"]["yields"]) == 2 and r["generated_at"]


def test_with_nothing_measured_the_file_is_all_pending(tmp_path):
    r = json.loads(brj.build(tmp_path / "empty").read_text(encoding="utf-8"))
    assert r["multiply_yield"]["ours"] is None and len(r["pending"]) == 12
    assert r["inputs"] == {"registry": [], "evals": [], "yields": [], "scores": []}


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
