"""The data showcase: one human-demo experiment, demo by demo, read only. For each demo the page shows what the human
did (LIVE, the live recording), the physics re-run (REPLAY), what SANT changed (REPAIRED) and the multiplied variants,
each in the robot twin, next to the simulator's own camera, with its physics verdict.

    GET /showcase/sets
        [{name, input, n_demos, replay_verified, repaired, variants_verified, variants_total, evals}]
    GET /showcase/sets/{name}
        {name, input, demos: [{id, live, live_frames, replay, repair, repaired, variants}]}
    GET /showcase/sets/{name}/episodes/{demo_id}?live=false
        The twin's episode (routers/twin.py episode_payload): from the main store with live=true, else the set's store.
    GET /showcase/sets/{name}/footage/{demo_id}?camera=front&live=false
        {frames, stride, cols, tile [w, h], fps, url}: the episode's camera frames as one sprite sheet (url, a JPEG),
        every stride-th frame, row by row.
    GET /showcase/live/{name}?follow=true
        Server-sent events while the experiment runs: its run.log as pipeline events (parse_log_line) and each new
        variant folder once its passport is written (scan_variants). follow=false sends what is there and ends.

A set is DATA_DIR/human_exp/<name>/ (config.json, run.log, stages/, store/), written by
scripts/run_human_demo_experiment.py; the live recordings are in DATA_DIR/demos/. Nothing here writes to either.
"""
from __future__ import annotations

import asyncio
import io
import json
import math
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from demo_pipeline.paths import data_dir
from demo_pipeline.store import DemoStore

from .twin import episode_payload

router = APIRouter(prefix="/showcase", tags=["showcase"])

_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")
Camera = Literal["front", "wrist"]
# Footage: at most this many tiles a sheet (a 404-step episode at 50 fps plays every 2nd frame, 25 a second).
MAX_TILES = 250
COLS = 16
POLL_S = 0.5
KEEPALIVE_S = 15.0
MAX_STREAM_S = 6 * 3600


def _check(name: str) -> str:
    if not _NAME.fullmatch(name):
        raise HTTPException(422, f"{name!r} isn't a name")
    return name


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _set_dir(name: str) -> Path:
    d = data_dir() / "human_exp" / _check(name)
    if not (d / "config.json").is_file() or not (d / "store").is_dir():
        raise HTTPException(404, f"no experiment {name!r}")
    return d


def _store(set_dir: Path, live: bool) -> DemoStore:
    return DemoStore(data_dir()) if live else DemoStore(set_dir / "store")


def _frames(store: DemoStore, demo_id: str, camera: str = "front") -> list[Path]:
    try:
        d = store.episode_dir(demo_id) / camera
    except KeyError:
        return []
    return sorted(d.glob("*.png")) if d.is_dir() else []


def _verification(store: DemoStore, demo_id: str) -> dict | None:
    try:
        passport = store.get_passport(demo_id)
    except (KeyError, ValueError, OSError):
        return None
    return None if passport is None else passport.verification.model_dump()


# ---------------------------------------------------------------------------------------------------- the log


_LINE = re.compile(r"\[human-exp (\d\d:\d\d:\d\d)\] (.*)")
_PER_DEMO = re.compile(r"(physics|repair|align|multiply|nemotron) (\S+): (.*)")
_STAGE = re.compile(r"(\w+): (.*)")


def parse_log_line(line: str) -> dict | None:
    """One run.log line as a pipeline event, or None for a line that says nothing about the pipeline."""
    m = _LINE.fullmatch(line.rstrip("\r\n"))
    if not m:
        return None
    at, body = m.groups()
    if (d := re.fullmatch(r"done through '(\w+)'", body)) is not None:
        return {"type": "done", "at": at, "through": d.group(1)}
    if (p := _PER_DEMO.fullmatch(body)) is not None:
        kind, demo_id, rest = p.groups()
        if kind == "physics":
            ok = rest == "verified"
            reasons = [] if ok else [r for r in rest.removeprefix("failed").strip().split(",") if r]
            return {"type": "physics", "at": at, "id": demo_id, "success": ok, "reasons": reasons}
        if kind == "repair":
            r = re.match(r"(\w+) \((\d+) repairs", rest)
            return {"type": "repair", "at": at, "id": demo_id, "status": r.group(1) if r else rest,
                    "repairs": int(r.group(2)) if r else 0}
        if kind == "multiply":
            r = re.match(r"(\d+)/(\d+) variants verified", rest)
            return {"type": "multiply", "at": at, "id": demo_id, "k": int(r.group(1)) if r else 0,
                    "n": int(r.group(2)) if r else 0}
        if kind == "align":
            return {"type": "align", "at": at, "id": demo_id}
        return {"type": "nemotron", "at": at, "id": demo_id, "text": rest}
    s = _STAGE.fullmatch(body)
    if s is None:
        return None
    stage, rest = s.groups()
    if stage == "train" and (r := re.fullmatch(r"run (\S+): (.*)", rest)) is not None:
        cells = [re.fullmatch(r"(\S+) loss (\S+)", c) for c in r.group(2).split(", ")]
        if all(cells):
            return {"type": "train", "at": at, "run": r.group(1),
                    "cells": [{"cell": c.group(1), "loss": float(c.group(2))} for c in cells]}
    if stage == "eval":
        cells = [re.fullmatch(r"(\S+) (\d+)/(\d+)", c) for c in rest.split(", ")]
        if all(cells):
            return {"type": "eval", "at": at,
                    "cells": [{"cell": c.group(1), "k": int(c.group(2)), "n": int(c.group(3))} for c in cells]}
    if stage in ("train", "eval") and ".exe" in rest:
        rest = "started"
    elif stage == "select":
        rest = rest.split(":")[0]
    return {"type": "stage", "stage": stage, "at": at, "text": rest}


