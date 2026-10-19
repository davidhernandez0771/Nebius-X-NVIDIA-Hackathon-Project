"""Ask SANT (the site's chat): POST /api/ask with the visitor's text and the client's tools; returns
the tool Nemotron picked (validated, or null) and a one-line reply. Nothing runs here: the client
runs the tool. See app/ai/ask.py."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import schemas
from ..ai.ask import ToolSpec, ask
from nebius_llm import TokenFactoryError

router = APIRouter(prefix="/api/ask", tags=["ask"])


@router.post("", response_model=schemas.AskOut)
def ask_sant(body: schemas.AskIn):
    tools = [ToolSpec(t.name, t.description, t.values) for t in body.tools]
    try:
        result, cost = ask(body.text, tools)
    except TokenFactoryError as error:
        raise HTTPException(502, str(error)) from error
    return schemas.AskOut(tool=result.tool, arg=result.arg, reply=result.reply, est_cost_usd=cost)
