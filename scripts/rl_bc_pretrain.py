"""BC-initialised RL, step 1: fit the RL teacher's actor to the SANT-verified demo actions and save it as an rsl_rl
checkpoint PPO can start from (Isaac Lab's Python; torch on the CPU by default, no Isaac Sim, no GPU lock):

    set PYTHONPATH=.;src
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\rl_bc_pretrain.py --out data\\rl\\bc\\bc_v1

- Data: demo_pipeline.rl_bc on the demo-start bank's episodes (data/rl/bank_mouse20261020.json: the store and the
  110 verified training episodes), cached as <out>/dataset.npz. A tenth of the human takes (each with all its
  multiplied variants) are held out for validation.
- Model: the actor and critic exactly as rsl_rl's PPO builds them from sim_worker/rl_ppo_cfg.py (MLP 512-256-128,
  ELU, observation normalisers, a Gaussian head), so Isaac Lab's trainer loads the checkpoint strictly. The actor's
  mean is fitted by MSE; both normalisers start from the demo observations; the critic is fresh; the Gaussian std is
  set to --init-std (a checkpoint's std overrides the trainer's init_std).
- Output: <out>/model_0.pt ({actor,critic}_state_dict, iter 0; no optimizer state: train with --fresh-optimizer) and
  <out>/report.json (validation MSE per action dimension against the zero action, the gripper's sign agreement).

Step 2: scripts/rl_bc_check.py (Isaac Sim) checks that the rebuilt observations match the env's. Step 3: PPO from it,
    uv run --no-sync python scripts\\rl_train.py --run-name bc_v1 --checkpoint data\\rl\\bc\\bc_v1\\model_0.pt
        --fresh-optimizer [--reward lift] --override ...
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

BANK_META = REPO / "data" / "rl" / "bank_mouse20261020.json"


def root_of(episode_id: str) -> str:
    """The human take an episode comes from: its repaired demo and that demo's multiplied variants share it."""
    return episode_id.split("_rules_home")[0]


def split_episodes(episode: "np.ndarray", val_share: float, seed: int = 0, groups: list[str] | None = None):
    """Train / validation masks over the pairs, whole groups to one side. groups: per episode index, the take it
    comes from (root_of), so no take's variants are on both sides; None = each episode its own group."""
    import numpy as np

    if groups is not None:
        names = sorted(set(groups))
        episode = np.asarray([names.index(groups[e]) for e in episode])
    eps = np.unique(episode)
    rng = np.random.default_rng(seed)
    n_val = max(1, int(round(len(eps) * val_share))) if val_share > 0 else 0
    val_eps = set(rng.choice(eps, size=n_val, replace=False).tolist()) if n_val else set()
    val = np.isin(episode, list(val_eps))
    return ~val, val


def build_models(obs_dim: int, init_std: float, device: str = "cpu"):
    """(actor, critic, cfg) as rsl_rl's PPO.construct_algorithm makes them for our PPO config."""
    import torch
    from tensordict import TensorDict

    from isaaclab_rl.rsl_rl import handle_deprecated_rsl_rl_cfg
    from rsl_rl.utils import resolve_class, resolve_obs_groups

    from demo_pipeline import rl_teacher as rt
    from sim_worker.rl_ppo_cfg import SantRLTeacherPPOCfg

    try:
        from isaaclab_rl.rsl_rl import check_rsl_rl_version

        agent = handle_deprecated_rsl_rl_cfg(SantRLTeacherPPOCfg(), check_rsl_rl_version())
    except ImportError:
        agent = SantRLTeacherPPOCfg()
    agent.actor.distribution_cfg.init_std = init_std
    cfg = agent.to_dict()
    obs = TensorDict({"policy": torch.zeros(2, obs_dim)}, batch_size=[2])
    actor_class, actor_cfg = resolve_class(cfg["actor"])
    critic_class, critic_cfg = resolve_class(cfg["critic"])
    cfg["obs_groups"] = resolve_obs_groups(obs, cfg["obs_groups"], ["actor", "critic"])
    actor = actor_class(obs, cfg["obs_groups"], "actor", rt.ACTION_DIM, **actor_cfg).to(device)
    critic = critic_class(obs, cfg["obs_groups"], "critic", 1, **critic_cfg).to(device)
    return actor, critic, cfg


