"""The Stage-0 inference test: existing checkpoints, inference-only variants, no new data and no training.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\stage0_inference.py ^
        --plan docs\\superpowers\\notes\\2026-10-20-stage0-inference-plan.json [--dry-run]

Pre-registered in docs/superpowers/notes/2026-10-20-stage0-inference-prereg.md (from the 2026-10-20 research note,
Part 3 (c) Stage 0). For each plan target (a checkpoint, its start state and its existing result on the final seeds):
  1. practice: every variant in VARIANTS on the practice seeds (default 5300-5329);
  2. choice: the best non-baseline variant on practice, a tie going to the earlier one (choose_variant);
  3. final: that variant on the final seeds (5020-5059), compared with the target's existing baseline there by a
     two-sided Fisher exact test at alpha = 0.05; the plan's one primary target is the pre-registered test.
Targets run in plan order, each one's practice then its final, so the primary (listed first) finishes first.
Each eval is one sim_eval/scripts/eval_cells.py run with --checkpoint LABEL=PATH (the registry is never touched), so
results land in DATA_DIR/evals/<run_id>/<target>__<variant>__<phase>.json and a re-run resumes where it stopped. The
whole run holds C:\\dev\\gpu.lock and keeps Windows awake. The summary goes to DATA_DIR/evals/<run_id>/stage0_summary.json.
--dry-run prints every practice command and the final-phase template, and runs nothing.

--quick: the quick pre-registered alternative. S4 (binarize + re-plan every 20 steps), chosen a priori, goes straight
to the final seeds for every target in plan order, with no practice phase. --with-control adds S0 on the primary target's
final seeds last, as a concurrent control (descriptive). Its summary is stage0_quick_summary.json.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))  # repo root, for `sim_worker`
from sim_worker.own_code import check_own_code, put_own_code_first  # noqa: E402

put_own_code_first()  # this checkout's src before the venv's editable install (it points at another worktree)

from demo_pipeline.stats import fisher_exact, wilson_ci  # noqa: E402
from lerobot_tools.inference import InferenceOptions  # noqa: E402

ALPHA = 0.05
# The pre-registered variants, in tie-break order (S0 is the reference; it is never the chosen variant).
VARIANTS = {
    "S0_baseline": InferenceOptions(),
    "S1_binarize": InferenceOptions(binarize_gripper=True),
    "S2_replan20": InferenceOptions(n_action_steps=20),
    "S3_ensemble": InferenceOptions(temporal_ensemble_coeff=0.01),
    "S4_binarize_replan20": InferenceOptions(binarize_gripper=True, n_action_steps=20),
}
PHASES = ("practice", "final")
QUICK_VARIANT = "S4_binarize_replan20"  # chosen a priori for --quick (the prereg says why)


def load_plan(path: Path) -> dict:
    plan = json.loads(Path(path).read_text(encoding="utf-8"))
    pr, fi = plan["practice"], plan["final"]
    lo, hi = max(pr["seed0"], fi["seed0"]), min(pr["seed0"] + pr["n"], fi["seed0"] + fi["n"])
    if lo < hi:
        raise ValueError(f"practice seeds {pr['seed0']}-{pr['seed0'] + pr['n'] - 1} overlap the final seeds "
                         f"{fi['seed0']}-{fi['seed0'] + fi['n'] - 1}")
    if sum(bool(t.get("primary")) for t in plan["targets"]) != 1:
        raise ValueError("the plan needs exactly one primary target")
    for t in plan["targets"]:
        for key in ("name", "checkpoint", "start_state", "baseline"):
            if key not in t:
                raise ValueError(f"target {t.get('name')!r} has no {key!r}")
    return plan


def label(target: dict, variant: str, phase: str) -> str:
    return f"{target['name']}__{variant}__{phase}"


def eval_cells_command(python: str, plan: dict, target: dict, variant: str, phase: str) -> list[str]:
    seeds = plan[phase]
    return [python, str(REPO / "sim_eval/scripts/eval_cells.py"), "--run-id", plan["run_id"],
            "--checkpoint", f"{label(target, variant, phase)}={target['checkpoint']}",
            "--n", str(seeds["n"]), "--seed0", str(seeds["seed0"]),
            "--start-state", str(target["start_state"]), "--start-pose", "dataset",
            *VARIANTS[variant].run_eval_args()]


def choose_variant(practice: dict[str, tuple[int, int]]) -> str:
    """variant -> (successes, n) on practice seeds -> the chosen variant: the most successes among S1-S4, a tie going
    to the earlier one in VARIANTS. The baseline is the reference, never the choice."""
    missing = [v for v in VARIANTS if v not in practice]
    if missing:
        raise ValueError(f"practice results missing for {missing}")
    candidates = [v for v in VARIANTS if v != "S0_baseline"]
    return max(candidates, key=lambda v: (practice[v][0], -candidates.index(v)))


def quick_steps(plan: dict, *, control: bool) -> list[tuple[str, str]]:
    """(target, variant) evals of --quick, all on the final seeds: S4 for every target in plan order, then (control)
    S0 on the primary target."""
    steps = [(t["name"], QUICK_VARIANT) for t in plan["targets"]]
    if control:
        steps.append((next(t["name"] for t in plan["targets"] if t.get("primary")), "S0_baseline"))
    return steps


def _successes(results: Path) -> tuple[int, int]:
    summary = json.loads(Path(results).read_text(encoding="utf-8"))["summary"]
    return summary["successes"], summary["n"]


def summarize(plan: dict, practice: dict[str, dict[str, tuple[int, int]]],
              final: dict[str, tuple[str, int, int]], *, mode: str = "full",
              control: dict[str, tuple[int, int]] | None = None) -> dict:
    """practice: target -> variant -> (k, n); final: target -> (variant, k, n); control: target -> (k, n) of a
    concurrent S0 on the final seeds (--quick --with-control; descriptive, not the pre-registered test)."""
    out = {"run_id": plan["run_id"], "mode": mode, "alpha": ALPHA,
           "test": "fisher_exact_two_sided vs the target's existing result",
           "primary": next(t["name"] for t in plan["targets"] if t.get("primary")), "targets": [],
           "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    for t in plan["targets"]:
        rec = {"name": t["name"], "checkpoint": t["checkpoint"], "baseline": t["baseline"],
               "practice": {v: {"successes": k, "n": n} for v, (k, n) in practice.get(t["name"], {}).items()}}
        if t["name"] in final:
            variant, k, n = final[t["name"]]
            b = t["baseline"]
            p = fisher_exact(k, n, b["successes"], b["n"])
            rec.update(chosen=variant, inference=VARIANTS[variant].record(), final={"successes": k, "n": n},
                       final_wilson_95=list(wilson_ci(k, n)), fisher_p=p, significant=p < ALPHA)
            if control and t["name"] in control:
                ck, cn = control[t["name"]]
                rec["concurrent_control"] = {"variant": "S0_baseline", "successes": ck, "n": cn,
                                             "wilson_95": list(wilson_ci(ck, cn)),
                                             "fisher_p_vs_final": fisher_exact(k, n, ck, cn), "descriptive_only": True}
        out["targets"].append(rec)
    return out


def _run(cmd: list[str], log_path: Path) -> int:
    print(f"[stage0] {' '.join(cmd)}", flush=True)
    with log_path.open("a", encoding="utf-8") as f:
        return subprocess.run(cmd, cwd=REPO, stdout=f, stderr=subprocess.STDOUT).returncode


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--plan", type=Path, required=True)
    p.add_argument("--dry-run", action="store_true", help="print the commands; run nothing")
    p.add_argument("--lock-wait-s", type=float, default=3600, help="wait this long for C:\\dev\\gpu.lock")
    p.add_argument("--quick", action="store_true", help=f"{QUICK_VARIANT} a priori, straight on the final seeds")
    p.add_argument("--with-control", action="store_true", help="with --quick: S0 on the primary target's final seeds")
    args = p.parse_args(argv)
    if args.with_control and not args.quick:
        p.error("--with-control goes with --quick")
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    plan = load_plan(args.plan)
    python = sys.executable
    targets = {t["name"]: t for t in plan["targets"]}
    if args.dry_run and args.quick:
        for name, v in quick_steps(plan, control=args.with_control):
            print(" ".join(eval_cells_command(python, plan, targets[name], v, "final")))
        return 0
    if args.dry_run:
        for t in plan["targets"]:
            for v in VARIANTS:
                print(" ".join(eval_cells_command(python, plan, t, v, "practice")))
        for t in plan["targets"]:  # the final phase runs the variant practice chose
            cmd = " ".join(eval_cells_command(python, plan, t, "S0_baseline", "final"))
            print(cmd.replace("S0_baseline", "<chosen>") + "  <+ the chosen variant's flags>")
        return 0

    from demo_pipeline.paths import data_dir
    from sim_worker.gpu_lock import GpuLock
    from sim_worker.keepawake import KeepAwake

    out_dir = data_dir() / "evals" / plan["run_id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / "stage0.log"
    practice: dict[str, dict[str, tuple[int, int]]] = {}
    final: dict[str, tuple[str, int, int]] = {}
    if args.quick:
        control: dict[str, tuple[int, int]] = {}
        with GpuLock(task=f"stage0-quick:{plan['run_id']}", max_wait_s=args.lock_wait_s), KeepAwake():
            for name, v in quick_steps(plan, control=args.with_control):
                t = targets[name]
                if _run(eval_cells_command(python, plan, t, v, "final"), log_path) != 0:
                    print(f"[stage0] {label(t, v, 'final')} did not finish; see {log_path}", flush=True)
                    return 1
                k, n = _successes(out_dir / f"{label(t, v, 'final')}.json")
                if v == QUICK_VARIANT:
                    final[name] = (v, k, n)
                else:
                    control[name] = (k, n)
                print(f"[stage0] {name} {v} on the final seeds: {k}/{n}", flush=True)
                (out_dir / "stage0_quick_summary.json").write_text(
                    json.dumps(summarize(plan, {}, final, mode="quick", control=control), indent=2), encoding="utf-8")
        summary = summarize(plan, {}, final, mode="quick", control=control)
        print("[stage0] SUMMARY " + json.dumps(summary), flush=True)
        return 0
    with GpuLock(task=f"stage0:{plan['run_id']}", max_wait_s=args.lock_wait_s), KeepAwake():
        for t in plan["targets"]:
            practice[t["name"]] = {}
            for v in VARIANTS:
                if _run(eval_cells_command(python, plan, t, v, "practice"), log_path) != 0:
                    print(f"[stage0] {label(t, v, 'practice')} did not finish; see {log_path}", flush=True)
                    return 1
                practice[t["name"]][v] = _successes(out_dir / f"{label(t, v, 'practice')}.json")
            chosen = choose_variant(practice[t["name"]])
            print(f"[stage0] {t['name']}: practice {practice[t['name']]} -> {chosen}", flush=True)
            # This target's final eval before the next target's practice: the primary result comes first.
            if _run(eval_cells_command(python, plan, t, chosen, "final"), log_path) != 0:
                print(f"[stage0] {label(t, chosen, 'final')} did not finish; see {log_path}", flush=True)
                return 1
            final[t["name"]] = (chosen, *_successes(out_dir / f"{label(t, chosen, 'final')}.json"))
            (out_dir / "stage0_summary.json").write_text(json.dumps(summarize(plan, practice, final), indent=2),
                                                         encoding="utf-8")
    summary = summarize(plan, practice, final)
    (out_dir / "stage0_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("[stage0] SUMMARY " + json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
