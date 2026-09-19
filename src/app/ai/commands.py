"""Parse a free-text chat command into one structured action via Nemotron.

The parser only proposes an action; the router validates it against the
database before anything executes (see docs/ARCHITECTURE.md §8). "unknown" is
the safe default for anything that doesn't clearly match.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from nebius_llm import chat

COMMAND_PROMPT = (
    "You are a command parser for a home-inventory app. Given the user's "
    "message, output ONLY a JSON object describing one action, no prose. "
    "Shape:\n"
    '{"action": "trash"|"organize"|"move"|"query"|"unknown", '
    '"item_name": str|null, "location_name": str|null, "question": str|null}\n'
    'Use "unknown" if the message does not clearly map to one of these '
    "actions. Never invent an item or location name that was not mentioned."
)

VALID_ACTIONS = {"trash", "organize", "move", "query", "unknown"}

# Fields an action cannot run without. The model sometimes proposes "trash" or
# "move" with the target missing ("trash it", "delete everything", "move the
# lamp"); prompt wording alone doesn't prevent that, so it is enforced here.
REQUIRED_FIELDS = {
    "trash": ("item_name",),
    "move": ("item_name", "location_name"),
    "query": ("question",),
}


@dataclass
class ParsedCommand:
    action: str
    item_name: str | None
    location_name: str | None
    question: str | None


def parse_command(text: str) -> tuple[ParsedCommand, float]:
    result = chat(text, tier="nano", system=COMMAND_PROMPT, max_tokens=200)
    return _parse(result.text), result.est_cost_usd


def _parse(raw_text: str) -> ParsedCommand:
    text = raw_text.strip()
    # Same reasoning as ai/vision.py: don't require an exact-format reply,
    # just find the outermost {...} and parse that.
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        return ParsedCommand(action="unknown", item_name=None, location_name=None, question=None)
    action = data.get("action")
    if action not in VALID_ACTIONS:
        action = "unknown"
    parsed = ParsedCommand(
        action=action,
        item_name=_clean(data.get("item_name")),
        location_name=_clean(data.get("location_name")),
        question=_clean(data.get("question")),
    )
    if any(not getattr(parsed, field) for field in REQUIRED_FIELDS.get(action, ())):
        return ParsedCommand(action="unknown", item_name=None, location_name=None, question=None)
    return parsed


def _clean(value) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip()[:200] or None
