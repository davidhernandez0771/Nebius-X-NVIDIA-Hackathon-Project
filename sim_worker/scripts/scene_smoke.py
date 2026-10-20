"""The GPU smoke test of pm/scene-isaac, one command under one GPU lock:

1. the Isaac-only unit tests (Isaac's python, no app): tests/test_sim_plan_scene.py, test_sim_scene_cfg.py,
   test_sim_placement.py;
2. the replay regression (replay() changed, and everything uses it): 5 stored episodes with known verdicts
   replayed twice by the base code (the branch's merge-base with pm/live-11, exported here with git archive) and
   twice by this branch; base vs branch must stay within run-to-run noise (sim_worker.regression);
3. the three example plans (sim_worker/scene_examples/*.json) built, settled for 1 s and photographed.

The lock (C:\\dev\\gpu.lock, sim_worker.gpulock: O_EXCL) is taken once, before stage 1, and released on any exit:
success, failure, an exception or Ctrl+C (a killed process leaves a lock with a dead PID, which the next taker
replaces). The children run with --no-lock. This script itself doesn't import Isaac.

Usage (Isaac's python, so the children run in it too), from the repo root:
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\scene_smoke.py --out data\\scene_smoke

Writes into --out: unit_tests.log, regression/ (base/ and branch/ runs, base_code/), regression.md, the settle
results <plan>.json and screenshots <plan>.png, and summary.json. Exits 1 if a stage failed to run, the unit tests
failed, or an episode's replay DIFFERS from the base; a plan that doesn't settle is reported, not a failure.
"""

from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))  # for sim_worker (regression, gpulock)
sys.path.insert(0, str(REPO / "src"))  # for demo_pipeline

EXAMPLES = REPO / "sim_worker" / "scene_examples"
SETTLE = REPO / "sim_worker" / "scripts" / "settle_plan.py"
REGRESSION = REPO / "sim_worker" / "scripts" / "replay_regression.py"
UNIT_TESTS = ["tests/test_sim_plan_scene.py", "tests/test_sim_scene_cfg.py", "tests/test_sim_placement.py"]
RUNS = 2
# Stored episodes with known verdicts (each one's check_success reproduces from its saved inputs):
# three of live test #10's webcam demos replayed on the achieved path (human10 experiments), and two scripted-expert
# Franka episodes (T2's batch_franka; C:\dev\pm-t6\data has no scripted ones).
EPISODES = [
    r"C:\dev\pm-t6\data\episodes\human_20261019185258_9f47_rules_v1",  # success
    r"C:\dev\pm-t6\data\episodes\human_20261019185258_9f47_raw",  # collision
    r"C:\dev\pm-t6\data\episodes\human_20261019185258_9f47_rules_home_m3302",  # not_in_bin, dropped
    r"C:\dev\pm-t2\data\batch_franka\ep_0000",  # success (scripted)
    r"C:\dev\pm-t2\data\batch_franka\ep_0001",  # success (scripted)
]


def export_base(dest: Path, ref: str = "pm/live-11") -> str:
    """The code before this branch (its merge-base with `ref`): sim_worker and src, extracted into dest with git
    archive (read only on the repo; files already in dest are overwritten). Returns the commit."""
    commit = subprocess.run(["git", "merge-base", "HEAD", ref], cwd=REPO, capture_output=True, text=True, check=True).stdout.strip()
    tar = subprocess.run(["git", "archive", "--format=tar", commit, "sim_worker", "src"], cwd=REPO, capture_output=True, check=True).stdout
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(tar)) as t:
        t.extractall(dest)
    return commit


def settle_commands(out: Path, python: str = sys.executable, examples: Path = EXAMPLES) -> list[tuple[str, list[str]]]:
    """(plan name, command) per example plan, in name order."""
    return [(p.stem, [python, str(SETTLE), "--plan", str(p), "--out", str(out / f"{p.stem}.json"),
                      "--screenshot", str(out / f"{p.stem}.png"), "--no-lock"]) for p in sorted(examples.glob("*.json"))]


def regression_command(code: Path, label: str, out: Path, episodes: list[Path], python: str = sys.executable) -> list[str]:
    return [python, str(REGRESSION), "--code", str(code), "--label", label, "--runs", str(RUNS), "--out", str(out),
            "--no-lock", "--episodes", *map(str, episodes)]


def _regression_report(reg_out: Path, episodes: list[Path]) -> tuple[dict, str]:
    from sim_worker.regression import episode_verdict, load_run, report_markdown

    rows, verdicts = [], {}
    for ep in episodes:
        runs = {label: [load_run(reg_out / label / f"run{k}" / ep.name) for k in range(1, RUNS + 1)] for label in ("base", "branch")}
        rows.append({"episode": ep.name, "stored": load_run(ep), **runs})
        v = episode_verdict(runs["base"], runs["branch"])
        verdicts[ep.name] = v["verdict"]
    return verdicts, report_markdown(rows)


def main(argv: list[str] | None = None, *, run=subprocess.run, lock=None, export=export_base) -> int:
    ap = argparse.ArgumentParser(description="Isaac-only tests, replay regression and plan settles, under one GPU lock.")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--episodes", type=Path, nargs="+", default=[Path(e) for e in EPISODES])
    args = ap.parse_args(argv)
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    if lock is None:
        from sim_worker.gpulock import GpuLock

        lock = GpuLock
    summary: dict = {"stages": {}}
    failed = False
    with lock(task="scene-smoke", terminal="T5"):
        # 1. Isaac-only unit tests.
        res = run([py, "-m", "pytest", "--noconftest", "-q", *UNIT_TESTS], cwd=REPO)
        summary["stages"]["unit_tests"] = res.returncode
        failed |= res.returncode != 0

        # 2. Replay regression: base code, then this branch.
        reg_out = out / "regression"
        base_code = reg_out / "base_code"
        commit = export(base_code)
        for label, code in (("base", base_code), ("branch", REPO)):
            res = run(regression_command(code, label, reg_out, args.episodes, py), cwd=REPO)
            summary["stages"][f"replay_{label}"] = res.returncode
            failed |= res.returncode != 0
        try:
            verdicts, md = _regression_report(reg_out, args.episodes)
            (out / "regression.md").write_text(md, encoding="utf-8")
            failed |= any(v == "DIFFERS" for v in verdicts.values())
        except FileNotFoundError as e:  # a replay stage didn't write its runs
            verdicts = {"error": str(e)}
            failed = True
        summary["regression"] = {"base_commit": commit, "verdicts": verdicts}

        # 3. The example plans: settle and photograph.
        rows = []
        for name, cmd in settle_commands(out, py):
            print(f"[smoke] {name}: {' '.join(cmd)}", flush=True)
            code = run(cmd, cwd=REPO).returncode
            result = out / f"{name}.json"
            if code != 0 or not result.exists():
                failed = True
                rows.append({"plan": name, "ran": False, "exit": code})
                continue
            r = json.loads(result.read_text(encoding="utf-8"))
            rows.append({"plan": name, "ran": True, "settled": not r["errors"], "errors": r["errors"],
                         "max_moved_m": max(r["moved"].values(), default=0.0)})
        summary["settle"] = rows
    summary["ok"] = not failed
    (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
