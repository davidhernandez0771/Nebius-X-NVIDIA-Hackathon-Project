"""Render degraded "webcam-like" human demos with cameras (T2 sprint 3, Task 4). Resumable by seed.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\render_degraded.py --n 20 --seed0 0 [--jitter-mm 2]

For each seed: T1's case mix (scripts/score_rules_on_degraded.make_case: sample_scene -> scripted_expert -> degrade,
with pauses, grasp offsets, slow/idle on mixed seeds; with --home-start the expert starts at HOME_TCP via
sim_worker.degraded.make_case) -> replay with front + wrist cameras ->
DATA_DIR/episodes/<prefix>_<seed:04d>/ (episode + scene/trajectory/verification.json + demo.json + truth.json).
A seed whose folder already has verification.json and truth.json is skipped. Index: <prefix>_index.json beside them.
"""

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

from isaaclab.app import add_launcher_args, launch_simulation

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))  # repo root: sim_worker and scripts/

parser = argparse.ArgumentParser(description="Replay degraded demos with cameras, writing frames + ground truth.")
parser.add_argument("--n", type=int, default=20)
parser.add_argument("--seed0", type=int, default=0)
parser.add_argument("--jitter-mm", type=float, default=2.0)
parser.add_argument("--prefix", default="degraded")
parser.add_argument("--no-cameras", action="store_true")
parser.add_argument("--home-start", action="store_true", help="start every demo at scripted.HOME_TCP")
add_launcher_args(parser)
args_cli = parser.parse_args()
if not args_cli.no_cameras:
    args_cli.enable_cameras = True

from demo_pipeline.paths import data_dir  # noqa: E402
from demo_pipeline.sim_protocol import ReplayRequest  # noqa: E402
from sim_worker.degraded import case_name, is_done, make_case, write_case_files  # noqa: E402
from sim_worker.isaac_executor import IsaacExecutor  # noqa: E402
from sim_worker.jobs import episodes_dir, run_replay  # noqa: E402
from sim_worker.keepawake import KeepAwake  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402


def main() -> None:
    root, cameras = Path(data_dir()), not args_cli.no_cameras
    index_path = episodes_dir(root) / f"{args_cli.prefix}_index.json"
    rows = []
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli), KeepAwake():  # no idle sleep mid-run
        ex = IsaacExecutor(robot="franka", cameras=cameras, root=root)
        ex.warm_up()
        for seed in range(args_cli.seed0, args_cli.seed0 + args_cli.n):
            name = case_name(args_cli.prefix, seed)
            ep = episodes_dir(root) / name
            traj, truth, scene = make_case(seed, args_cli.jitter_mm, home_start=args_cli.home_start)
            row = {"name": name, "seed": seed, "n_steps": len(traj.t), "duration": round(traj.duration, 2),
                   "issues": sorted({i.type for i in truth if not i.dont_care})}
            if is_done(ep):
                v = json.loads((ep / "verification.json").read_text(encoding="utf-8"))
                row.update(success=v["success"], reasons=v["reasons"], resumed=True)
                rows.append(row)
                print("RESUMED " + json.dumps(row), flush=True)
                continue
            t0 = time.time()
            try:
                resp = run_replay(ReplayRequest(trajectory=traj, scene=scene, record_cameras=cameras, out_name=name),
                                  ex._replay_fn, root=root, worker_robot="franka", worker_cameras=cameras)
                write_case_files(ep, demo_id=name, traj=traj, scene=scene, truth=truth, seed=seed,
                                 jitter_mm=args_cli.jitter_mm, home_start=args_cli.home_start)
                row.update(success=resp.verification.success, reasons=resp.verification.reasons, ep_dir=resp.ep_dir)
            except Exception as exc:  # recorded, retried on the next run
                traceback.print_exc()
                row.update(success=False, reasons=["sim_error"], error=repr(exc))
            row["wall_s"] = round(time.time() - t0, 1)
            rows.append(row)
            print("ROW " + json.dumps(row), flush=True)
        index_path.write_text(json.dumps({"jitter_mm": args_cli.jitter_mm, "cameras": cameras,
                                          "home_start": args_cli.home_start, "cases": rows},
                                         indent=1), encoding="utf-8")
        ok = sum(r["success"] for r in rows)
        print("INDEX " + json.dumps({"path": str(index_path), "n": len(rows), "replay_success": ok}), flush=True)


if __name__ == "__main__":
    main()
