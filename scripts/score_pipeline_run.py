"""Score a pipeline run's diagnoses against the experiment set's ground truth (pure, no sim).

    uv run python scripts/score_pipeline_run.py --set data/sets/pilot60 --diagnoser rules
    uv run python scripts/score_pipeline_run.py --set data/sets/pilot60 --compare      # the ablation table

Reads, for each demo id in <set>/manifest.json:
  - <set>/<id>/truth.json (scripts/make_experiment_set.py): the injected issues, dont_care expert stops included;
  - <set>/pipeline/<diagnoser>/<id>.json (scripts/run_pipeline_batch.py): status, decision, diagnosis_source,
    replays and the diagnosis's issues. If a result has no "issues" list, the diagnosis stored with the run's
    output demo, DemoStore <id>_<diagnoser>/diagnosis.json, is used instead. The store's <id>/diagnosis.json
    is never used: every diagnoser's run overwrites it, so it cannot tell rules from nemotron.
Writes <set>/pipeline/<diagnoser>/scores.json: per-issue-type P/R/F1 and time IoU, and the kept / perfected /
discarded counts.

A result holds only the pipeline's LAST diagnosis. After a failed verification the pipeline re-diagnoses the
repaired trajectory, whose timeline is not the truth's; such demos (any failed verification replay) are not
scored for detection, and each is listed in not_scored with the reason. Their status still counts.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from demo_pipeline.degrade import InjectedIssue  # noqa: E402
from demo_pipeline.schemas import Issue  # noqa: E402
from demo_pipeline.scoring import DiagnosisScore, TypeScore, aggregate, score_issues  # noqa: E402
from demo_pipeline.store import DemoStore  # noqa: E402

DIAGNOSERS = ("rules", "nemotron")
STATUSES = ("perfected", "kept", "discarded", "error", "pending")
RULES_TYPES = ("pause", "jitter", "idle_start_end")  # the only types the rules detector can emit


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _set_ids(set_dir: Path) -> list[str]:
    manifest = set_dir / "manifest.json"
    if not manifest.is_file():
        raise FileNotFoundError(f"{manifest} is missing; the set is incomplete or not a set")
    return [d["id"] for d in json.loads(manifest.read_text(encoding="utf-8"))["demos"]]


def _failed_verifications(id_: str, result: dict) -> int:
    return sum(1 for r in result.get("replays") or []
               if r.get("out_name") != f"{id_}_raw" and r.get("success") is False)


def _issues(id_: str, diagnoser: str, result: dict, result_path: Path,
            store: DemoStore | None) -> tuple[list[Issue] | None, str | None]:
    """The run's issues for this demo and the file they came from; (None, None) if there are none."""
    if isinstance(result.get("issues"), list):
        return [Issue.model_validate(i) for i in result["issues"]], str(result_path)
    if store is not None and result.get("status") in ("perfected", "kept"):
        out_id = result.get("output_demo_id") or f"{id_}_{diagnoser}"
        try:
            stored = store.get_stored_diagnosis(out_id)
        except (KeyError, ValueError):
            stored = None
        if stored is not None:
            return list(stored.diagnosis.issues), str(store.root / "demos" / out_id / "diagnosis.json")
    return None, None


def _subtotal(score: DiagnosisScore, kinds=RULES_TYPES) -> TypeScore:
    return sum((v for k, v in score.per_type.items() if k in kinds), TypeScore())


def _pooled(per_demo: list[dict]) -> DiagnosisScore:
    return aggregate(DiagnosisScore(per_type={k: TypeScore(**v) for k, v in d["per_type"].items()}) for d in per_demo)


def _report(score: DiagnosisScore) -> dict:
    return {"per_type": {k: v.report() for k, v in score.per_type.items()},
            "rules_types": _subtotal(score).report(), "all": score.total.report()}


def score_run(set_dir: Path, diagnoser: str, *, store: DemoStore | None = None, iou_threshold: float = 0.3,
              write: bool = True) -> dict:
    """Score <set>/pipeline/<diagnoser>/ against the set's truth; writes scores.json there unless write=False."""
    set_dir = Path(set_dir)
    ids = _set_ids(set_dir)
    run_dir = set_dir / "pipeline" / diagnoser
    if store is None:
        store = DemoStore()
    counts = Counter({s: 0 for s in STATUSES})
    sources: Counter = Counter()
    demos, not_scored = [], []
    clean = {"n": 0, "decision_keep": 0, "status_kept": 0}
    for id_ in ids:
        result_path = run_dir / f"{id_}.json"
        result = _read_json(result_path)
        status = (result or {}).get("status", "pending")
        counts[status if status in STATUSES else "error"] += 1
        row = {"id": id_, "status": status, "decision": (result or {}).get("decision"),
               "diagnosis_source": (result or {}).get("diagnosis_source"), "diagnosis_from": None, "scored": False}
        demos.append(row)
        if result is None:
            not_scored.append({"id": id_, "reason": f"no result at {result_path}"})
            continue
        if row["diagnosis_source"]:
            sources[row["diagnosis_source"]] += 1
        if status not in ("perfected", "kept", "discarded"):
            not_scored.append({"id": id_, "reason": f"status {status}: {result.get('error') or 'no diagnosis'}"})
            continue
        failed = _failed_verifications(id_, result)
        if failed:
            not_scored.append({"id": id_, "reason": f"re-diagnosed after {failed} failed verification(s): the stored "
                                                    "diagnosis may be of a repaired trajectory, not the truth's timeline"})
            continue
        truth_path = set_dir / id_ / "truth.json"
        truth_doc = _read_json(truth_path)
        if truth_doc is None:
            not_scored.append({"id": id_, "reason": f"no readable truth.json at {truth_path}"})
            continue
        issues, came_from = _issues(id_, diagnoser, result, result_path, store)
        if issues is None:
            not_scored.append({"id": id_, "reason": "no stored diagnosis (no issues in the result or the store)"})
            continue
        truth = [InjectedIssue.model_validate(i) for i in truth_doc["issues"]]
        score = score_issues(issues, truth, iou_threshold)
        row.update(scored=True, diagnosis_from=came_from,
                   per_type={k: v.model_dump() for k, v in score.per_type.items()})
        if not any(not t.dont_care for t in truth):
            clean["n"] += 1
            clean["decision_keep"] += row["decision"] == "keep"
            clean["status_kept"] += status == "kept"

    scored = [d for d in demos if d["scored"]]
    out = {
        "set": str(set_dir), "diagnoser": diagnoser, "iou_threshold": iou_threshold,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "generator": "scripts/score_pipeline_run.py",
        "counts": dict(counts), "diagnosis_source": dict(sources), "scored": len(scored), "not_scored": not_scored,
        **_report(_pooled(scored)), "clean_demos": clean, "demos": demos,
    }
    if write:
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "scores.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    return out


