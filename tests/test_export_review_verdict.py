"""scripts/export_review_verdict.py: the ReviewVerdict card composed by docs/design/nemotron-judge.md's rules."""
from __future__ import annotations

import json

import pytest

from scripts import export_review_verdict as erv

OK = {"success": True, "reasons": [], "duration": 9.32, "path_length": 1.17, "max_contact_force": 0.0}
FAILED = {**OK, "success": False, "reasons": ["dropped"]}
LABEL = {"task": "The robot picks up a red cube and places it into a blue bin.", "object": {"name": "cube", "color": "red"},
         "destination": "bin", "objects": [{"name": "cube", "color": "red"}],
         "steps": [{"name": "reach", "frames": [0, 100]}], "confidence": 0.95}
JUDGE = {"same_object": True, "same_goal": True, "same_order": True, "copy_completes": True, "matches": "yes",
         "reason": "Both demos move the same red cube into the blue bin.", "confidence": 0.95}


def test_verified_copy_shows_the_match_and_reason_verbatim_without_confidence():
    card = erv.compose(OK, LABEL, JUDGE)
    assert card["physics"] == {"status": "verified", "reasons": []}
    assert card["label"]["status"] == "ok" and card["label"]["task"] == LABEL["task"]
    assert card["match"] == {"status": "yes", "reason": JUDGE["reason"],
                             "checks": {"same_object": True, "same_goal": True, "same_order": True, "copy_completes": True}}
    assert card["conflict"] is None
    assert "confidence" not in json.dumps(card)


def test_a_failed_copy_is_not_checked_and_the_disagreement_is_said():
    card = erv.compose(FAILED, LABEL, JUDGE)
    assert card["physics"] == {"status": "failed", "reasons": ["dropped"]}
    assert card["match"]["status"] == "not_checked" and card["match"]["checks"] is None
    assert card["conflict"].endswith("physics decides.")


def test_model_errors_are_unavailable_never_no():
    card = erv.compose(OK, None, None, label_error="timeout", verdict_error="invalid reply twice")
    assert card["label"] == {"status": "unavailable", "task": None, "object": None, "destination": None, "steps": [],
                             "error": "timeout"}
    assert card["match"] == {"status": "unavailable", "checks": None, "reason": "invalid reply twice"}


def test_no_judge_call_is_not_checked():
    assert erv.compose(OK, LABEL, None)["match"]["status"] == "not_checked"


def _setup(tmp_path, *, copy_traj_differs=False):
    traj = {"t": [0.0, 0.02], "ee_pos": [[0, 0, 0], [0, 0, 1]], "ee_quat": [[1, 0, 0, 0]] * 2, "gripper": [0, 0]}
    other = {**traj, "ee_pos": [[0, 0, 0], [0, 1, 1]]}
    store, eps = tmp_path / "demos", tmp_path / "episodes"
    for demo, lineage in (("h", ["h"]), ("h_rules_m1", ["h", "h_rules", "h_rules_m1"])):
        (store / demo).mkdir(parents=True)
        (store / demo / "demo.json").write_text(json.dumps({"trajectory": traj}))
        (store / demo / "passport.json").write_text(json.dumps({"lineage": lineage, "verification": OK}))
    for clip, t in (("h_raw", traj), ("h_rules_mx_1", other if copy_traj_differs else traj)):
        (eps / clip).mkdir(parents=True)
        (eps / clip / "trajectory.json").write_text(json.dumps(t))
    outcomes = tmp_path / "outcomes.jsonl"
    outcomes.write_text("\n".join(json.dumps(r) for r in (
        {"set": "label", "id": "h_raw", "model": LABEL},
        {"set": "judge", "id": "match:h_raw|h_rules_mx_1", "model": JUDGE},
    )) + "\n")
    return outcomes, store, eps


def test_export_records_where_every_value_came_from(tmp_path):
    outcomes, store, eps = _setup(tmp_path)
    out = tmp_path / "verdict.json"
    erv.main(["--outcomes", str(outcomes), "--outcomes-ref", "branch@abc:outcomes.jsonl", "--store", str(store),
              "--episodes", str(eps), "--label", "h_raw", "--judge", "match:h_raw|h_rules_mx_1",
              "--human", "h", "--copy", "h_rules_m1", "--out", str(out)])
    body = json.loads(out.read_text())
    assert body["copy_id"] == "h_rules_m1"
    assert body["verdict"] == erv.compose(OK, LABEL, JUDGE)
    prov = body["provenance"]
    assert prov["outcomes"] == "branch@abc:outcomes.jsonl" and len(prov["outcomes_sha256"]) == 64
    assert prov["trajectories_match"] == {"h_raw=h": True, "h_rules_mx_1=h_rules_m1": True}
    assert prov["copy_lineage"] == ["h", "h_rules", "h_rules_m1"]


def test_export_refuses_a_clip_that_is_not_its_store_demo(tmp_path):
    outcomes, store, eps = _setup(tmp_path, copy_traj_differs=True)
    with pytest.raises(SystemExit, match="not the store demo"):
        erv.export(outcomes, "ref", store, eps, "h_raw", "match:h_raw|h_rules_mx_1", "h", "h_rules_m1")


def test_export_refuses_a_judge_item_for_another_human_demo(tmp_path):
    outcomes, store, eps = _setup(tmp_path)
    with outcomes.open("a") as f:
        f.write(json.dumps({"set": "label", "id": "other_raw", "model": LABEL}) + "\n")
    with pytest.raises(SystemExit, match="not the labelled"):
        erv.export(outcomes, "ref", store, None, "other_raw", "match:h_raw|h_rules_mx_1", "h", "h_rules_m1")
