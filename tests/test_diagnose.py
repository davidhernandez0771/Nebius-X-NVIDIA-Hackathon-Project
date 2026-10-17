"""Nemotron VL diagnoser: prompt contents, reply parsing and the retry loop, with chat_vision_images mocked."""
from __future__ import annotations

import json
from types import SimpleNamespace as NS
from typing import get_args
from unittest.mock import patch

import pytest

from app.ai.diagnose import (
    CLEAN_MOVING_SPEED,
    SLOW_SPEED,
    DiagnosisError,
    build_diagnosis_prompt,
    diagnose,
    diagnose_gated,
    gate_diagnosis,
    parse_diagnosis,
)
from demo_pipeline.rules import JITTER_MIN_JERK, STILL_SPEED
from demo_pipeline.schemas import Diagnosis, IssueType, MetricsWindow, RepairOp, SegmentName

TASK = "pick up the red cube and place it in the blue bin"
DURATION = 3.0

GOOD = {
    "segments": [
        {"name": "approach", "t0": 0.0, "t1": 1.0},
        {"name": "carry", "t0": 1.0, "t1": 2.5},
        {"name": "retreat", "t0": 2.5, "t1": 3.0},
    ],
    "issues": [{"type": "pause", "t0": 1.2, "t1": 2.1, "evidence": "speed ~0 for 0.9 s"}],
    "repairs": [{"op": "remove_pause", "t0": 1.2, "t1": 2.1}],
    "decision": "repair",
    "label": TASK,
}


def _windows(n=6):
    return [
        MetricsWindow(
            t0=i * 0.5, t1=(i + 1) * 0.5, speed=0.1, jerk_rms=1.0, gripper=0, dist_ee_cube=0.2,
            cube_height=0.025, contact_gripper_cube=False, contact_arm_bin=False, contact_arm_table=False,
        )
        for i in range(n)
    ]


def _reply(text):
    return NS(text=text, est_cost_usd=0.001)


def _diagnose(**overrides):
    kwargs = dict(
        frames=[(0.0, b"f0"), (1.5, b"f1"), (3.0, b"f2")],
        wrist_frame=b"wrist",
        windows=_windows(),
        task_text=TASK,
        replay_success=True,
        duration=DURATION,
    )
    kwargs.update(overrides)
    return diagnose(**kwargs)


# --- parse_diagnosis ----------------------------------------------------------------------------

def test_parse_accepts_fenced_json_with_prose():
    text = "Sure! Here is the diagnosis:\n```json\n" + json.dumps(GOOD, indent=2) + "\n```\nLet me know if you need more."
    diag = parse_diagnosis(text, DURATION)

    assert isinstance(diag, Diagnosis)
    assert diag.decision == "repair"
    assert diag.repairs[0].op == "remove_pause"


def test_parse_rejects_unknown_op():
    bad = {**GOOD, "repairs": [{"op": "teleport", "t0": 1.0, "t1": 2.0}]}
    with pytest.raises(DiagnosisError, match="teleport|op"):
        parse_diagnosis(json.dumps(bad), DURATION)


def test_parse_rejects_times_past_demo():
    bad = {**GOOD, "issues": [{"type": "pause", "t0": 2.0, "t1": 9.0, "evidence": "x"}]}
    with pytest.raises(DiagnosisError, match="past the demo end"):
        parse_diagnosis(json.dumps(bad), DURATION)


def test_parse_rejects_reply_without_json_object():
    with pytest.raises(DiagnosisError):
        parse_diagnosis("I could not see the robot in these frames.", DURATION)


def test_parse_rejects_malformed_json():
    with pytest.raises(DiagnosisError):
        parse_diagnosis('{"segments": [}', DURATION)


# --- diagnose ------------------------------------------------------------------------------------

def test_diagnose_sends_frames_then_wrist_to_nemotron_vl_without_thinking():
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.return_value = _reply(json.dumps(GOOD))
        diag = _diagnose()

    assert diag.decision == "repair"
    args, kwargs = vision.call_args
    assert args[1] == [b"f0", b"f1", b"f2", b"wrist"]
    assert kwargs["tier"] == "nemotron-vl"
    assert kwargs["extra_body"] == {"chat_template_kwargs": {"enable_thinking": False}}


def test_diagnose_subsamples_frames_to_the_8_image_limit_keeping_ends_and_captions():
    # Token Factory rejects more than 8 images per prompt (HTTP 400, seen live 2026-10-15).
    frames = [(i / 3, f"f{i}".encode()) for i in range(10)]
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.return_value = _reply(json.dumps(GOOD))
        _diagnose(frames=frames)

    prompt, images = vision.call_args.args
    assert len(images) == 8
    assert images[0] == b"f0" and images[6] == b"f9" and images[7] == b"wrist"
    kept_times = [t for t, png in frames if png in images]
    assert [f"Image {i}: front camera at t={t:.2f} s" in prompt for i, t in enumerate(kept_times, start=1)] == [True] * 7
    assert "Image 8: wrist camera" in prompt


