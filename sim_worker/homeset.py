"""The home-start multiply dataset for T3 (sprint 6 Task 2): seeds, passports and the manifest. Pure.

Sources: the scripted expert with home_start on scenes sample_scene(seed), seeds SOURCE_SEED0.. (10 of them).
Variants: source i multiplied into scenes VARIANT_SEED0 + 10 i + k, k < 10. Every seed stays below T3's eval
scenes (sim_eval.scenes.EVAL_SEED_MIN = 5000), so no training scene is ever a test scene.

Variants are rehomed: transform_trajectory (T1) keeps the hand rigid in the cube's frame until the grasp, so a
variant of a home-start demo would start at home *moved with the cube* (measured: 10-35 cm off home, joint 1 up to
2.2 rad apart), and the start state would encode the cube again. rehome() replaces the variant's first move with a
fresh one from home to its above-cube pose, planned like the scripted expert's; from there on it is the variant.

Each episode gets a Passport (lineage = [source, variant]), so lerobot_tools.assemble traces every variant to its
source and a cell can't count more human demos than its label. The manifest lists every episode dir, the yield,
and a grid T3 can run as is: raw = the verified sources, raw_multiply = those plus every verified variant.
"""

from __future__ import annotations

import collections
import math
import os
from pathlib import Path

import numpy as np

from demo_pipeline import PIPELINE_VERSION
from demo_pipeline.episode_io import EpisodeMeta
from demo_pipeline.schemas import Passport, Scene, Trajectory, VerificationResult
from sim_worker.scripted import DOWN_WXYZ, HOME_TCP, MIN_MOVE_S, SPEED, _min_jerk, _slerp, scripted_expert

EVAL_SEED_MIN = 5000  # sim_eval.scenes (T3): test scenes start here
SOURCE_SEED0 = 3000
VARIANT_SEED0 = 3100
VARIANTS_PER_BLOCK = 10


def source_seeds(n: int) -> list[int]:
    return list(range(SOURCE_SEED0, SOURCE_SEED0 + n))


def variant_seeds(i: int, n: int) -> list[int]:
    if n > VARIANTS_PER_BLOCK:
        raise ValueError(f"at most {VARIANTS_PER_BLOCK} variants per source keep the seed blocks apart, got {n}")
    first = VARIANT_SEED0 + VARIANTS_PER_BLOCK * i
    if first + n > EVAL_SEED_MIN:
        raise ValueError(f"variant seeds {first}..{first + n - 1} would reach the eval scenes ({EVAL_SEED_MIN}+)")
    return list(range(first, first + n))


def source_name(seed: int) -> str:
    return f"home_src_{seed:04d}"


def passport(demo_id: str, lineage: list[str], verification: VerificationResult, *, variant_seed: int | None = None,
             robot: str = "franka") -> Passport:
    return Passport(demo_id=demo_id, lineage=lineage, diagnosis_source="none", variant_seed=variant_seed,
                    robot=robot, verification=verification, pipeline_version=PIPELINE_VERSION)


def stamp(ep_dir: Path, pp: Passport) -> None:
    """Put the passport (and its demo id) into <ep_dir>/episode.json, atomically."""
    path = Path(ep_dir) / "episode.json"
    meta = EpisodeMeta.model_validate_json(path.read_text(encoding="utf-8"))
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(meta.model_copy(update={"passport": pp, "demo_id": pp.demo_id}).model_dump_json(indent=2),
                   encoding="utf-8")
    os.replace(tmp, path)


def first_move_steps(scene: Scene) -> int:
    """Index where the home-start expert reaches its above-cube pose (the plain expert's first step)."""
    return len(scripted_expert(scene, home_start=True).t) - len(scripted_expert(scene).t)


def rehome(traj: Trajectory, k: int, start_pos=HOME_TCP, start_quat=DOWN_WXYZ, rate_hz: int = 50) -> Trajectory:
    """traj with steps 0..k replaced by a min-jerk move from the start pose to traj's pose at step k, timed like
    the scripted expert's moves (SPEED average, MIN_MOVE_S at least). Steps after k are kept; time is re-gridded."""
    a = traj.to_arrays()
    if np.any(a["gripper"][: k + 1] != 0):
        raise ValueError(f"rehome: the gripper closes within the first {k + 1} steps; that is not a free move")
    p0, q0 = np.asarray(start_pos, dtype=float), np.asarray(start_quat, dtype=float)
    p1, q1 = a["ee_pos"][k], a["ee_quat"][k]
    span = max(float(np.linalg.norm(p1 - p0)) / SPEED, MIN_MOVE_S)
    n = max(1, math.ceil(span * rate_hz - 1e-9))
    s = _min_jerk(np.arange(1, n + 1) / n)
    pos = np.vstack([p0, p0 + s[:, None] * (p1 - p0), a["ee_pos"][k + 1:]])
    quat = np.vstack([q0, _slerp(q0, q1, s), a["ee_quat"][k + 1:]])
    quat /= np.linalg.norm(quat, axis=1, keepdims=True)
    grip = np.concatenate([np.zeros(n + 1, dtype=int), a["gripper"][k + 1:]])
    return Trajectory.from_arrays(np.arange(len(pos)) / rate_hz, pos, quat, grip)


def dataset_manifest(sources: list[dict], variants: list[dict]) -> dict:
    """sources: {"name", "seed", "success", "reasons", "ep_dir"}; variants: the same plus "source"."""
    per_source = {s["name"]: {"attempts": 0, "successes": 0} for s in sources}
    for v in variants:
        per_source[v["source"]]["attempts"] += 1
        per_source[v["source"]]["successes"] += bool(v["success"])
    ok_sources = [s["ep_dir"] for s in sources if s["success"]]
    ok_variants = [v["ep_dir"] for v in variants if v["success"]]
    n_var, n_ok = len(variants), len(ok_variants)
    n_human = len(sources)
    return {
        "home_start": True,
        "robot": "franka",
        "source_seeds": [s["seed"] for s in sources],
        "variant_seeds": [v["seed"] for v in variants],
        "eval_seed_min": EVAL_SEED_MIN,
        "sources_verified": len(ok_sources),
        "variant_attempts": n_var,
        "variant_successes": n_ok,
        "yield": n_ok / n_var if n_var else 0.0,
        "variant_reasons": dict(collections.Counter(r for v in variants for r in v["reasons"])),
        "per_source": per_source,
        "sources": sources,
        "variants": variants,
        "grid": {"name": "home_mult", "cells": [
            {"condition": "raw", "n_human": n_human, "episode_dirs": ok_sources},
            {"condition": "raw_multiply", "n_human": n_human, "episode_dirs": ok_sources + ok_variants},
        ]},
    }
