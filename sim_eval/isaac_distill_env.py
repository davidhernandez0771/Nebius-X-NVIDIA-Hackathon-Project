"""The eval env with what distillation needs (sim_eval.distill.DistillEnv): the teacher's privileged state, the
teacher's own way of executing its command, and the IK that turns its command into the student's 9-joint target.
Isaac only.

Same rules as sim_eval.isaac_env: construct inside launch_simulation, once per process. The scene, cameras, physics
and start pose are IsaacEvalEnv's.

- step(action): the student's 9-joint position target held for the DECIMATION physics steps, as at test time; the
  arm's velocity targets are zero, as in the eval env.
- step_teacher(action): the teacher's tool target executed exactly as in T3's RL env (pm/rl-teacher,
  sim_worker/rl_action.py): Isaac Lab's absolute damped-least-squares IK on the tool frame (panda_hand + the TCP offset)
  re-solved at every physics substep, plus SANT's joint velocity feed-forward from the previous teacher command
  (sim_eval.teacher_ik, the same formulas). So the teacher gate measures the teacher in our scene, not a different
  controller. After a student step the feed-forward restarts (no previous teacher command), as after a reset.
  It returns the record and the round-0 label: the last substep's arm target + the finger targets, which is what
  replay.py's _physics_step returns and every human/SANT episode records as `action`.
- ik_label(action): one damped-least-squares step from the observed state toward the teacher's tool target (the first
  substep's position target in step_teacher): the DAgger label, where no teacher step is executed.
The IK arithmetic runs in numpy (one env, 6x7 matrices): sim_eval.teacher_ik, tested against finite differences.
"""

from __future__ import annotations

import numpy as np
import torch

from isaaclab.managers import SceneEntityCfg
from isaaclab.utils.math import matrix_from_quat, quat_apply, quat_inv, subtract_frame_transforms

from demo_pipeline.schemas import Scene
from sim_eval.isaac_env import IsaacEvalEnv, _max_pair_force
from sim_eval.teacher import TeacherAction, TeacherState
from sim_eval.teacher_ik import TeacherTracker, ik_target, tool_jacobian, tool_pose
from sim_worker.replay import CONTACT_N, DECIMATION, PHYSICS_DT, TCP_OFFSET
from sim_worker.robots import finger_targets, robot_spec


def _wxyz(q_xyzw) -> np.ndarray:
    q = np.asarray(q_xyzw, dtype=np.float64)
    return np.array([q[3], q[0], q[1], q[2]])


def _xyzw(q_wxyz) -> list[float]:
    w, x, y, z = q_wxyz
    return [x, y, z, w]


