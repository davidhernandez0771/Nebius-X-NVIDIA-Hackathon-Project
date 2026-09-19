"""Inventory CRUD + moves. No AI involved -- see docs/ARCHITECTURE.md §3."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..db import get_db

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("", response_model=list[schemas.ItemOut])
def list_items(room_id: int, include_trash: bool = False, db: Session = Depends(get_db)):
    query = db.query(models.Item).filter_by(room_id=room_id)
    if not include_trash:
        query = query.filter(models.Item.status != "trash")
    return query.all()


@router.patch("/{item_id}", response_model=schemas.ItemOut)
def update_item(item_id: int, body: schemas.ItemUpdateIn, db: Session = Depends(get_db)):
    item = db.get(models.Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.post("/{item_id}/moves", response_model=schemas.MoveOut)
def move_item(item_id: int, body: schemas.MoveIn, db: Session = Depends(get_db)):
    item = db.get(models.Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
    new_location = db.get(models.Location, body.new_location_id)
    if not new_location:
        raise HTTPException(404, "Location not found")
    move = models.Move(item_id=item.id, previous_location_id=item.location_id, new_location_id=new_location.id)
    item.location_id = new_location.id
    db.add(move)
    db.commit()
    db.refresh(move)
    return move
