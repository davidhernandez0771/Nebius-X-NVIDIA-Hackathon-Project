"""The whole SANT pipeline from the site (app/pipeline): start a run over saved demos, follow it stage by stage with
time estimates, cancel or resume it, download what it made. The shape is the pipeline pages' (agreed with T2).

    GET  /pipeline/config                   {enabled, presets, stop_after, timings}
    POST /pipeline/estimate                 recipe -> {demos, stages, remaining_s}: the plan, nothing started
    GET  /pipeline/runs                     {runs: [{id, name, created, status, stage, demos, detail, resumable}]}
    POST /pipeline/runs                     {demos: [ids]} | {tag, input?}, + name?, preset?, variants?, repairer?,
                                            eval_n?, stop_after?, multiplied_only?, nemotron?, dry_run? -> 201 {id}
    GET  /pipeline/runs/{id}                the run's state (app.pipeline.progress.snapshot)
    GET  /pipeline/runs/{id}/events         SSE: "snapshot", then patches (stage, gpu, check, repair, variant, train,
                                            checkpoint, evaluate, artifact, log), then "end" {status}
    POST /pipeline/runs/{id}/cancel         stop at the next stage boundary (resumable)
    POST /pipeline/runs/{id}/resume         a failed, cancelled or interrupted run carries on from its markers
    GET  /pipeline/runs/{id}/artifacts      {artifacts: [{name, kind, bytes, sha256, url, note?}]}
    GET  /pipeline/runs/{id}/artifacts/{n}  the file, streamed, with its size
    GET  /pipeline/runs/{id}/footage/{ep}   an episode's camera frames (the showcase's footage of the run's store)

Starting, cancelling and resuming are off unless SANT_PIPELINE=1 (app.config.pipeline_enabled): 403 otherwise, so a
public deployment can't start GPU jobs. The files go only to the browser that asks; nothing is sent anywhere else.
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import ValidationError

from app.config import pipeline_enabled
from app.pipeline.export import safe_name
from app.pipeline.progress import PUBLIC_STATUS, snapshot
from app.pipeline.recipe import PRESETS, Recipe
from app.pipeline.runs import RunManager
from demo_pipeline.paths import data_dir

from . import showcase

router = APIRouter(prefix="/pipeline", tags=["pipeline"])
log = logging.getLogger(__name__)

TICK_S = 2.0
POLL_S = 1.0
KEEPALIVE_S = 15.0
MAX_STREAM_S = 24 * 3600
_manager: RunManager | None = None
_manager_lock = threading.Lock()


def _ticker(m: RunManager) -> None:
    while True:
        try:
            m.tick()
        except Exception:  # noqa: BLE001: keep the queue moving; the run records say what failed
            log.exception("pipeline tick failed")
        time.sleep(TICK_S)


def get_manager() -> RunManager:
    """The one RunManager for DATA_DIR; with the pipeline on, a background thread moves its queue along."""
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = RunManager(data_dir())
            if pipeline_enabled():
                threading.Thread(target=_ticker, args=(_manager,), name="pipeline-tick", daemon=True).start()
        return _manager


def _require_enabled() -> None:
    if not pipeline_enabled():
        raise HTTPException(403, "the pipeline can't start, cancel or resume runs on this server (set SANT_PIPELINE=1 "
                                 "on the machine that runs it)")


def _run_or_404(m: RunManager, run_id: str) -> dict:
    try:
        return m.get(run_id)
    except KeyError:
        raise HTTPException(404, f"no pipeline run {run_id!r}") from None


def _recipe(body: dict) -> tuple[Recipe, str | None]:
    body = dict(body)
    name = body.pop("name", None)
    if name is not None and (not isinstance(name, str) or len(name) > 120):
        raise HTTPException(422, "name is a short string")
    try:
        return Recipe.model_validate(body), name
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json(include_url=False))) from None


@router.get("/config")
def config(m: RunManager = Depends(get_manager)) -> dict:
    return {"enabled": pipeline_enabled(), "presets": PRESETS, "stop_after": ["grid", "train", "eval", "results"],
            "timings": m.timings().to_dict()}


@router.post("/estimate")
def estimate(body: dict = Body(...), m: RunManager = Depends(get_manager)) -> dict:
    recipe, _ = _recipe(body)
    try:
        n = m.count_demos(recipe)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    run = {"id": "estimate", "name": "estimate", "created": "", "status": "queued", "recipe": recipe.model_dump()
           | {"steps": recipe.steps, "eval_n": recipe.eval_seeds}, "n_demos": n, "started_at": None, "stage_times": {}}
    snap = snapshot(run, data=m.data, timings=m.timings(), now=m.now(), lock=None, position=None)
    return {"demos": n, "stages": snap["stages"], "remaining_s": snap["remaining_s"]}


@router.get("/runs")
def list_runs(m: RunManager = Depends(get_manager)) -> dict:
    out = []
    for run in reversed(m.list()):
        snap = m.snapshot(run["id"]) if run["status"] in ("running", "cancelling") else None
        stage = next((s["id"] for s in snap["stages"] if s["status"] == "running"), None) if snap else None
        out.append({"id": run["id"], "name": run["name"], "created": run["created"],
                    "status": PUBLIC_STATUS.get(run["status"], run["status"]), "stage": stage, "demos": run["n_demos"],
                    "detail": run.get("detail"), "resumable": bool(run.get("resumable"))})
    return {"runs": out}


@router.post("/runs", status_code=201)
def create_run(body: dict = Body(...), m: RunManager = Depends(get_manager)) -> dict:
    _require_enabled()
    recipe, name = _recipe(body)
    try:
        run = m.create(recipe, name=name)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return {"id": run["id"]}


@router.get("/runs/{run_id}")
def get_run(run_id: str, m: RunManager = Depends(get_manager)) -> dict:
    _run_or_404(m, run_id)
    return m.snapshot(run_id)


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: str, m: RunManager = Depends(get_manager)) -> dict:
    _require_enabled()
    _run_or_404(m, run_id)
    m.cancel(run_id)
    return m.snapshot(run_id)


@router.post("/runs/{run_id}/resume")
def resume_run(run_id: str, m: RunManager = Depends(get_manager)) -> dict:
    _require_enabled()
    _run_or_404(m, run_id)
    try:
        m.resume(run_id)
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    return m.snapshot(run_id)


@router.get("/runs/{run_id}/artifacts")
def list_artifacts(run_id: str, m: RunManager = Depends(get_manager)) -> dict:
    run = _run_or_404(m, run_id)
    return {"artifacts": (run.get("export") or {}).get("artifacts") or []}


@router.get("/runs/{run_id}/artifacts/{name}")
def download(run_id: str, name: str, m: RunManager = Depends(get_manager)) -> FileResponse:
    run = _run_or_404(m, run_id)
    listed = {a["name"] for a in (run.get("export") or {}).get("artifacts") or []}
    if safe_name(name) is None or name not in listed:
        raise HTTPException(404, f"no artifact {name!r} in run {run_id}")
    path = m.root / run_id / "artifacts" / name
    if not path.is_file():
        raise HTTPException(404, f"artifact {name!r} is listed but missing on disk")
    return FileResponse(path, filename=name, content_disposition_type="attachment")


@router.get("/runs/{run_id}/footage/{episode_id}")
def footage(run_id: str, episode_id: str, camera: showcase.Camera = "front", m: RunManager = Depends(get_manager)) -> dict:
    _run_or_404(m, run_id)
    return showcase.get_footage(run_id, episode_id, camera=camera, live=False)


# ---------------------------------------------------------------------------------------------------- events


def _keyed(rows: list[dict], key) -> dict:
    return {key(r): r for r in rows}


def patches(before: dict, after: dict) -> list[dict]:
    """What changed from one snapshot to the next, as the pages' patch events (in a fixed order)."""
    out: list[dict] = []
    # The run itself: its status, why, and its clock (elapsed moves the patch every 5 s only)
    run_key = lambda s: (s.get("status"), s.get("detail"), s.get("resumable"), s.get("remaining_s"),  # noqa: E731
                         None if s.get("elapsed_s") is None else int(s["elapsed_s"] // 5))
    if run_key(before) != run_key(after):
        out.append({"type": "run", **{k: after.get(k) for k in ("status", "detail", "resumable", "elapsed_s", "remaining_s")}})
    old_st = {s["id"]: s for s in before.get("stages", [])}
    for s in after.get("stages", []):
        if old_st.get(s["id"]) != s:
            out.append({"type": "stage", "stage": s["id"], **s})
    if before.get("gpu") != after.get("gpu"):
        out.append({"type": "gpu", **after["gpu"]})
    for kind, key, typ in (("check", lambda r: r["demo"], "check"), ("repair", lambda r: r["demo"], "repair"),
                           ("variants", lambda r: (r.get("id"), r.get("seed")), "variant")):
        old = _keyed(before.get(kind, []), key)
        out += [{"type": typ, **r} for r in after.get(kind, []) if old.get(key(r)) != r]
    bt, at = before.get("train") or {}, after.get("train") or {}
    if (bt.get("step"), bt.get("steps"), bt.get("eta_s"), len(bt.get("loss") or [])) != (
            at.get("step"), at.get("steps"), at.get("eta_s"), len(at.get("loss") or [])):
        seen = {tuple(p) for p in bt.get("loss") or []}
        curve = at.get("loss") or []
        # `loss`: the latest loss (at `step`); `loss_points`: every new [step, loss] since the last train patch
        out.append({"type": "train", "step": at.get("step"), "steps": at.get("steps"), "cell": at.get("cell"),
                    "loss": curve[-1][1] if curve else None, "loss_points": [p for p in curve if tuple(p) not in seen],
                    "eta_s": at.get("eta_s")})
    old_ck = {c["name"] for c in bt.get("checkpoints") or []}
    out += [{"type": "checkpoint", **c} for c in at.get("checkpoints") or [] if c["name"] not in old_ck]
    old_ev = {(s.get("cell"), s.get("seed")) for s in (before.get("evaluate") or {}).get("seeds", [])}
    out += [{"type": "evaluate", **s} for s in (after.get("evaluate") or {}).get("seeds", [])
            if (s.get("cell"), s.get("seed")) not in old_ev]
    old_art = {a["name"] for a in before.get("artifacts") or []}
    out += [{"type": "artifact", **a} for a in after.get("artifacts") or [] if a["name"] not in old_art]
    return out


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.get("/runs/{run_id}/events")
async def events(run_id: str, request: Request, follow: bool = True, poll: float = Query(POLL_S, ge=0.1, le=10.0),
                 m: RunManager = Depends(get_manager)):
    _run_or_404(m, run_id)
    log_path = m.exp_root(run_id) / "run.log"

    async def stream():
        snap = m.snapshot(run_id)
        yield _sse({"type": "snapshot", **snap})
        offset, pending = 0, ""
        started = last_sent = time.monotonic()
        while True:
            sent = False
            try:
                with open(log_path, "rb") as f:
                    f.seek(offset)
                    chunk = f.read()
                    offset += len(chunk)
            except OSError:
                chunk = b""
            text = pending + chunk.decode("utf-8", errors="replace")
            *lines, pending = text.split("\n")
            for line in lines:
                if line.strip():
                    yield _sse({"type": "log", "line": line.rstrip("\r")})
                    sent = True
            nxt = m.snapshot(run_id)
            for p in patches(snap, nxt):
                yield _sse(p)
                sent = True
            snap = nxt
            finished = snap["status"] in ("done", "failed", "cancelled")
            if finished or not follow or time.monotonic() - started > MAX_STREAM_S or await request.is_disconnected():
                break
            if sent:
                last_sent = time.monotonic()
            elif time.monotonic() - last_sent > KEEPALIVE_S:
                yield ": keepalive\n\n"
                last_sent = time.monotonic()
            await asyncio.sleep(poll)
        if pending.strip():
            yield _sse({"type": "log", "line": pending.rstrip("\r")})
        yield _sse({"type": "end", "status": snap["status"], "detail": snap.get("detail")})

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
