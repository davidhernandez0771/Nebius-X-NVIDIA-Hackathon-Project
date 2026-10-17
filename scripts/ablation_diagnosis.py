"""Diagnosis ablation on recorded episodes: rules vs hybrid (rules + Nemotron), scored against ground truth (sprint 4).

    uv run python scripts/ablation_diagnosis.py --episodes "C:/dev/pm-t2/data/episodes/degraded_*" \
        --diagnosers rules,hybrid --clean C:/dev/pm-t2/data/smoke_cam [--out DIR] [--limit N] \
        [--max-model-calls 50 --max-cost-usd 0.10]

Each episode folder is T2's degraded format: front/wrist frames, steps.npz, signals.npz, demo.json (the degraded
human demo: the trajectory the truth is timed in), truth.json (InjectedIssues) and verification.json. The clean
episode (no demo.json/truth.json) uses its recorded trajectory and an empty truth, so anything reported on it is
a false positive.

Diagnosers:
  rules               detect_rules (no model call)
  hybrid              app.ai.diagnose.diagnose_hybrid (one model call, two with a retry)
  nemotron            app.ai.diagnose.diagnose_gated, the model alone (sprint 2 calibration), for reference
  rules_grasp_metric  counterfactual, no model call: rules + a grasp_off_center at the first close whenever the
                      measured offset is >= GRASP_CENTERED_MM. It shows what the code-measured fact alone gives,
                      so Nemotron's own contribution to hybrid is not overstated.

A model failure (invalid reply twice, API error) scores the rules fallback, as the pipeline would, and counts it.
Writes <out>/cases/<case>__<diagnoser>.json per run (a rerun with the same --out skips them), then
<out>/scores.json and <out>/table.md. <out> defaults to DATA_DIR/ablation/<timestamp>/.

Budget: before every model call, the next diagnose is budgeted as 2 calls of $0.0025 (its worst case); if that
could pass --max-model-calls / --max-cost-usd, the run stops (exit 2) and the rest stays pending: rerun with the
same --out. Calls and cost come from nebius_llm's usage log.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))  # sibling scripts

from diagnose_real_episode import SMOKE_BIN_POSE, build_inputs  # noqa: E402
from run_pipeline_batch import CALLS_PER_DIAGNOSE, RESERVE_USD_PER_CALL, _write_json, read_model_usage  # noqa: E402

from app.ai.diagnose import (  # noqa: E402
    GRASP_CENTERED_MM,
    DiagnosisError,
    diagnose_gated,
    diagnose_hybrid,
    first_close,
    grasp_offset_mm,
    release_facts,
)
from app.jobs import PipelineAbort, align_signals, episode_frames  # noqa: E402
from demo_pipeline.degrade import InjectedIssue  # noqa: E402
from demo_pipeline.episode_io import load_signals  # noqa: E402
from demo_pipeline.measure import compute_windows  # noqa: E402
from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.rules import detect_rules  # noqa: E402
from demo_pipeline.schemas import Demo, Diagnosis, Issue, MetricsWindow, Pose, SimSignals, Trajectory  # noqa: E402
from demo_pipeline.scoring import DiagnosisScore, aggregate, score_diagnosis  # noqa: E402
from nebius_llm import TokenFactoryError  # noqa: E402

DIAGNOSERS = ("rules", "rules_grasp_metric", "code_all", "hybrid", "hybrid_blind", "nemotron")
MODEL_DIAGNOSERS = ("hybrid", "hybrid_blind", "nemotron")
# Sprint 5, pre-registered (T4 note): code_all's release check, and T7's R1 bar for hybrid_blind.
RELEASE_OUTSIDE_M = 0.02  # cube center this far outside the footprint at the release (T1 injects >= 5 cm)
RELEASE_HIGH_M = 0.12  # cube bottom this far above the rim at the release
R1_RECALL, R1_FP_RATE = 0.75, 0.25


@dataclass
class Case:
    name: str
    clean: bool
    traj: Trajectory
    signals: SimSignals
    windows: list[MetricsWindow]
    frames: list[tuple[float, bytes]]
    wrist: bytes | None
    task_text: str
    replay_success: bool
    truth: list[InjectedIssue]
    notes: list[str] = field(default_factory=list)
    kind: str | None = None  # v2's demo type (truth.json "type"), e.g. timing_centered
    bin_pose: Pose | None = None


def load_case(ep_dir: Path, clean: bool = False) -> Case:
    ep_dir = Path(ep_dir)
    bin_pose = None
    if (ep_dir / "demo.json").is_file():
        demo = Demo.model_validate_json((ep_dir / "demo.json").read_text(encoding="utf-8"))
        traj, bin_pose = demo.trajectory, demo.scene.bin_pose
        signals = align_signals(load_signals(ep_dir), traj.t)
        frames, wrist, task_text = episode_frames(ep_dir, traj.t)
        ver = ep_dir / "verification.json"
        success = json.loads(ver.read_text(encoding="utf-8"))["success"] if ver.is_file() else True
        notes = []
    else:  # the clean scripted episode: its recorded trajectory (what the frames show)
        inputs = build_inputs(ep_dir, SMOKE_BIN_POSE)
        traj, frames, wrist, task_text = inputs.traj, inputs.frames, inputs.wrist, inputs.task_text
        bin_pose = SMOKE_BIN_POSE
        signals = align_signals(load_signals(ep_dir), traj.t)
        success = True if inputs.replay_success is None else inputs.replay_success
        notes = list(inputs.notes)
    truth_path = ep_dir / "truth.json"
    raw_truth = {} if clean or not truth_path.is_file() else json.loads(truth_path.read_text(encoding="utf-8"))
    truth = [InjectedIssue.model_validate(i) for i in raw_truth.get("issues", [])]
    return Case(name=ep_dir.name, clean=clean, traj=traj, signals=signals, windows=compute_windows(traj, signals),
                frames=frames, wrist=wrist, task_text=task_text, replay_success=success, truth=truth, notes=notes,
                kind="clean" if clean else raw_truth.get("type"), bin_pose=bin_pose)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def demo_sha256(path: Path) -> str:
    """T1's manifest definition (scripts/make_measurement_set_v2.py): the Demo's JSON without created_at; not
    the file's bytes. (truth_sha256 is the file's bytes.)"""
    demo = Demo.model_validate_json(path.read_text(encoding="utf-8"))
    return hashlib.sha256(demo.model_dump_json(exclude={"created_at"}).encode()).hexdigest()


def check_manifest(dirs: list[Path], manifest: Path) -> tuple[list[Path], list[dict]]:
    """The episodes whose demo.json and truth.json match the frozen manifest's SHA-256s, and the rejected ones."""
    entries = {d["id"]: d for d in json.loads(manifest.read_text(encoding="utf-8"))["demos"]}
    ok, rejected = [], []
    for ep in dirs:
        try:
            demo_id = json.loads((ep / "demo.json").read_text(encoding="utf-8"))["id"]
        except (OSError, ValueError, KeyError):
            rejected.append({"episode": ep.name, "reason": "no readable demo.json"})
            continue
        entry = entries.get(demo_id)
        if entry is None:
            rejected.append({"episode": ep.name, "reason": f"demo {demo_id!r} is not in the manifest"})
        elif demo_sha256(ep / "demo.json") != entry["demo_sha256"]:
            rejected.append({"episode": ep.name, "reason": "demo.json does not match the manifest"})
        elif not (ep / "truth.json").is_file() or _sha256(ep / "truth.json") != entry["truth_sha256"]:
            rejected.append({"episode": ep.name, "reason": "truth.json does not match the manifest"})
        else:
            ok.append(ep)
    return ok, rejected


