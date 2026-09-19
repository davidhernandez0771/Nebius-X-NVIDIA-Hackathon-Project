"""GLB room-scan upload and retrieval. No parsing or rendering here -- read-only
spatial context, rendered client-side (see docs/ARCHITECTURE.md §5)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models
from ..config import DEV_OWNER_ID
from ..db import get_db
from ..storage import save_scan, scan_path

router = APIRouter(prefix="/api/scans", tags=["scans"])

MAX_SCAN_BYTES = 200 * 1024 * 1024  # 200 MB


def _owned_room(db: Session, room_id: int) -> models.Room:
    room = db.get(models.Room, room_id)
    if not room or room.owner_id != DEV_OWNER_ID:
        raise HTTPException(404, "Room not found")
    return room


def _scan_out(scan: models.Scan) -> dict:
    return {
        "id": scan.id,
        "room_id": scan.room_id,
        "storage_key": scan.storage_key,
        "uploaded_at": scan.uploaded_at.isoformat(),
    }


@router.post("")
async def upload_scan(room_id: int, file: UploadFile, db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".glb"):
        raise HTTPException(400, "Only .glb scan uploads are accepted.")
    data = await file.read()
    if len(data) > MAX_SCAN_BYTES:
        raise HTTPException(400, "Scan file too large.")
    _owned_room(db, room_id)
    key = save_scan(data)
    scan = models.Scan(room_id=room_id, storage_key=key)
    db.add(scan)
    db.commit()
    db.refresh(scan)
    return _scan_out(scan)


@router.get("")
def list_scans(room_id: int, db: Session = Depends(get_db)):
    """Scans for a room, newest first, so the client can show the latest."""
    _owned_room(db, room_id)
    scans = db.query(models.Scan).filter_by(room_id=room_id).order_by(models.Scan.id.desc()).all()
    return [_scan_out(s) for s in scans]


@router.get("/{scan_id}/file")
def scan_file(scan_id: int, db: Session = Depends(get_db)):
    """The raw GLB, for the browser's 3D viewer."""
    scan = db.get(models.Scan, scan_id)
    if not scan:
        raise HTTPException(404, "Scan not found")
    _owned_room(db, scan.room_id)
    path = scan_path(scan.storage_key)
    if not path.is_file():
        raise HTTPException(404, "Scan file is missing")
    return FileResponse(path, media_type="model/gltf-binary")
