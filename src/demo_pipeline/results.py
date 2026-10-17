"""The real results file (DATA_DIR/results/results.json), pure: inputs in, one JSON-able dict out.

The shape is the one web/src/pm/results/results.ts parses (web/src/pm/mocks/results.sample.json), with
"sample": false. A value nobody has measured yet is null, never 0, and its key is listed in "pending".
Every value, null or not, has an entry in "sources": the file it came from (registry line, eval file,
yield file, spec) and the details needed to check it, or why it is missing.

Inputs are (source, data) pairs, so this module never touches the disk:
  registry_rows  ("<registry.jsonl>#L<n>", row)  lerobot_tools.experiments rows; sim_eval fills eval_success
  eval_files     (path, {"run", "summary", ...})  sim_eval/scripts/run_eval.py results files
  yield_files    (path, {"robot", "attempts", "successes", "yield", ...})  sim_worker multiply_run yield.json
  scores         (path, scores.json)  scripts/score_pipeline_run.py
  ablations      (path, scores.json)  T4's scripts/ablation_diagnosis.py (diagnosis arms on a frozen set)
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from datetime import datetime, timezone

from demo_pipeline.stats import wilson_ci

Sourced = tuple[str, dict]

MIMICGEN = (0.38, 0.74)  # published data-generation success range
MIMICGEN_SOURCE = "docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md (section 5: MimicGen's published 38-74%)"
SERIES = (  # (results.ts key, label, experiment condition); keys and labels as in results.sample.json
    ("raw", "Raw human demos", "raw"),
    ("raw_multiply", "Raw + multiply", "raw_multiply"),
    ("ours", "Perfected + multiply", "perfected_multiply"),
)
ABLATION = (
    ("rules", "Rules-only repair", "rules_multiply"),
    ("ours", "Rules + Nemotron repair", "perfected_multiply"),
)
DEMOS = (5, 10, 20)  # the planned human demo counts (sprint 3b, T4 run_experiment --n-human 5,10,20)
ABLATION_DEMOS = 10  # the planned ablation point, used until some demo count has both bars measured
NOTE = ("Measured results, built by scripts/build_results_json.py. null means not measured yet (pending); "
        "every value's source file is in `sources`.")


def _rate(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or math.isnan(v) or not 0.0 <= v <= 1.0:
        return None
    return float(v)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _ci(value: float, detail: dict) -> tuple[dict | None, str]:
    """The Wilson 95% interval from the measurement's own counts, or None and why it can't be computed."""
    n, k = detail.get("n"), detail.get("successes")
    if not _is_int(n) or n <= 0:
        return None, f"n is not a positive integer ({n!r})"
    if not _is_int(k):
        return None, f"successes is not an integer ({k!r})"
    if abs(k / n - value) > 1e-6:
        return None, f"successes / n = {k}/{n} does not match the rate {value}"
    low, high = wilson_ci(k, n)
    return {"low": low, "high": high, "successes": k, "n": n, "method": "wilson_95"}, ""


def _norm_path(p: str | None) -> str | None:
    return None if p is None else str(p).replace("\\", "/").rstrip("/").lower()


def _cell_name(row: dict) -> str | None:
    cell = row.get("cell") or {}
    if cell.get("name"):
        return cell["name"]
    if cell.get("condition") and cell.get("n_human") is not None:
        return f"{cell['condition']}_{cell['n_human']}"
    return None


def _candidates(cell: str, registry_rows: list[Sourced],
                eval_files: list[Sourced]) -> tuple[list[dict], list[dict], str, list[str]]:
    """(usable measurements, rejected ones, why there is none, every record about the cell) for one cell."""
    found, rejected = [], []
    rows = [(src, r) for src, r in registry_rows if _cell_name(r) == cell]
    checked = [src for src, _ in rows] + [src for src, e in eval_files if (e.get("run") or {}).get("cell") == cell]
    trained = [(src, r) for src, r in rows if r.get("status") == "ok"]
    for src, r in trained:
        if r.get("eval_success") is None:
            continue
        value = _rate(r["eval_success"])
        ev = r.get("eval") or {}
        if value is None:
            rejected.append({"file": src, "value": repr(r["eval_success"]), "why": "eval_success is not a rate in [0, 1]"})
            continue
        found.append({"value": value, "file": src, "when": ev.get("evaluated_at") or r.get("created") or "",
                      "detail": {"run_id": r.get("run_id"), "checkpoint": r.get("checkpoint"), "n": ev.get("n"),
                                 "successes": ev.get("successes"), "evaluated_at": ev.get("evaluated_at"),
                                 "results_file": ev.get("results_file")}})
    if not found:  # an eval whose registry update failed (or never ran) still measured this cell's policy
        checkpoints = {_norm_path(r.get("checkpoint")) for _, r in trained if r.get("checkpoint")}
        for src, e in eval_files:
            run, summary = e.get("run") or {}, e.get("summary") or {}
            if run.get("cell") != cell:
                continue
            value = _rate(summary.get("success_rate"))
            if value is None:
                rejected.append({"file": src, "value": repr(summary.get("success_rate")),
                                 "why": "success_rate is not a rate in [0, 1]"})
            elif checkpoints and _norm_path(run.get("checkpoint")) not in checkpoints:
                rejected.append({"file": src, "value": value,
                                 "why": f"its checkpoint {run.get('checkpoint')} is not the cell's trained checkpoint"})
            else:
                found.append({"value": value, "file": src, "when": run.get("started") or "",
                              "detail": {"checkpoint": run.get("checkpoint"), "n": summary.get("n"),
                                         "successes": summary.get("successes"), "started": run.get("started"),
                                         "registry_row": bool(rows)}})
    if found:
        why = ""
    elif not rows:
        why = f"no registry row or eval file for cell {cell}"
    elif not trained:
        why = f"cell {cell} has no successfully trained registry row"
    else:
        why = f"cell {cell} is trained but has no eval_success (not evaluated yet)"
    return found, rejected, why, checked


def _pick(found: list[dict], rejected: list[dict], why: str, checked: list[str]) -> dict:
    """The newest measurement, with the others listed; or a null entry saying why and what was checked."""
    if not found:
        entry = {"value": None, "file": None, "missing": why, "checked": checked}
    else:
        order = sorted(range(len(found)), key=lambda i: (found[i]["when"], i))
        best = found[order[-1]]
        entry = {"value": best["value"], "file": best["file"], "detail": best["detail"]}
        entry["ci"], why_no_ci = _ci(best["value"], best["detail"])
        if why_no_ci:
            entry["ci_missing"] = why_no_ci
        others = [{"value": found[i]["value"], "file": found[i]["file"]} for i in order[:-1]]
        if others:
            entry["others"] = others
    if rejected:
        entry["rejected"] = rejected
    return entry


def _yield(yield_files: list[Sourced], robot: str) -> dict:
    found, rejected = [], []
    for src, y in yield_files:
        if y.get("robot") != robot:
            continue
        dataset = "variant_attempts" in y  # a multiply dataset manifest (T2 sprint 6, e.g. home_v1_manifest.json)
        attempts = y.get("variant_attempts") if dataset else y.get("attempts")
        value = _rate(y.get("yield"))
        if not isinstance(attempts, int) or attempts <= 0 or value is None:
            rejected.append({"file": src, "why": f"attempts {attempts!r}, yield {y.get('yield')!r}"})
            continue
        detail = {"attempts": attempts, "successes": y.get("variant_successes" if dataset else "successes"),
                  "reasons": y.get("variant_reasons" if dataset else "reasons"), "seed0": y.get("seed0"), "robot": robot}
        if dataset:
            detail.update(name=y.get("name"), home_start=y.get("home_start"))
        found.append({"value": value, "file": src, "attempts": attempts, "detail": detail})
    if not found:
        entry = {"value": None, "file": None, "missing": f"no {robot} multiply yield.json with attempts > 0"}
    else:  # the largest run; a tie goes to the later input (the script passes files oldest first)
        order = sorted(range(len(found)), key=lambda i: (found[i]["attempts"], i))
        best = found[order[-1]]
        entry = {"value": best["value"], "file": best["file"], "detail": best["detail"]}
        if len(order) > 1:
            entry["others"] = [{"value": found[i]["value"], "file": found[i]["file"]} for i in order[:-1]]
    if rejected:
        entry["rejected"] = rejected
    return entry


def _diagnosis(scores: list[Sourced]) -> list[dict]:
    keys = ("set", "diagnoser", "scored", "counts", "per_type", "rules_types", "all")
    return [{**{k: s.get(k) for k in keys}, "not_scored": len(s.get("not_scored") or []), "source": src}
            for src, s in scores]


ARM_KEYS = ("per_type", "total", "negatives_fp_rate", "grasp_fp_rate_on_centered", "r1_bar", "model_calls",
            "est_cost_usd", "fallbacks", "pending")


def _when(created) -> datetime:
    try:
        when = datetime.fromisoformat(created)
    except (TypeError, ValueError):
        return datetime.min.replace(tzinfo=timezone.utc)
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def _diagnosis_ablation(ablations: list[Sourced]) -> tuple[list[dict], list[dict]]:
    """T4's ablation_diagnosis.py runs (oldest first), each arm's scores as written; and the runs that scored
    nothing (e.g. every episode rejected by the manifest check), listed with why instead of as numbers."""
    runs, unscored = [], []
    for src, a in sorted(ablations, key=lambda x: _when(x[1].get("created"))):
        # sprint 4 runs had no manifest check: their "episodes" list is what was scored (later it is a count)
        old = a.get("episodes") if isinstance(a.get("episodes"), list) else []
        scored = a["scored_episodes"] if "scored_episodes" in a else old
        rejected = a.get("rejected") or []
        if not scored:
            unscored.append({"file": src, "why": f"no episode scored ({len(rejected)} rejected)"})
            continue
        arms = {name: {k: arm.get(k) for k in ARM_KEYS} for name, arm in (a.get("diagnosers") or {}).items()}
        runs.append({"source": src, "created": a.get("created"), "manifest": a.get("manifest"), "scored": len(scored),
                     "rejected": len(rejected), "stopped": a.get("stopped"), "arms": arms})
    return runs, unscored


def build_results(registry_rows: Iterable[Sourced], eval_files: Iterable[Sourced], yield_files: Iterable[Sourced],
                  scores: Iterable[Sourced], *, demos: Iterable[int] = DEMOS, ablation_demos: int = ABLATION_DEMOS,
                  robot: str = "franka", ablations: Iterable[Sourced] = ()) -> dict:
    registry_rows, eval_files = list(registry_rows), list(eval_files)
    demos = [int(n) for n in demos]
    sources: dict[str, dict] = {}

    def cell(condition: str, n: int) -> dict:
        return _pick(*_candidates(f"{condition}_{n}", registry_rows, eval_files))

    series = []
    for key, label, condition in SERIES:
        values = []
        for i, n in enumerate(demos):
            entry = cell(condition, n)
            sources[f"series.{key}.success[{i}]"] = entry
            values.append(entry["value"])
        series.append({"key": key, "label": label, "success": values})

    both = [n for n in sorted({n for _, r in registry_rows if isinstance((r.get("cell") or {}).get("n_human"), int)
                               for n in [r["cell"]["n_human"]]} | set(demos))
            if all(cell(c, n)["value"] is not None for _, _, c in ABLATION)]
    if both:
        ab_n, rule = both[-1], "the largest demo count with both ablation bars measured"
    else:
        ab_n, rule = ablation_demos, f"no demo count has both bars measured; the planned {ablation_demos}"
    sources["ablation.demos"] = {"value": ab_n, "file": None, "detail": {"rule": rule}}
    bars = []
    for key, label, condition in ABLATION:
        entry = cell(condition, ab_n)
        sources[f"ablation.bars.{key}.success"] = entry
        bars.append({"key": key, "label": label, "success": entry["value"]})

    sources["multiply_yield.ours"] = _yield(list(yield_files), robot)
    sources["multiply_yield.mimicgen"] = {"value": list(MIMICGEN), "file": MIMICGEN_SOURCE}
    ablation_runs, ablation_unscored = _diagnosis_ablation(list(ablations))

    return {
        "sample": False,
        "note": NOTE,
        "demos": demos,
        "series": series,
        "ablation": {"demos": ab_n, "bars": bars},
        "multiply_yield": {"ours": sources["multiply_yield.ours"]["value"], "mimicgen": list(MIMICGEN)},
        "diagnosis": _diagnosis(list(scores)),
        "diagnosis_ablation": ablation_runs,
        "diagnosis_ablation_unscored": ablation_unscored,
        "pending": [k for k, v in sources.items() if v["value"] is None],
        "sources": sources,
    }