def grasp_metric(case: Case) -> Diagnosis:
    """rules + a code-only grasp_off_center when the measured offset at the first close reaches GRASP_CENTERED_MM."""
    rules = detect_rules(case.traj, case.windows, case.task_text)
    t_close, offset = first_close(case.traj), grasp_offset_mm(case.traj, case.signals)
    if t_close is None or offset is None or offset < GRASP_CENTERED_MM:
        return rules
    issue = Issue(type="grasp_off_center", t=t_close, evidence=f"measured offset {offset:.1f} mm at the close")
    return rules.model_copy(update={"issues": [*rules.issues, issue]})


def code_all(case: Case) -> Diagnosis:
    """rules_grasp_metric + a code release check from sim state (pre-registered): at the first open after the
    grasp, a cube center more than RELEASE_OUTSIDE_M outside the bin footprint is a drop if the hand later
    passes over the bin (it carries on empty), else a bad_release; a release more than RELEASE_HIGH_M above
    the rim is a bad_release."""
    diag = grasp_metric(case)
    f = release_facts(case.traj, case.signals, case.bin_pose)
    if f is None:
        return diag
    if f.outside_m > RELEASE_OUTSIDE_M:
        kind = "drop" if f.hand_over_bin_after else "bad_release"
        issue = Issue(type=kind, t=f.t, evidence=f"released {f.outside_m * 100:.1f} cm outside the bin footprint")
    elif f.above_rim_m > RELEASE_HIGH_M:
        issue = Issue(type="bad_release", t=f.t, evidence=f"released {f.above_rim_m * 100:.1f} cm above the rim")
    else:
        return diag
    return diag.model_copy(update={"issues": [*diag.issues, issue]})


