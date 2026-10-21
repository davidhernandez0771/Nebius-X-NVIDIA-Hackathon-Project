"""The RL teacher's arm action as an Isaac Lab action term (sim_worker/rl_env_cfg.py names it by string).

The policy outputs 4 numbers in [-1, 1] for the arm (a step in x, y, z, yaw from the tool's current pose:
demo_pipeline.rl_teacher.action_to_target makes it an absolute tool target, SANT's pointing-down gripper turned by
the yaw; held at or above the record-time
soft floor, demo_pipeline.soft_floor, as the sim worker holds every teleop target), and SANT's tracking IK
(sim_worker.mimic_tracking.SantTrackingIKAction: Isaac Lab's absolute damped-least-squares IK on the tool centre,
plus the joint velocity feed-forward SANT's replay uses) drives the arm there. So every teacher action is a
Trajectory step in SANT's own terms, and its rollouts replay in SANT's eval env like any demo.

The base class sizes its buffers for its 7-number pose command; this term keeps them, takes 4 numbers from the
action manager, and fills the pose itself.
"""

from __future__ import annotations

from collections.abc import Sequence

import torch

from demo_pipeline import rl_teacher as rt

from isaaclab.envs.mdp.actions.binary_joint_actions import BinaryJointPositionAction

from .mimic_env_cfg import bin_frame, tcp_pos, tcp_quat
from .mimic_tracking import SantTrackingIKAction

ARM_DIM = 4


class SantTcpTargetAction(SantTrackingIKAction):
    """x, y, z, yaw in [-1, 1] -> an absolute tool pose for SANT's tracking IK."""

    def __init__(self, cfg, env):
        self._tcp_ready = False  # the base sizes its pose buffers while action_dim is still its own (7)
        super().__init__(cfg, env)
        self._policy_raw = torch.zeros(self.num_envs, ARM_DIM, device=self.device)
        # the previous target, for the speed cap (rl_teacher.cap_speed); after a reset the tool's own pose
        self._cap_prev_pos = torch.zeros(self.num_envs, 3, device=self.device)
        self._cap_prev_yaw = torch.zeros(self.num_envs, device=self.device)
        self._cap_prev_valid = torch.zeros(self.num_envs, dtype=torch.bool, device=self.device)
        self._tcp_ready = True

    @property
    def action_dim(self) -> int:
        return ARM_DIM if getattr(self, "_tcp_ready", False) else super().action_dim

    @property
    def raw_actions(self) -> torch.Tensor:
        return self._policy_raw if getattr(self, "_tcp_ready", False) else self._raw_actions

    def tcp_command(self) -> torch.Tensor:
        """The absolute tool pose commanded this step, [N, 7] (x, y, z, then x y z w): the teacher's Trajectory."""
        return self._processed_actions[:, :7]

    def process_actions(self, actions: torch.Tensor):
        self._policy_raw[:] = actions
        grip = torch.zeros_like(actions[:, :1])  # the gripper is its own term
        tcp_q = tcp_quat(self._env)[:, [3, 0, 1, 2]]  # x y z w -> w x y z
        tcp, tcp_yaw = tcp_pos(self._env), rt.tool_yaw(tcp_q)
        valid = self._cap_prev_valid[:, None]
        prev_pos = torch.where(valid, self._cap_prev_pos, tcp)
        prev_yaw = torch.where(self._cap_prev_valid, self._cap_prev_yaw, tcp_yaw)
        pos, quat_wxyz, _ = rt.action_to_target(torch.cat([actions, grip], dim=-1), tcp, tcp_yaw, prev_pos, prev_yaw,
                                                float(getattr(self.cfg, "v_max", 0.0) or 0.0),
                                                float(getattr(self.cfg, "yaw_rate_max", 0.0) or 0.0))
        bin_pos, q = bin_frame(self._env)  # x y z w
        bin_yaw = torch.atan2(2 * (q[:, 3] * q[:, 2] + q[:, 0] * q[:, 1]), 1 - 2 * (q[:, 1] ** 2 + q[:, 2] ** 2))
        pos = rt.clamp_to_soft_floor(pos, bin_pos, bin_yaw)  # as the sim worker holds teleop targets
        self._cap_prev_pos[:] = pos
        self._cap_prev_yaw[:] = rt.tool_yaw(quat_wxyz)
        self._cap_prev_valid[:] = True
        pose = torch.cat([pos, quat_wxyz[:, [1, 2, 3, 0]]], dim=-1).to(self._raw_actions.dtype)  # Isaac Lab 3.0: xyzw
        self._raw_actions[:] = pose
        self._processed_actions[:] = pose
        ee_pos_curr, ee_quat_curr = self._compute_frame_pose()
        self._ik_controller.set_command(self._processed_actions, ee_pos_curr, ee_quat_curr)
        self._update_feedforward()

    def reset(self, env_ids: Sequence[int] | None = None) -> None:
        super().reset(env_ids)
        ids = slice(None) if env_ids is None else env_ids
        self._policy_raw[ids] = 0.0
        self._cap_prev_valid[ids] = False


class SantGraceGripperAction(BinaryJointPositionAction):
    """Isaac Lab's binary gripper, closed whatever the policy says while the env's held-start grace runs
    (env._sant_rl_grace, set by rl_env_cfg.reset_rl_scene for starts that hold the cube; counted down here, once per
    control step), and with an optional deadband (cfg.deadband, rl_teacher.gripper_closed): the gripper switches only
    when the policy's output crosses +-deadband. With neither it is Isaac Lab's term unchanged."""

    def __init__(self, cfg, env):
        super().__init__(cfg, env)
        self._closed_state = torch.zeros(self.num_envs, dtype=torch.bool, device=self.device)

    def process_actions(self, actions: torch.Tensor):
        actions = actions.clone()
        grace = getattr(self._env, "_sant_rl_grace", None)
        if grace is not None:
            actions[:, 0] = rt.grace_gripper(actions[:, 0], grace)
            grace.sub_(1).clamp_(min=0)
        deadband = float(getattr(self.cfg, "deadband", 0.0) or 0.0)
        if deadband > 0:
            closed = rt.gripper_closed(actions[:, 0], self._closed_state, deadband)
            actions[:, 0] = torch.where(closed, -1.0, 1.0)
        self._closed_state = actions[:, 0] < 0
        super().process_actions(actions)

    def reset(self, env_ids: Sequence[int] | None = None) -> None:
        super().reset(env_ids)
        self._closed_state[slice(None) if env_ids is None else env_ids] = False
