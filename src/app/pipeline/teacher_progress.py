"""A teacher run's state (the "teacher" recipe, app.pipeline.teacher_runner), in the pipeline pages' shape: the same keys
as a demos run's snapshot (app.pipeline.progress), with five stages and a `teacher` block.

    teacher   T3's RL training                          (per iteration: rsl_rl's "Learning iteration i/N")
    gate      the teacher on the gate seeds, then SANT's replay of each   (per episode, both)
    distill   T6's round 0: teacher rollouts, the mixed grid, ACT, the checkpoint selection
    dagger    T6's DAgger round 1 (only when asked; its stop rule may end it after the rollouts)
    export    the downloads (app.pipeline.export.build_teacher_artifacts)
`train` is the current round's student training (its loss curve and checkpoints); `evaluate` the gate's verdicts
(cell "teacher_gate"); `check`, `repair` and `variants` stay empty. `teacher`: {iteration, iterations, gate, rounds}.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from app.config import REPO_ROOT

from .progress import LOG_LINES, PUBLIC_STATUS, _jsonl, _read_json, _tail, _train_log, stage_rows
from .teacher_runner import DISTILL_SMOKE, GATE_SEED0, TeacherConfig, TeacherRun
from .timings import Timings

STAGES = ("teacher", "gate", "distill", "dagger", "export")
GPU_STAGES = {"teacher", "gate", "distill", "dagger"}
_ITER = re.compile(r"Learning iteration (\d+)/(\d+)")
_VERIFIED = re.compile(r"^seed \d+: ", re.M)
# T6's defaults (sim_eval/distill_round.py RoundConfig) and its smoke flags
DISTILL = {"steps": 60000, "candidates": 2, "select_n": 30, "dagger_n": 40}
DISTILL_SMOKE_SIZES = {"steps": int(DISTILL_SMOKE[DISTILL_SMOKE.index("--steps") + 1]), "candidates": 2,
                       "select_n": int(DISTILL_SMOKE[DISTILL_SMOKE.index("--select-n") + 1]), "dagger_n": 40}


def teacher_root(data: Path, run_id: str) -> Path:
    return Path(data) / "teacher" / run_id


def _config(run: dict, data: Path) -> TeacherConfig:
    """The run's TeacherConfig: the runner's frozen config.json once it has started, else the recipe's."""
    frozen = _read_json(teacher_root(data, run["id"]) / "config.json") or {}
    r = run["recipe"]
    repo = frozen.get("repo") or os.environ.get("SANT_TEACHER_REPO") or str(REPO_ROOT)
    return TeacherConfig(name=run["id"], data=Path(data), repo=Path(repo), human_run=r.get("human_run") or "",
                         rl_iterations=int(frozen.get("rl_iterations") or r.get("rl_iterations") or 1500),
                         teacher_n=int(frozen.get("teacher_n") or r.get("teacher_n") or 300),
                         dagger=bool(r.get("dagger")), smoke=bool(r.get("smoke")))


def _rl_iteration(log: Path) -> tuple[int, int] | None:
    """(iterations done, the target of the current child) from the trainer's output, or None."""
    try:
        text = log.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    found = _ITER.findall(text)
    return (int(found[-1][0]) + 1, int(found[-1][1])) if found else None


def _round(t: TeacherRun, r: int, n: int, sizes: dict, timings: Timings, roll_key: str) -> dict:
    """One distill round's phases: rollouts, grid, train, select; what is done and what is left (seconds)."""
    per = timings.per
    rdir = t.round_dir(r)
    rows = _jsonl(rdir / "rollouts.jsonl")
    done_rolls = min(len({x.get("seed") for x in rows}), n)
    rolled = (rdir / "rollouts_done.json").is_file()
    decision = _read_json(rdir / "decision.json") or {}
    run_dir = t.train_run(r)
    label = f"distill_r{r}"
    curve = _train_log(run_dir / "logs" / f"{label}.log") if run_dir else []
    steps = sizes["steps"]
    step = min(curve[-1][0], steps) if curve else 0
    final = run_dir is not None and (run_dir / "train" / label / "checkpoints" / f"{steps:06d}" / "pretrained_model").is_dir()
    grid_name = f"{t.cfg.name}_r{r}{t.tag(r)}"
    picked = len(list((t.cfg.repo / "data" / "evals" / grid_name).glob(f"{label}_s*.json")))
    selection = _read_json(rdir / "selection.json")
    stopped = bool(decision.get("stop"))
    grid_s = n * per("frames_per_rollout") / 1000 * per("grid_s_per_1k_frames")
    left = {
        "rollouts": 0.0 if rolled else (n - done_rolls) * per(roll_key),
        "grid": 0.0 if (run_dir or stopped) else grid_s,
        "train": 0.0 if (final or stopped) else (steps - step) / 10_000 * per("train_s_per_10k"),
        "select": 0.0 if (selection or stopped) else (sizes["candidates"] - picked) * sizes["select_n"] * per("eval_s"),
    }
    total = n * per(roll_key) + grid_s + steps / 10_000 * per("train_s_per_10k") + sizes["candidates"] * sizes["select_n"] * per("eval_s")
    if not rolled:
        phase, items = "rollouts", (done_rolls, n, "rollout")
    elif stopped:
        phase, items = "stopped", (n, n, "rollout")
    elif run_dir is None:
        phase, items = "grid", (done_rolls, n, "rollout")
    elif not final:
        phase, items = "train", (step, steps, "step")
    elif selection:
        phase, items = "done", (sizes["candidates"], sizes["candidates"], "candidate")
    else:
        phase, items = "select", (picked, sizes["candidates"], "candidate")
    return {"round": r, "phase": phase, "items": items, "left_s": sum(left.values()), "total_s": total,
            "rollouts": {"done": done_rolls, "total": n, "successes": sum(bool(x.get("success")) for x in rows)},
            "train": {"run": run_dir, "label": label, "curve": curve, "step": step, "steps": steps},
            "selection": selection, "decision": decision or None, "stopped": stopped}


