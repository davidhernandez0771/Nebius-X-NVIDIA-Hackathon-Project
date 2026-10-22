"""Has the teacher learned to grasp? A checkpoint's success by start type, without retraining (Isaac Lab's Python,
GPU, one heavy job: it takes the GPU lock):

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\rl_start_breakdown.py --checkpoint <run>\\model_300.pt \\
        --out data\\rl\\breakdown\\demo_v6_300 [--n 128 --demo-prob 0.5] \\
        [--override env.actions.arm_action.held_target=True]   # repeatable: on top of the run's own settings

- n envs play one episode each in the training env (its reset, its success termination), deterministically (the
  policy's mean action), with the gripper deadband and held-start grace the run trained with (its params/env.yaml).
- Starts: home in a random scene with probability 1 - demo_prob, else a demo state drawn from the WHOLE episode
  (uniform_share 1: no curriculum floor), so free (before the grasp) and held starts both appear.
- Per start type (home / demo free / demo held): episodes, check_success (with its Wilson 95% interval), the bonus,
  and how many ever had a centred grasp or lifted the cube. Home-start success is the real "it grasps" number; a held
  start only has to carry and place.

Writes <out>/breakdown.json and prints the table.
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

from isaaclab.app import add_launcher_args, launch_simulation  # noqa: E402

TYPES = ("home", "demo_free", "demo_held")


def start_type(row, phase) -> str:
    """"home" for row -1, else the bank row's phase (rl_demo_bank.FREE / HELD)."""
    from demo_pipeline import rl_demo_bank as bank_mod

    if row is None or row < 0:
        return "home"
    return "demo_held" if int(phase[row]) == bank_mod.HELD else "demo_free"


def summarize(results: list[dict], phase) -> dict:
    """The first finished episode per env (monitor results), grouped by start type."""
    from demo_pipeline.stats import wilson_ci

    first: dict[int, dict] = {}
    for r in results:
        first.setdefault(r["env"], r)
    out = {}
    for t in TYPES:
        rs = [r for r in first.values() if start_type(r.get("start_row"), phase) == t]
        n, ok = len(rs), sum(bool(r["success"]) for r in rs)
        lo, hi = wilson_ci(ok, n) if n else (0.0, 0.0)
        out[t] = {"episodes": n, "check_success": ok, "wilson95": [round(lo, 3), round(hi, 3)],
                  "bonus": sum(bool(r["bonus"]) for r in rs), "grasped": sum(bool(r.get("grasped")) for r in rs),
                  "lifted": sum(bool(r.get("lifted")) for r in rs),
                  "reasons": {k: sum(k in r["reasons"] for r in rs) for k in sorted({x for r in rs for x in r["reasons"]})}}
    return out


def apply_overrides(env_cfg, overrides: list[str]) -> None:
    """Hydra-style env.* overrides (as rl_train.py --override) on the env config, after the run's own settings: e.g. a
    checkpoint played with another execution (held_target, demo_v6h's zero-shot check). Values parse as YAML."""
    import yaml

    for o in overrides:
        key, sep, value = o.partition("=")
        root, *path = key.split(".")
        if not sep or root != "env" or not path:
            raise ValueError(f"not an env.* override: {o!r}")
        node = env_cfg
        for part in path[:-1]:
            node = node[part] if isinstance(node, dict) else getattr(node, part)
        last, val = path[-1], yaml.safe_load(value)
        if isinstance(node, dict):
            node[last] = val
        elif hasattr(node, last):
            setattr(node, last, val)
        else:
            raise ValueError(f"no setting {key!r}")


def table(summary: dict) -> str:
    lines = [f"{'start':10} {'n':>4} {'success':>8} {'wilson95':>14} {'bonus':>6} {'grasped':>8} {'lifted':>7}"]
    for t in TYPES:
        s = summary[t]
        lo, hi = s["wilson95"]
        lines.append(f"{t:10} {s['episodes']:>4} {s['check_success']:>8} {f'{lo:.2f}-{hi:.2f}':>14} {s['bonus']:>6} "
                     f"{s['grasped']:>8} {s['lifted']:>7}")
    return "\n".join(lines)


