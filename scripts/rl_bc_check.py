"""BC-initialised RL, step 2: do the observations rl_bc rebuilds from the demo files match what the env reads, and do
the demo's actions move the env as the demo moved (Isaac Lab's Python, GPU, one heavy job: it takes the GPU lock):

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\rl_bc_check.py --dataset data\\rl\\bc\\bc_v1\\dataset.npz \\
        --out data\\rl\\bc\\bc_v1\\check [--n 32 --steps 50]

- n envs start from demo states (demo_prob 1, from the whole episode, the training reset), each a bank row: one
  training episode at one step k0. The env's observation there is compared with the rebuilt one for the same state.
- Then each env plays that episode's own BC actions open-loop for --steps steps, and after every step the env's
  observation is compared with the rebuilt observation of the demo's next state.
- Reported per observation term (rl_teacher.OBS_SPEC): the median and 95th-percentile absolute error at the start,
  after 1 step and after --steps steps (quaternions compared up to sign, and sign flips counted); the tool's drift
  from the demo's path. Expected: the start matches but for joint_vel and actions (the env restores at rest and with
  no previous action); then small errors growing slowly. A large error at step 1 is a frame, sign or timing bug.

Writes <out>/check.json and prints the table.
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


def term_errors(env_obs, ref_obs) -> dict:
    """Per OBS_SPEC term: absolute errors [n] (max over the term's numbers); quaternions up to sign."""
    import numpy as np

    from demo_pipeline import rl_teacher as rt

    out, o = {}, 0
    for name, n in rt.OBS_SPEC:
        a, b = env_obs[:, o:o + n], ref_obs[:, o:o + n]
        err = np.abs(a - b).max(axis=1)
        if name.endswith("quat"):
            err = np.minimum(err, np.abs(a + b).max(axis=1))
            out[f"{name}_sign_flips"] = int((np.abs(a + b).max(axis=1) < np.abs(a - b).max(axis=1)).sum())
        out[name] = err
        o += n
    return out


def _offset(term: str) -> tuple[int, int]:
    """The [start, end) of an OBS_SPEC term in the observation."""
    from demo_pipeline import rl_teacher as rt

    o = 0
    for name, n in rt.OBS_SPEC:
        if name == term:
            return o, o + n
        o += n
    raise KeyError(term)


def summarize(errs: dict) -> dict:
    import numpy as np

    return {k: (v if np.isscalar(v) else {"median": round(float(np.median(v)), 5),
                                           "p95": round(float(np.percentile(v, 95)), 5), "n": int(len(v))})
            for k, v in errs.items()}


def _run(env_cfg, args, out: Path) -> None:
    import numpy as np
    import torch

    from demo_pipeline import rl_teacher as rt

    from isaaclab.envs import ManagerBasedRLEnv  # after Isaac Sim started (see rl_eval_teacher.py)

    with np.load(args.dataset) as z:
        data = {k: z[k] for k in z.files}
    index = {(int(e), int(k)): i for i, (e, k) in enumerate(zip(data["episode"], data["step"]))}
    env = ManagerBasedRLEnv(cfg=env_cfg)
    obs, _ = env.reset()
    bank = env._sant_rl_bank
    rows = env._sant_rl_start_row.cpu().numpy()
    # the bank row's state k0 is the rebuilt observation at dataset step k0 + 1 (the state before step k0 + 1)
    start = [index.get((int(bank["episode"][r]), int(bank["step"][r]) + 1)) for r in rows]
    alive = np.array([s is not None for s in start])
    report = {"n": env.num_envs, "steps": args.steps, "dataset": str(args.dataset)}
    cur = np.array([s if s is not None else 0 for s in start])
    env_o = obs["policy"].cpu().numpy()
    report["start"] = summarize(term_errors(env_o[alive], data["obs"][cur[alive]]))
    tcp = slice(*_offset("tcp_pos"))
    last = len(data["obs"]) - 1
    drift = []
    for t in range(1, args.steps + 1):
        nxt = np.minimum(cur + 1, last)
        ok = alive & (cur + 1 <= last) & (data["episode"][nxt] == data["episode"][cur])  # still in its episode
        act = torch.as_tensor(data["act"][cur], dtype=torch.float32, device=env.device)
        obs, _, term, trunc, _ = env.step(act)
        done = (term | trunc).cpu().numpy()
        alive = ok & ~done
        cur = nxt
        env_o = obs["policy"].cpu().numpy()
        if t == 1 or t == args.steps:
            report[f"after_{t}"] = summarize(term_errors(env_o[alive], data["obs"][cur[alive]]))
        if alive.any():
            drift.append(float(np.median(np.linalg.norm(env_o[alive, tcp] - data["obs"][cur[alive], tcp], axis=1))))
    report["tcp_drift_median_m"] = [round(d, 5) for d in drift]
    report["alive_at_end"] = int(alive.sum())
    env.close()
    (out / "check.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    for key in ("start", "after_1", f"after_{args.steps}"):
        if key in report:
            print(key, {k: (v["median"], v["p95"]) if isinstance(v, dict) else v for k, v in report[key].items()})
    print("tcp drift (median m) every 10 steps:", report["tcp_drift_median_m"][::10])
    print(rt.OBS_DIM, "obs dims; alive at the end:", report["alive_at_end"], "of", report["n"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuilt BC observations vs the env's, and open-loop demo actions.")
    parser.add_argument("--dataset", type=Path, required=True, help="rl_bc_pretrain.py's <out>/dataset.npz")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--n", type=int, default=32)
    parser.add_argument("--steps", type=int, default=50)
    parser.add_argument("--deadband", type=float, default=0.25)
    parser.add_argument("--seed", type=int, default=11)
    add_launcher_args(parser)
    args = parser.parse_args()

    from sim_worker import rl_env_cfg as rc
    from sim_worker.gpu_lock import GpuLock
    from sim_worker.keepawake import KeepAwake

    env_cfg = rc.SantPickPlaceRLEnvCfg()
    env_cfg.scene.num_envs = args.n
    env_cfg.actions.gripper_action.deadband = args.deadband
    env_cfg.events.reset_scene.params.update(demo_prob=1.0, uniform_share=1.0, seed=args.seed, held_grace_steps=0)
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    lock = GpuLock(task=f"rl-bc-check:{out.name}", owner="T3", max_wait_s=8 * 3600)
    with lock, KeepAwake(), launch_simulation(env_cfg, args):
        try:  # everything inside the app: closing it ends the process (see rl_eval_teacher.py)
            _run(env_cfg, args, out)
        except BaseException:
            (out / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")
            traceback.print_exc()
            sys.stdout.flush()
            sys.stderr.flush()
            raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
