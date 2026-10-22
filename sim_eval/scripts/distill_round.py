r"""One teacher -> student distillation round in one GPU command (sim_eval/distill_round.py has the phases).

    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\distill_round.py --round 0 --run-id distill_mouse ^
        --teacher <package.module:factory> --teacher-checkpoint <T3's trained policy> ^
        --human-grid data\human_exp\mouse20261020\grid.json --human-cell perfected_multiply_10 ^
        --start-state data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 [--dry-run]
    ... the same with --round 1, then --round 2 (each after the previous round's selection exists)

Takes C:\dev\gpu.lock for the whole round (waits, re-checking every 5 min, while another live terminal holds it) and
keeps the PC awake; the lock is released on any exit, failure and Ctrl+C included. Resumable: the same command after
a crash skips the finished phases. Logs: data/distill/<run>/r<round>/distill_round.log and logs/<phase>.log.
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

from sim_eval.distill_round import DEFAULT_WEIGHTS, SOURCES, RoundConfig, plan_round  # noqa: E402
from sim_eval.overnight import run_phases  # noqa: E402
from sim_worker.gpulock import GpuLock  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402


def _abs(p: str) -> Path:
    path = Path(p)
    return path if path.is_absolute() else REPO / path


def _weights(specs: list[str]) -> dict:
    w = dict(DEFAULT_WEIGHTS)
    for spec in specs:
        name, sep, value = spec.partition("=")
        if not sep or name not in SOURCES:
            raise argparse.ArgumentTypeError(f"--weight {spec!r}: expected one of {SOURCES}=<number>")
        w[name] = float(value)
    return w


def main(argv: list[str] | None = None) -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    from sim_worker.teleop_qos import full_speed

    full_speed()  # out of Windows power throttling (per process: a child does not inherit it)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--round", type=int, required=True, choices=(0, 1, 2))
    p.add_argument("--run-id", required=True)
    p.add_argument("--teacher", required=True, help="package.module:factory (T3's RL teacher adapter)")
    p.add_argument("--teacher-checkpoint", required=True)
    p.add_argument("--human-grid", required=True, help="the SANT experiment grid with the human-derived cell")
    p.add_argument("--human-cell", required=True, help="its label (or <condition>_<n_human>)")
    p.add_argument("--start-state", required=True, help="the dataset root whose start_state.json the evals use")
    p.add_argument("--weight", action="append", default=[], metavar="SOURCE=W",
                   help=f"frame-share weight per source (default {DEFAULT_WEIGHTS}); 0 drops a source")
    p.add_argument("--teacher-seed0", type=int, default=4000)
    p.add_argument("--teacher-n", type=int, default=600)
    p.add_argument("--dagger-seed0", type=int, default=None, help="default: 5200 + (round - 1) * --dagger-n")
    p.add_argument("--dagger-n", type=int, default=40)
    p.add_argument("--beta", type=float, default=0.0)
    p.add_argument("--teacher-execution", choices=("tracking", "held"), default="tracking",
                   help="teacher-executed steps: its RL env's tracking, or one held 9-joint target as the student's "
                        "(option A); a held round needs its own --run-id")
    p.add_argument("--select-seed0", type=int, default=5300,
                   help="first selection seed (Amendment 4: 5301, 5300 excluded)")
    p.add_argument("--select-n", type=int, default=30)
    p.add_argument("--steps", type=int, default=60000)
    p.add_argument("--save-freq", type=int, default=10000)
    p.add_argument("--candidates", type=int, nargs="+", default=[40000, 60000])
    p.add_argument("--min-teacher", type=int, default=100)
    p.add_argument("--target-rate", type=float, default=0.9)
    p.add_argument("--min-gain", type=float, default=0.05)
    p.add_argument("--min-new-frames", type=int, default=5000)
    p.add_argument("--inference-args", default="", help='e.g. "--binarize-gripper --n-action-steps 20"')
    p.add_argument("--train-args", default="", help='e.g. "--augment shift"')
    p.add_argument("--isaac-py", default=r"C:\isaac\env_isaaclab\Scripts\python.exe")
    p.add_argument("--lerobot-py", default=r"C:\venvs\lerobot\Scripts\python.exe")
    p.add_argument("--stop-after", default=None, choices=("preflight", "rollouts", "decide", "grid", "train"),
                   help="run up to this phase (e.g. rollouts: check the teacher gate on --teacher-n 50 first)")
    p.add_argument("--dry-run", action="store_true", help="print the phases and what is already done, run nothing")
    args = p.parse_args(argv)
    try:
        weights = _weights(args.weight)
    except argparse.ArgumentTypeError as e:
        p.error(str(e))
    cfg = RoundConfig(repo=REPO, run_id=args.run_id, round_id=args.round, isaac_py=Path(args.isaac_py),
                      lerobot_py=Path(args.lerobot_py), teacher=args.teacher,
                      teacher_checkpoint=_abs(args.teacher_checkpoint), human_grid=_abs(args.human_grid),
                      human_cell=args.human_cell, start_state=_abs(args.start_state), weights=weights,
                      teacher_seed0=args.teacher_seed0, teacher_n=args.teacher_n, dagger_seed0=args.dagger_seed0,
                      dagger_n=args.dagger_n, beta=args.beta, teacher_execution=args.teacher_execution,
                      select_seed0=args.select_seed0, select_n=args.select_n, steps=args.steps,
                      save_freq=args.save_freq, candidates=tuple(args.candidates), min_teacher=args.min_teacher,
                      target_rate=args.target_rate, min_gain=args.min_gain, min_new_frames=args.min_new_frames,
                      inference_args=tuple(args.inference_args.split()), train_args=tuple(args.train_args.split()))
    log_path = cfg.round_dir() / "distill_round.log"

    def log(msg: str) -> None:
        line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
        print(line, flush=True)
        if log_path.parent.is_dir():
            with log_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    try:
        phases = plan_round(cfg, log, stop_after=args.stop_after)
    except ValueError as e:
        p.error(str(e))
    if args.dry_run:  # writes nothing
        for ph in phases:
            print(f"{ph.name:10s} {'done' if ph.done() else 'to do':6s} {ph.describe}")
        return 0
    cfg.round_dir().mkdir(parents=True, exist_ok=True)
    status_path = cfg.round_dir() / "distill_round_status.json"
    status = {"run_id": cfg.run_id, "round": cfg.round_id, "started": datetime.now().isoformat(timespec="seconds"),
              "status": "running"}
    status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
    try:
        with GpuLock(task=f"{cfg.run_id}_r{cfg.round_id}", log=log), KeepAwake():
            run_phases(phases, log)
        status.update(status="done")
        return 0
    except BaseException as exc:  # noqa: BLE001 - record any failure (even Ctrl+C) before the lock is released
        log(f"[distill] FAILED: {exc!r}\n{traceback.format_exc()}")
        status.update(status="failed", error=repr(exc))
        return 1
    finally:
        status["finished"] = datetime.now().isoformat(timespec="seconds")
        status_path.write_text(json.dumps(status, indent=1), encoding="utf-8")
        log(f"[distill] {status['status']}; GPU lock released")


if __name__ == "__main__":
    sys.exit(main())
