"""Train the RL teacher: Isaac Lab's own rsl_rl trainer (scripts/reinforcement_learning/train.py) on SANT's env
(sim_worker/rl_register.py), with the GPU lock, Isaac's gate and KeepAwake, as every SANT GPU stage.

    uv run --no-sync python scripts/rl_train.py --smoke                      # 64 envs x 20 iterations (~5 min)
    uv run --no-sync python scripts/rl_train.py --run-name demo_v1           # 4096 envs x 1500 iterations
    uv run --no-sync python scripts/rl_train.py --run-name nodemo_v1 --no-demos   # the "RL without demos" arm
    ... --checkpoint <run dir or model_<i>.pt>      # resume
    ... --override env.events.reset_scene.params.demo_prob=0.8   # Hydra overrides, repeatable (env.* / agent.*)

Logs and checkpoints land in data/rl/logs/rsl_rl/<experiment>/<timestamp>_<run-name>/ (model_<i>.pt every 50
iterations, TensorBoard events; data/ is gitignored); the trainer's console goes to data/rl/<run-name>.log too.
Metrics/check_success there is the unchanged check_success on every 8th environment's episodes.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

ISAACLAB = Path(os.environ.get("ISAACLAB", r"C:\isaac\IsaacLab"))
ISAAC_PY = Path(os.environ.get("ISAAC_PY", r"C:\isaac\env_isaaclab\Scripts\python.exe"))
WORKDIR = REPO / "data" / "rl"
BANK = WORKDIR / "bank_mouse20261020.npz"
TASKS = {True: "SANT-PickPlace-Franka-RL-v0", False: "SANT-PickPlace-Franka-RL-NoDemo-v0"}
SMOKE = {"num_envs": 64, "max_iterations": 20}
FULL = {"num_envs": 4096, "max_iterations": 1500}


def train_command(*, demos: bool, num_envs: int, max_iterations: int, run_name: str, checkpoint: str | None = None,
                  overrides: list[str] = (), viz: bool = False) -> list[str]:
    """The trainer's command line."""
    cmd = [str(ISAAC_PY), str(ISAACLAB / "scripts" / "reinforcement_learning" / "train.py"), "--rl_library", "rsl_rl",
           "--task", TASKS[demos], "--external_callback", "sim_worker.rl_register.register",
           "--num_envs", str(num_envs), "--max_iterations", str(max_iterations), "--run_name", run_name]
    if checkpoint:
        cmd += ["--checkpoint", str(checkpoint)]
    if viz:
        cmd += ["--viz", "kit"]
    return cmd + list(overrides)


def child_env() -> dict:
    """This checkout's code first (the Isaac venv's editable install points at another worktree)."""
    env = {k: v for k, v in os.environ.items() if k != "VIRTUAL_ENV"}
    # utf-8: Isaac Lab's loading screen prints box-drawing characters, and a piped stdout is cp1252 on Windows
    # (the first smoke run, 2026-10-21, died there)
    env.update(PYTHONPATH=f"{REPO};{REPO / 'src'}", PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    return env


def _gpu_stage(log):
    path = REPO / "scripts" / "run_human_demo_experiment.py"
    spec = importlib.util.spec_from_file_location("run_human_demo_experiment", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.make_gpu_stage(log)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--smoke", action="store_true", help="64 envs x 20 iterations: does it run, how fast")
    p.add_argument("--run-name", default=None)
    p.add_argument("--no-demos", action="store_true", help="home starts only: the RL-without-demos control arm")
    p.add_argument("--num-envs", type=int, default=None)
    p.add_argument("--max-iterations", type=int, default=None)
    p.add_argument("--checkpoint", default=None, help="resume from this run dir or model_<i>.pt")
    p.add_argument("--override", action="append", default=[], help="a Hydra override, e.g. agent.algorithm.gamma=0.995")
    p.add_argument("--viz", action="store_true", help="open Kit's window (slower; Isaac runs headless by default)")
    p.add_argument("--dry-run", action="store_true", help="print the command and exit")
    args = p.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # it echoes the trainer's Unicode, maybe into a file
    size = {**(SMOKE if args.smoke else FULL)}
    if args.num_envs:
        size["num_envs"] = args.num_envs
    if args.max_iterations:
        size["max_iterations"] = args.max_iterations
    run = args.run_name or ("smoke" if args.smoke else "run")
    cmd = train_command(demos=not args.no_demos, run_name=run, checkpoint=args.checkpoint, overrides=args.override,
                        viz=args.viz, **size)
    print(" ".join(cmd))
    if args.dry_run:
        return 0
    if not args.no_demos and not BANK.is_file():
        p.error(f"no demo-start bank at {BANK}: run scripts/rl_demo_bank.py first (see the note)")
    WORKDIR.mkdir(parents=True, exist_ok=True)
    log_path = WORKDIR / f"{run}.log"
    with log_path.open("a", encoding="utf-8") as f, _gpu_stage(print)(f"rl-teacher:{run}"):
        f.write(" ".join(cmd) + "\n")
        f.flush()
        proc = subprocess.Popen(cmd, cwd=WORKDIR, env=child_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace")
        for line in proc.stdout:  # the console, and the log
            sys.stdout.write(line)
            f.write(line)
        return proc.wait()


if __name__ == "__main__":
    sys.exit(main())
