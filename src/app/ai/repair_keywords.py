"""R6 baseline: a zero-call keyword/regex parser for repair requests.

It emits the same intents as the model path (repair_request.py), so both are resolved and scored
the same way. Built against tests/test_repair_keywords.py only (sprint 7 pre-registration).

Per clause (split on , ; . but then and): a clause with a negation word is dropped; otherwise the
first op whose keywords appear wins, and a clause that names only a span reuses the last op.
"""
from __future__ import annotations

import re

from .repair_request import (
    DemoContext,
    DiscardIntent,
    RecenterIntent,
    RemovePauseIntent,
    ReplanIntent,
    RetimeIntent,
    SmoothIntent,
    TrimIntent,
)

_SPLIT = re.compile(r"[,;]|\.(?!\d)|\s+but\s+|\s+then\s+|\s+and\s+(?!\d)")
_NEGATION = re.compile(r"\b(don'?t|do not|no need|no changes?|leave|keep|fine|not|never|without)\b")

# First match wins, in this order.
_OPS = [
    ("discard", re.compile(r"\b(discard|scrap|garbage|useless|throw (it|this)( demo)? (out|away))\b")),
    ("remove_pause", re.compile(r"\b(pauses?|hesitat\w*|stops?|stopp\w*|halts?)\b")),
    ("trim", re.compile(r"\b(trim\w*|idle|dead time|sits? there|sitting|waiting|wait)\b")),
    ("recenter_grasp", re.compile(r"\b(grasp\w*|grab\w*|grip)\b|off.?cent(er|re)|\bcent(er|re)\b")),
    ("replan_transit", re.compile(r"\b(higher|rim|clears?|clearance|raise)\b")),
    ("smooth", re.compile(r"\b(smooth\w*|shak\w+|jitter\w*|jerky|wobbl\w*|tremor)\b")),
    ("retime", re.compile(r"\b(fast\w*|slow\w*|speed\w*|quick\w*|sluggish)\b")),
]
_SPANS = [
    ("approach", re.compile(r"\b(approach\w*|reach\w*)\b")),
    ("carry", re.compile(r"\b(carry\w*|transport\w*|transit)\b")),
    ("retreat", re.compile(r"\b(retreat\w*|withdraw\w*|retract\w*)\b")),
    ("whole", re.compile(r"\b(whole|everything|entire|demo)\b")),
]
_NUM = r"(\d+(?:\.\d+)?)"
_TIME_SPAN = re.compile(rf"\b(?:between|from)\s+{_NUM}\s*(?:s|sec\w*)?\s*(?:and|to|-)\s*{_NUM}")
_TIME_POINT = re.compile(rf"{_NUM}\s*(?:s\b|sec\w*)")
_ORDINALS = {1: r"first|1st|one", 2: r"second|2nd|two", 3: r"third|3rd|three"}


def _span(clause: str):
    m = _TIME_SPAN.search(clause)
    if m:
        return (float(m.group(1)), float(m.group(2)))
    return next((name for name, rx in _SPANS if rx.search(clause)), None)


def _pause(clause: str, ctx: DemoContext):
    for k, words in _ORDINALS.items():
        if re.search(rf"\b({words})\b", clause):
            return k
    m = _TIME_POINT.search(clause)
    if m and ctx.pauses:
        t = float(m.group(1))
        return 1 + min(range(len(ctx.pauses)), key=lambda i: abs(sum(ctx.pauses[i]) / 2 - t))
    if re.search(r"\b(pauses|both|all|every)\b", clause) or len(ctx.pauses) != 1:
        return "all"
    return 1


def _trim_end(clause: str) -> str:
    if re.search(r"\b(both|ends)\b", clause):
        return "both"
    if re.search(r"\b(start\w*|begin\w*|first|initial)\b", clause):
        return "start"
    if re.search(r"\b(end|finish\w*|last|final)\b", clause):
        return "end"
    return "both"


def _strength(clause: str) -> str:
    if re.search(r"\b(a lot|heavily|very|really|much|strongly)\b", clause):
        return "high"
    if re.search(r"\b(slightly|a little|a bit|gently|lightly)\b", clause):
        return "low"
    return "med"


def _factor(clause: str) -> float:
    m = re.search(rf"{_NUM}\s*(?:x|times)\b", clause)
    if m:
        return float(m.group(1))
    if re.search(r"\b(twice|double)\b", clause):
        return 2.0
    if re.search(r"\bhalf\b", clause):
        return 0.5
    if re.search(r"\btoo (slow|sluggish)\b", clause):
        return 1.5
    if re.search(r"\btoo fast\b|\bslow\w*\b", clause):
        return 0.7
    return 1.5


def _intent(op: str, clause: str, span, ctx: DemoContext):
    if op == "discard":
        return DiscardIntent(op="discard")
    if op == "remove_pause":
        return RemovePauseIntent(op="remove_pause", pause=_pause(clause, ctx))
    if op == "trim":
        return TrimIntent(op="trim", end=_trim_end(clause))
    if op == "recenter_grasp":
        return RecenterIntent(op="recenter_grasp")
    if op == "replan_transit":
        return ReplanIntent(op="replan_transit")
    if op == "smooth":
        return SmoothIntent(op="smooth", span=span, strength=_strength(clause))
    return RetimeIntent(op="retime", span=span, speed_factor=_factor(clause))


def parse_with_keywords(text: str, ctx: DemoContext) -> list:
    """Intents for a request, by keywords alone. A question gives none."""
    text = text.lower().replace("\u2019", "'").strip()
    if text.endswith("?"):
        return []
    out, last_op, last_span = [], None, "whole"
    for clause in (c.strip() for c in _SPLIT.split(text)):
        if not clause or _NEGATION.search(clause):
            continue
        op = next((name for name, rx in _OPS if rx.search(clause)), None)
        span = _span(clause)
        if op is None and span is not None and last_op in ("smooth", "retime"):
            op = last_op  # "smooth the approach and the carry"
        if op is None:
            continue
        span = span if span is not None else last_span
        intent = _intent(op, clause, span, ctx)
        if intent not in out:
            out.append(intent)
        last_op, last_span = op, span
    return out
