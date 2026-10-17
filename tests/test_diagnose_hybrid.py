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


# --- sprint 5 (pre-registered): release facts, the verified-success gate, the blind arm ---------------

from demo_pipeline.schemas import Pose  # noqa: E402

BIN = Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0))


def _release_signals(traj, release_xy):
    """The cube rides in the gripper from the close to the first open, released at `release_xy` (cube center,
    bottom at the release height), and rests there afterwards."""
    a = traj.to_arrays()
    n = len(traj.t)
    g = a["gripper"]
    k_close = int(np.flatnonzero(g == 1)[0])
    k_open = k_close + int(np.flatnonzero(g[k_close:] == 0)[0])
    cube = np.tile(a["ee_pos"][k_close], (n, 1))
    cube[k_close:k_open] = a["ee_pos"][k_close:k_open]
    cube[k_open - 1] = (release_xy[0], release_xy[1], a["ee_pos"][k_open - 1][2])
    cube[k_open:] = (release_xy[0], release_xy[1], 0.025)
    held = np.zeros(n, dtype=bool)
    held[k_close:k_open] = True
    return SimSignals(cube_pos=cube, contact_gripper_cube=held, contact_arm_bin=np.zeros(n, dtype=bool),
                      contact_arm_table=np.zeros(n, dtype=bool), max_contact_force=np.zeros(n)), k_open


def test_release_facts_over_the_bin():
    from app.ai.diagnose import release_facts

    traj = _traj()
    sig, k_open = _release_signals(traj, (0.5, 0.3))
    f = release_facts(traj, sig, BIN)
    assert f.t == pytest.approx(traj.t[k_open]) and f.outside_m == pytest.approx(0.0)
    held_z = traj.ee_pos[k_open - 1][2]
    assert f.above_rim_m == pytest.approx(held_z - 0.025 - 0.09)


def test_release_facts_outside_the_footprint_and_whether_the_hand_goes_on_to_the_bin():
    from app.ai.diagnose import release_facts

    traj = _traj()  # the hand sweeps y 0 -> 0.3: it ends over the bin
    sig, _ = _release_signals(traj, (0.5 + 0.11 + 0.06, 0.3))
    f = release_facts(traj, sig, BIN)
    assert f.outside_m == pytest.approx(0.06) and f.hand_over_bin_after is True
    far_bin = Pose(pos=(1.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0))
    assert release_facts(traj, sig, far_bin).hand_over_bin_after is False


def test_release_facts_need_signals_a_bin_and_an_open_after_the_close():
    from app.ai.diagnose import release_facts

    traj = _traj()
    assert release_facts(traj, None, BIN) is None
    assert release_facts(traj, _release_signals(traj, (0.5, 0.3))[0], None) is None
    held = Trajectory(t=[0.0, 0.02, 0.04], ee_pos=[(0, 0, 0)] * 3, ee_quat=[DOWN] * 3, gripper=[0, 1, 1])
    assert release_facts(held, _signals(held), BIN) is None


def test_the_prompt_states_the_release_facts():
    from app.ai.diagnose import ReleaseFacts

    prompt = _prompt(release=ReleaseFacts(t=1.6, outside_m=0.064, above_rim_m=0.031, hand_over_bin_after=True))
    line = next(ln for ln in prompt.splitlines() if "first gripper open after the grasp" in ln)
    assert "t=1.60 s" in line and "6.4 cm outside the bin footprint" in line and "3.1 cm above the bin rim" in line
    assert "the hand later passes over the bin" in line


def test_the_prompt_says_drop_includes_an_opened_gripper():
    prompt = _prompt()
    assert "never report drop unless G ends before the cube is over the bin" in prompt
    assert "whether it slips or the gripper opens" in prompt
    assert "ends in a window where gripper is still 1" not in prompt


def test_the_blind_prompt_has_no_measured_offset():
    prompt = _prompt(offset_mm=None)
    assert "mm (horizontally)" not in prompt and "tracking error" not in prompt
    assert "Use the measured offset" not in prompt
    assert f"first gripper close at t={T_CLOSE:.2f} s" in prompt  # the time stays: it says nothing about centering


@pytest.mark.parametrize("kind", ["bad_release", "drop"])
def test_release_claims_are_dropped_when_the_replay_verified_success(kind):
    model = _diag(issues=[{"type": kind, "t": 1.6, "evidence": "outside the bin"}])
    merged, dropped = merge_hybrid(_diag(), model, t_close=T_CLOSE, offset_mm=8.0, replay_success=True)
    assert merged.issues == [] and any(kind in d and "verified success" in d for d in dropped)
    merged, _ = merge_hybrid(_diag(), model, t_close=T_CLOSE, offset_mm=8.0, replay_success=False)
    assert [i.type for i in merged.issues] == [kind]


def test_diagnose_hybrid_blind_hides_the_offset_and_does_not_gate_the_grasp():
    reply = {"segments": [], "issues": [GRASP], "repairs": [RECENTER], "decision": "repair", "label": TASK_TEXT}
    with patch("app.ai.diagnose.chat_vision_images", return_value=_reply(reply)) as vision:
        diag, dropped = _call(offset=0.001, blind=True)  # 1 mm: the sighted arm would gate this claim
    assert "mm (horizontally)" not in vision.call_args.args[0]
    assert "grasp_off_center" in [i.type for i in diag.issues]
    assert not any("tracking error" in d for d in dropped)
    with patch("app.ai.diagnose.chat_vision_images", return_value=_reply(reply)):
        diag, _ = _call(offset=0.001)
    assert "grasp_off_center" not in [i.type for i in diag.issues]


def test_diagnose_hybrid_passes_release_facts_and_gates_on_replay_success():
    traj = _traj(pause_steps=40)
    sig, _ = _release_signals(traj, (0.5 + 0.11 + 0.06, 0.3))
    windows = compute_windows(traj, sig)
    reply = {"segments": [], "issues": [{"type": "bad_release", "t": 1.6, "evidence": "beside the bin"}],
             "repairs": [], "decision": "keep", "label": TASK_TEXT}
    for success, kept in ((True, False), (False, True)):
        with patch("app.ai.diagnose.chat_vision_images", return_value=_reply(reply)) as vision:
            diag, _ = diagnose_hybrid([(0.0, b"f0")], b"w", windows, traj, TASK_TEXT, success, traj.t[-1],
                                      signals=sig, bin_pose=BIN)
        assert "6.0 cm outside the bin footprint" in vision.call_args.args[0]
        assert ("bad_release" in [i.type for i in diag.issues]) is kept


def test_release_facts_use_the_bins_yaw():
    import math as _m

    from app.ai.diagnose import release_facts

    q = (_m.cos(_m.pi / 8), 0.0, 0.0, _m.sin(_m.pi / 8))  # 45 degrees about z
    yawed = Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=q)
    traj = _traj()
    sig, _ = _release_signals(traj, (0.5 + 0.12, 0.3 + 0.12))  # 0.17 m along the bin's own x axis
    f = release_facts(traj, sig, yawed)
    assert f.outside_m == pytest.approx(0.12 * 2 ** 0.5 - 0.11, abs=1e-6)
