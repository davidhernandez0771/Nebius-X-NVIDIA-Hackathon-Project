"""Measure the IK-lag options (T2 sprint 2, Task 2) on sampled scenes, no cameras.

Usage (headless):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\compare_ik.py --seeds 20 --hold-s 0.15 --out data\\ik_compare.json
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

from isaaclab.app import add_launcher_args, launch_simulation

parser = argparse.ArgumentParser(description="Compare IK-lag options on sample_scene scenes.")
parser.add_argument("--seeds", type=int, default=20, help="scenes from seeds 0..N-1")
parser.add_argument("--hold-s", type=float, default=0.15, help="scripted expert hold at each gripper event")
parser.add_argument("--variants", default="", help="comma-separated subset of variant names (default: all)")
parser.add_argument("--out", type=Path, default=None, help="JSON file for per-run rows")
add_launcher_args(parser)
args_cli = parser.parse_args()

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`
from sim_worker.own_code import check_own_code, put_own_code_first  # noqa: E402

put_own_code_first()  # this checkout's src before the venv's editable install (it points at another worktree)

from demo_pipeline.multiply import sample_scene  # noqa: E402
from sim_worker.replay import make_sim_cfg, replay  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402
from sim_worker.tracking import TrackingOptions  # noqa: E402

VARIANTS = {
    "a_baseline": TrackingOptions(),
    "b_lookahead3": TrackingOptions(lookahead=3),
    "b_lookahead5": TrackingOptions(lookahead=5),
    "b_lookahead8": TrackingOptions(lookahead=8),
    "c_ik_iters2": TrackingOptions(ik_iters=2),
    "c_ik_iters4": TrackingOptions(ik_iters=4),
    "d_gate5mm": TrackingOptions(gate_tol=0.005, gate_max_s=0.5),
    "e_vel_ff": TrackingOptions(vel_ff=True),
    "e_vel_ff+d_gate5mm": TrackingOptions(vel_ff=True, gate_tol=0.005, gate_max_s=0.5),
}


def _summary(rows: list[dict]) -> dict:
    def mean(key):
        vals = [r[key] for r in rows if r[key] is not None]
        return float(np.mean(vals)) if vals else None

    return {
        "n": len(rows),
        "success_rate": sum(r["success"] for r in rows) / len(rows),
        "mean_mm": mean("mean_mm"),
        "max_mm": float(max(r["max_mm"] for r in rows)),
        "close_mm": mean("close_mm"),
        "close_max_mm": float(max(r["close_mm"] for r in rows if r["close_mm"] is not None)),
        "open_mm": mean("open_mm"),
        "added_steps": mean("hold_steps"),
        "reasons": sorted({x for r in rows for x in r["reasons"]}),
    }


def main() -> None:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    names = [v for v in args_cli.variants.split(",") if v] or list(VARIANTS)
    scenes = [sample_scene(np.random.default_rng(seed), "franka", seed) for seed in range(args_cli.seeds)]
    rows, t0 = [], time.time()
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        for name in names:
            for scene in scenes:
                traj = scripted_expert(scene, hold_s=args_cli.hold_s)
                st: dict = {}
                result, _ = replay(traj, scene, ep_dir=None, record_cameras=False, tracking=VARIANTS[name], stats=st)
                row = {"variant": name, "seed": scene.seed, "success": result.success, "reasons": result.reasons,
                       **{k: st[k] for k in ("mean_mm", "max_mm", "close_mm", "open_mm", "hold_steps")}}
                rows.append(row)
                print("ROW " + json.dumps(row), flush=True)
            if args_cli.out is not None:
                args_cli.out.parent.mkdir(parents=True, exist_ok=True)
                args_cli.out.write_text(json.dumps({"hold_s": args_cli.hold_s, "rows": rows}, indent=1))
        print(f"\n[compare] {len(rows)} replays in {time.time() - t0:.0f} s, hold_s={args_cli.hold_s}")
        print("| variant | success | mean mm | max mm | at close mm (mean / max) | at open mm | added steps | reasons |")
        print("|---|---|---|---|---|---|---|---|")
        for name in names:
            s = _summary([r for r in rows if r["variant"] == name])
            print(f"| {name} | {s['success_rate']:.0%} | {s['mean_mm']:.1f} | {s['max_mm']:.1f} | "
                  f"{s['close_mm']:.1f} / {s['close_max_mm']:.1f} | {s['open_mm']:.1f} | {s['added_steps']:.1f} | "
                  f"{', '.join(s['reasons']) or '-'} |", flush=True)


if __name__ == "__main__":
    main()
