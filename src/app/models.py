"""SQLAlchemy models for the data model in docs/ARCHITECTURE.md §7.

Only a confirmed transaction (a review submit, an organize confirm, or a
validated chat command) may write an Item or a Move -- that rule lives in the
routers, not here; these are just the tables.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(200))

    locations: Mapped[list["Location"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    scans: Mapped[list["Scan"]] = relationship(back_populates="room", cascade="all, delete-orphan")
    items: Mapped[list["Item"]] = relationship(back_populates="room", cascade="all, delete-orphan")


class Scan(Base):
    __tablename__ = "scans"
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    storage_key: Mapped[str] = mapped_column(String(500))
    uploaded_at: Mapped[datetime] = mapped_column(default=_now)

    room: Mapped[Room] = relationship(back_populates="scans")


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    name: Mapped[str] = mapped_column(String(200))

    room: Mapped[Room] = relationship(back_populates="locations")
    photos: Mapped[list["Photo"]] = relationship(back_populates="location", cascade="all, delete-orphan")
    items: Mapped[list["Item"]] = relationship(back_populates="location")


class Photo(Base):
    __tablename__ = "photos"
    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    storage_key: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=_now)

    location: Mapped[Location] = relationship(back_populates="photos")
    candidates: Mapped[list["Candidate"]] = relationship(back_populates="photo", cascade="all, delete-orphan")


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id"))
    label: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(100), default="")
    count: Mapped[int] = mapped_column(default=1)
    uncertainty_note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/organize/unknown/trash

    photo: Mapped[Photo] = relationship(back_populates="candidates")


class Item(Base):
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(100), default="")
    quantity: Mapped[int] = mapped_column(default=1)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active/trash
    last_confirmed_at: Mapped[datetime] = mapped_column(default=_now)

    room: Mapped[Room] = relationship(back_populates="items")
    location: Mapped[Location] = relationship(back_populates="items")
    moves: Mapped[list["Move"]] = relationship(back_populates="item", cascade="all, delete-orphan")


class Move(Base):
    __tablename__ = "moves"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    previous_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True)
    new_location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    confirmed_at: Mapped[datetime] = mapped_column(default=_now)

    item: Mapped[Item] = relationship(back_populates="moves")


class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    source_snapshot: Mapped[str] = mapped_column(Text)  # JSON of the items considered
    suggested_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/accepted/dismissed
    created_at: Mapped[datetime] = mapped_column(default=_now)
    est_cost_usd: Mapped[float] = mapped_column(default=0.0)


class Command(Base):
    __tablename__ = "commands"
    id: Mapped[int] = mapped_column(primary_key=True)
    raw_text: Mapped[str] = mapped_column(Text)
    parsed_action: Mapped[str] = mapped_column(String(20))
    target_item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id"), nullable=True)
    executed_at: Mapped[datetime] = mapped_column(default=_now)
    result: Mapped[str] = mapped_column(Text, default="")
