"""Sim-worker jobs (contract: demo_pipeline.sim_protocol), pure: the replay itself is injected.

replay_fn(trajectory, scene, ep_dir: Path | None, record_cameras) -> (VerificationResult, SimSignals, executed
Trajectory). The executed trajectory can be longer than the input (gripper gating), and the signals follow it.

Episodes go to <root>/episodes/<out_name>/. A multiply variant goes to <root>/episodes/<out_prefix>_<seed:04d>/ with
scene.json, trajectory.json and verification.json (written last: the "done" marker), so a multiply interrupted
(e.g. by Windows sleep) resumes by seed: a variant whose folder is complete for the same scene is reused, not replayed.
"""

from __future__ import annotations

import shutil
import time
import traceback
from pathlib import Path
from typing import Callable

import numpy as np

from demo_pipeline.multiply import sample_scene, transform_trajectory
from demo_pipeline.schemas import Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.sim_protocol import (
    MultiplyRequest,
    MultiplyResponse,
    MultiplyVariant,
    ReplayRequest,
    ReplayResponse,
    SignalsPayload,
)

ReplayFn = Callable[[Trajectory, Scene, Path | None, bool], tuple[VerificationResult, SimSignals, Trajectory]]

_DONE = "verification.json"


class WrongRobot(ValueError):
    """The request names a robot this worker's sim session was not built for."""


def episodes_dir(root: Path) -> Path:
    return Path(root) / "episodes"


def variant_name(prefix: str, seed: int) -> str:
    return f"{prefix}_{seed:04d}"


def multiply_seeds(req: MultiplyRequest) -> list[int]:
    return list(range(req.seed0, req.seed0 + req.n))


def _check(robot: str, record_cameras: bool, worker_robot: str, worker_cameras: bool) -> None:
    if robot != worker_robot:
        raise WrongRobot(f"this sim worker runs {worker_robot!r}, not {robot!r} (one robot per Isaac process)")
    if record_cameras and not worker_cameras:
        raise ValueError("record_cameras=true, but this sim worker was started without --cameras")


def _write_done(ep: Path, scene: Scene, traj: Trajectory, result: VerificationResult) -> None:
    (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
    (ep / "trajectory.json").write_text(traj.model_dump_json(), encoding="utf-8")
    (ep / _DONE).write_text(result.model_dump_json(indent=1), encoding="utf-8")


def run_replay(req: ReplayRequest, replay_fn: ReplayFn, *, root: Path, worker_robot: str,
               worker_cameras: bool) -> ReplayResponse:
    _check(req.scene.robot, req.record_cameras, worker_robot, worker_cameras)
    t0 = time.time()
    ep = (episodes_dir(root) / req.out_name).resolve() if req.save_episode else None
    if ep is not None and ep.exists():
        shutil.rmtree(ep)  # a replay request always records afresh
    result, signals, executed = replay_fn(req.trajectory, req.scene, ep, req.record_cameras)
    if ep is not None:
        _write_done(ep, req.scene, executed, result)
    return ReplayResponse(verification=result, signals=SignalsPayload.from_signals(signals),
                          ep_dir=None if ep is None else str(ep), n_steps=signals.n_steps, wall_s=time.time() - t0)


def _stored_variant(ep: Path, scene: Scene) -> tuple[Trajectory, VerificationResult] | None:
    """A complete variant folder recorded for exactly this scene, else None."""
    try:
        if not (ep / _DONE).exists() or Scene.model_validate_json((ep / "scene.json").read_text("utf-8")) != scene:
            return None
        return (Trajectory.model_validate_json((ep / "trajectory.json").read_text("utf-8")),
                VerificationResult.model_validate_json((ep / _DONE).read_text("utf-8")))
    except (OSError, ValueError):
        return None


def _sim_error(traj: Trajectory) -> VerificationResult:
    return VerificationResult(success=False, reasons=["sim_error"], duration=traj.duration, path_length=0.0,
                              max_contact_force=0.0, settle_time=None)


def run_multiply(req: MultiplyRequest, replay_fn: ReplayFn, *, root: Path, worker_robot: str,
                 worker_cameras: bool, log: Callable[[str], None] = print) -> MultiplyResponse:
    _check(req.robot, req.record_cameras, worker_robot, worker_cameras)
    t0 = time.time()
    variants = []
    for seed in multiply_seeds(req):
        scene = sample_scene(np.random.default_rng(seed), req.robot, seed)
        traj = transform_trajectory(req.trajectory, req.scene, scene)
        ep = (episodes_dir(root) / variant_name(req.out_prefix, seed)).resolve()
        stored = _stored_variant(ep, scene)
        if stored is not None:
            executed, result = stored
            log(f"[multiply] seed {seed}: reused {ep.name} (success={result.success})")
        else:
            if ep.exists():
                shutil.rmtree(ep)
            try:
                result, _signals, executed = replay_fn(traj, scene, ep, req.record_cameras)
                _write_done(ep, scene, executed, result)
            except Exception as exc:  # one broken variant is a recorded failure, not a failed request
                log(f"[multiply] seed {seed}: sim_error {exc!r}\n{traceback.format_exc()}")
                executed, result = traj, _sim_error(traj)
            log(f"[multiply] seed {seed}: success={result.success} reasons={result.reasons}")
        variants.append(MultiplyVariant(seed=seed, scene=scene, trajectory=executed, verification=result,
                                        ep_dir=str(ep) if ep.exists() else None))
    return MultiplyResponse(attempts=len(variants), successes=sum(v.verification.success for v in variants),
                            variants=variants, wall_s=time.time() - t0)