def diagnose_case(case: Case, diagnoser: str, before_model_call: Callable[[], None]) -> dict:
    """The case's diagnosis by one diagnoser: {diagnosis, gated, fallback, error}."""
    fallback, error, gated = False, None, []
    if diagnoser == "rules":
        diag = detect_rules(case.traj, case.windows, case.task_text)
    elif diagnoser == "rules_grasp_metric":
        diag = grasp_metric(case)
    elif diagnoser == "code_all":
        diag = code_all(case)
    else:
        before_model_call()
        duration = case.traj.t[-1]
        try:
            if diagnoser in ("hybrid", "hybrid_blind"):
                diag, gated = diagnose_hybrid(case.frames, case.wrist, case.windows, case.traj, case.task_text,
                                              case.replay_success, duration, signals=case.signals,
                                              bin_pose=case.bin_pose, blind=diagnoser == "hybrid_blind")
            else:
                diag, gated = diagnose_gated(case.frames, case.wrist, case.windows, case.task_text,
                                             case.replay_success, duration)
        except (DiagnosisError, TokenFactoryError) as e:  # what the pipeline does: the rules alone
            fallback, error = True, f"{type(e).__name__}: {e}"
            diag = detect_rules(case.traj, case.windows, case.task_text)
    return {"diagnosis": diag, "gated": gated, "fallback": fallback, "error": error}


def _fmt(report: dict) -> str:
    def r(x):
        return "-" if x is None else f"{x:.2f}"
    return f"P {r(report['precision'])} R {r(report['recall'])} F1 {r(report['f1'])} " \
           f"({report['tp']}/{report['fp']}/{report['fn']})"


