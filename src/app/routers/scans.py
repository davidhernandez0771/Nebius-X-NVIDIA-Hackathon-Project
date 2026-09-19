"""GLB room-scan upload. No parsing or rendering here -- read-only spatial
context, rendered client-side (see docs/ARCHITECTURE.md §5)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..storage import save_scan

router = APIRouter(prefix="/api/scans", tags=["scans"])

MAX_SCAN_BYTES = 200 * 1024 * 1024  # 200 MB


@router.post("")
async def upload_scan(room_id: int, file: UploadFile, db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".glb"):
        raise HTTPException(400, "Only .glb scan uploads are accepted.")
    data = await file.read()
    if len(data) > MAX_SCAN_BYTES:
        raise HTTPException(400, "Scan file too large.")
    room = db.get(models.Room, room_id)
    if not room:
        raise HTTPException(404, "Room not found")
    key = save_scan(data)
    scan = models.Scan(room_id=room_id, storage_key=key)
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return {"id": scan.id, "room_id": scan.room_id, "storage_key": scan.storage_key}