def _log_events(set_dir: Path) -> list[dict]:
    try:
        lines = (set_dir / "run.log").read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []
    return [e for e in map(parse_log_line, lines) if e is not None]


_VARIANT = re.compile(r".+_m(\d+)")


def scan_variants(store_dir: Path, seen: set[str]) -> list[dict]:
    """Variant folders (<…>_m<seed>) whose passport is written and that aren't in `seen` yet, as events; adds them."""
    demos = Path(store_dir) / "demos"
    if not demos.is_dir():
        return []
    store = DemoStore(store_dir)
    out = []
    for d in sorted(demos.iterdir()):
        m = _VARIANT.fullmatch(d.name)
        if m is None or d.name in seen or not (d / "passport.json").is_file():
            continue
        try:
            passport = store.get_passport(d.name)
        except (KeyError, ValueError, OSError):
            continue
        if passport is None:
            continue
        seen.add(d.name)
        out.append({"type": "variant", "id": d.name, "source": (passport.lineage or [d.name])[0],
                    "seed": passport.variant_seed if passport.variant_seed is not None else int(m.group(1)),
                    "success": passport.verification.success, "reasons": list(passport.verification.reasons),
                    "frames": len(_frames(store, d.name))})
    return out


# ---------------------------------------------------------------------------------------------------- the sets


def _summary(set_dir: Path) -> dict:
    config = _read_json(set_dir / "config.json") or {}
    stages = set_dir / "stages"
    physics = [_read_json(p) or {} for p in sorted((stages / "physics").glob("*.json"))]
    repairs = [_read_json(p) or {} for p in sorted((stages / "repair").glob("*.json"))]
    attempts = [a for p in sorted((stages / "multiply").glob("*.json")) for a in (_read_json(p) or {}).get("attempts", [])]
    evals = [e for e in _log_events(set_dir) if e["type"] == "eval"]
    return {
        "name": set_dir.name,
        "input": config.get("input") or "webcam",
        "n_demos": len(config.get("ids", [])),
        "replay_verified": sum(1 for p in physics if p.get("success")),
        "repaired": sum(1 for r in repairs if r.get("status") == "perfected"),
        "variants_verified": sum(1 for a in attempts if a.get("success")),
        "variants_total": len(attempts),
        "evals": evals[-1]["cells"] if evals else [],
    }


@router.get("/sets")
def list_sets() -> list[dict]:
    root = data_dir() / "human_exp"
    if not root.is_dir():
        return []
    return [_summary(d) for d in sorted(root.iterdir())
            if _NAME.fullmatch(d.name) and (d / "config.json").is_file() and (d / "store").is_dir()]


def _demo_row(set_dir: Path, demo_id: str) -> dict:
    live, store = _store(set_dir, True), _store(set_dir, False)
    stages = set_dir / "stages"
    try:
        has_live = (live.episode_dir(demo_id) / "episode.json").is_file()
    except KeyError:
        has_live = False
    replay = _verification(store, demo_id) or _read_json(stages / "physics" / f"{demo_id}.json")
    if replay is not None:
        replay = {k: replay.get(k) for k in ("success", "reasons", "duration", "path_length", "max_contact_force",
                                            "settle_time")} | {"frames": len(_frames(store, demo_id))}
    stage = _read_json(stages / "repair" / f"{demo_id}.json")
    repair = repaired = None
    if stage is not None:
        repair = {"status": stage.get("status"), "decision": stage.get("decision"),
                  "diagnosis_source": stage.get("diagnosis_source"), "output_id": stage.get("output_demo_id"),
                  "repairs": stage.get("repairs", []), "issues": stage.get("issues", []),
                  "before": stage.get("raw_verification"), "after": stage.get("verification")}
        out_id = stage.get("output_demo_id")
        if out_id and (v := _verification(store, out_id)) is not None:
            repaired = {"id": out_id, "success": v["success"], "frames": len(_frames(store, out_id))}
    multiply = _read_json(stages / "multiply" / f"{demo_id}.json") or {}
    variants = []
    for a in multiply.get("attempts", []):
        vid = a.get("id")
        if not vid and multiply.get("source") and a.get("seed") is not None:
            # A failed attempt has no id in the stage file; its episode is still kept under <source>_m<seed>.
            vid = f"{multiply['source']}_m{a['seed']}"
            try:
                vid = vid if (store.episode_dir(vid) / "episode.json").is_file() else None
            except KeyError:
                vid = None
        variants.append({"id": vid, "seed": a.get("seed"), "success": bool(a.get("success")),
                         "reasons": a.get("reasons", []), "frames": len(_frames(store, vid)) if vid else 0})
    return {"id": demo_id, "live": has_live, "live_frames": len(_frames(live, demo_id)), "replay": replay,
            "repair": repair, "repaired": repaired, "variants": variants}


