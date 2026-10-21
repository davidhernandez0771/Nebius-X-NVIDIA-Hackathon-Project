"""Background jobs, and the perfect job: one stored human demo through perfect_demo and the sim worker.

JobRunner runs jobs one at a time on a background thread (the sim worker runs one job at a
time anyway) and keeps their status in memory: a backend restart forgets them.

perfect_stored_demo(store, client, demo_id, diagnoser):
  1. replay the human demo as recorded ("<id>_raw"), unless the caller already did;
  2. perfect_demo() with
       diagnose_fn = diagnose_hybrid (diagnoser="hybrid": the rules plus Nemotron for what they never name),
                     diagnose_gated (diagnoser="nemotron": the model alone), both on the frames of the latest
                     replay, or detect_rules (diagnoser="rules");
       verify_fn   = the worker's /replay ("<id>_<diagnoser>_v<k>");
  3. store the result: the human demo gets the latest diagnosis; a verified result becomes the
     demo "<id>_<diagnoser>" (source "repaired", even when kept unchanged) with its diagnosis,
     Passport and the verified episode.

A worker that is down, hung, busy past the retries, or refusing the request (anything but a
"sim_error") fails the job with that error and stores nothing, so the demo can be re-run.
perfect_demo would otherwise record such a failure as "discarded". A sim_error is that
trajectory failing in the sim, so it is a failed verification of this demo.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from concurrent.futures import Executor, Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

import numpy as np
from pydantic import BaseModel, Field

from demo_pipeline import PIPELINE_VERSION, scene_geometry
from demo_pipeline.episode_io import EpisodeMeta, load_episode, load_signals
from demo_pipeline.process import perfect_demo
from demo_pipeline.refine import refine_diagnosis
from demo_pipeline.rules import detect_rules
from demo_pipeline.schemas import (
    Demo,
    Diagnosis,
    MetricsWindow,
    Passport,
    Scene,
    SimSignals,
    Trajectory,
    VerificationResult,
)
from demo_pipeline.sim_protocol import (
    HealthResponse,
    MultiplyResponse,
    ReplayRequest,
    ReplayResponse,
    SignalsPayload,
)
from demo_pipeline.store import DemoStore, write_atomic
from nebius_llm.config import get_vision_model

from .ai.diagnose import DIAGNOSE_TIER, diagnose_gated, diagnose_hybrid, select_frames
from .ai.nemotron_repair import RepairResult, repair_with_nemotron
from .sim_client import SimWorkerBusy, SimWorkerClient, SimWorkerError

log = logging.getLogger(__name__)

Diagnoser = Literal["nemotron", "rules", "hybrid"]
MODEL_DIAGNOSERS = ("nemotron", "hybrid")  # need camera frames and a model call
JobStatus = Literal["queued", "running", "succeeded", "failed"]
FRONT, WRIST = "front", "wrist"

# Rim height above the bin origin: BIN_WALL (0.01) + inner height (0.08), the numbers the Isaac scene is built from.
BIN_RIM_HEIGHT = scene_geometry.BIN_RIM_HEIGHT


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- jobs ----------------------------------------------------------------------------------

class Job(BaseModel):
    id: str
    kind: str
    demo_id: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    status: JobStatus = "queued"
    created_at: datetime = Field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    result: dict[str, Any] | None = None
    error: str | None = None


class JobRunner:
    def __init__(self, executor: Executor | None = None) -> None:
        self._executor = executor or ThreadPoolExecutor(max_workers=1, thread_name_prefix="job")
        self._jobs: dict[str, Job] = {}
        self._futures: dict[str, Future] = {}
        self._lock = threading.Lock()

    @staticmethod
    def new_id(kind: str) -> str:
        return DemoStore.new_id(kind)

    def submit(self, kind: str, fn: Callable[[], dict], *, demo_id: str | None = None,
               params: dict | None = None, job_id: str | None = None) -> Job:
        """job_id: an id from new_id(), for a job that needs to know its own id."""
        job = Job(id=job_id or self.new_id(kind), kind=kind, demo_id=demo_id, params=params or {})
        with self._lock:
            self._jobs[job.id] = job
        self._futures[job.id] = self._executor.submit(self._run, job.id, fn)
        return self.get(job.id)

    def _update(self, job_id: str, **fields) -> None:
        with self._lock:
            self._jobs[job_id] = self._jobs[job_id].model_copy(update=fields)

    def _run(self, job_id: str, fn: Callable[[], dict]) -> None:
        self._update(job_id, status="running", started_at=_now())
        try:
            result = fn()
        except Exception as e:  # a job failure is recorded on the job, never raised into the executor
            log.warning("job %s failed: %s: %s", job_id, type(e).__name__, e)
            self._update(job_id, status="failed", finished_at=_now(), error=f"{type(e).__name__}: {e}")
            return
        self._update(job_id, status="succeeded", finished_at=_now(), result=result)

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return None if job is None else job.model_copy(deep=True)

    def wait(self, job_id: str, timeout: float | None = None) -> Job | None:
        future = self._futures.get(job_id)
        if future is not None:
            future.result(timeout=timeout)
        return self.get(job_id)


# --- helpers for the perfect job -----------------------------------------------------------

def bin_rim_z(scene: Scene) -> float:
    return scene.bin_pose.pos[2] + BIN_RIM_HEIGHT


def output_demo_id(demo_id: str, diagnoser: Diagnoser) -> str:
    """One output per diagnoser, so the rules-vs-Nemotron ablation can run on the same human demo."""
    return f"{demo_id}_{diagnoser}"


def _stretch_index(m: int, n: int) -> np.ndarray:
    """For each of n trajectory steps, the matching one of m replay steps; both ends line up."""
    return np.rint(np.arange(n) * (m - 1) / max(n - 1, 1)).astype(int)


def align_signals(signals: SimSignals, t: list[float]) -> SimSignals:
    """Signals on the trajectory's steps. The worker's gripper gate can hold steps, so a replay may be longer
    than the trajectory; its steps are then stretched onto the trajectory (start and end line up), an
    approximation of a few steps around each hold."""
    n, m = len(t), signals.n_steps
    if m == n:
        return signals
    idx = _stretch_index(m, n)
    return SimSignals(cube_pos=signals.cube_pos[idx], contact_gripper_cube=signals.contact_gripper_cube[idx],
                      contact_arm_bin=signals.contact_arm_bin[idx], contact_arm_table=signals.contact_arm_table[idx],
                      max_contact_force=signals.max_contact_force[idx])


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


def episode_frames(ep_dir: Path, t: list[float]) -> tuple[list[tuple[float, bytes]], bytes | None, str]:
    """The front frames and wrist frame diagnose() should see from a recorded replay, captioned in the
    trajectory's time, and the episode's task text."""
    meta, arrays, images = load_episode(ep_dir)
    if FRONT not in meta.cameras:
        raise ValueError(f"replay episode {ep_dir} has no {FRONT} frames (cameras: {meta.cameras})")
    idx = _stretch_index(len(t), meta.n_steps)  # replay step -> trajectory step
    t_of_step = [float(t[i]) for i in idx]
    gripper = [int(g) for g in np.asarray(arrays["gripper"])]
    has_wrist = WRIST in meta.cameras and 1 in gripper
    frames, wrist = load_frames(ep_dir, meta, images, t_of_step, gripper, has_wrist)
    return frames, wrist, meta.task_text


class PipelineAbort(RuntimeError):
    """Raised by an injected step (e.g. a model-call budget) to fail the job; perfect_demo must not swallow it."""


def is_infrastructure(e: SimWorkerError) -> bool:
    """The worker could not do the job (down, hung, busy, refused the request), as opposed to a sim_error:
    the sim failing on this trajectory."""
    return e.error != "sim_error"


def check_worker(health: HealthResponse, robot: str | None, diagnoser: Diagnoser) -> tuple[int, str] | None:
    """Why this worker cannot perfect a demo for `robot` (None: any) with `diagnoser`, as (HTTP status,
    message); None if it can. A busy worker can: replays are retried."""
    if not health.ok:
        return 503, "the sim worker answers but reports ok=false; restart it"
    if robot is not None and robot not in health.robots:
        return 409, f"the sim worker runs {health.robots}, not {robot!r}; start one with --robot {robot}"
    if diagnoser in MODEL_DIAGNOSERS and not health.cameras:
        return 409, (f"diagnoser={diagnoser} needs camera frames, but the sim worker runs without cameras; "
                     "restart it with --cameras or use diagnoser=rules")
    return None


def replay_with_retry(client: SimWorkerClient, req: ReplayRequest, *, busy_retries: int, busy_wait_s: float,
                      sleep: Callable[[float], None]) -> ReplayResponse:
    for attempt in range(busy_retries + 1):
        try:
            return client.replay(req)
        except SimWorkerBusy:
            if attempt == busy_retries:
                raise
            log.info("sim worker busy; retrying %s in %.0f s", req.out_name, busy_wait_s)
            sleep(busy_wait_s)
    raise AssertionError("unreachable")


def _link_or_copy(src: str, dst: str) -> None:
    """Hard-link (same volume: no extra disk for camera frames), else copy."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def stamp_episode(ep_dir: Path, passport: Passport) -> None:
    """Put the Passport (and its demo id) into the episode's meta, so lerobot_tools.assemble can trace every
    episode to its human demo. episode.json is replaced, so a hard-linked source episode is untouched."""
    path = Path(ep_dir) / "episode.json"
    meta = EpisodeMeta.model_validate_json(path.read_text(encoding="utf-8"))
    write_atomic(path, meta.model_copy(update={"passport": passport, "demo_id": passport.demo_id})
                 .model_dump_json(indent=2))


