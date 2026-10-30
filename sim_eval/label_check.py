"""Can the policy's executor carry out its own training labels? Pure parts (numpy); the Isaac run is
sim_eval/scripts/check_label_execution.py.

The hypothesis (2026-10-22 research report): a SANT episode is verified by sim_worker.replay, which re-solves IK at
each physics substep and adds a joint-velocity feed-forward (TrackingOptions.vel_ff, "26.8 -> 2.1 mm mean TCP
error"). The exported label is only the last substep's 9-joint position target. The eval env (sim_eval.isaac_env)
holds that target for both substeps with no velocity target. The RL teacher hit exactly this: its labels replayed
10/10 with tracking and 0/10 held (distill prereg, 2026-10-21). This checks the SANT training data the same way:
feed an episode's recorded labels, open loop, to the eval env from the episode's own start pose and scene, and score
it with the eval's own check_success. A label set that passed verification but fails here can't be imitated, however
good the policy.

Reported per episode: success and reasons under the eval's execution, and how far the fingertips end up from where
the verified replay put them (mean / max / at the first close, mm).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from pydantic import BaseModel, ConfigDict

from demo_pipeline.schemas import Scene
from demo_pipeline.stats import wilson_ci

FPS = 50
TAIL_S = 2.0  # seconds of the last label held after the labels run out, so the cube can settle for check_success


@dataclass
class LabelEpisode:
    name: str
    scene: Scene
    start_q: np.ndarray  # (9,) joint positions at the first step
    actions: np.ndarray  # (T, 9) the training labels
    ee_pos: np.ndarray  # (T, 3) where the verified replay put the fingertips
    gripper: np.ndarray  # (T,) 0/1


def load_label_episode(ep_dir: Path) -> LabelEpisode:
    """An episode folder as replay writes it: scene.json and steps.npz (joint_pos, action, ee_pos, gripper)."""
    ep_dir = Path(ep_dir)
    scene = Scene.model_validate_json((ep_dir / "scene.json").read_text(encoding="utf-8"))
    with np.load(ep_dir / "steps.npz") as z:
        missing = [k for k in ("joint_pos", "action", "ee_pos", "gripper") if k not in z.files]
        if missing:
            raise ValueError(f"{ep_dir}: steps.npz has no {', '.join(missing)}")
        q, a, ee, g = (np.asarray(z[k]) for k in ("joint_pos", "action", "ee_pos", "gripper"))
    if not (len(q) == len(a) == len(ee) == len(g)) or len(a) < 2:
        raise ValueError(f"{ep_dir}: steps.npz fields disagree in length or have under 2 steps")
    return LabelEpisode(ep_dir.name, scene, q[0].astype(np.float64), a.astype(np.float64), ee.astype(np.float64),
                        g.astype(np.int8))


class LabelPolicy:
    """Plays the recorded labels in order, then holds the last one (fits sim_eval.eval_policy.Policy)."""

    def __init__(self, actions: np.ndarray):
        self.actions = np.asarray(actions, dtype=np.float64)
        self.k = 0

    def reset(self) -> None:
        self.k = 0

    def act(self, state, images) -> np.ndarray:
        a = self.actions[min(self.k, len(self.actions) - 1)]
        self.k += 1
        return a


class TcpRecorder:
    """An EvalEnv wrapper that keeps each step's fingertip position in memory."""

    def __init__(self, env):
        self.env = env
        self.tcp: list[np.ndarray] = []

    def __getattr__(self, name):
        if name == "env":
            raise AttributeError(name)
        return getattr(self.env, name)

    def reset(self, scene: Scene) -> None:
        self.tcp = []
        self.env.reset(scene)

    def observe(self):
        return self.env.observe()

    def step(self, action):
        rec = self.env.step(action)
        self.tcp.append(np.asarray(rec.tcp_pos, dtype=np.float64))
        return rec


class LabelResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    seed: int
    success: bool
    reasons: list[str]
    steps: int
    drift_mean_mm: float | None  # executed vs verified fingertips over the labelled steps
    drift_max_mm: float | None
    drift_at_close_mm: float | None  # at the first gripper close: where a grasp misses


def drift(verified_ee: np.ndarray, executed_tcp: np.ndarray, gripper: np.ndarray) -> tuple[float, float, float | None]:
    """(mean, max, at the first close) distance in mm over the steps both have."""
    n = min(len(verified_ee), len(executed_tcp))
    if n == 0:
        return math.nan, math.nan, None
    d = np.linalg.norm(np.asarray(executed_tcp[:n]) - np.asarray(verified_ee[:n]), axis=1) * 1000
    closes = np.flatnonzero(np.asarray(gripper[:n]) == 1)
    return float(d.mean()), float(d.max()), float(d[closes[0]]) if closes.size else None


def wilson(k: int, n: int) -> tuple[float, float]:
    """95% Wilson interval (demo_pipeline.stats), with the no-data case as the whole of [0, 1]."""
    return (0.0, 1.0) if n == 0 else wilson_ci(k, n)


def summarize(results: list[LabelResult]) -> dict:
    n, k = len(results), sum(r.success for r in results)
    lo, hi = wilson(k, n)
    reasons: dict[str, int] = {}
    for r in results:
        for x in r.reasons:
            reasons[x] = reasons.get(x, 0) + 1
    drifts = [r.drift_mean_mm for r in results if r.drift_mean_mm is not None and not math.isnan(r.drift_mean_mm)]
    at_close = [r.drift_at_close_mm for r in results if r.drift_at_close_mm is not None]
    return {
        "n": n, "successes": k, "rate": k / n if n else None, "wilson95": [round(lo, 4), round(hi, 4)],
        "reasons": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        "drift_mean_mm_median": float(np.median(drifts)) if drifts else None,
        "drift_at_close_mm_median": float(np.median(at_close)) if at_close else None,
        "verdict": verdict(k, n),
    }


def verdict(k: int, n: int) -> str:
    """Plain words. Every label set here passed verification, so anything short of all-pass is the executor."""
    if n == 0:
        return "no episodes"
    if k == n:
        return "all labels execute: the executor is not the problem"
    lo, hi = wilson(k, n)
    if hi < 0.9:
        return (f"{k}/{n} labels execute (95% CI {lo:.0%}-{hi:.0%}): many verified labels fail under the policy's "
                "executor, so the training data asks for motions the policy can't produce. Fix the executor or "
                "relabel before more training")
    return f"{k}/{n} labels execute (95% CI {lo:.0%}-{hi:.0%}): a few fail; look at their reasons before concluding"


def write_report(path: Path, results: list[LabelResult], meta: dict) -> dict:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    summary = summarize(results)
    path.write_text(json.dumps({"meta": meta, "summary": summary, "episodes": [r.model_dump() for r in results]},
                               indent=1), encoding="utf-8")
    return summary
