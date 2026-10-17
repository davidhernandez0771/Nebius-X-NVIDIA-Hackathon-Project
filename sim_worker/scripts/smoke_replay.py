"""Smoke run: scripted expert on a fixed scene -> replay in Isaac Lab -> print the VerificationResult JSON.

Usage (headless; Isaac Lab 3.0 opens no window without --viz kit):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\smoke_replay.py --no-cameras --out data\\smoke
"""

import argparse
import json
import sys
import time
from pathlib import Path

from isaaclab.app import add_launcher_args, launch_simulation

parser = argparse.ArgumentParser(description="Replay the scripted expert once and verify it.")
parser.add_argument("--seed", type=int, default=0)
parser.add_argument("--no-cameras", action="store_true", help="state-only episode (no front/wrist images)")
parser.add_argument("--out", type=Path, default=None, help="episode folder to write (omit to skip writing)")
parser.add_argument("--robot", default="franka", choices=["franka", "openarm", "flexiv"])
parser.add_argument("--lift-z", type=float, default=0.25, help="scripted expert carry/retreat height (m)")
parser.add_argument("--num_envs", type=int, default=1, help="must be 1")
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.num_envs != 1:
    parser.error("--num_envs must be 1")
if not args_cli.no_cameras:
    args_cli.enable_cameras = True  # cameras need the rendering extensions in headless launches

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`

from demo_pipeline.episode_io import load_signals  # noqa: E402
from demo_pipeline.schemas import Pose, Scene  # noqa: E402
from sim_worker.replay import bin_pose_for, make_sim_cfg, replay  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402


def main() -> None:
    t0 = time.time()
    scene = Scene(
        cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
        bin_pose=bin_pose_for(0.5, 0.3),
        robot=args_cli.robot,
        seed=args_cli.seed,
    )
    traj = scripted_expert(scene, lift_z=args_cli.lift_z)
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        t_sim = time.time()
        result, signals = replay(traj, scene, ep_dir=args_cli.out, record_cameras=not args_cli.no_cameras)
        t_done = time.time()
        # print inside the context: closing the app ends the process
        print(f"[smoke] steps={len(traj.t)} demo_s={traj.duration:.2f} "
              f"contact_gripper_cube_steps={int(signals.contact_gripper_cube.sum())} "
              f"arm_bin_steps={int(signals.contact_arm_bin.sum())} "
              f"arm_table_steps={int(signals.contact_arm_table.sum())} "
              f"final_cube={signals.cube_pos[-1].round(4).tolist()}")
        print(f"[smoke] wall time: total {t_done - t0:.1f} s, replay {t_done - t_sim:.1f} s")
        if args_cli.out is not None:
            reloaded = load_signals(args_cli.out)
            assert reloaded is not None, f"no signals.npz in {args_cli.out}"
            assert reloaded.n_steps == signals.n_steps == len(traj.t), (reloaded.n_steps, signals.n_steps, len(traj.t))
            print(f"[smoke] signals reloaded: {reloaded.n_steps} steps")
        print("RESULT_JSON " + json.dumps(result.model_dump()), flush=True)


if __name__ == "__main__":
    main()
