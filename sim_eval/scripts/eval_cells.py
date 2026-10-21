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

Inference options (lerobot_tools.inference; all off by default, so a pre-registered eval is unchanged):
--binarize-gripper, --n-action-steps N, --temporal-ensemble COEF. The server gets the last two, run_eval all three;
each eval's results, episode log and registry row record them.

Checkpoint selection on practice seeds (--select-steps 40000 60000 80000; registry rows only): each listed step's
checkpoint of a cell is evaluated on --practice-n seeds from --practice-seed0 (default 5300-5329, never the final
seeds), into DATA_DIR/evals/<run_id>/practice/<cell>@<step>.json, registry untouched. The most successes wins, a tie
goes to the later step; the choice is written to practice/<cell>.selection.json. Then the chosen checkpoint is
evaluated on the final seeds (--seed0, --n) and that result goes into the cell's row, which records the evaluated
checkpoint and the selection file. Practice results are never reported as results.
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
from sim_worker.own_code import check_own_code  # noqa: E402

from demo_pipeline.paths import data_dir  # noqa: E402
from lerobot_tools.inference import InferenceOptions, add_inference_args, served_problems  # noqa: E402
from lerobot_tools.policy_client import PolicyClient, PolicyServerError  # noqa: E402
from sim_eval.registry import trained_rows  # noqa: E402
from sim_eval.report import gpu_pids, isaac_gate, python_processes  # noqa: E402

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
    ok, rec = isaac_gate(python_processes(), own_pid=os.getpid(), free_mib=free_mib(), gpu_pids=gpu_pids())
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


def server_command(checkpoint: str, port: int, inference: InferenceOptions | None = None) -> list[str]:
    """The policy server's command line; it gets the server-side inference options (binarizing is run_eval's)."""
    return [str(LEROBOT_PY), "-m", "lerobot_tools.policy_server", "--checkpoint", checkpoint, "--port", str(port),
            *(inference or InferenceOptions()).server_args()]


def start_server(checkpoint: str, port: int, log_path: Path,
                 inference: InferenceOptions | None = None) -> subprocess.Popen:
    env = {**os.environ, "PYTHONPATH": f"{REPO};{REPO / 'src'}"}
    f = log_path.open("a", encoding="utf-8")
    proc = subprocess.Popen(server_command(checkpoint, port, inference), cwd=REPO, env=env, stdout=f,
                            stderr=subprocess.STDOUT)
    client = PolicyClient(f"http://127.0.0.1:{port}", timeout=5)
    for _ in range(180):
        if proc.poll() is not None:
            raise RuntimeError(f"policy server exited with {proc.returncode}; see {log_path}")
        try:
            h = client.health()
            if h.get("checkpoint") and Path(h["checkpoint"]).resolve() == Path(checkpoint).resolve():
                client.close()
                problems = served_problems(inference or InferenceOptions(), h)
                if problems:
                    proc.kill()
                    raise RuntimeError("; ".join(problems))
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
                     start_state: Path | None = None, start_pose: str | None = None, trace: bool = False,
                     inference: InferenceOptions | None = None, row_checkpoint: str | None = None,
                     selection: Path | None = None) -> list[str]:
    """The run_eval.py command line for one cell. Isaac Lab 3.0 runs headless by default (no --headless flag).
    registry None: --no-registry (a checkpoint with no row of its own must not overwrite another row's result).
    start_state / start_pose: one shared start for every cell (default: each cell's own registry dataset, auto).
    trace: keep per-step traces of every episode (run_eval --trace).
    inference: the eval-time options (default: none, the command is unchanged).
    row_checkpoint / selection: the cell's row is the one trained to row_checkpoint, though a practice-seed selection
    chose the served checkpoint; selection is that choice's record."""
    cmd = [python, str(REPO / "sim_eval/scripts/run_eval.py"), "--checkpoint-url", f"http://127.0.0.1:{port}",
           "--n", str(n), "--seed0", str(seed0), "--cell", cell, "--cameras", "--out", str(out), "--resume"]
    cmd += ["--no-registry"] if registry is None else ["--registry", str(registry)]
    if start_state is not None:
        cmd += ["--start-state", str(start_state)]
    if start_pose is not None:
        cmd += ["--start-pose", start_pose]
    if trace:
        cmd += ["--trace"]
    cmd += (inference or InferenceOptions()).run_eval_args()
    if row_checkpoint is not None:
        cmd += ["--row-checkpoint", str(row_checkpoint)]
    if selection is not None:
        cmd += ["--selection", str(selection)]
    return cmd