def _copy_episode(ep_dir: str | None, dest: Path, notes: list[str], passport: Passport | None = None) -> bool:
    """Link the worker's episode into the store at `dest` (nothing to copy if it already is `dest`) and stamp
    the passport. False, with a note, when the episode is not on this disk."""
    if ep_dir is None or not Path(ep_dir).is_dir():
        notes.append(f"episode {ep_dir} is not on this disk; not copied to {dest}")
        return False
    if Path(ep_dir).resolve() != Path(dest).resolve():
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(ep_dir, dest, copy_function=_link_or_copy)
    if passport is not None:
        stamp_episode(dest, passport)
    return True


def human_passport(demo: Demo, verification: VerificationResult) -> Passport:
    return Passport(demo_id=demo.id, lineage=[demo.id], diagnosis_source="none", robot=demo.scene.robot,
                    verification=verification, pipeline_version=PIPELINE_VERSION)


def record_raw(store: DemoStore, client: SimWorkerClient, demo: Demo, *, record_cameras: bool,
               busy_retries: int = 60, busy_wait_s: float = 10.0,
               sleep: Callable[[float], None] = time.sleep) -> ReplayResponse:
    """Replay a stored human demo as recorded ("<id>_raw") into its store episode, with a human Passport (also
    saved as the demo's passport). The returned replay points at the store copy when there is one."""
    req = ReplayRequest(trajectory=demo.trajectory, scene=demo.scene, record_cameras=record_cameras,
                        out_name=f"{demo.id}_raw")
    resp = replay_with_retry(client, req, busy_retries=busy_retries, busy_wait_s=busy_wait_s, sleep=sleep)
    passport = human_passport(demo, resp.verification)
    store.save_passport(demo.id, passport)
    if _copy_episode(resp.ep_dir, store.episode_dir(demo.id), [], passport):
        resp = resp.model_copy(update={"ep_dir": str(store.episode_dir(demo.id))})
    return resp


