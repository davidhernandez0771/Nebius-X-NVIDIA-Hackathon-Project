"""Pure helpers for the IK-lag options (sprint 2, T2 Task 2). No Isaac imports, so they test without the sim.

Options, each measured in docs/superpowers/notes/2026-10-15-t2-status.md:
- lookahead: command the pose `lookahead` steps ahead (clamped to the last sample); the gripper stays on step k.
- ik_iters: damped-least-squares iterations on the linearized task (same Jacobian; FK can't be re-evaluated
  without stepping physics).
- gate_tol: hold a gripper change (keep commanding that pose with the old gripper value) until the TCP is
  within gate_tol of it, at most gate_max_s. The held steps are added to the executed trajectory.
- vel_ff: also send joint velocity targets (the commanded twist mapped through the Jacobian), so the
  joint PD drive's damping stops pulling the arm behind a moving target.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass

import numpy as np
import torch

CONTROL_DT = 0.02


@dataclass(frozen=True)
class TrackingOptions:
    lookahead: int = 0
    ik_iters: int = 1
    gate_tol: float | None = None  # m
    gate_max_s: float = 0.5
    vel_ff: bool = True  # measured best: 26.8 -> 2.1 mm mean TCP error, demo unchanged

    def __post_init__(self) -> None:
        if self.lookahead < 0:
            raise ValueError(f"lookahead must be >= 0, got {self.lookahead}")
        if self.ik_iters < 1:
            raise ValueError(f"ik_iters must be >= 1, got {self.ik_iters}")
        if self.gate_tol is not None and self.gate_tol <= 0:
            raise ValueError(f"gate_tol must be > 0, got {self.gate_tol}")
        if self.gate_max_s < 0:
            raise ValueError(f"gate_max_s must be >= 0, got {self.gate_max_s}")

    @property
    def residual_is_reach_signal(self) -> bool:
        """With feedforward the TCP tracks within ~8 mm, so a residual > 2 cm for > 1 s means out of reach.
        Without it the drive lag alone exceeds that, so `unreachable` is not checked."""
        return self.vel_ff

    @property
    def gate_max_steps(self) -> int:
        return math.ceil(self.gate_max_s / CONTROL_DT - 1e-9)


def add_tracking_args(parser) -> None:
    """CLI flags for every TrackingOptions field; the defaults are TrackingOptions()'s."""
    d = TrackingOptions()
    parser.add_argument("--lookahead", type=int, default=d.lookahead, help="command the pose N steps ahead")
    parser.add_argument("--ik-iters", type=int, default=d.ik_iters, help="DLS iterations per physics substep")
    parser.add_argument("--gate-mm", type=float, default=(d.gate_tol or 0.0) * 1000,
                        help="hold gripper changes until the TCP is within this many mm (0 = off)")
    parser.add_argument("--gate-max-s", type=float, default=d.gate_max_s, help="longest gate hold, s")
    parser.add_argument("--vel-ff", action=argparse.BooleanOptionalAction, default=d.vel_ff,
                        help="joint velocity feedforward")


def options_from_args(args) -> TrackingOptions:
    return TrackingOptions(
        lookahead=args.lookahead,
        ik_iters=args.ik_iters,
        gate_tol=args.gate_mm / 1000 if args.gate_mm > 0 else None,
        gate_max_s=args.gate_max_s,
        vel_ff=args.vel_ff,
    )


def lookahead_index(k: int, n: int, lookahead: int) -> int:
    return min(k + lookahead, n - 1)


def gate_hold(gripper_prev: int, gripper_now: int, *, err: float, waited_steps: int, opts: TrackingOptions) -> bool:
    """True: delay this step's gripper change by one more control step."""
    if opts.gate_tol is None or gripper_prev == gripper_now:
        return False
    return err >= opts.gate_tol and waited_steps < opts.gate_max_steps


def dls_iterate(jacobian: torch.Tensor, error: torch.Tensor, lam: float, iters: int) -> torch.Tensor:
    """Joint delta [N, J] for task error [N, M] by `iters` damped-least-squares steps on J dq = e."""
    jt = jacobian.transpose(1, 2)
    eye = torch.eye(jacobian.shape[1], dtype=jacobian.dtype, device=jacobian.device)
    solve = jt @ torch.inverse(jacobian @ jt + lam**2 * eye)
    dq = torch.zeros(jacobian.shape[0], jacobian.shape[2], dtype=jacobian.dtype, device=jacobian.device)
    for _ in range(iters):
        residual = error - (jacobian @ dq.unsqueeze(-1)).squeeze(-1)
        dq = dq + (solve @ residual.unsqueeze(-1)).squeeze(-1)
    return dq


def tracking_stats(cmd_pos: np.ndarray, tcp_pos: np.ndarray, gripper: np.ndarray) -> dict[str, float | None]:
    """TCP-vs-commanded error in mm: mean, max, and at the first close / last open command."""
    err = np.linalg.norm(np.asarray(tcp_pos) - np.asarray(cmd_pos), axis=1) * 1000.0
    g = np.asarray(gripper).astype(int)
    closes = np.flatnonzero(np.diff(g) == 1) + 1
    opens = np.flatnonzero(np.diff(g) == -1) + 1
    return {
        "mean_mm": float(err.mean()),
        "max_mm": float(err.max()),
        "close_mm": float(err[closes[0]]) if closes.size else None,
        "open_mm": float(err[opens[-1]]) if opens.size else None,
    }