def _play_and_write(env_cfg, args, out: Path) -> None:
    import numpy as np
    import torch

    from sim_worker import rl_env_cfg as rc
    from sim_worker.rl_ppo_cfg import SantRLTeacherPPOCfg

    # imported only after Isaac Sim started (see rl_eval_teacher.py)
    from isaaclab.envs import ManagerBasedRLEnv

    from isaaclab_rl.rsl_rl import (RslRlVecEnvWrapper, check_rsl_rl_version, create_rsl_rl_runner,
                                    handle_deprecated_rsl_rl_cfg)

    env = ManagerBasedRLEnv(cfg=env_cfg)
    env._sant_rl_monitor = rc.EpisodeMonitor(env.num_envs, env.device, int(env.max_episode_length), track_every=1,
                                             keep_history=True)
    agent_cfg = handle_deprecated_rsl_rl_cfg(SantRLTeacherPPOCfg(), check_rsl_rl_version())
    wrapped = RslRlVecEnvWrapper(env, clip_actions=agent_cfg.clip_actions)
    runner = create_rsl_rl_runner(wrapped, agent_cfg)
    runner.load(str(args.checkpoint))
    policy = runner.get_inference_policy(device=env.device)
    obs = wrapped.get_observations()
    finished = np.zeros(env.num_envs, dtype=bool)
    with torch.inference_mode():
        for _ in range(int(env.max_episode_length) + 1):
            obs, _, dones, _ = wrapped.step(policy(obs))
            finished |= dones.cpu().numpy().astype(bool)
            if finished.all():
                break
    phase = env._sant_rl_bank["phase"] if getattr(env, "_sant_rl_bank", None) is not None else np.zeros(0)
    summary = {"checkpoint": str(args.checkpoint), "n": env.num_envs, "demo_prob": args.demo_prob,
               "deadband": float(env_cfg.actions.gripper_action.deadband),
               "held_grace_steps": int(env_cfg.events.reset_scene.params.get("held_grace_steps", 0)),
               "held_target": bool(env_cfg.actions.arm_action.held_target), "overrides": list(args.override),
               "by_start": summarize(env._sant_rl_monitor.history, phase)}
    env.close()
    (out / "breakdown.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(table(summary["by_start"]))


def main() -> int:
    parser = argparse.ArgumentParser(description="A checkpoint's success by start type (home / demo free / held).")
    parser.add_argument("--checkpoint", type=Path, required=True, help="an rsl_rl model_<iteration>.pt")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--n", type=int, default=128)
    parser.add_argument("--demo-prob", type=float, default=0.5)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--override", action="append", default=[],
                        help="an env.* setting on top of the run's, e.g. env.actions.arm_action.held_target=True")
    add_launcher_args(parser)
    args = parser.parse_args()

    from sim_worker import rl_env_cfg as rc
    from sim_worker.gpu_lock import GpuLock
    from sim_worker.keepawake import KeepAwake
    from sim_worker.rl_policy import run_env_cfg, run_held_target

    trained = run_env_cfg(args.checkpoint)
    reset = ((trained.get("events") or {}).get("reset_scene") or {}).get("params") or {}
    env_cfg = rc.SantPickPlaceRLEnvCfg()
    env_cfg.scene.num_envs = args.n
    env_cfg.actions.gripper_action.deadband = float(
        ((trained.get("actions") or {}).get("gripper_action") or {}).get("deadband") or 0.0)
    arm = (trained.get("actions") or {}).get("arm_action") or {}
    env_cfg.actions.arm_action.v_max = float(arm.get("v_max") or 0.0)  # the speed cap it trained with (none before v6c)
    env_cfg.actions.arm_action.yaw_rate_max = float(arm.get("yaw_rate_max") or 0.0)
    env_cfg.actions.arm_action.held_target = run_held_target(args.checkpoint)  # its execution (demo_v6h: held)
    env_cfg.events.reset_scene.params.update(demo_prob=args.demo_prob, uniform_share=1.0, seed=args.seed,
                                             held_grace_steps=int(reset.get("held_grace_steps") or 0))
    apply_overrides(env_cfg, args.override)
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    lock = GpuLock(task=f"rl-breakdown:{out.name}", owner="T3", max_wait_s=8 * 3600)
    with lock, KeepAwake(), launch_simulation(env_cfg, args):
        try:  # everything inside the app: closing it ends the process (see rl_eval_teacher.py)
            _play_and_write(env_cfg, args, out)
        except BaseException:
            (out / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
            traceback.print_exc()
            sys.stdout.flush()
            sys.stderr.flush()
            raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
