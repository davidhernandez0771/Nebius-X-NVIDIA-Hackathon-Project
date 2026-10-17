"""app.ai.repair_keywords: the zero-call keyword baseline for R6.

Its phrases are deliberately NOT the ones in tests/data/repair_requests.jsonl (pre-registration,
2026-10-17): the baseline is built against these tests only, then run once on the eval set.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.ai.repair_keywords import parse_with_keywords
from app.ai.repair_request import DemoContext

CTX = DemoContext.from_dict(json.loads((Path(__file__).resolve().parent / "data" / "repair_requests_context.json").read_text()))


def _dump(text):
    return [i.model_dump(exclude_none=True) for i in parse_with_keywords(text, CTX)]


@pytest.mark.parametrize("text, want", [
    ("trim the waiting at the start", [{"op": "trim", "end": "start"}]),
    ("cut the idle ends", [{"op": "trim", "end": "both"}]),
    ("lose the idle bit at the finish", [{"op": "trim", "end": "end"}]),
    ("remove the second pause", [{"op": "remove_pause", "pause": 2}]),
    ("remove pauses", [{"op": "remove_pause", "pause": "all"}]),
    ("delete the pause near 6 s", [{"op": "remove_pause", "pause": 1}]),
    ("smooth the approach gently", [{"op": "smooth", "span": "approach", "strength": "low"}]),
    ("the reach is jerky", [{"op": "smooth", "span": "approach", "strength": "med"}]),
    ("smooth from 1 to 2 seconds", [{"op": "smooth", "span": (1.0, 2.0), "strength": "med"}]),
    ("3x faster carry", [{"op": "retime", "span": "carry", "speed_factor": 3.0}]),
    ("slow the whole demo down", [{"op": "retime", "span": "whole", "speed_factor": 0.7}]),
    ("the withdrawal is too fast", [{"op": "retime", "span": "retreat", "speed_factor": 0.7}]),
    ("grab the cube at its center", [{"op": "recenter_grasp"}]),
    ("raise the path so it clears the rim", [{"op": "replan_transit"}]),
    ("scrap this one", [{"op": "discard"}]),
])
def test_single_requests(text, want):
    assert _dump(text) == want


def test_a_negated_clause_is_dropped():
    assert _dump("don't smooth, but trim the start") == [{"op": "trim", "end": "start"}]
    assert _dump("the carry is fine; remove the first pause") == [{"op": "remove_pause", "pause": 1}]


def test_several_clauses_give_several_ops():
    assert _dump("trim the end and smooth the carry a lot") == [
        {"op": "trim", "end": "end"}, {"op": "smooth", "span": "carry", "strength": "high"}]


@pytest.mark.parametrize("text", ["how do I trim?", "great job", "paint the cube green"])
def test_no_op_requests(text):
    assert _dump(text) == []


def test_a_clause_with_only_a_span_reuses_the_previous_op():
    assert _dump("smooth the reach and the withdrawal") == [
        {"op": "smooth", "span": "approach", "strength": "med"}, {"op": "smooth", "span": "retreat", "strength": "med"}]
