"""scripts/score_pipeline_run.py: score a pipeline run's stored diagnoses against the set's ground truth."""
from __future__ import annotations

import json

import pytest

from demo_pipeline.degrade import InjectedIssue
from demo_pipeline.schemas import Diagnosis, Issue
from demo_pipeline.store import DemoStore
from scripts import score_pipeline_run as spr

PAUSE = InjectedIssue(type="pause", t0=2.0, t1=3.0)
JITTER = InjectedIssue(type="jitter", t0=0.0, t1=8.0)
EXPERT_STOP = InjectedIssue(type="pause", t0=5.0, t1=5.4, dont_care=True)


def _issue(type_, t0, t1):
    return {"type": type_, "t0": t0, "t1": t1, "evidence": "fake"}


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


def _set(tmp_path, truths: dict[str, list[InjectedIssue]]):
    """A fake set: manifest + truth.json per id (demo.json is not needed for scoring)."""
    set_dir = tmp_path / "sets" / "fake"
    for id_, issues in truths.items():
        if issues is not None:
            _write(set_dir / id_ / "truth.json", {"synthetic": True, "demo_id": id_, "seed": 0, "settings": {},
                                                 "issues": [i.model_dump() for i in issues]})
    _write(set_dir / "manifest.json", {"name": "fake", "demos": [{"id": i} for i in truths]})
    return set_dir


def _result(set_dir, diagnoser, id_, status="perfected", issues=(), decision="repair", source=None,
            failed_verifies=0, verified=True, **extra):
    replays = [{"out_name": f"{id_}_{diagnoser}_v{k + 1}", "success": False} for k in range(failed_verifies)]
    if status in ("perfected", "kept"):
        replays.append({"out_name": f"{id_}_{diagnoser}_v{failed_verifies + 1}", "success": verified})
    data = {"id": id_, "demo_id": id_, "diagnoser": diagnoser, "status": status,
            "diagnosis_source": source or diagnoser, "decision": decision, "issues": list(issues),
            "attempts": len(replays), "replays": replays, **extra}
    _write(set_dir / "pipeline" / diagnoser / f"{id_}.json", data)


def test_scores_a_run_and_writes_scores_json(tmp_path):
    set_dir = _set(tmp_path, {"a": [PAUSE, JITTER, EXPERT_STOP], "b": [JITTER]})
    _result(set_dir, "rules", "a", issues=[_issue("pause", 2.1, 3.0), _issue("jitter", 0.0, 8.0),
                                           _issue("pause", 5.0, 5.3)])
    _result(set_dir, "rules", "b", issues=[_issue("jitter", 0.0, 8.0), _issue("pause", 6.0, 7.0)])
    scores = spr.score_run(set_dir, "rules")
    on_disk = json.loads((set_dir / "pipeline" / "rules" / "scores.json").read_text(encoding="utf-8"))
    assert on_disk == json.loads(json.dumps(scores))
    p = scores["per_type"]["pause"]
    assert (p["tp"], p["fp"], p["fn"], p["ignored"]) == (1, 1, 0, 1)
    assert p["precision"] == 0.5 and p["recall"] == 1.0 and p["mean_iou"] == pytest.approx(0.9)
    assert scores["per_type"]["jitter"]["f1"] == 1.0
    assert scores["all"]["tp"] == 3 and scores["rules_types"]["tp"] == 3
    assert scores["scored"] == 2 and scores["not_scored"] == []
    assert scores["set"] == str(set_dir) and scores["diagnoser"] == "rules" and scores["iou_threshold"] == 0.3


def test_counts_every_demo_status_including_missing_results(tmp_path):
    set_dir = _set(tmp_path, {"p": [JITTER], "k": [], "d": [PAUSE], "e": [PAUSE], "n": [PAUSE]})
    _result(set_dir, "rules", "p", issues=[_issue("jitter", 0.0, 8.0)])
    _result(set_dir, "rules", "k", status="kept", decision="keep")
    _result(set_dir, "rules", "d", status="discarded", decision="discard")
    _write(set_dir / "pipeline" / "rules" / "e.json", {"id": "e", "status": "error", "error": "SimWorkerError: x"})
    scores = spr.score_run(set_dir, "rules")
    assert scores["counts"] == {"perfected": 1, "kept": 1, "discarded": 1, "error": 1, "pending": 1}
    reasons = {r["id"]: r["reason"] for r in scores["not_scored"]}
    assert set(reasons) == {"e", "n"} and "error" in reasons["e"] and "no result" in reasons["n"]
    assert scores["scored"] == 3
    assert scores["per_type"]["pause"]["fn"] == 1  # the discarded demo's missed pause still counts


def test_a_demo_rediagnosed_after_a_failed_verification_is_not_scored(tmp_path):
    # Its stored (last) diagnosis may describe a repaired trajectory, whose timeline is not the truth's.
    set_dir = _set(tmp_path, {"r": [PAUSE], "ok": [PAUSE]})
    _result(set_dir, "rules", "r", issues=[_issue("pause", 9.0, 9.5)], failed_verifies=1)
    _result(set_dir, "rules", "ok", issues=[_issue("pause", 2.0, 3.0)])
    scores = spr.score_run(set_dir, "rules")
    assert [r["id"] for r in scores["not_scored"]] == ["r"]
    assert "failed verification" in scores["not_scored"][0]["reason"]
    assert scores["per_type"]["pause"]["fp"] == 0 and scores["per_type"]["pause"]["tp"] == 1
    assert scores["counts"]["perfected"] == 2  # still counted as perfected


def test_a_demo_without_truth_is_not_scored(tmp_path):
    set_dir = _set(tmp_path, {"t": None})
    _result(set_dir, "rules", "t", issues=[_issue("pause", 2.0, 3.0)])
    scores = spr.score_run(set_dir, "rules")
    assert scores["scored"] == 0 and "truth.json" in scores["not_scored"][0]["reason"]
    assert scores["per_type"] == {}


