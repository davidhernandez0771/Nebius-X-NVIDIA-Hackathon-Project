"""The fixed test scenes: scene i comes from its own seed (seed0 + i), so `--n 3` tests the first 3 of `--n 50`."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from demo_pipeline.multiply import sample_scene
from demo_pipeline.schemas import RobotName, Scene

# Training-side seeds are small (T2 batch 0-49, multiply 100+); test scenes start well clear of them.
EVAL_SEED_MIN = 5000


def eval_scenes(n: int, seed0: int = EVAL_SEED_MIN, robot: RobotName = "franka") -> list[Scene]:
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    if seed0 < EVAL_SEED_MIN:
        raise ValueError(f"test-scene seeds start at {EVAL_SEED_MIN} to stay clear of training seeds, got {seed0}")
    return [sample_scene(np.random.default_rng(seed), robot, seed) for seed in range(seed0, seed0 + n)]


def training_scenes(ep_dirs) -> list[tuple[Scene, np.ndarray]]:
    """(scene, first-frame joint positions) of recorded training episodes: their scene.json and steps.npz
    joint_pos[0]. Used to check a policy on the very scenes and start poses it was trained on (sprint 6 Task A)."""
    out = []
    for d in ep_dirs:
        d = Path(d)
        scene = Scene.model_validate_json((d / "scene.json").read_text(encoding="utf-8"))
        with np.load(d / "steps.npz") as npz:
            out.append((scene, np.asarray(npz["joint_pos"][0], dtype=np.float64)))
    return out


def scene_plan(n: int, seed0: int = EVAL_SEED_MIN, train_episode_dirs=(), robot: RobotName = "franka"
               ) -> tuple[list[Scene], dict[int, list[float]], dict[str, list[int]]]:
    """Scenes for one eval run: the training scenes first (each with its own start pose), then n unseen scenes.
    Returns (scenes, {seed: start pose} for the training scenes, {"train": seeds, "unseen": seeds})."""
    train = training_scenes(train_episode_dirs)
    if n <= 0 and not train:
        raise ValueError("nothing to evaluate: n is 0 and no training episodes were given")
    unseen = eval_scenes(n, seed0, robot) if n > 0 else []
    scenes = [s for s, _ in train] + unseen
    seeds = [s.seed for s in scenes]
    dupes = sorted({s for s in seeds if seeds.count(s) > 1})
    if dupes:
        raise ValueError(f"scene seeds must be unique within a run; duplicated: {dupes}")
    groups = {}
    if train:
        groups["train"] = [s.seed for s, _ in train]
    if unseen:
        groups["unseen"] = [s.seed for s in unseen]
    return scenes, {s.seed: q.tolist() for s, q in train}, groups
