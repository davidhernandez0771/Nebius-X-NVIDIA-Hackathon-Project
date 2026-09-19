"""Backend rules that keep AI output from becoming inventory unreviewed:
review, items, moves, photos and organize. All AI calls are mocked.
"""
from __future__ import annotations

import json
from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest

from app import models
from nebius_llm import TokenFactoryError

from conftest import db_session, get_item, make_item, make_location, make_room

LAMP = json.dumps([{"label": "lamp", "category": "electronics", "count": 1, "uncertainty_note": ""}])


def upload(api, location_id, *, content_type="image/jpeg", name="shelf.jpg"):
    return api.post(f"/api/photos?location_id={location_id}", files={"file": (name, b"fake", content_type)})


def analyze(api, photo_id, vision_text=LAMP, **params):
    with patch("app.ai.vision.chat_vision") as vision:
        vision.return_value = NS(text=vision_text, est_cost_usd=0.0001)
        r = api.post(f"/api/photos/{photo_id}/analyze", params=params)
        return r, vision


@pytest.fixture
def room(api):
    room_id = make_room(api)
    return NS(id=room_id, location_id=make_location(api, room_id))


@pytest.fixture
def candidate_id(api, room):
    photo_id = upload(api, room.location_id).json()["id"]
    analysis, _ = analyze(api, photo_id)
    return analysis.json()["candidates"][0]["id"]


def item_count():
    with db_session() as db:
        return db.query(models.Item).count()


# --- vision -> candidates -> items -----------------------------------------

def test_analyzing_a_photo_never_creates_inventory(api, room):
    photo_id = upload(api, room.location_id).json()["id"]
    r, _ = analyze(api, photo_id)

    assert len(r.json()["candidates"]) == 1
    assert item_count() == 0


def test_analyze_passes_the_stored_image_type_and_tier_to_the_vision_model(api, room):
    photo_id = upload(api, room.location_id, content_type="image/png", name="shelf.png").json()["id"]
    _, vision = analyze(api, photo_id, tier="glm-flash")

    assert vision.call_args.kwargs["mime_type"] == "image/png"
    assert vision.call_args.kwargs["tier"] == "glm-flash"
    assert vision.call_args.args[1] == b"fake"


def test_analyze_vision_failure_is_502_and_stores_no_candidates(api, room):
    photo_id = upload(api, room.location_id).json()["id"]
    with patch("app.ai.vision.chat_vision", side_effect=TokenFactoryError("down")):
        r = api.post(f"/api/photos/{photo_id}/analyze")

    assert r.status_code == 502
    assert api.get(f"/api/photos/{photo_id}/candidates").json() == []


def test_analyze_unknown_photo_is_404(api):
    r, vision = analyze(api, 9999)
    assert r.status_code == 404
    vision.assert_not_called()


def test_upload_rejects_unsupported_type_and_missing_location(api, room):
    assert upload(api, room.location_id, content_type="application/pdf", name="x.pdf").status_code == 400
    assert upload(api, 9999).status_code == 404


def test_review_organize_creates_an_item_at_the_photos_location(api, room, candidate_id):
    item = api.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"}).json()

    assert (item["name"], item["room_id"], item["location_id"], item["status"]) == ("lamp", room.id, room.location_id, "active")


@pytest.mark.parametrize("status", ["unknown", "trash"])
def test_review_unknown_or_trash_creates_no_item_but_records_the_choice(api, candidate_id, status):
    assert api.post(f"/api/candidates/{candidate_id}/review", json={"status": status}).json() is None

    assert item_count() == 0
    with db_session() as db:
        assert db.get(models.Candidate, candidate_id).status == status


def test_review_rejects_invalid_status_and_unknown_candidate(api, candidate_id):
    assert api.post(f"/api/candidates/{candidate_id}/review", json={"status": "pending"}).status_code == 400
    assert api.post(f"/api/candidates/{candidate_id}/review", json={"status": "delete"}).status_code == 400
    assert api.post("/api/candidates/9999/review", json={"status": "organize"}).status_code == 404
    assert item_count() == 0


# --- items and moves --------------------------------------------------------

def test_items_list_hides_trash_unless_asked(api, room):
    make_item(room.id, room.location_id, "lamp")
    make_item(room.id, room.location_id, "old mug", status="trash")

    assert [i["name"] for i in api.get(f"/api/items?room_id={room.id}").json()] == ["lamp"]
    assert len(api.get(f"/api/items?room_id={room.id}&include_trash=true").json()) == 2


def test_update_item_changes_only_the_fields_sent(api, room):
    item = make_item(room.id, room.location_id, "lamp")
    r = api.patch(f"/api/items/{item}", json={"quantity": 3}).json()

    assert (r["name"], r["quantity"]) == ("lamp", 3)


