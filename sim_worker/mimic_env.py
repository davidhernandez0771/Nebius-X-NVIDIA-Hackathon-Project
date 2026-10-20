"""SANT's pick-place as an Isaac Lab Mimic env, SANT-PickPlace-Franka-IK-Abs-Mimic-v0: the env class.

The config, the observation terms, the success term and the reset are sim_worker/mimic_env_cfg.py. This module
imports ManagerBasedRLMimicEnv, which imports USD, so gym loads it only when it makes the env, after Isaac Sim is up
(sim_worker/mimic_register.py's entry point). Isaac Lab 3.0 quaternions are (x, y, z, w).
"""

from __future__ import annotations

from collections.abc import Sequence

import torch

import isaaclab.utils.math as PoseUtils
from isaaclab.envs import ManagerBasedRLMimicEnv

from demo_pipeline import mimic

from .mimic_env_cfg import bin_frame

class SantPickPlaceMimicEnv(ManagerBasedRLMimicEnv):
    """The Mimic API on SANT's pick-place: one eef, absolute tool-pose actions, the cube and the bin as objects."""

    def get_robot_eef_pose(self, eef_name: str, env_ids: Sequence[int] | None = None) -> torch.Tensor:
        """The tool pose [len(env_ids), 4, 4], env frame (the frame the IK drives)."""
        if env_ids is None:
            env_ids = slice(None)
        pos = self.obs_buf["policy"]["eef_pos"][env_ids]
        quat = self.obs_buf["policy"]["eef_quat"][env_ids]
        return PoseUtils.make_pose(pos, PoseUtils.matrix_from_quat(quat))

    def target_eef_pose_to_action(
        self,
        target_eef_pose_dict: dict,
        gripper_action_dict: dict,
        action_noise_dict: dict | None = None,
        env_id: int = 0,
    ) -> torch.Tensor:
        """A 4x4 tool target and a gripper action -> [x, y, z, qx, qy, qz, qw, gripper]. Noise (if any) moves the
        target by a normal offset of that scale (m) and turns it by a random rotation of that scale (rad)."""
        (target,) = target_eef_pose_dict.values()
        pos, rot = PoseUtils.unmake_pose(target)
        if action_noise_dict is not None:
            scale = float(action_noise_dict[mimic.EEF])
            pos = pos + scale * torch.randn_like(pos)
            turn = scale * torch.randn(3, device=rot.device, dtype=rot.dtype)
            angle = torch.linalg.norm(turn)
            if angle > 0:
                rot = PoseUtils.matrix_from_quat(PoseUtils.quat_from_angle_axis(angle, turn / angle)) @ rot
        (gripper,) = gripper_action_dict.values()
        return torch.cat([pos, PoseUtils.quat_from_matrix(rot), gripper], dim=0)

    def action_to_target_eef_pose(self, action: torch.Tensor) -> dict[str, torch.Tensor]:
        """[num_envs, 8] actions -> the 4x4 tool targets they ask for."""
        rot = PoseUtils.matrix_from_quat(action[:, 3:7])
        return {mimic.EEF: PoseUtils.make_pose(action[:, :3], rot).clone()}

    def actions_to_gripper_actions(self, actions: torch.Tensor) -> dict[str, torch.Tensor]:
        """The gripper column of a demo's actions [steps, 8] -> [steps, 1]."""
        return {mimic.EEF: actions[:, -1:]}

    def get_object_poses(self, env_ids: Sequence[int] | None = None) -> dict[str, torch.Tensor]:
        """The cube and the bin frame as 4x4 poses, env frame. The base class would list every rigid object; SANT's
        bin is five boxes, and Mimic's subtasks refer to the bin as one frame."""
        if env_ids is None:
            env_ids = slice(None)
        cube = self.scene["cube"].data
        bin_pos, bin_quat = bin_frame(self)
        return {
            "cube": PoseUtils.make_pose(
                (cube.root_pos_w.torch - self.scene.env_origins)[env_ids], PoseUtils.matrix_from_quat(cube.root_quat_w.torch[env_ids])
            ),
            "bin": PoseUtils.make_pose(bin_pos[env_ids], PoseUtils.matrix_from_quat(bin_quat[env_ids])),
        }

    def get_subtask_term_signals(self, env_ids: Sequence[int] | None = None) -> dict[str, torch.Tensor]:
        """grasp: the cube held a centimetre up (for annotate_demos --auto; the place subtask runs to the end)."""
        if env_ids is None:
            env_ids = slice(None)
        return {"grasp": self.obs_buf["subtask_terms"]["grasp"][env_ids]}
