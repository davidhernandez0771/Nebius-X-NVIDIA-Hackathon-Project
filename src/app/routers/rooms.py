"""Rooms and their locations. No AI involved -- see docs/ARCHITECTURE.md §3."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import DEV_OWNER_ID
from ..db import get_db

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


@router.post("", response_model=schemas.RoomOut)
def create_room(body: schemas.RoomIn, db: Session = Depends(get_db)):
    room = models.Room(owner_id=DEV_OWNER_ID, name=body.name)
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


@router.get("", response_model=list[schemas.RoomOut])
def list_rooms(db: Session = Depends(get_db)):
    return db.query(models.Room).filter_by(owner_id=DEV_OWNER_ID).all()


@router.get("/{room_id}", response_model=schemas.RoomOut)
def get_room(room_id: int, db: Session = Depends(get_db)):
    room = db.get(models.Room, room_id)
    if not room or room.owner_id != DEV_OWNER_ID:
        raise HTTPException(404, "Room not found")
    return room


@router.post("/{room_id}/locations", response_model=schemas.LocationOut)
def create_location(room_id: int, body: schemas.LocationIn, db: Session = Depends(get_db)):
    room = db.get(models.Room, room_id)
    if not room or room.owner_id != DEV_OWNER_ID:
        raise HTTPException(404, "Room not found")
    location = models.Location(room_id=room_id, name=body.name)
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


@router.get("/{room_id}/locations", response_model=list[schemas.LocationOut])
def list_locations(room_id: int, db: Session = Depends(get_db)):
    return db.query(models.Location).filter_by(room_id=room_id).all()
