"""Pure helpers for scripts/run_eval.py: check the policy server fits the sim before launching Isaac, and write
the results file. No Isaac imports."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from sim_eval.eval_policy import ACTION_DIM
from sim_eval.results import EpisodeResult, EvalSummary

SIM_CAMERAS = ("front", "wrist")  # what sim_worker.scene_cfg renders


def preflight(health: dict, *, cameras: bool, image_size: int, sim_cameras=SIM_CAMERAS) -> list[str]:
    """Problems that would make every episode a policy_error. Empty list = good to go."""
    problems = []
    if health.get("state_dim") != ACTION_DIM:
        problems.append(f"policy state_dim is {health.get('state_dim')}, the Franka sim gives {ACTION_DIM}")
    wanted = health.get("cameras") or {}
    if wanted and not cameras:
        problems.append(f"the policy needs cameras {sorted(wanted)}; pass --cameras")
    for cam, hw in wanted.items():
        if cam not in sim_cameras:
            problems.append(f"the policy needs camera {cam!r}; the sim renders {list(sim_cameras)}")
        elif list(hw) != [image_size, image_size]:
            problems.append(f"the policy expects {cam} at {hw[0]}x{hw[1]}; the sim renders {image_size}x{image_size}")
    return problems


def default_results_path(data_root: Path, cell: str | None) -> Path:
    return Path(data_root) / "evals" / f"{cell or 'adhoc'}_{datetime.now():%Y%m%d_%H%M%S}.json"


def write_results(path: Path, run: dict, episodes: list[EpisodeResult], summary: EvalSummary) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"run": run, "summary": summary.model_dump(), "episodes": [e.model_dump() for e in episodes]}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path
