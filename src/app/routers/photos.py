"""Photo upload + vision itemization.

/analyze spends real Token Factory credits (docs/ARCHITECTURE.md §4/§9) -- it
is only called when the client explicitly requests it, never automatically.
"""
from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ai.vision import itemize_photo
from ..db import get_db
from ..storage import read_photo, save_photo
from nebius_llm import TokenFactoryError

router = APIRouter(prefix="/api/photos", tags=["photos"])

MAX_PHOTO_BYTES = 20 * 1024 * 1024  # 20 MB
# Maps the uploaded content type to a storage suffix that preserves it, so
# /analyze can later tell the vision model the real format instead of
# guessing -- sending an image as the wrong mime type is a real way for a
# vision model to silently fail to read it.
CONTENT_TYPE_SUFFIX = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


@router.post("")
async def upload_photo(location_id: int, file: UploadFile, db: Session = Depends(get_db)):
    if file.content_type not in CONTENT_TYPE_SUFFIX:
        raise HTTPException(400, f"Unsupported content type: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(400, "Photo too large.")
    location = db.get(models.Location, location_id)
    if not location:
        raise HTTPException(404, "Location not found")
    key = save_photo(data, suffix=CONTENT_TYPE_SUFFIX[file.content_type])
    photo = models.Photo(location_id=location_id, storage_key=key)
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return {"id": photo.id, "location_id": photo.location_id}


@router.post("/{photo_id}/analyze", response_model=schemas.PhotoAnalyzeOut)
def analyze_photo(photo_id: int, tier: str | None = None, db: Session = Depends(get_db)):
    photo = db.get(models.Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    image_bytes = read_photo(photo.storage_key)
    mime_type = mimetypes.guess_type(photo.storage_key)[0] or "image/jpeg"
    try:
        guesses, cost = itemize_photo(image_bytes, mime_type=mime_type, tier=tier)
    except TokenFactoryError as error:
        raise HTTPException(502, str(error)) from error

    candidates = []
    for guess in guesses:
        candidate = models.Candidate(
            photo_id=photo.id,
            label=guess.label,
            category=guess.category,
            count=guess.count,
            uncertainty_note=guess.uncertainty_note,
            status="pending",
        )
        db.add(candidate)
        candidates.append(candidate)
    db.commit()
    for candidate in candidates:
        db.refresh(candidate)
    return schemas.PhotoAnalyzeOut(photo_id=photo.id, candidates=candidates, est_cost_usd=cost)


@router.get("/{photo_id}/candidates", response_model=list[schemas.CandidateOut])
def list_candidates(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(models.Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    return photo.candidates
