"""Build measurement set v2: a balanced, pre-registered set for a fair diagnoser test (pure, no sim).

Sprint 5's mix, for --n 32 (another n keeps the proportions, by largest remainder):

    8  timing_off_center  timing issues + off-center grasp     truth: grasp_off_center (+ timing)
    8  timing_centered    timing issues + centered grasp       truth: no grasp issue (the negatives)
    6  drop               the gripper opens mid-carry          truth: drop (+ timing)
    6  bad_release        let go beside the bin                truth: bad_release (+ timing)
    4  clean              nothing                              truth: none

Every demo is the scripted expert's trajectory for a sampled scene, degraded (as T2's render_degraded
does today). Types are dealt to the seeds by a shuffle drawn from --seed, so ids don't give them away.
Nothing is rendered: T2 renders the set.

    OUT/<name>_<seed>/demo.json    Demo (source="human", human_seconds = degraded duration)
    OUT/<name>_<seed>/truth.json   {"synthetic", "demo_id", "seed", "type", "settings", "issues": [InjectedIssue]}
    OUT/manifest.json              written last; ids, types, seeds, settings and a SHA-256 of every demo
                                   (without created_at) and truth, and no timestamp: a rebuild gives
                                   the same bytes, so the manifest's SHA-256 freezes the whole set

truth.json includes the scripted expert's own waypoint stops as dont_care pauses (see scoring).

    uv run python scripts/make_measurement_set_v2.py --n 32 --seed 2000 --out <DATA_DIR>/sets/v2
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # sim_worker is a top-level folder, not installed

from demo_pipeline.degrade import degrade  # noqa: E402
from demo_pipeline.multiply import sample_scene  # noqa: E402
from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.schemas import Demo  # noqa: E402
from sim_worker.scripted import HOLD_S, LIFT_Z, scripted_expert  # noqa: E402

_SAFE_NAME = re.compile(r"[A-Za-z0-9_-]+")  # set names and demo ids are folder names (as in the demo store)

MIX = {"timing_off_center": 8, "timing_centered": 8, "drop": 6, "bad_release": 6, "clean": 4}  # per 32 demos

MIX_RULES = {
    "timing": "every type but clean: tremor 1-3 mm; 1 or 2 pauses of 0.5-1.2 s; slow x1.2-1.6 on half the "
              "seeds; idle 0.5-1.5 s at the start on half and at the end on half",
    "timing_off_center": "grasp offset uniform 6-12 mm (T4's tracking error is 3.3 mm)",
    "timing_centered": "grasp offset 0: the negatives for grasp_off_center",
    "drop": "degrade(drop=True): open mid-carry, cube and its landing >= 5 cm from the bin footprint, >= 5 cm up",
    "bad_release": "degrade(bad_release='outside'): let go 5-8 cm beside the bin footprint, at the usual height; "
                   "not 'high', which may still land in the bin and pass verification",
    "clean": "no tremor, pauses, slowness, idle or offset",
    "grasp": "centered (0 mm) on every type but timing_off_center",
}


def allocate(n: int) -> dict[str, int]:
    """The MIX scaled to n demos by largest remainder (ties go to the type listed first)."""
    total = sum(MIX.values())
    exact = {t: n * k / total for t, k in MIX.items()}
    counts = {t: math.floor(x) for t, x in exact.items()}
    for t in sorted(MIX, key=lambda t: -(exact[t] - counts[t]))[: n - sum(counts.values())]:
        counts[t] += 1
    return counts


def settings_for(kind: str, rng: np.random.Generator) -> dict:
    """One demo's degrade settings for its type (draws only what the type uses, in a fixed order)."""
    s = dict(jitter_mm=0.0, n_pauses=0, grasp_offset_mm=0.0, slow_factor=1.0, idle_start_s=0.0, idle_end_s=0.0,
             drop=kind == "drop", bad_release="outside" if kind == "bad_release" else None)
    if kind == "clean":
        return s
    s.update(
        jitter_mm=float(rng.uniform(1.0, 3.0)),
        n_pauses=int(rng.integers(1, 3)),
        slow_factor=1.0 if rng.random() < 0.5 else float(rng.uniform(1.2, 1.6)),
        idle_start_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
        idle_end_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
    )
    if kind == "timing_off_center":
        s["grasp_offset_mm"] = float(rng.uniform(6.0, 12.0))
    return s


