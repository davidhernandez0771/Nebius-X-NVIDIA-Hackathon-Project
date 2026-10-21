"""A copy of an rsl_rl checkpoint with the actor's Gaussian std set (Isaac Lab's Python, CPU): resuming loads the
checkpoint's std, so the trainer's init_std can't change it.

    C:\\isaac\\env_isaaclab\\Scripts\\python.exe scripts\\rl_checkpoint_std.py --checkpoint <run>\\model_1499.pt \\
        --std 0.3 --out data\\rl\\resume\\v6_std03\\model_1499.pt [--dims 0 1 2 3]

--dims: the action dimensions to set (default the four motion ones; the gripper's is kept). Everything else
(weights, normalisers, critic, optimizer state, iteration) is copied unchanged.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

KEY = "distribution.std_param"


def set_std(ck: dict, std: float, dims: list[int]) -> dict:
    """The checkpoint dict with the actor's std set on dims (a shallow copy; the std tensor is new)."""
    actor = dict(ck["actor_state_dict"])
    if KEY not in actor:
        raise KeyError(f"no {KEY} in the actor (std_type 'log' is not handled)")
    s = actor[KEY].clone()
    s[dims] = std
    actor[KEY] = s
    return {**ck, "actor_state_dict": actor}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--std", type=float, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--dims", type=int, nargs="+", default=[0, 1, 2, 3])
    args = p.parse_args(argv)
    import torch

    ck = torch.load(args.checkpoint, weights_only=False, map_location="cpu")
    before = ck["actor_state_dict"][KEY].tolist()
    out = set_std(ck, args.std, args.dims)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(out, args.out)
    print(f"std {[round(v, 4) for v in before]} -> {[round(v, 4) for v in out['actor_state_dict'][KEY].tolist()]}; "
          f"iteration {out['iter']}; {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
