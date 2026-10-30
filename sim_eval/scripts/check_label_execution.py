r"""Replay training episodes' labels with the policy's own executor (the eval env), open loop, and score them.

Every episode given here passed verification in sim_worker.replay (IK at each substep + velocity feed-forward). If
the eval env, which holds each 9-joint label with no feed-forward, can't reproduce them, the training data asks for
motions the policy can't execute (sim_eval/label_check.py has the reasoning).

    C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\check_label_execution.py ^
        --episodes "C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\datasets\perfected_multiply_10\episodes\*" ^
        --out C:\dev\pm-data\label_check\mouse_pm10.json --headless

--episodes takes folders or glob patterns of episode folders (each with scene.json and steps.npz); --limit N checks
the first N (a quick look). Takes C:\dev\gpu.lock for the run. About 15 s per episode; 110 episodes ~30 min.
No camera rendering, no policy server, no training. Nothing is written except --out.
"""

from __future__ import annotations

import argparse
import glob
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "src"), str(REPO)]
from sim_worker.own_code import check_own_code  # noqa: E402

from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

parser = argparse.ArgumentParser(description="Replay training labels with the eval env's executor and score them.")
parser.add_argument("--episodes", nargs="+", required=True, help="episode folders or glob patterns")
parser.add_argument("--out", type=Path, required=True, help="the JSON report")
parser.add_argument("--limit", type=int, default=None, help="check only the first N episodes")
add_launcher_args(parser)
args_cli = parser.parse_args()

from sim_eval.eval_policy import run_episode  # noqa: E402
from sim_eval.label_check import (  # noqa: E402
    FPS, TAIL_S, LabelPolicy, LabelResult, TcpRecorder, drift, load_label_episode, write_report,
)
from sim_worker.gpulock import GpuLock  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402


def episode_dirs(patterns: list[str]) -> list[Path]:
    out = []
    for p in patterns:
        matches = sorted(glob.glob(p)) or [p]
        out += [Path(m) for m in matches if (Path(m) / "steps.npz").exists()]
    return out


def main() -> None:
    check_own_code()
    dirs = episode_dirs(args_cli.episodes)[: args_cli.limit]
    if not dirs:
        print("[label-check] no episode folders (with steps.npz) matched", flush=True)
        sys.exit(2)
    episodes = [load_label_episode(d) for d in dirs]
    seeds = [e.scene.seed for e in episodes]
    if len(set(seeds)) != len(seeds):
        sys.exit("[label-check] two episodes share a scene seed; the env keys start poses by seed")
    print(f"[label-check] {len(episodes)} episodes from {dirs[0].parent}", flush=True)
    t0 = time.time()
    results: list[LabelResult] = []
    with GpuLock(task="label-check"), launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        from sim_eval.isaac_env import IsaacEvalEnv

        env = TcpRecorder(IsaacEvalEnv(cameras=False, device=args_cli.device,
                                       start_poses={e.scene.seed: e.start_q.tolist() for e in episodes}))
        for i, ep in enumerate(episodes):
            res = run_episode(env, LabelPolicy(ep.actions), ep.scene, fps=FPS,
                              max_seconds=len(ep.actions) / FPS + TAIL_S)
            mean, mx, at_close = drift(ep.ee_pos, env.tcp, ep.gripper)
            results.append(LabelResult(name=ep.name, seed=ep.scene.seed, success=res.success, reasons=res.reasons,
                                       steps=res.steps, drift_mean_mm=round(mean, 2), drift_max_mm=round(mx, 2),
                                       drift_at_close_mm=None if at_close is None else round(at_close, 2)))
            print(f"[label-check] {i + 1}/{len(episodes)} {ep.name} success={res.success} reasons={res.reasons} "
                  f"drift mean {mean:.1f} mm, max {mx:.1f} mm, at close {at_close if at_close is None else round(at_close, 1)} mm",
                  flush=True)
        summary = write_report(args_cli.out, results, {"episodes_root": str(dirs[0].parent), "n": len(episodes),
                                                        "wall_s": round(time.time() - t0, 1)})
        print(f"[label-check] {summary['successes']}/{summary['n']} labels execute; {summary['verdict']}", flush=True)
        print(f"[label-check] report {args_cli.out}", flush=True)


if __name__ == "__main__":
    main()