def test_diagnose_retries_once_with_error_then_succeeds():
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.side_effect = [_reply("no json here"), _reply(json.dumps(GOOD))]
        diag = _diagnose()

    assert diag.decision == "repair"
    assert vision.call_count == 2
    first_prompt = vision.call_args_list[0].args[0]
    retry_prompt = vision.call_args_list[1].args[0]
    assert retry_prompt.startswith(first_prompt)
    assert "no JSON object" in retry_prompt[len(first_prompt):]


def test_diagnose_raises_after_two_bad_replies():
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.side_effect = [_reply("nope"), _reply('{"decision": "keep"}')]
        with pytest.raises(DiagnosisError):
            _diagnose()

    assert vision.call_count == 2


# --- build_diagnosis_prompt -----------------------------------------------------------------------

def _op_models():
    union = get_args(RepairOp)[0]
    return get_args(union)


def test_prompt_lists_every_repair_op_and_issue_type():
    prompt = build_diagnosis_prompt(TASK, _windows(), [0.0, 1.5, 3.0], has_wrist_frame=True, replay_success=False)

    for model in _op_models():
        (op_name,) = get_args(model.model_fields["op"].annotation)
        assert op_name in prompt
        for field in model.model_fields:
            assert field in prompt, f"{op_name}.{field} missing from prompt"
    for issue_type in get_args(IssueType):
        assert issue_type in prompt
    for segment in get_args(SegmentName):
        assert segment in prompt
    assert "times in seconds from demo start" in prompt
    assert TASK in prompt


def test_prompt_has_one_metrics_line_per_window_and_captions_each_frame():
    windows = _windows(6)
    prompt = build_diagnosis_prompt(TASK, windows, [0.0, 1.5, 3.0], has_wrist_frame=True, replay_success=True)

    for w in windows:
        assert sum(line.startswith(f"{w.t0:.2f}-{w.t1:.2f}") for line in prompt.splitlines()) == 1
    for i, t in enumerate([0.0, 1.5, 3.0], start=1):
        assert f"Image {i}: front camera at t={t:.2f} s" in prompt
    assert "Image 4: wrist camera" in prompt


def test_prompt_without_wrist_frame_does_not_mention_one():
    prompt = build_diagnosis_prompt(TASK, _windows(), [0.0, 1.5], has_wrist_frame=False, replay_success=True)

    assert "wrist camera" not in prompt


# --- prompt calibration: a clean demo is keep (2026-10-16, after 5 false positives on smoke_cam) ---

def _prompt(windows=None):
    return build_diagnosis_prompt(TASK, windows or _windows(), [0.0, 1.5, 3.0], has_wrist_frame=True, replay_success=True)


def _lines_with(prompt, *words):
    return [line for line in prompt.splitlines() if all(w in line for w in words)]


def test_prompt_no_longer_presumes_the_demo_has_a_problem():
    assert "Find what makes this demo a poor training example" not in _prompt()


def test_prompt_says_a_clean_demo_is_keep_with_no_issues_and_shows_one():
    prompt = _prompt()
    assert _lines_with(prompt, "clean demo", '"keep"', "no issues")
    assert '"issues": [], "repairs": [], "decision": "keep"' in prompt
    assert _lines_with(prompt, "when in doubt")


def test_prompt_gives_the_rules_jitter_floor_as_the_smooth_range():
    (line,) = _lines_with(_prompt(), "jitter", "jerk_rms", f"{JITTER_MIN_JERK:g}")
    assert "smooth" in line


def test_prompt_gives_normal_speeds_and_the_slow_threshold():
    prompt = _prompt()
    (line,) = _lines_with(prompt, "slow", f"{SLOW_SPEED:g} m/s")
    assert "median" in line
    lo, hi = CLEAN_MOVING_SPEED
    assert _lines_with(prompt, f"{lo:g}-{hi:g} m/s", "normal")
    assert _lines_with(prompt, f"{STILL_SPEED:g} m/s", "still")


def test_prompt_says_contacts_are_ground_truth_for_rim_contact_and_drop():
    prompt = _prompt()
    assert _lines_with(prompt, "contact", "ground truth")
    (rim,) = _lines_with(prompt, "never report rim_contact")
    assert "B" in rim and "force" in rim
    (drop,) = _lines_with(prompt, "never report drop")
    assert "G" in drop and "gripper" in drop


def test_slow_threshold_sits_between_still_and_clean_motion():
    assert STILL_SPEED < SLOW_SPEED < CLEAN_MOVING_SPEED[0]


