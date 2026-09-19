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


@router.post("", response_model=schemas.OrganizeOut)
def organize(body: schemas.OrganizeRequestIn, db: Session = Depends(get_db)):
    room = db.get(models.Room, body.room_id)
    if not room or room.owner_id != DEV_OWNER_ID:
        raise HTTPException(404, "Room not found")
    items = db.query(models.Item).filter_by(room_id=body.room_id, status="active").all()
    payload = json.dumps(
        [
            {"name": item.name, "category": item.category, "quantity": item.quantity, "location": item.location.name}
            for item in items
        ]
    )
    try:
        suggestion, cost = suggest_organization(payload)
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
