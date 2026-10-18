"""Record what the policy saw: an EvalEnv wrapper that keeps every k-th camera frame of chosen seeds.

Frames are saved per seed as <out_dir>/seed_<seed>.npz ({camera: (T, H, W, 3) uint8}) plus seed_<seed>.json
(seed, every, n_frames, cameras). Pure numpy, so it runs in any venv; turning them into a video or contact sheet is
sim_eval/scripts/frames_to_media.py's job.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from demo_pipeline.schemas import Scene
from sim_eval.eval_policy import Observation, StepRecord


class FrameRecorder:
    def __init__(self, env, seeds, out_dir: Path, every: int = 5):
        if every < 1:
            raise ValueError("every must be >= 1")
        self.env, self.seeds, self.out_dir, self.every = env, set(seeds), Path(out_dir), every
        self._seed: int | None = None
        self._frames: dict[str, list[np.ndarray]] = {}
        self._k = 0

    def __getattr__(self, name):  # everything else (cameras, bin_inner, joint_names, ...) is the wrapped env's
        if name == "env":
            raise AttributeError(name)
        return getattr(self.env, name)

    def reset(self, scene: Scene) -> None:
        self._flush()
        self.env.reset(scene)
        self._seed = scene.seed if scene.seed in self.seeds else None
        self._frames, self._k = {}, 0

    def observe(self) -> Observation:
        obs = self.env.observe()
        if self._seed is not None and self._k % self.every == 0:
            for cam, img in obs.images.items():
                self._frames.setdefault(cam, []).append(np.array(img, dtype=np.uint8))
        self._k += 1
        return obs

    def step(self, action: np.ndarray) -> StepRecord:
        return self.env.step(action)

    def close(self) -> None:
        self._flush()

    def _flush(self) -> None:
        if self._seed is None or not self._frames:
            return
        self.out_dir.mkdir(parents=True, exist_ok=True)
        stem = self.out_dir / f"seed_{self._seed}"
        np.savez_compressed(stem.with_suffix(".npz"), **{c: np.stack(f) for c, f in self._frames.items()})
        n = len(next(iter(self._frames.values())))
        stem.with_suffix(".json").write_text(json.dumps({"seed": self._seed, "every": self.every, "n_frames": n,
                                                         "cameras": sorted(self._frames)}), encoding="utf-8")
        self._seed, self._frames = None, {}


def load_frames(path: Path) -> dict[str, np.ndarray]:
    with np.load(path) as npz:
        return {k: npz[k] for k in npz.files}


_TRACE_FIELDS = ("tcp_pos", "tcp_quat_wxyz", "cube_pos", "gripper", "contact_gripper_cube", "contact_arm_bin",
                 "contact_arm_table", "max_contact_force")


class StepTracer:
    """An EvalEnv wrapper that keeps every control step of chosen seeds (all seeds when seeds is None): the observed
    joint_pos, the policy's 9-joint action, and the StepRecord (+ the cube orientation when the env reports it).

    Saved per seed as <out_dir>/seed_<seed>.npz ({field: (T, ...)}) plus seed_<seed>.json (seed, n_steps, fps).
    Row k is the observation before action k and the record after it. The sprint 7/8 evals kept only per-episode
    summaries, which can't say when or why a cube was dropped; these can."""

    def __init__(self, env, seeds, out_dir: Path, fps: int = 50):
        self.env, self.seeds, self.out_dir, self.fps = env, None if seeds is None else set(seeds), Path(out_dir), fps
        self._seed: int | None = None
        self._rows: dict[str, list] = {}
        self._last_q: np.ndarray | None = None

    def __getattr__(self, name):  # everything else is the wrapped env's
        if name == "env":
            raise AttributeError(name)
        return getattr(self.env, name)

    def reset(self, scene: Scene) -> None:
        self._flush()
        self.env.reset(scene)
        self._seed = scene.seed if self.seeds is None or scene.seed in self.seeds else None
        self._rows, self._last_q = {}, None

    def observe(self) -> Observation:
        obs = self.env.observe()
        self._last_q = np.array(obs.joint_pos, dtype=np.float64)
        return obs

    def step(self, action: np.ndarray) -> StepRecord:
        rec = self.env.step(action)
        if self._seed is not None:
            row = {"joint_pos": self._last_q, "action": np.array(action, dtype=np.float64)}
            row.update({f: getattr(rec, f) for f in _TRACE_FIELDS})
            if rec.cube_quat_wxyz is not None:
                row["cube_quat_wxyz"] = rec.cube_quat_wxyz
            for k, v in row.items():
                self._rows.setdefault(k, []).append(v)
        return rec

    def close(self) -> None:
        self._flush()
        if hasattr(self.env, "close"):
            self.env.close()

    def _flush(self) -> None:
        if self._seed is None or not self._rows:
            return
        self.out_dir.mkdir(parents=True, exist_ok=True)
        stem = self.out_dir / f"seed_{self._seed}"
        np.savez_compressed(stem.with_suffix(".npz"), **{k: np.asarray(v) for k, v in self._rows.items()})
        stem.with_suffix(".json").write_text(json.dumps({"seed": self._seed, "n_steps": len(self._rows["action"]),
                                                         "fps": self.fps}), encoding="utf-8")
        self._seed, self._rows = None, {}


def load_trace(path: Path) -> dict[str, np.ndarray]:
    with np.load(path) as npz:
        return {k: npz[k] for k in npz.files}
