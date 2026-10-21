"""Eval-time policy options. Every one is off by default, so a pre-registered eval runs exactly as before.

From the 2026-10-20 research note (docs/superpowers/notes/2026-10-20-research-cube-in-bin.md, Stage 0):
- --binarize-gripper: the finger targets become fully open or fully closed, thresholded at the labels' midpoint
  (20 mm). Every training label is 0 or 40 mm, but 48% of the mouse SANT policy's eval steps sent 5-35 mm, and under
  25 mm per finger the opening is narrower than the 5 cm cube. Applied on the eval side (sim_eval run_eval).
- --n-action-steps N: re-plan every N steps instead of running each 100-step ACT chunk open loop (2 s at 50 Hz).
- --temporal-ensemble COEF: ACT's temporal ensembling (exp(-COEF * i) weights; 0.01 in the ACT paper). It re-queries
  the policy every step, so it implies n_action_steps = 1.
The last two change the loaded policy's config, so they are applied by the policy server (lerobot_tools.policy_server),
which reports them in /health; run_eval refuses a server whose settings differ from what it was asked to run.

Stdlib + numpy only: the Isaac venv (run_eval, eval_cells) and the LeRobot venv (the server) both import it.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass

import numpy as np

FINGER_IDS = (7, 8)  # Franka joint order: panda_joint1..7, then the two fingers (as sim_eval.eval_policy)
GRIPPER_OPEN, GRIPPER_CLOSED = 0.04, 0.0  # finger targets (m), the only two values in the training labels
GRIPPER_THRESHOLD = (GRIPPER_OPEN + GRIPPER_CLOSED) / 2


@dataclass(frozen=True)
class InferenceOptions:
    binarize_gripper: bool = False
    n_action_steps: int | None = None  # None: the checkpoint's own (100 for our ACT runs)
    temporal_ensemble_coeff: float | None = None  # None: off

    def validate(self) -> InferenceOptions:
        if self.n_action_steps is not None and self.n_action_steps < 1:
            raise ValueError(f"--n-action-steps must be >= 1, got {self.n_action_steps}")
        if self.temporal_ensemble_coeff is not None:
            if self.temporal_ensemble_coeff < 0:
                raise ValueError(f"--temporal-ensemble must be >= 0, got {self.temporal_ensemble_coeff}")
            if self.n_action_steps not in (None, 1):
                raise ValueError(f"--temporal-ensemble re-queries every step: --n-action-steps must be 1 or unset, "
                                 f"got {self.n_action_steps}")
        return self

    @property
    def is_default(self) -> bool:
        return self == InferenceOptions()

    @property
    def effective_n_action_steps(self) -> int | None:
        return 1 if self.temporal_ensemble_coeff is not None else self.n_action_steps

    def record(self) -> dict:
        """What an eval's results, episode log and registry row record."""
        return asdict(self)

    def server_args(self) -> list[str]:
        """lerobot_tools.policy_server flags (the server applies these; binarizing is the eval's job)."""
        out = []
        if self.n_action_steps is not None:
            out += ["--n-action-steps", str(self.n_action_steps)]
        if self.temporal_ensemble_coeff is not None:
            out += ["--temporal-ensemble", repr(self.temporal_ensemble_coeff)]
        return out

    def run_eval_args(self) -> list[str]:
        """sim_eval/scripts/run_eval.py flags."""
        return (["--binarize-gripper"] if self.binarize_gripper else []) + self.server_args()

    @classmethod
    def from_args(cls, args: argparse.Namespace) -> InferenceOptions:
        return cls(binarize_gripper=bool(getattr(args, "binarize_gripper", False)),
                   n_action_steps=getattr(args, "n_action_steps", None),
                   temporal_ensemble_coeff=getattr(args, "temporal_ensemble", None)).validate()


def add_inference_args(parser: argparse.ArgumentParser, *, gripper: bool = True) -> None:
    """The flags, off by default. gripper=False for the policy server (binarizing is eval-side)."""
    if gripper:
        parser.add_argument("--binarize-gripper", action="store_true",
                            help=f"finger targets fully open/closed, thresholded at {GRIPPER_THRESHOLD * 1000:.0f} mm")
    parser.add_argument("--n-action-steps", type=int, default=None,
                        help="re-plan every N steps (default: the checkpoint's own, 100 for our ACT runs)")
    parser.add_argument("--temporal-ensemble", type=float, default=None, metavar="COEF",
                        help="ACT temporal ensembling coefficient, e.g. 0.01; re-queries every step")


def binarize_gripper(action: np.ndarray) -> np.ndarray:
    """A copy of `action` with both finger targets set to open (mean > threshold) or closed. The arm is untouched."""
    out = np.array(action, dtype=np.float64, copy=True).reshape(-1)
    fingers = float(np.mean(out[list(FINGER_IDS)]))
    out[list(FINGER_IDS)] = GRIPPER_OPEN if fingers > GRIPPER_THRESHOLD else GRIPPER_CLOSED
    return out


class GripperBinarizer:
    """Wraps a policy (anything with reset() and act(state, images)) and binarizes its finger targets."""

    def __init__(self, policy):
        self.policy = policy

    def reset(self) -> None:
        self.policy.reset()

    def act(self, state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray:
        return binarize_gripper(self.policy.act(state, images))


def apply_to_config(cfg, opts: InferenceOptions) -> dict:
    """Set the server-side options on a loaded LeRobot policy config (before the policy is built from it).
    Returns what was changed. These fields are execution settings, not weights."""
    opts.validate()
    changed = {}
    if opts.temporal_ensemble_coeff is not None:
        if not hasattr(cfg, "temporal_ensemble_coeff"):
            raise ValueError(f"a {getattr(cfg, 'type', '?')} policy has no temporal ensembling (ACT only)")
        cfg.temporal_ensemble_coeff = changed["temporal_ensemble_coeff"] = float(opts.temporal_ensemble_coeff)
    n = opts.effective_n_action_steps
    if n is not None:
        chunk = getattr(cfg, "chunk_size", None)
        if chunk is not None and n > chunk:
            raise ValueError(f"--n-action-steps {n} is more than the checkpoint's chunk_size {chunk}")
        cfg.n_action_steps = changed["n_action_steps"] = int(n)
    return dict(sorted(changed.items()))


def config_record(cfg, overrides: dict) -> dict:
    """The /health `inference` entry: the overrides and the settings the policy now runs with."""
    return {"overrides": overrides, "chunk_size": getattr(cfg, "chunk_size", None),
            "n_action_steps": getattr(cfg, "n_action_steps", None),
            "temporal_ensemble_coeff": getattr(cfg, "temporal_ensemble_coeff", None)}


def served_problems(opts: InferenceOptions, health: dict) -> list[str]:
    """Why a served policy doesn't run what this eval asked for (empty: it does)."""
    want = apply_to_config(_Blank(), opts)
    served = health.get("inference")
    if served is None:
        return [] if not want else [f"the policy server doesn't report its inference settings; this eval wants {want} "
                                    "(restart it from this checkout with the same flags)"]
    got = served.get("overrides") or {}
    if got != want:
        return [f"the policy server runs with inference overrides {got}, this eval asked for {want}; start the server "
                f"with the same --n-action-steps / --temporal-ensemble"]
    return []


class _Blank:
    """A config with every field, so served_problems can compute the overrides a request implies."""

    type = "act"
    chunk_size = None
    n_action_steps = None
    temporal_ensemble_coeff = None