def stored_raw(store: DemoStore, demo_id: str, *, need_cameras: bool) -> ReplayResponse | None:
    """The raw replay record_raw stored for this demo, rebuilt from its episode; None if there is none (or it
    has no front camera when one is needed)."""
    ep = store.episode_dir(demo_id)
    passport = store.get_passport(demo_id)
    signals = load_signals(ep) if (ep / "episode.json").is_file() else None
    if passport is None or signals is None:
        return None
    meta = EpisodeMeta.model_validate_json((ep / "episode.json").read_text(encoding="utf-8"))
    if need_cameras and FRONT not in meta.cameras:
        return None
    return ReplayResponse(verification=passport.verification, signals=SignalsPayload.from_signals(signals),
                          ep_dir=str(ep), n_steps=signals.n_steps, wall_s=0.0)


def variant_demo_id(parent_id: str, seed: int) -> str:
    return f"{parent_id}_m{seed:04d}"


def store_variants(store: DemoStore, parent_id: str, resp: MultiplyResponse) -> list[str]:
    """Store each successful variant as a "variant" demo of `parent_id`, with its episode and a Passport that
    inherits the parent's repairs and diagnosis source. Failed variants only count in the yield."""
    parent_pp = store.get_passport(parent_id)
    ids = []
    for v in resp.variants:
        if not v.verification.success:
            continue
        vid = variant_demo_id(parent_id, v.seed)
        store.save_demo(Demo(id=vid, source="variant", parent_id=parent_id, trajectory=v.trajectory,
                             scene=v.scene, human_seconds=0.0))
        passport = Passport(
            demo_id=vid, lineage=store.lineage(vid),
            repairs_applied=parent_pp.repairs_applied if parent_pp else [],
            diagnosis_source=parent_pp.diagnosis_source if parent_pp else "none",
            model_id=parent_pp.model_id if parent_pp else None, variant_seed=v.seed, robot=v.scene.robot,
            verification=v.verification, pipeline_version=PIPELINE_VERSION)
        store.save_passport(vid, passport)
        _copy_episode(v.ep_dir, store.episode_dir(vid), [], passport)
        ids.append(vid)
    return ids


