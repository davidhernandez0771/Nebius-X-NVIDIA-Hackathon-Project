"""Nemotron labeler and judge: prompts, retries, the spend cap and the per-call log, with
chat_vision_images mocked (no network)."""
from __future__ import annotations

import json
import re
from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest

from app.ai.intent import Budget, BudgetExceeded, build_judge_prompt, build_label_prompt, judge_pair, label_demo
from demo_pipeline.intent import IntentError, summarize
from tests.test_intent import FPS, GOOD_LABEL, GOOD_VERDICT, traj

SUMMARY = summarize(traj(), FPS)
FRAMES = [(i, b"png%d" % i) for i in (0, 40, 80, 120, 160, 199)]


def reply(obj, cost=0.001):
    text = obj if isinstance(obj, str) else json.dumps(obj)
    return NS(text=text, prompt_tokens=3000, completion_tokens=200, est_cost_usd=cost, latency_s=2.0, finish_reason="stop", model="m")


def test_label_prompt_captions_every_image_and_does_not_leak_the_task():
    p = build_label_prompt(SUMMARY, [f for f, _ in FRAMES])
    assert "image 1 = frame 0 (0.00 s)" in p and "image 6 = frame 199 (3.98 s)" in p
    assert "gripper closes at: frame 60" in p
    for leak in ("red", "blue", "cube", "pick up"):  # the model has to see these itself
        assert not re.search(rf"\b{leak}\b", p, re.I)
    for step in ("reach", "grasp", "carry", "release"):
        assert step in p


def test_label_demo_sends_the_frames_and_logs_each_call():
    log = []
    with patch("app.ai.intent.chat_vision_images", return_value=reply(GOOD_LABEL)) as vision:
        lab = label_demo(FRAMES, SUMMARY, on_call=log.append)
    assert lab.destination == "bin"
    assert vision.call_args.args[1] == [png for _, png in FRAMES]
    assert vision.call_args.kwargs["tier"] == "nemotron-vl"
    assert log == [{"role": "labeler", "attempt": 1, "prompt_tokens": 3000, "completion_tokens": 200,
                    "est_cost_usd": 0.001, "latency_s": 2.0, "finish_reason": "stop", "valid": True, "error": None}]


def test_an_invalid_reply_is_retried_once_with_the_error():
    log = []
    with patch("app.ai.intent.chat_vision_images", side_effect=[reply("nonsense"), reply(GOOD_LABEL)]) as vision:
        label_demo(FRAMES, SUMMARY, on_call=log.append)
    assert "previous reply was rejected" in vision.call_args_list[1].args[0]
    assert [e["valid"] for e in log] == [False, True]
    with patch("app.ai.intent.chat_vision_images", return_value=reply("nonsense")):
        with pytest.raises(IntentError, match="2 attempts"):
            label_demo(FRAMES, SUMMARY)


def test_more_than_eight_frames_is_refused_before_any_call():
    with patch("app.ai.intent.chat_vision_images") as vision:
        with pytest.raises(ValueError, match="8"):
            label_demo([(i, b"x") for i in range(9)], SUMMARY)
    vision.assert_not_called()


def test_judge_prompt_names_the_two_clips_and_the_claimed_physics_result():
    p = build_judge_prompt(SUMMARY, [0, 66, 133, 199], SUMMARY, [0, 66, 133, 199], claimed="physics check: passed")
    assert "images 1-4" in p and "images 5-8" in p
    assert "physics check: passed" in p
    for check in ("same_object", "same_goal", "same_order", "copy_completes", "matches"):
        assert check in p


def test_judge_pair_returns_the_verdict():
    four = FRAMES[:4]
    with patch("app.ai.intent.chat_vision_images", return_value=reply(GOOD_VERDICT)) as vision:
        v = judge_pair(four, SUMMARY, four, SUMMARY)
    assert v.matches == "yes"
    assert len(vision.call_args.args[1]) == 8


def test_the_budget_stops_calls_before_the_cap_is_passed():
    budget = Budget(cap_usd=0.0025, per_call_reserve_usd=0.001)
    with patch("app.ai.intent.chat_vision_images", return_value=reply(GOOD_LABEL, cost=0.001)) as vision:
        label_demo(FRAMES, SUMMARY, budget=budget)
        label_demo(FRAMES, SUMMARY, budget=budget)
        with pytest.raises(BudgetExceeded):
            label_demo(FRAMES, SUMMARY, budget=budget)  # 0.002 spent + 0.001 reserve > 0.0025
    assert vision.call_count == 2
    assert budget.spent_usd == pytest.approx(0.002)
