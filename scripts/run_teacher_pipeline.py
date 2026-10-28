"""The teacher recipe, end to end: T3's RL teacher, the teacher gate, T6's distillation round 0 (+ DAgger round 1).
The stages, markers and resume rules are app.pipeline.teacher_runner's; this is its command line.

    uv run --no-sync python scripts/run_teacher_pipeline.py --name pl_x --human-run mouse20261020 --until plan
    uv run --no-sync python scripts/run_teacher_pipeline.py --name pl_x --human-run mouse20261020 --teacher-n 300
    ... --smoke                 T3's and T6's smoke sizes, no gate threshold (proves every stage runs; measures nothing)
    ... --dagger                a DAgger round after round 0
    ... --repo C:\\dev\\pm-x      where T3's and T6's scripts are (default: SANT_TEACHER_REPO, else this checkout)

The site starts it (app/pipeline/runs.py) for a "teacher" recipe. Its log is DATA_DIR/teacher/<name>/run.log, each child's
output DATA_DIR/teacher/<name>/logs/<stage>.log; writing DATA_DIR/teacher/<name>/STOP stops it before the next stage.
gpu.lock: T3's train and verify and T6's round take it themselves; this runner takes it (with KeepAwake and Isaac's
gate) only around T3's eval, which doesn't. A stand-in repo for tests (a PIPELINE_STUB_REPO file at its root, never
in a real checkout) runs without the lock.
Exit: 0 done, 1 refused, 2 stopped.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from app.pipeline.teacher_runner import (ISAAC_PY, Refused, Stop, TeacherConfig, TeacherDeps,  # noqa: E402
                                         TeacherRun)
from demo_pipeline.paths import data_dir  # noqa: E402

STUB_MARKER = "PIPELINE_STUB_REPO"


def child_env(repo: Path) -> dict:
    """The called checkout's code first (the Isaac venv's editable install points at another worktree)."""
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    env.update(PYTHONPATH=f"{repo / 'src'}{os.pathsep}{repo}", PYTHONUNBUFFERED="1")
    return env


def make_run(repo: Path):
    def run(cmd: list[str], log: Path) -> int:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as f:
            f.write(f"\n=== {datetime.now(timezone.utc).isoformat(timespec='seconds')} {' '.join(cmd)}\n")
            f.flush()
            return subprocess.run(cmd, cwd=repo, env=child_env(repo), stdout=f, stderr=subprocess.STDOUT).returncode
    return run


def make_gpu_lock(repo: Path, log):
    if (repo / STUB_MARKER).is_file():
        @contextmanager
        def no_lock(task: str):
            log(f"[gpu.lock] stand-in repo ({STUB_MARKER}): no lock for {task}")
            yield
        return no_lock
    # The human-demo runner's GPU stage: gpu.lock, KeepAwake, and Isaac's gate (no other Isaac python, 8 GB free)
    path = REPO / "scripts" / "run_human_demo_experiment.py"
    spec = importlib.util.spec_from_file_location("run_human_demo_experiment", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    stage = mod.make_gpu_stage(log)

    @contextmanager
    def lock(task: str):
        try:
            with stage(task):
                yield
        except mod.Stop as e:
            raise Stop(str(e)) from None
    return lock


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--name", required=True)
    p.add_argument("--human-run", required=True, help="DATA_DIR/human_exp/<name>: the SANT data the student starts from")
    p.add_argument("--teacher-n", type=int, default=300, help="teacher rollouts in round 0 (300 or 600)")
    p.add_argument("--rl-iterations", type=int, default=1500)
    p.add_argument("--dagger", action="store_true")
    p.add_argument("--smoke", action="store_true")
    p.add_argument("--until", choices=["plan", "results"], default="results")
    p.add_argument("--repo", type=Path, default=Path(os.environ.get("SANT_TEACHER_REPO") or REPO))
    p.add_argument("--isaac-py", type=Path, default=Path(os.environ.get("ISAAC_PY") or ISAAC_PY))
    a = p.parse_args(argv)

    cfg = TeacherConfig(name=a.name, data=data_dir(), repo=a.repo.resolve(), human_run=a.human_run,
                        rl_iterations=a.rl_iterations, teacher_n=a.teacher_n, dagger=a.dagger, smoke=a.smoke,
                        isaac_py=a.isaac_py)
    holder: dict = {}

    def log(msg: str) -> None:
        print(msg, flush=True)

    deps = TeacherDeps(run=make_run(cfg.repo), gpu_lock=lambda task: holder["lock"](task), log=log)
    t = TeacherRun(cfg, deps)
    try:
        holder["lock"] = make_gpu_lock(cfg.repo, t.log)
        t.run(until=a.until)
        return 0
    except Refused as e:
        t.log(f"REFUSED: {e}")
        return 1
    except Stop as e:
        t.log(f"STOPPED: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
