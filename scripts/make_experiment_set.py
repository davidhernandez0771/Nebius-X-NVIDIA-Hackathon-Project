"""Build an experiment set: synthetic webcam-like human demos with ground truth (pure, no sim).

For each seed: sample_scene -> scripted_expert -> degrade, with a per-seed mix of tremor, pauses,
off-center grasps, slowness and idle time (MIX_RULES; the realized mix goes in the manifest).
About 1 seed in 6 is a clean demo (tremor at most), so the set also exercises the keep path.

    DATA_DIR/sets/<name>/<name>_<seed>/demo.json    Demo (source="human", human_seconds = degraded duration)
    DATA_DIR/sets/<name>/<name>_<seed>/truth.json   {"synthetic": true, "seed", "settings", "issues": [InjectedIssue]}
    DATA_DIR/sets/<name>/manifest.json              written last: a set without it is incomplete

truth.json includes the scripted expert's own waypoint stops as dont_care pauses (see scoring).
Everything but created_at is a function of (name, seed, robot, hold_s, lift_z).

    uv run python scripts/make_experiment_set.py --name pilot60 --n 60 --seed0 0
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # sim_worker is a top-level folder, not installed

from demo_pipeline.degrade import InjectedIssue, degrade  # noqa: E402
from demo_pipeline.multiply import sample_scene  # noqa: E402
from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.schemas import Demo  # noqa: E402
from sim_worker.scripted import HOLD_S, LIFT_Z, scripted_expert  # noqa: E402

_SAFE_NAME = re.compile(r"[A-Za-z0-9_-]+")  # set names and demo ids are folder names (as in the demo store)

MIX_RULES = {
    "clean": "1 seed in 6: no pauses, offset, slowness or idle (tremor is still drawn); the flag is true iff all those are off",
    "jitter_mm": "0 on 1 seed in 4, else uniform 1-3 mm (webcam tremor, 6 Hz)",
    "n_pauses": "0, 1 or 2, equally likely; each 0.5-1.2 s",
    "grasp_offset_mm": "0 on half the seeds, else uniform 4-12 mm",
    "slow_factor": "1 on half the seeds, else uniform 1.2-1.6",
    "idle_start_s": "0 on half the seeds, else uniform 0.5-1.5 s",
    "idle_end_s": "0 on half the seeds, else uniform 0.5-1.5 s",
}


_ISSUE_KNOBS = {"n_pauses": 0, "grasp_offset_mm": 0.0, "slow_factor": 1.0, "idle_start_s": 0.0, "idle_end_s": 0.0}


def settings_for(rng: np.random.Generator) -> dict:
    """One seed's degrade settings plus its "clean" flag, drawn per MIX_RULES (the order of draws is
    part of the set's definition: every knob is drawn even on a clean seed)."""
    force_clean = rng.random() < 1 / 6
    s = dict(
        jitter_mm=0.0 if rng.random() < 0.25 else float(rng.uniform(1.0, 3.0)),
        n_pauses=int(rng.integers(0, 3)),
        grasp_offset_mm=0.0 if rng.random() < 0.5 else float(rng.uniform(4.0, 12.0)),
        slow_factor=1.0 if rng.random() < 0.5 else float(rng.uniform(1.2, 1.6)),
        idle_start_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
        idle_end_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
    )
    if force_clean:
        s.update(_ISSUE_KNOBS)
    s["clean"] = all(s[k] == v for k, v in _ISSUE_KNOBS.items())
    return s


def make_demo(name: str, seed: int, robot: str = "franka", hold_s: float = HOLD_S,
              lift_z: float = LIFT_Z) -> tuple[Demo, list[InjectedIssue], dict]:
    """The demo, its ground truth and its settings for one seed."""
    rng = np.random.default_rng(seed)
    scene = sample_scene(rng, robot, seed)
    settings = settings_for(rng)
    knobs = {k: v for k, v in settings.items() if k != "clean"}
    traj, issues = degrade(scripted_expert(scene, hold_s=hold_s, lift_z=lift_z), rng, expert_stops=True, **knobs)
    demo = Demo(id=f"{name}_{seed:04d}", source="human", trajectory=traj, scene=scene,
                human_seconds=float(traj.t[-1] - traj.t[0]))
    return demo, issues, settings


