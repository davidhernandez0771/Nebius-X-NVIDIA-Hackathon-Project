"""Experiment runner: for each cell of a grid, assemble its dataset, train ACT on it, and log a registry row.

    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.experiments --grid grid.json --steps 10000 `
        [--save-freq 2500] [--dry-run]

grid.json (relative episode dirs resolve against the grid file's folder):
    {"name": "pilot", "cells": [{"condition": "raw", "n_human": 5, "episode_dirs": ["..."]}, ...]}

Layout under DATA_DIR (demo_pipeline.paths.data_dir(), git-ignored):
    experiments/<run_id>/datasets/<cell>/    LeRobot dataset + manifest.json (lerobot_tools.assemble)
    experiments/<run_id>/train/<cell>/       lerobot-train output (lerobot_tools.train: last.txt, no symlink)
    experiments/<run_id>/logs/<cell>.log
    results/registry.jsonl                   one row per cell per run; appended, never rewritten

A cell that fails (invalid, export error, training exit != 0) gets a row with status "failed" and the error, and the
grid goes on. Each row records the loss curve ([step, loss] every logged step) and every saved checkpoint
(`checkpoint` is the last one; --save-freq leaves resume points for lerobot_tools.train --resume-last).
`eval_success` is null: the sim eval fills it in later. `--dry-run` validates every cell and prints the
plan as JSON, writing nothing.

Training options (the 2026-10-20 research note, Part 3 (c) Stage 1), the same for every cell of the grid and recorded
in each row's `train_options`; the defaults are the recipe every earlier run used:
    --augment shift   LeRobot image transforms on: random affine (translate 5%, +-5 deg) + mild brightness/contrast,
                      at most 2 per frame (robomimic: -47% relative without pixel shifts). Default off.
    --dilation        ResNet's final stride replaced by dilation: 8x8 image tokens at 128 px instead of 4x4 (the cube
                      is ~7 px wide in the front camera). Default off.
Checkpoint selection on practice seeds is the eval's job: sim_eval/scripts/eval_cells.py --select-steps.

--resume-run <experiments/<run_id>> (the 2026-10-23 big test's restart after a crash): the same run folder again. A
cell's finished export (manifest.json, written last) is kept and a partial one moved aside to <cell>.partial-<time>
(never deleted); training resumes from checkpoints/last.txt (lerobot_tools.train --resume-last), and a training
folder without one is moved aside and starts over. Rows record "resumed": true.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from sim_worker.own_code import check_own_code, put_own_code_first

put_own_code_first()  # this checkout's src before the venv's editable install (it points at another worktree)

from demo_pipeline.paths import data_dir  # noqa: E402
from lerobot_tools.assemble import MANIFEST_FILE, Cell, build_manifest  # noqa: E402
from lerobot_tools.train import MAX_BATCH, MAX_STEPS, resolve_last_checkpoint  # noqa: E402

REGISTRY_FIELDS = ("run_id", "grid", "cell", "dataset", "checkpoint", "checkpoints", "steps", "save_freq",
                   "batch_size", "policy", "train_options", "n_episodes", "n_frames", "train_time_s", "final_loss",
                   "loss_curve", "log", "eval_success", "status", "error", "created")
POLICY = "act"
AUGMENTS = ("off", "shift")
# --augment shift: LeRobot's affine transform plus mild brightness/contrast (no hue, saturation or sharpness), at most
# 2 of the 3 per frame. Passed as JSON: draccus can't override one entry of the transforms dict.
SHIFT_TRANSFORMS = {
    "brightness": {"weight": 1.0, "type": "ColorJitter", "kwargs": {"brightness": [0.8, 1.2]}},
    "contrast": {"weight": 1.0, "type": "ColorJitter", "kwargs": {"contrast": [0.8, 1.2]}},
    "affine": {"weight": 1.0, "type": "RandomAffine", "kwargs": {"degrees": [-5.0, 5.0], "translate": [0.05, 0.05]}},
}


@dataclass(frozen=True)
class TrainOptions:
    augment: str = "off"
    dilation: bool = False

    def __post_init__(self):
        if self.augment not in AUGMENTS:
            raise ValueError(f"augment must be one of {AUGMENTS}, got {self.augment!r}")

    def record(self) -> dict:
        return {"augment": self.augment, "dilation": self.dilation}

    def lerobot_args(self) -> list[str]:
        out = []
        if self.augment == "shift":
            out += ["--dataset.image_transforms.enable=true", "--dataset.image_transforms.max_num_transforms=2",
                    "--dataset.image_transforms.tfs=" + json.dumps(SHIFT_TRANSFORMS, separators=(",", ":"))]
        if self.dilation:
            out += ["--policy.replace_final_stride_with_dilation=true"]
        return out


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
    loss_curve: list[list[float]] = field(default_factory=list)  # [step, loss] per logged step
    checkpoints: list[Path] = field(default_factory=list)  # every saved step's pretrained_model, in step order


def load_grid(path: Path) -> Grid:
    path = Path(path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    for cell in raw.get("cells", []):
        cell["episode_dirs"] = [str((path.parent / d).resolve()) for d in cell.get("episode_dirs", [])]
    return Grid.model_validate(raw)


def _saved_checkpoints(out_dir: Path) -> list[Path]:
    root = Path(out_dir) / "checkpoints"
    if not root.is_dir():
        return []
    return [d / "pretrained_model" for d in sorted(root.iterdir())
            if d.name.isdigit() and (d / "pretrained_model").is_dir()]


def train_command(manifest: dict, dataset: Path, out_dir: Path, *, steps: int, batch_size: int,
                  save_freq: int | None = None, options: TrainOptions | None = None, resume: bool = False) -> list[str]:
    """The lerobot_tools.train command line for one cell: today's recipe, then the options' extra flags. resume: from
    out_dir's checkpoints/last.txt."""
    return [sys.executable, "-m", "lerobot_tools.train", *(["--resume-last", str(out_dir)] if resume else []),
            f"--policy.type={POLICY}", "--policy.device=cuda", "--policy.push_to_hub=false",
            f"--dataset.repo_id={manifest['repo_id']}", f"--dataset.root={dataset}", f"--output_dir={out_dir}",
            f"--steps={steps}", f"--batch_size={batch_size}", f"--save_freq={save_freq or steps}",
            f"--log_freq={min(50, steps)}", "--wandb.enable=false", *(options or TrainOptions()).lerobot_args()]


