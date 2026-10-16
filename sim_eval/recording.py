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

    # EvalEnv passthroughs
    @property
    def cameras(self):
        return self.env.cameras

    @property
    def bin_inner(self):
        return self.env.bin_inner

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