def fit(actor, obs, act, train, val, *, epochs: int, lr: float, batch: int, seed: int = 0) -> dict:
    """Fit the actor's mean to act by MSE (after setting its normaliser from obs); returns the validation report."""
    import numpy as np
    import torch
    from tensordict import TensorDict

    torch.manual_seed(seed)
    dev = next(actor.parameters()).device
    o = torch.as_tensor(obs, dtype=torch.float32, device=dev)
    a = torch.as_tensor(act, dtype=torch.float32, device=dev)
    td = lambda x: TensorDict({"policy": x}, batch_size=[len(x)])  # noqa: E731
    actor.update_normalization(td(o[torch.as_tensor(train)]))
    params = [p for n, p in actor.named_parameters() if not n.startswith("distribution")]
    opt = torch.optim.Adam(params, lr=lr)
    ti = np.flatnonzero(train)
    rng = np.random.default_rng(seed)
    history = []
    for ep in range(epochs):
        actor.train()
        rng.shuffle(ti)
        for i in range(0, len(ti), batch):
            j = torch.as_tensor(ti[i:i + batch], device=dev)
            loss = ((actor(td(o[j])) - a[j]) ** 2).mean()
            opt.zero_grad()
            loss.backward()
            opt.step()
        if ep % 10 == 9 or ep == epochs - 1:
            history.append({"epoch": ep + 1, **evaluate(actor, o, a, val)})
    return {"history": history, **evaluate(actor, o, a, val), "zero_action_mse": zero_mse(a, val)}


def evaluate(actor, o, a, mask) -> dict:
    import numpy as np
    import torch
    from tensordict import TensorDict

    actor.eval()
    idx = torch.as_tensor(np.flatnonzero(mask), device=o.device)
    if len(idx) == 0:
        return {}
    with torch.no_grad():
        pred = actor(TensorDict({"policy": o[idx]}, batch_size=[len(idx)]))
    err = ((pred - a[idx]) ** 2).mean(0)
    return {"val_mse": [round(float(e), 5) for e in err],
            "gripper_sign_agreement": round(float(((pred[:, 4] < 0) == (a[idx, 4] < 0)).float().mean()), 4)}


def zero_mse(a, mask) -> list[float]:
    import numpy as np

    idx = np.flatnonzero(mask)
    return [round(float(e), 5) for e in (a[idx] ** 2).mean(0).cpu().numpy()]


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--bank-meta", type=Path, default=BANK_META)
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--batch", type=int, default=1024)
    p.add_argument("--init-std", type=float, default=0.3)
    p.add_argument("--val-share", type=float, default=0.1)
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args(argv)

    import numpy as np
    import torch
    from tensordict import TensorDict

    from demo_pipeline import rl_bc
    from demo_pipeline.store import DemoStore

    args.out.mkdir(parents=True, exist_ok=True)
    cache = args.out / "dataset.npz"
    if cache.is_file():
        with np.load(cache) as z:
            data = {k: z[k] for k in z.files}
        meta = json.loads(cache.with_suffix(".json").read_text(encoding="utf-8"))
    else:
        bank = json.loads(args.bank_meta.read_text(encoding="utf-8"))
        data, meta = rl_bc.build_dataset(DemoStore(Path(bank["store"])), bank["episodes"])
        rl_bc.save_dataset(cache, data, meta)
    train, val = split_episodes(data["episode"], args.val_share, args.seed,
                                groups=[root_of(e) for e in meta["episodes"]])
    actor, critic, _ = build_models(data["obs"].shape[1], args.init_std, args.device)
    report = fit(actor, data["obs"], data["act"], train, val, epochs=args.epochs, lr=args.lr, batch=args.batch,
                 seed=args.seed)
    o = torch.as_tensor(data["obs"][train], dtype=torch.float32, device=args.device)
    critic.update_normalization(TensorDict({"policy": o}, batch_size=[len(o)]))
    torch.save({"actor_state_dict": actor.state_dict(), "critic_state_dict": critic.state_dict(), "iter": 0,
                "infos": {"bc": {"episodes": len(meta["episodes"]), "pairs": meta["pairs"]}}},
               args.out / "model_0.pt")
    report.update(pairs=meta["pairs"], train_pairs=int(train.sum()), val_pairs=int(val.sum()),
                  episodes=len(meta["episodes"]), init_std=args.init_std, epochs=args.epochs, lr=args.lr)
    (args.out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "history"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
