"""Demo store routes and the diagnose step (spec 8.3) with its rules fallback.

    POST /demos                  body: Demo JSON -> 201 {"id"}; 409 if the id exists
    GET  /demos?source=          newest first
    GET  /demos/{id}             404 if missing
    POST /demos/{id}/diagnose    Nemotron VL, or the rules detector if it fails -> {source, model_id, diagnosis, gated}
    GET  /demos/{id}/diagnosis   the saved one, same shape; 404 if none yet

`gated` lists what diagnose_gated() dropped from the model's reply because the measured
windows contradict it ([] for the rules), stored with the diagnosis (StoredDiagnosis.gated).

Diagnose reads the demo's recorded episode (store.episode_dir(id)): front frames,
the wrist frame at the first gripper close, and signals.npz. Windows are computed
from the demo's trajectory and those signals, so they must have the same number of
steps. Errors are explicit, never a 500: no episode, no front frames or no signals
-> 409; a corrupt or inconsistent file -> 422.

The store root is DATA_DIR (demo_pipeline.paths.data_dir), read on every request.
"""
from __future__ import annotations

import logging
import zipfile
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException

from demo_pipeline.episode_io import EpisodeMeta, load_episode, load_signals
from demo_pipeline.measure import compute_windows
from demo_pipeline.rules import detect_rules
from demo_pipeline.schemas import Demo, SimSignals, Trajectory
from demo_pipeline.store import DemoStore
from demo_pipeline.success import check_success
from nebius_llm import TokenFactoryError
from nebius_llm.config import get_vision_model

from ..ai.diagnose import DIAGNOSE_TIER, DiagnosisError, diagnose_gated, select_frames

log = logging.getLogger(__name__)

router = APIRouter(prefix="/demos", tags=["demos"])

FRONT, WRIST = "front", "wrist"
# What a corrupt episode file raises: pydantic/JSON (ValueError), a missing file (OSError),
# a missing npz array (KeyError), a truncated or non-zip npz (EOFError, BadZipFile).
_CORRUPT = (ValueError, OSError, KeyError, EOFError, zipfile.BadZipFile)


def get_store() -> DemoStore:
    return DemoStore()


def _get_demo(store: DemoStore, demo_id: str) -> Demo:
    try:
        return store.get_demo(demo_id)
    except KeyError:
        raise HTTPException(404, f"demo {demo_id!r} not found") from None
    except ValueError as e:
        raise HTTPException(422, f"demo {demo_id!r} is corrupt: {e}") from None


def load_frames(
    ep_dir: Path, meta: EpisodeMeta, images: dict[str, list[Path]], t: list[float], gripper: list[int], has_wrist: bool
) -> tuple[list[tuple[float, bytes]], bytes | None]:
    """The front frames diagnose() will send (subsampled first, so only those are read) and the wrist frame
    at the first gripper close, or None without a wrist camera or a close. Raises OSError for a missing image."""
    candidates = [(t[i], images[FRONT][i]) for i in range(meta.n_steps)]
    frames = [(ti, Path(p).read_bytes()) for ti, p in select_frames(candidates, has_wrist)]
    wrist = None
    if has_wrist:
        closed = np.flatnonzero(np.asarray(gripper) == 1)
        wrist = Path(images[WRIST][int(closed[0])]).read_bytes()
    return frames, wrist


def _replay_success(store: DemoStore, demo: Demo, meta: EpisodeMeta, signals: SimSignals) -> bool:
    """The recorded verification if there is one (store passport, then episode passport), else check the signals."""
    passport = store.get_passport(demo.id) or meta.passport
    if passport is not None:
        return passport.verification.success
    return check_success(demo.trajectory, signals, demo.scene.bin_pose).success


@router.post("", status_code=201)
def create_demo(demo: Demo, store: DemoStore = Depends(get_store)) -> dict:
    if store.has_demo(demo.id):
        raise HTTPException(409, f"demo {demo.id!r} already exists")
    try:
        store.save_demo(demo)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return {"id": demo.id}


@router.get("")
def list_demos(source: Literal["human", "repaired", "variant"] | None = None,
               store: DemoStore = Depends(get_store)) -> list[Demo]:
    return store.list_demos(source)


@router.get("/{demo_id}")
def get_demo(demo_id: str, store: DemoStore = Depends(get_store)) -> Demo:
    return _get_demo(store, demo_id)


@router.post("/{demo_id}/diagnose")
def diagnose_demo(demo_id: str, store: DemoStore = Depends(get_store)) -> dict:
    demo = _get_demo(store, demo_id)
    traj: Trajectory = demo.trajectory
    ep_dir = store.episode_dir(demo_id)
    if not (ep_dir / "episode.json").is_file():
        raise HTTPException(409, f"demo {demo_id!r} has no recorded episode; replay it first")

    try:
        meta, _, images = load_episode(ep_dir)
        signals = load_signals(ep_dir)
    except _CORRUPT as e:
        raise HTTPException(422, f"episode of {demo_id!r} is corrupt: {type(e).__name__}: {e}") from None
    if FRONT not in meta.cameras:
        raise HTTPException(409, f"episode of {demo_id!r} has no {FRONT} camera frames (cameras: {meta.cameras})")
    if signals is None:
        raise HTTPException(409, f"episode of {demo_id!r} has no signals (signals.npz); re-record it with signals")
    n = len(traj.t)
    if meta.n_steps != n or signals.n_steps != n:
        raise HTTPException(
            422, f"episode of {demo_id!r} has {meta.n_steps} steps and {signals.n_steps} signal steps; "
                 f"the demo trajectory has {n}")

    has_wrist = WRIST in meta.cameras and 1 in traj.gripper
    try:
        frames, wrist = load_frames(ep_dir, meta, images, traj.t, traj.gripper, has_wrist)
        windows = compute_windows(traj, signals)
        replay_success = _replay_success(store, demo, meta, signals)
    except _CORRUPT as e:
        raise HTTPException(422, f"episode of {demo_id!r} is unreadable: {type(e).__name__}: {e}") from None

    try:
        diag, gated = diagnose_gated(frames, wrist, windows, meta.task_text, replay_success, traj.duration)
        source, model_id = "nemotron", get_vision_model(DIAGNOSE_TIER).model_id
    except (DiagnosisError, TokenFactoryError) as e:
        log.warning("diagnose(%s) fell back to rules: %s: %s", demo_id, type(e).__name__, e)
        diag, gated = detect_rules(traj, windows, meta.task_text), []
        source, model_id = "rules", None
    for item in gated:
        log.info("diagnose(%s) gate: %s", demo_id, item)

    store.save_diagnosis(demo_id, diag, source, model_id, gated)  # replaces any older gated list
    return {"source": source, "model_id": model_id, "diagnosis": diag.model_dump(mode="json"), "gated": gated}


@router.get("/{demo_id}/diagnosis")
def get_diagnosis(demo_id: str, store: DemoStore = Depends(get_store)) -> dict:
    _get_demo(store, demo_id)
    try:
        saved = store.get_stored_diagnosis(demo_id)
    except ValueError as e:
        raise HTTPException(422, f"diagnosis of {demo_id!r} is corrupt: {e}") from None
    if saved is None:
        raise HTTPException(404, f"demo {demo_id!r} has no diagnosis yet")
    return saved.model_dump(mode="json")