def teacher_snapshot(run: dict, *, data: Path, timings: Timings, now: float, lock: str | None,
                     position: int | None) -> dict:
    data = Path(data)
    cfg = _config(run, data)
    t = TeacherRun(cfg, deps=None)  # paths only
    root = teacher_root(data, run["id"])
    recipe = run["recipe"]
    per = timings.per
    status = PUBLIC_STATUS.get(run["status"], run["status"])
    active = run["status"] in ("running", "cancelling")
    marker = lambda s: _read_json(root / "stages" / f"{s}.json")  # noqa: E731
    sizes = DISTILL_SMOKE_SIZES if cfg.smoke else DISTILL
    gate_n = cfg.gate_n

    # teacher: RL iterations
    target = cfg.rl_iterations
    m_teacher = marker("teacher")
    if m_teacher:
        it = target
    else:
        seen = _rl_iteration(root / "logs" / "teacher.log")
        last = t.latest_model()
        it = max(seen[0] if seen else 0, (last[1] + 1) if last else 0)
        it = min(it, target)
    # gate: the teacher's episodes in Isaac, then their replays in SANT's eval env
    traj = len(list((t.gate_dir / "trajectories").glob("*.json"))) if t.gate_dir.is_dir() else 0
    m_eval, m_verify = marker("gate_eval"), marker("gate_verify")
    ev_done = gate_n if m_eval else min(traj, gate_n)
    try:
        verified = len(_VERIFIED.findall((root / "logs" / "gate_verify.log").read_text(encoding="utf-8", errors="replace")))
    except OSError:
        verified = 0
    ver_done = gate_n if m_verify else min(verified, gate_n)
    report = _read_json(t.gate_dir / "verify.json") or {}
    gate_ok = bool(m_verify) and m_verify["n"] and m_verify["successes"] / m_verify["n"] >= cfg.gate_min
    r0 = _round(t, 0, cfg.teacher_n, sizes, timings, "rollout_s")
    r1 = _round(t, 1, sizes["dagger_n"], sizes, timings, "dagger_rollout_s") if cfg.dagger else None
    export = run.get("export") or {}

    def round_plan(rd: dict, stage: str, name: str) -> tuple:
        done_n, total, unit = rd["items"]
        detail = {"rollouts": f"{name} rollouts {rd['rollouts']['done']}/{rd['rollouts']['total']}",
                  "grid": "mixing the grid", "train": f"ACT step {rd['train']['step']}/{rd['train']['steps']}",
                  "select": f"selecting: candidate {done_n}/{total}",
                  "stopped": "the DAgger stop rule ended the round",
                  "done": f"chose step {(rd['selection'] or {}).get('chosen_step')}"}[rd["phase"]]
        return (done_n, total, unit, rd["left_s"] if (marker(stage) is None) else 0.0, None,
                f"rollouts {per('rollout_s' if stage == 'distill_r0' else 'dagger_rollout_s'):.0f} s each, ACT "
                f"{per('train_s_per_10k') / 60:.1f} min per 10k steps, selection {per('eval_s'):.0f} s/episode "
                f"({timings.source('rollout_s')})", detail, marker(stage) is not None)

    plan = {
        "teacher": (it, target, "iteration", (target - it) * per("rl_iter_s"), per("rl_iter_s"),
                    f"RL {per('rl_iter_s'):.1f} s/iteration, {timings.source('rl_iter_s')}",
                    f"iteration {it}/{target}", m_teacher is not None),
        "gate": (ev_done + ver_done, 2 * gate_n, "episode",
                 (gate_n - ev_done) * per("gate_eval_s") + (gate_n - ver_done) * per("gate_verify_s"),
                 (per("gate_eval_s") + per("gate_verify_s")) / 2,
                 f"teacher {per('gate_eval_s'):.0f} s + replay {per('gate_verify_s'):.0f} s per episode, "
                 f"{timings.source('gate_eval_s')}",
                 (f"teacher episodes {ev_done}/{gate_n}" if not m_eval else f"replays {ver_done}/{gate_n}")
                 if not m_verify else f"{m_verify['successes']}/{m_verify['n']} (gate {cfg.gate_min:.0%})", bool(gate_ok)),
        "distill": round_plan(r0, "distill_r0", "teacher"),
        "dagger": round_plan(r1, "dagger_r1", "DAgger") if r1 else (0, 0, "rollout", 0.0, None, "", "not asked", False),
        "export": (int(export.get("done") or 0), int(export.get("total") or 0), "file", per("export_s"), None,
                   f"export ~{per('export_s'):.0f} s, {timings.source('export_s')}",
                   export.get("detail") or ("" if export.get("status") != "done" else "ready"), export.get("status") == "done"),
    }
    out_stages = stage_rows(STAGES, plan, run, status=status, active=active, now=now,
                            skipped=lambda sid: bool(recipe.get("dry_run")) or (sid == "dagger" and not cfg.dagger))
    # the rounds are many phases: their progress is the share of their estimated time done
    for row, rd in (("distill", r0), ("dagger", r1)):
        st = next(s for s in out_stages if s["id"] == row)
        if rd and st["status"] not in ("done", "skipped"):
            st["progress"] = round(max(0.0, 1 - rd["left_s"] / rd["total_s"]) if rd["total_s"] else 0.0, 4)
    remaining = sum(s["eta_s"] or 0 for s in out_stages if s["status"] in ("pending", "running"))
    if status in ("done", "failed", "cancelled"):
        remaining = 0.0 if status == "done" else None

    current_stage = next((s["id"] for s in out_stages if s["status"] == "running"), None)
    if position is not None:
        gpu = {"state": "queued", "position": position, "holder": lock}
    elif active and current_stage in GPU_STAGES:
        ours = lock is None or run["id"] in lock  # T3's and T6's scripts and this runner name the run in the lock
        gpu = {"state": "running" if ours else "queued", "position": None, "holder": lock}
    else:
        gpu = {"state": "idle", "position": None, "holder": None}

    cur = r1 if (r1 and marker("distill_r0")) else r0
    tr = cur["train"]
    started_at, finished_at = run.get("started_at"), run.get("finished_at")
    snap = {
        "id": run["id"], "kind": "teacher", "name": run.get("name") or run["id"], "created": run["created"],
        "status": status, "detail": run.get("detail"), "resumable": bool(run.get("resumable")), "demos": 0, "gpu": gpu,
        "elapsed_s": None if started_at is None else (finished_at or now) - started_at, "remaining_s": remaining,
        "stages": out_stages, "check": [], "repair": [], "variants": [],
        "train": {"step": tr["step"], "steps": tr["steps"], "cell": tr["label"], "loss": tr["curve"],
                  "checkpoints": [{"step": int(p.name), "name": p.name}
                                  for p in sorted((tr["run"] / "train" / tr["label"] / "checkpoints").glob("[0-9]*"))]
                  if tr["run"] else [],
                  "eta_s": next(s["eta_s"] for s in out_stages if s["id"] == ("dagger" if cur is r1 else "distill"))},
        "evaluate": {"seeds": [{"seed": int(seed), "success": bool(v.get("success")), "reasons": v.get("reasons", []),
                                "cell": "teacher_gate"} for seed, v in sorted((report.get("verdicts") or {}).items())],
                     "planned": gate_n},
        "artifacts": export.get("artifacts") or [],
        "log": _tail(root / "run.log", LOG_LINES),
        "teacher": {
            "iteration": it, "iterations": target, "human_run": cfg.human_run, "teacher_n": cfg.teacher_n,
            "dagger": cfg.dagger, "smoke": cfg.smoke,
            "gate": {"successes": (m_verify or {}).get("successes"), "n": (m_verify or {}).get("n"),
                     "min": cfg.gate_min,
                     "seeds": [GATE_SEED0, GATE_SEED0 + gate_n - 1], "passed": bool(gate_ok) if m_verify else None},
            "rounds": [{"round": rd["round"], "phase": rd["phase"], "rollouts": rd["rollouts"],
                        "selection": rd["selection"], "decision": rd["decision"]} for rd in (r0, r1) if rd],
        },
    }
    if recipe.get("dry_run"):
        snap["plan_s"] = sum(s["eta_s"] or 0 for s in out_stages)
    return snap
