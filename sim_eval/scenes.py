"""The fixed test scenes: scene i comes from its own seed (seed0 + i), so `--n 3` tests the first 3 of `--n 50`."""

from __future__ import annotations

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