class IsaacDistillEnv(IsaacEvalEnv):
    def __init__(self, cameras: bool, device: str = "cuda:0", start_joint_pos=None, start_poses=None):
        super().__init__(cameras=cameras, device=device, start_joint_pos=start_joint_pos, start_poses=start_poses)
        self.spec = robot_spec("franka")
        if self.spec.ik_limit_gain != 0:
            raise RuntimeError("the teacher's env uses no joint-limit avoidance; teacher_ik has none either")
        robot = self.scene["robot"]
        self.arm = SceneEntityCfg("robot", joint_names=[self.spec.arm_joints], body_names=[self.spec.hand_body])
        self.arm.resolve(self.scene)
        self.arm_ids = list(self.arm.joint_ids)
        self.finger_ids = [robot.joint_names.index(j) for j in self.spec.finger_joints]
        self.jacobi_idx = self.arm.body_ids[0] - 1 if robot.is_fixed_base else self.arm.body_ids[0]
        self.jacobi_joint_ids = [j + robot.num_base_dofs for j in self.arm_ids]
        self.offset = np.array([0.0, 0.0, TCP_OFFSET])
        self.tracker = TeacherTracker()
        self._zero_vel = torch.zeros(1, len(self.arm_ids), device=self.sim.device)

    def reset(self, scene: Scene) -> None:
        super().reset(scene)
        self.tracker.reset()

    # -- the arm in the root frame, as Isaac Lab's DifferentialInverseKinematicsAction sees it ----------------------

    def _arm(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """(arm joints [7], tool position, tool quat wxyz, tool Jacobian [6, 7]), root frame."""
        robot = self.scene["robot"]
        root_pos, root_q = robot.data.root_pos_w.torch, robot.data.root_quat_w.torch
        hand_w = robot.data.body_pose_w.torch[:, self.arm.body_ids[0]]
        pos_b, quat_b = subtract_frame_transforms(root_pos, root_q, hand_w[:, 0:3], hand_w[:, 3:7])
        jac = robot.data.body_link_jacobian_w.torch[:, self.jacobi_idx, :, self.jacobi_joint_ids].clone()
        rot = matrix_from_quat(quat_inv(root_q))
        jac[:, :3] = torch.bmm(rot, jac[:, :3])
        jac[:, 3:] = torch.bmm(rot, jac[:, 3:])
        hand_pos, hand_q = pos_b[0].cpu().numpy().astype(np.float64), _wxyz(quat_b[0].cpu().numpy())
        tool_p, tool_q = tool_pose(hand_pos, hand_q, self.offset)
        j_tool = tool_jacobian(jac[0].cpu().numpy().astype(np.float64), hand_q, self.offset)
        q = robot.data.joint_pos.torch[0, self.arm_ids].cpu().numpy().astype(np.float64)
        return q, tool_p, tool_q, j_tool

    def _target_b(self, action: TeacherAction) -> tuple[np.ndarray, np.ndarray]:
        """The teacher's tool target (env frame) in the robot root frame."""
        sc, robot, dev = self.scene, self.scene["robot"], self.sim.device
        p_w = torch.tensor([np.asarray(action.ee_pos, dtype=np.float64)], dtype=torch.float32, device=dev)
        q_w = torch.tensor([_xyzw(action.ee_quat_wxyz)], dtype=torch.float32, device=dev)
        pos_b, quat_b = subtract_frame_transforms(robot.data.root_pos_w.torch, robot.data.root_quat_w.torch,
                                                  p_w + sc.env_origins[0], q_w)
        return pos_b[0].cpu().numpy().astype(np.float64), _wxyz(quat_b[0].cpu().numpy())

    def _fingers(self, gripper: int) -> torch.Tensor:
        return torch.tensor([finger_targets(self.spec, bool(gripper))], dtype=torch.float32, device=self.sim.device)

    # -- DistillEnv -------------------------------------------------------------------------------------------------

    def _apply(self, joint_targets: np.ndarray) -> None:
        """The student's (and the warm-up's) held 9-joint target, with zero arm velocity targets as in the eval env."""
        self.scene["robot"].set_joint_velocity_target_index(target=self._zero_vel, joint_ids=self.arm_ids)
        super()._apply(joint_targets)

    def step(self, action: np.ndarray):
        self.tracker.reset()  # a teacher step after a student step has no previous teacher command
        return super().step(action)

    def step_teacher(self, action: TeacherAction):
        robot, dev = self.scene["robot"], self.sim.device
        tgt_p, tgt_q = self._target_b(action)
        _, _, _, j_tool = self._arm()
        ff = torch.tensor(self.tracker.command(tgt_p, tgt_q, j_tool)[None], dtype=torch.float32, device=dev)
        fingers = self._fingers(action.gripper)
        last = None
        for _ in range(DECIMATION):
            q, tool_p, tool_q, j_tool = self._arm()
            last = ik_target(q, j_tool, tool_p, tool_q, tgt_p, tgt_q)
            arm = torch.tensor(last[None], dtype=torch.float32, device=dev)
            robot.set_joint_position_target_index(target=arm, joint_ids=self.arm_ids)
            robot.set_joint_velocity_target_index(target=ff, joint_ids=self.arm_ids)
            robot.set_joint_position_target_index(target=fingers, joint_ids=self.finger_ids)
            self.scene.write_data_to_sim()
            self.sim.step()
            self.scene.update(PHYSICS_DT)
        # The label replay.py would record: the joints now, with the arm at the last substep's IK target and the
        # fingers at their command (replay's _physics_step returns exactly this).
        full = self.scene["robot"].data.joint_pos.torch[0].cpu().numpy().astype(np.float64)
        full[self.arm_ids] = last
        full[self.finger_ids] = finger_targets(self.spec, bool(action.gripper))
        return self._record(int(action.gripper)), full

    def ik_label(self, action: TeacherAction) -> np.ndarray:
        tgt_p, tgt_q = self._target_b(action)
        q, tool_p, tool_q, j_tool = self._arm()
        full = self.scene["robot"].data.joint_pos.torch[0].cpu().numpy().astype(np.float64)
        full[self.arm_ids] = ik_target(q, j_tool, tool_p, tool_q, tgt_p, tgt_q)
        full[self.finger_ids] = finger_targets(self.spec, bool(action.gripper))
        return full

    def _tcp(self) -> tuple[np.ndarray, np.ndarray]:
        sc, robot = self.scene, self.scene["robot"]
        hand = robot.data.body_pose_w.torch[:, self.hand_id]
        offset = torch.tensor([[0.0, 0.0, TCP_OFFSET]], device=self.sim.device)
        tcp = (hand[:, 0:3] + quat_apply(hand[:, 3:7], offset) - sc.env_origins[0])[0].cpu().numpy()
        return tcp.astype(np.float64), _wxyz(hand[0, 3:7].cpu().numpy())

    def teacher_state(self, scene: Scene, k: int, gripper: int) -> TeacherState:
        sc, robot = self.scene, self.scene["robot"]
        origin = sc.env_origins[0]
        cube = sc["cube"].data
        tcp, tq = self._tcp()
        return TeacherState(
            seed=scene.seed, k=k,
            joint_pos=robot.data.joint_pos.torch[0].cpu().numpy().astype(np.float64),
            joint_vel=robot.data.joint_vel.torch[0].cpu().numpy().astype(np.float64),
            tcp_pos=tcp, tcp_quat_wxyz=tq, gripper=int(gripper),
            cube_pos=(cube.root_pos_w.torch[0] - origin).cpu().numpy().astype(np.float64),
            cube_quat_wxyz=_wxyz(cube.root_quat_w.torch[0].cpu().numpy()),
            cube_lin_vel=cube.root_lin_vel_w.torch[0].cpu().numpy().astype(np.float64),
            bin_pos=np.asarray(scene.bin_pose.pos, dtype=np.float64),
            bin_quat_wxyz=np.asarray(scene.bin_pose.quat_wxyz, dtype=np.float64),
            contact_gripper_cube=_max_pair_force(sc["cube_contact"]) > CONTACT_N,
        )