def _replay_summary(req: ReplayRequest, resp: ReplayResponse) -> dict:
    return {"out_name": req.out_name, "ep_dir": resp.ep_dir, "success": resp.verification.success,
            "reasons": resp.verification.reasons, "n_steps": resp.n_steps, "wall_s": resp.wall_s}


# --- the perfect job -----------------------------------------------------------------------

def perfect_stored_demo(
    store: DemoStore,
    client: SimWorkerClient,
    demo_id: str,
    diagnoser: Diagnoser,
    *,
    raw: ReplayResponse | None = None,
    record_cameras: bool | None = None,
    busy_retries: int = 60,
    busy_wait_s: float = 10.0,
    sleep: Callable[[float], None] = time.sleep,
    diagnose: Callable[..., tuple[Diagnosis, list[str]]] | None = None,
    before_model_call: Callable[[], None] | None = None,
    retime_grasp: bool = False,
) -> dict:
    """Perfect one stored human demo; returns a JSON-able summary. `diagnose` replaces diagnose_gated (same
    arguments). `before_model_call` runs before each model call (nemotron or hybrid), e.g. a budget check; a
    PipelineAbort from either fails the job. retime_grasp: the rules also retime a swoop grasp
    (rules.detect_rules(retime_grasp=True); off by default, so earlier runs keep their rules). Raises
    SimWorkerError when the worker cannot do the job (see the module docstring), ValueError for a demo that is not
    human."""
    diagnose = diagnose or diagnose_gated
    demo = store.get_demo(demo_id)
    if demo.source != "human":
        raise ValueError(f"demo {demo_id!r} is {demo.source!r}; only human demos are perfected")
    cameras = (diagnoser in MODEL_DIAGNOSERS) if record_cameras is None else record_cameras
    notes: list[str] = []
    replays: list[dict] = []

    def replay(traj: Trajectory, out_name: str) -> ReplayResponse:
        req = ReplayRequest(trajectory=traj, scene=demo.scene, record_cameras=cameras, out_name=out_name)
        resp = replay_with_retry(client, req, busy_retries=busy_retries, busy_wait_s=busy_wait_s, sleep=sleep)
        replays.append(_replay_summary(req, resp))
        if resp.n_steps != len(traj.t):
            notes.append(f"replay {out_name} has {resp.n_steps} steps for {len(traj.t)} trajectory steps "
                         f"(gripper gate holds); signals and frames were stretched onto the trajectory")
        return resp

    if raw is None:
        raw = record_raw(store, client, demo, record_cameras=cameras, busy_retries=busy_retries,
                         busy_wait_s=busy_wait_s, sleep=sleep)
        replays.append(_replay_summary(ReplayRequest(trajectory=demo.trajectory, scene=demo.scene,
                                                     record_cameras=cameras, out_name=f"{demo_id}_raw"), raw))
    # ep_dir/success: the latest replay, i.e. of the trajectory perfect_demo diagnoses next
    # abort: an error that must fail the job; perfect_demo turns any step exception into a fallback or a discard
    # signals: the latest replay's, on the steps of the trajectory diagnosed next (hybrid's grasp offset)
    state: dict[str, Any] = {"ep_dir": raw.ep_dir, "success": raw.verification.success, "abort": None,
                             "signals": align_signals(raw.signals.to_signals(), demo.trajectory.t)}
    # One entry per perfect_demo round. perfect_demo returns only the last diagnosis, so diagnose_fn records each
    # round's refined repairs (refine_diagnosis is pure: the same call perfect_demo makes) and its real source.
    rounds: list[dict[str, Any]] = []

    def nemotron(d: Demo, windows: list[MetricsWindow], reasons: list[str]) -> tuple[Diagnosis, list[str]]:
        if state["ep_dir"] is None:
            raise ValueError("the replay saved no episode, so there are no frames to show the model")
        frames, wrist, task_text = episode_frames(Path(state["ep_dir"]), d.trajectory.t)
        if before_model_call is not None:
            before_model_call()
        if diagnoser == "hybrid":
            diag, gated = diagnose_hybrid(frames, wrist, windows, d.trajectory, task_text, state["success"],
                                          d.trajectory.t[-1], signals=state["signals"], failure_reasons=reasons)
        else:
            diag, gated = diagnose(frames, wrist, windows, task_text, state["success"], d.trajectory.t[-1],
                                   failure_reasons=reasons)
        diag.check_times(d.trajectory.t[-1])  # what perfect_demo checks; failing it means the rules, as there
        return diag, gated

    def diagnose_fn(d: Demo, windows: list[MetricsWindow], reasons: list[str]) -> Diagnosis:
        record: dict[str, Any] = {"source": "rules", "model_id": None, "gated": [], "reasons": list(reasons)}
        diag = None
        if diagnoser in MODEL_DIAGNOSERS:
            try:
                diag, record["gated"] = nemotron(d, windows, reasons)
                record.update(source=diagnoser, model_id=get_vision_model(DIAGNOSE_TIER).model_id)
            except PipelineAbort as e:
                state["abort"] = e
                raise
            except Exception as e:  # an invalid reply, an API error, no frames: this round uses the rules
                notes.append(f"round {len(rounds) + 1}: {diagnoser} failed ({type(e).__name__}: {e}); "
                             f"used the rules detector")
        if diag is None:
            # perfect_demo's first round has no reasons yet; the rules take the raw replay's verdict, which
            # state["signals"] come from (the model's first round stays as it always was)
            seen = reasons if rounds else list(raw.verification.reasons)
            diag = detect_rules(d.trajectory, windows, reasons=seen, signals=state["signals"], scene=d.scene,
                                retime_grasp=retime_grasp)
        refined = refine_diagnosis(diag, d.trajectory)
        record.update(decision=refined.decision, repairs=list(refined.repairs))
        rounds.append(record)
        return diag

    def verify_fn(traj: Trajectory, scene: Scene):
        k = sum(r["out_name"] != f"{demo_id}_raw" for r in replays) + 1
        try:
            resp = replay(traj, f"{output_demo_id(demo_id, diagnoser)}_v{k}")
        except SimWorkerError as e:
            if is_infrastructure(e):
                state["abort"] = e  # perfect_demo would call this a discard; the job must fail instead
            raise
        state["ep_dir"], state["success"] = resp.ep_dir, resp.verification.success
        state["signals"] = align_signals(resp.signals.to_signals(), traj.t)
        return resp.verification, state["signals"]

    result = perfect_demo(demo, state["signals"],
                          diagnose_fn=diagnose_fn, verify_fn=verify_fn, bin_rim_z=bin_rim_z(demo.scene))
    if state["abort"] is not None:
        raise state["abort"]
    notes = result.notes + notes

    # perfect_demo labels every diagnose_fn result "nemotron"; the rounds know which one really answered
    last = rounds[-1] if rounds else {"source": "none", "model_id": None, "gated": []}
    source, model_id, gated = last["source"], last["model_id"], last["gated"]
    if result.diagnosis is not None:
        store.save_diagnosis(demo_id, result.diagnosis, source, model_id, gated)
    # every round's repairs, in order: each round repaired the trajectory the previous one left
    applied = [op for r in rounds if r["decision"] == "repair" for op in r["repairs"]]

    out_id = None
    if result.status in ("perfected", "kept"):
        out_id = output_demo_id(demo_id, diagnoser)
        store.save_demo(Demo(id=out_id, source="repaired", parent_id=demo_id, trajectory=result.trajectory,
                             scene=demo.scene, human_seconds=0.0))
        store.save_diagnosis(out_id, result.diagnosis, source, model_id, gated)
        passport = Passport(
            demo_id=out_id, lineage=store.lineage(out_id),
            repairs_applied=applied if result.status == "perfected" else [],
            diagnosis_source=source, model_id=model_id, robot=demo.scene.robot,
            verification=result.verification, pipeline_version=PIPELINE_VERSION)
        store.save_passport(out_id, passport)
        _copy_episode(state["ep_dir"], store.episode_dir(out_id), notes, passport)  # the last, successful replay
    elif store.has_demo(output_demo_id(demo_id, diagnoser)):
        notes.append(f"an older output {output_demo_id(demo_id, diagnoser)!r} from an earlier run is still stored")

    return {
        "demo_id": demo_id,
        "diagnoser": diagnoser,
        "status": result.status,
        "output_demo_id": out_id,
        "diagnosis_source": source,
        "hybrid": source == "hybrid",  # kept for readers of sprint-4 results, which stored hybrid as "nemotron"
        "model_id": model_id,
        "gated": gated,
        "attempts": result.attempts,
        "decision": None if result.diagnosis is None else result.diagnosis.decision,
        "repairs": [] if result.diagnosis is None else [r.model_dump() for r in result.diagnosis.repairs],
        "issues": [] if result.diagnosis is None else [i.model_dump(exclude_none=True)
                                                       for i in result.diagnosis.issues],
        "verification": None if result.verification is None else result.verification.model_dump(),
        "raw_verification": raw.verification.model_dump(),
        "rounds": [{**r, "repairs": [op.model_dump() for op in r["repairs"]]} for r in rounds],
        "replays": replays,
        "notes": notes,
    }


