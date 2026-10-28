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

Human variants (2026-10-20 research note): a human demo's step k is just where the person started, not an above-cube
pose, so the centered approach goes where a retimed grasp (demo_pipeline.grasp_retime) hovers instead:
center_from_hover arrives at the hover shifted and turned, holds the hover's length, centers and aligns in one slow
move, then goes on down as before. The note raised the offset to 4 cm, past the 33 mm failure offsets the grasp-fix
traces measured (approach_misalignment(seed, offset_max=0.04)); the scripted datasets keep 3 cm.

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
from demo_pipeline.edit_plan import blend_s
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
HOVER_MIN_S = 0.2  # find_hover: a still run at least this long ...
HOVER_ABOVE_MIN = 0.04  # ... at least this high over the grasp
STILL_M = 1e-6  # m per step: still (a hover is held exactly)


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


def approach_misalignment(seed: int, offset_max: float = APPROACH_OFFSET_MAX) -> tuple[np.ndarray, float]:
    """(horizontal offset in m, yaw in rad) for the centered approach: the offset uniform over the disc of radius
    offset_max, the yaw uniform in +-APPROACH_YAW_MAX. Its own stream per episode seed, independent of the scene
    drawn from that seed; offset_max scales only the radius."""
    rng = np.random.default_rng([seed, 0xA0])
    r, ang = offset_max * math.sqrt(rng.random()), rng.uniform(-math.pi, math.pi)
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


def find_hover(traj: Trajectory) -> tuple[int, int] | None:
    """(first, last) step of the last still hover before the first close (gripper open, HOVER_MIN_S or longer,
    HOVER_ABOVE_MIN or more over the grasp), or None. Only a retimed grasp has one; a person's demo never holds
    exactly still."""
    a = traj.to_arrays()
    p, g = a["ee_pos"], a["gripper"]
    closed = np.flatnonzero(g != 0)
    if closed.size == 0:
        return None
    k = int(closed[0])
    still = np.r_[False, np.linalg.norm(np.diff(p[: k + 1], axis=0), axis=1) < STILL_M]  # still[j]: j - 1 -> j
    n_min = max(1, round(HOVER_MIN_S / float(np.median(np.diff(a["t"])))))
    j = k - 1
    while j > 0:
        if not still[j]:
            j -= 1
            continue
        i1 = j
        while j > 0 and still[j]:
            j -= 1
        i0 = j  # the run's first pose: still[i0 + 1 .. i1]
        if i1 - i0 + 1 >= n_min and p[i0, 2] >= p[k, 2] + HOVER_ABOVE_MIN - 1e-9:
            return i0, i1
    return None


def center_from_hover(traj: Trajectory, approach_offset, approach_yaw: float, rate_hz: int = 50) -> Trajectory | None:
    """traj arriving at its hover (find_hover) shifted by approach_offset (x, y in m) and turned by approach_yaw (rad,
    about the vertical), holding there for the hover's length, then centering and aligning over it in one move
    (CENTER_SPEED average, CENTER_MIN_S at least) before the rest of traj, unchanged. The shift and turn blend in
    over the approach's last edit_plan.blend_s(offset) (0.5 s at least) seconds. None when traj has no hover; traj
    itself for a zero misalignment."""
    off = np.array([*np.asarray(approach_offset, dtype=float), 0.0])
    if not np.any(off) and approach_yaw == 0.0:
        return traj
    hover = find_hover(traj)
    if hover is None:
        return None
    i0, i1 = hover
    a = traj.to_arrays()
    t, p, q = a["t"], a["ee_pos"], a["ee_quat"]
    span = max(blend_s(float(np.linalg.norm(off))), 0.5)
    if t[i0] - span < t[1]:
        raise ValueError(f"center_from_hover: the approach to the hover is shorter than the {span:.2f} s blend")
    w = _min_jerk(np.clip((t[: i0 + 1] - (t[i0] - span)) / span, 0.0, 1.0))
    pos = [p[: i0 + 1] + w[:, None] * off, np.tile(p[i0] + off, (i1 - i0, 1))]
    q_off = _turned(q[i0], approach_yaw)
    quat = [np.array([_turned(q[j], w[j] * approach_yaw) for j in range(i0 + 1)]), np.tile(q_off, (i1 - i0, 1))]
    c_pos, c_quat = _move(p[i0] + off, p[i1], q_off, q[i1],
                          max(float(np.linalg.norm(off)) / CENTER_SPEED, CENTER_MIN_S), rate_hz)
    pos += [c_pos, p[i1 + 1 :]]
    quat += [c_quat, q[i1 + 1 :]]
    pos, quat = np.vstack(pos), np.vstack(quat)
    quat /= np.linalg.norm(quat, axis=1, keepdims=True)
    grip = np.concatenate([a["gripper"][: i1 + 1], np.zeros(len(c_pos), dtype=int), a["gripper"][i1 + 1 :]])
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
