"""Perfect a T1 experiment set through the sim worker, one demo at a time, resumably (sprint 3, T4 Task 4).

    uv run python scripts/run_pipeline_batch.py --set data/sets/pilot60 --diagnoser rules [--resume] [--limit 3]

For each demo in <set>/manifest.json (T1 writes it last, so a set without it is refused):
  1. import <set>/<id>/demo.json into the demo store (DATA_DIR/demos/), so the web pages see it;
  2. /replay it as recorded ("<id>_raw"), recording cameras when the worker has them, into its store episode
     with a human Passport; a stored raw replay of the same demo (with cameras if needed) is reused;
  3. perfect it (app.jobs.perfect_stored_demo), which stores "<id>_<diagnoser>" with its Passport;
  4. write <out>/<id>.json, atomically. <out> defaults to <set>/pipeline/<diagnoser>/.
<out>/summary.json is rewritten after every demo.

Resume: --resume skips demos whose result is perfected, kept or discarded; an "error" result is retried.
Without --resume or --force, a folder with results is refused, so a finished run is not redone by accident.

Stops (exit 2, resumable) when the worker is down, hung, busy past the retries or refuses the request, or when
the next Nemotron diagnose could break the call or cost budget (--max-model-calls 10, --max-cost-usd 0.05;
each diagnose is budgeted as 2 calls of $0.0025, its worst case with one retry). The demo in progress is not
stored. Any other per-demo failure (a corrupt demo, a sim_error on the raw replay) is that demo's "error";
the batch goes on.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from app.jobs import (
    MODEL_DIAGNOSERS,
    PipelineAbort,
    check_worker,
    is_infrastructure,
    perfect_stored_demo,
    record_raw,
    stored_raw,
)
from app.ai.diagnose import DIAGNOSE_TIER
from app.sim_client import SimWorkerClient, SimWorkerError
from demo_pipeline.schemas import Demo
from demo_pipeline.store import DemoStore

DONE = ("perfected", "kept", "discarded")
STATUSES = (*DONE, "error", "pending")
CALLS_PER_DIAGNOSE = 2  # one retry on an invalid reply
RESERVE_USD_PER_CALL = 0.0025  # measured $0.0013-0.0016 per diagnose call (spec Changes); kept above that
LOG_TIER = f"vision:{DIAGNOSE_TIER}"


class BatchRefused(ValueError):
    """The batch would redo or misread work: no manifest, or results exist without --resume/--force."""


def read_model_usage() -> tuple[int, float]:
    """Nemotron VL calls and estimated USD so far, from nebius_llm's usage log."""
    from nebius_llm.usage import _log_path

    path = _log_path()
    if not path.exists():
        return 0, 0.0
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    vl = [e for e in entries if e.get("tier") == LOG_TIER]
    return len(vl), sum(float(e.get("est_cost_usd", 0.0)) for e in vl)


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _set_ids(set_dir: Path) -> list[str]:
    manifest = set_dir / "manifest.json"
    if not manifest.is_file():
        raise BatchRefused(f"{set_dir} has no manifest.json; the set is incomplete (T1 writes it last)")
    return [d["id"] for d in json.loads(manifest.read_text(encoding="utf-8"))["demos"]]


def _same_demo(a: Demo, b: Demo) -> bool:
    """Same recording: a stored raw replay of `a` is a raw replay of `b`."""
    return a.trajectory == b.trajectory and a.scene == b.scene


