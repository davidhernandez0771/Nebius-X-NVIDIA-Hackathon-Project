"""diagnose_hybrid: the rules own the timing issues, Nemotron adds what they never name. chat_vision_images is mocked."""
from __future__ import annotations

import json
from types import SimpleNamespace as NS
from unittest.mock import patch

import numpy as np
import pytest

from app.ai.diagnose import (
    GRASP_CENTERED_MM,
    MODEL_TYPES,
    RULES_TYPES,
    DiagnosisError,
    build_hybrid_prompt,
    diagnose_hybrid,
    first_close,
    grasp_offset_mm,
    merge_hybrid,
)
from demo_pipeline.measure import compute_windows
from demo_pipeline.rules import TASK_TEXT, detect_rules
from demo_pipeline.schemas import Diagnosis, Issue, SimSignals, Trajectory

DOWN = (0.0, 1.0, 0.0, 0.0)
CLOSE, OPEN = 40, 80


def _traj(n=100, pause_steps=0):
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if CLOSE <= i < OPEN else 0 for i in range(n)]
    pos = pos[:60] + [pos[60]] * pause_steps + pos[60:]
    grip = grip[:60] + [1] * pause_steps + grip[60:]
    m = len(pos)
    return Trajectory(t=[i * 0.02 for i in range(m)], ee_pos=pos, ee_quat=[DOWN] * m, gripper=grip)


def _signals(traj, offset_m=0.0):
    """The cube rests under the gripper's close position, `offset_m` away in x, until the close; then it rides along."""
    a = traj.to_arrays()
    n = len(traj.t)
    k = int(np.flatnonzero(a["gripper"] == 1)[0])
    cube = np.tile(a["ee_pos"][k] + [offset_m, 0.0, 0.0], (n, 1))
    held = a["gripper"] == 1
    cube[held] = a["ee_pos"][held] + [offset_m, 0.0, 0.0]
    return SimSignals(cube_pos=cube, contact_gripper_cube=held, contact_arm_bin=np.zeros(n, dtype=bool),
                      contact_arm_table=np.zeros(n, dtype=bool), max_contact_force=np.zeros(n))


def _diag(issues=(), repairs=(), decision="keep", segments=()):
    return Diagnosis.model_validate({"segments": list(segments), "issues": list(issues), "repairs": list(repairs),
                                     "decision": decision, "label": TASK_TEXT})


def _reply(obj):
    return NS(text=json.dumps(obj), est_cost_usd=0.001)


T_CLOSE = CLOSE * 0.02  # 0.8 s


# --- facts the code gives the model ------------------------------------------------------------

def test_first_close_and_horizontal_grasp_offset():
    traj = _traj()
    assert first_close(traj) == pytest.approx(T_CLOSE)
    assert grasp_offset_mm(traj, _signals(traj, 0.008)) == pytest.approx(8.0)
    assert grasp_offset_mm(traj, None) is None
    never = Trajectory(t=[0.0, 0.02], ee_pos=[(0, 0, 0)] * 2, ee_quat=[DOWN] * 2, gripper=[0, 0])
    assert first_close(never) is None


def test_ownership_split():
    assert set(RULES_TYPES) == {"pause", "jitter", "idle_start_end"}
    assert {"grasp_off_center", "bad_release", "drop", "wrong_object"} <= set(MODEL_TYPES)
    assert not set(RULES_TYPES) & set(MODEL_TYPES)
    assert GRASP_CENTERED_MM == pytest.approx(3.3)  # measured IK tracking error at the close (spec Changes)


# --- the prompt ---------------------------------------------------------------------------------

def _prompt(rules=None, **kw):
    traj = _traj(pause_steps=40)
    windows = compute_windows(traj, _signals(traj))
    kw.setdefault("offset_mm", 8.0)
    return build_hybrid_prompt(TASK_TEXT, windows, [0.0, 1.0, 2.0], True, True,
                               rules if rules is not None else detect_rules(traj, windows), T_CLOSE, **kw)


def test_hybrid_prompt_lists_the_rules_findings_and_leaves_timing_to_them():
    prompt = _prompt()
    assert "already handled by code" in prompt
    assert "pause 1.20-2.00" in prompt or "pause" in prompt.split("already handled by code")[1][:400]
    assert "do not report pause, jitter, idle_start_end or slow" in prompt


def test_hybrid_prompt_asks_for_grasp_release_drop_wrong_object_and_segments():
    prompt = _prompt()
    for word in ("grasp_off_center", "bad_release", "drop", "wrong_object", "segments"):
        assert word in prompt
    assert f"first gripper close at t={T_CLOSE:.2f} s" in prompt
    assert "8.0 mm" in prompt and f"{GRASP_CENTERED_MM:g} mm" in prompt