def _step_of(checkpoint: str) -> int | None:
    """The training step of .../checkpoints/<step>/pretrained_model, or None."""
    parts = Path(checkpoint).parts
    return int(parts[-2]) if len(parts) >= 2 and parts[-1] == "pretrained_model" and parts[-2].isdigit() else None


def selection_candidates(row: dict, steps: list[int]) -> list[tuple[int, str]]:
    """(step, checkpoint) for each requested step, from the registry row's saved checkpoints."""
    saved = {_step_of(c): c for c in row.get("checkpoints") or [row["checkpoint"]] if _step_of(c) is not None}
    missing = [s for s in steps if s not in saved]
    if missing:
        raise ValueError(f"{row['cell']['name']}: no saved checkpoint at step(s) {missing}; saved: "
                         f"{', '.join(str(s) for s in sorted(saved))}")
    return [(s, saved[s]) for s in sorted(steps)]


def choose_checkpoint(results: list[tuple[int, int, int]]) -> int:
    """(step, successes, n) per candidate -> the chosen step: the most successes, a tie goes to the later step."""
    if len({n for _, _, n in results}) != 1:
        raise ValueError(f"candidates were evaluated on different n: {results}")
    return max(results, key=lambda r: (r[1], r[0]))[0]


def seed_overlap(practice_seed0: int, practice_n: int, seed0: int, n: int) -> str | None:
    """Why the practice seeds overlap the final ones, or None."""
    lo, hi = max(practice_seed0, seed0), min(practice_seed0 + practice_n, seed0 + n)
    if lo < hi:
        return (f"practice seeds {practice_seed0}-{practice_seed0 + practice_n - 1} overlap the final seeds "
                f"{seed0}-{seed0 + n - 1} (from {lo})")
    return None


SELECTION_RULE = "most practice successes; a tie goes to the later step"


