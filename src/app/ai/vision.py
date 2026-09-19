"""Turn one area photo into candidate inventory items via chat_vision().

Everything returned here is a *proposal*: candidates only become inventory after
the user confirms them on the Review screen (docs/ARCHITECTURE.md §1).

Truncation history: a MiniCPM call on 2026-09-18 hit the 1024-token cap
(finish_reason "length") -- see usage_log.jsonl. The reply is a JSON array, so a
cut-off reply is invalid JSON and the old parser returned nothing. Two defences:
the prompt now bounds the output (max items, short fields, one line), and the
parser salvages every *complete* object from a partial array instead of
discarding the lot.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from nebius_llm import chat_vision

MAX_CANDIDATES = 20  # hard ceiling on what one photo can propose
MAX_COUNT = 99
MAX_TEXT_CHARS = 80
VISION_MAX_TOKENS = 700  # ~20 short items fit; a runaway reply is cut off cheaply

ITEMIZE_PROMPT = (
    "You are looking at one photo of a storage area (a shelf, drawer, or desk). "
    f"List each distinct kind of physical item you can see, at most {MAX_CANDIDATES}. "
    "Group identical items into one entry using count; never list the same item twice. "
    "Respond with ONLY a compact JSON array on a single line, no prose, no markdown "
    "fences. Each element: "
    '{"label": str, "category": str, "count": int, "uncertainty_note": str}. '
    "Keep label and category to a few words. uncertainty_note is at most 8 words "
    "for anything partially hidden, ambiguous, or a guess; otherwise use an empty "
    "string. If you see nothing identifiable, return []."
)


@dataclass
class CandidateGuess:
    label: str
    category: str
    count: int
    uncertainty_note: str


@dataclass
class ItemizeResult:
    candidates: list[CandidateGuess]
    est_cost_usd: float
    finish_reason: str | None = None
    truncated: bool = False  # reply was cut off or only partly parseable
    raw_text: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_s: float = 0.0
    model: str = ""
    warnings: list[str] = field(default_factory=list)


def itemize_photo(
    image_bytes: bytes, *, mime_type: str = "image/jpeg", tier: str | None = None
) -> tuple[list[CandidateGuess], float]:
    """Returns (candidates, est_cost_usd). Raises the same errors as chat_vision().

    An empty list can mean "nothing in frame" or "the model's reply didn't
    parse as JSON" -- both are surfaced the same way (empty candidates) so the
    review screen always has a sane, safe fallback: manual entry.
    """
    result = itemize_photo_detailed(image_bytes, mime_type=mime_type, tier=tier)
    return result.candidates, result.est_cost_usd


def itemize_photo_detailed(
    image_bytes: bytes, *, mime_type: str = "image/jpeg", tier: str | None = None
) -> ItemizeResult:
    """Like itemize_photo() but also reports finish_reason, tokens and latency."""
    reply = chat_vision(
        ITEMIZE_PROMPT,
        image_bytes,
        mime_type=mime_type,
        tier=tier,
        max_tokens=VISION_MAX_TOKENS,
    )
    text = reply.text
    finish_reason = getattr(reply, "finish_reason", None)
    candidates, complete = _parse_with_status(text)
    truncated = finish_reason == "length" or not complete
    warnings = []
    if finish_reason == "length":
        warnings.append("model hit the token limit; the list may be incomplete")
    elif not complete:
        warnings.append("reply was not a complete JSON array; kept the complete items only")
    return ItemizeResult(
        candidates=candidates,
        est_cost_usd=reply.est_cost_usd,
        finish_reason=finish_reason,
        truncated=truncated,
        raw_text=text,
        prompt_tokens=getattr(reply, "prompt_tokens", 0),
        completion_tokens=getattr(reply, "completion_tokens", 0),
        latency_s=getattr(reply, "latency_s", 0.0),
        model=getattr(reply, "model", ""),
        warnings=warnings,
    )


_FENCE = re.compile(r"```(?:json)?", re.IGNORECASE)


def _parse_candidates(raw_text: str) -> list[CandidateGuess]:
    return _parse_with_status(raw_text)[0]


def _parse_with_status(raw_text: str) -> tuple[list[CandidateGuess], bool]:
    """Parse a model reply into candidates. Never raises.

    Returns (candidates, complete). complete is False when the reply wasn't a
    well-formed JSON array (truncated, prose-wrapped garbage, ...); in that case
    every fully-formed object found is still kept.
    """
    text = _FENCE.sub("", raw_text or "").strip()
    start = text.find("[")
    if start == -1:
        return [], False

    decoder = json.JSONDecoder()
    entries: list = []
    complete = False
    pos = start + 1
    n = len(text)
    while pos < n:
        # skip whitespace and commas between elements
        while pos < n and text[pos] in " \t\r\n,":
            pos += 1
        if pos >= n:
            break
        if text[pos] == "]":
            complete = True
            break
        try:
            value, pos = decoder.raw_decode(text, pos)
        except json.JSONDecodeError:
            break  # partial/garbled element: stop, keep what we have
        entries.append(value)
        if len(entries) > MAX_CANDIDATES * 4:
            break  # runaway output; don't scan forever

    return _to_candidates(entries), complete


def _clean(value, limit: int = MAX_TEXT_CHARS) -> str:
    if value is None:
        return ""
    return str(value).strip()[:limit]


def _to_candidates(entries: list) -> list[CandidateGuess]:
    out: list[CandidateGuess] = []
    seen: set[tuple[str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        label = _clean(entry.get("label"))
        if not label:
            continue
        category = _clean(entry.get("category"))
        key = (label.lower(), category.lower())
        if key in seen:  # models in a repetition loop emit the same item over and over
            continue
        seen.add(key)
        try:
            count = int(entry.get("count") or 1)
        except (TypeError, ValueError, OverflowError):
            count = 1
        out.append(
            CandidateGuess(
                label=label,
                category=category,
                count=min(max(count, 1), MAX_COUNT),
                uncertainty_note=_clean(entry.get("uncertainty_note")),
            )
        )
        if len(out) >= MAX_CANDIDATES:
            break
    return out