def test_update_unknown_item_is_404(api):
    assert api.patch("/api/items/9999", json={"name": "x"}).status_code == 404


def test_move_records_previous_and_new_location(api, room):
    shelf = make_location(api, room.id, "Shelf")
    item = make_item(room.id, room.location_id, "lamp")
    move = api.post(f"/api/items/{item}/moves", json={"new_location_id": shelf}).json()

    assert (move["previous_location_id"], move["new_location_id"]) == (room.location_id, shelf)
    assert get_item(item).location_id == shelf


def test_move_unknown_item_or_location_is_404_and_changes_nothing(api, room):
    item = make_item(room.id, room.location_id, "lamp")

    assert api.post("/api/items/9999/moves", json={"new_location_id": room.location_id}).status_code == 404
    assert api.post(f"/api/items/{item}/moves", json={"new_location_id": 9999}).status_code == 404
    assert get_item(item).location_id == room.location_id


# --- organize ---------------------------------------------------------------

def test_organize_sends_only_active_items_and_stores_a_pending_proposal(api, room):
    make_location(api, room.id, "Shelf")
    make_item(room.id, room.location_id, "lamp")
    make_item(room.id, room.location_id, "old mug", status="trash")
    with patch("app.ai.organize.chat") as chat:
        chat.return_value = NS(text="- lamp -> Shelf: easier to reach.", est_cost_usd=0.00002)
        out = api.post("/api/organize", json={"room_id": room.id}).json()

    sent = json.loads(chat.call_args.args[0])["items"]
    assert [i["name"] for i in sent] == ["lamp"]
    with db_session() as db:
        proposal = db.get(models.Proposal, out["proposal_id"])
        assert (proposal.status, proposal.suggested_text) == ("pending", "- lamp → Shelf: easier to reach.")


def test_organize_never_moves_items(api, room):
    shelf = make_location(api, room.id, "Shelf")
    item = make_item(room.id, room.location_id, "lamp")
    with patch("app.ai.organize.chat") as chat:
        chat.return_value = NS(text="- Move the lamp to the Shelf.", est_cost_usd=0.00002)
        api.post("/api/organize", json={"room_id": room.id})

    assert get_item(item).location_id == room.location_id != shelf


def test_organize_model_failure_is_502_and_stores_no_proposal(api, room):
    make_item(room.id, room.location_id, "lamp")
    with patch("app.ai.organize.chat", side_effect=TokenFactoryError("down")):
        r = api.post("/api/organize", json={"room_id": room.id})

    assert r.status_code == 502
    with db_session() as db:
        assert db.query(models.Proposal).count() == 0


# --- known gaps (xfail, strict) --------------------------------------------

def test_reviewing_a_candidate_twice_does_not_duplicate_the_item(api, candidate_id):
    api.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"})
    api.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"})

    assert item_count() == 1


def test_move_to_a_location_in_another_room_is_rejected(api, room):
    other_room = make_room(api, "Garage")
    other_location = make_location(api, other_room, "Bench")
    item = make_item(room.id, room.location_id, "lamp")

    r = api.post(f"/api/items/{item}/moves", json={"new_location_id": other_location})

    assert r.status_code in (400, 404, 422)


def test_update_item_rejects_an_invalid_status(api, room):
    item = make_item(room.id, room.location_id, "lamp")
    r = api.patch(f"/api/items/{item}", json={"status": "banana"})

    assert r.status_code in (400, 422)


def test_organize_unknown_room_is_404(api):
    with patch("app.ai.organize.chat") as chat:
        chat.return_value = NS(text="- nothing", est_cost_usd=0.0)
        r = api.post("/api/organize", json={"room_id": 9999})

    assert r.status_code == 404


def test_re_reviewing_an_organized_candidate_returns_the_same_item(api, candidate_id):
    first = api.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"}).json()
    again = api.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"})

    assert again.status_code == 200 and again.json()["id"] == first["id"]
    assert item_count() == 1


def test_an_organized_candidate_cannot_be_re_sorted_to_trash_or_unknown(api, candidate_id):
    api.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"})
    for status in ("trash", "unknown"):
        assert api.post(f"/api/candidates/{candidate_id}/review", json={"status": status}).status_code == 409
    assert item_count() == 1


def test_a_reviewed_but_not_organized_candidate_can_still_be_re_sorted(api, candidate_id):
    api.post(f"/api/candidates/{candidate_id}/review", json={"status": "unknown"})
    item = api.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"}).json()
    assert item["status"] == "active" and item_count() == 1


def test_update_item_accepts_the_valid_statuses(api, room):
    item = make_item(room.id, room.location_id, "lamp")
    for status in ("trash", "active"):
        r = api.patch(f"/api/items/{item}", json={"status": status})
        assert r.status_code == 200 and r.json()["status"] == status
