"""The human "retake from here" queue of the practice-and-correct round (sim_worker.corrections.RetakeQueue).

    GET /corrections/queue?status=open|done|skipped   {"items": [RetakeItem, ...], "counts": {status: n}}
    GET /corrections/queue/{name}                      one item; 404 if there is none

Each item is a restorable state ~1 s before a policy rollout's failure (its scene, the robot's joints, the cube's
pose, why it failed and where it came from), for the Record page to load and let a person finish the task. The
round (sim_eval/scripts/correction_round.py --retake human|both) writes them to DATA_DIR/corrections/queue/.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException

from demo_pipeline.paths import data_dir
from sim_worker.corrections import RetakeQueue

router = APIRouter(prefix="/corrections", tags=["corrections"])


@router.get("/queue")
def list_queue(status: Literal["open", "done", "skipped"] | None = None) -> dict:
    q = RetakeQueue(data_dir())
    every = q.list()
    counts = {s: sum(i.status == s for i in every) for s in ("open", "done", "skipped")}
    items = [i for i in every if status is None or i.status == status]
    return {"items": [i.model_dump(mode="json") for i in items], "counts": counts}


@router.get("/queue/{name}")
def get_item(name: str) -> dict:
    try:
        return RetakeQueue(data_dir()).get(name).model_dump(mode="json")
    except KeyError:
        raise HTTPException(404, f"no retake {name!r} in the queue") from None
    except ValueError as e:
        raise HTTPException(422, f"retake {name!r} is corrupt: {e}") from None
