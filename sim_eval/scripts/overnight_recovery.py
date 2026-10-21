r"""Grasp-fix run 2 in one unattended command: recovery copies + longer training, then the official test once.

    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\overnight_recovery.py            # the real run
    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\overnight_recovery.py --smoke    # minutes, no test
    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\overnight_recovery.py --dry-run  # print the plan

Takes C:\dev\gpu.lock for the whole run (waits, re-checking every 5 min, while another live terminal holds it or
the GPU is busy) and keeps the PC awake (sim_worker.keepawake) until it ends; the lock is deleted even on failure.
The phases and the seed rules are in sim_eval/overnight.py. Every phase is resumable: re-running the same command
after a crash skips what is done. Logs: DATA_DIR/evals/recovery_run2[_smoke]/overnight.log and logs/<phase>.log;
the last state is in overnight_status.json, the result in summary.json / summary.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]  # this worktree's demo_pipeline first (the Isaac env has pm-t2's)
from sim_worker.own_code import check_own_code  # noqa: E402

from sim_eval.overnight import Config, plan, run_phases  # noqa: E402
from sim_worker.gpulock import GpuLock  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--smoke", action="store_true", help="tiny end-to-end run of the GPU parts; never the test seeds")
    p.add_argument("--dry-run", action="store_true", help="print the phases and what is already done, run nothing")
    args = p.parse_args(argv)
    cfg = Config.default(REPO, smoke=args.smoke)
    cfg.evals_dir.mkdir(parents=True, exist_ok=True)
    log_path = cfg.evals_dir / "overnight.log"
    status_path = cfg.evals_dir / "overnight_status.json"

    def log(msg: str) -> None:
        line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
        print(line, flush=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    phases = plan(cfg, log)
    if args.dry_run:
        for ph in phases:
            print(f"{ph.name:10s} {'done' if ph.done() else 'to do':6s} {ph.describe}")
        return 0

    status = {"run_id": cfg.run_id, "started": datetime.now().isoformat(timespec="seconds"), "status": "running"}
    status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
    try:
        with GpuLock(task=cfg.run_id, log=log), KeepAwake():
            run_phases(phases, log)
        status.update(status="done")
        return 0
    except BaseException as exc:  # noqa: BLE001 - record any failure (even Ctrl+C) before the lock is released
        log(f"[overnight] FAILED: {exc!r}\n{traceback.format_exc()}")
        status.update(status="failed", error=repr(exc))
        return 1
    finally:
        status["finished"] = datetime.now().isoformat(timespec="seconds")
        status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
        log(f"[overnight] {status['status']}; GPU lock released")


if __name__ == "__main__":
    sys.exit(main())
