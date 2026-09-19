"""Chat command bar: Nemotron parses free text into one proposed action; this
module validates it against the database and is the only thing that executes
it. Anything that doesn't validate returns a plain message and changes nothing.
See docs/ARCHITECTURE.md §8.

trash/move change data only after validation (room is yours; the item exists in
that room, is active, and matched unambiguously; the destination exists in the
room). organize only stores a Proposal (nothing moves). query is read-only.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ai.commands import ParsedCommand, parse_command
from ..ai.organize import suggest_organization
from ..ai.query import answer_query
from ..config import DEV_OWNER_ID
from ..db import get_db
from .items import apply_move
from nebius_llm import TokenFactoryError

router = APIRouter(prefix="/api/chat", tags=["chat"])

NOT_UNDERSTOOD = "I didn't understand that."
MAX_MATCHES_LISTED = 5


@dataclass
class Outcome:
    text: str
    action: str = "unknown"  # what actually happened; "unknown" when nothing was executed
    item: models.Item | None = None
    extra_cost: float = 0.0


@router.post("", response_model=schemas.ChatOut)
def chat_command(body: schemas.ChatIn, db: Session = Depends(get_db)):
    room = db.get(models.Room, body.room_id)
    if not room or room.owner_id != DEV_OWNER_ID:
        raise HTTPException(404, "Room not found")
    try:
        parsed, cost = parse_command(body.text)
        outcome = _execute(parsed, room.id, db)
    except TokenFactoryError as error:
        raise HTTPException(502, str(error)) from error

    db.add(
        models.Command(
            raw_text=body.text,
            parsed_action=outcome.action,
            target_item_id=outcome.item.id if outcome.item else None,
            result=outcome.text,
        )
    )
    db.commit()
    return schemas.ChatOut(action=outcome.action, result=outcome.text, est_cost_usd=cost + outcome.extra_cost)


# ---------------------------------------------------------------------------
# Execution (validation lives here, not in the model)
# ---------------------------------------------------------------------------

def _execute(parsed: ParsedCommand, room_id: int, db: Session) -> Outcome:
    if parsed.action == "trash":
        return _trash(parsed, room_id, db)
    if parsed.action == "move":
        return _move(parsed, room_id, db)
    if parsed.action == "organize":
        return _organize(parsed, room_id, db)
    if parsed.action == "query":
        return _query(parsed, room_id, db)
    return Outcome(NOT_UNDERSTOOD)


def _trash(parsed: ParsedCommand, room_id: int, db: Session) -> Outcome:
    item, problem = _resolve_item(db, room_id, parsed.item_name, verb="trash")
    if problem:
        return Outcome(problem)
    item.status = "trash"
    db.commit()
    return Outcome(f'Trashed "{item.name}".', "trash", item)


def _move(parsed: ParsedCommand, room_id: int, db: Session) -> Outcome:
    item, problem = _resolve_item(db, room_id, parsed.item_name, verb="move")
    if problem:
        return Outcome(problem)
    location, problem = _resolve_location(db, room_id, parsed.location_name)
    if problem:
        return Outcome(problem)
    if item.location_id == location.id:
        return Outcome(f'"{item.name}" is already in "{location.name}".')
    apply_move(db, item, location)
    return Outcome(f'Moved "{item.name}" to "{location.name}".', "move", item)


def _organize(parsed: ParsedCommand, room_id: int, db: Session) -> Outcome:
    """Proposal only: stores a suggestion; the user applies moves themselves."""
    query = db.query(models.Item).filter_by(room_id=room_id, status="active")
    scope = ""
    if parsed.location_name:
        location, problem = _resolve_location(db, room_id, parsed.location_name)
        if problem:
            return Outcome(problem)
        query = query.filter_by(location_id=location.id)
        scope = f' in "{location.name}"'
    items = query.all()
    if not items:
        return Outcome(f"There's nothing to organize{scope} yet.")
    payload = _items_json(items)
    suggestion, cost = suggest_organization(payload)
    proposal = models.Proposal(
        room_id=room_id, source_snapshot=payload, suggested_text=suggestion, status="pending", est_cost_usd=cost
    )
    db.add(proposal)
    db.commit()
    return Outcome(f"Suggestion (nothing has been moved):\n{suggestion}", "organize", extra_cost=cost)


def _query(parsed: ParsedCommand, room_id: int, db: Session) -> Outcome:
    """Read-only. Deterministic when the question names an item or a location;
    otherwise a Nemotron answer grounded on the inventory list."""
    active = _active_items(db, room_id)
    if parsed.item_name:
        matches = _best_matches(parsed.item_name, active)
        if matches:
            lines = [f'"{i.name}" x{i.quantity} is in "{i.location.name}"' for i in matches[:MAX_MATCHES_LISTED]]
            return Outcome("; ".join(lines) + ".", "query")
        if _best_matches(parsed.item_name, _trashed_items(db, room_id)):
            return Outcome(f'"{parsed.item_name}" is in the trash.', "query")
        return Outcome(f'I couldn\'t find "{parsed.item_name}" in your inventory.')
    if parsed.location_name:
        location, problem = _resolve_location(db, room_id, parsed.location_name)
        if problem:
            return Outcome(problem)
        here = [i for i in active if i.location_id == location.id]
        listing = ", ".join(f"{i.name} x{i.quantity}" for i in here) or "nothing yet"
        return Outcome(f'In "{location.name}": {listing}.', "query")
    if not active:
        return Outcome("Your inventory is empty.", "query")
    answer, cost = answer_query(parsed.question or "", _items_json(active))
    return Outcome(answer or "I can't tell from your inventory.", "query", extra_cost=cost)


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------

def _norm(text: str) -> str:
    text = re.sub(r"[^\w\s]", " ", text.lower())
    text = re.sub(r"^(?:the|my|a|an)\s+", "", " ".join(text.split()))
    return text


def _best_matches(name: str, candidates: list):
    """Exact (normalized) name match wins; otherwise substring either way.
    Plain Python comparison: no LIKE, so '%' or '_' in a model-supplied name
    is just a character, not a wildcard."""
    wanted = _norm(name)
    if not wanted:
        return []
    exact = [c for c in candidates if _norm(c.name) == wanted]
    if exact:
        return exact
    return [c for c in candidates if _norm(c.name) and (wanted in _norm(c.name) or _norm(c.name) in wanted)]


def _active_items(db: Session, room_id: int) -> list[models.Item]:
    return db.query(models.Item).filter_by(room_id=room_id, status="active").all()


def _trashed_items(db: Session, room_id: int) -> list[models.Item]:
    return db.query(models.Item).filter_by(room_id=room_id, status="trash").all()


def _resolve_item(db: Session, room_id: int, name: str | None, *, verb: str):
    """Returns (item, None) or (None, message). Never guesses between candidates."""
    if not name:
        return None, NOT_UNDERSTOOD
    matches = _best_matches(name, _active_items(db, room_id))
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        names = ", ".join(f'"{m.name}"' for m in matches[:MAX_MATCHES_LISTED])
        return None, f'"{name}" matches more than one item ({names}). Which one should I {verb}?'
    if _best_matches(name, _trashed_items(db, room_id)):
        return None, f'"{name}" is already in the trash.'
    return None, f'I couldn\'t find an item called "{name}" to {verb}.'


def _resolve_location(db: Session, room_id: int, name: str | None):
    if not name:
        return None, NOT_UNDERSTOOD
    locations = db.query(models.Location).filter_by(room_id=room_id).all()
    matches = _best_matches(name, locations)
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        names = ", ".join(f'"{m.name}"' for m in matches[:MAX_MATCHES_LISTED])
        return None, f'"{name}" matches more than one location ({names}). Which one do you mean?'
    return None, f'I couldn\'t find a location called "{name}" in this room.'


def _items_json(items: list[models.Item]) -> str:
    return json.dumps(
        [
            {"name": i.name, "category": i.category, "quantity": i.quantity, "location": i.location.name}
            for i in items
        ]
    )
