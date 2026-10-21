"""The Isaac Lab Mimic GPU smoke test: generate a few demos from SANT's export with SANT's Mimic env, holding the
GPU lock, then re-verify every generated demo with SANT's check_success (CPU).

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\mimic_smoke.py
        [--input data\\exports\\mimic\\human10c_sources.hdf5] [--output data\\exports\\mimic\\smoke_10.hdf5]
        [--trials 10] [--max-failures 30] [--timeout-s 1800] [--viz] [--dry-run]

- The lock is C:\\dev\\gpu.lock (sim_worker.gpu_lock: O_EXCL). It waits up to --lock-wait-s while another live
  process holds it, and is released when the generator ends, fails or times out.
- The generator is Isaac Lab's scripts/imitation_learning/isaaclab_mimic/generate_dataset.py, run by Isaac Lab's
  Python with SANT and isaaclab_mimic's source on PYTHONPATH (isaaclab_mimic isn't installed there; nothing is
  installed), and SANT's env registered by --external_callback.
- Its log goes to <output>.log. The report (<output>_report.json) counts what Mimic called a success (<output>)
  and a failure (<output>_failed), and SANT's verdict on each success (demo_pipeline.mimic.verify_generated).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))  # repo root, for `sim_worker`
from sim_worker.own_code import check_own_code, put_own_code_first  # noqa: E402

put_own_code_first()  # this checkout's src before the venv's editable install (it points at another worktree)

from demo_pipeline import mimic  # noqa: E402
from sim_worker.gpu_lock import GpuLock  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402

ISAAC_PY = Path(r"C:\isaac\env_isaaclab\Scripts\python.exe")
ISAACLAB = Path(r"C:\isaac\IsaacLab")
GENERATE = ISAACLAB / "scripts" / "imitation_learning" / "isaaclab_mimic" / "generate_dataset.py"
MIMIC_SRC = ISAACLAB / "source" / "isaaclab_mimic"
EXPORTS = REPO / "data" / "exports" / "mimic"


def command(input_file: Path, output_file: Path, *, trials: int = 10, max_failures: int = 30, num_envs: int = 1,
            device: str = "cpu", viz: bool = False) -> list[str]:
    """generate_dataset.py's command line. No --headless: this Isaac Lab is headless unless --viz is given."""
    cmd = [str(ISAAC_PY), str(GENERATE),
           "--device", device, "--num_envs", str(num_envs),
           "--generation_num_trials", str(trials), "--max_num_failures", str(max_failures),
           "--input_file", str(input_file), "--output_file", str(output_file),
           "--external_callback", "sim_worker.mimic_register.register"]
    if viz:
        cmd += ["--viz", "kit"]
    return cmd


def child_env(base: dict | None = None) -> dict:
    """The generator's environment: SANT (the repo and src) and isaaclab_mimic's source first on PYTHONPATH."""
    env = dict(os.environ if base is None else base)
    parts = [str(REPO), str(REPO / "src"), str(MIMIC_SRC)]
    if env.get("PYTHONPATH"):
        parts.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = ";".join(parts)
    return env


def run_generator(cmd: list[str], *, lock: GpuLock, log_path: Path, timeout_s: float, runner=subprocess.run) -> int:
    """Run the generator while holding the GPU lock, and with Windows asked not to idle-sleep (an idle sleep killed
    CUDA mid-run before: sim_worker.keepawake); both are released however it ends. Returns its exit code."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with lock, KeepAwake(), log_path.open("w", encoding="utf-8") as log:
        proc = runner(cmd, env=child_env(), cwd=str(ISAACLAB), stdout=log, stderr=subprocess.STDOUT, timeout=timeout_s)
        return proc.returncode


def _read(group) -> dict:
    import h5py

    return {k: _read(v) if isinstance(v, h5py.Group) else v[()] for k, v in group.items()}


def _demos(path: Path) -> list[tuple[str, dict]]:
    import h5py

    if not path.exists():
        return []
    with h5py.File(path, "r") as f:
        data = f.get("data")
        return [] if data is None else [(name, _read(data[name])) for name in data]


def report(output: Path) -> dict:
    """Mimic's successes and failures, and SANT's check_success on every success. A file the generator left
    unreadable (it was killed mid-write) is listed, not fatal."""
    output = Path(output)
    unreadable = []

    def demos_of(path: Path) -> list[tuple[str, dict]]:
        try:
            return _demos(path)
        except OSError as e:
            unreadable.append({"file": str(path), "error": f"{type(e).__name__}: {e}"})
            return []

    ok = demos_of(output)
    failed = demos_of(output.with_name(output.stem + "_failed" + output.suffix))
    demos, reasons = [], Counter()
    for name, d in ok:
        try:
            r = mimic.verify_generated(d)
            a, eef = np.asarray(d["actions"], dtype=float), np.asarray(d["obs"]["eef_pos"], dtype=float)
            err = np.linalg.norm(a[:, :3] - np.vstack([eef[1:], eef[-1:]]), axis=1)
            row = {"demo": name, "steps": int(len(d["actions"])), "sant_success": bool(r.success),
                   "reasons": list(r.reasons), "max_contact_force": round(float(r.max_contact_force), 3),
                   "tcp_err_median_cm": round(float(np.median(err)) * 100, 2),
                   "secs_over_2cm": round(float((err > 0.02).sum()) / mimic.RATE_HZ, 2)}
        except Exception as e:  # a demo missing what SANT needs is a wiring error worth seeing, not a crash
            row = {"demo": name, "steps": int(len(d.get("actions", []))), "sant_success": False, "reasons": ["unreadable"],
                   "error": f"{type(e).__name__}: {e}"}
        reasons.update(row["reasons"])
        demos.append(row)
    return {"output": str(output), "mimic_succeeded": len(ok), "mimic_failed": len(failed),
            "sant_verified": sum(d["sant_success"] for d in demos), "sant_reasons": dict(reasons),
            "unreadable_files": unreadable, "demos": demos}


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--input", type=Path, default=EXPORTS / "human10c_sources.hdf5")
    ap.add_argument("--output", type=Path, default=EXPORTS / "smoke_10.hdf5")
    ap.add_argument("--trials", type=int, default=10)
    ap.add_argument("--max-failures", type=int, default=30)
    ap.add_argument("--num-envs", type=int, default=1)
    ap.add_argument("--timeout-s", type=float, default=1800)
    ap.add_argument("--lock-wait-s", type=float, default=600)
    ap.add_argument("--viz", action="store_true", help="open Isaac Sim's window (Kit visualizer)")
    ap.add_argument("--dry-run", action="store_true", help="print the command and stop")
    args = ap.parse_args(argv)
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout

    if args.output.exists():
        raise SystemExit(f"{args.output} exists; pick a new --output")
    cmd = command(args.input.resolve(), args.output.resolve(), trials=args.trials, max_failures=args.max_failures,
                  num_envs=args.num_envs, viz=args.viz)
    print(" ".join(cmd))
    if args.dry_run:
        return {"command": cmd}
    if not args.input.exists():
        raise SystemExit(f"{args.input} doesn't exist: run scripts/export_mimic.py first")
    lock = GpuLock(task="mimic_smoke", owner="T2", poll_s=60, max_wait_s=args.lock_wait_s)
    log = args.output.with_suffix(".log")
    rc = run_generator(cmd, lock=lock, log_path=log, timeout_s=args.timeout_s)
    out = report(args.output)
    out.update({"exit_code": rc, "log": str(log), "command": cmd})
    path = args.output.with_name(args.output.stem + "_report.json")
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in out.items() if k != "demos"}, indent=1))
    return out


if __name__ == "__main__":
    main()
