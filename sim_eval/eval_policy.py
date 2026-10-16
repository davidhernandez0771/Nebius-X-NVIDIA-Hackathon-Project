"""The evaluation control loop: run a policy on a scene until it succeeds or 30 s run out, then score it.

Each control step (50 Hz): observe joint_pos + camera images -> policy.act() -> apply the 9-joint target -> record
the TCP pose, cube position and contacts. Every `check_every` steps (0.5 s) the episode so far is scored with
demo_pipeline.success.check_success, and the episode stops at the first pass. A policy or simulator failure ends
the episode with ended_by "policy_error" / "sim_error"; it is recorded, never raised.

The env is injected (see EvalEnv); sim_eval.isaac_env.IsaacEvalEnv is the Isaac Lab one. This module imports no
Isaac code, so the loop is tested with fakes in the SANT venv.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from demo_pipeline.schemas import Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.success import check_success
from sim_eval.results import EpisodeResult, EvalSummary, aggregate

FPS = 50
MAX_SECONDS = 30.0
CHECK_EVERY = 25  # control steps between success checks (0.5 s)
ACTION_DIM = 9
# Franka joint order in Isaac Lab (and so in our recorded joint_pos/action): panda_joint1..7, then the two fingers.
FINGER_IDS = (7, 8)
GRIPPER_OPEN, GRIPPER_CLOSED = 0.04, 0.0  # finger joint targets (m), as in sim_worker.replay


@dataclass
class Observation:
    joint_pos: np.ndarray  # (9,)
    images: dict[str, np.ndarray]  # camera -> HxWx3 uint8


@dataclass
class StepRecord:
    """What happened during one control step, as replay() records it."""

    tcp_pos: np.ndarray  # (3,) world, fingertip center
    tcp_quat_wxyz: np.ndarray  # (4,)
    cube_pos: np.ndarray  # (3,) world
    gripper: int  # 0 open / 1 closed, as commanded this step
    contact_gripper_cube: bool
    contact_arm_bin: bool
    contact_arm_table: bool
    max_contact_force: float


class EvalEnv(Protocol):
    cameras: list[str]
    bin_inner: tuple[float, float, float]

    def reset(self, scene: Scene) -> None: ...
    def observe(self) -> Observation: ...
    def step(self, action: np.ndarray) -> StepRecord: ...


class Policy(Protocol):  # lerobot_tools.policy_client.PolicyClient fits
    def reset(self) -> None: ...
    def act(self, state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray: ...


def gripper_command(action: np.ndarray) -> int:
    """1 (closed) if the commanded finger targets are nearer closed than open."""
    fingers = float(np.mean(np.asarray(action)[list(FINGER_IDS)]))
    return int(fingers < (GRIPPER_OPEN + GRIPPER_CLOSED) / 2)


def _score(records: list[StepRecord], scene: Scene, bin_inner, fps: int) -> VerificationResult:
    quats = np.array([r.tcp_quat_wxyz for r in records], dtype=np.float64)
    quats /= np.linalg.norm(quats, axis=1, keepdims=True)
    traj = Trajectory.from_arrays(
        t=np.arange(len(records)) / fps,
        ee_pos=np.array([r.tcp_pos for r in records], dtype=np.float64),
        ee_quat=quats,
        gripper=np.array([r.gripper for r in records], dtype=np.int8),
    )
    signals = SimSignals(
        cube_pos=np.array([r.cube_pos for r in records], dtype=np.float64),
        contact_gripper_cube=np.array([r.contact_gripper_cube for r in records], dtype=bool),
        contact_arm_bin=np.array([r.contact_arm_bin for r in records], dtype=bool),
        contact_arm_table=np.array([r.contact_arm_table for r in records], dtype=bool),
        max_contact_force=np.array([r.max_contact_force for r in records], dtype=np.float64),
    )
    return check_success(traj, signals, scene.bin_pose, bin_inner=bin_inner)


def _check_action(action) -> np.ndarray:
    a = np.asarray(action, dtype=np.float64)
    if a.size != ACTION_DIM or a.squeeze().shape != (ACTION_DIM,):
        raise ValueError(f"policy returned shape {a.shape}, expected ({ACTION_DIM},)")
    a = a.reshape(ACTION_DIM)
    if not np.isfinite(a).all():
        raise ValueError(f"policy returned a non-finite action {a.tolist()}")
    return a


def run_episode(env: EvalEnv, policy: Policy, scene: Scene, *, fps: int = FPS, max_seconds: float = MAX_SECONDS,
                check_every: int = CHECK_EVERY) -> EpisodeResult:
    max_steps = int(round(max_seconds * fps))
    if max_steps < 2:
        raise ValueError(f"max_seconds={max_seconds} gives {max_steps} steps; check_success needs at least 2")
    t0 = time.perf_counter()
    records: list[StepRecord] = []

    def done(ended_by: str, reasons: list[str], error: Exception | None = None) -> EpisodeResult:
        return EpisodeResult(
            seed=scene.seed, success=ended_by == "success", reasons=reasons, ended_by=ended_by, steps=len(records),
            sim_s=(len(records) - 1) / fps if records else 0.0, wall_s=time.perf_counter() - t0,
            error=f"{type(error).__name__}: {error}" if error else None,
            final_cube_pos=[float(x) for x in records[-1].cube_pos] if records else None,
        )

    # Exceptions end the episode with a recorded outcome: one bad episode must not lose the other 49.
    try:
        env.reset(scene)
    except Exception as e:
        return done("sim_error", ["sim_error"], e)
    try:
        policy.reset()
    except Exception as e:
        return done("policy_error", ["policy_error"], e)

    for k in range(max_steps):
        try:
            obs = env.observe()
        except Exception as e:
            return done("sim_error", ["sim_error"], e)
        try:
            action = _check_action(policy.act(obs.joint_pos, obs.images))
        except Exception as e:  # server down, 4xx/5xx, malformed action
            return done("policy_error", ["policy_error"], e)
        try:
            records.append(env.step(action))
        except Exception as e:
            return done("sim_error", ["sim_error"], e)
        last = k + 1 == max_steps
        if (k + 1) % check_every == 0 or last:
            verdict = _score(records, scene, env.bin_inner, fps) if len(records) >= 2 else None
            if verdict is not None and verdict.success:
                return done("success", [])
    return done("time_limit", list(verdict.reasons))


def evaluate(env: EvalEnv, policy: Policy, scenes: list[Scene], *,
             on_episode: Callable[[int, EpisodeResult], None] | None = None,
             **episode_kwargs) -> tuple[list[EpisodeResult], EvalSummary]:
    episodes = []
    for i, scene in enumerate(scenes):
        ep = run_episode(env, policy, scene, **episode_kwargs)
        episodes.append(ep)
        if on_episode is not None:
            on_episode(i, ep)
    return episodes, aggregate(episodes)
