"""scripts/repair_request_eval.py: scoring (pre-registered 2026-10-17) and the call-capped runner. Model faked."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from app.ai.repair_request import DemoContext, parse_intents

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "repair_request_eval.py"
DATA = Path(__file__).resolve().parent / "data"


def _load():
    spec = importlib.util.spec_from_file_location("repair_request_eval", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


ev = _load()
CTX = DemoContext.from_dict(json.loads((DATA / "repair_requests_context.json").read_text()))


def _atoms(ops):
    return ev.normalize(parse_intents(json.dumps({"ops": ops})), CTX)


# --- the eval set itself ----------------------------------------------------------------

def test_the_eval_set_is_the_pre_registered_one():
    rows = ev.load_set(DATA / "repair_requests.jsonl")
    assert len(rows) == 34
    counts = {c: sum(r["category"] == c for r in rows) for c in ("paraphrase", "negation", "multi", "none")}
    assert counts == {"paraphrase": 15, "negation": 7, "multi": 7, "none": 5}
    assert len({r["id"] for r in rows}) == 34


# --- normalize: one atom per thing the user asked for ------------------------------------

def test_normalize_expands_both_ends_and_all_pauses():
    assert _atoms([{"op": "trim", "end": "both"}, {"op": "remove_pause", "pause": "all"}]) == [
        {"op": "trim", "end": "start"}, {"op": "trim", "end": "end"},
        {"op": "remove_pause", "pause": 1}, {"op": "remove_pause", "pause": 2}]


def test_normalize_keeps_span_strength_and_factor():
    assert _atoms([{"op": "smooth", "span": [3, 5], "strength": "low"},
                   {"op": "retime", "span": "carry", "speed_factor": 1.5}, {"op": "discard"}]) == [
        {"op": "smooth", "span": [3.0, 5.0], "strength": "low"},
        {"op": "retime", "span": "carry", "factor": 1.5}, {"op": "discard"}]


def test_normalize_drops_duplicates():
    assert _atoms([{"op": "remove_pause", "pause": 1}, {"op": "remove_pause", "pause": "all"}]) == [
        {"op": "remove_pause", "pause": 1}, {"op": "remove_pause", "pause": 2}]


# --- matches: the pre-registered rules ----------------------------------------------------

@pytest.mark.parametrize("pred, gold, ok", [
    ({"op": "trim", "end": "start"}, {"op": "trim", "end": "start"}, True),
    ({"op": "trim", "end": "end"}, {"op": "trim", "end": "start"}, False),
    ({"op": "remove_pause", "pause": 2}, {"op": "remove_pause", "pause": 1}, False),
    ({"op": "smooth", "span": "carry", "strength": "low"}, {"op": "smooth", "span": "carry", "strength": None}, True),
    ({"op": "smooth", "span": "carry", "strength": "low"}, {"op": "smooth", "span": "carry", "strength": "high"}, False),
    ({"op": "smooth", "span": "whole", "strength": "med"}, {"op": "smooth", "span": "carry", "strength": None}, False),
    ({"op": "smooth", "span": [3.2, 4.8], "strength": "med"}, {"op": "smooth", "span": [3.0, 5.0], "strength": None}, True),
    ({"op": "smooth", "span": [3.3, 5.0], "strength": "med"}, {"op": "smooth", "span": [3.0, 5.0], "strength": None}, False),
    ({"op": "smooth", "span": "carry", "strength": "med"}, {"op": "smooth", "span": [3.0, 5.0], "strength": None}, False),
    ({"op": "retime", "span": "approach", "factor": 2.0}, {"op": "retime", "span": "approach", "factor": [1.9, 2.1]}, True),
    ({"op": "retime", "span": "approach", "factor": 1.5}, {"op": "retime", "span": "approach", "factor": [1.9, 2.1]}, False),
    ({"op": "recenter_grasp"}, {"op": "recenter_grasp"}, True),
    ({"op": "recenter_grasp"}, {"op": "replan_transit"}, False),
])
def test_matches(pred, gold, ok):
    assert ev.matches(pred, gold) is ok


# --- score -----------------------------------------------------------------------------

def test_score_exact_match_micro_and_per_op():
    rows = [
        {"id": "a", "category": "multi", "gold": [{"op": "recenter_grasp"}, {"op": "trim", "end": "end"}],
         "pred": [{"op": "recenter_grasp"}, {"op": "trim", "end": "start"}]},   # 1 TP, 1 FP, 1 FN
        {"id": "b", "category": "none", "gold": [], "pred": []},                 # exact
        {"id": "c", "category": "none", "gold": [], "pred": [{"op": "discard"}]},  # 1 FP
        {"id": "d", "category": "paraphrase", "gold": [{"op": "discard"}], "pred": [{"op": "discard"}]},
    ]
    s = ev.score(rows)
    assert s["exact"] == {"all": 0.5, "multi": 0.0, "none": 0.5, "paraphrase": 1.0}
    assert (s["micro"]["tp"], s["micro"]["fp"], s["micro"]["fn"]) == (2, 2, 1)
    assert s["micro"]["p"] == pytest.approx(0.5) and s["micro"]["r"] == pytest.approx(2 / 3)
    assert s["per_op"]["trim"] == {"tp": 0, "fp": 1, "fn": 1, "p": 0.0, "r": 0.0, "f1": 0.0}
    assert s["per_op"]["discard"]["fp"] == 1 and s["per_op"]["discard"]["tp"] == 1
    assert s["op_only"]["tp"] == 3  # trim/start counts as a trim when params are ignored


def test_score_handles_an_op_never_predicted_or_expected():
    s = ev.score([{"id": "x", "category": "none", "gold": [], "pred": []}])
    assert s["micro"]["f1"] == 0.0 and s["exact"]["all"] == 1.0


# --- the arms ---------------------------------------------------------------------------

class FakeChat:
    def __init__(self, *replies):
        self.replies, self.n = list(replies), 0

    def __call__(self, prompt, tier=None, *, system=None, max_tokens=1024, **kw):
        self.n += 1
        return type("R", (), {"text": self.replies.pop(0), "est_cost_usd": 0.0004})()


SET = [{"id": "q1", "category": "paraphrase", "text": "center the grasp", "expect": [{"op": "recenter_grasp"}]},
       {"id": "q2", "category": "none", "text": "looks good", "expect": []},
       {"id": "q3", "category": "paraphrase", "text": "scrap it", "expect": [{"op": "discard"}]}]


def test_keyword_arm_makes_no_calls():
    rows, spend = ev.run_keywords(SET, CTX)
    assert [r["pred"] for r in rows] == [[{"op": "recenter_grasp"}], [], [{"op": "discard"}]]
    assert spend == {"calls": 0, "cost": 0.0}


def test_model_arm_retries_once_and_records_invalid():
    fake = FakeChat('{"ops": [{"op": "recenter_grasp"}]}', "junk", "junk", '{"ops": [{"op": "discard"}]}')
    rows, spend = ev.run_model(SET, CTX, chat_fn=fake, max_calls=10, max_cost=1.0)
    assert [r["pred"] for r in rows] == [[{"op": "recenter_grasp"}], [], [{"op": "discard"}]]
    assert [r["invalid"] for r in rows] == [False, True, False]
    assert spend["calls"] == 4 == fake.n and spend["cost"] == pytest.approx(0.0016)


def test_model_arm_never_exceeds_the_call_cap():
    fake = FakeChat("junk", "junk", "junk")
    rows, spend = ev.run_model(SET, CTX, chat_fn=fake, max_calls=3, max_cost=1.0)
    assert spend["calls"] == 3 == fake.n
    assert [r.get("skipped") for r in rows] == [None, None, "budget"]
    assert rows[2]["pred"] == []


def test_model_arm_stops_at_the_cost_cap():
    fake = FakeChat('{"ops": []}', '{"ops": []}', '{"ops": []}')
    rows, spend = ev.run_model(SET, CTX, chat_fn=fake, max_calls=10, max_cost=0.0007)
    assert spend["calls"] == 1  # a second call would cross the cap, so it is never made
    assert [r.get("skipped") for r in rows] == [None, "budget", "budget"]
