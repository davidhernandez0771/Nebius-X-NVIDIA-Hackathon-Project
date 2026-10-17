"""The N-env eval loop: run_episode's rules, with N envs stepped together in one simulator.

Each env slot runs one episode at a time with its own policy session (ACT keeps an action queue, so sessions cannot
be shared). When an episode ends, its slot is reset with the next scene while the other envs carry on, so no env
idles until the scenes run out.

Per global control step (50 Hz):
  1. fill free slots: env.reset_envs({slot: scene}) places the scene, then that slot's policy is reset;
  2. observe all envs once;
  3. query the running slots' policies concurrently (`act_map`), each with its own env's observation;
  4. step all envs at once: running slots get their policy action, warming-up slots hold their start pose (the
     serial env holds it for CAMERA_WARMUP_STEPS inside reset), finished/idle slots hold their last target;
  5. score each running episode every `check_every` of its own steps, exactly as run_episode does.

Scoring reuses sim_eval.eval_policy's own scorer and action check, so a parallel episode is judged by the same code
as a serial one. Failures follow run_episode: a policy error ends only that slot's episode; a simulator exception
(reset, observe or step) ends every live episode with sim_error, and the loop carries on with the next scenes.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from demo_pipeline.schemas import Scene
from sim_eval.eval_policy import (  # the serial loop's scorer and action check: one definition of an episode
    CHECK_EVERY,
    FPS,
    MAX_SECONDS,
    Observation,
    Policy,
    StepRecord,
    _check_action,
    _score,
)
from sim_eval.results import EpisodeResult, EvalSummary, aggregate

WARMUP_STEPS = 5  # sim_worker.replay.CAMERA_WARMUP_STEPS, which IsaacEvalEnv.reset holds the start pose for


class VecEvalEnv(Protocol):
    num_envs: int
    cameras: list[str]
    bin_inner: tuple[float, float, float]

    def reset_envs(self, scenes: dict[int, Scene]) -> dict[int, np.ndarray]:
        """Place these scenes in these env slots (no stepping). Returns each slot's start joint targets."""
        ...

    def observe(self) -> list[Observation]: ...
    def step(self, actions: np.ndarray) -> list[StepRecord | None]: ...  # actions (num_envs, 9)


ActMap = Callable[[Callable[[int], object], list[int]], list]


@dataclass
class _Slot:
    index: int  # scene index in the run
    scene: Scene
    policy: Policy
    warmup_left: int
    t0: float = field(default_factory=time.perf_counter)
    records: list[StepRecord] = field(default_factory=list)


def _result(slot: _Slot, ended_by: str, reasons: list[str], fps: int, error: Exception | None = None) -> EpisodeResult:
    r = slot.records
    return EpisodeResult(
        seed=slot.scene.seed, success=ended_by == "success", reasons=reasons, ended_by=ended_by, steps=len(r),
        sim_s=(len(r) - 1) / fps if r else 0.0, wall_s=time.perf_counter() - slot.t0,
        error=f"{type(error).__name__}: {error}" if error else None,
        final_cube_pos=[float(x) for x in r[-1].cube_pos] if r else None,
    )


def threaded_act_map(workers: int) -> tuple[ActMap, ThreadPoolExecutor]:
    """Query several policy servers at once (each call is mostly waiting on HTTP / the GPU)."""
    pool = ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="policy")
    return (lambda fn, items: list(pool.map(fn, items))), pool


def _serial_map(fn, items):
    return [fn(i) for i in items]


def evaluate_parallel(env: VecEvalEnv, policies: list[Policy], scenes: Iterable[Scene], *,
                      on_episode: Callable[[int, EpisodeResult], None] | None = None,
                      act_map: ActMap | None = None, fps: int = FPS, max_seconds: float = MAX_SECONDS,
                      check_every: int = CHECK_EVERY, warmup_steps: int = WARMUP_STEPS
                      ) -> tuple[list[EpisodeResult], EvalSummary]:
    """Evaluate every scene on env's N slots. policies[i] serves slot i. Returns the episodes in scene order.
    on_episode(scene index, result) is called as each episode ends (completion order, not scene order)."""
    scenes = list(scenes)
    n = env.num_envs
    if len(policies) != n:
        raise ValueError(f"{len(policies)} policies for {n} envs: each env needs its own policy session")
    max_steps = int(round(max_seconds * fps))
    if max_steps < 2:
        raise ValueError(f"max_seconds={max_seconds} gives {max_steps} steps; check_success needs at least 2")
    act_map = act_map or _serial_map
    queue = deque(enumerate(scenes))
    slots: list[_Slot | None] = [None] * n
    hold = np.zeros((n, 9))  # what each env is commanded when it is not running a policy step
    results: dict[int, EpisodeResult] = {}

    def finish(i: int, ended_by: str, reasons: list[str], error: Exception | None = None) -> None:
        slot = slots[i]
        slots[i] = None
        ep = _result(slot, ended_by, reasons, fps, error)
        results[slot.index] = ep
        if on_episode is not None:
            on_episode(slot.index, ep)

    def fill() -> None:
        while queue and None in slots:
            free = [i for i in range(n) if slots[i] is None][: len(queue)]
            batch = {i: queue.popleft() for i in free}
            for i, (idx, scene) in batch.items():
                slots[i] = _Slot(idx, scene, policies[i], warmup_steps)
            try:
                starts = env.reset_envs({i: scene for i, (_, scene) in batch.items()})
            except Exception as e:
                for i in batch:
                    finish(i, "sim_error", ["sim_error"], e)
                continue
            for i in batch:
                hold[i] = np.asarray(starts[i], dtype=np.float64).reshape(9)
                try:
                    slots[i].policy.reset()
                except Exception as e:
                    finish(i, "policy_error", ["policy_error"], e)

    def live() -> list[int]:
        return [i for i in range(n) if slots[i] is not None]

    while True:
        fill()
        if not live():
            break
        try:
            obs = env.observe()
        except Exception as e:
            for i in live():
                finish(i, "sim_error", ["sim_error"], e)
            continue
        running = [i for i in live() if slots[i].warmup_left == 0]

        def act(i: int):
            try:
                return _check_action(slots[i].policy.act(obs[i].joint_pos, obs[i].images))
            except Exception as e:  # server down, 4xx/5xx, malformed action
                return e

        actions = hold.copy()
        stepped = []
        for i, a in zip(running, act_map(act, running)):
            if isinstance(a, Exception):
                finish(i, "policy_error", ["policy_error"], a)
            else:
                actions[i] = hold[i] = a
                stepped.append(i)
        try:
            records = env.step(actions)
        except Exception as e:
            for i in live():
                finish(i, "sim_error", ["sim_error"], e)
            continue
        for i in live():
            slot = slots[i]
            if i not in stepped:
                slot.warmup_left -= 1
                continue
            slot.records.append(records[i])
            k = len(slot.records)
            if k % check_every == 0 or k == max_steps:
                verdict = _score(slot.records, slot.scene, env.bin_inner, fps)
                if verdict.success:
                    finish(i, "success", [])
                elif k == max_steps:
                    finish(i, "time_limit", list(verdict.reasons))

    episodes = [results[i] for i in range(len(scenes))]
    return episodes, aggregate(episodes)
