"""Evaluate an RL teacher checkpoint on the eval scenes, in two steps. This is step 1 (Isaac Lab's Python, GPU):

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\rl_eval_teacher.py --checkpoint <run>\\model_1499.pt \\
        --out data\\rl\\eval\\<name> [--seed0 5020 --n 40]

- Each of n envs gets eval scene seed0 + i, exactly as sim_eval makes it (multiply.sample_scene with that seed), the
  robot at home. The teacher plays one episode in each, deterministically (the policy's mean action).
- In-env verdict: the env's own check_success on each episode (the unchanged function, on the reached tool path,
  the cube and the contacts the env read), written as in_env.json.
- What the teacher did, as SANT data: per seed, the commanded tool targets and gripper as a SANT Trajectory (the
  first row is the reached home pose, as align_home puts home in front of every training episode), and its Scene:
  trajectories/<seed>.json, scenes/<seed>.json.

Step 2, the real test, is scripts/rl_verify_teacher.py: it replays those trajectories in SANT's own eval/replay
env (the sim worker, the same tracking and check_success every demo goes through) and reports successes / n. The
teacher's distillation data comes out of exactly that path, so step 2 is the number that counts.
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

parser = argparse.ArgumentParser(description="Play an RL teacher checkpoint on the eval scenes (step 1 of 2).")
parser.add_argument("--checkpoint", type=Path, required=True, help="an rsl_rl model_<iteration>.pt")
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--seed0", type=int, default=5020)
parser.add_argument("--n", type=int, default=40)
add_launcher_args(parser)
args_cli = parser.parse_args()


def reset_eval_scenes(env, env_ids, seed0: int = 5020) -> None:
    """Event (reset): env i in eval scene seed0 + i (sim_eval's scenes), the robot at SANT's home (HOME_JOINTS, where
    SANT's eval starts); then as the training reset writes it."""
    import torch

    from demo_pipeline.multiply import sample_scene
    from sim_worker import rl_env_cfg as rc

    ids = torch.arange(env.num_envs, device=env.device) if env_ids is None or isinstance(env_ids, slice) else env_ids
    mon = getattr(env, "_sant_rl_monitor", None)
    if mon is not None:
        bin_pos, bin_quat = rc.bin_frame(env)
        mon.finish(ids, bin_pos[ids], bin_quat[ids])
    from demo_pipeline import rl_teacher as rt

    robot = env.scene["robot"]
    home = torch.tensor(rt.HOME_JOINTS, dtype=torch.float32, device=env.device).repeat(len(ids), 1)
    robot.write_joint_position_to_sim_index(position=home, env_ids=ids)
    robot.write_joint_velocity_to_sim_index(velocity=torch.zeros_like(home), env_ids=ids)
    robot.set_joint_position_target_index(target=home, env_ids=ids)
    origins = env.scene.env_origins[ids].cpu().numpy()
    poses: dict[str, list] = {}
    for j, i in enumerate(ids.tolist()):
        s = sample_scene(np.random.default_rng(seed0 + i), "franka", seed0 + i)
        objs = rc.mimic.scene_objects({"pos": s.cube_pose.pos, "quat_wxyz": s.cube_pose.quat_wxyz},
                                      {"pos": s.bin_pose.pos, "quat_wxyz": s.bin_pose.quat_wxyz})
        objs.pop("table")
        for name, (pos, q) in objs.items():
            poses.setdefault(name, []).append(np.r_[np.asarray(pos) + origins[j], rc._wxyz_to_xyzw(np.asarray(q))])
    for name, rows in poses.items():
        env.scene[name].write_root_pose_to_sim_index(
            root_pose=torch.as_tensor(np.asarray(rows), dtype=torch.float32, device=env.device), env_ids=ids)
        if name == "cube":
            env.scene[name].write_root_velocity_to_sim_index(root_velocity=torch.zeros(len(ids), 6, device=env.device),
                                                             env_ids=ids)


def main() -> int:
    import torch
    from isaaclab.envs import ManagerBasedRLEnv
    from isaaclab.managers import EventTermCfg

    from isaaclab_rl.rsl_rl import (RslRlVecEnvWrapper, check_rsl_rl_version, create_rsl_rl_runner,
                                    handle_deprecated_rsl_rl_cfg)

    from demo_pipeline.multiply import sample_scene
    from demo_pipeline.schemas import Trajectory
    from sim_worker import rl_env_cfg as rc
    from sim_worker.rl_ppo_cfg import SantRLTeacherPPOCfg

    env_cfg = rc.SantPickPlaceRLPlayEnvCfg()
    env_cfg.scene.num_envs = args_cli.n
    env_cfg.events.reset_scene = EventTermCfg(func=reset_eval_scenes, mode="reset", params={"seed0": args_cli.seed0})
    out = args_cli.out
    (out / "trajectories").mkdir(parents=True, exist_ok=True)
    (out / "scenes").mkdir(parents=True, exist_ok=True)
    with launch_simulation(env_cfg, args_cli):
        env = ManagerBasedRLEnv(cfg=env_cfg)
        env._sant_rl_monitor = rc.EpisodeMonitor(env.num_envs, env.device, int(env.max_episode_length), track_every=1)
        agent_cfg = handle_deprecated_rsl_rl_cfg(SantRLTeacherPPOCfg(), check_rsl_rl_version())
        wrapped = RslRlVecEnvWrapper(env, clip_actions=agent_cfg.clip_actions)
        runner = create_rsl_rl_runner(wrapped, agent_cfg)
        runner.load(str(args_cli.checkpoint))
        policy = runner.get_inference_policy(device=env.device)
        # the teacher for distillation (sim_worker/rl_policy.py): the run's exported/policy.pt, as Isaac Lab's play writes it
        runner.export_policy_to_jit(path=str(args_cli.checkpoint.parent / "exported"), filename="policy.pt")
        arm, grip = env.action_manager.get_term(rc.ARM_TERM), env.action_manager.get_term(rc.GRIPPER_TERM)
        obs = wrapped.get_observations()
        n = env.num_envs
        start = torch.cat([rc.tcp_pos(env), rc.tcp_quat(env)], dim=-1).cpu().numpy()  # x y z, then x y z w
        rows: list[list] = [[start[i]] for i in range(n)]
        closed: list[list] = [[0] for _ in range(n)]
        finished = np.zeros(n, dtype=bool)
        with torch.inference_mode():
            for _ in range(int(env.max_episode_length) + 1):
                obs, _, dones, _ = wrapped.step(policy(obs))
                cmd = arm.tcp_command().cpu().numpy()
                g = (grip.raw_actions[:, 0] < 0).cpu().numpy()
                for i in np.flatnonzero(~finished):
                    rows[i].append(cmd[i])
                    closed[i].append(int(g[i]))
                finished |= dones.cpu().numpy().astype(bool)
                if finished.all():
                    break
        verdicts: dict[int, dict] = {}
        for r in env._sant_rl_monitor.results:  # the first episode per env (a finished env restarts in its scene)
            verdicts.setdefault(r["env"], r)
        env.close()
    summary = {"checkpoint": str(args_cli.checkpoint), "seeds": [args_cli.seed0, args_cli.seed0 + n - 1], "n": n,
               "in_env": {}}
    for i in range(n):
        seed = args_cli.seed0 + i
        pose = np.asarray(rows[i], dtype=np.float64)
        quat = np.concatenate([pose[:, 6:7], pose[:, 3:6]], axis=1)  # x y z w -> w x y z
        traj = Trajectory.from_arrays(np.arange(len(pose)) * 0.02, pose[:, :3], quat, closed[i])
        (out / "trajectories" / f"{seed}.json").write_text(traj.model_dump_json(), encoding="utf-8")
        scene = sample_scene(np.random.default_rng(seed), "franka", seed)
        (out / "scenes" / f"{seed}.json").write_text(scene.model_dump_json(indent=1), encoding="utf-8")
        v = verdicts.get(i)
        summary["in_env"][seed] = None if v is None else {"success": v["success"], "reasons": v["reasons"],
                                                         "steps": v["steps"]}
    ok = sum(bool(v and v["success"]) for v in summary["in_env"].values())
    summary["in_env_successes"] = ok
    (out / "in_env.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(f"in-env check_success: {ok}/{n}; trajectories in {out}; next: scripts/rl_verify_teacher.py --runs {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