def table(summary: dict) -> str:
    names = list(summary["diagnosers"])
    types = sorted({t for d in summary["diagnosers"].values() for t in d["per_type"]})
    lines = [f"Episodes: {summary['n_degraded']} accepted, {len(summary.get('scored_episodes', []))} scored by every "
             f"arm; clean: {summary['clean']}. Cells: precision, recall, F1 (tp/fp/fn) over the scored episodes.", "",
             "| type | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for t in types:
        lines.append(f"| {t} | " + " | ".join(_fmt(summary["diagnosers"][n]["per_type"][t])
                                             if t in summary["diagnosers"][n]["per_type"] else "-" for n in names) + " |")
    lines.append("| **all types** | " + " | ".join(_fmt(summary["diagnosers"][n]["total"]) for n in names) + " |")
    lines.append("| clean false positives | " + " | ".join(
        (", ".join(f"{k} {v}" for k, v in summary["diagnosers"][n]["clean_false_positives"].items()) or "0")
        for n in names) + " |")
    neg_types = sorted({t for d in summary["diagnosers"].values() for t in d.get("negatives_fp_rate", {})})
    for t in neg_types:
        def rate(n, t=t):
            x = summary["diagnosers"][n].get("negatives_fp_rate", {}).get(t)
            return "-" if not x or x["rate"] is None else f"{x['rate']:.2f} ({x['with_fp']}/{x['episodes']})"
        lines.append(f"| FP rate on {t} negatives | " + " | ".join(rate(n) for n in names) + " |")

    def centered(n):
        x = summary["diagnosers"][n].get("grasp_fp_rate_on_centered")
        return "-" if not x or x["rate"] is None else f"{x['rate']:.2f} ({x['with_fp']}/{x['episodes']})"
    lines.append("| grasp FP rate on the centered negatives | " + " | ".join(centered(n) for n in names) + " |")
    lines.append("| R1 bar (recall >= 0.75, centered FP <= 0.25) | " + " | ".join(
        ("pass" if summary["diagnosers"][n]["r1_bar"]["passes"] else "fail") if "r1_bar" in summary["diagnosers"][n]
        else "-" for n in names) + " |")
    lines.append("| calls | " + " | ".join(str(summary["diagnosers"][n]["model_calls"]) for n in names) + " |")
    lines.append("| cost (USD) | " + " | ".join(f"{summary['diagnosers'][n]['est_cost_usd']:.4f}" for n in names) + " |")
    lines.append("| model fallbacks | " + " | ".join(str(summary["diagnosers"][n]["fallbacks"]) for n in names) + " |")
    if summary["stopped"]:
        lines += ["", f"STOPPED: {summary['stopped']}"]
    return "\n".join(lines) + "\n"


def run_ablation(
    episode_dirs: list[Path],
    clean_dir: Path | None,
    diagnosers: list[str],
    out: Path,
    *,
    limit: int | None = None,
    max_model_calls: int = 50,
    max_cost_usd: float = 0.10,
    manifest: Path | None = None,
    model_usage: Callable[[], tuple[int, float]] = read_model_usage,
    log: Callable[[str], None] = print,
) -> dict:
    out = Path(out)
    dirs = [Path(d) for d in episode_dirs][:limit] if limit is not None else [Path(d) for d in episode_dirs]
    rejected = []
    if manifest is not None:  # pre-registered: score only episodes whose files match the frozen manifest
        dirs, rejected = check_manifest(dirs, Path(manifest))
        for r in rejected:
            log(f"NOT SCORED {r['episode']}: {r['reason']}")
    plan = [(d, False) for d in dirs] + ([(Path(clean_dir), True)] if clean_dir else [])
    calls0, cost0 = model_usage()
    stopped = None

    def check_budget() -> None:
        calls, cost = model_usage()
        calls, cost = calls - calls0, cost - cost0
        if calls + CALLS_PER_DIAGNOSE > max_model_calls or cost + CALLS_PER_DIAGNOSE * RESERVE_USD_PER_CALL > max_cost_usd:
            raise PipelineAbort(f"model budget reached: {calls} calls, ${cost:.4f} used this run of {max_model_calls} "
                                f"calls, ${max_cost_usd}; rerun with the same --out to continue")

    def path(case_name: str, diagnoser: str) -> Path:
        return out / "cases" / f"{case_name}__{diagnoser}.json"

    try:
        for ep_dir, clean in plan:
            todo = [d for d in diagnosers if not path(ep_dir.name, d).is_file()]
            if not todo:
                continue
            case = load_case(ep_dir, clean=clean)
            for d in todo:
                before = model_usage()
                got = diagnose_case(case, d, check_budget)
                after = model_usage()
                diag = got["diagnosis"]
                record = {"case": case.name, "diagnoser": d, "clean": clean, "decision": diag.decision,
                          "issues": [i.model_dump(exclude_none=True) for i in diag.issues],
                          "repairs": [r.model_dump() for r in diag.repairs],
                          "segments": [s.model_dump() for s in diag.segments], "gated": got["gated"],
                          "fallback": got["fallback"], "error": got["error"], "calls": after[0] - before[0],
                          "est_cost_usd": round(after[1] - before[1], 6), "notes": case.notes, "kind": case.kind,
                          "truth_types": sorted({t.type for t in case.truth if not t.dont_care}),
                          "score": score_diagnosis(diag, case.truth).model_dump()}
                _write_json(path(case.name, d), record)
                log(f"{case.name} {d}: {len(diag.issues)} issues, {diag.decision}"
                    + (f" (fallback: {got['error']})" if got["fallback"] else ""))
    except PipelineAbort as e:
        stopped = str(e)
        log(f"STOPPED: {stopped}")

    # Every arm is scored on the same episodes: those all arms finished (a budget stop must not compare arms on
    # different subsets).
    def done(ep: Path, d: str) -> bool:
        return path(ep.name, d).is_file()

    scored = [ep for ep, clean in plan if not clean and all(done(ep, d) for d in diagnosers)]
    summary = {"created": datetime.now().astimezone().isoformat(timespec="seconds"), "out": str(out),
               "episodes": [d.name for d in dirs], "n_degraded": len(dirs), "rejected": rejected,
               "manifest": None if manifest is None else str(manifest), "scored_episodes": [ep.name for ep in scored],
               "clean": Path(clean_dir).name if clean_dir else None, "stopped": stopped, "diagnosers": {}}
    for d in diagnosers:
        recs = [json.loads(path(ep.name, d).read_text(encoding="utf-8")) for ep, _ in plan if done(ep, d)]
        by_case = {r["case"]: r for r in recs}
        degraded = [by_case[ep.name] for ep in scored]
        scores = [DiagnosisScore.model_validate(r["score"]) for r in degraded]
        total = aggregate(scores)
        clean_fp = {}
        for r in recs:
            if r["clean"]:
                for t, sc in DiagnosisScore.model_validate(r["score"]).per_type.items():
                    if sc.fp:
                        clean_fp[t] = sc.fp
        types = sorted(set(total.per_type) | {t for r in degraded for t in r.get("truth_types", [])})
        negatives = {}
        for t in types:
            neg = [(r, sc) for r, sc in zip(degraded, scores) if t not in r.get("truth_types", [])]
            with_fp = sum(1 for _, sc in neg if t in sc.per_type and sc.per_type[t].fp > 0)
            negatives[t] = {"episodes": len(neg), "with_fp": with_fp, "rate": round(with_fp / len(neg), 4) if neg else None}
        centered = [sc for r, sc in zip(degraded, scores) if r.get("kind") == "timing_centered"]
        c_fp = sum(1 for sc in centered if "grasp_off_center" in sc.per_type and sc.per_type["grasp_off_center"].fp > 0)
        centered_rate = {"episodes": len(centered), "with_fp": c_fp,
                         "rate": round(c_fp / len(centered), 4) if centered else None}
        grasp = total.per_type.get("grasp_off_center")
        recall = grasp.recall if grasp is not None else None
        r1 = {"recall": recall, "fp_rate_centered": centered_rate["rate"],
              "passes": bool(recall is not None and centered_rate["rate"] is not None and recall >= R1_RECALL
                             and centered_rate["rate"] <= R1_FP_RATE),
              "rule": f"grasp recall >= {R1_RECALL} and FP rate <= {R1_FP_RATE} on the centered negatives"}
        summary["diagnosers"][d] = {
            "per_type": {t: sc.report() for t, sc in total.per_type.items()}, "total": total.total.report(),
            "negatives_fp_rate": negatives, "grasp_fp_rate_on_centered": centered_rate, "r1_bar": r1,
            "clean_false_positives": clean_fp,
            "clean_decision": next((r["decision"] for r in recs if r["clean"]), None),
            "model_calls": sum(r["calls"] for r in recs), "est_cost_usd": round(sum(r["est_cost_usd"] for r in recs), 6),
            "fallbacks": sum(r["fallback"] for r in recs), "gated_items": sum(len(r["gated"]) for r in recs),
            "cases_done": len(recs), "cases_scored": len(degraded), "pending": len(plan) - len(recs)}
    _write_json(out / "scores.json", summary)
    (out / "table.md").write_text(table(summary), encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--episodes", required=True, help="glob of degraded episode folders")
    parser.add_argument("--diagnosers", default="rules,hybrid", help=f"comma-separated, from {', '.join(DIAGNOSERS)}")
    parser.add_argument("--clean", type=Path, help="a clean episode (false-positive check)")
    parser.add_argument("--out", type=Path, help="default DATA_DIR/ablation/<timestamp>; reuse it to resume")
    parser.add_argument("--limit", type=int, help="only the first N degraded episodes")
    parser.add_argument("--max-model-calls", type=int, default=50)
    parser.add_argument("--max-cost-usd", type=float, default=0.10)
    parser.add_argument("--manifest", type=Path, help="frozen set manifest: score only episodes matching its SHA-256s")
    args = parser.parse_args(argv)
    diagnosers = [d for d in args.diagnosers.split(",") if d]
    if not set(diagnosers) <= set(DIAGNOSERS):
        parser.error(f"--diagnosers takes {', '.join(DIAGNOSERS)}")
    episodes = sorted(Path(p) for p in glob.glob(args.episodes) if Path(p).is_dir())
    if not episodes:
        parser.error(f"no episode folders match {args.episodes!r}")
    if set(diagnosers) & set(MODEL_DIAGNOSERS):
        from dotenv import load_dotenv

        load_dotenv()
    out = args.out or data_dir() / "ablation" / datetime.now().strftime("%Y%m%d_%H%M%S")
    summary = run_ablation(episodes, args.clean, diagnosers, out, limit=args.limit,
                           max_model_calls=args.max_model_calls, max_cost_usd=args.max_cost_usd,
                           manifest=args.manifest)
    if summary.get("diagnosers"):
        print(table(summary))
        print(f"wrote {Path(out) / 'scores.json'}")
    return 2 if summary["stopped"] else 0


if __name__ == "__main__":
    sys.exit(main())
