"""Diagnostic: do held demo starts keep the cube? (Isaac Lab's Python, GPU, ~5 min.)

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\rl_probe_demo_starts.py --out data\\rl\\probe_held [--grace 0]

64 envs of the RL env, every start a HELD bank state (the gripper closed on the cube, rl_demo_bank), the arm told to
stay where it is (a zero action) and the gripper commanded closed for --forced-steps steps (default 10), then left
to the policy's neutral output (0: open). Per env it logs whether the cube is still held (gripper closed and a finger
on it) and its height above the bin and table at steps 1, 5, 10 and 30, plus the finger widths right after the
restore against the recorded ones. --grace N runs the env's own held-start grace (the fix) instead of the forcing.
Writes <out>/probe.json and prints the summary. Takes gpu.lock and KeepAwake.

demo_v2 (2026-10-21) read lifted = 0 throughout although half its demo starts hold the cube: this tells whether the
restore loses it (the physics) or the policy's first gripper command does.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from sim_worker.own_code import check_own_code  # noqa: E402

check_own_code(REPO)

import numpy as np  # noqa: E402
from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

parser = argparse.ArgumentParser(description="Do held demo starts keep the cube?")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--n", type=int, default=64)
parser.add_argument("--steps", type=int, default=30)
parser.add_argument("--forced-steps", type=int, default=10, help="gripper commanded closed for this many steps")
parser.add_argument("--grace", type=int, default=0, help="use the env's held-start grace of N steps instead")
add_launcher_args(parser)
args_cli = parser.parse_args()
CHECK_AT = (1, 5, 10, 30)


def main() -> int:
    import torch
    from isaaclab.envs import ManagerBasedRLEnv

    from demo_pipeline import rl_teacher as rt
    from sim_worker import rl_env_cfg as rc
    from sim_worker.gpu_lock import GpuLock
    from sim_worker.keepawake import KeepAwake

    env_cfg = rc.SantPickPlaceRLEnvCfg()
    env_cfg.scene.num_envs = args_cli.n
    env_cfg.terminations.success = None  # watch the restore, not the task
    env_cfg.terminations.cube_fell = None
    p = env_cfg.events.reset_scene.params
    p.update(demo_prob=1.0, bank_phase="held", curriculum_start=0.0, held_grace_steps=args_cli.grace)
    args_cli.out.mkdir(parents=True, exist_ok=True)
    rows_out = []
    lock = GpuLock(task=f"rl-probe:{args_cli.out.name}", owner="T3", max_wait_s=8 * 3600)
    with lock, KeepAwake(), launch_simulation(env_cfg, args_cli):
        env = ManagerBasedRLEnv(cfg=env_cfg)
        env.reset()
        bank = env._sant_rl_bank
        start_rows = env._sant_rl_start_row.cpu().numpy()
        robot = env.scene["robot"]
        restored_fingers = robot.data.joint_pos.torch[:, 7:9].cpu().numpy()
        recorded_fingers = bank["joint_pos"][start_rows][:, 7:9]
        recorded_cube = bank["cube_pos"][start_rows]
        n = env.num_envs
        held, cube_z, cube_off = {}, {}, {}
        with torch.inference_mode():
            for k in range(1, args_cli.steps + 1):
                a = torch.zeros(n, rt.ACTION_DIM, device=env.device)  # arm: stay
                a[:, 4] = -1.0 if (args_cli.grace == 0 and k <= args_cli.forced_steps) else 0.0
                env.step(a)
                if k in CHECK_AT:
                    s = rc.step_state(env)
                    held[k] = (s.closed & s.finger_contact).cpu().numpy()
                    cube = s.cube.cpu().numpy()
                    cube_z[k] = cube[:, 2]
                    cube_off[k] = np.linalg.norm(cube - recorded_cube, axis=1)
        env.close()
    for i in range(n):
        rows_out.append({
            "env": i, "bank_row": int(start_rows[i]), "progress": float(bank["progress"][start_rows[i]]),
            "fingers_restored": restored_fingers[i].round(4).tolist(),
            "fingers_recorded": recorded_fingers[i].round(4).tolist(),
            **{f"held_{k}": bool(held[k][i]) for k in held},
            **{f"cube_z_{k}": round(float(cube_z[k][i]), 4) for k in cube_z},
            **{f"cube_moved_{k}": round(float(cube_off[k][i]), 4) for k in cube_off},
        })
    summary = {"n": n, "grace": args_cli.grace, "forced_steps": 0 if args_cli.grace else args_cli.forced_steps,
               **{f"held_at_{k}": float(np.mean(held[k])) for k in held},
               **{f"cube_moved_median_at_{k}": float(np.median(cube_off[k])) for k in cube_off},
               "finger_width_error_median": float(np.median(np.abs(restored_fingers - recorded_fingers)))}
    (args_cli.out / "probe.json").write_text(json.dumps({"summary": summary, "envs": rows_out}, indent=1),
                                             encoding="utf-8")
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
