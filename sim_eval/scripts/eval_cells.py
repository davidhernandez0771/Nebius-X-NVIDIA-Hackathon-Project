"""Evaluate every trained cell of one experiment run, one at a time, resumably, only when Isaac is free.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\scripts\\eval_cells.py --run-id <run_id> --n 20

For each ok registry row of the run (lerobot_tools.experiments):
  1. wait until no other Isaac python process runs and >= 8 GB GPU memory is free (sim_eval.report.isaac_gate),
     logging every check to DATA_DIR/evals/<run_id>/gate_checks.jsonl; give up after --wait-max-min;
  2. start lerobot_tools.policy_server on the row's checkpoint (lerobot venv) and wait for /health;
  3. run run_eval.py --cell <cell> --cameras --headless --out DATA_DIR/evals/<run_id>/<cell>.json --resume;
     run_eval re-checks the gate itself and exits 3 if Isaac got busy in between -> back to step 1;
  4. stop the server.
A cell whose results file exists with no sim_error/policy_error episode is skipped. A cell with such episodes (CUDA
dies when Windows sleeps; T2 lost seeds that way) is resumed, up to MAX_ATTEMPTS runs; run_eval --resume re-runs
only those seeds. Re-running this script after a crash continues where it stopped. Cells left unevaluated keep
eval_success null in the registry.
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
from sim_eval.report import infra_failures, isaac_gate, python_processes  # noqa: E402

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


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--run-id", required=True)
    p.add_argument("--n", type=int, default=20)
    p.add_argument("--seed0", type=int, default=5000)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--registry", type=Path, default=None)
    p.add_argument("--wait-max-min", type=float, default=240, help="give up waiting for a free Isaac after this")
    p.add_argument("--poll-s", type=float, default=60)
    args = p.parse_args(argv)
    registry = args.registry or data_dir() / "results" / "registry.jsonl"
    out_dir = data_dir() / "evals" / args.run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    gate_log = out_dir / "gate_checks.jsonl"
    rows = trained_rows(registry, args.run_id)
    log(f"{len(rows)} trained cells in {args.run_id}: {[r['cell']['name'] for r in rows]}")
    deadline = time.time() + args.wait_max_min * 60
    status = {}
    for row in rows:
        cell = row["cell"]["name"]
        out = out_dir / f"{cell}.json"
        if infra_failures(out) == 0:
            log(f"{cell}: already evaluated ({out})")
            status[cell] = "done earlier"
            continue
        attempts = 0
        while True:
            if not wait_for_gate(gate_log, deadline, args.poll_s):
                log(f"{cell}: Isaac never free long enough before the deadline; eval_success stays null")
                status[cell] = "not evaluated: Isaac busy"
                break
            server = start_server(row["checkpoint"], args.port, out_dir / f"{cell}.server.log")
            try:
                cmd = [sys.executable, str(REPO / "sim_eval/scripts/run_eval.py"), "--checkpoint-url",
                       f"http://127.0.0.1:{args.port}", "--n", str(args.n), "--seed0", str(args.seed0),
                       "--cell", cell, "--cameras", "--headless", "--out", str(out), "--resume",
                       "--registry", str(registry)]
                log(f"{cell}: {' '.join(cmd)}")
                with (out_dir / f"{cell}.eval.log").open("a", encoding="utf-8") as f:
                    rc = subprocess.run(cmd, cwd=REPO, stdout=f, stderr=subprocess.STDOUT).returncode
            finally:
                stop_server(server)
            if rc == 3:
                log(f"{cell}: run_eval's own gate refused (Isaac got busy); waiting again")
                continue
            attempts += 1
            bad = infra_failures(out)
            if bad == 0:
                status[cell] = "evaluated"
            elif attempts < MAX_ATTEMPTS:
                # sim_error / policy_error / no results: e.g. CUDA died when Windows slept. Resume re-runs those seeds.
                log(f"{cell}: run_eval exit {rc}, infra failures {bad}; resuming (attempt {attempts + 1})")
                continue
            else:
                status[cell] = f"incomplete after {attempts} attempts: run_eval exit {rc}, infra failures {bad}"
            log(f"{cell}: {status[cell]}")
            break
        if status[cell].startswith("not evaluated"):
            for later in rows[rows.index(row) + 1:]:
                status.setdefault(later["cell"]["name"], "not evaluated: Isaac busy")
            break
    log("STATUS " + json.dumps(status))
    return 0 if all(v in ("evaluated", "done earlier") for v in status.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
