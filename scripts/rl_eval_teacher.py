"""Evaluate an RL teacher checkpoint on the eval scenes, in two steps. This is step 1 (Isaac Lab's Python, GPU):

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\rl_eval_teacher.py --checkpoint <run>\\model_1499.pt \\
        --out data\\rl\\eval\\<name> [--seed0 5020 --n 40]

- Each of n envs gets eval scene seed0 + i, exactly as sim_eval makes it (multiply.sample_scene with that seed), the
  robot at home. The teacher plays one episode in each, deterministically (the policy's mean action).
- In-env verdict: the env's own check_success on each episode (the unchanged function, on the reached tool path,
  the cube and the contacts the env read), written as in_env.json.
- What the teacher did, as SANT data: per seed, its tool path and gripper as a SANT Trajectory (the first row is the
  reached home pose, as align_home puts home in front of every training episode), and its Scene:
  trajectories/<seed>.json, scenes/<seed>.json. The tool path (record_step):
  - a tracking teacher (every run up to demo_v6c2): the commanded tool targets, which its arm follows;
  - a held-executed teacher (held_target, demo_v6h; prereg Amendment 5, 2026-10-21): the ACHIEVED tool pose after
    each step, as SANT records human demos, so replay checks what the arm really did. Held execution lags its
    commands by design (~0.2 s, targets up to 2 cm ahead): replaying the commands was a different motion (demo_v6h
    model_2697 on 7000-7031: in-env 30/32, commanded replay 22/32, the change made after that check).

Step 2, the real test, is scripts/rl_verify_teacher.py: it replays those trajectories in SANT's own eval/replay
env (the sim worker, the same tracking and check_success every demo goes through) and reports successes / n. The
teacher's distillation data comes out of exactly that path, so step 2 is the number that counts.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
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


def record_step(rows: list[list], closed: list[list], finished, cmd, achieved, grip, dones, held: bool) -> None:
    """Append one control step to each still-running episode's Trajectory rows, in place. cmd / achieved: [n, 7] tool
    poses (x y z, x y z w): the step's commanded target / the tool after the step; grip: [n] commanded closed; dones:
    [n] the episodes that ended this step. held: record the achieved pose (Amendment 5), else the command. An env
    that ended this step has already been reset by the env, so its achieved pose is the next episode's: held drops
    that last row (the command of an ended step is still its own, so tracking keeps it, as before)."""
    for i in np.flatnonzero(~np.asarray(finished)):
        if held and dones[i]:
            continue
        rows[i].append((achieved if held else cmd)[i])
        closed[i].append(int(grip[i]))


def _play_and_write(env_cfg, out: Path) -> None:
    """Play the checkpoint in every env (inside the running app), then write the trajectories, scenes and verdicts."""
    import torch

    from demo_pipeline.multiply import sample_scene
    from demo_pipeline.schemas import Trajectory
    from sim_worker import rl_env_cfg as rc
    from sim_worker.rl_ppo_cfg import SantRLTeacherPPOCfg

    # imported only now, after Isaac Sim started: the env class imports USD, and importing it earlier loads the
    # pip USD build, so Kit's own fails (omni.usd has no attribute get_context; the probe, 2026-10-21)
    from isaaclab.envs import ManagerBasedRLEnv

    from isaaclab_rl.rsl_rl import (RslRlVecEnvWrapper, check_rsl_rl_version, create_rsl_rl_runner,
                                    handle_deprecated_rsl_rl_cfg)

    env = ManagerBasedRLEnv(cfg=env_cfg)
    env._sant_rl_monitor = rc.EpisodeMonitor(env.num_envs, env.device, int(env.max_episode_length), track_every=1,
                                             keep_history=True)
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
    held = bool(getattr(env_cfg.actions.arm_action, "held_target", False))
    with torch.inference_mode():
        for _ in range(int(env.max_episode_length) + 1):
            obs, _, dones, _ = wrapped.step(policy(obs))
            cmd = arm.tcp_command().cpu().numpy()
            achieved = torch.cat([rc.tcp_pos(env), rc.tcp_quat(env)], dim=-1).cpu().numpy()
            g = (grip.raw_actions[:, 0] < 0).cpu().numpy()
            d = dones.cpu().numpy().astype(bool)
            record_step(rows, closed, finished, cmd, achieved, g, d, held)
            finished |= d
            if finished.all():
                break
    verdicts: dict[int, dict] = {}
    # the first episode per env (a finished env restarts in its scene); history, as log() empties results each step
    for r in env._sant_rl_monitor.history:
        verdicts.setdefault(r["env"], r)
    env.close()
    summary = {"checkpoint": str(args_cli.checkpoint), "seeds": [args_cli.seed0, args_cli.seed0 + n - 1], "n": n,
               "execution": "held" if held else "tracking", "trajectory": "achieved" if held else "commanded",
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


def main() -> int:
    from isaaclab.managers import EventTermCfg

    from sim_worker import rl_env_cfg as rc

    from sim_worker.rl_policy import run_gripper_deadband, run_held_target, run_speed_cap

    env_cfg = rc.SantPickPlaceRLPlayEnvCfg()
    env_cfg.scene.num_envs = args_cli.n
    # the gripper as the run trained it (its params/env.yaml), as T6's adapter does; the Play env's default is none
    env_cfg.actions.gripper_action.deadband = run_gripper_deadband(args_cli.checkpoint)
    # and the speed cap it trained with (none before demo_v6c)
    env_cfg.actions.arm_action.v_max, env_cfg.actions.arm_action.yaw_rate_max = run_speed_cap(args_cli.checkpoint)
    # and its execution: held targets (demo_v6h on), as the student is executed
    env_cfg.actions.arm_action.held_target = run_held_target(args_cli.checkpoint)
    env_cfg.events.reset_scene = EventTermCfg(func=reset_eval_scenes, mode="reset", params={"seed0": args_cli.seed0})
    out = args_cli.out
    (out / "trajectories").mkdir(parents=True, exist_ok=True)
    (out / "scenes").mkdir(parents=True, exist_ok=True)
    from sim_worker.gpu_lock import GpuLock
    from sim_worker.keepawake import KeepAwake

    # one heavy GPU job at a time (C:\dev\gpu.lock), and no idle sleep mid-run
    lock = GpuLock(task=f"rl-eval:{out.name}", owner="T3", max_wait_s=8 * 3600)
    with lock, KeepAwake(), launch_simulation(env_cfg, args_cli):
        # Everything happens inside: closing the app ends the process, so nothing after this block runs, and an
        # exception raised in it would vanish unprinted (the held-start probe, 2026-10-21). Write it out first.
        try:
            _play_and_write(env_cfg, out)
        except BaseException:
            (out / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
            traceback.print_exc()
            sys.stdout.flush()
            sys.stderr.flush()
            raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
