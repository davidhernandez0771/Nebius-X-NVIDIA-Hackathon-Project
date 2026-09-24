"""Photo upload + vision itemization.

/analyze spends real Token Factory credits (docs/ARCHITECTURE.md §4/§9) -- it
is only called when the client explicitly requests it, never automatically.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ai.vision import itemize_photo_detailed
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
# Inverse of the above: recovers the real content type from the storage
# suffix at analyze time. Deliberately not stdlib `mimetypes.guess_type()`,
# which doesn't know `.heic`/`.heif` and would silently mislabel real iPhone
# photos as image/jpeg -- exactly the failure mode this table exists to avoid.
SUFFIX_CONTENT_TYPE = {suffix: content_type for content_type, suffix in CONTENT_TYPE_SUFFIX.items()}


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
    if photo.candidates:
        # Analyze spends real credits; re-running it on an already-analyzed
        # photo would silently double-bill and leave duplicate Candidate rows
        # behind. If re-analysis is ever wanted, it should be an explicit,
        # separate action -- not a side effect of calling this route twice.
        raise HTTPException(409, "Photo already analyzed.")
    image_bytes = read_photo(photo.storage_key)
    mime_type = SUFFIX_CONTENT_TYPE.get(Path(photo.storage_key).suffix, "image/jpeg")
    try:
        result = itemize_photo_detailed(image_bytes, mime_type=mime_type, tier=tier)
    except TokenFactoryError as error:
        raise HTTPException(502, str(error)) from error

    candidates = []
    for guess in result.candidates:
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
    return schemas.PhotoAnalyzeOut(
        photo_id=photo.id,
        candidates=candidates,
        est_cost_usd=result.est_cost_usd,
        truncated=result.truncated,
        warnings=result.warnings,
    )


@router.get("/{photo_id}/candidates", response_model=list[schemas.CandidateOut])
def list_candidates(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(models.Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    return photo.candidates
