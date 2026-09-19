"""Pydantic request/response shapes.

Kept separate from the ORM models (models.py) so the API contract doesn't
silently change just because a DB column changes.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RoomIn(BaseModel):
    name: str


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class LocationIn(BaseModel):
    name: str


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    room_id: int
    name: str


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    photo_id: int
    label: str
    category: str
    count: int
    uncertainty_note: str
    status: str


class PhotoAnalyzeOut(BaseModel):
    photo_id: int
    candidates: list[CandidateOut]
    est_cost_usd: float


class CandidateReviewIn(BaseModel):
    status: str  # "organize" | "unknown" | "trash"


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    room_id: int
    location_id: int
    name: str
    category: str
    quantity: int
    status: str
    last_confirmed_at: datetime


class ItemUpdateIn(BaseModel):
    name: str | None = None
    category: str | None = None
    quantity: int | None = None
    status: str | None = None


class MoveIn(BaseModel):
    new_location_id: int


class MoveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    item_id: int
    previous_location_id: int | None
    new_location_id: int
    confirmed_at: datetime


class OrganizeRequestIn(BaseModel):
    room_id: int


class OrganizeOut(BaseModel):
    proposal_id: int
    suggestion: str
    est_cost_usd: float


class ChatIn(BaseModel):
    text: str
    room_id: int


class ChatOut(BaseModel):
    action: str
    result: str
    est_cost_usd: float
