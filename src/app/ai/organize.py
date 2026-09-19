"""Ask Nemotron for an organization suggestion grounded in confirmed items.

Text-only, cheap, uses the standard nano tier -- no vision model involved.
Never executes anything itself; the route just stores the suggestion as a
Proposal (see docs/ARCHITECTURE.md §1/§7).
"""
from __future__ import annotations

from nebius_llm import chat

ORGANIZE_SYSTEM = (
    "You help organize a home inventory. You will be given a JSON list of "
    "confirmed items with their current locations. Suggest a short, practical "
    "reorganization as 3-6 bullet points, referencing only items and locations "
    "in the list. Do not invent items. If the list is empty, say plainly that "
    "there is nothing to organize yet."
)


def suggest_organization(items_json: str, *, tier: str = "nano") -> tuple[str, float]:
    result = chat(items_json, tier=tier, system=ORGANIZE_SYSTEM, max_tokens=400)
    return result.text, result.est_cost_usd