def _read_result(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _row(id: str, result: dict | None) -> dict:
    if result is None:
        return {"id": id, "status": "pending"}
    keys = ("status", "output_demo_id", "diagnosis_source", "attempts", "decision", "error", "wall_s")
    row = {"id": id, **{k: result.get(k) for k in keys}}
    row["raw_success"] = (result.get("raw_verification") or {}).get("success")
    row["verified"] = (result.get("verification") or {}).get("success")
    return row


def run_batch(
    set_dir: Path,
    diagnoser: str,
    *,
    client: SimWorkerClient,
    store: DemoStore,
    out_dir: Path | None = None,
    resume: bool = False,
    force: bool = False,
    limit: int | None = None,
    ids: list[str] | None = None,
    reuse_raw: bool | None = None,
    record_cameras: bool | None = None,
    max_model_calls: int = 10,
    max_cost_usd: float = 0.05,
    model_usage: Callable[[], tuple[int, float]] = read_model_usage,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> dict:
    set_dir = Path(set_dir)
    out = Path(out_dir) if out_dir is not None else set_dir / "pipeline" / diagnoser
    only, ids = ids, _set_ids(set_dir)
    unknown = sorted(set(only or []) - set(ids))
    if unknown:
        raise BatchRefused(f"{unknown} are not in {set_dir / 'manifest.json'}")
    existing = [i for i in ids if (out / f"{i}.json").exists()]
    if existing and not (resume or force):
        raise BatchRefused(f"{out} already has results for {len(existing)} demos; use --resume to continue "
                           f"or --force to run every demo again")
    calls0, cost0 = model_usage()
    started = datetime.now(timezone.utc).isoformat()
    stopped: str | None = None
    stop_kind: str | None = None  # "worker" (resume when it is up), "budget" or "refused"

    def summary() -> dict:
        rows = [_row(i, _read_result(out / f"{i}.json")) for i in ids]
        calls, cost = model_usage()
        data = {"set": str(set_dir), "diagnoser": diagnoser, "started_at": started,
                "updated_at": datetime.now(timezone.utc).isoformat(), "stopped": stopped, "stop_kind": stop_kind,
                "counts": {s: sum(r["status"] == s for r in rows) for s in STATUSES},
                "model_calls": calls - calls0, "est_cost_usd": round(cost - cost0, 6), "demos": rows}
        _write_json(out / "summary.json", data)
        return data

    def check_budget() -> None:
        """Runs before every model call (nemotron or hybrid): stop if the next diagnose could break the budget."""
        calls, cost = model_usage()
        calls, cost = calls - calls0, cost - cost0
        if (calls + CALLS_PER_DIAGNOSE > max_model_calls
                or cost + CALLS_PER_DIAGNOSE * RESERVE_USD_PER_CALL > max_cost_usd):
            raise PipelineAbort(f"model budget reached: {calls} calls, ${cost:.4f} used of {max_model_calls} calls, "
                                f"${max_cost_usd}; the next diagnose could exceed it")

    try:
        health = client.health()
    except SimWorkerError as e:
        stopped, stop_kind = f"{e}; nothing was run. Start the worker and re-run with --resume", "worker"
        return summary()
    cameras = health.cameras if record_cameras is None else record_cameras
    health = health.model_copy(update={"cameras": cameras})  # what this run records, not what the worker could
    refusal = check_worker(health, None, diagnoser)  # the robot is checked per demo
    if refusal is not None:
        stopped, stop_kind = f"{refusal[1]}; nothing was run", "refused"
        return summary()

    run_ids = ids if only is None else [i for i in ids if i in set(only)]
    todo = [i for i in run_ids if force or (_read_result(out / f"{i}.json") or {}).get("status") not in DONE]
    if limit is not None:
        todo = todo[:limit]
    log(f"{len(todo)} of {len(ids)} demos to run ({diagnoser}, cameras={cameras}) -> {out}")
    for n, id in enumerate(todo, start=1):
        t0 = time.time()
        try:
            demo = Demo.model_validate_json((set_dir / id / "demo.json").read_text(encoding="utf-8"))
            refusal = check_worker(health, demo.scene.robot, diagnoser)
            if refusal is not None:
                raise BatchRefused(refusal[1])
            unchanged = store.has_demo(id) and _same_demo(store.get_demo(id), demo)
            store.save_demo(demo)
            reuse = (not force) if reuse_raw is None else reuse_raw  # --force redoes the raw replay too
            raw = stored_raw(store, id, need_cameras=cameras) if unchanged and reuse else None
            if raw is None:
                raw = record_raw(store, client, demo, record_cameras=cameras, sleep=sleep)
            result = perfect_stored_demo(store, client, id, diagnoser, raw=raw, record_cameras=cameras,
                                         sleep=sleep, before_model_call=check_budget)
        except PipelineAbort as e:
            stopped, stop_kind = f"{e}; {id} was not stored. Re-run with --resume", "budget"
            break
        except SimWorkerError as e:
            if is_infrastructure(e):
                stopped, stop_kind = f"{e}; {id} was not stored. Re-run with --resume once the worker is up", "worker"
                break
            result = {"status": "error", "error": f"{type(e).__name__}: {e}"}
        except BatchRefused as e:
            stopped, stop_kind = f"{e}; {id} was not run", "refused"
            break
        except Exception as e:  # a corrupt demo or anything unexpected is this demo's error; go on
            result = {"status": "error", "error": f"{type(e).__name__}: {e}"}
        result = {"id": id, **result, "wall_s": round(time.time() - t0, 2)}
        _write_json(out / f"{id}.json", result)
        log(f"[{n}/{len(todo)}] {id}: {result['status']}"
            + (f" ({result['error']})" if result.get("error") else ""))
        summary()
    if stopped:
        log(f"STOPPED: {stopped}")
    return summary()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", dest="set_dir", type=Path, required=True, help="DATA_DIR/sets/<name>")
    parser.add_argument("--diagnoser", choices=("rules", "hybrid", "nemotron"), required=True,
                        help="hybrid = rules + Nemotron (the model arm); nemotron = the model alone")
    parser.add_argument("--resume", action="store_true", help="skip demos already perfected, kept or discarded")
    parser.add_argument("--force", action="store_true", help="run every demo again")
    parser.add_argument("--limit", type=int, help="run at most this many demos")
    parser.add_argument("--out", type=Path, help="results folder (default <set>/pipeline/<diagnoser>)")
    parser.add_argument("--no-cameras", action="store_true", help="never record cameras (rules only)")
    parser.add_argument("--max-model-calls", type=int, default=10)
    parser.add_argument("--max-cost-usd", type=float, default=0.05)
    args = parser.parse_args(argv)

    if args.diagnoser in MODEL_DIAGNOSERS:
        from dotenv import load_dotenv

        load_dotenv()
    client = SimWorkerClient()
    try:
        summary = run_batch(args.set_dir, args.diagnoser, client=client, store=DemoStore(), out_dir=args.out,
                            resume=args.resume, force=args.force, limit=args.limit,
                            record_cameras=False if args.no_cameras else None,
                            max_model_calls=args.max_model_calls, max_cost_usd=args.max_cost_usd)
    except BatchRefused as e:
        print(f"REFUSED: {e}")
        return 1
    finally:
        client.close()
    print(json.dumps({k: summary[k] for k in ("counts", "model_calls", "est_cost_usd", "stopped")}, indent=2))
    return 2 if summary["stopped"] else 0


if __name__ == "__main__":
    sys.exit(main())
