"""Evaluate an RL teacher, step 2 of 2 (SANT's venv; the sim worker runs Isaac): replay the teacher's trajectories in
SANT's own eval/replay env and judge them with the unchanged check_success. This is the number that counts.

    uv run --no-sync python scripts/rl_verify_teacher.py --runs data/rl/eval/<name> [--port 8771]

--runs is step 1's output (scripts/rl_eval_teacher.py: trajectories/<seed>.json, scenes/<seed>.json). The sim worker
is started, health-checked and stopped exactly as scripts/run_human_demo_experiment.py does it (the GPU lock, Isaac's
gate, KeepAwake), with DATA_DIR = <runs>/replay, so its episodes never mix with anyone's data. Each trajectory is
replayed in its scene (no cameras), and verify.json gets every verdict plus successes / n with a Wilson 95% CI.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from demo_pipeline.schemas import Scene, Trajectory  # noqa: E402
from demo_pipeline.sim_protocol import ReplayRequest  # noqa: E402
from demo_pipeline.stats import wilson_ci  # noqa: E402


def _experiment_script():
    """scripts/run_human_demo_experiment.py, for its sim worker session (one way to start Isaac, not two)."""
    path = REPO / "scripts" / "run_human_demo_experiment.py"
    spec = importlib.util.spec_from_file_location("run_human_demo_experiment", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def runs_of(folder: Path) -> list[tuple[int, Trajectory, Scene]]:
    """Step 1's trajectories and scenes, by seed."""
    out = []
    for p in sorted((folder / "trajectories").glob("*.json"), key=lambda p: int(p.stem)):
        scene = Scene.model_validate_json((folder / "scenes" / p.name).read_text(encoding="utf-8"))
        out.append((int(p.stem), Trajectory.model_validate_json(p.read_text(encoding="utf-8")), scene))
    if not out:
        raise ValueError(f"no trajectories in {folder / 'trajectories'}: run scripts/rl_eval_teacher.py first")
    return out


def summarize(verdicts: dict[int, dict]) -> dict:
    n = len(verdicts)
    k = sum(v["success"] for v in verdicts.values())
    reasons: dict[str, int] = {}
    for v in verdicts.values():
        for r in v["reasons"]:
            reasons[r] = reasons.get(r, 0) + 1
    lo, hi = wilson_ci(k, n) if n else (None, None)
    return {"successes": k, "n": n, "rate": k / n if n else None, "ci95": [lo, hi], "failures": reasons,
            "successful_seeds": sorted(s for s, v in verdicts.items() if v["success"])}


def agreement(in_env: dict, verdicts: dict[int, dict]) -> int | None:
    """On how many seeds the env's own check_success (step 1) and SANT's replay (step 2) agree; None without step
    1's verdicts. A gap means the RL env and SANT's eval env differ (the research note's risk 2)."""
    if not in_env:
        return None
    return sum((in_env.get(str(s)) or {}).get("success") == v["success"] for s, v in verdicts.items())


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--runs", type=Path, required=True)
    p.add_argument("--port", type=int, default=8771)
    args = p.parse_args(argv)
    runs = runs_of(args.runs)
    hx = _experiment_script()
    log = print
    data = (args.runs / "replay").resolve()
    session = hx.make_sim_session(data, f"rl-verify-{args.runs.name}", hx.make_gpu_stage(log), log, args.port,
                                  args.runs / "logs", lookahead=0)
    verdicts: dict[int, dict] = {}
    with session() as client:
        for seed, traj, scene in runs:
            resp = client.replay(ReplayRequest(trajectory=traj, scene=scene, record_cameras=False,
                                               out_name=f"teacher_{seed}"))
            v = resp.verification
            verdicts[seed] = {"success": v.success, "reasons": v.reasons, "duration": v.duration}
            log(f"seed {seed}: {'success' if v.success else 'failed ' + ','.join(v.reasons)}")
    path = args.runs / "in_env.json"
    in_env = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    report = {"runs": str(args.runs), "summary": summarize(verdicts), "verdicts": verdicts,
              "in_env_successes": in_env.get("in_env_successes"),
              "agree_with_in_env": agreement(in_env.get("in_env") or {}, verdicts)}
    (args.runs / "verify.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    s = report["summary"]
    print(f"teacher in SANT's eval env: {s['successes']}/{s['n']} (Wilson 95% {s['ci95'][0]:.2f}-{s['ci95'][1]:.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
