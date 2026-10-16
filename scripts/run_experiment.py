"""Run the experiment for one set through the sim worker and write T3's grid JSON (sprint 3b, T4 Task 2).

    uv run python scripts/run_experiment.py --set data/sets/s1 --n-human 5,10,20 --variants-per-demo 10 \
        --robot franka [--resume | --force] [--diagnosers rules,hybrid] [--max-model-calls 10 --max-cost-usd 0.05]

Uses the first max(n_human) demos of <set>/manifest.json; the cells for smaller n are their prefixes.
  1. raw:        /replay each human demo as recorded, with cameras, into the demo store with a human Passport.
  2. perfected:  scripts/run_pipeline_batch.run_batch with rules, then the model arm (hybrid by default, or
                 nemotron alone; its budget flags), reusing (1). Results in <set>/pipeline/<diagnoser>/;
                 outputs are "<id>_rules" and "<id>_hybrid" (or "<id>_nemotron").
  3. multiply:   /multiply each human demo (raw_multiply) and each output of (2) (rules_multiply,
                 perfected_multiply = the model arm), --variants-per-demo variants. Every condition uses the same
                 seeds for the same human demo (seed0 + 1000 x its index in the set), so the conditions
                 differ only in the source trajectory. Successful variants become "variant" demos with
                 Passports; failed ones count in the yield only.
  4. grid:       <out>/grid.json in lerobot_tools.experiments' format, {"name", "cells": [{"condition",
                 "n_human", "episode_dirs"}]}, with absolute store episode dirs. Every episode carries a
                 Passport, so lerobot_tools.assemble can trace it to its human demo. Only complete cells are
                 written. A multiplied cell holds its source episodes plus their successful variants.
<out> defaults to <set>/experiment/; <out>/experiment.json is the summary (stages, yields, every cell).

Resumable: raw episodes in the store, the batches' result files and <out>/multiply/<source>.json are the
done-markers; --resume skips what they cover, --force redoes everything. A worker that is down, crashes, hangs
or refuses stops the run (exit 2) with the reason; re-run with --resume. The nemotron budget stopping is not
fatal: the other conditions finish, and the nemotron cells it left incomplete stay out of the grid.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))  # run_pipeline_batch is a sibling script

import run_pipeline_batch  # noqa: E402
from run_pipeline_batch import DONE, _same_demo, _set_ids, _write_json, read_model_usage, run_batch  # noqa: E402

from app.jobs import is_infrastructure, record_raw, store_variants, stored_raw  # noqa: E402
from app.sim_client import SimWorkerBusy, SimWorkerClient, SimWorkerError  # noqa: E402
from demo_pipeline.schemas import Demo  # noqa: E402
from demo_pipeline.sim_protocol import MultiplyRequest  # noqa: E402
from demo_pipeline.store import DemoStore  # noqa: E402

CONDITIONS = ("raw", "raw_multiply", "rules_multiply", "perfected_multiply")
MODEL_ARMS = ("hybrid", "nemotron")  # the perfected_multiply arm: hybrid (rules + Nemotron) by default
SEED_STRIDE = 1000  # seeds of human demo k: seed0 + k * SEED_STRIDE + [0, n)


class ExperimentRefused(ValueError):
    """The run would misread or redo work: too few demos, or an existing experiment without --resume/--force."""


class _Stop(Exception):
    def __init__(self, message: str, kind: str) -> None:
        super().__init__(message)
        self.kind = kind


def _batch_status(set_dir: Path, diagnoser: str, demo_id: str) -> str | None:
    path = set_dir / "pipeline" / diagnoser / f"{demo_id}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("status")
    except (OSError, ValueError):
        return None


def multiply_with_retry(client: SimWorkerClient, req: MultiplyRequest, *, busy_retries: int, busy_wait_s: float,
                        sleep: Callable[[float], None]):
    for attempt in range(busy_retries + 1):
        try:
            return client.multiply(req)
        except SimWorkerBusy:
            if attempt == busy_retries:
                raise
            sleep(busy_wait_s)
    raise AssertionError("unreachable")


def run_experiment(
    set_dir: Path,
    *,
    client: SimWorkerClient,
    store: DemoStore,
    n_human: list[int],
    variants_per_demo: int,
    robot: str,
    diagnosers: list[str] = ("rules", "hybrid"),
    out_dir: Path | None = None,
    resume: bool = False,
    force: bool = False,
    seed0: int = 100_000,
    max_model_calls: int = 10,
    max_cost_usd: float = 0.05,
    model_usage: Callable[[], tuple[int, float]] = read_model_usage,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> dict:
    set_dir = Path(set_dir)
    out = Path(out_dir) if out_dir is not None else set_dir / "experiment"
    diagnosers = list(diagnosers)
    arms = [d for d in diagnosers if d in MODEL_ARMS]
    if len(arms) > 1:
        raise ExperimentRefused(f"perfected_multiply has one model arm; got {arms}. Run hybrid and nemotron as "
                                f"separate experiments (--out)")
    # condition -> the diagnoser whose outputs it multiplies (None: the raw human demo)
    source = {"raw_multiply": None, "rules_multiply": "rules", "perfected_multiply": arms[0] if arms else None}
    if not 1 <= variants_per_demo <= SEED_STRIDE:
        raise ExperimentRefused(f"--variants-per-demo must be 1-{SEED_STRIDE}")
    all_ids = _set_ids(set_dir)
    n_max = max(n_human)
    if n_max > len(all_ids):
        raise ExperimentRefused(f"n_human {n_max} needs {n_max} demos; {set_dir} has {len(all_ids)}")
    if (out / "experiment.json").exists() and not (resume or force):
        raise ExperimentRefused(f"{out} already has an experiment; use --resume to continue or --force to redo it")
    ids = all_ids[:n_max]
    index = {id: k for k, id in enumerate(all_ids)}
    started = datetime.now(timezone.utc).isoformat()
    state = {"stopped": None, "stop_kind": None, "raw": {}, "errors": {},
             "stages": {"raw": None, **{d: None for d in diagnosers}}}
    markers = out / "multiply"

    # --- 1. raw ---------------------------------------------------------------------------------
    def raw_stage() -> None:
        for id in ids:
            try:
                demo = Demo.model_validate_json((set_dir / id / "demo.json").read_text(encoding="utf-8"))
                unchanged = store.has_demo(id) and _same_demo(store.get_demo(id), demo)
                store.save_demo(demo)
                if unchanged and not force and stored_raw(store, id, need_cameras=True) is not None:
                    state["raw"][id] = "stored"
                    continue
                record_raw(store, client, demo, record_cameras=True, sleep=sleep)
                state["raw"][id] = "recorded"
                log(f"raw {id}: recorded")
            except SimWorkerError as e:
                if is_infrastructure(e):
                    raise _Stop(f"{e}; raw replay of {id} not stored. Re-run with --resume", "worker") from e
                state["raw"][id] = "error"
                state["errors"][f"{id}_raw"] = f"{type(e).__name__}: {e}"
            except Exception as e:  # a corrupt demo: this demo's error; the run goes on
                state["raw"][id] = "error"
                state["errors"][f"{id}_raw"] = f"{type(e).__name__}: {e}"
        state["stages"]["raw"] = {k: sum(v == k for v in state["raw"].values()) for k in ("recorded", "stored", "error")}

    # --- 2. perfected ---------------------------------------------------------------------------
    def batch_stage(diagnoser: str) -> None:
        summary = run_batch(set_dir, diagnoser, client=client, store=store, resume=True, force=force, ids=ids,
                            reuse_raw=True, record_cameras=True, max_model_calls=max_model_calls,
                            max_cost_usd=max_cost_usd, model_usage=model_usage, sleep=sleep, log=log)
        state["stages"][diagnoser] = {k: summary[k] for k in ("counts", "model_calls", "est_cost_usd", "stopped",
                                                               "stop_kind")}
        if summary["stop_kind"] == "budget":
            state["stopped"], state["stop_kind"] = f"{diagnoser}: {summary['stopped']}", "budget"
        elif summary["stopped"]:
            raise _Stop(f"{diagnoser}: {summary['stopped']}", summary["stop_kind"] or "worker")

    # --- 3. multiply ----------------------------------------------------------------------------
    def sources(id: str) -> list[tuple[str, str]]:
        """(condition, source demo id) to multiply for this human demo, as far as the earlier stages got."""
        out_ = []
        if (store.episode_dir(id) / "episode.json").is_file() and state["raw"].get(id) != "error":
            out_.append(("raw_multiply", id))
        for condition in ("rules_multiply", "perfected_multiply"):
            diagnoser = source[condition]
            if diagnoser in diagnosers and _batch_status(set_dir, diagnoser, id) in ("perfected", "kept"):
                out_.append((condition, f"{id}_{diagnoser}"))
        return out_

    def multiply_stage() -> None:
        for id in ids:
            for condition, src_id in sources(id):
                marker = markers / f"{src_id}.json"
                if marker.exists() and not force:
                    continue
                src = store.get_demo(src_id)
                req = MultiplyRequest(trajectory=src.trajectory, scene=src.scene, robot=robot, n=variants_per_demo,
                                      seed0=seed0 + index[id] * SEED_STRIDE, record_cameras=True,
                                      out_prefix=f"{src_id}_mx")
                try:
                    resp = multiply_with_retry(client, req, busy_retries=60, busy_wait_s=10.0, sleep=sleep)
                except SimWorkerError as e:
                    if is_infrastructure(e):
                        raise _Stop(f"{e}; multiply of {src_id} not stored. Re-run with --resume", "worker") from e
                    state["errors"][req.out_prefix] = f"{type(e).__name__}: {e}"
                    continue
                variant_ids = store_variants(store, src_id, resp)
                _write_json(marker, {
                    "condition": condition, "source": src_id, "human": id, "seed0": req.seed0, "n": req.n,
                    "robot": robot, "attempts": resp.attempts, "successes": resp.successes,
                    "variant_ids": variant_ids, "wall_s": resp.wall_s,
                    "failed": [{"seed": v.seed, "reasons": v.verification.reasons}
                               for v in resp.variants if not v.verification.success]})
                log(f"multiply {src_id}: {resp.successes}/{resp.attempts}")

    # --- 4. cells and grid ----------------------------------------------------------------------
    def read_marker(src_id: str) -> dict | None:
        try:
            return json.loads((markers / f"{src_id}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def cell(condition: str, n: int) -> dict:
        episodes, missing, discarded = [], [], []
        for id in ids[:n]:
            if state["raw"].get(id) == "error":
                discarded.append(id)  # no usable human demo: nothing to add, nothing to wait for
                continue
            raw_ok = (store.episode_dir(id) / "episode.json").is_file()
            if condition == "raw":
                (episodes.append(str(store.episode_dir(id))) if raw_ok else missing.append(id))
                continue
            diagnoser = source[condition]
            if diagnoser is None:
                src_id = id if raw_ok else None
            else:
                status = _batch_status(set_dir, diagnoser, id)
                if status not in DONE:
                    missing.append(id)
                    continue
                if status == "discarded":
                    discarded.append(id)
                    continue
                src_id = f"{id}_{diagnoser}"
            marker = read_marker(src_id) if src_id else None
            if marker is None:
                missing.append(id)
                continue
            episodes += [str(store.episode_dir(x)) for x in [src_id, *marker["variant_ids"]]]
        return {"name": f"{condition}_{n}", "condition": condition, "n_human": n, "complete": not missing,
                "n_episodes": len(episodes), "missing": missing, "discarded": discarded, "episode_dirs": episodes}

    def finish() -> dict:
        cells = [cell(c, n) for n in sorted(set(n_human)) for c in CONDITIONS
                 if c in ("raw", "raw_multiply") or source[c] in diagnosers]
        grid_cells = [{"condition": c["condition"], "n_human": c["n_human"], "episode_dirs": c["episode_dirs"]}
                      for c in cells if c["complete"] and c["episode_dirs"]]
        grid_path = None
        if grid_cells:
            grid_path = out / "grid.json"
            _write_json(grid_path, {"name": set_dir.name, "cells": grid_cells})
        multiply = {}
        for condition in source:
            ms = [m for m in (read_marker(p.stem) for p in sorted(markers.glob("*.json")))
                  if m and m["condition"] == condition and m["human"] in ids]
            attempts, successes = sum(m["attempts"] for m in ms), sum(m["successes"] for m in ms)
            multiply[condition] = {"sources": len(ms), "attempts": attempts, "successes": successes,
                                   "yield": round(successes / attempts, 4) if attempts else None}
        summary = {
            "set": str(set_dir), "robot": robot, "n_human": sorted(set(n_human)),
            "variants_per_demo": variants_per_demo, "seed0": seed0, "seed_stride": SEED_STRIDE,
            "diagnosers": diagnosers, "demo_ids": ids, "started_at": started,
            "updated_at": datetime.now(timezone.utc).isoformat(), "stopped": state["stopped"],
            "stop_kind": state["stop_kind"], "stages": state["stages"], "multiply": multiply,
            "errors": state["errors"], "grid": None if grid_path is None else str(grid_path),
            "cells": [{k: v for k, v in c.items() if k != "episode_dirs"} for c in cells],
        }
        _write_json(out / "experiment.json", summary)
        if state["stopped"]:
            log(f"STOPPED ({state['stop_kind']}): {state['stopped']}")
        return summary

    out.mkdir(parents=True, exist_ok=True)
    try:
        try:
            health = client.health()
        except SimWorkerError as e:
            raise _Stop(f"{e}; nothing was run. Start the worker and re-run with --resume", "worker") from e
        if not health.ok:
            raise _Stop("the sim worker reports ok=false; restart it", "worker")
        if not health.cameras:
            raise _Stop("the experiment records camera episodes for training; restart the sim worker with "
                        "--cameras", "refused")
        if robot not in health.robots:
            raise _Stop(f"the sim worker runs {health.robots}, not {robot!r}; start one with --robot {robot}",
                        "refused")
        raw_stage()
        for diagnoser in diagnosers:
            batch_stage(diagnoser)
        multiply_stage()
    except _Stop as e:
        state["stopped"], state["stop_kind"] = str(e), e.kind
    return finish()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", dest="set_dir", type=Path, required=True, help="DATA_DIR/sets/<name>")
    parser.add_argument("--n-human", required=True, help="comma-separated, e.g. 5,10,20")
    parser.add_argument("--variants-per-demo", type=int, required=True)
    parser.add_argument("--robot", required=True, help="robot for the multiplied variants")
    parser.add_argument("--diagnosers", default="rules,hybrid",
                        help="perfected arms: rules, plus one model arm, hybrid (default) or nemotron")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--out", type=Path, help="default <set>/experiment")
    parser.add_argument("--seed0", type=int, default=100_000)
    parser.add_argument("--max-model-calls", type=int, default=10)
    parser.add_argument("--max-cost-usd", type=float, default=0.05)
    args = parser.parse_args(argv)
    diagnosers = [d for d in args.diagnosers.split(",") if d]
    if not set(diagnosers) <= {"rules", *MODEL_ARMS}:
        parser.error("--diagnosers takes rules, hybrid and/or nemotron")
    if set(diagnosers) & set(MODEL_ARMS):
        from dotenv import load_dotenv

        load_dotenv()
    client = SimWorkerClient()
    try:
        summary = run_experiment(
            args.set_dir, client=client, store=DemoStore(), n_human=[int(n) for n in args.n_human.split(",")],
            variants_per_demo=args.variants_per_demo, robot=args.robot, diagnosers=diagnosers, out_dir=args.out,
            resume=args.resume, force=args.force, seed0=args.seed0, max_model_calls=args.max_model_calls,
            max_cost_usd=args.max_cost_usd)
    except (ExperimentRefused, run_pipeline_batch.BatchRefused) as e:
        print(f"REFUSED: {e}")
        return 1
    finally:
        client.close()
    print(json.dumps({k: summary[k] for k in ("stopped", "stop_kind", "multiply", "grid")}, indent=2))
    for c in summary["cells"]:
        print(f"  {c['name']}: {'complete' if c['complete'] else 'INCOMPLETE'}, {c['n_episodes']} episodes"
              + (f", missing {c['missing']}" if c["missing"] else ""))
    return 2 if summary["stopped"] or not all(c["complete"] for c in summary["cells"]) else 0


if __name__ == "__main__":
    sys.exit(main())