def test_hybrid_prompt_has_no_leave_it_out_bias_but_keeps_contacts_as_ground_truth():
    prompt = _prompt()
    assert "when in doubt, leave it out" not in prompt.lower()
    assert "A clean demo is common" not in prompt
    assert "ground truth" in prompt and "never report drop unless G" in prompt


def test_hybrid_prompt_without_rules_findings_or_offset():
    prompt = _prompt(rules=_diag(), offset_mm=None)
    assert "the code found no timing issues" in prompt
    assert "mm" not in prompt.split("first gripper close")[1].split("\n")[0]


def test_hybrid_prompt_states_failure_reasons():
    assert "failed verification because: not_in_bin" in _prompt(failure_reasons=["not_in_bin"])


def test_hybrid_prompt_offers_only_the_models_repairs():
    menu = _prompt().split("Repair menu")[1].split("\n\n")[0]
    assert "recenter_grasp" in menu and "discard" in menu
    assert "remove_pause" not in menu and "smooth" not in menu and "trim" not in menu


# --- merging ------------------------------------------------------------------------------------

RULES = _diag(issues=[{"type": "pause", "t0": 1.2, "t1": 2.0, "evidence": "still"}],
              repairs=[{"op": "remove_pause", "t0": 1.2, "t1": 2.0}], decision="repair",
              segments=[{"name": "approach", "t0": 0.0, "t1": 0.8}])
GRASP = {"type": "grasp_off_center", "t": 0.9, "evidence": "cube left of the fingers"}
RECENTER = {"op": "recenter_grasp", "t": 0.9}


def test_merge_keeps_rules_issues_and_adds_the_models_owned_issues_and_repairs():
    model = _diag(issues=[GRASP], repairs=[RECENTER], decision="repair")
    merged, dropped = merge_hybrid(RULES, model, t_close=T_CLOSE, offset_mm=8.0)
    assert [i.type for i in merged.issues] == ["pause", "grasp_off_center"]
    assert [r.op for r in merged.repairs] == ["remove_pause", "recenter_grasp"]
    assert merged.decision == "repair" and dropped == []


def test_merge_snaps_the_grasp_to_the_measured_close_time():
    model = _diag(issues=[{**GRASP, "t": None, "t0": 0.5, "t1": 1.5}], repairs=[RECENTER], decision="repair")
    merged, _ = merge_hybrid(RULES, model, t_close=T_CLOSE, offset_mm=8.0)
    grasp = merged.issues[-1]
    assert grasp.t == pytest.approx(T_CLOSE) and grasp.t0 is None
    assert merged.repairs[-1].t == pytest.approx(T_CLOSE)


def test_merge_drops_a_grasp_claim_within_tracking_error():
    model = _diag(issues=[GRASP], repairs=[RECENTER], decision="repair")
    merged, dropped = merge_hybrid(RULES, model, t_close=T_CLOSE, offset_mm=2.0)
    assert [i.type for i in merged.issues] == ["pause"] and [r.op for r in merged.repairs] == ["remove_pause"]
    assert any("grasp_off_center" in d and "2.0 mm" in d for d in dropped)
    assert any("recenter_grasp" in d for d in dropped)


def test_merge_keeps_a_grasp_claim_when_the_offset_is_unknown():
    model = _diag(issues=[GRASP], repairs=[RECENTER], decision="repair")
    merged, _ = merge_hybrid(RULES, model, t_close=T_CLOSE, offset_mm=None)
    assert "grasp_off_center" in [i.type for i in merged.issues]


def test_merge_drops_the_models_timing_issues_and_timing_repairs():
    model = _diag(issues=[{"type": "pause", "t0": 3.0, "t1": 3.5, "evidence": "x"},
                          {"type": "slow", "t0": 0.0, "t1": 2.0, "evidence": "x"}],
                  repairs=[{"op": "remove_pause", "t0": 3.0, "t1": 3.5}, {"op": "retime", "t0": 0.0, "t1": 2.0,
                                                                           "target_speed": 0.2}],
                  decision="repair")
    merged, dropped = merge_hybrid(RULES, model, t_close=T_CLOSE, offset_mm=8.0)
    assert merged.issues == RULES.issues and merged.repairs == RULES.repairs
    assert len(dropped) == 4 and all("the rules own" in d for d in dropped)


def test_merge_deduplicates_an_overlapping_repair_of_the_same_op():
    rules = _diag(issues=[{"type": "other", "t0": 0.0, "t1": 1.9, "evidence": "x"}],
                  repairs=[{"op": "replan_transit", "t0": 1.0, "t1": 1.6}], decision="repair")
    model = _diag(issues=[{"type": "rim_contact", "t0": 1.1, "t1": 1.5, "evidence": "B"}],
                  repairs=[{"op": "replan_transit", "t0": 1.1, "t1": 1.5}], decision="repair")
    merged, dropped = merge_hybrid(rules, model, t_close=T_CLOSE, offset_mm=None)
    assert [r.op for r in merged.repairs] == ["replan_transit"] and merged.repairs[0].t0 == 1.0
    assert any("overlaps" in d for d in dropped)