# --- gate_diagnosis: model issues must agree with the measured metrics ---------------------------

def _w(i, **kw):
    base = dict(t0=i * 0.5, t1=(i + 1) * 0.5, speed=0.15, jerk_rms=2.0, gripper=1, dist_ee_cube=0.005,
                cube_height=0.2, contact_gripper_cube=True, contact_arm_bin=False, contact_arm_table=False)
    base.update(kw)
    return MetricsWindow(**base)


def _ws(per_window=None, n=6):
    """n clean 0.5 s windows; per_window maps a window index to field overrides."""
    return [_w(i, **(per_window or {}).get(i, {})) for i in range(n)]


def _diag(issues, repairs, decision="repair"):
    return Diagnosis.model_validate({
        "segments": [{"name": "carry", "t0": 0.0, "t1": 3.0}],
        "issues": issues, "repairs": repairs, "decision": decision, "label": TASK,
    })


def _issue(type, t0=None, t1=None, t=None):
    d = {"type": type, "evidence": "model says so"}
    d.update({k: v for k, v in (("t0", t0), ("t1", t1), ("t", t)) if v is not None})
    return d


RIM = _issue("rim_contact", 1.0, 1.5)
REPLAN = {"op": "replan_transit", "t0": 1.0, "t1": 1.5}


def test_gate_drops_rim_contact_without_arm_bin_contact_and_its_repair():
    diag, gated = gate_diagnosis(_diag([RIM], [REPLAN]), _ws())
    assert diag.issues == [] and diag.repairs == []
    assert any("rim_contact" in g and "1.00-1.50" in g for g in gated)
    assert any("replan_transit" in g for g in gated)


def test_gate_keeps_rim_contact_with_arm_bin_contact_in_an_overlapping_window():
    diag, gated = gate_diagnosis(_diag([RIM], [REPLAN]), _ws({2: {"contact_arm_bin": True}}))
    assert [i.type for i in diag.issues] == ["rim_contact"]
    assert [r.op for r in diag.repairs] == ["replan_transit"]
    assert gated == []


def test_gate_ignores_contact_in_a_window_that_only_touches_the_issue_span():
    _, gated = gate_diagnosis(_diag([RIM], [REPLAN]), _ws({3: {"contact_arm_bin": True}}))  # 1.5-2.0
    assert any("rim_contact" in g for g in gated)


def test_gate_uses_the_window_containing_a_point_time():
    diag, _ = gate_diagnosis(_diag([_issue("rim_contact", t=1.2)], []), _ws({2: {"contact_arm_bin": True}}))
    assert [i.type for i in diag.issues] == ["rim_contact"]
    diag, gated = gate_diagnosis(_diag([_issue("rim_contact", t=1.2)], []), _ws())
    assert diag.issues == [] and gated


def test_gate_drops_jitter_when_every_window_is_below_the_rules_floor():
    jitter = _issue("jitter", 1.0, 2.0)
    smooth = {"op": "smooth", "t0": 1.0, "t1": 2.0, "strength": "med"}
    below = _ws({2: {"jerk_rms": JITTER_MIN_JERK - 0.1}, 3: {"jerk_rms": 6.0}})
    diag, gated = gate_diagnosis(_diag([jitter], [smooth]), below)
    assert diag.issues == [] and diag.repairs == []
    assert any("jitter" in g and f"{JITTER_MIN_JERK:g}" in g for g in gated)


def test_gate_keeps_jitter_when_one_window_reaches_the_floor():
    jitter = _issue("jitter", 1.0, 2.0)
    diag, gated = gate_diagnosis(_diag([jitter], []), _ws({3: {"jerk_rms": JITTER_MIN_JERK}}))
    assert [i.type for i in diag.issues] == ["jitter"]
    assert gated == []


def test_gate_drops_slow_unless_the_median_speed_is_below_the_slow_threshold():
    slow = _issue("slow", 1.0, 2.5)
    retime = {"op": "retime", "t0": 1.0, "t1": 2.5, "target_speed": 0.2}
    # windows 2, 3, 4: a dip at the grasp is not a slow span
    dip = _ws({2: {"speed": 0.03}, 3: {"speed": 0.15}, 4: {"speed": 0.2}})
    diag, gated = gate_diagnosis(_diag([slow], [retime]), dip)
    assert diag.issues == [] and diag.repairs == []
    assert any("slow" in g and f"{SLOW_SPEED:g}" in g for g in gated)

    crawl = _ws({2: {"speed": 0.03}, 3: {"speed": 0.04}, 4: {"speed": 0.2}})
    diag, gated = gate_diagnosis(_diag([slow], [retime]), crawl)
    assert [i.type for i in diag.issues] == ["slow"] and [r.op for r in diag.repairs] == ["retime"]
    assert gated == []


