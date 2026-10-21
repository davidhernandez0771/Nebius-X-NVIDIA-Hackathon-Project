r"""The practice-and-correct round in one GPU command (sim_eval/correction_round.py has the phases).

    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\correction_round.py --run-id corr_mouse_r1 ^
        --checkpoint data\experiments\hx_mouse20261020_20261020_164411\train\perfected_multiply_10\checkpoints\030000\pretrained_model ^
        --source-cell perfected_multiply_10 --base-grid data\human_exp\mouse20261020\grid.json ^
        --start-state data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 [--retake both] [--dry-run]

Takes C:\dev\gpu.lock for the whole run (waits, re-checking every 5 min, while another live terminal holds it) and
keeps the PC awake; the lock is released on any exit, failure and Ctrl+C included. Resumable: the same command after
a crash skips the finished phases. Logs: DATA_DIR/evals/<run>/correction_round.log and logs/<phase>.log.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]  # this worktree's demo_pipeline first (the Isaac env has another's)
from sim_worker.own_code import check_own_code  # noqa: E402

from sim_eval.correction_round import RoundConfig, plan_round  # noqa: E402
from sim_eval.overnight import run_phases  # noqa: E402
from sim_worker.gpulock import GpuLock  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402


def _abs(p: str) -> Path:
    path = Path(p)
    return path if path.is_absolute() else REPO / path


def main(argv: list[str] | None = None) -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--run-id", required=True)
    p.add_argument("--checkpoint", required=True, help="the policy's pretrained_model folder")
    p.add_argument("--source-cell", required=True, help="the policy's cell label in --base-grid")
    p.add_argument("--base-grid", required=True, help="the experiment grid the policy was trained from")
    p.add_argument("--start-state", required=True, help="the dataset root whose start_state.json the evals use")
    p.add_argument("--practice-seed0", type=int, default=5200)
    p.add_argument("--practice-n", type=int, default=60)
    p.add_argument("--retake", choices=("scripted", "human", "both"), default="both")
    p.add_argument("--rewind-s", type=float, default=1.0)
    p.add_argument("--min-corrections", type=int, default=10)
    p.add_argument("--isaac-py", default=r"C:\isaac\env_isaaclab\Scripts\python.exe")
    p.add_argument("--lerobot-py", default=r"C:\venvs\lerobot\Scripts\python.exe")
    p.add_argument("--dry-run", action="store_true", help="print the phases and what is already done, run nothing")
    args = p.parse_args(argv)
    cfg = RoundConfig(repo=REPO, run_id=args.run_id, isaac_py=Path(args.isaac_py), lerobot_py=Path(args.lerobot_py),
                      checkpoint=_abs(args.checkpoint), source_cell=args.source_cell, base_grid=_abs(args.base_grid),
                      start_state=_abs(args.start_state), practice_seed0=args.practice_seed0,
                      practice_n=args.practice_n, retake=args.retake, rewind_s=args.rewind_s,
                      min_corrections=args.min_corrections)
    log_path = cfg.evals_dir / "correction_round.log"

    def log(msg: str) -> None:
        line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
        print(line, flush=True)
        if log_path.parent.is_dir():
            with log_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    phases = plan_round(cfg, log)
    if args.dry_run:  # writes nothing
        for ph in phases:
            print(f"{ph.name:12s} {'done' if ph.done() else 'to do':6s} {ph.describe}")
        return 0
    cfg.evals_dir.mkdir(parents=True, exist_ok=True)
    status_path = cfg.evals_dir / "correction_round_status.json"
    status = {"run_id": cfg.run_id, "started": datetime.now().isoformat(timespec="seconds"), "status": "running"}
    status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
    try:
        with GpuLock(task=cfg.run_id, log=log), KeepAwake():
            run_phases(phases, log)
        status.update(status="done")
        return 0
    except BaseException as exc:  # noqa: BLE001 - record any failure (even Ctrl+C) before the lock is released
        log(f"[corrections] FAILED: {exc!r}\n{traceback.format_exc()}")
        status.update(status="failed", error=repr(exc))
        return 1
    finally:
        status["finished"] = datetime.now().isoformat(timespec="seconds")
        status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
        log(f"[corrections] {status['status']}; GPU lock released")


if __name__ == "__main__":
    sys.exit(main())
