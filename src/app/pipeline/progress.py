"""A pipeline run's state, in the shape the pipeline pages read (agreed with T2), from the run's own files: the
experiment folder DATA_DIR/human_exp/<run id>/ (config.json, stages/, run.log, store/), the training run under
DATA_DIR/experiments/hx_<run id>_*/ and the eval under DATA_DIR/evals/<training run id>/.

Six stages, the runner's steps folded in:
  check     select + the physics replay of each demo            (per demo)
  repair    repair + start alignment of each demo               (per demo, both)
  multiply  the variants of each repaired demo                  (per variant)
  train     the grid (+ Nemotron's labels) + ACT on each cell   (per step)
  evaluate  the eval episodes of each cell + the results         (per episode)
  export    the downloads (app.pipeline.export)
Each stage: status, progress 0-1, items {done, total, unit}, elapsed_s, eta_s (what is left of it: the learned time
per item, or this run's own pace once it has done two items), started/finished (epoch s), detail, eta_basis.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from app.routers.showcase import _demo_row

from .timings import Timings

STAGES = ("check", "repair", "multiply", "train", "evaluate", "export")
GPU_STAGES = {"check", "repair", "multiply", "train", "evaluate"}
PUBLIC_STATUS = {"queued": "queued", "running": "running", "cancelling": "running", "done": "done", "failed": "failed",
                 "refused": "failed", "interrupted": "failed", "cancelled": "cancelled"}
# How far a recipe goes (stop_after), as the last stage it runs before the export
LAST_STAGE = {"grid": "train", "train": "train", "eval": "evaluate", "results": "evaluate"}
_STEP = re.compile(r"step:(\d+)(K?)\s.*?loss:([\d.]+)")
LOG_LINES = 40  # run.log lines in a snapshot


def _tail(path: Path, n: int) -> list[str]:
    try:
        return [x for x in path.read_text(encoding="utf-8", errors="replace").splitlines() if x.strip()][-n:]
    except OSError:
        return []


def _read_json(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _count(d: Path) -> int:
    return len(list(d.glob("*.json"))) if d.is_dir() else 0


def _jsonl(path: Path) -> list[dict]:
    try:
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    except (OSError, ValueError):
        return []


def _train_dir(data: Path, name: str) -> Path | None:
    """This run's training folder (lerobot_tools.experiments names it hx_<name>_<time>): the newest."""
    found = sorted((data / "experiments").glob(f"hx_{name}_*"))
    return found[-1] if found else None


