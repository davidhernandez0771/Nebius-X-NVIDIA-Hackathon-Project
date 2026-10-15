"""Nemotron VL diagnoser: prompt contents, reply parsing and the retry loop, with chat_vision_images mocked."""
from __future__ import annotations

import json
from types import SimpleNamespace as NS
from typing import get_args
from unittest.mock import patch

import pytest

from app.ai.diagnose import DiagnosisError, build_diagnosis_prompt, diagnose, parse_diagnosis
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
