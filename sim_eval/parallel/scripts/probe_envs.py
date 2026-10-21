"""Diagnostic: put one scene in every env, hold the start pose, and diff each env's observations against env 0.

With a faithful N-env scene, every env sees the same images, joints, cube and TCP (up to render noise).
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_eval\\parallel\\scripts\\probe_envs.py --num-envs 4 --seed 5001 ^
        --reset-pose-from <serial results .json> --out data\\evals_parallel\\probe
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(REPO / "src"), str(REPO)]
from sim_worker.own_code import check_own_code  # noqa: E402

from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument("--num-envs", type=int, default=4)
parser.add_argument("--seed", type=int, default=5001)
parser.add_argument("--hold-steps", type=int, default=25)
parser.add_argument("--env-spacing", type=float, default=None)
parser.add_argument("--ref", type=Path, default=None, help="a probe dir (e.g. N=1) to diff every env against")
parser.add_argument("--reset-pose-from", type=Path, default=None)
parser.add_argument("--out", type=Path, required=True)
add_launcher_args(parser)
args_cli = parser.parse_args()
args_cli.enable_cameras = True

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from sim_eval.scenes import eval_scenes  # noqa: E402
from sim_worker.replay import make_sim_cfg  # noqa: E402


def main() -> None:
    check_own_code()  # logs where demo_pipeline came from; stops if not this checkout
    pose = None
    if args_cli.reset_pose_from:
        pose = json.loads(args_cli.reset_pose_from.read_text(encoding="utf-8"))["run"]["start_check"]["reset_pose"]
    scene = eval_scenes(1, args_cli.seed)[0]
    out = args_cli.out
    out.mkdir(parents=True, exist_ok=True)
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        from sim_eval.parallel.isaac_vec_env import IsaacVecEvalEnv

        env = IsaacVecEvalEnv(args_cli.num_envs, cameras=True, device=args_cli.device, start_joint_pos=pose,
                              **({} if args_cli.env_spacing is None else {"env_spacing": args_cli.env_spacing}))
        n = env.num_envs
        print("PROBE origins", env.origins.cpu().numpy().round(3).tolist(), flush=True)
        holds = env.reset_envs({i: scene for i in range(n)})
        actions = np.stack([holds[i] for i in range(n)])
        for k in range(args_cli.hold_steps):
            recs = env.step(actions)
            obs = env.observe()
            if k in (4, args_cli.hold_steps - 1):
                for i in range(n):
                    for cam, img in obs[i].images.items():
                        Image.fromarray(img).save(out / f"k{k:02d}_env{i}_{cam}.png")
                rows = []
                for i in range(n):
                    row = {"env": i,
                           "joint_diff": float(np.abs(obs[i].joint_pos - obs[0].joint_pos).max()),
                           "tcp": recs[i].tcp_pos.round(4).tolist(), "cube": recs[i].cube_pos.round(4).tolist(),
                           "contact_gc": recs[i].contact_gripper_cube, "force": round(recs[i].max_contact_force, 3)}
                    for cam in env.cameras:
                        d = np.abs(obs[i].images[cam].astype(int) - obs[0].images[cam].astype(int))
                        row[f"{cam}_maxdiff"] = int(d.max())
                        row[f"{cam}_meandiff"] = round(float(d.mean()), 3)
                        row[f"{cam}_frac_px_gt20"] = round(float((d.max(axis=2) > 20).mean()), 4)
                    rows.append(row)
                print(f"PROBE k={k} " + json.dumps(rows), flush=True)
                if args_cli.ref:
                    ref_rows = []
                    for i in range(n):
                        row = {"env": i}
                        for cam in env.cameras:
                            ref = np.asarray(Image.open(args_cli.ref / f"k{k:02d}_env0_{cam}.png")).astype(int)
                            d = np.abs(obs[i].images[cam].astype(int) - ref)
                            row[f"{cam}_meandiff"] = round(float(d.mean()), 3)
                            row[f"{cam}_frac_px_gt20"] = round(float((d.max(axis=2) > 20).mean()), 4)
                        ref_rows.append(row)
                    print(f"PROBE_VS_REF k={k} " + json.dumps(ref_rows), flush=True)


if __name__ == "__main__":
    main()
