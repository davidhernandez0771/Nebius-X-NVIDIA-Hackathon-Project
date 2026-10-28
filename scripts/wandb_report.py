"""Publish SANT's committed results to a Weights & Biases project, so judges can browse them as standard ML charts.

  uv run python scripts/wandb_report.py                 dry run: print what would be logged, touch nothing
  uv run --with wandb python scripts/wandb_report.py --upload --project sant-nebius-nvidia [--entity TEAM]

Upload needs a W&B login: run `wandb login` once, or set WANDB_API_KEY in your shell. The key is never read, stored or
printed by this script. Use a public project only if every table below is fine to share (it is all already in git).

What is logged (one run, job_type "results"):
  - final_test_scenes     the big test, one row per scene (seeds 5400-5439), from the committed raw episode log
  - checkpoint_selection  Stage A / Stage B checkpoints on practice seeds, from the committed raw logs
  - results               every pre-registered comparison, counts as the notes state them, with Wilson CI and p
  - teacher/*             the RL teacher's home-start success by iteration, with and without human demo starts
  - summary               the headline: final_test/success_rate, its CI, the goal
Every rate, interval and p is recomputed here from the counts (demo_pipeline.stats), the same code the audit uses
(scripts/audit_numbers.py). Nothing from data/ (gitignored) or a machine path is uploaded.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
sys.path.insert(0, str(REPO))

from demo_pipeline.stats import fisher_exact, wilson_ci
from scripts.audit_numbers import RAW_FILES, load_rows

# Pre-registered comparisons whose counts the notes state (no committed per-episode file for the older ones; the audit
# checks each against its note). test: how p was computed; "mcnemar" rows carry the note's stated p (paired outcomes).
RESULTS = [
    {"experiment": "final_test", "arm": "v2: RL teacher distilled into ACT, 180k steps", "k": 30, "n": 40,
     "seeds": "5400-5439", "source": "2026-10-23 big-test prereg, lines 744, 757-758"},
    {"experiment": "climb", "arm": "raw human mouse demos", "k": 0, "n": 40, "seeds": "5020-5059",
     "source": "2026-10-21 distill prereg, line 1391"},
    {"experiment": "climb", "arm": "SANT-perfected + multiplied", "k": 3, "n": 40, "seeds": "5020-5059",
     "source": "2026-10-21 distill prereg, line 1390"},
    {"experiment": "climb", "arm": "v1: RL teacher distilled", "k": 15, "n": 40, "seeds": "5020-5059",
     "source": "2026-10-21 distill prereg, line 1386"},
    {"experiment": "scripted_multiply", "arm": "10 scripted demos", "k": 3, "n": 40, "seeds": "5020-5059",
     "source": "T3 status note, lines 1156, 1307"},
    {"experiment": "scripted_multiply", "arm": "+100 verified copies", "k": 17, "n": 40, "seeds": "5020-5059",
     "source": "T3 status note, lines 1156, 1307"},
    {"experiment": "scripted_multiply", "arm": "+300 verified copies", "k": 16, "n": 40, "seeds": "5020-5059",
     "source": "T3 status note, lines 1156, 1307"},
    {"experiment": "teacher_final", "arm": "with human demo starts", "k": 113, "n": 128, "seeds": "home starts",
     "source": "2026-10-21 distill prereg, lines 1621-1622"},
    {"experiment": "teacher_final", "arm": "without (home starts only)", "k": 0, "n": 128, "seeds": "home starts",
     "source": "2026-10-21 distill prereg, lines 1621-1622"},
]

# Two-sided Fisher comparisons between rows above: (experiment, arm a, arm b).
COMPARISONS = [
    ("climb", "raw human mouse demos", "SANT-perfected + multiplied"),
    ("scripted_multiply", "10 scripted demos", "+100 verified copies"),
    ("scripted_multiply", "10 scripted demos", "+300 verified copies"),
    ("scripted_multiply", "+100 verified copies", "+300 verified copies"),
    ("teacher_final", "without (home starts only)", "with human demo starts"),
]

# Paired tests the notes report (exact McNemar on the same 10 webcam demos); p as the notes state it.
PAIRED = [
    {"experiment": "nemotron_repair_run1", "a": "rules 3/10", "b": "Nemotron 5/10", "p": 0.5,
     "source": "Nemotron repairer note, line 171"},
    {"experiment": "nemotron_repair_run2", "a": "rules 3/10", "b": "Nemotron 2/10", "p": 1.0,
     "source": "Nemotron repairer note, line 346"},
]

# Home-start success out of 128 by RL iteration (web/src/site/results/proofData.ts TEACHER).
TEACHER_CURVE = [(300, 0, 0), (600, 10, 0), (900, 99, 0), (1200, 109, 0), (1499, 113, 0)]
GOAL = {"k": 24, "n": 40, "source": "2026-10-23 big-test prereg, line 745"}

CHECKPOINTS = [("A", 60_000, "stageA_60k"), ("A", 120_000, "stageA_120k"), ("A", 180_000, "stageA_180k"),
               ("B", 60_000, "stageB_60k"), ("B", 120_000, "stageB_120k"), ("B", 180_000, "stageB_180k")]


def _rate(k: int, n: int) -> dict:
    lo, hi = wilson_ci(k, n)
    return {"k": k, "n": n, "rate": round(k / n, 4), "ci_lo": round(lo, 3), "ci_hi": round(hi, 3)}


def final_scenes() -> list[dict]:
    return [{"seed": int(r["seed"]), "success": bool(r["success"]), "sim_s": round(float(r["sim_s"]), 2),
             "ended_by": r.get("ended_by"), "reasons": ", ".join(r.get("reasons") or [])}
            for r in sorted(load_rows(RAW_FILES["final_test"]), key=lambda r: int(r["seed"]))]


def checkpoint_rows() -> list[dict]:
    out = []
    for stage, step, name in CHECKPOINTS:
        rows = load_rows(RAW_FILES[name])
        out.append({"stage": stage, "step": step, **_rate(sum(bool(r["success"]) for r in rows), len(rows))})
    return out


def result_rows() -> list[dict]:
    return [{**r, **_rate(r["k"], r["n"])} for r in RESULTS]


def comparison_rows() -> list[dict]:
    by = {(r["experiment"], r["arm"]): r for r in RESULTS}
    out = []
    for exp, a, b in COMPARISONS:
        ra, rb = by[(exp, a)], by[(exp, b)]
        p = fisher_exact(ra["k"], ra["n"], rb["k"], rb["n"])
        out.append({"experiment": exp, "a": f"{a} {ra['k']}/{ra['n']}", "b": f"{b} {rb['k']}/{rb['n']}",
                    "test": "Fisher exact, two-sided", "p": float(f"{p:.2g}")})
    out += [{"experiment": p["experiment"], "a": p["a"], "b": p["b"], "test": "exact McNemar (paired), as stated",
             "p": p["p"]} for p in PAIRED]
    return out


def build_report() -> dict:
    scenes = final_scenes()
    k = sum(s["success"] for s in scenes)
    wins = sorted(s["sim_s"] for s in scenes if s["success"])
    m = len(wins) // 2
    head = _rate(k, len(scenes))
    return {
        "summary": {"final_test/successes": k, "final_test/n": len(scenes), "final_test/success_rate": head["rate"],
                    "final_test/ci95_lo": head["ci_lo"], "final_test/ci95_hi": head["ci_hi"],
                    "final_test/goal": f"{GOAL['k']}/{GOAL['n']}", "final_test/goal_met": k >= GOAL["k"],
                    "final_test/median_success_sim_s": round((wins[m - 1] + wins[m]) / 2 if len(wins) % 2 == 0 else wins[m], 2)},
        "final_test_scenes": scenes,
        "checkpoint_selection": checkpoint_rows(),
        "results": result_rows(),
        "comparisons": comparison_rows(),
        "teacher_curve": [{"iteration": i, "with_demos": w / 128, "without_demos": wo / 128} for i, w, wo in TEACHER_CURVE],
    }


def upload(report: dict, project: str, entity: str | None) -> str:
    # W&B stages each table under its data dir (default: inside the user's home) and records that path; stage them in a
    # neutral temp dir instead. Set before the import, which reads it.
    os.environ.setdefault("WANDB_DATA_DIR", tempfile.mkdtemp(prefix="sant-wandb-"))
    import wandb  # only for --upload; `uv run --with wandb ...`

    def table(rows: list[dict]) -> wandb.Table:
        cols = list(rows[0])
        return wandb.Table(columns=cols, data=[[r[c] for c in cols] for r in rows])

    # By default W&B attaches the machine's hostname, the user's home paths, the git commit and system stats; none of
    # that belongs in a public results page, so all of it is off.
    private = wandb.Settings(host="sant", program="scripts/wandb_report.py", program_abspath="scripts/wandb_report.py",
                             disable_git=True, disable_code=True, save_code=False, disable_job_creation=True,
                             x_disable_meta=True, x_disable_stats=True, x_disable_machine_info=True)
    run = wandb.init(project=project, entity=entity, job_type="results", name="sant-submission-results", settings=private,
                     config={"task": "Franka cube into bin, Isaac Lab", "policy": "LeRobot ACT, camera-only",
                             "repo": "github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project"})
    for p in report["teacher_curve"]:
        run.log({"teacher/with_demo_starts": p["with_demos"], "teacher/without_demo_starts": p["without_demos"],
                 "teacher/iteration": p["iteration"]})
    res = table(report["results"])
    sel = table(report["checkpoint_selection"])
    run.log({
        "final_test_scenes": table(report["final_test_scenes"]),
        "checkpoint_selection": sel,
        "results": res,
        "comparisons": table(report["comparisons"]),
        "charts/results": wandb.plot.bar(res, "arm", "rate", title="Success rate by arm (Wilson 95% CI in table)"),
        "charts/checkpoints": wandb.plot.scatter(sel, "step", "rate", title="Checkpoint selection, practice seeds"),
    })
    run.summary.update(report["summary"])
    url = run.url
    run.finish()
    return url


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--upload", action="store_true", help="log to W&B (default: dry run, print only)")
    ap.add_argument("--project", default="sant-nebius-nvidia")
    ap.add_argument("--entity", default=None, help="W&B team or user (default: your default entity)")
    args = ap.parse_args(argv)
    report = build_report()
    if not args.upload:
        print(json.dumps(report["summary"], indent=1))
        for key in ("checkpoint_selection", "results", "comparisons"):
            print(f"\n{key}:")
            for row in report[key]:
                print("  ", row)
        print("\nDry run: nothing uploaded. Add --upload (with `uv run --with wandb`) to publish.")
        return 0
    url = upload(report, args.project, args.entity)
    print(url or "Logged offline (WANDB_MODE=offline): run `wandb sync` on the folder above to publish.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
