"""Experiment runner: for each cell of a grid, assemble its dataset, train ACT on it, and log a registry row.

    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.experiments --grid grid.json --steps 2000 [--dry-run]

grid.json (relative episode dirs resolve against the grid file's folder):
    {"name": "pilot", "cells": [{"condition": "raw", "n_human": 5, "episode_dirs": ["..."]}, ...]}

Layout under DATA_DIR (demo_pipeline.paths.data_dir(), git-ignored):
    experiments/<run_id>/datasets/<cell>/    LeRobot dataset + manifest.json (lerobot_tools.assemble)
    experiments/<run_id>/train/<cell>/       lerobot-train output (lerobot_tools.train: last.txt, no symlink)
    experiments/<run_id>/logs/<cell>.log
    results/registry.jsonl                   one row per cell per run; appended, never rewritten

A cell that fails (invalid, export error, training exit != 0) gets a row with status "failed" and the error, and the
grid goes on. `eval_success` is null: the sim eval fills it in later. `--dry-run` validates every cell and prints the
plan as JSON, writing nothing.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from demo_pipeline.paths import data_dir
from lerobot_tools.assemble import Cell, build_manifest
from lerobot_tools.train import MAX_BATCH, MAX_STEPS, resolve_last_checkpoint

REGISTRY_FIELDS = ("run_id", "grid", "cell", "dataset", "checkpoint", "steps", "batch_size", "policy",
                   "n_episodes", "n_frames", "train_time_s", "final_loss", "eval_success", "status", "error",
                   "created")
POLICY = "act"


class Grid(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=r"^[A-Za-z0-9_\-]+$")
    cells: list[Cell] = Field(min_length=1)


@dataclass
class TrainResult:
    exit_code: int
    checkpoint: Path | None
    train_time_s: float
    final_loss: float | None
    error: str | None


def load_grid(path: Path) -> Grid:
    path = Path(path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    for cell in raw.get("cells", []):
        cell["episode_dirs"] = [str((path.parent / d).resolve()) for d in cell.get("episode_dirs", [])]
    return Grid.model_validate(raw)


def train_cell(dataset: Path, out_dir: Path, steps: int, batch_size: int, log_path: Path) -> TrainResult:
    """Train in a subprocess through the symlink-free wrapper; one process per cell keeps GPU memory and lerobot's
    global state from leaking between cells."""
    from lerobot_tools.train_smoke import parse_train_log  # pulls in PIL: lerobot venv only

    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    cmd = [sys.executable, "-m", "lerobot_tools.train",
           f"--policy.type={POLICY}", "--policy.device=cuda", "--policy.push_to_hub=false",
           f"--dataset.repo_id={manifest['repo_id']}", f"--dataset.root={dataset}", f"--output_dir={out_dir}",
           f"--steps={steps}", f"--batch_size={batch_size}", f"--save_freq={steps}",
           f"--log_freq={min(50, steps)}", "--wandb.enable=false"]
    log_path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    with log_path.open("w", encoding="utf-8") as log:
        proc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=Path(__file__).parents[1])
    elapsed = round(time.perf_counter() - t0, 1)
    text = log_path.read_text(encoding="utf-8", errors="replace")
    losses = parse_train_log(text).get("loss_first_last")
    try:
        checkpoint = resolve_last_checkpoint(out_dir) / "pretrained_model"
    except FileNotFoundError:
        checkpoint = None
    error = None
    if proc.returncode != 0 or checkpoint is None:
        tail = [ln for ln in text.strip().splitlines() if ln.strip()][-3:]
        error = f"lerobot-train exit {proc.returncode}: " + " | ".join(tail)
    return TrainResult(proc.returncode, checkpoint, elapsed, losses[1] if losses else None, error)


def _row(run_id: str, grid: Grid, cell: Cell, steps: int, batch_size: int, **values) -> dict:
    row = dict.fromkeys(REGISTRY_FIELDS)
    row.update(run_id=run_id, grid=grid.name, cell={"condition": cell.condition, "n_human": cell.n_human,
               "name": cell.name}, steps=steps, batch_size=batch_size, policy=POLICY,
               created=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    row.update(values)
    return row


def run_grid(grid: Grid, steps: int, batch_size: int, runs_root: Path, registry: Path,
             assemble_fn: Callable[[Cell, Path], Path] | None = None,
             train_fn: Callable[..., TrainResult] = train_cell) -> list[dict]:
    """Run every cell; append one registry row per cell as soon as it finishes. Returns the rows."""
    if assemble_fn is None:
        from lerobot_tools.assemble import assemble as assemble_fn
    run_id = f"{grid.name}_{datetime.now():%Y%m%d_%H%M%S}"
    run_dir = Path(runs_root) / run_id
    registry = Path(registry)
    registry.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for cell in grid.cells:
        try:
            manifest = build_manifest(cell)
            dataset = assemble_fn(cell, run_dir / "datasets")
        except Exception as e:  # recorded, not raised: one bad cell must not lose the rest of the grid
            row = _row(run_id, grid, cell, steps, batch_size, status="failed", error=f"{type(e).__name__}: {e}")
        else:
            result = train_fn(dataset, run_dir / "train" / cell.name, steps, batch_size,
                              run_dir / "logs" / f"{cell.name}.log")
            ok = result.exit_code == 0 and result.checkpoint is not None
            row = _row(run_id, grid, cell, steps, batch_size, dataset=str(dataset),
                       checkpoint=str(result.checkpoint) if result.checkpoint else None,
                       n_episodes=manifest["n_episodes"], n_frames=manifest["n_frames"],
                       train_time_s=result.train_time_s, final_loss=result.final_loss,
                       status="ok" if ok else "failed", error=result.error)
        with registry.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        rows.append(row)
    return rows


def dry_run(grid: Grid, steps: int, batch_size: int) -> dict:
    cells = []
    for cell in grid.cells:
        entry = {"cell": {"condition": cell.condition, "n_human": cell.n_human, "name": cell.name}}
        try:
            m = build_manifest(cell)
            entry.update(valid=True, n_episodes=m["n_episodes"], n_frames=m["n_frames"], human_roots=m["human_roots"])
        except Exception as e:
            entry.update(valid=False, error=f"{type(e).__name__}: {e}")
        cells.append(entry)
    return {"grid": grid.name, "steps": steps, "batch_size": batch_size, "policy": POLICY,
            "runs_root": str(data_dir() / "experiments"), "registry": str(data_dir() / "results" / "registry.jsonl"),
            "cells": cells}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--grid", type=Path, required=True)
    p.add_argument("--steps", type=int, required=True)
    p.add_argument("--batch-size", type=int, default=MAX_BATCH)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    if not (0 < args.steps <= MAX_STEPS and 0 < args.batch_size <= MAX_BATCH):
        p.error(f"sprint GPU budget: steps <= {MAX_STEPS}, batch <= {MAX_BATCH}")
    grid = load_grid(args.grid)
    if args.dry_run:
        plan = dry_run(grid, args.steps, args.batch_size)
        print(json.dumps(plan, indent=2))
        return 0 if all(c["valid"] for c in plan["cells"]) else 1
    rows = run_grid(grid, args.steps, args.batch_size, data_dir() / "experiments",
                    data_dir() / "results" / "registry.jsonl")
    print(json.dumps(rows, indent=2))
    return 0 if all(r["status"] == "ok" for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
