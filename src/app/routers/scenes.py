"""The Record page's scene picker (demo_pipeline.scene_library) and its "describe a scene" box.

    GET  /scenes                 {"scenes": [entry, ...]}: "standard", then the recording protocol's s1..s8 (written
                                 to DATA_DIR/scenes on first use, never overwritten), then saved scenes
    GET  /scenes/{id}            one entry; 404 if there is none
    POST /scenes/create          {"text"}: Nemotron's scene creator (app.ai.scene_creator: the validator's problems go
                                 back to it) -> {ok, plan, errors, needs_settle, calls, model}; saves nothing, so the
                                 page can preview it first. 503 if Nemotron can't be reached
    POST /scenes                 {"name", "description"?, "plan", "source"?}: save a plan the validator passes ->
                                 201 entry (the same entry again for the same name and plan); 422 with the problems

An entry: {id, name, description, source, plan, hash, needs_settle, settle, created_at}. The live sink switches to a
scene with the relay's {"type": "control", "action": "set_scene", "scene": id}; scenes with new bodies get Isaac's
settle check when the sink builds them (sim_worker/scripts/teleop_sink.py).
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from demo_pipeline.paths import data_dir
from demo_pipeline.scene_library import SceneLibrary, needs_settle
from demo_pipeline.scene_plan import ScenePlan
from nebius_llm import TokenFactoryError

from ..ai.scene_creator import plan_from_text

log = logging.getLogger(__name__)

router = APIRouter(prefix="/scenes", tags=["scenes"])


def _library() -> SceneLibrary:
    lib = SceneLibrary(data_dir())
    lib.seed_protocol()
    return lib


class CreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=500)


class SaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    description: str = Field("", max_length=500)
    plan: ScenePlan
    source: Literal["nemotron", "saved"] = "nemotron"


@router.get("")
def list_scenes() -> dict:
    return {"scenes": [e.model_dump(mode="json") for e in _library().list()]}


@router.get("/{scene_id}")
def get_scene(scene_id: str) -> dict:
    try:
        return _library().get(scene_id).model_dump(mode="json")
    except KeyError:
        raise HTTPException(404, f"no scene {scene_id!r}") from None
    except ValueError as e:
        raise HTTPException(422, f"scene {scene_id!r} is corrupt: {e}") from None


@router.post("/create")
def create_scene(req: CreateRequest) -> dict:
    text = req.text.strip()
    if not text:
        raise HTTPException(422, "describe the scene in a sentence")
    try:
        res = plan_from_text(text)
    except TokenFactoryError as e:
        raise HTTPException(503, f"Nemotron isn't reachable: {e}") from None
    plan = res.plan
    return {"ok": plan is not None, "plan": plan.model_dump(mode="json") if plan is not None else None,
            "errors": list(res.errors), "needs_settle": needs_settle(plan) if plan is not None else None,
            "calls": res.calls, "model": res.model}


@router.post("", status_code=201)
def save_scene(req: SaveRequest) -> dict:
    try:
        entry = _library().save(name=req.name, description=req.description, plan=req.plan, source=req.source)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return entry.model_dump(mode="json")
