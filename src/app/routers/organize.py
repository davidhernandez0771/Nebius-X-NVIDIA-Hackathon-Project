"""One Nemotron call: suggest an arrangement for a room's confirmed items.

Never executes moves itself -- see docs/ARCHITECTURE.md §1/§8.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ai.organize import suggest_organization
from ..config import DEV_OWNER_ID
from ..db import get_db
from nebius_llm import TokenFactoryError

router = APIRouter(prefix="/api/organize", tags=["organize"])

# A move is always "item -> some other location than the one it's already in".
# With only one location in the whole room, every move Nemotron could possibly
# suggest is a no-op, and the validator (correctly) strips all of them --
# every call would land on the generic NOTHING_TO_SUGGEST fallback regardless
# of what's in the room. Catching this up front skips a Nemotron call that
# can only ever produce that one outcome, and lets the message name the real,
# fixable reason instead of reading as broken.
SINGLE_LOCATION_MESSAGE = (
    "Everything's already in the only location this room has. Add another location to get organizing suggestions."
)


@router.post("", response_model=schemas.OrganizeOut)
def organize(body: schemas.OrganizeRequestIn, db: Session = Depends(get_db)):
    room = db.get(models.Room, body.room_id)
    if not room or room.owner_id != DEV_OWNER_ID:
        raise HTTPException(404, "Room not found")
    items = db.query(models.Item).filter_by(room_id=body.room_id, status="active").all()
    if not items:
        raise HTTPException(400, "No items to organize yet.")
    location_names = _location_names(db, body.room_id)
    payload = json.dumps(
        [
            {"name": item.name, "category": item.category, "quantity": item.quantity, "location": item.location.name}
            for item in items
        ]
    )

    if len(location_names) < 2:
        suggestion, cost = SINGLE_LOCATION_MESSAGE, 0.0
    else:
        try:
            suggestion, cost = suggest_organization(payload, location_names)
        except TokenFactoryError as error:
            raise HTTPException(502, str(error)) from error

    proposal = models.Proposal(
        room_id=body.room_id,
        source_snapshot=payload,
        suggested_text=suggestion,
        status="pending",
        est_cost_usd=cost,
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)
    return schemas.OrganizeOut(proposal_id=proposal.id, suggestion=suggestion, est_cost_usd=cost)


def _location_names(db: Session, room_id: int) -> list[str]:
    return [loc.name for loc in db.query(models.Location).filter_by(room_id=room_id).all()]