def _fmt(x: float | None) -> str:
    return "  -  " if x is None else f"{x:.2f}"


def compare(set_dir: Path, diagnosers=DIAGNOSERS, *, store: DemoStore | None = None, iou_threshold: float = 0.3) -> str:
    """Side-by-side P/R/F1 per issue type, pooled over the demos every available diagnoser scored."""
    set_dir = Path(set_dir)
    runs: dict[str, dict | None] = {}
    for d in diagnosers:
        has_results = (set_dir / "pipeline" / d).is_dir() and any(
            p.name != "scores.json" and p.name != "summary.json" for p in (set_dir / "pipeline" / d).glob("*.json"))
        runs[d] = score_run(set_dir, d, store=store, iou_threshold=iou_threshold) if has_results else None
    present = [d for d in diagnosers if runs[d] is not None]
    common = set.intersection(*({x["id"] for x in runs[d]["demos"] if x["scored"]} for d in present)) if present else set()
    pooled = {d: _pooled([x for x in runs[d]["demos"] if x["id"] in common]) for d in present}
    kinds = sorted({k for s in pooled.values() for k in s.per_type})

    lines = [f"set {set_dir}; IoU >= {iou_threshold}; common scored demos: {len(common)}"]
    lines += [f"{d}: no pipeline results" for d in diagnosers if runs[d] is None]
    head = " | ".join(f"{d} P | {d} R | {d} F1" for d in diagnosers)
    lines += ["", f"| type | {head} |", "|---|" + "---|" * (3 * len(diagnosers))]

    def cells(d: str, s: TypeScore | None) -> list[str]:
        if runs[d] is None:
            return ["pending"] * 3
        return [_fmt(s.precision), _fmt(s.recall), _fmt(s.f1)] if s is not None else ["  -  "] * 3

    for k in kinds:
        row = [c for d in diagnosers for c in cells(d, pooled[d].per_type.get(k) if d in pooled else None)]
        lines.append(f"| {k} | " + " | ".join(row) + " |")
    for label, pick in (("**rules' types**", _subtotal), ("**all types**", lambda s: s.total)):
        row = [c for d in diagnosers for c in cells(d, pick(pooled[d]) if d in pooled else None)]
        lines.append(f"| {label} | " + " | ".join(row) + " |")
    lines.append("")
    for d in diagnosers:
        if runs[d] is not None:
            c = runs[d]["counts"]
            lines.append(f"{d}: kept / perfected / discarded = {c['kept']} / {c['perfected']} / {c['discarded']} "
                         f"(error {c['error']}, pending {c['pending']}); diagnosis source {runs[d]['diagnosis_source']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--set", dest="set_dir", type=Path, required=True, help="DATA_DIR/sets/<name>")
    p.add_argument("--diagnoser", choices=DIAGNOSERS)
    p.add_argument("--compare", action="store_true", help="score rules and nemotron and print them side by side")
    p.add_argument("--store", type=Path, default=None, help="demo store root (default DATA_DIR)")
    p.add_argument("--iou", type=float, default=0.3)
    args = p.parse_args(argv)
    if not args.compare and args.diagnoser is None:
        p.error("give --diagnoser or --compare")
    store = DemoStore(args.store) if args.store is not None else None
    if args.compare:
        print(compare(args.set_dir, store=store, iou_threshold=args.iou))
        return 0
    s = score_run(args.set_dir, args.diagnoser, store=store, iou_threshold=args.iou)
    print(f"{args.diagnoser} on {args.set_dir}: scored {s['scored']}, not scored {len(s['not_scored'])}; "
          f"counts {s['counts']}")
    for k, v in {**s["per_type"], "rules' types": s["rules_types"], "all types": s["all"]}.items():
        print(f"  {k:16s} P {_fmt(v['precision'])}  R {_fmt(v['recall'])}  F1 {_fmt(v['f1'])}  IoU {_fmt(v['mean_iou'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