def test_merge_takes_the_models_segments_when_given_else_the_rules():
    seg = [{"name": "approach", "t0": 0.0, "t1": 0.7}, {"name": "grasp", "t0": 0.7, "t1": 1.0}]
    merged, _ = merge_hybrid(RULES, _diag(segments=seg), t_close=T_CLOSE, offset_mm=None)
    assert [s.name for s in merged.segments] == ["approach", "grasp"]
    merged, _ = merge_hybrid(RULES, _diag(), t_close=T_CLOSE, offset_mm=None)
    assert merged.segments == RULES.segments


@pytest.mark.parametrize("model_issues,model_repairs,rules,decision", [
    ([], [], _diag(), "keep"),
    ([], [], RULES, "repair"),
    ([GRASP], [RECENTER], _diag(), "repair"),
    ([{"type": "wrong_object", "t0": 0.0, "t1": 1.0, "evidence": "green block"}], [{"op": "discard"}], RULES,
     "discard"),
    ([{"type": "bad_release", "t": 1.7, "evidence": "dropped from high"}], [], _diag(), "keep"),
])
def test_the_decision_follows_the_merged_issues_and_repairs(model_issues, model_repairs, rules, decision):
    model = _diag(issues=model_issues, repairs=model_repairs, decision="repair" if model_repairs else "keep")
    merged, _ = merge_hybrid(rules, model, t_close=T_CLOSE, offset_mm=8.0)
    assert merged.decision == decision
    if decision == "discard":
        assert [r.op for r in merged.repairs] == ["discard"]


# --- end to end ---------------------------------------------------------------------------------

def _call(traj=None, offset=0.008, **kw):
    traj = traj or _traj(pause_steps=40)
    sig = _signals(traj, offset)
    windows = compute_windows(traj, sig)
    kw.setdefault("signals", sig)
    return diagnose_hybrid([(0.0, b"f0"), (1.0, b"f1")], b"wrist", windows, traj, TASK_TEXT, True, traj.t[-1], **kw)


def test_diagnose_hybrid_merges_rules_and_model_and_gates():
    reply = {"segments": [], "issues": [GRASP, {"type": "rim_contact", "t0": 1.0, "t1": 1.5, "evidence": "hit"}],
             "repairs": [RECENTER], "decision": "repair", "label": TASK_TEXT}
    with patch("app.ai.diagnose.chat_vision_images", return_value=_reply(reply)) as vision:
        diag, dropped = _call()
    assert vision.call_args.args[1] == [b"f0", b"f1", b"wrist"]
    prompt = vision.call_args.args[0]
    assert "already handled by code" in prompt and "8.0 mm" in prompt
    types = [i.type for i in diag.issues]
    assert "pause" in types and "grasp_off_center" in types and "rim_contact" not in types  # no B: gated
    assert any("rim_contact" in d for d in dropped)
    assert diag.decision == "repair"


def test_diagnose_hybrid_retries_an_invalid_reply_then_raises():
    with patch("app.ai.diagnose.chat_vision_images", return_value=NS(text="not json", est_cost_usd=0.0)) as vision:
        with pytest.raises(DiagnosisError):
            _call()
    assert vision.call_count == 2
    assert "already handled by code" in vision.call_args_list[1].args[0]


def test_diagnose_hybrid_passes_failure_reasons():
    reply = {"segments": [], "issues": [], "repairs": [], "decision": "keep", "label": TASK_TEXT}
    with patch("app.ai.diagnose.chat_vision_images", return_value=_reply(reply)) as vision:
        _call(failure_reasons=["dropped"])
    assert "failed verification because: dropped" in vision.call_args.args[0]


def test_diagnose_hybrid_keeps_the_rules_when_the_model_finds_nothing():
    reply = {"segments": [], "issues": [], "repairs": [], "decision": "keep", "label": TASK_TEXT}
    traj = _traj(pause_steps=40)
    with patch("app.ai.diagnose.chat_vision_images", return_value=_reply(reply)):
        diag, _ = _call(traj)
    rules = detect_rules(traj, compute_windows(traj, _signals(traj, 0.008)))
    assert diag.issues == rules.issues and diag.repairs == rules.repairs and diag.decision == rules.decision


def test_hybrid_issue_types_cover_everything_the_rules_or_model_may_say():
    from typing import get_args

    from demo_pipeline.schemas import IssueType

    assert set(RULES_TYPES) | set(MODEL_TYPES) | {"slow", "other"} == set(get_args(IssueType))
    assert Issue  # imported for the type list
