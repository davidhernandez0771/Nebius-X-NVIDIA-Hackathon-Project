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
)
from app.jobs import PipelineAbort, align_signals, episode_frames  # noqa: E402
from demo_pipeline.degrade import InjectedIssue  # noqa: E402
from demo_pipeline.episode_io import load_signals  # noqa: E402
from demo_pipeline.measure import compute_windows  # noqa: E402
from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.rules import detect_rules  # noqa: E402
from demo_pipeline.schemas import Demo, Diagnosis, Issue, MetricsWindow, SimSignals, Trajectory  # noqa: E402
from demo_pipeline.scoring import DiagnosisScore, aggregate, score_diagnosis  # noqa: E402
from nebius_llm import TokenFactoryError  # noqa: E402

DIAGNOSERS = ("rules", "hybrid", "nemotron", "rules_grasp_metric")
MODEL_DIAGNOSERS = ("hybrid", "nemotron")


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


def load_case(ep_dir: Path, clean: bool = False) -> Case:
    ep_dir = Path(ep_dir)
    if (ep_dir / "demo.json").is_file():
        traj = Demo.model_validate_json((ep_dir / "demo.json").read_text(encoding="utf-8")).trajectory
        signals = align_signals(load_signals(ep_dir), traj.t)
        frames, wrist, task_text = episode_frames(ep_dir, traj.t)
        ver = ep_dir / "verification.json"
        success = json.loads(ver.read_text(encoding="utf-8"))["success"] if ver.is_file() else True
        notes = []
    else:  # the clean scripted episode: its recorded trajectory (what the frames show)
        inputs = build_inputs(ep_dir, SMOKE_BIN_POSE)
        traj, frames, wrist, task_text = inputs.traj, inputs.frames, inputs.wrist, inputs.task_text
        signals = align_signals(load_signals(ep_dir), traj.t)
        success = True if inputs.replay_success is None else inputs.replay_success
        notes = list(inputs.notes)
    truth_path = ep_dir / "truth.json"
    truth = [] if clean or not truth_path.is_file() else [
        InjectedIssue.model_validate(i) for i in json.loads(truth_path.read_text(encoding="utf-8"))["issues"]]
    return Case(name=ep_dir.name, clean=clean, traj=traj, signals=signals, windows=compute_windows(traj, signals),
                frames=frames, wrist=wrist, task_text=task_text, replay_success=success, truth=truth, notes=notes)


def grasp_metric(case: Case) -> Diagnosis:
    """rules + a code-only grasp_off_center when the measured offset at the first close reaches GRASP_CENTERED_MM."""
    rules = detect_rules(case.traj, case.windows, case.task_text)
    t_close, offset = first_close(case.traj), grasp_offset_mm(case.traj, case.signals)
    if t_close is None or offset is None or offset < GRASP_CENTERED_MM:
        return rules
    issue = Issue(type="grasp_off_center", t=t_close, evidence=f"measured offset {offset:.1f} mm at the close")
    return rules.model_copy(update={"issues": [*rules.issues, issue]})


def diagnose_case(case: Case, diagnoser: str, before_model_call: Callable[[], None]) -> dict:
    """The case's diagnosis by one diagnoser: {diagnosis, gated, fallback, error}."""
    fallback, error, gated = False, None, []
    if diagnoser == "rules":
        diag = detect_rules(case.traj, case.windows, case.task_text)
    elif diagnoser == "rules_grasp_metric":
        diag = grasp_metric(case)
    else:
        before_model_call()
        duration = case.traj.t[-1]
        try:
            if diagnoser == "hybrid":
                diag, gated = diagnose_hybrid(case.frames, case.wrist, case.windows, case.traj, case.task_text,
                                              case.replay_success, duration, signals=case.signals)
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
    lines = [f"Degraded episodes: {summary['n_degraded']}; clean: {summary['clean']}. Cells: precision, recall, F1 "
             "(tp/fp/fn) over the degraded episodes.", "",
             "| type | " + " | ".join(names) + " |", "|---|" + "---|" * len(names)]
    for t in types:
        lines.append(f"| {t} | " + " | ".join(_fmt(summary["diagnosers"][n]["per_type"][t])
                                             if t in summary["diagnosers"][n]["per_type"] else "-" for n in names) + " |")
    lines.append("| **all types** | " + " | ".join(_fmt(summary["diagnosers"][n]["total"]) for n in names) + " |")
    lines.append("| clean false positives | " + " | ".join(
        (", ".join(f"{k} {v}" for k, v in summary["diagnosers"][n]["clean_false_positives"].items()) or "0")
        for n in names) + " |")
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
    model_usage: Callable[[], tuple[int, float]] = read_model_usage,
    log: Callable[[str], None] = print,
) -> dict:
    out = Path(out)
    dirs = [Path(d) for d in episode_dirs][:limit] if limit is not None else [Path(d) for d in episode_dirs]
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
                          "est_cost_usd": round(after[1] - before[1], 6), "notes": case.notes,
                          "score": score_diagnosis(diag, case.truth).model_dump()}
                _write_json(path(case.name, d), record)
                log(f"{case.name} {d}: {len(diag.issues)} issues, {diag.decision}"
                    + (f" (fallback: {got['error']})" if got["fallback"] else ""))
    except PipelineAbort as e:
        stopped = str(e)
        log(f"STOPPED: {stopped}")

    summary = {"created": datetime.now().astimezone().isoformat(timespec="seconds"), "out": str(out),
               "episodes": [d.name for d in dirs], "n_degraded": len(dirs),
               "clean": Path(clean_dir).name if clean_dir else None, "stopped": stopped, "diagnosers": {}}
    for d in diagnosers:
        recs = [json.loads(path(ep.name, d).read_text(encoding="utf-8")) for ep, _ in plan if path(ep.name, d).is_file()]
        degraded = [r for r in recs if not r["clean"]]
        total = aggregate(DiagnosisScore.model_validate(r["score"]) for r in degraded)
        clean_fp = {}
        for r in recs:
            if r["clean"]:
                for t, s in DiagnosisScore.model_validate(r["score"]).per_type.items():
                    if s.fp:
                        clean_fp[t] = s.fp
        summary["diagnosers"][d] = {
            "per_type": {t: s.report() for t, s in total.per_type.items()}, "total": total.total.report(),
            "clean_false_positives": clean_fp,
            "clean_decision": next((r["decision"] for r in recs if r["clean"]), None),
            "model_calls": sum(r["calls"] for r in recs), "est_cost_usd": round(sum(r["est_cost_usd"] for r in recs), 6),
            "fallbacks": sum(r["fallback"] for r in recs), "gated_items": sum(len(r["gated"]) for r in recs),
            "cases_done": len(recs), "pending": len(plan) - len(recs)}
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
                           max_model_calls=args.max_model_calls, max_cost_usd=args.max_cost_usd)
    if summary.get("diagnosers"):
        print(table(summary))
        print(f"wrote {Path(out) / 'scores.json'}")
    return 2 if summary["stopped"] else 0


if __name__ == "__main__":
    sys.exit(main())
