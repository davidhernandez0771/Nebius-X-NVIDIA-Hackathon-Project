"""Chat command bar: parse free text into one validated action, execute it,
never guess. See docs/ARCHITECTURE.md §8.

"organize" and "move" aren't wired to an executed action yet -- only "trash"
is, since that's the one concretely specified so far. Both return a plain
explanatory message instead of silently doing nothing.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..ai.commands import ParsedCommand, parse_command
from ..db import get_db
from nebius_llm import TokenFactoryError

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=schemas.ChatOut)
def chat_command(body: schemas.ChatIn, db: Session = Depends(get_db)):
    try:
        parsed, cost = parse_command(body.text)
    except TokenFactoryError as error:
        raise HTTPException(502, str(error)) from error

    result_text, action, item = _execute(parsed, body.room_id, db)

    db.add(
        models.Command(
            raw_text=body.text,
            parsed_action=action,
            target_item_id=item.id if item else None,
            result=result_text,
        )
    )
    db.commit()
    return schemas.ChatOut(action=action, result=result_text, est_cost_usd=cost)


def _execute(parsed: ParsedCommand, room_id: int, db: Session):
    if parsed.action == "trash":
        item = _find_item(db, room_id, parsed.item_name)
        if not item:
            return f'I couldn\'t find an item called "{parsed.item_name}" to trash.', "unknown", None
        item.status = "trash"
        db.commit()
        return f'Trashed "{item.name}".', "trash", item
    if parsed.action == "query":
        return "Ask-and-answer over inventory isn't wired up yet -- see docs/ARCHITECTURE.md §8.", "query", None
    if parsed.action in {"organize", "move"}:
        return f'"{parsed.action}" via chat isn\'t wired up yet -- use the Organize screen for now.', parsed.action, None
    return "I didn't understand that.", "unknown", None


def _find_item(db: Session, room_id: int, name: str | None):
    if not name:
        return None
    return (
        db.query(models.Item)
        .filter(models.Item.room_id == room_id, models.Item.status == "active")
        .filter(models.Item.name.ilike(f"%{name}%"))
        .first()
    )