def _write(path: Path, text: str) -> bytes:
    data = text.encode("utf-8")
    path.write_bytes(data)  # LF on every OS, so hashes match
    return data


def build_set(out: Path, n: int = 32, seed: int = 2000, robot: str = "franka", overwrite: bool = False,
              hold_s: float = HOLD_S, lift_z: float = LIFT_Z) -> Path:
    """Write the set to out (its folder name is the set name and the id prefix) and return out.

    A demo degrade cannot build raises: a pre-registered set is complete or not written.
    """
    out = Path(out)
    name = out.name
    if not _SAFE_NAME.fullmatch(name):
        raise ValueError(f"set name {name!r} (the --out folder) must match [A-Za-z0-9_-]+")
    if n < 1:
        raise ValueError(f"n must be >= 1, got {n}")
    if out.exists():
        if not overwrite:
            raise FileExistsError(f"{out} exists; pass overwrite=True (--overwrite) to replace it")
        shutil.rmtree(out)
    types = [t for t, k in allocate(n).items() for _ in range(k)]
    types = [types[i] for i in np.random.default_rng(seed).permutation(n)]
    out.mkdir(parents=True)

    demos, counts = [], Counter()
    for i, kind in enumerate(types):
        demo_seed = seed + i
        demo_id = f"{name}_{demo_seed:04d}"
        rng = np.random.default_rng(demo_seed)
        scene = sample_scene(rng, robot, demo_seed)
        settings = settings_for(kind, rng)
        try:
            traj, issues = degrade(scripted_expert(scene, hold_s=hold_s, lift_z=lift_z), rng, expert_stops=True,
                                   scene=scene, **settings)
        except ValueError as exc:
            raise ValueError(f"{demo_id} ({kind}): {exc}") from exc
        demo = Demo(id=demo_id, source="human", trajectory=traj, scene=scene,
                    human_seconds=float(traj.t[-1] - traj.t[0]))
        (out / demo_id).mkdir()
        _write(out / demo_id / "demo.json", demo.model_dump_json())
        truth = {"synthetic": True, "demo_id": demo_id, "seed": demo_seed, "type": kind, "settings": settings,
                 "issues": [x.model_dump() for x in issues]}
        truth_bytes = _write(out / demo_id / "truth.json", json.dumps(truth, indent=1))
        counts.update(x.type for x in issues if not x.dont_care)
        demos.append({
            "id": demo_id, "seed": demo_seed, "type": kind, "duration_s": demo.human_seconds, "settings": settings,
            "demo_sha256": hashlib.sha256(demo.model_dump_json(exclude={"created_at"}).encode()).hexdigest(),
            "truth_sha256": hashlib.sha256(truth_bytes).hexdigest(),
        })

    manifest = {
        "name": name, "synthetic": True, "n": n, "seed": seed, "robot": robot, "hold_s": hold_s, "lift_z": lift_z,
        "generator": "scripts/make_measurement_set_v2.py", "mix": allocate(n), "mix_rules": MIX_RULES,
        "issue_counts": dict(sorted(counts.items())), "demos": demos, "skipped": [],
    }
    _write(out / "manifest.json", json.dumps(manifest, indent=1))
    return out


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--n", type=int, default=32)
    p.add_argument("--seed", type=int, default=2000)
    p.add_argument("--out", type=Path, default=None, help="set folder (default DATA_DIR/sets/v2)")
    p.add_argument("--robot", default="franka")
    p.add_argument("--hold-s", type=float, default=HOLD_S, help="scripted expert's wait at the close and open")
    p.add_argument("--lift-z", type=float, default=LIFT_Z, help="scripted expert's carry height")
    p.add_argument("--overwrite", action="store_true")
    args = p.parse_args(argv)
    out = args.out if args.out is not None else data_dir() / "sets" / "v2"
    set_dir = build_set(out, args.n, args.seed, args.robot, args.overwrite, args.hold_s, args.lift_z)
    raw = (set_dir / "manifest.json").read_bytes()
    m = json.loads(raw)
    print(f"set {m['name']}: {len(m['demos'])} demos -> {set_dir}")
    print("types: " + ", ".join(f"{k} {v}" for k, v in m["mix"].items()))
    print("injected issues: " + ", ".join(f"{k} {v}" for k, v in m["issue_counts"].items()))
    print(f"manifest sha256: {hashlib.sha256(raw).hexdigest()}")


if __name__ == "__main__":
    main()
