"""In-app phone room scanning: a batch of ordinary photos, reconstructed into
a real GLB mesh via the Reali3 photogrammetry API (see ai/reali3.py). This is
genuine multi-photo 3D reconstruction, not a generative guess -- the result
becomes a normal Scan row, indistinguishable from a manually-uploaded .glb
once it lands (same /api/scans/{id}/file route renders it).

Costs real money per reconstruction (~$0.50, see ai/reali3.py's docstring) --
guarded by a minimum photo count (so a too-thin batch doesn't waste a
reconstruction that can't work) and a one-job-at-a-time-per-room lock (so a
double-tap doesn't double-bill).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models
from ..ai.reali3 import Reali3Error, create_reconstruction, download_model, get_status
from ..config import DEV_OWNER_ID
from ..db import get_db
from ..storage import save_scan
from .photos import CONTENT_TYPE_SUFFIX

router = APIRouter(tags=["phone-scans"])

MIN_PHOTOS = 8  # too few viewpoints for a photogrammetry pipeline to have a real shot
MAX_PHOTOS = 40  # payload/cost sanity, not a documented Reali3 limit


def _owned_room(db: Session, room_id: int) -> models.Room:
    room = db.get(models.Room, room_id)
    if not room or room.owner_id != DEV_OWNER_ID:
        raise HTTPException(404, "Room not found")
    return room


def _job_out(job: models.PhoneScanJob) -> dict:
    return {"id": job.id, "status": job.status, "scan_id": job.scan_id}


@router.post("/api/rooms/{room_id}/phone-scans")
async def create_phone_scan(room_id: int, files: list[UploadFile] = File(...), db: Session = Depends(get_db)):
    _owned_room(db, room_id)

    existing = (
        db.query(models.PhoneScanJob)
        .filter_by(room_id=room_id)
        .filter(models.PhoneScanJob.status.in_(["pending", "processing"]))
        .first()
    )
    if existing:
        raise HTTPException(409, "A scan is already in progress for this room.")

    if len(files) < MIN_PHOTOS:
        raise HTTPException(400, f"Take at least {MIN_PHOTOS} photos, walking around the room, for a usable scan.")
    if len(files) > MAX_PHOTOS:
        raise HTTPException(400, f"Too many photos (max {MAX_PHOTOS} per scan).")

    photos: list[tuple[bytes, str, str]] = []
    for file in files:
        if file.content_type not in CONTENT_TYPE_SUFFIX:
            raise HTTPException(400, f"Unsupported content type: {file.content_type}")
        data = await file.read()
        photos.append((data, file.filename or "photo.jpg", file.content_type))

    try:
        reali3_id = create_reconstruction(photos)
    except Reali3Error as error:
        raise HTTPException(502, str(error)) from error

    job = models.PhoneScanJob(room_id=room_id, reali3_id=reali3_id, status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_out(job)


@router.get("/api/phone-scans/{job_id}/status")
def phone_scan_status(job_id: int, db: Session = Depends(get_db)):
    job = db.get(models.PhoneScanJob, job_id)
    if not job:
        raise HTTPException(404, "Scan job not found")
    _owned_room(db, job.room_id)

    if job.status in ("completed", "failed"):
        return {**_job_out(job), "progress": 100 if job.status == "completed" else 0}

    try:
        remote = get_status(job.reali3_id)
    except Reali3Error as error:
        raise HTTPException(502, str(error)) from error

    remote_status = remote.get("status", "processing")
    progress = remote.get("progress", 0)

    if remote_status == "completed":
        try:
            glb_bytes = download_model(job.reali3_id, "glb")
        except Reali3Error as error:
            raise HTTPException(502, str(error)) from error
        key = save_scan(glb_bytes)
        scan = models.Scan(room_id=job.room_id, storage_key=key)
        db.add(scan)
        db.commit()
        db.refresh(scan)
        job.status = "completed"
        job.scan_id = scan.id
        db.commit()
        db.refresh(job)
    elif remote_status == "failed":
        job.status = "failed"
        db.commit()
        db.refresh(job)
    else:
        job.status = remote_status
        db.commit()

    return {**_job_out(job), "progress": progress}
