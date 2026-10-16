"""Batch: sample scenes -> scripted expert -> replay -> episodes + summary.json (T2 sprint 2, Task 3).

Usage (headless):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\run_batch.py --n 50 --seed0 0 --out data\\batch_franka [--cameras]
    ... --corners   # the 8 workspace-corner scenes instead of sampled ones

Each episode folder gets the recorded episode + signals, plus scene.json, trajectory.json (the executed
trajectory) and verification.json. A replay that raises is recorded as a failure with reason "sim_error".
"""

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

import numpy as np

from isaaclab.app import add_launcher_args, launch_simulation

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`

from sim_worker.tracking import add_tracking_args, options_from_args  # noqa: E402

parser = argparse.ArgumentParser(description="Run the scripted expert on many scenes and verify each.")
parser.add_argument("--n", type=int, default=50)
parser.add_argument("--seed0", type=int, default=0)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--cameras", action="store_true")
parser.add_argument("--corners", action="store_true", help="run the 8 workspace-corner scenes (ignores --n)")
parser.add_argument("--robot", default="franka", choices=["franka", "openarm", "flexiv"])
parser.add_argument("--lift-z", type=float, default=0.25, help="scripted expert carry/retreat height (m)")
parser.add_argument("--resume", action="store_true", help="reuse finished episodes (<out>/rows/) by seed")
parser.add_argument("--hold-s", type=float, default=0.5, help="scripted expert hold at each gripper event")
add_tracking_args(parser)
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.cameras:
    args_cli.enable_cameras = True

from demo_pipeline.multiply import sample_scene  # noqa: E402
from sim_worker.batch import RowStore, corner_scenes, summarize  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg, replay  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402


def _jobs():
    if args_cli.corners:
        return [(label.replace("(", "_").replace(")", "").replace(",", "_"), sc) for label, sc in corner_scenes(args_cli.robot)]
    jobs = []
    for seed in range(args_cli.seed0, args_cli.seed0 + args_cli.n):
        jobs.append((f"ep_{seed:04d}", sample_scene(np.random.default_rng(seed), args_cli.robot, seed)))
    return jobs


def main() -> None:
    opts = options_from_args(args_cli)
    out: Path = args_cli.out
    out.mkdir(parents=True, exist_ok=True)
    rows, t0, store = [], time.time(), RowStore(out)
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():  # no idle sleep mid-run
        for name, scene in _jobs():
            ep = out / name
            if args_cli.resume and (done := store.get(name)) is not None:
                rows.append(done)
                print("RESUMED " + json.dumps(done), flush=True)
                continue
            t_ep = time.time()
            traj = scripted_expert(scene, hold_s=args_cli.hold_s, lift_z=args_cli.lift_z)
            st: dict = {}
            try:
                result, _ = replay(traj, scene, ep_dir=ep, record_cameras=args_cli.cameras, tracking=opts, stats=st)
                row = {"episode": name, "success": result.success, "reasons": result.reasons,
                       **{k: st[k] for k in ("mean_mm", "max_mm", "close_mm", "hold_steps")}}
                (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
                (ep / "trajectory.json").write_text(st["trajectory"].model_dump_json(), encoding="utf-8")
                (ep / "verification.json").write_text(result.model_dump_json(indent=1), encoding="utf-8")
            except Exception as exc:  # a broken replay is a recorded failure, never a crashed batch
                traceback.print_exc()
                row = {"episode": name, "success": False, "reasons": ["sim_error"], "error": repr(exc)}
            row.update(cube=list(scene.cube_pose.pos[:2]), bin=list(scene.bin_pose.pos[:2]),
                       wall_s=round(time.time() - t_ep, 2))
            if "sim_error" not in row["reasons"]:
                store.put(name, row)
            rows.append(row)
            print("ROW " + json.dumps(row), flush=True)
        wall = sum(r["wall_s"] for r in rows) if args_cli.resume else time.time() - t0
        summary = summarize(rows, wall_s=wall)
        summary.update(robot=args_cli.robot, cameras=args_cli.cameras, hold_s=args_cli.hold_s, lift_z=args_cli.lift_z,
                       tracking=vars(opts), corners=args_cli.corners, episodes=rows)
        (out / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
        print("SUMMARY " + json.dumps({k: v for k, v in summary.items() if k != "episodes"}), flush=True)


if __name__ == "__main__":
    main()
