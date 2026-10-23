r"""The 2026-10-23 big test, the whole chain in one restartable command (sim_eval/bigtest.py has the stages).

    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\bigtest.py [--dry-run] [--prepare] [--stop-after A]

Waits for T3's held-human done marker, then takes C:\dev\gpu.lock for the whole chain (A, B, the test) and keeps the
PC awake; the lock is released on any exit, failure and Ctrl+C included. The same command after a crash skips the
finished stages (and inside a stage the finished phases; a crashed training run resumes in its own folder).
--prepare: CPU only, no lock: check the teacher checkpoint's sha256 and copy the reused teacher rollouts now.
Logs: data/distill/bigtest/bigtest.log (everything) and run_log.txt (the prereg's run log, shared with T3's run).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]  # this worktree's demo_pipeline first (the Isaac env has another's)
from sim_worker.own_code import check_own_code  # noqa: E402

from sim_eval.bigtest import BigTest, copy_teacher, plan, sha256  # noqa: E402
from sim_eval.distill_round import code_version  # noqa: E402
from sim_eval.overnight import run_phases  # noqa: E402
from sim_worker.gpulock import GpuLock  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    from sim_worker.teleop_qos import full_speed

    full_speed()  # out of Windows power throttling (per process: a child does not inherit it)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dry-run", action="store_true", help="print the stages and what is done; run nothing")
    p.add_argument("--prepare", action="store_true", help="CPU only: teacher sha256 + copy the teacher rollouts")
    p.add_argument("--stop-after", choices=("human+teacher", "A", "B", "test"), default=None)
    p.add_argument("--poll-s", type=float, default=60.0, help="how often to look for T3's done marker")
    args = p.parse_args(argv)
    bt = BigTest(repo=REPO)

    def log(msg: str) -> None:
        line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
        print(line, flush=True)
        if bt.dir.is_dir():
            for path in (bt.dir / "bigtest.log", bt.run_log):
                with path.open("a", encoding="utf-8") as f:
                    f.write(line + "\n")

    phases = plan(bt, log, stop_after=args.stop_after)
    if args.dry_run:  # writes nothing
        for ph in phases:
            try:
                state = "done" if ph.done() else "to do"
            except Exception as e:  # noqa: BLE001 - e.g. a stage that needs T3's marker first
                state = f"to do ({type(e).__name__})"
            print(f"{ph.name:14s} {state:10s} {ph.describe}")
        return 0
    bt.dir.mkdir(parents=True, exist_ok=True)
    if args.prepare:
        got = sha256(bt.teacher_checkpoint)
        if got != bt.teacher_sha256:
            log(f"[bigtest] REFUSING: teacher sha256 {got} != {bt.teacher_sha256}")
            return 1
        info = copy_teacher(bt, log)
        log(f"[bigtest] prepare: teacher sha256 ok; {info['episodes']} episodes, {info['files']} files copied")
        return 0
    status_path = bt.dir / "bigtest_status.json"
    status = {"started": datetime.now().isoformat(timespec="seconds"), "status": "waiting for T3"}
    status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
    try:
        if not (bt.dir / "human_choice.json").exists():
            waited = 0.0
            while not bt.held_done.exists():
                if waited % 1800 < args.poll_s:
                    log(f"[bigtest] waiting for T3's done marker {bt.held_done}")
                time.sleep(args.poll_s)
                waited += args.poll_s
        status["status"] = "running"
        status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
        log(f"[bigtest] chain start; code {code_version(REPO)}")
        with GpuLock(task="bigtest", terminal="T6", log=log), KeepAwake():
            run_phases(phases, log)
        status.update(status="done")
        return 0
    except BaseException as exc:  # noqa: BLE001 - record any failure (even Ctrl+C) before the lock is released
        log(f"[bigtest] FAILED: {exc!r}\n{traceback.format_exc()}")
        status.update(status="failed", error=repr(exc))
        return 1
    finally:
        status["finished"] = datetime.now().isoformat(timespec="seconds")
        status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
        log(f"[bigtest] {status['status']}; GPU lock released")


if __name__ == "__main__":
    sys.exit(main())
