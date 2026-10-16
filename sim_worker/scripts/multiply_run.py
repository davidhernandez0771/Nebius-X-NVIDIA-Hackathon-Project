"""Multiplication yield (T2 sprint 2, Task 4): one source demo -> N transformed variants -> replay -> keep successes.

Usage (headless):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\multiply_run.py --n 30 --seed0 100 --out data\\multiply_franka [--robot openarm]

The source is the scripted expert on the base scene (cube (0.5, 0), bin (0.5, 0.3)). Kept variants are written to
<out>/var_<seed>; rejected ones go to <out>/rejected/var_<seed> for inspection. yield.json holds attempts,
successes, yield, the reasons histogram and per-variant rows.
"""

import argparse
import json
import shutil
import sys
import time
import traceback
from pathlib import Path

import numpy as np

from isaaclab.app import add_launcher_args, launch_simulation

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`

from sim_worker.tracking import add_tracking_args, options_from_args  # noqa: E402

parser = argparse.ArgumentParser(description="Multiply one scripted demo into sampled scenes and measure the yield.")
parser.add_argument("--n", type=int, default=30)
parser.add_argument("--seed0", type=int, default=100)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--robot", default="franka", choices=["franka", "openarm"])
parser.add_argument("--lift-z", type=float, default=0.25, help="scripted expert carry/retreat height (m)")
parser.add_argument("--hold-s", type=float, default=0.5, help="the source demo's hold at each gripper event")
parser.add_argument("--cameras", action="store_true")
add_tracking_args(parser)
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.cameras:
    args_cli.enable_cameras = True

from demo_pipeline.multiply import sample_scene, transform_trajectory  # noqa: E402
from demo_pipeline.schemas import Pose, Scene  # noqa: E402
from sim_worker.batch import yield_report  # noqa: E402
from sim_worker.replay import bin_pose_for, make_sim_cfg, replay  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402


def _run(traj, scene, ep: Path, opts) -> dict:
    st: dict = {}
    try:
        result, _ = replay(traj, scene, ep_dir=ep, record_cameras=args_cli.cameras, tracking=opts, stats=st)
    except Exception as exc:  # a broken replay is a failed attempt, never a crashed run
        traceback.print_exc()
        return {"success": False, "reasons": ["sim_error"], "error": repr(exc)}
    (ep / "scene.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
    (ep / "trajectory.json").write_text(st["trajectory"].model_dump_json(), encoding="utf-8")
    (ep / "verification.json").write_text(result.model_dump_json(indent=1), encoding="utf-8")
    return {"success": result.success, "reasons": result.reasons,
            **{k: st[k] for k in ("mean_mm", "max_mm", "close_mm", "hold_steps")}}


def main() -> None:
    opts = options_from_args(args_cli)
    out: Path = args_cli.out
    out.mkdir(parents=True, exist_ok=True)
    src_scene = Scene(
        cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
        bin_pose=bin_pose_for(0.5, 0.3),
        robot=args_cli.robot,
        seed=0,
    )
    src_traj = scripted_expert(src_scene, hold_s=args_cli.hold_s, lift_z=args_cli.lift_z)
    rows, t0 = [], time.time()
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        source = _run(src_traj, src_scene, out / "source", opts)
        print("SOURCE " + json.dumps(source), flush=True)
        t_var = time.time()
        for seed in range(args_cli.seed0, args_cli.seed0 + args_cli.n):
            t_ep = time.time()
            dst = sample_scene(np.random.default_rng(seed), args_cli.robot, seed)
            name = f"var_{seed:04d}"
            try:
                traj = transform_trajectory(src_traj, src_scene, dst)
            except Exception as exc:
                row = {"success": False, "reasons": ["transform_error"], "error": repr(exc)}
            else:
                row = _run(traj, dst, out / name, opts)
            if not row["success"] and (out / name).exists():
                (out / "rejected").mkdir(exist_ok=True)
                shutil.rmtree(out / "rejected" / name, ignore_errors=True)
                shutil.move(str(out / name), str(out / "rejected" / name))
            row = {"variant": name, **row, "cube": list(dst.cube_pose.pos[:2]), "bin": list(dst.bin_pose.pos[:2]),
                   "wall_s": round(time.time() - t_ep, 2)}
            rows.append(row)
            print("ROW " + json.dumps(row), flush=True)
        report = yield_report(rows, wall_s=time.time() - t_var)
        report.update(robot=args_cli.robot, hold_s=args_cli.hold_s, lift_z=args_cli.lift_z, tracking=vars(opts), seed0=args_cli.seed0,
                      source=source, total_wall_s=time.time() - t0, variants=rows)
        (out / "yield.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
        print("YIELD " + json.dumps({k: v for k, v in report.items() if k != "variants"}), flush=True)


if __name__ == "__main__":
    main()