# --- the alternative repairer: Nemotron's trajectory edits ------------------------------------------

EDITS_REPAIRER = "nemotron-edits"


def edits_output_id(demo_id: str) -> str:
    return f"{demo_id}_edits"


def perfect_stored_demo_edits(
    store: DemoStore,
    client: SimWorkerClient,
    demo_id: str,
    *,
    raw: ReplayResponse | None = None,
    record_cameras: bool = True,
    busy_retries: int = 60,
    busy_wait_s: float = 10.0,
    sleep: Callable[[float], None] = time.sleep,
    repair: Callable[..., RepairResult] | None = None,
    before_model_call: Callable[[], None] | None = None,
) -> dict:
    """perfect_stored_demo's alternative: Nemotron edits the trajectory (app.ai.nemotron_repair) and each edit is
    verified by the worker's /replay ("<id>_edits_v<k>"), i.e. Isaac and the unchanged check_success. A raw replay
    that already passes is kept, without a model call. A verified edit becomes the demo "<id>_edits" (source
    "repaired") with its Passport (repairs_applied stays []: the edits are not menu ops) and edit_plan.json; the
    human demo gets edit_repair.json either way. `repair` replaces repair_with_nemotron (same arguments). Raises
    SimWorkerError when the worker cannot do the job; a sim_error on an edited demo discards it."""
    repair = repair or repair_with_nemotron
    demo = store.get_demo(demo_id)
    if demo.source != "human":
        raise ValueError(f"demo {demo_id!r} is {demo.source!r}; only human demos are perfected")
    out_id = edits_output_id(demo_id)
    notes: list[str] = []
    replays: list[dict] = []
    if raw is None:
        raw = record_raw(store, client, demo, record_cameras=record_cameras, busy_retries=busy_retries,
                         busy_wait_s=busy_wait_s, sleep=sleep)
        replays.append(_replay_summary(ReplayRequest(trajectory=demo.trajectory, scene=demo.scene,
                                                     record_cameras=record_cameras, out_name=f"{demo_id}_raw"), raw))
    state: dict[str, Any] = {"ep_dir": raw.ep_dir}

    def verify(traj: Trajectory) -> tuple[VerificationResult, SimSignals]:
        req = ReplayRequest(trajectory=traj, scene=demo.scene, record_cameras=record_cameras,
                            out_name=f"{out_id}_v{sum(r['out_name'] != f'{demo_id}_raw' for r in replays) + 1}")
        resp = replay_with_retry(client, req, busy_retries=busy_retries, busy_wait_s=busy_wait_s, sleep=sleep)
        replays.append(_replay_summary(req, resp))
        state["ep_dir"] = resp.ep_dir
        return resp.verification, align_signals(resp.signals.to_signals(), traj.t)

    result: RepairResult | None = None
    if raw.verification.success:
        status, traj, verification = "kept", demo.trajectory, raw.verification
    else:
        try:
            result = repair(demo, raw.verification, align_signals(raw.signals.to_signals(), demo.trajectory.t),
                            verify, before_call=before_model_call)
        except SimWorkerError as e:
            if is_infrastructure(e):
                raise
            notes.append(f"the sim failed on an edited demo ({e}); discarded")
        if result is not None and result.status == "repaired":
            status, traj, verification = "perfected", result.trajectory, result.verification
        else:
            status, traj = "discarded", None
            verification = None if result is None else result.verification
            if result is not None:
                notes.append(f"Nemotron's edits: {result.status} after {result.calls} call(s)")
    summary_extra = {} if result is None else result.summary()
    write_atomic(store.root / "demos" / demo_id / "edit_repair.json",
                 json.dumps({"repairer": EDITS_REPAIRER, **summary_extra, "edits_status": summary_extra.get("status"),
                            "status": status}, indent=1, default=str))

    if traj is not None:
        store.save_demo(Demo(id=out_id, source="repaired", parent_id=demo_id, trajectory=traj, scene=demo.scene,
                             human_seconds=0.0))
        passport = Passport(demo_id=out_id, lineage=store.lineage(out_id), repairs_applied=[],
                            diagnosis_source="none" if result is None else "nemotron",
                            model_id=None if result is None else result.model, robot=demo.scene.robot,
                            verification=verification, pipeline_version=PIPELINE_VERSION)
        store.save_passport(out_id, passport)
        write_atomic(store.root / "demos" / out_id / "edit_plan.json",
                     json.dumps({"parent": demo_id, **summary_extra}, indent=1, default=str))
        _copy_episode(state["ep_dir"], store.episode_dir(out_id), notes, passport)  # the last, successful replay
    elif store.has_demo(out_id):
        notes.append(f"an older output {out_id!r} from an earlier run is still stored")

    edits = [] if result is None or result.plan is None or status != "perfected" else result.plan.edits
    return {
        "demo_id": demo_id,
        "diagnoser": EDITS_REPAIRER,
        "status": status,
        "output_demo_id": out_id if traj is not None else None,
        "diagnosis_source": "none" if result is None else "nemotron",
        "model_id": None if result is None else result.model,
        "attempts": sum(r["out_name"] != f"{demo_id}_raw" for r in replays),
        "repairs": [e.model_dump() for e in edits],
        "report": None if result is None or result.report is None else result.report.model_dump(),
        "why": None if result is None or result.plan is None else result.plan.why,
        "calls": 0 if result is None else result.calls,
        "rescues": [] if result is None else list(result.rescues),
        "cost_usd": 0.0 if result is None else round(result.cost_usd, 5),
        "verification": None if verification is None else verification.model_dump(),
        "raw_verification": raw.verification.model_dump(),
        "rounds": [] if result is None else summary_extra["rounds"],
        "replays": replays,
        "notes": notes,
    }


