"""Compare a parallel eval with a serial one on the same seeds: do the outcomes agree, and how much faster is it?

Outcomes need not match bit for bit: N envs share one PhysX scene and a slot resets while its neighbours move, so
tiny numeric differences can grow over a 1,500-step closed loop. Agreement is reported per seed, never assumed.
Serial episodes run back to back, so the serial wall time is the sum of their wall_s; parallel episodes overlap,
so the parallel run's own total wall time is passed in.
"""

from __future__ import annotations

import json
from pathlib import Path

from sim_eval.results import EpisodeResult


def load_episodes(path: Path) -> list[EpisodeResult]:
    """The episodes of a sim_eval results file (sim_eval.report.write_results)."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if "episodes" not in data:
        raise ValueError(f"{path}: no 'episodes' list; not a sim_eval results file")
    return [EpisodeResult.model_validate(e) for e in data["episodes"]]


def compare_runs(serial: list[EpisodeResult], parallel: list[EpisodeResult], *,
                 parallel_wall_s: float | None = None) -> dict:
    by_seed = {e.seed: e for e in serial}
    missing = sorted(e.seed for e in parallel if e.seed not in by_seed)
    if missing:
        raise ValueError(f"parallel seeds the serial run did not evaluate: {missing}")
    pairs = [(by_seed[p.seed], p) for p in sorted(parallel, key=lambda e: e.seed)]
    rows = [{"seed": p.seed, "serial": s.ended_by, "parallel": p.ended_by, "serial_steps": s.steps,
             "parallel_steps": p.steps, "serial_reasons": s.reasons, "parallel_reasons": p.reasons}
            for s, p in pairs]
    serial_wall = sum(s.wall_s for s, _ in pairs)
    return {
        "seeds": [p.seed for _, p in pairs],
        "n": len(pairs),
        "serial_successes": sum(s.success for s, _ in pairs),
        "parallel_successes": sum(p.success for _, p in pairs),
        "outcome_agree": sum(s.success == p.success for s, p in pairs),
        "disagree_seeds": [p.seed for s, p in pairs if s.success != p.success],
        "serial_wall_s": serial_wall,
        "parallel_wall_s": parallel_wall_s,
        "speedup": serial_wall / parallel_wall_s if parallel_wall_s else None,
        "rows": rows,
    }
