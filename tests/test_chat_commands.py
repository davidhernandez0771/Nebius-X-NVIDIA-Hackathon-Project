"""Chat command validation: the model only proposes; the backend decides.

Nemotron is mocked in every test (see conftest.say). Tests marked xfail
document a real gap in the current behavior; they are strict, so fixing the
bug turns them into a failure that says "remove the xfail marker".
"""
from __future__ import annotations

from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest

from app import models
from nebius_llm import TokenFactoryError

from conftest import db_session, get_item, make_item, make_location, make_room, say

DIDNT_UNDERSTAND = "I didn't understand that."


def trash(name):
    return {"action": "trash", "item_name": name, "location_name": None, "question": None}


@pytest.fixture
def room(api):
    room_id = make_room(api)
    return NS(id=room_id, location_id=make_location(api, room_id))


def command_rows():
    with db_session() as db:
        return db.query(models.Command).all()


# --- trash: the one action that executes today ------------------------------

def test_trash_marks_existing_item_trash_and_logs_the_command(api, room):
    lamp = make_item(room.id, room.location_id, "lamp")
    reply = say(api, "send the lamp to trash", room.id, trash("lamp")).json()

    assert reply["action"] == "trash"
    assert reply["result"] == 'Trashed "lamp".'
    assert get_item(lamp).status == "trash"
    (row,) = command_rows()
    assert (row.raw_text, row.parsed_action, row.target_item_id) == ("send the lamp to trash", "trash", lamp)


def test_trash_matches_case_insensitively_and_by_substring(api, room):
    lamp = make_item(room.id, room.location_id, "Desk Lamp")
    reply = say(api, "trash the LAMP", room.id, trash("LAMP")).json()
    assert reply["action"] == "trash"
    assert get_item(lamp).status == "trash"


def test_trash_item_that_does_not_exist_changes_nothing(api, room):
    lamp = make_item(room.id, room.location_id, "lamp")
    reply = say(api, "trash the piano", room.id, trash("piano")).json()

    assert reply["action"] == "unknown"
    assert "piano" in reply["result"]
    assert get_item(lamp).status == "active"


def test_trash_item_already_in_trash_is_not_found_and_not_trashed_again(api, room):
    old = make_item(room.id, room.location_id, "lamp", status="trash")
    reply = say(api, "trash the lamp", room.id, trash("lamp")).json()

    assert reply["action"] == "unknown"
    assert "already in the trash" in reply["result"]
    assert get_item(old).status == "trash"
    assert command_rows()[0].target_item_id is None


def test_trash_never_touches_an_item_in_a_different_room(api, room):
    other_room = make_room(api, "Garage")
    other_location = make_location(api, other_room, "Bench")
    lamp = make_item(other_room, other_location, "lamp")

    reply = say(api, "trash the lamp", room.id, trash("lamp")).json()

    assert reply["action"] == "unknown"
    assert get_item(lamp).status == "active"


def test_trash_with_no_item_name_changes_nothing(api, room):
    lamp = make_item(room.id, room.location_id, "lamp")
    reply = say(api, "trash it", room.id, trash(None)).json()

    assert reply["action"] == "unknown"
    assert get_item(lamp).status == "active"


# --- ambiguous / garbage input -> "I didn't understand" ---------------------

@pytest.mark.parametrize(
    "model_reply",
    [
        {"action": "unknown", "item_name": None, "location_name": None, "question": None},
        {"action": "delete_everything", "item_name": "lamp", "location_name": None, "question": None},
        {"item_name": "lamp"},  # no action key at all
        "sorry, I can't help with that",  # prose, no JSON
        '{"action": "trash", "item_name": "la',  # truncated JSON
        "[1, 2, 3]",  # valid JSON, wrong shape
        "",  # empty completion
    ],
    ids=["explicit-unknown", "invented-action", "missing-action", "prose", "truncated", "wrong-shape", "empty"],
)
def test_ambiguous_or_malformed_model_output_is_didnt_understand_and_executes_nothing(api, room, model_reply):
    lamp = make_item(room.id, room.location_id, "lamp")
    reply = say(api, "hmm maybe do the thing with that", room.id, model_reply).json()

    assert reply == {"action": "unknown", "result": DIDNT_UNDERSTAND, "est_cost_usd": 0.00003}
    assert get_item(lamp).status == "active"
    assert command_rows()[0].parsed_action == "unknown"  # still logged


def test_json_wrapped_in_prose_and_code_fence_still_parses(api, room):
    lamp = make_item(room.id, room.location_id, "lamp")
    fenced = 'Sure! ```json\n{"action": "trash", "item_name": "lamp"}\n```'
    reply = say(api, "trash the lamp", room.id, fenced).json()
    assert reply["action"] == "trash"
    assert get_item(lamp).status == "trash"


# --- other actions must not mutate inventory silently -----------------------

@pytest.mark.parametrize("action", ["query", "organize", "move"])
def test_non_trash_actions_never_trash_or_delete_items(api, room, action):
    lamp = make_item(room.id, room.location_id, "lamp")
    proposal = {"action": action, "item_name": "lamp", "location_name": "Shelf", "question": "where is it?"}
    # organize is wired now and makes a second (mocked) Nemotron call. "Shelf"
    # doesn't exist in this room, so move/organize refuse rather than guess.
    with patch("app.ai.organize.chat", return_value=NS(text="- fine", est_cost_usd=0.0)):
        reply = say(api, "do something with the lamp", room.id, proposal).json()

    assert reply["action"] in (action, "unknown")
    assert get_item(lamp).status == "active"


# --- failure handling -------------------------------------------------------

def test_model_failure_returns_502_and_executes_nothing(api, room):
    lamp = make_item(room.id, room.location_id, "lamp")
    with patch("app.ai.commands.chat", side_effect=TokenFactoryError("boom")):
        r = api.post("/api/chat", json={"text": "trash the lamp", "room_id": room.id})

    assert r.status_code == 502
    assert get_item(lamp).status == "active"
    assert command_rows() == []


def test_chat_rejects_a_request_without_text_or_room(api):
    assert api.post("/api/chat", json={"text": "hi"}).status_code == 422
    assert api.post("/api/chat", json={"room_id": 1}).status_code == 422


# --- known gaps (xfail): the backend should refuse these, and doesn't -------

def test_ambiguous_item_name_matching_several_items_must_not_guess(api, room):
    a = make_item(room.id, room.location_id, "usb cable")
    b = make_item(room.id, room.location_id, "hdmi cable")
    say(api, "trash the cable", room.id, trash("cable"))

    assert get_item(a).status == "active" and get_item(b).status == "active"


def test_wildcard_characters_in_a_model_supplied_name_are_not_patterns(api, room):
    lamp = make_item(room.id, room.location_id, "lamp")
    say(api, "trash %", room.id, trash("%"))

    assert get_item(lamp).status == "active"


def test_cannot_trash_items_in_a_room_owned_by_someone_else(api):
    with db_session() as db:
        room = models.Room(owner_id="someone-else", name="Not yours")
        db.add(room)
        db.commit()
        location = models.Location(room_id=room.id, name="Shelf")
        db.add(location)
        db.commit()
        room_id, location_id = room.id, location.id
    lamp = make_item(room_id, location_id, "lamp")

    say(api, "trash the lamp", room_id, trash("lamp"))

    assert get_item(lamp).status == "active"


def test_chat_on_a_nonexistent_room_is_404(api):
    assert say(api, "trash the lamp", 9999, trash("lamp")).status_code == 404