def build_set(name: str, n: int, seed0: int = 0, robot: str = "franka", root: Path | None = None,
              overwrite: bool = False, hold_s: float = HOLD_S, lift_z: float = LIFT_Z) -> Path:
    """Write the set under <root or DATA_DIR>/sets/<name>/ and return that folder.

    A seed degrade cannot place (ValueError, e.g. no room for its pauses) is skipped and listed in
    the manifest with its error. An existing set is replaced only with overwrite=True.
    """
    if not _SAFE_NAME.fullmatch(name):
        raise ValueError(f"set name {name!r} must match [A-Za-z0-9_-]+ (it is a folder name)")
    if n < 1:
        raise ValueError(f"n must be >= 1, got {n}")
    set_dir = Path(root if root is not None else data_dir()) / "sets" / name
    if set_dir.exists():
        if not overwrite:
            raise FileExistsError(f"{set_dir} exists; pass overwrite=True (--overwrite) to replace it")
        shutil.rmtree(set_dir)
    set_dir.mkdir(parents=True)
    created_at = datetime.now(timezone.utc)

    demos, skipped, counts = [], [], Counter()
    for seed in range(seed0, seed0 + n):
        demo_id = f"{name}_{seed:04d}"
        try:
            demo, issues, settings = make_demo(name, seed, robot, hold_s, lift_z)
        except ValueError as exc:
            skipped.append({"id": demo_id, "seed": seed, "error": str(exc)})
            continue
        demo = demo.model_copy(update={"created_at": created_at})
        out = set_dir / demo_id
        out.mkdir()
        (out / "demo.json").write_text(demo.model_dump_json(), encoding="utf-8")
        truth = {"synthetic": True, "demo_id": demo_id, "seed": seed, "settings": settings,
                 "issues": [i.model_dump() for i in issues]}
        (out / "truth.json").write_text(json.dumps(truth, indent=1), encoding="utf-8")
        counts.update(i.type for i in issues if not i.dont_care)
        demos.append({"id": demo_id, "seed": seed, "duration_s": demo.human_seconds, "settings": settings})

    manifest = {
        "name": name, "synthetic": True, "n": n, "seed0": seed0, "robot": robot,
        "hold_s": hold_s, "lift_z": lift_z, "created_at": created_at.isoformat(),
        "generator": "scripts/make_experiment_set.py",
        "mix_rules": MIX_RULES, "issue_counts": dict(sorted(counts.items())),
        "demos": demos, "skipped": skipped,
    }
    (set_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return set_dir


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--name", required=True)
    p.add_argument("--n", type=int, default=60)
    p.add_argument("--seed0", type=int, default=0)
    p.add_argument("--robot", default="franka")
    p.add_argument("--hold-s", type=float, default=HOLD_S, help="scripted expert's wait at the close and open")
    p.add_argument("--lift-z", type=float, default=LIFT_Z, help="scripted expert's carry height (0.18 for openarm)")
    p.add_argument("--root", type=Path, default=None, help="data root (default DATA_DIR)")
    p.add_argument("--overwrite", action="store_true")
    args = p.parse_args(argv)
    set_dir = build_set(args.name, args.n, args.seed0, args.robot, args.root, args.overwrite, args.hold_s, args.lift_z)
    m = json.loads((set_dir / "manifest.json").read_text(encoding="utf-8"))
    print(f"set {args.name}: {len(m['demos'])} demos, {len(m['skipped'])} skipped -> {set_dir}")
    print("injected issues: " + ", ".join(f"{k} {v}" for k, v in m["issue_counts"].items()))


if __name__ == "__main__":
    main()
