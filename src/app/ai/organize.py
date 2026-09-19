"""Ask Nemotron for a reorganization *proposal* grounded in confirmed items.

Text-only, cheap, uses the standard nano tier -- no vision model involved.
Never executes anything itself; the route just stores the suggestion as a
Proposal (see docs/ARCHITECTURE.md §1/§7).

The prompt asks for one strict line per move, and the backend -- not the model
-- decides what survives: a line is kept only if its item is in the confirmed
inventory and its destination is a real location, and its text is rebuilt from
those canonical names. Anything that mentions buying/adding things, or an item
we don't have, is dropped.
"""
from __future__ import annotations

import json
import re

from nebius_llm import chat

MAX_SUGGESTIONS = 6
MAX_REASON_CHARS = 120

ORGANIZE_SYSTEM = (
    "You help rearrange things a person already owns. You are given JSON with "
    "\"items\" (confirmed items and their current location) and \"locations\" "
    "(existing location names). Propose up to 6 moves. Rules:\n"
    "- Only move items that appear in the item list, using their exact names.\n"
    "- Only move them to a location from the location list, using its exact name.\n"
    "- Never suggest buying, adding, getting, or bringing in anything (no bins, "
    "trays, boxes, labels, hooks, or any new item), and never mention items "
    "that are not in the list.\n"
    "- Only propose a move if it improves things (group similar items, keep "
    "daily items easy to reach). Skip items that are fine where they are.\n"
    "Output ONLY lines in exactly this format, one per move, no other text:\n"
    "- <item name> -> <location name>: <reason in at most 12 words>\n"
    "If nothing should move, output the single line: NONE"
)

NOTHING_TO_SUGGEST = (
    "I couldn't find a worthwhile rearrangement using only the items and "
    "locations you already have."
)

# Reasons that smuggle in acquiring or new things; the prompt forbids them and
# this enforces it.
_ACQUIRE = re.compile(
    r"\b(buy|bought|purchase|order|shop|acquire|invest|new|extra|additional|"
    r"add(?:ing)?|get(?:ting)?|bring(?:ing)?|install|label(?:s|ing)?)\b",
    re.IGNORECASE,
)


def suggest_organization(
    items_json: str, location_names: list[str] | None = None, *, tier: str = "nano"
) -> tuple[str, float]:
    """Returns (validated suggestion text, est_cost_usd)."""
    items = json.loads(items_json)
    locations = _unique([*(location_names or []), *(i.get("location", "") for i in items)])
    prompt = json.dumps({"items": items, "locations": locations})
    result = chat(prompt, tier=tier, system=ORGANIZE_SYSTEM, max_tokens=400)
    kept = validate_suggestion(result.text, items, locations)
    return ("\n".join(kept) if kept else NOTHING_TO_SUGGEST), result.est_cost_usd


def validate_suggestion(raw: str, items: list[dict], location_names: list[str]) -> list[str]:
    """Keep only well-formed, grounded moves; return them as canonical lines.

    Pure function so it is unit-testable without a model. Every returned line is
    rebuilt from names in `items` / `location_names`, so free text from the model
    never reaches the user except the short reason, which is screened.
    """
    by_item = {_key(i["name"]): i for i in items}
    by_location = {_key(name): name for name in location_names}
    kept: list[str] = []
    seen: set[str] = set()
    for line in (raw or "").splitlines():
        parsed = _parse_line(line)
        if not parsed:
            continue
        item_text, location_text, reason = parsed
        item = by_item.get(_key(item_text))
        location = by_location.get(_key(location_text))
        if not item or not location or _key(item["name"]) in seen:
            continue
        if _key(item.get("location", "")) == _key(location):
            continue  # "move" to where it already is
        if _ACQUIRE.search(reason):
            continue
        seen.add(_key(item["name"]))
        suffix = f": {reason}" if reason else ""
        kept.append(f"- {item['name']} → {location}{suffix}")
        if len(kept) >= MAX_SUGGESTIONS:
            break
    return kept


def _parse_line(line: str) -> tuple[str, str, str] | None:
    text = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line.strip())
    if "->" not in text and "→" not in text:
        return None
    left, _, right = re.split(r"(->|→)", text, maxsplit=1)
    location, _, reason = right.partition(":")
    return left.strip(), location.strip(), reason.strip()[:MAX_REASON_CHARS]


def _key(text: str) -> str:
    return re.sub(r"[\s\"'*_`]+", " ", str(text)).strip().lower()


def _unique(names) -> list[str]:
    out: list[str] = []
    for name in names:
        if name and _key(name) not in {_key(n) for n in out}:
            out.append(name)
    return out