def train_cell(dataset: Path, out_dir: Path, steps: int, batch_size: int, log_path: Path,
               save_freq: int | None = None, options: TrainOptions | None = None, resume: bool = False) -> TrainResult:
    """Train in a subprocess through the symlink-free wrapper; one process per cell keeps GPU memory and lerobot's
    global state from leaking between cells."""
    from lerobot_tools.train_smoke import parse_train_log  # pulls in PIL: lerobot venv only

    manifest = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    cmd = train_command(manifest, dataset, out_dir, steps=steps, batch_size=batch_size, save_freq=save_freq,
                        options=options, resume=resume)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    with log_path.open("a" if resume else "w", encoding="utf-8") as log:
        proc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=Path(__file__).parents[1])
    elapsed = round(time.perf_counter() - t0, 1)
    text = log_path.read_text(encoding="utf-8", errors="replace")
    parsed = parse_train_log(text)
    losses = parsed.get("loss_first_last")
    try:
        checkpoint = resolve_last_checkpoint(out_dir) / "pretrained_model"
    except FileNotFoundError:
        checkpoint = None
    error = None
    if proc.returncode != 0 or checkpoint is None:
        tail = [ln for ln in text.strip().splitlines() if ln.strip()][-3:]
        error = f"lerobot-train exit {proc.returncode}: " + " | ".join(tail)
    return TrainResult(proc.returncode, checkpoint, elapsed, losses[1] if losses else None, error,
                       loss_curve=parsed["loss_curve"], checkpoints=_saved_checkpoints(out_dir))