# --- the hybrid repairer: the rules first, Nemotron's edits for what they discard -------------------

HYBRID_REPAIRER = "hybrid"
PASSED = ("perfected", "kept")


def perfect_stored_demo_hybrid(
    store: DemoStore,
    client: SimWorkerClient,
    demo_id: str,
    *,
    raw: ReplayResponse | None = None,
    record_cameras: bool = True,
    busy_retries: int = 60,
    busy_wait_s: float = 10.0,
    sleep: Callable[[float], None] = time.sleep,
    repair: Callable[..., RepairResult] | None = None,
    before_model_call: Callable[[], None] | None = None,
    retime_grasp: bool = False,
) -> dict:
    """The product candidate: perfect_stored_demo(..., "rules") first (retime_grasp: as there); only if the rules discard the demo,
    perfect_stored_demo_edits on the same raw replay. The edits stay blind: their prompt comes from the raw replay
    alone, never from the rules' diagnosis or attempts (so never from release_above_bin). The output is the
    winning stage's demo ("<id>_rules" or "<id>_edits"); the summary keeps both stages'."""
    retry = {"busy_retries": busy_retries, "busy_wait_s": busy_wait_s, "sleep": sleep}
    if raw is None:
        raw = record_raw(store, client, store.get_demo(demo_id), record_cameras=record_cameras, **retry)
    rules = perfect_stored_demo(store, client, demo_id, "rules", raw=raw, record_cameras=record_cameras,
                                retime_grasp=retime_grasp, **retry)
    edits = None
    if rules["status"] not in PASSED:
        edits = perfect_stored_demo_edits(store, client, demo_id, raw=raw, record_cameras=record_cameras,
                                          repair=repair, before_model_call=before_model_call, **retry)
    stage, winner = next(((s, out) for s, out in (("rules", rules), (EDITS_REPAIRER, edits))
                          if out is not None and out["status"] in PASSED), (None, None))
    last = edits or rules
    return {
        "demo_id": demo_id,
        "diagnoser": HYBRID_REPAIRER,
        "status": "discarded" if winner is None else winner["status"],
        "stage": stage,  # which stage's output is kept; None when both discarded
        "output_demo_id": None if winner is None else winner["output_demo_id"],
        "attempts": rules["attempts"] + (0 if edits is None else edits["attempts"]),
        "repairs": [] if winner is None else winner["repairs"],
        "diagnosis_source": None if winner is None else winner["diagnosis_source"],
        "model_id": None if edits is None else edits["model_id"],
        "calls": 0 if edits is None else edits["calls"],
        "cost_usd": 0.0 if edits is None else edits["cost_usd"],
        "rescues": [] if edits is None else edits["rescues"],
        "verification": (winner or last)["verification"],
        "raw_verification": raw.verification.model_dump(),
        "rules": rules,
        EDITS_REPAIRER: edits,
        "notes": rules["notes"] + ([] if edits is None else edits["notes"]),
    }