@router.get("/sets/{name}")
def get_set(name: str) -> dict:
    d = _set_dir(name)
    config = _read_json(d / "config.json") or {}
    return {"name": name, "input": config.get("input") or "webcam", "repair": config.get("repair"),
            "demos": [_demo_row(d, i) for i in config.get("ids", [])]}


@router.get("/sets/{name}/episodes/{demo_id}")
def get_episode(name: str, demo_id: str, live: bool = False) -> dict:
    return episode_payload(_store(_set_dir(name), live), _check(demo_id))


# ---------------------------------------------------------------------------------------------------- footage


def footage_stride(n: int) -> int:
    return max(1, math.ceil(n / MAX_TILES))


def _footage(name: str, demo_id: str, camera: str, live: bool) -> tuple[list[Path], int, dict]:
    store = _store(_set_dir(name), live)
    frames = _frames(store, _check(demo_id), camera)
    if not frames:
        raise HTTPException(404, f"{demo_id!r} has no {camera} frames")
    meta = _read_json(store.episode_dir(demo_id) / "episode.json") or {}
    return frames, footage_stride(len(frames)), meta


@lru_cache(maxsize=48)
def _sheet(paths: tuple[str, ...], stamp: int) -> tuple[bytes, tuple[int, int]]:
    from PIL import Image

    with Image.open(paths[0]) as first:
        w, h = first.size
    cols = min(COLS, len(paths))
    sheet = Image.new("RGB", (w * cols, h * math.ceil(len(paths) / cols)))
    for i, p in enumerate(paths):
        with Image.open(p) as im:
            sheet.paste(im.convert("RGB"), ((i % cols) * w, (i // cols) * h))
    buf = io.BytesIO()
    sheet.save(buf, "JPEG", quality=82)
    return buf.getvalue(), (w, h)


def _sheet_for(frames: list[Path], stride: int) -> tuple[bytes, tuple[int, int]]:
    picked = frames[::stride]
    return _sheet(tuple(str(p) for p in picked), max(p.stat().st_mtime_ns for p in picked))


@router.get("/sets/{name}/footage/{demo_id}")
def get_footage(name: str, demo_id: str, camera: Camera = "front", live: bool = False) -> dict:
    frames, stride, meta = _footage(name, demo_id, camera, live)
    n = math.ceil(len(frames) / stride)
    _, tile = _sheet_for(frames, stride)
    flag = "true" if live else "false"
    return {"frames": n, "stride": stride, "cols": min(COLS, n), "tile": list(tile), "fps": meta.get("fps", 50),
            "url": f"/showcase/sets/{name}/footage/{demo_id}/sprite.jpg?camera={camera}&live={flag}"}


@router.get("/sets/{name}/footage/{demo_id}/sprite.jpg")
def get_sprite(name: str, demo_id: str, camera: Camera = "front", live: bool = False) -> Response:
    frames, stride, _ = _footage(name, demo_id, camera, live)
    body, _ = _sheet_for(frames, stride)
    return Response(body, media_type="image/jpeg", headers={"Cache-Control": "max-age=3600"})


# ---------------------------------------------------------------------------------------------------- live


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.get("/live/{name}")
async def live(name: str, request: Request, follow: bool = True, poll: float = Query(POLL_S, ge=0.05, le=5.0)):
    d = _set_dir(name)
    config = _read_json(d / "config.json") or {}

    async def events():
        yield _sse({"type": "hello", "name": name, "ids": config.get("ids", []), "input": config.get("input") or "webcam",
                    "variants": config.get("variants")})
        seen: set[str] = set()
        offset, pending = 0, ""
        started = last_sent = time.monotonic()
        while True:
            sent = False
            try:
                with open(d / "run.log", "rb") as f:
                    f.seek(offset)
                    chunk = f.read()
                    offset += len(chunk)
            except OSError:
                chunk = b""
            text = pending + chunk.decode("utf-8", errors="replace")
            *lines, pending = text.split("\n")
            finished = False
            for line in lines:
                e = parse_log_line(line)
                if e is not None:
                    finished = finished or (e["type"] == "done" and e["through"] == "results")
                    yield _sse(e)
                    sent = True
            for e in scan_variants(d / "store", seen):
                yield _sse(e)
                sent = True
            if not follow or finished or time.monotonic() - started > MAX_STREAM_S or await request.is_disconnected():
                break
            if sent:
                last_sent = time.monotonic()
            elif time.monotonic() - last_sent > KEEPALIVE_S:
                yield ": keepalive\n\n"
                last_sent = time.monotonic()
            await asyncio.sleep(poll)
        if pending and (e := parse_log_line(pending)) is not None:
            yield _sse(e)
        yield _sse({"type": "end"})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
