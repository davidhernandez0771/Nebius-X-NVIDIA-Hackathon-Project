"""The home-start multiply dataset for T3 (sprint 6 Task 2): seeds, passports and the manifest. Pure.

Sources: the scripted expert with home_start on scenes sample_scene(seed), seeds SOURCE_SEED0.. (10 of them).
Variants: variant k of source i gets scene seed VARIANT_SEED0 + 100 (k // 10) + 10 i + k % 10: blocks of 100 seeds,
10 sources x 10 variants each, so the first 10 variants keep sprint 6's seeds (3100-3199) when a run asks for
more (sprint 7: 10 x 30 adds 3200-3399, and the 100 finished episodes are reused). Every seed stays below T3's eval
scenes (sim_eval.scenes.EVAL_SEED_MIN = 5000), so no training scene is ever a test scene.

Variants are rehomed: transform_trajectory (T1) keeps the hand rigid in the cube's frame until the grasp, so a
variant of a home-start demo would start at home *moved with the cube* (measured: 10-35 cm off home, joint 1 up to
2.2 rad apart), and the start state would encode the cube again. rehome() replaces the variant's first move with a
fresh one from home to its above-cube pose, planned like the scripted expert's; from there on it is the variant.

Neaten, centered approach (grasp fix, 2026-10-18): traced evals of the 10x10 policy showed every drop starts at
the approach. The policy arrives above the cube ~2 cm off in a random direction, with its wrist yaw ~25 deg off,
and corrects neither on the way down: the demos are always perfectly aligned, so they never show a correction.
Off along the fingers' closing axis (> 15 mm of clearance), a finger lands on the cube top and the grasp closes 3 cm
too high; off by ~45 deg in yaw, the fingers close on the cube's edges and squeeze it out.
rehome(..., approach_offset=o, approach_yaw=y) makes the first move arrive at the above-cube pose shifted by o and
turned by y about the vertical (seeded per episode, approach_misalignment()), hover, then center and align over
the cube with one slow move. The descent, grasp, lift, carry and release are untouched, and every episode is still
replayed and verified by the same physics check.

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
SOURCES_MAX = 10  # sources per block of 100 variant seeds
APPROACH_OFFSET_MAX = 0.03  # m; the traced policy's error above the cube was ~2 cm (T3 grasp-fix note)
APPROACH_YAW_MAX = math.radians(35)  # its wrist yaw error was 3-44 deg; past 45 the nearer cube face flips
HOVER_S = 0.2  # still, off-center, before centering
CENTER_SPEED = 0.05  # m/s, average over the centering move: a third of the expert's SPEED
CENTER_MIN_S = 0.6


def source_seeds(n: int) -> list[int]:
    return list(range(SOURCE_SEED0, SOURCE_SEED0 + n))


def variant_seeds(i: int, n: int) -> list[int]:
    if not 0 <= i < SOURCES_MAX:
        raise ValueError(f"source index {i}: at most {SOURCES_MAX} sources keep the variant seed blocks apart")
    seeds = [VARIANT_SEED0 + SOURCES_MAX * VARIANTS_PER_BLOCK * (k // VARIANTS_PER_BLOCK) + VARIANTS_PER_BLOCK * i
             + k % VARIANTS_PER_BLOCK for k in range(n)]
    if seeds and max(seeds) >= EVAL_SEED_MIN:
        raise ValueError(f"variant seeds up to {max(seeds)} would reach the eval scenes ({EVAL_SEED_MIN}+)")
    return seeds


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


def approach_misalignment(seed: int) -> tuple[np.ndarray, float]:
    """(horizontal offset in m, yaw in rad) for the centered approach: the offset uniform over the disc of radius
    APPROACH_OFFSET_MAX, the yaw uniform in +-APPROACH_YAW_MAX. Its own stream per episode seed, independent of the
    scene drawn from that seed."""
    rng = np.random.default_rng([seed, 0xA0])
    r, ang = APPROACH_OFFSET_MAX * math.sqrt(rng.random()), rng.uniform(-math.pi, math.pi)
    return np.array([r * math.cos(ang), r * math.sin(ang)]), float(rng.uniform(-APPROACH_YAW_MAX, APPROACH_YAW_MAX))


def _turned(q_wxyz: np.ndarray, yaw: float) -> np.ndarray:
    """q turned by yaw about the world vertical: (cos, 0, 0, sin) * q."""
    w, x, y, z = q_wxyz
    c, s = math.cos(yaw / 2), math.sin(yaw / 2)
    return np.array([c * w - s * z, c * x - s * y, c * y + s * x, c * z + s * w])


def _move(p0, p1, q0, q1, span: float, rate_hz: int) -> tuple[np.ndarray, np.ndarray]:
    n = max(1, math.ceil(span * rate_hz - 1e-9))
    s = _min_jerk(np.arange(1, n + 1) / n)
    return p0 + s[:, None] * (p1 - p0), _slerp(q0, q1, s)


def rehome(traj: Trajectory, k: int, start_pos=HOME_TCP, start_quat=DOWN_WXYZ, rate_hz: int = 50,
           approach_offset=(0.0, 0.0), approach_yaw: float = 0.0) -> Trajectory:
    """traj with steps 0..k replaced by a min-jerk move from the start pose to traj's pose at step k, timed like
    the scripted expert's moves (SPEED average, MIN_MOVE_S at least). Steps after k are kept; time is re-gridded.
    approach_offset (x, y in m, world) / approach_yaw (rad, about the vertical): arrive at that pose shifted and
    turned instead, hold HOVER_S, then center and align over it in one move (CENTER_SPEED average, CENTER_MIN_S at
    least). Both zero is the plain move."""
    a = traj.to_arrays()
    if np.any(a["gripper"][: k + 1] != 0):
        raise ValueError(f"rehome: the gripper closes within the first {k + 1} steps; that is not a free move")
    p0, q0 = np.asarray(start_pos, dtype=float), np.asarray(start_quat, dtype=float)
    p1, q1 = a["ee_pos"][k], a["ee_quat"][k]
    off = np.array([*np.asarray(approach_offset, dtype=float), 0.0])
    if not np.any(off) and approach_yaw == 0.0:
        moves = [_move(p0, p1, q0, q1, max(float(np.linalg.norm(p1 - p0)) / SPEED, MIN_MOVE_S), rate_hz)]
    else:
        hover, q_hover = p1 + off, _turned(q1, approach_yaw)
        n_hold = max(1, math.ceil(HOVER_S * rate_hz - 1e-9))
        moves = [_move(p0, hover, q0, q_hover, max(float(np.linalg.norm(hover - p0)) / SPEED, MIN_MOVE_S), rate_hz),
                 (np.tile(hover, (n_hold, 1)), np.tile(q_hover, (n_hold, 1))),
                 _move(hover, p1, q_hover, q1, max(float(np.linalg.norm(off)) / CENTER_SPEED, CENTER_MIN_S),
                       rate_hz)]
    pos = np.vstack([p0, *(m[0] for m in moves), a["ee_pos"][k + 1:]])
    quat = np.vstack([q0, *(m[1] for m in moves), a["ee_quat"][k + 1:]])
    quat /= np.linalg.norm(quat, axis=1, keepdims=True)
    n = sum(len(m[0]) for m in moves)
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
