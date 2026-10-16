"""Rules-only baseline: score detect_rules on seeded webcam-like degraded demos (pure, no sim).

Each seed samples a scene (multiply.sample_scene), runs the scripted expert, and degrades it
with seeded settings; only jitter_mm is set from the command line, so every jitter level sees
the same scenes, pauses, offsets and idle times. The expert's own waypoint stops come back as
dont_care truth: a rules pause on one is counted as "ignored", not as a false positive.

    uv run python scripts/score_rules_on_degraded.py --n 200 --jitter-mm 0 1 2 4
    uv run python scripts/score_rules_on_degraded.py --still-speed 0.05 --jitter-min-jerk 40 --json out.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # sim_worker is a top-level folder, not installed

from demo_pipeline import rules  # noqa: E402
from demo_pipeline.degrade import InjectedIssue, degrade  # noqa: E402
from demo_pipeline.measure import compute_windows  # noqa: E402
from demo_pipeline.multiply import sample_scene  # noqa: E402
from demo_pipeline.schemas import Scene, SimSignals, Trajectory  # noqa: E402
from demo_pipeline.scoring import DiagnosisScore, TypeScore, aggregate, score_diagnosis  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402

RULES_TYPES = ("pause", "jitter", "idle_start_end")  # the only types the rules detector can emit


def make_case(seed: int, jitter_mm: float) -> tuple[Trajectory, list[InjectedIssue], Scene]:
    """One degraded demo. Everything but the jitter noise depends only on the seed."""
    rng = np.random.default_rng(seed)
    scene = sample_scene(rng, "franka", seed)
    settings = dict(
        n_pauses=int(rng.integers(0, 3)),
        grasp_offset_mm=float(rng.uniform(4.0, 12.0)),
        slow_factor=1.0 if rng.random() < 0.5 else float(rng.uniform(1.2, 1.6)),
        idle_start_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
        idle_end_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
    )
    traj, truth = degrade(scripted_expert(scene), rng, jitter_mm=jitter_mm, expert_stops=True, **settings)
    return traj, truth, scene


def _signals(traj: Trajectory, scene: Scene) -> SimSignals:
    """No sim: the cube rests where the scene put it, and nothing touches."""
    n = len(traj.t)
    return SimSignals(np.tile(scene.cube_pose.pos, (n, 1)), np.zeros(n, bool), np.zeros(n, bool),
                      np.zeros(n, bool), np.zeros(n))


def run(n: int = 200, seed0: int = 0, jitter_levels=(0.0, 1.0, 2.0, 4.0),
        iou_threshold: float = 0.3) -> dict[float, DiagnosisScore]:
    out = {}
    for jitter_mm in jitter_levels:
        scores = []
        for seed in range(seed0, seed0 + n):
            traj, truth, scene = make_case(seed, jitter_mm)
            diag = rules.detect_rules(traj, compute_windows(traj, _signals(traj, scene)))
            scores.append(score_diagnosis(diag, truth, iou_threshold))
        out[float(jitter_mm)] = aggregate(scores)
    return out


def subtotal(score: DiagnosisScore, kinds=RULES_TYPES) -> TypeScore:
    return sum((v for k, v in score.per_type.items() if k in kinds), TypeScore())


def _fmt(x: float | None) -> str:
    return "  -  " if x is None else f"{x:5.2f}"


def table(results: dict[float, DiagnosisScore]) -> str:
    lines = ["| jitter_mm | type | TP | FP | FN | ignored | precision | recall | F1 | mean IoU |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for jitter_mm, score in results.items():
        rows = list(score.per_type.items()) + [("**rules' types**", subtotal(score)), ("**all types**", score.total)]
        for kind, s in rows:
            lines.append(f"| {jitter_mm:g} | {kind} | {s.tp} | {s.fp} | {s.fn} | {s.ignored} | {_fmt(s.precision)} | "
                         f"{_fmt(s.recall)} | {_fmt(s.f1)} | {_fmt(s.mean_iou)} |")
    return "\n".join(lines)


def _as_json(results: dict[float, DiagnosisScore]) -> dict:
    def row(s: TypeScore) -> dict:
        return {**s.model_dump(), "precision": s.precision, "recall": s.recall, "f1": s.f1, "mean_iou": s.mean_iou}
    return {f"{j:g}": {"per_type": {k: row(v) for k, v in s.per_type.items()},
                       "rules_types": row(subtotal(s)), "all": row(s.total)} for j, s in results.items()}


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--n", type=int, default=200)
    p.add_argument("--seed0", type=int, default=0)
    p.add_argument("--jitter-mm", type=float, nargs="+", default=[0.0, 1.0, 2.0, 4.0])
    p.add_argument("--iou", type=float, default=0.3)
    p.add_argument("--still-speed", type=float, help=f"override rules.STILL_SPEED ({rules.STILL_SPEED})")
    p.add_argument("--jitter-min-jerk", type=float, help=f"override rules.JITTER_MIN_JERK ({rules.JITTER_MIN_JERK})")
    p.add_argument("--json", type=Path, help="also write the scores here")
    args = p.parse_args(argv)
    if args.still_speed is not None:
        rules.STILL_SPEED = args.still_speed
    if args.jitter_min_jerk is not None:
        rules.JITTER_MIN_JERK = args.jitter_min_jerk

    results = run(args.n, args.seed0, args.jitter_mm, args.iou)
    print(f"rules on {args.n} degraded demos (seeds {args.seed0}..{args.seed0 + args.n - 1}), IoU >= {args.iou}, "
          f"STILL_SPEED={rules.STILL_SPEED}, JITTER_MIN_JERK={rules.JITTER_MIN_JERK}")
    print(table(results))
    if args.json:
        args.json.write_text(json.dumps(_as_json(results), indent=2))


if __name__ == "__main__":
    main()