def test_gate_keeps_a_repair_that_also_serves_a_kept_issue():
    pause = _issue("pause", 1.0, 1.5)
    rm = {"op": "remove_pause", "t0": 1.0, "t1": 1.5}
    diag, gated = gate_diagnosis(_diag([pause, RIM], [rm]), _ws())
    assert [i.type for i in diag.issues] == ["pause"]
    assert [r.op for r in diag.repairs] == ["remove_pause"]
    assert diag.decision == "repair"
    assert len(gated) == 1


def test_gate_leaves_other_issue_types_and_unrelated_repairs_alone():
    issues = [_issue(t, 0.5, 1.0) for t in ("pause", "grasp_off_center", "wrong_object", "drop", "other")]
    repairs = [{"op": "trim", "t0": 0.0, "t1": 2.5}, REPLAN]
    diag = _diag(issues, repairs)
    gated_diag, gated = gate_diagnosis(diag, _ws())
    assert gated_diag == diag
    assert gated == []


def test_gate_turns_the_decision_to_keep_when_no_issues_remain():
    trim = {"op": "trim", "t0": 0.0, "t1": 2.5}  # tied to no issue
    diag, gated = gate_diagnosis(_diag([RIM], [REPLAN, trim]), _ws())
    assert diag.decision == "keep"
    assert diag.issues == [] and diag.repairs == []
    assert any("keep" in g for g in gated)


def test_gate_turns_a_discard_over_only_false_issues_into_keep():
    diag, _ = gate_diagnosis(_diag([RIM], [{"op": "discard"}], decision="discard"), _ws())
    assert diag.decision == "keep" and diag.repairs == []


def test_gate_does_not_touch_a_diagnosis_it_dropped_nothing_from():
    diag = _diag([], [{"op": "discard"}], decision="discard")  # odd, but not the gate's call
    assert gate_diagnosis(diag, _ws()) == (diag, [])


def test_gate_drops_an_issue_with_no_overlapping_window():
    _, gated = gate_diagnosis(_diag([_issue("jitter", 1.0, 1.5)], []), [])
    assert any("jitter" in g for g in gated)


def test_diagnose_applies_the_gate_to_the_model_reply():
    false_rim = _diag([RIM], [REPLAN]).model_dump(mode="json")
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.return_value = _reply(json.dumps(false_rim))
        diag = _diagnose(windows=_ws())
    assert diag.decision == "keep" and diag.issues == []


def test_diagnose_gated_returns_what_was_dropped():
    false_rim = _diag([RIM], [REPLAN]).model_dump(mode="json")
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.return_value = _reply(json.dumps(false_rim))
        kwargs = dict(frames=[(0.0, b"f0")], wrist_frame=None, windows=_ws(), task_text=TASK,
                      replay_success=True, duration=DURATION)
        diag, gated = diagnose_gated(**kwargs)
    assert diag.decision == "keep"
    assert len(gated) == 3  # the issue, its repair, the decision


# --- re-diagnosis: the previous repair's failure reasons (sprint 3b, Task 1) ---------------------

def test_prompt_states_why_the_previous_repair_failed():
    prompt = build_diagnosis_prompt(TASK, _windows(), [0.0, 1.5], has_wrist_frame=False, replay_success=False,
                                    failure_reasons=["not_in_bin", "arm_bin_contact"])
    line = next(ln for ln in prompt.splitlines() if "previous repair" in ln)
    assert "the previous repair failed verification because: not_in_bin, arm_bin_contact" in line
    assert prompt.index(line) < prompt.index("Images, in order:")  # stated up front, with the replay result


def test_prompt_without_failure_reasons_has_no_previous_repair_line():
    for reasons in (None, []):
        prompt = build_diagnosis_prompt(TASK, _windows(), [0.0], has_wrist_frame=False, replay_success=True,
                                        failure_reasons=reasons)
        assert "previous repair" not in prompt


def test_diagnose_passes_failure_reasons_into_the_prompt():
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.return_value = _reply(json.dumps(GOOD))
        _diagnose(replay_success=False, failure_reasons=["not_settled"])
    assert "failed verification because: not_settled" in vision.call_args.args[0]


def test_failure_reasons_survive_the_retry_prompt():
    with patch("app.ai.diagnose.chat_vision_images") as vision:
        vision.side_effect = [_reply("not json"), _reply(json.dumps(GOOD))]
        diagnose_gated(frames=[(0.0, b"f0")], wrist_frame=None, windows=_windows(), task_text=TASK,
                       replay_success=False, duration=DURATION, failure_reasons=["drop"])
    assert "failed verification because: drop" in vision.call_args_list[1].args[0]