def write_selection(path: Path, *, cell: str, practice_seed0: int, practice_n: int,
                    candidates: list[tuple[int, str, int, int, str]], chosen: int,
                    inference: InferenceOptions) -> Path:
    """candidates: (step, checkpoint, successes, n, results file)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rec = {"cell": cell, "practice_seeds": [practice_seed0, practice_seed0 + practice_n - 1], "rule": SELECTION_RULE,
           "inference": inference.record(),
           "candidates": [{"step": s, "checkpoint": c, "successes": k, "n": n, "results_file": f}
                          for s, c, k, n, f in candidates],
           "chosen": next({"step": s, "checkpoint": c} for s, c, *_ in candidates if s == chosen),
           "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
    return path


def successes(results: Path) -> tuple[int, int]:
    """(successes, n) of a finished results file."""
    summary = json.loads(Path(results).read_text(encoding="utf-8"))["summary"]
    return summary["successes"], summary["n"]


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


def evaluate_one(label: str, checkpoint: str, out: Path, *, n: int, seed0: int, registry: Path | None, args,
                 deadline: float, gate_log: Path, start_state: Path | None = None, row_checkpoint: str | None = None,
                 selection: Path | None = None) -> str:
    """Evaluate one checkpoint as `label` into `out` (resumably, when Isaac is free). Returns its status."""
    if seeds_to_run(out, n=n, seed0=seed0) == 0:
        log(f"{label}: already evaluated ({out})")
        return "done earlier"
    inference = InferenceOptions.from_args(args)
    attempts = 0
    while True:
        if not wait_for_gate(gate_log, deadline, args.poll_s):
            log(f"{label}: Isaac never free long enough before the deadline; eval_success stays null")
            return "not evaluated: Isaac busy"
        server = start_server(checkpoint, args.port, out.with_name(f"{out.stem}.server.log"), inference)
        try:
            cmd = run_eval_command(python=sys.executable, port=args.port, n=n, seed0=seed0, cell=label, out=out,
                                   registry=registry, start_state=start_state or args.start_state,
                                   start_pose=args.start_pose, trace=args.trace, inference=inference,
                                   row_checkpoint=row_checkpoint, selection=selection)
            log(f"{label}: {' '.join(cmd)}")
            with out.with_name(f"{out.stem}.eval.log").open("a", encoding="utf-8") as f:
                rc = subprocess.run(cmd, cwd=REPO, stdout=f, stderr=subprocess.STDOUT).returncode
        finally:
            stop_server(server)
        if rc == 3:
            log(f"{label}: run_eval's own gate refused (Isaac got busy); waiting again")
            continue
        attempts += 1
        bad = seeds_to_run(out, n=n, seed0=seed0)
        if bad == 0:
            status = "evaluated"
        elif not retryable(rc):
            status = f"run_eval refused or bad arguments (exit {rc}); see {out.stem}.eval.log"
        elif attempts < MAX_ATTEMPTS:
            # sim_error / policy_error / no results: e.g. CUDA died when Windows slept. Resume re-runs those seeds.
            log(f"{label}: run_eval exit {rc}, seeds left {bad}; resuming (attempt {attempts + 1})")
            continue
        else:
            status = f"incomplete after {attempts} attempts: run_eval exit {rc}, seeds left {bad}"
        log(f"{label}: {status}")
        return status


def evaluate_with_selection(cell: str, row: dict, out: Path, *, registry: Path | None, args, deadline: float,
                            gate_log: Path, out_dir: Path) -> str:
    """Practice seeds for each candidate step, the choice, then the chosen checkpoint on the final seeds."""
    practice = out_dir / "practice"
    practice.mkdir(parents=True, exist_ok=True)
    start_state = args.start_state or (Path(row["dataset"]) if row.get("dataset") else None)
    results = []
    for step, checkpoint in selection_candidates(row, args.select_steps):
        p_out = practice / f"{cell}@{step:06d}.json"
        status = evaluate_one(f"{cell}@{step:06d}", checkpoint, p_out, n=args.practice_n, seed0=args.practice_seed0,
                              registry=None, args=args, deadline=deadline, gate_log=gate_log, start_state=start_state)
        if status not in ("evaluated", "done earlier"):
            return f"practice {step}: {status}"
        results.append((step, checkpoint, *successes(p_out), str(p_out)))
    chosen = choose_checkpoint([(s, k, n) for s, _, k, n, _ in results])
    sel = write_selection(practice / f"{cell}.selection.json", cell=cell, practice_seed0=args.practice_seed0,
                          practice_n=args.practice_n, candidates=results, chosen=chosen,
                          inference=InferenceOptions.from_args(args))
    log(f"{cell}: practice {[(s, f'{k}/{n}') for s, _, k, n, _ in results]} -> step {chosen} ({sel})")
    checkpoint = next(c for s, c, *_ in results if s == chosen)
    return evaluate_one(cell, checkpoint, out, n=args.n, seed0=args.seed0, registry=registry, args=args,
                        deadline=deadline, gate_log=gate_log, start_state=start_state,
                        row_checkpoint=row["checkpoint"], selection=sel)


def main(argv: list[str] | None = None) -> int:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
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
    p.add_argument("--trace", action="store_true", help="keep per-step traces (run_eval --trace)")
    p.add_argument("--checkpoint", action="append", default=[], metavar="CELL=PATH",
                   help="evaluate this checkpoint as CELL instead of the run's registry rows (registry untouched); "
                        "results go to DATA_DIR/evals/<run_id>/<CELL>.json; repeatable")
    add_inference_args(p)
    p.add_argument("--select-steps", type=int, nargs="+", default=None, metavar="STEP",
                   help="choose each cell's checkpoint among these steps on practice seeds first (registry rows only)")
    p.add_argument("--practice-seed0", type=int, default=5300, help="first practice seed (with --select-steps)")
    p.add_argument("--practice-n", type=int, default=30, help="practice seeds per candidate (with --select-steps)")
    args = p.parse_args(argv)
    try:
        InferenceOptions.from_args(args)
    except ValueError as e:
        p.error(str(e))
    if args.select_steps:
        if args.checkpoint:
            p.error("--select-steps chooses among a registry row's saved checkpoints; it can't take --checkpoint")
        overlap = seed_overlap(args.practice_seed0, args.practice_n, args.seed0, args.n)
        if overlap:
            p.error(overlap)
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
    rows = {} if args.checkpoint else {r["cell"]["name"]: r for r in trained_rows(registry, args.run_id)}
    deadline = time.time() + args.wait_max_min * 60
    status = {}
    for i, (cell, checkpoint, write_registry) in enumerate(targets):
        out = out_dir / f"{cell}.json"
        reg = registry if write_registry else None
        if args.select_steps:
            try:
                status[cell] = evaluate_with_selection(cell, rows[cell], out, registry=reg, args=args,
                                                       deadline=deadline, gate_log=gate_log, out_dir=out_dir)
            except ValueError as e:  # a step with no saved checkpoint
                status[cell] = f"not evaluated: {e}"
                log(f"{cell}: {status[cell]}")
                continue
        else:
            status[cell] = evaluate_one(cell, checkpoint, out, n=args.n, seed0=args.seed0, registry=reg, args=args,
                                        deadline=deadline, gate_log=gate_log)
        if status[cell].endswith("Isaac busy"):
            for later in targets[i + 1:]:
                status.setdefault(later[0], "not evaluated: Isaac busy")
            break
    log("STATUS " + json.dumps(status))
    return 0 if all(v in ("evaluated", "done earlier") for v in status.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
