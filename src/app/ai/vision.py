"""Turn one area photo into candidate inventory items via chat_vision().

Untested against a real photo as of 2026-09-18 -- see docs/ARCHITECTURE.md §4/§9
for the shortlist and the budgeted first comparison test.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from nebius_llm import chat_vision

ITEMIZE_PROMPT = (
    "You are looking at one photo of a storage area (a shelf, drawer, or desk). "
    "List each distinct physical item you can see. Respond with ONLY a JSON "
    "array, no prose, no markdown fences. Each element: "
    '{"label": str, "category": str, "count": int, "uncertainty_note": str}. '
    "Use uncertainty_note for anything partially hidden, ambiguous, or a guess; "
    "otherwise use an empty string. If you see nothing identifiable, return []."
)


@dataclass
class CandidateGuess:
    label: str
    category: str
    count: int
    uncertainty_note: str


def itemize_photo(
    image_bytes: bytes, *, mime_type: str = "image/jpeg", tier: str | None = None
) -> tuple[list[CandidateGuess], float]:
    """Returns (candidates, est_cost_usd). Raises the same errors as chat_vision().

    An empty list can mean "nothing in frame" or "the model's reply didn't
    parse as JSON" -- both are surfaced the same way (empty candidates) so the
    review screen always has a sane, safe fallback: manual entry.
    """
    result = chat_vision(ITEMIZE_PROMPT, image_bytes, mime_type=mime_type, tier=tier)
    return _parse_candidates(result.text), result.est_cost_usd


def _parse_candidates(raw_text: str) -> list[CandidateGuess]:
    text = raw_text.strip()
    # Models routinely add a sentence before/after the JSON, or wrap it in a
    # markdown fence, despite being told not to. Rather than requiring the
    # reply to be pure JSON, grab the outermost [...] and parse just that --
    # far more forgiving of real model output than an exact-format match.
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[CandidateGuess] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        label = str(entry.get("label", "")).strip()
        if not label:
            continue
        try:
            count = int(entry.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        out.append(
            CandidateGuess(
                label=label,
                category=str(entry.get("category", "")).strip(),
                count=count,
                uncertainty_note=str(entry.get("uncertainty_note", "")).strip(),
            )
        )
    return out
