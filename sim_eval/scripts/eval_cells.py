"""Evaluate every trained cell of one experiment run, one at a time, resumably, only when Isaac is free.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\scripts\\eval_cells.py --run-id <run_id> --n 20

For each ok registry row of the run (lerobot_tools.experiments):
  1. wait until no other Isaac python process runs and >= 8 GB GPU memory is free (sim_eval.report.isaac_gate),
     logging every check to DATA_DIR/evals/<run_id>/gate_checks.jsonl; give up after --wait-max-min;
  2. start lerobot_tools.policy_server on the row's checkpoint (lerobot venv) and wait for /health;
  3. run run_eval.py --cell <cell> --cameras --out DATA_DIR/evals/<run_id>/<cell>.json --resume;
     run_eval re-checks the gate itself and exits 3 if Isaac got busy in between -> back to step 1;
  4. stop the server.
A cell whose results file has a valid episode for every requested seed is skipped. A cell with sim_error/policy_error (CUDA
dies when Windows sleeps; T2 lost seeds that way) is resumed, up to MAX_ATTEMPTS runs; run_eval --resume re-runs
only those seeds. Re-running this script after a crash continues where it stopped. Cells left unevaluated keep
eval_success null in the registry.

--checkpoint CELL=PATH (repeatable) evaluates those checkpoints instead of the registry rows, with --no-registry:
e.g. a 30k continuation of a 10k cell, whose own row must keep its 10k result.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from demo_pipeline.paths import data_dir  # noqa: E402
from lerobot_tools.policy_client import PolicyClient, PolicyServerError  # noqa: E402
from sim_eval.registry import trained_rows  # noqa: E402
from sim_eval.report import isaac_gate, python_processes  # noqa: E402

LEROBOT_PY = Path(r"C:\venvs\lerobot\Scripts\python.exe")
FREE_WINDOW_S = 60  # Isaac must stay free this long before we start (T2 runs jobs back to back)
MAX_ATTEMPTS = 3  # per cell: re-run a cell whose results contain sim_error/policy_error episodes


def log(msg: str) -> None:
    print(f"[eval_cells {datetime.now():%H:%M:%S}] {msg}", flush=True)


def free_mib() -> int | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout
        return int(out.split()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def gate_once(gate_log: Path) -> tuple[bool, dict]:
    ok, rec = isaac_gate(python_processes(), own_pid=os.getpid(), free_mib=free_mib())
    rec = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **rec}
    with gate_log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    return ok, rec


def wait_for_gate(gate_log: Path, deadline: float, poll_s: float) -> bool:
    free_since = None
    last_reason = None
    while time.time() < deadline:
        ok, rec = gate_once(gate_log)
        if ok:
            free_since = free_since or time.time()
            if time.time() - free_since >= FREE_WINDOW_S:
                log(f"gate ok for {FREE_WINDOW_S} s (GPU free {rec['free_mib']} MiB)")
                return True
            time.sleep(10)
            continue
        free_since = None
        if rec["reason"] != last_reason:
            log(f"waiting: {rec['reason']}")
            last_reason = rec["reason"]
        time.sleep(poll_s)
    return False


def start_server(checkpoint: str, port: int, log_path: Path) -> subprocess.Popen:
    env = {**os.environ, "PYTHONPATH": f"{REPO};{REPO / 'src'}"}
    f = log_path.open("a", encoding="utf-8")
    proc = subprocess.Popen([str(LEROBOT_PY), "-m", "lerobot_tools.policy_server", "--checkpoint", checkpoint,
                             "--port", str(port)], cwd=REPO, env=env, stdout=f, stderr=subprocess.STDOUT)
    client = PolicyClient(f"http://127.0.0.1:{port}", timeout=5)
    for _ in range(180):
        if proc.poll() is not None:
            raise RuntimeError(f"policy server exited with {proc.returncode}; see {log_path}")
        try:
            h = client.health()
            if h.get("checkpoint") and Path(h["checkpoint"]).resolve() == Path(checkpoint).resolve():
                client.close()
                return proc
            raise RuntimeError(f"port {port} serves {h.get('checkpoint')}, not {checkpoint}")
        except PolicyServerError:
            time.sleep(1)
    proc.kill()
    raise RuntimeError(f"policy server not healthy after 180 s; see {log_path}")


def stop_server(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()


def run_eval_command(*, python: str, port: int, n: int, seed0: int, cell: str, out: Path, registry: Path | None,
                     start_state: Path | None = None, start_pose: str | None = None) -> list[str]:
    """The run_eval.py command line for one cell. Isaac Lab 3.0 runs headless by default (no --headless flag).
    registry None: --no-registry (a checkpoint with no row of its own must not overwrite another row's result).
    start_state / start_pose: one shared start for every cell (default: each cell's own registry dataset, auto)."""
    cmd = [python, str(REPO / "sim_eval/scripts/run_eval.py"), "--checkpoint-url", f"http://127.0.0.1:{port}",
           "--n", str(n), "--seed0", str(seed0), "--cell", cell, "--cameras", "--out", str(out), "--resume"]
    cmd += ["--no-registry"] if registry is None else ["--registry", str(registry)]
    if start_state is not None:
        cmd += ["--start-state", str(start_state)]
    if start_pose is not None:
        cmd += ["--start-pose", start_pose]
    return cmd


def eval_targets(rows: list[dict], cells: list[str] | None, checkpoint_specs: list[str]) -> list[tuple[str, str, bool]]:
    """(cell, checkpoint, write_registry) to evaluate. CELL=PATH specs (e.g. a 30k checkpoint, a cell whose training
    finished outside experiments) replace the registry rows and never write the registry; else the run's rows."""
    if checkpoint_specs:
        out = []
        for spec in checkpoint_specs:
            cell, _, path = spec.partition("=")
            if not cell or not path:
                raise ValueError(f"--checkpoint wants CELL=PATH, got {spec!r}")
            out.append((cell, path, False))
        return out
    return [(r["cell"]["name"], r["checkpoint"], True) for r in rows if not cells or r["cell"]["name"] in cells]


def seeds_to_run(results: Path, *, n: int, seed0: int) -> int:
    """Seeds of [seed0, seed0 + n) with no valid episode in `results` yet: missing (e.g. n was raised to extend
    the eval) or ended in sim_error / policy_error (say nothing about the policy; run_eval --resume re-runs them)."""
    results = Path(results)
    valid = set()
    if results.is_file():
        valid = {e["seed"] for e in json.loads(results.read_text(encoding="utf-8"))["episodes"]
                 if e["ended_by"] not in ("sim_error", "policy_error")}
    return sum(s not in valid for s in range(seed0, seed0 + n))


def retryable(rc: int) -> bool:
    """Exit 2 is argparse's usage error or run_eval's refusal (server mismatch, start state): retrying can't help."""
    return rc != 2


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--run-id", required=True)
    p.add_argument("--n", type=int, default=20)
    p.add_argument("--seed0", type=int, default=5000)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--registry", type=Path, default=None)
    p.add_argument("--wait-max-min", type=float, default=240, help="give up waiting for a free Isaac after this")
    p.add_argument("--poll-s", type=float, default=60)
    p.add_argument("--start-state", type=Path, default=None,
                   help="one start_state.json / dataset root for every cell (default: each cell's own dataset)")
    p.add_argument("--start-pose", choices=("auto", "default", "dataset"), default=None)
    p.add_argument("--cells", nargs="*", default=None, help="only these cells of the run")
    p.add_argument("--checkpoint", action="append", default=[], metavar="CELL=PATH",
                   help="evaluate this checkpoint as CELL instead of the run's registry rows (registry untouched); "
                        "results go to DATA_DIR/evals/<run_id>/<CELL>.json; repeatable")
    args = p.parse_args(argv)
    registry = args.registry or data_dir() / "results" / "registry.jsonl"
    out_dir = data_dir() / "evals" / args.run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    gate_log = out_dir / "gate_checks.jsonl"
    try:
        targets = eval_targets([] if args.checkpoint else trained_rows(registry, args.run_id), args.cells,
                               args.checkpoint)
    except ValueError as e:
        p.error(str(e))
    log(f"{len(targets)} cells to evaluate in {args.run_id}: {[t[0] for t in targets]}")
    deadline = time.time() + args.wait_max_min * 60
    status = {}
    for i, (cell, checkpoint, write_registry) in enumerate(targets):
        out = out_dir / f"{cell}.json"
        if seeds_to_run(out, n=args.n, seed0=args.seed0) == 0:
            log(f"{cell}: already evaluated ({out})")
            status[cell] = "done earlier"
            continue
        attempts = 0
        while True:
            if not wait_for_gate(gate_log, deadline, args.poll_s):
                log(f"{cell}: Isaac never free long enough before the deadline; eval_success stays null")
                status[cell] = "not evaluated: Isaac busy"
                break
            server = start_server(checkpoint, args.port, out_dir / f"{cell}.server.log")
            try:
                cmd = run_eval_command(python=sys.executable, port=args.port, n=args.n, seed0=args.seed0,
                                       cell=cell, out=out, registry=registry if write_registry else None,
                                       start_state=args.start_state, start_pose=args.start_pose)
                log(f"{cell}: {' '.join(cmd)}")
                with (out_dir / f"{cell}.eval.log").open("a", encoding="utf-8") as f:
                    rc = subprocess.run(cmd, cwd=REPO, stdout=f, stderr=subprocess.STDOUT).returncode
            finally:
                stop_server(server)
            if rc == 3:
                log(f"{cell}: run_eval's own gate refused (Isaac got busy); waiting again")
                continue
            attempts += 1
            bad = seeds_to_run(out, n=args.n, seed0=args.seed0)
            if bad == 0:
                status[cell] = "evaluated"
            elif not retryable(rc):
                status[cell] = f"run_eval refused or bad arguments (exit {rc}); see {cell}.eval.log"
            elif attempts < MAX_ATTEMPTS:
                # sim_error / policy_error / no results: e.g. CUDA died when Windows slept. Resume re-runs those seeds.
                log(f"{cell}: run_eval exit {rc}, seeds left {bad}; resuming (attempt {attempts + 1})")
                continue
            else:
                status[cell] = f"incomplete after {attempts} attempts: run_eval exit {rc}, seeds left {bad}"
            log(f"{cell}: {status[cell]}")
            break
        if status[cell].startswith("not evaluated"):
            for later in targets[i + 1:]:
                status.setdefault(later[0], "not evaluated: Isaac busy")
            break
    log("STATUS " + json.dumps(status))
    return 0 if all(v in ("evaluated", "done earlier") for v in status.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
