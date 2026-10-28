"""Demo store routes and the diagnose step (spec 8.3) with its rules fallback.

    POST /demos                  body: Demo JSON -> 201 {"id"}; 409 if the id exists
    GET  /demos?source=          newest first
    GET  /demos/{id}             404 if missing
    DELETE /demos/{id}           the Record page's "Delete last demo": moves the folder to
                                 DATA_DIR/demos/_discarded/<id> (never deletes) -> {id, discarded_to};
                                 404 if missing; 409 if other demos derive from it
    PUT  /demos/{id}/camera      multipart: video (webm) + timing (CameraTiming JSON), the Record page's webcam
                                 video of the take -> demos/<id>/camera.webm + camera.json (replacing any) ->
                                 {id, video, bytes, frames}; 404 if missing; 422 if not webm, empty or the timing
                                 doesn't line up; 413 past MAX_CAMERA_BYTES
    POST /demos/{id}/diagnose    Nemotron VL, or the rules detector if it fails -> {source, model_id, diagnosis, gated}
    GET  /demos/{id}/diagnosis   the saved one, same shape; 404 if none yet
    GET  /demos/{id}/take-review?phrasing=rules|nemotron  the Record page's coach right after a take
                                 (demo_pipeline.take_review): {demo_id, verdict PASS|FAIL, lines, source, rejected,
                                 facts}. rules (default) always works; nemotron rephrases and falls back to the rules
                                 if a number doesn't match the facts. 409 without recorded signals; 422 if corrupt
    POST /demos/{id}/perfect?diagnoser=hybrid|nemotron|rules  (default hybrid: rules + Nemotron)
                                 202 {job_id, status, poll} and a Location header; 503 if the sim
                                 worker is down; 409 for a derived demo, a worker for another robot,
                                 or a model diagnoser on a worker without cameras (app.jobs.perfect_stored_demo)
    GET  /jobs/{id}              the job: status queued|running|succeeded|failed, result or error

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
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile

from demo_pipeline.episode_io import EpisodeMeta, load_episode, load_signals
from demo_pipeline.measure import compute_windows
from demo_pipeline.rules import detect_rules
from demo_pipeline.schemas import Demo, SimSignals, Trajectory
from demo_pipeline.store import CAMERA_VIDEO, CameraTiming, DemoStore, VideoTooLarge
from demo_pipeline.success import check_success
from demo_pipeline.take_review import review_take
from nebius_llm import TokenFactoryError, chat
from nebius_llm.config import get_vision_model

from ..ai.diagnose import DIAGNOSE_TIER, DiagnosisError, diagnose_gated
from ..jobs import FRONT, WRIST, Diagnoser, JobRunner, check_worker, load_frames, perfect_stored_demo
from ..sim_client import SimWorkerClient, SimWorkerError

log = logging.getLogger(__name__)

router = APIRouter(prefix="/demos", tags=["demos"])
jobs_router = APIRouter(prefix="/jobs", tags=["jobs"])

_JOBS: JobRunner | None = None

MAX_CAMERA_BYTES = 1 << 30  # 1 GiB: a webcam take is a few MB a minute; past this something is wrong

# What a corrupt episode file raises: pydantic/JSON (ValueError), a missing file (OSError),
# a missing npz array (KeyError), a truncated or non-zip npz (EOFError, BadZipFile).
_CORRUPT = (ValueError, OSError, KeyError, EOFError, zipfile.BadZipFile)


def get_store() -> DemoStore:
    return DemoStore()


def get_jobs() -> JobRunner:
    """One runner per process: perfect jobs run one at a time, like the sim worker."""
    global _JOBS
    if _JOBS is None:
        _JOBS = JobRunner()
    return _JOBS


def get_sim_client() -> SimWorkerClient:
    """A new client per request (SIM_WORKER_URL is read now); the job it starts closes it."""
    return SimWorkerClient()


def _get_demo(store: DemoStore, demo_id: str) -> Demo:
    try:
        return store.get_demo(demo_id)
    except KeyError:
        raise HTTPException(404, f"demo {demo_id!r} not found") from None
    except ValueError as e:
        raise HTTPException(422, f"demo {demo_id!r} is corrupt: {e}") from None


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


@router.delete("/{demo_id}")
def discard_demo(demo_id: str, store: DemoStore = Depends(get_store)) -> dict:
    _get_demo(store, demo_id)
    children = [d.id for d in store.list_demos() if d.parent_id == demo_id]
    if children:
        raise HTTPException(409, f"demo {demo_id!r} has derived demos ({', '.join(children)}); it stays")
    try:
        moved = store.discard(demo_id)
    except KeyError:
        raise HTTPException(404, f"demo {demo_id!r} not found") from None
    return {"id": demo_id, "discarded_to": moved.relative_to(store.root).as_posix()}


@router.put("/{demo_id}/camera")
def save_camera(demo_id: str, video: UploadFile = File(...), timing: str = Form(...),
                store: DemoStore = Depends(get_store)) -> dict:
    _get_demo(store, demo_id)
    try:
        parsed = CameraTiming.model_validate_json(timing)
    except ValueError as e:
        raise HTTPException(422, f"camera timing for {demo_id!r} is invalid: {e}") from None
    kind = (video.content_type or "").split(";")[0].strip().lower()
    if kind != "video/webm":
        raise HTTPException(422, f"the camera video must be video/webm, not {video.content_type!r}")
    try:
        size = store.save_camera(demo_id, video.file, parsed, MAX_CAMERA_BYTES)
    except KeyError:
        raise HTTPException(404, f"demo {demo_id!r} not found") from None
    except VideoTooLarge as e:
        raise HTTPException(413, str(e)) from None
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    return {"id": demo_id, "video": f"demos/{demo_id}/{CAMERA_VIDEO}", "bytes": size, "frames": len(parsed.t_ms)}


TAKE_REVIEW_TIER = "nano"  # rephrasing a few short lines: the fast text tier (config.TIERS)


def _take_review_chat(prompt: str, *, system: str):
    return chat(prompt, tier=TAKE_REVIEW_TIER, system=system, max_tokens=400, temperature=0.3)


@router.get("/{demo_id}/take-review")
def take_review(demo_id: str, phrasing: Literal["rules", "nemotron"] = "rules",
                store: DemoStore = Depends(get_store)) -> dict:
    demo = _get_demo(store, demo_id)
    ep_dir = store.episode_dir(demo_id)
    try:
        signals = load_signals(ep_dir)
        steps = ep_dir / "steps.npz"
        reached = None
        if steps.is_file():
            with np.load(steps) as npz:
                reached = npz["ee_pos"] if "ee_pos" in npz.files else None
    except _CORRUPT as e:
        raise HTTPException(422, f"episode of {demo_id!r} is corrupt: {type(e).__name__}: {e}") from None
    if signals is None:
        raise HTTPException(409, f"demo {demo_id!r} has no recorded signals (episode/signals.npz) to review")
    try:
        review = review_take(demo, signals, _take_review_chat if phrasing == "nemotron" else None, reached=reached)
    except ValueError as e:
        raise HTTPException(422, f"take {demo_id!r} doesn't add up: {e}") from None
    if review.rejected:
        log.info("take-review(%s): Nemotron's phrasing not used: %s", demo_id, review.rejected)
    return review.model_dump(mode="json")


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


@router.post("/{demo_id}/perfect", status_code=202)
def perfect(demo_id: str, response: Response, diagnoser: Diagnoser = "hybrid",
            store: DemoStore = Depends(get_store), client: SimWorkerClient = Depends(get_sim_client),
            jobs: JobRunner = Depends(get_jobs)) -> dict:
    submitted = False
    try:
        demo = _get_demo(store, demo_id)
        if demo.source != "human":
            raise HTTPException(409, f"demo {demo_id!r} is {demo.source!r}; only human demos are perfected")
        try:
            health = client.health()
        except SimWorkerError as e:
            raise HTTPException(503, str(e)) from None
        refusal = check_worker(health, demo.scene.robot, diagnoser)
        if refusal is not None:
            raise HTTPException(*refusal)

        def run() -> dict:
            with client:
                return perfect_stored_demo(store, client, demo_id, diagnoser)

        job = jobs.submit("perfect", run, demo_id=demo_id, params={"diagnoser": diagnoser})
        submitted = True
    finally:
        if not submitted:
            client.close()
    response.headers["Location"] = f"/jobs/{job.id}"
    return {"job_id": job.id, "status": job.status, "poll": f"/jobs/{job.id}"}


@jobs_router.get("/{job_id}")
def get_job(job_id: str, jobs: JobRunner = Depends(get_jobs)) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"job {job_id!r} not found (jobs live in memory; did the backend restart?)")
    return job.model_dump(mode="json")


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
