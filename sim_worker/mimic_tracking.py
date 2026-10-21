"""SANT's arm tracking as an Isaac Lab action term, for the Mimic env (sim_worker/mimic_env_cfg.py).

Isaac Lab's absolute DifferentialInverseKinematicsAction recomputes damped-least-squares IK every physics substep,
as SANT's replay does, but leaves the joint velocity target at zero: the high-PD drive's damping then drags the arm
behind a moving target. The first Mimic smoke test measured it: the tool ran 3 cm behind the commanded path.
SANT's replay also sends the commanded twist through the Jacobian as joint velocity targets (sim_worker.tracking:
vel_ff, measured 26.8 -> 2.1 mm mean tool error). This term adds that to Isaac Lab's.

The one difference from replay: replay knows the next command and feeds forward the twist from this step to the
next; an env action only knows this one, so the twist is the previous command to this one (one step later, the
same for a smooth path). Mimic's bridges and jumps are clamped to max_ff_speed / max_ff_ang_speed so a jump never
becomes a violent velocity target. It imports Isaac Lab's IK action (which imports USD), so only gym's env
creation loads it, after Isaac Sim is up: the config names it by string.
"""

from __future__ import annotations

from collections.abc import Sequence

import torch

from isaaclab.envs.mdp.actions.task_space_actions import DifferentialInverseKinematicsAction
from isaaclab.utils.math import compute_pose_error

from .tracking import dls_iterate

_EPS = 1e-9


def feedforward_joint_vel(prev: torch.Tensor, cmd: torch.Tensor, valid: torch.Tensor, jacobian: torch.Tensor, *,
                          dt: float, lam: float, max_lin: float, max_ang: float) -> torch.Tensor:
    """Joint velocities [N, J] that move the tool from `prev` to `cmd` (poses [N, 7]: position, xyzw) in one step
    of `dt`, through the task Jacobian [N, 6, J], as sim_worker.replay._joint_vel_ff does. The twist is scaled down
    to max_lin (m/s) and max_ang (rad/s); environments without a previous command (`valid` False) get none."""
    pos_err, rot_err = compute_pose_error(prev[:, :3], prev[:, 3:7], cmd[:, :3], cmd[:, 3:7])
    lin, ang = pos_err / dt, rot_err / dt
    one = torch.ones(lin.shape[0], dtype=lin.dtype, device=lin.device)
    scale = torch.minimum(one, torch.minimum(max_lin / torch.linalg.norm(lin, dim=1).clamp_min(_EPS),
                                             max_ang / torch.linalg.norm(ang, dim=1).clamp_min(_EPS)))
    twist = torch.cat([lin, ang], dim=1) * scale[:, None]
    dq = dls_iterate(jacobian, twist, lam, 1)
    return torch.where(valid[:, None], dq, torch.zeros_like(dq))


class SantTrackingIKAction(DifferentialInverseKinematicsAction):
    """Isaac Lab's absolute IK action, plus SANT's joint velocity feed-forward (cfg.vel_ff)."""

    def __init__(self, cfg, env):
        super().__init__(cfg, env)
        self._prev_cmd = torch.zeros(self.num_envs, 7, device=self.device)
        self._prev_valid = torch.zeros(self.num_envs, dtype=torch.bool, device=self.device)
        n = self._num_joints
        self._joint_vel = torch.zeros(self.num_envs, n, device=self.device)

    def process_actions(self, actions: torch.Tensor):
        super().process_actions(actions)
        self._update_feedforward()

    def _update_feedforward(self) -> None:
        cmd = self.processed_actions[:, :7]
        if self.cfg.vel_ff:
            lam = float((self.cfg.controller.ik_params or {}).get("lambda_val", 0.01))
            self._joint_vel[:] = feedforward_joint_vel(
                self._prev_cmd, cmd, self._prev_valid, self._compute_frame_jacobian(), dt=self._env.step_dt, lam=lam,
                max_lin=self.cfg.max_ff_speed, max_ang=self.cfg.max_ff_ang_speed,
            )
        self._prev_cmd[:] = cmd
        self._prev_valid[:] = True

    def apply_actions(self):
        super().apply_actions()
        if self.cfg.vel_ff:
            self._asset.set_joint_velocity_target_index(target=self._joint_vel, joint_ids=self._joint_ids)

    def reset(self, env_ids: Sequence[int] | None = None) -> None:
        super().reset(env_ids)
        ids = slice(None) if env_ids is None else env_ids
        self._prev_valid[ids] = False
        self._joint_vel[ids] = 0.0
