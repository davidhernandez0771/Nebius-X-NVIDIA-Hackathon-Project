"""Pure helpers for scripts/run_eval.py: check the policy server fits the sim before launching Isaac, and write
the results file. No Isaac imports."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from sim_eval.eval_policy import ACTION_DIM
from sim_eval.registry import find_row
from sim_eval.results import EpisodeResult, EvalSummary
from sim_eval.start_state import START_STATE_FILE, check_start, load_starts

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


def resolve_start(mode: str, *, start_state: Path | None = None, registry: Path | None = None,
                  cell: str | None = None, checkpoint: str | None = None) -> tuple[list[float] | None, dict]:
    """Choose the eval reset pose (Review Focus 4). Returns (pose, record); pose None = the robot's default pose.

    The start states come from `start_state` (a start_state.json or the dataset root holding one), else from the
    dataset of the cell's registry row. Without any, "auto" and "default" fall back to the default pose and record
    why; "dataset" raises FileNotFoundError."""
    source, reason = start_state, None
    if source is None and registry is not None and cell is not None:
        try:
            source = find_row(registry, cell, checkpoint).get("dataset")
            if source is None:
                reason = f"registry row for {cell!r} has no dataset"
        except (OSError, LookupError, ValueError) as e:
            reason = f"registry lookup failed: {type(e).__name__}: {e}"
    starts = None
    if source is not None:
        try:
            starts = load_starts(Path(source))
        except (OSError, ValueError, KeyError) as e:
            reason = f"cannot read {START_STATE_FILE} from {source}: {type(e).__name__}: {e}"
    if starts is None:
        reason = reason or f"no {START_STATE_FILE} given (--start-state) and no --cell registry row to find one"
        if mode == "dataset":
            raise FileNotFoundError(reason)
        return None, {"available": False, "mode": mode, "chosen": "default", "reason": reason}
    check = check_start(starts, mode=mode)
    record = {"available": True, "mode": mode, "source": str(source), **check.model_dump()}
    return (check.reset_pose if check.chosen == "dataset_mean" else None), record


def default_results_path(data_root: Path, cell: str | None) -> Path:
    return Path(data_root) / "evals" / f"{cell or 'adhoc'}_{datetime.now():%Y%m%d_%H%M%S}.json"


def write_results(path: Path, run: dict, episodes: list[EpisodeResult], summary: EvalSummary) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"run": run, "summary": summary.model_dump(), "episodes": [e.model_dump() for e in episodes]}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path
