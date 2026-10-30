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

from demo_pipeline.data_fixes import apply_fixes
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
# recover(exc) -> True when the sim is usable again (e.g. the GPU answers after a Windows sleep): retry once.
RecoverFn = Callable[[BaseException], bool]

_DONE = "verification.json"


class WrongRobot(ValueError):
    """The request names a robot this worker's sim session was not built for."""


def episodes_dir(root: Path) -> Path:
    return Path(root) / "episodes"


def variant_name(prefix: str, seed: int) -> str:
    return f"{prefix}_{seed:04d}"


def multiply_seeds(req: MultiplyRequest) -> list[int]:
    if req.scenes is not None:
        return [s.seed for s in req.scenes]
    return list(range(req.seed0, req.seed0 + req.n))


def multiply_scenes(req: MultiplyRequest) -> list[Scene]:
    """The given scenes, else sample_scene for each seed (the scenes multiply has always used)."""
    if req.scenes is not None:
        return list(req.scenes)
    return [sample_scene(np.random.default_rng(seed), req.robot, seed) for seed in multiply_seeds(req)]


def _check(robot: str, record_cameras: bool, worker_robot: str, worker_cameras: bool) -> None:
    if robot != worker_robot:
        raise WrongRobot(f"this sim worker runs {worker_robot!r}, not {robot!r} (one robot per Isaac process)")
    if record_cameras and not worker_cameras:
        raise ValueError("record_cameras=true, but this sim worker was started without --cameras")


def _write_done(ep: Path, scene: Scene, traj: Trajectory, result: VerificationResult) -> None:
    (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
    (ep / "trajectory.json").write_text(traj.model_dump_json(), encoding="utf-8")
    (ep / _DONE).write_text(result.model_dump_json(indent=1), encoding="utf-8")


def _replay_once_more(replay_fn: ReplayFn, recover: RecoverFn | None, traj: Trajectory, scene: Scene,
                      ep: Path | None, record_cameras: bool, log: Callable[[str], None]):
    """replay_fn; if it raises and recover() says the sim is back, start the folder afresh and try once more."""
    try:
        return replay_fn(traj, scene, ep, record_cameras)
    except Exception as exc:
        if recover is None or not recover(exc):
            raise
        log(f"[jobs] recovered after {exc!r}; retrying {'(no folder)' if ep is None else ep.name} once")
        if ep is not None and ep.exists():
            shutil.rmtree(ep)
        return replay_fn(traj, scene, ep, record_cameras)


def run_replay(req: ReplayRequest, replay_fn: ReplayFn, *, root: Path, worker_robot: str,
               worker_cameras: bool, recover: RecoverFn | None = None,
               log: Callable[[str], None] = print) -> ReplayResponse:
    _check(req.scene.robot, req.record_cameras, worker_robot, worker_cameras)
    t0 = time.time()
    ep = (episodes_dir(root) / req.out_name).resolve() if req.save_episode else None
    if ep is not None and ep.exists():
        shutil.rmtree(ep)  # a replay request always records afresh
    result, signals, executed = _replay_once_more(replay_fn, recover, req.trajectory, req.scene, ep,
                                                  req.record_cameras, log)
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
                 worker_cameras: bool, recover: RecoverFn | None = None,
                 log: Callable[[str], None] = print) -> MultiplyResponse:
    _check(req.robot, req.record_cameras, worker_robot, worker_cameras)
    t0 = time.time()
    variants = []
    for scene in multiply_scenes(req):
        seed = scene.seed
        traj, fixes, kept = apply_fixes(transform_trajectory(req.trajectory, req.scene, scene), scene, req.fixes)
        ep = (episodes_dir(root) / variant_name(req.out_prefix, seed)).resolve()
        stored = _stored_variant(ep, scene)
        if not kept:  # a filter dropped it: never replayed, never trained on
            log(f"[multiply] seed {seed}: filtered ({fixes})")
            variants.append(MultiplyVariant(seed=seed, scene=scene, trajectory=traj, ep_dir=None, fixes=fixes,
                                            verification=_sim_error(traj).model_copy(update={"reasons": ["filtered"]})))
            continue
        if stored is not None:
            executed, result = stored
            log(f"[multiply] seed {seed}: reused {ep.name} (success={result.success})")
        else:
            if ep.exists():
                shutil.rmtree(ep)
            try:
                result, _signals, executed = _replay_once_more(replay_fn, recover, traj, scene, ep,
                                                               req.record_cameras, log)
                _write_done(ep, scene, executed, result)
            except Exception as exc:  # one broken variant is a recorded failure, not a failed request
                log(f"[multiply] seed {seed}: sim_error {exc!r}\n{traceback.format_exc()}")
                executed, result = traj, _sim_error(traj)
            log(f"[multiply] seed {seed}: success={result.success} reasons={result.reasons}")
        variants.append(MultiplyVariant(seed=seed, scene=scene, trajectory=executed, verification=result,
                                        ep_dir=str(ep) if ep.exists() else None, fixes=fixes))
    return MultiplyResponse(attempts=len(variants), successes=sum(v.verification.success for v in variants),
                            variants=variants, wall_s=time.time() - t0)
