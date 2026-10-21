"""The eval env with what distillation needs (sim_eval.distill.DistillEnv): the teacher's privileged state, and the IK
that turns its tool target into the student's 9-joint target. Isaac only; never run before 2026-10-21 (code only).

Same rules as sim_eval.isaac_env: construct inside launch_simulation, once per process. The scene, cameras, physics,
start pose and stepping are IsaacEvalEnv's, so a teacher rollout is executed exactly as the student will be at test
time: one 9-joint target per control step, held for the DECIMATION physics steps.

ik_label: one damped-least-squares step (Isaac Lab's DifferentialIKController, "dls", the arm's joint-limit gain) from
the current joints toward the tool target, the same controller replay.py records the training episodes' `action`
with; replay re-solves at each of the 2 physics substeps, here it is solved once per control step and held, as the
student's action is. Fingers: finger_targets(open/closed).
"""

from __future__ import annotations

import numpy as np
import torch

from isaaclab.controllers import DifferentialIKController, DifferentialIKControllerCfg
from isaaclab.managers import SceneEntityCfg
from isaaclab.utils.math import quat_apply, subtract_frame_transforms

from demo_pipeline.schemas import Scene
from sim_eval.isaac_env import IsaacEvalEnv, _max_pair_force
from sim_eval.teacher import TeacherAction, TeacherState
from sim_worker.replay import CONTACT_N, TCP_OFFSET
from sim_worker.robots import finger_targets, hand_from_tool, robot_spec


def _xyzw(q_wxyz) -> list[float]:
    w, x, y, z = q_wxyz
    return [x, y, z, w]


class IsaacDistillEnv(IsaacEvalEnv):
    def __init__(self, cameras: bool, device: str = "cuda:0", start_joint_pos=None, start_poses=None):
        super().__init__(cameras=cameras, device=device, start_joint_pos=start_joint_pos, start_poses=start_poses)
        self.spec = robot_spec("franka")
        robot = self.scene["robot"]
        self.arm = SceneEntityCfg("robot", joint_names=[self.spec.arm_joints], body_names=[self.spec.hand_body])
        self.arm.resolve(self.scene)
        self.ik = DifferentialIKController(
            DifferentialIKControllerCfg(command_type="pose", use_relative_mode=False, ik_method="dls",
                                        joint_limit_avoidance_gain=self.spec.ik_limit_gain),
            num_envs=self.scene.num_envs, device=self.sim.device)
        if self.spec.ik_limit_gain > 0:
            limits = robot.data.joint_pos_limits.torch[0, self.arm.joint_ids]
            self.ik.set_joint_pos_limits(limits[:, 0], limits[:, 1])
        self.finger_ids = [robot.joint_names.index(j) for j in self.spec.finger_joints]
        self.jacobi_idx = self.arm.body_ids[0] - 1 if robot.is_fixed_base else self.arm.body_ids[0]

    def reset(self, scene: Scene) -> None:
        super().reset(scene)
        self.ik.reset()

    # -- DistillEnv -------------------------------------------------------------------------------------------------

    def _tcp(self) -> tuple[np.ndarray, np.ndarray]:
        sc, robot = self.scene, self.scene["robot"]
        hand = robot.data.body_pose_w.torch[:, self.hand_id]
        offset = torch.tensor([[0.0, 0.0, TCP_OFFSET]], device=self.sim.device)
        tcp = (hand[:, 0:3] + quat_apply(hand[:, 3:7], offset) - sc.env_origins[0])[0].cpu().numpy()
        q = hand[0, 3:7].cpu().numpy()  # xyzw
        return tcp.astype(np.float64), np.array([q[3], q[0], q[1], q[2]], dtype=np.float64)

    def teacher_state(self, scene: Scene, k: int, gripper: int) -> TeacherState:
        sc, robot = self.scene, self.scene["robot"]
        origin = sc.env_origins[0]
        cube = sc["cube"].data
        tcp, tq = self._tcp()
        cq = cube.root_quat_w.torch[0].cpu().numpy().astype(np.float64)  # xyzw
        return TeacherState(
            seed=scene.seed, k=k,
            joint_pos=robot.data.joint_pos.torch[0].cpu().numpy().astype(np.float64),
            joint_vel=robot.data.joint_vel.torch[0].cpu().numpy().astype(np.float64),
            tcp_pos=tcp, tcp_quat_wxyz=tq, gripper=int(gripper),
            cube_pos=(cube.root_pos_w.torch[0] - origin).cpu().numpy().astype(np.float64),
            cube_quat_wxyz=np.array([cq[3], cq[0], cq[1], cq[2]]),
            cube_lin_vel=cube.root_lin_vel_w.torch[0].cpu().numpy().astype(np.float64),
            bin_pos=np.asarray(scene.bin_pose.pos, dtype=np.float64),
            bin_quat_wxyz=np.asarray(scene.bin_pose.quat_wxyz, dtype=np.float64),
            contact_gripper_cube=_max_pair_force(sc["cube_contact"]) > CONTACT_N,
        )

    def ik_label(self, action: TeacherAction) -> np.ndarray:
        sc, robot, dev = self.scene, self.scene["robot"], self.sim.device
        hand_pos, hand_q = hand_from_tool(self.spec, action.ee_pos, action.ee_quat_wxyz)
        hand_w = torch.tensor([hand_pos], dtype=torch.float32, device=dev) + sc.env_origins[0]
        q = torch.tensor([_xyzw(hand_q)], dtype=torch.float32, device=dev)
        root = robot.data.root_pose_w.torch
        pos_b, quat_b = subtract_frame_transforms(root[:, 0:3], root[:, 3:7], hand_w, q)
        self.ik.set_command(torch.cat([pos_b, quat_b], dim=-1))
        jacobi_joint_ids = [j + robot.num_base_dofs for j in self.arm.joint_ids]
        jacobian = robot.data.body_link_jacobian_w.torch[:, self.jacobi_idx, :, jacobi_joint_ids]
        ee_w = robot.data.body_pose_w.torch[:, self.arm.body_ids[0]]
        ee_pos_b, ee_quat_b = subtract_frame_transforms(root[:, 0:3], root[:, 3:7], ee_w[:, 0:3], ee_w[:, 3:7])
        joint_pos = robot.data.joint_pos.torch[:, self.arm.joint_ids]
        arm_target = self.ik.compute(ee_pos_b, ee_quat_b, jacobian, joint_pos)
        full = robot.data.joint_pos.torch.clone()
        full[:, self.arm.joint_ids] = arm_target
        full[:, self.finger_ids] = torch.tensor([finger_targets(self.spec, bool(action.gripper))],
                                                dtype=torch.float32, device=dev)
        return full[0].cpu().numpy().astype(np.float64)
