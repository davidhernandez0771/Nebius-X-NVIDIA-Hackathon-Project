"""Review: sort a proposed candidate into organize / unknown / trash.

Only this call may create an Item -- a candidate never becomes inventory on
its own (docs/ARCHITECTURE.md §6).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/api/candidates", tags=["candidates"])

VALID_STATUSES = {"organize", "unknown", "trash"}


@router.post("/{candidate_id}/review", response_model=schemas.ItemOut | None)
def review_candidate(candidate_id: int, body: schemas.CandidateReviewIn, db: Session = Depends(get_db)):
    if body.status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(VALID_STATUSES)}")
    candidate = db.get(models.Candidate, candidate_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")

    candidate.status = body.status
    item = None
    if body.status == "organize":
        location = candidate.photo.location
        item = models.Item(
            room_id=location.room_id,
            location_id=location.id,
            name=candidate.label,
            category=candidate.category,
            quantity=candidate.count,
            status="active",
        )
        db.add(item)
    db.commit()
    if item:
        db.refresh(item)
    return item