def test_records_where_each_diagnosis_came_from(tmp_path):
    set_dir = _set(tmp_path, {"m": [PAUSE], "f": [PAUSE]})
    _result(set_dir, "nemotron", "m", issues=[_issue("pause", 2.0, 3.0)])
    _result(set_dir, "nemotron", "f", issues=[_issue("pause", 2.0, 3.0)], source="rules")  # the model failed
    scores = spr.score_run(set_dir, "nemotron")
    assert scores["diagnosis_source"] == {"nemotron": 1, "rules": 1}
    demos = {d["id"]: d for d in scores["demos"]}
    assert demos["f"]["diagnosis_source"] == "rules" and demos["m"]["diagnosis_from"].endswith("m.json")


def test_falls_back_to_the_stored_output_diagnosis_when_the_result_has_no_issues(tmp_path):
    set_dir = _set(tmp_path, {"s": [PAUSE]})
    _result(set_dir, "rules", "s")
    data = json.loads((set_dir / "pipeline" / "rules" / "s.json").read_text(encoding="utf-8"))
    del data["issues"]
    _write(set_dir / "pipeline" / "rules" / "s.json", data)
    store = DemoStore(tmp_path / "store")
    diag = Diagnosis(segments=[], issues=[Issue(type="pause", t0=2.0, t1=3.0, evidence="e")], repairs=[],
                     decision="repair", label="x")
    out = store.root / "demos" / "s_rules"
    _write(out / "demo.json", {})  # the store checks only that demo.json exists before reading a diagnosis
    (out / "diagnosis.json").write_text(json.dumps({"source": "rules", "model_id": None,
                                                    "diagnosis": diag.model_dump(mode="json")}), encoding="utf-8")
    scores = spr.score_run(set_dir, "rules", store=store)
    assert scores["per_type"]["pause"]["tp"] == 1
    assert scores["demos"][0]["diagnosis_from"].endswith("diagnosis.json")


def test_clean_demos_report_how_many_were_left_alone(tmp_path):
    set_dir = _set(tmp_path, {"c1": [EXPERT_STOP], "c2": [], "x": [PAUSE]})
    _result(set_dir, "rules", "c1", status="kept", decision="keep")
    _result(set_dir, "rules", "c2", issues=[_issue("pause", 5.0, 5.4)])  # flagged its expert stop
    _result(set_dir, "rules", "x", issues=[_issue("pause", 2.0, 3.0)])
    clean = spr.score_run(set_dir, "rules")["clean_demos"]
    assert clean == {"n": 2, "decision_keep": 1, "status_kept": 1}


def test_compare_prints_both_diagnosers_on_their_common_demos(tmp_path, capsys):
    set_dir = _set(tmp_path, {"a": [PAUSE], "b": [PAUSE], "c": [PAUSE]})
    for id_ in "ab":
        _result(set_dir, "rules", id_, issues=[_issue("pause", 2.0, 3.0)])
    _result(set_dir, "rules", "c", issues=[_issue("pause", 6.0, 7.0)])  # wrong, but c is not common: no effect
    _result(set_dir, "nemotron", "a", issues=[])
    _result(set_dir, "nemotron", "b", issues=[_issue("pause", 2.0, 3.0)])
    _result(set_dir, "nemotron", "c", issues=[_issue("pause", 2.0, 3.0)], failed_verifies=1)
    table = spr.compare(set_dir)
    assert "common scored demos: 2" in table  # c is not scored for nemotron, so it leaves both columns
    row = next(line for line in table.splitlines() if line.startswith("| pause"))
    cells = [c.strip() for c in row.strip("|").split("|")]
    assert cells[1:] == ["1.00", "1.00", "1.00", "1.00", "0.50", "0.67"]  # rules P R F1 | nemotron P R F1
    assert "kept / perfected / discarded" in table


def test_compare_marks_a_diagnoser_without_a_run_as_pending(tmp_path):
    set_dir = _set(tmp_path, {"a": [PAUSE]})
    _result(set_dir, "rules", "a", issues=[_issue("pause", 2.0, 3.0)])
    table = spr.compare(set_dir)
    assert "nemotron: no pipeline results" in table
    row = next(line for line in table.splitlines() if line.startswith("| pause"))
    assert row.count("pending") == 3


def test_refuses_a_set_without_a_manifest(tmp_path):
    with pytest.raises(FileNotFoundError):
        spr.score_run(tmp_path / "nothing", "rules")


def test_cli_scores_and_compares(tmp_path, capsys):
    set_dir = _set(tmp_path, {"a": [PAUSE]})
    _result(set_dir, "rules", "a", issues=[_issue("pause", 2.0, 3.0)])
    assert spr.main(["--set", str(set_dir), "--diagnoser", "rules"]) == 0
    assert "pause" in capsys.readouterr().out
    assert (set_dir / "pipeline" / "rules" / "scores.json").is_file()
    assert spr.main(["--set", str(set_dir), "--compare"]) == 0
    assert "rules" in capsys.readouterr().out


def test_a_failed_raw_replay_is_not_a_failed_verification(tmp_path):
    # perfect_stored_demo lists the raw replay ("<id>_raw") when it runs it itself; a degraded demo often fails it.
    set_dir = _set(tmp_path, {"a": [PAUSE]})
    _result(set_dir, "rules", "a", issues=[_issue("pause", 2.0, 3.0)])
    path = set_dir / "pipeline" / "rules" / "a.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["replays"].insert(0, {"out_name": "a_raw", "success": False})
    _write(path, data)
    assert spr.score_run(set_dir, "rules")["scored"] == 1