def _row(run_id: str, grid: Grid, cell: Cell, steps: int, batch_size: int, train_options: TrainOptions,
         **values) -> dict:
    row = dict.fromkeys(REGISTRY_FIELDS)
    row.update(run_id=run_id, grid=grid.name, cell={"condition": cell.condition, "n_human": cell.n_human,
               "name": cell.name}, steps=steps, batch_size=batch_size, policy=POLICY,
               train_options=train_options.record(), created=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    row.update(values)
    return row


def _move_aside(path: Path) -> None:
    path.rename(path.with_name(f"{path.name}.partial-{datetime.now():%Y%m%d_%H%M%S}"))


def run_grid(grid: Grid, steps: int, batch_size: int, runs_root: Path, registry: Path,
             assemble_fn: Callable[[Cell, Path], Path] | None = None,
             train_fn: Callable[..., TrainResult] = train_cell, save_freq: int | None = None,
             train_options: TrainOptions | None = None, resume_run: Path | None = None) -> list[dict]:
    """Run every cell; append one registry row per cell as soon as it finishes. Returns the rows. resume_run: an
    earlier run folder of this grid to finish (see the module doc)."""
    train_options = train_options or TrainOptions()
    if assemble_fn is None:
        from lerobot_tools.assemble import assemble as assemble_fn
    run_id = Path(resume_run).name if resume_run else f"{grid.name}_{datetime.now():%Y%m%d_%H%M%S}"
    run_dir = Path(resume_run) if resume_run else Path(runs_root) / run_id
    registry = Path(registry)
    registry.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for cell in grid.cells:
        resume = False
        try:
            manifest = build_manifest(cell)
            exported = run_dir / "datasets" / cell.name
            if resume_run and (exported / MANIFEST_FILE).is_file():
                dataset = exported
            else:
                if resume_run and exported.exists():
                    _move_aside(exported)
                dataset = assemble_fn(cell, run_dir / "datasets")
            out_dir = run_dir / "train" / cell.name
            if resume_run and (out_dir / "checkpoints" / "last.txt").is_file():
                resume = True
            elif resume_run and out_dir.exists():
                _move_aside(out_dir)
        except Exception as e:  # recorded, not raised: one bad cell must not lose the rest of the grid
            row = _row(run_id, grid, cell, steps, batch_size, train_options, status="failed",
                       error=f"{type(e).__name__}: {e}")
        else:
            log_path = run_dir / "logs" / f"{cell.name}.log"
            result = train_fn(dataset, out_dir, steps, batch_size, log_path, save_freq=save_freq,
                              options=train_options, **({"resume": True} if resume else {}))
            ok = result.exit_code == 0 and result.checkpoint is not None
            row = _row(run_id, grid, cell, steps, batch_size, train_options, dataset=str(dataset),
                       checkpoint=str(result.checkpoint) if result.checkpoint else None,
                       checkpoints=[str(c) for c in result.checkpoints], save_freq=save_freq or steps,
                       loss_curve=result.loss_curve, log=str(log_path),
                       n_episodes=manifest["n_episodes"], n_frames=manifest["n_frames"],
                       train_time_s=result.train_time_s, final_loss=result.final_loss,
                       status="ok" if ok else "failed", error=result.error,
                       **({"resumed": True} if resume_run else {}))
        with registry.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")
        rows.append(row)
    return rows


def dry_run(grid: Grid, steps: int, batch_size: int, save_freq: int | None = None,
            train_options: TrainOptions | None = None) -> dict:
    cells = []
    for cell in grid.cells:
        entry = {"cell": {"condition": cell.condition, "n_human": cell.n_human, "name": cell.name}}
        try:
            m = build_manifest(cell)
            entry.update(valid=True, n_episodes=m["n_episodes"], n_frames=m["n_frames"], human_roots=m["human_roots"])
        except Exception as e:
            entry.update(valid=False, error=f"{type(e).__name__}: {e}")
        cells.append(entry)
    return {"grid": grid.name, "steps": steps, "save_freq": save_freq or steps, "batch_size": batch_size,
            "policy": POLICY, "train_options": (train_options or TrainOptions()).record(),
            "runs_root": str(data_dir() / "experiments"), "registry": str(data_dir() / "results" / "registry.jsonl"),
            "cells": cells}


def main(argv: list[str] | None = None) -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    from sim_worker.teleop_qos import full_speed

    full_speed()  # out of Windows power throttling (per process: a child does not inherit it)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--grid", type=Path, required=True)
    p.add_argument("--steps", type=int, required=True)
    p.add_argument("--batch-size", type=int, default=MAX_BATCH)
    p.add_argument("--save-freq", type=int, default=None, help="checkpoint every N steps (default: only at the end)")
    p.add_argument("--augment", choices=AUGMENTS, default="off", help="image augmentation (default off, as before)")
    p.add_argument("--dilation", action="store_true", help="replace ResNet's final stride with dilation (8x8 tokens)")
    p.add_argument("--resume-run", type=Path, default=None, metavar="RUN_DIR",
                   help="finish this earlier run folder of the grid (keeps a finished export, resumes training)")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    if args.resume_run is not None and not args.resume_run.is_dir():
        p.error(f"--resume-run {args.resume_run}: no such run folder")
    options = TrainOptions(augment=args.augment, dilation=args.dilation)
    if not (0 < args.steps <= MAX_STEPS and 0 < args.batch_size <= MAX_BATCH):
        p.error(f"sprint GPU budget: steps <= {MAX_STEPS}, batch <= {MAX_BATCH}")
    if args.save_freq is not None and not 0 < args.save_freq <= args.steps:
        p.error(f"--save-freq must be in 1..{args.steps}")
    grid = load_grid(args.grid)
    if args.dry_run:
        plan = dry_run(grid, args.steps, args.batch_size, args.save_freq, options)
        print(json.dumps(plan, indent=2))
        return 0 if all(c["valid"] for c in plan["cells"]) else 1
    rows = run_grid(grid, args.steps, args.batch_size, data_dir() / "experiments",
                    data_dir() / "results" / "registry.jsonl", save_freq=args.save_freq, train_options=options,
                    resume_run=args.resume_run)
    print(json.dumps(rows, indent=2))
    return 0 if all(r["status"] == "ok" for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