def _train_log(path: Path) -> list[list[float]]:
    """[[step, loss], ...] from an ACT training log ("step:18K ... loss:0.12 ..."), each step once."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    out: dict[int, float] = {}
    for m in _STEP.finditer(text):
        out[int(m.group(1)) * (1000 if m.group(2) else 1)] = float(m.group(3))
    return [[s, out[s]] for s in sorted(out)]


def stage_rows(order, plan: dict, run: dict, *, status: str, active: bool, now: float, skipped) -> list[dict]:
    """Each stage's row from its plan (done_n, total, unit, full_eta, per_item, basis, detail, done): its status (the
    first unfinished stage is the running one, or the failed one), progress, items, times and what is left of it."""
    out_stages = []
    running_seen = False
    stopped = status in ("failed", "cancelled")
    for sid in order:
        done_n, total, unit, full_eta, per_item, basis, detail, done = plan[sid]
        times = (run.get("stage_times") or {}).get(sid) or [None, None]
        started, finished = times[0], times[1] if len(times) > 1 else None
        if skipped(sid):
            st = "skipped"
        elif done:
            st = "done"
        elif not running_seen and (active or stopped):
            running_seen = True
            st = "running" if active else ("failed" if status == "failed" else "pending")
        else:
            st = "pending"
        progress = 1.0 if st == "done" else (done_n / total if total else 0.0)
        elapsed = None if started is None else ((finished or now) - started)
        if st == "done":
            eta = 0.0
        elif st == "running" and per_item is not None and total:
            left = total - done_n
            pace = elapsed / done_n if (elapsed and done_n >= 2) else per_item
            eta = left * pace if done_n or full_eta is None else full_eta
        else:
            eta = full_eta
        out_stages.append({"id": sid, "status": st, "progress": round(progress, 4), "eta_s": eta,
                           "items": {"done": done_n, "total": total, "unit": unit}, "elapsed_s": elapsed,
                           "started": started, "finished": finished, "detail": detail or None, "eta_basis": basis})
    return out_stages


def snapshot(run: dict, *, data: Path, timings: Timings, now: float, lock: str | None, position: int | None) -> dict:
    """The run's full state (see the module doc). `lock`: C:\\dev\\gpu.lock's line, or None; `position`: its place in
    our queue behind other runs, or None."""
    data = Path(data)
    root = data / "human_exp" / run["id"]
    recipe = run["recipe"]
    config = _read_json(root / "config.json") or {}
    stages_dir = root / "stages"
    ids: list[str] = config.get("ids") or []
    n = len(ids) or int(run.get("n_demos") or 0)
    variants = int(config.get("variants") or recipe.get("variants") or 0)
    steps = int(config.get("steps") or recipe.get("steps") or 0)
    eval_n = int(config.get("eval_n") or recipe.get("eval_n") or 0)
    cells = 1 if (config.get("multiplied_only") or recipe.get("multiplied_only")) else 2
    status = PUBLIC_STATUS.get(run["status"], run["status"])
    active = run["status"] in ("running", "cancelling")
    t = timings.per
    marker = lambda *p: stages_dir.joinpath(*p[:-1], p[-1] + ".json")  # noqa: E731

    # --- what each stage has done --------------------------------------------------------------------
    rows = [_demo_row(root, i) for i in ids] if (root / "store").is_dir() else []
    physics_done = _count(stages_dir / "physics")
    repair_done, align_done = _count(stages_dir / "repair"), _count(stages_dir / "align")
    sim_done = marker("sim").is_file()
    aligned = [_read_json(marker("align", i)) or {} for i in ids]
    eligible = sum(bool((a.get("neat") or {}).get("success")) for a in aligned) if align_done == n and n else n
    mult_marks = [_read_json(marker("multiply", i)) for i in ids]
    mult_done = sum(variants if (m or {}).get("done") else len((m or {}).get("attempts", [])) for m in mult_marks if m)
    mult_total = max(eligible * variants, mult_done)
    if sim_done:
        mult_done = mult_total

    train_mark = _read_json(marker("train")) or {}
    tdir = _train_dir(data, run["id"])
    cell_names = [f"raw_{n}", f"perfected_multiply_{n}"][2 - cells:]
    curves = {c: _train_log(tdir / "logs" / f"{c}.log") for c in cell_names} if tdir else {}
    steps_done = sum(min(curve[-1][0], steps) for curve in curves.values() if curve)
    if train_mark.get("ok"):
        steps_done = cells * steps
    current = next((c for c in reversed(cell_names) if curves.get(c)), cell_names[0] if cell_names else None)

    run_id = train_mark.get("run_id")
    seeds = []
    if run_id:
        for c in cell_names:
            for e in _jsonl(data / "evals" / run_id / f"{c}.episodes.jsonl"):
                seeds.append({"seed": e.get("seed"), "success": bool(e.get("success")), "reasons": e.get("reasons", []),
                              "cell": c})
    results_done = (root / "results.json").is_file()
    export = run.get("export") or {}

    # --- each stage ------------------------------------------------------------------------------------
    last = "check" if recipe.get("dry_run") else LAST_STAGE[recipe.get("stop_after", "results")]
    no_train = recipe.get("stop_after") == "grid"
    plan = {
        "check": (physics_done, n, "demo", t("sim_start_s") + n * t("physics_s"), t("physics_s"),
                  f"physics {t('physics_s'):.0f} s/demo, {timings.source('physics_s')}",
                  "select" if not config else f"physics {physics_done}/{n}", physics_done >= n > 0 or sim_done),
        "repair": (repair_done + align_done, 2 * n, "step", n * (t("repair_s") + t("align_s")),
                   (t("repair_s") + t("align_s")) / 2,
                   f"repair {t('repair_s'):.0f} s/demo + align {t('align_s'):.0f} s/demo, {timings.source('repair_s')}",
                   f"repair {repair_done}/{n}" if repair_done < n else f"align {align_done}/{n}",
                   (repair_done >= n and align_done >= n and n > 0) or sim_done),
        "multiply": (mult_done, mult_total, "variant", mult_total * t("multiply_s"), t("multiply_s"),
                     f"multiply {t('multiply_s'):.0f} s/variant, {timings.source('multiply_s')}",
                     f"variant {mult_done}/{mult_total}", sim_done),
        "train": (0, 0, "step", t("grid_s"), None, "the grid only", "grid only (no training)",
                  marker("grid").is_file()) if no_train else
                 (steps_done, cells * steps, "step",
                  t("grid_s") + (n * t("nemotron_s") if recipe.get("nemotron") else 0) + cells * steps / 10_000 * t("train_s_per_10k"),
                  t("train_s_per_10k") / 10_000,
                  f"train {t('train_s_per_10k') / 60:.1f} min per 10k steps per cell, {timings.source('train_s_per_10k')}",
                  f"{current}: step {min(curves[current][-1][0], steps) if curves.get(current) else 0}/{steps}"
                  if current else "", bool(train_mark.get("ok"))),
        "evaluate": (len(seeds), cells * eval_n, "episode", cells * eval_n * t("eval_s") + t("results_s"), t("eval_s"),
                     f"eval {t('eval_s'):.0f} s/episode, {timings.source('eval_s')}", f"seed {len(seeds)}/{cells * eval_n}",
                     results_done),
        "export": (int(export.get("done") or 0), int(export.get("total") or 0), "file", t("export_s"), None,
                   f"export ~{t('export_s'):.0f} s, {timings.source('export_s')}",
                   export.get("detail") or ("" if export.get("status") != "done" else "ready"),
                   export.get("status") == "done"),
    }
    out_stages = stage_rows(STAGES, plan, run, status=status, active=active, now=now,
                            skipped=lambda sid: bool(recipe.get("dry_run")) or (sid != "export" and STAGES.index(sid) > STAGES.index(last)))

    remaining = sum(s["eta_s"] or 0 for s in out_stages if s["status"] in ("pending", "running"))
    if status in ("done", "failed", "cancelled"):
        remaining = 0.0 if status == "done" else None
    # --- the GPU ------------------------------------------------------------------------------------
    current_stage = next((s["id"] for s in out_stages if s["status"] == "running"), None)
    ours = lock is not None and f"human-exp:{run['id']}:" in lock
    if position is not None:  # behind other runs in our queue
        gpu = {"state": "queued", "position": position, "holder": lock}
    elif active and current_stage in GPU_STAGES:
        # Ours once the lock names this run; until then it waits for whoever holds it (the runner re-checks).
        gpu = ({"state": "running", "position": None, "holder": lock} if ours or lock is None
               else {"state": "queued", "position": None, "holder": lock})
    else:
        gpu = {"state": "idle", "position": None, "holder": None}

    started_at, finished_at = run.get("started_at"), run.get("finished_at")
    snap = {
        "id": run["id"], "name": run.get("name") or run["id"], "created": run["created"], "status": status,
        "detail": run.get("detail"), "resumable": bool(run.get("resumable")), "demos": n, "gpu": gpu,
        "elapsed_s": None if started_at is None else (finished_at or now) - started_at,
        "remaining_s": remaining, "stages": out_stages,
        "check": [{"demo": r["id"], **{k: (r["replay"] or {}).get(k) for k in ("success", "reasons", "duration", "path_length",
                                                                              "max_contact_force", "settle_time", "frames")}}
                  for r in rows if marker("physics", r["id"]).is_file()],
        "repair": [{"demo": r["id"], "status": r["repair"]["status"], "repairs": r["repair"]["repairs"],
                    "before": r["repair"]["before"], "after": r["repair"]["after"], "output_id": r["repair"]["output_id"]}
                   for r in rows if r["repair"]],
        # A failed variant has no episode id in the stage file: it keeps the name it would have had, so each row has one
        "variants": [{**v, "id": v.get("id") or f"{(_read_json(marker('multiply', r['id'])) or {}).get('source') or r['id']}_m{v.get('seed')}",
                      "source": r["id"]} for r in rows for v in r["variants"]],
        "train": {"step": (min(curves[current][-1][0], steps) if current and curves.get(current) else 0), "steps": steps,
                  "cell": current, "loss": curves.get(current, []) if current else [],
                  "checkpoints": [{"step": int(p.name), "name": p.name}
                                  for p in sorted((tdir / "train" / current / "checkpoints").glob("[0-9]*"))]
                  if tdir and current else [],
                  "eta_s": next(s["eta_s"] for s in out_stages if s["id"] == "train")},
        "evaluate": {"seeds": seeds, "planned": cells * eval_n},
        "artifacts": export.get("artifacts") or [],
        "log": _tail(root / "run.log", LOG_LINES),
    }
    if recipe.get("dry_run"):
        snap["plan_s"] = sum(s["eta_s"] or 0 for s in out_stages)
    return snap
