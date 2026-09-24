"""Organize proposals may only arrange items that exist in the confirmed
inventory, and never suggest acquiring anything. The model is mocked; the
backend validator is what is under test."""
from __future__ import annotations

import json
import re
from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest

from app import models
from app.ai.organize import (
    MAX_SUGGESTIONS,
    NOTHING_TO_SUGGEST,
    ORGANIZE_SYSTEM,
    validate_suggestion,
)
from conftest import db_session, make_item, make_location, make_room

ITEMS = [
    {"name": "desk lamp", "location": "Desk"},
    {"name": "keys", "location": "Desk"},
    {"name": "blue book", "location": "Top Shelf"},
]
LOCATIONS = ["Desk", "Top Shelf", "Drawer"]


def moved_items(lines: list[str]) -> set[str]:
    return {re.match(r"- (.+?) → ", line).group(1) for line in lines}


def assert_only_inventory_items(lines: list[str]):
    names = {i["name"] for i in ITEMS}
    assert moved_items(lines) <= names, f"proposal references items not in inventory: {lines}"


def test_valid_moves_are_kept_with_canonical_names():
    raw = "- Desk Lamp -> top shelf: keeps the desk clear\n- KEYS -> Drawer: safer there"
    lines = validate_suggestion(raw, ITEMS, LOCATIONS)
    assert lines == ["- desk lamp → Top Shelf: keeps the desk clear", "- keys → Drawer: safer there"]


def test_item_not_in_inventory_is_dropped():
    raw = "- storage tray -> Desk: corral the keys\n- toaster -> Drawer: tidy\n- keys -> Drawer: safer"
    lines = validate_suggestion(raw, ITEMS, LOCATIONS)
    assert_only_inventory_items(lines)
    assert moved_items(lines) == {"keys"}


def test_a_proposal_referencing_only_invented_items_yields_nothing():
    raw = "- small tray -> Desk: to hold the keys\n- label maker -> Drawer: label things"
    assert validate_suggestion(raw, ITEMS, LOCATIONS) == []


@pytest.mark.parametrize(
    "reason",
    ["buy a small bin for it", "add a tray beside it", "get a new organizer", "use extra hooks", "label the drawer"],
)
def test_reasons_that_suggest_acquiring_things_are_dropped(reason):
    assert validate_suggestion(f"- keys -> Drawer: {reason}", ITEMS, LOCATIONS) == []


def test_invented_destination_and_noop_and_duplicates_are_dropped():
    raw = "\n".join(
        [
            "- keys -> Garage: far away",  # not a real location
            "- keys -> Desk: already there",  # no-op
            "- blue book -> Drawer: ok",
            "- blue book -> Desk: contradicts the line above",  # duplicate item
        ]
    )
    assert validate_suggestion(raw, ITEMS, LOCATIONS) == ["- blue book → Drawer: ok"]


@pytest.mark.parametrize("raw", ["NONE", "", "Everything looks fine!", "1. Tidy up your desk.", "keys -> ", "-> Desk"])
def test_prose_and_malformed_output_yield_nothing(raw):
    assert validate_suggestion(raw, ITEMS, LOCATIONS) == []


def test_numbered_and_starred_bullets_parse_and_output_is_capped():
    many = [{"name": f"item{i}", "location": "Desk"} for i in range(20)]
    raw = "\n".join(f"{i + 1}. item{i} -> Drawer: fits" for i in range(20))
    assert len(validate_suggestion(raw, many, ["Desk", "Drawer"])) == MAX_SUGGESTIONS
    assert validate_suggestion("* keys → Drawer: safer", ITEMS, LOCATIONS) == ["- keys → Drawer: safer"]


def test_prompt_forbids_buying_and_invented_items():
    assert "Never suggest buying" in ORGANIZE_SYSTEM
    assert "exact names" in ORGANIZE_SYSTEM


@pytest.fixture
def room(api):
    room_id = make_room(api)
    return NS(id=room_id, location_id=make_location(api, room_id))


# --- through the API --------------------------------------------------------

def test_organize_endpoint_drops_invented_items_before_storing(api, room):
    make_location(api, room.id, "Shelf")
    make_item(room.id, room.location_id, "lamp")
    reply = "- storage tray -> Shelf: hold small things\n- lamp -> Shelf: easier to reach"
    with patch("app.ai.organize.chat", return_value=NS(text=reply, est_cost_usd=0.00002)):
        out = api.post("/api/organize", json={"room_id": room.id}).json()

    assert "tray" not in out["suggestion"]
    assert out["suggestion"] == "- lamp → Shelf: easier to reach"
    with db_session() as db:
        assert "tray" not in db.get(models.Proposal, out["proposal_id"]).suggested_text


def test_organize_endpoint_with_nothing_valid_says_so_honestly(api, room):
    make_location(api, room.id, "Shelf")  # a second location so this reaches the model call, not the single-location shortcut
    make_item(room.id, room.location_id, "lamp")
    with patch("app.ai.organize.chat", return_value=NS(text="- buy a bin -> Desk: tidy", est_cost_usd=0.0)):
        out = api.post("/api/organize", json={"room_id": room.id}).json()
    assert out["suggestion"] == NOTHING_TO_SUGGEST


def test_model_sees_existing_locations_only(api, room):
    make_location(api, room.id, "Shelf")
    make_item(room.id, room.location_id, "lamp")
    with patch("app.ai.organize.chat", return_value=NS(text="NONE", est_cost_usd=0.0)) as chat:
        api.post("/api/organize", json={"room_id": room.id})
    sent = json.loads(chat.call_args.args[0])
    assert sorted(sent["locations"]) == ["Desk", "Shelf"]
