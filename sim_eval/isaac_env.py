"""Isaac Lab env for policy evaluation: the sim_worker pick-place scene, driven by 9-joint position targets.

Import and construct this only inside ``isaaclab.app.launch_simulation(make_sim_cfg(...), args)``, and only once
per process (one SimulationContext per process). Isaac Lab 3.0 poses are xyzw; everything returned here is wxyz.

This copies replay.py's scene placement and stepping on purpose: replay's helpers are private and T2 is changing
them. Only sim_worker's public names are imported (scene config, bin geometry, camera pose, physics constants),
so the physics, scene and cameras match what the training episodes were recorded with.
"""

from __future__ import annotations

import numpy as np
import torch

import isaaclab.sim as sim_utils
from isaaclab.managers import SceneEntityCfg
from isaaclab.utils import instantiate
from isaaclab.utils.math import quat_apply

from demo_pipeline.schemas import Scene
from sim_eval.eval_policy import FINGER_IDS, Observation, StepRecord, gripper_command
from sim_eval.start_state import FRANKA_DEFAULT_JOINT_POS
from sim_worker.replay import CAMERA_WARMUP_STEPS, CONTACT_N, DECIMATION, PHYSICS_DT, TCP_OFFSET, make_sim_cfg
from sim_worker.scene_cfg import ARM_CONTACT_SENSORS, BIN_INNER, BIN_PARTS, FRONT_EYE, FRONT_TARGET, make_scene_cfg


def _xyzw(q_wxyz) -> list[float]:
    w, x, y, z = q_wxyz
    return [x, y, z, w]


def _yaw_rotate(q_wxyz, v) -> np.ndarray:
    w, x, y, z = q_wxyz
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return rot @ np.asarray(v, dtype=float)


def _max_pair_force(sensor) -> float:
    hist = sensor.data.normal_force_matrix_w_history
    forces = hist.torch if hist is not None else sensor.data.normal_force_matrix_w.torch
    return float(torch.linalg.norm(forces, dim=-1).max().item())


class IsaacEvalEnv:
    bin_inner = BIN_INNER

    def __init__(self, cameras: bool, device: str = "cuda:0", start_joint_pos=None, start_poses=None):
        """start_joint_pos: 9 joint positions to reset to (sim_eval.start_state picks it); None = the asset default.
        start_poses: {scene seed: 9 joint positions} overriding it per scene (training scenes, sprint 6 Task A)."""
        self.sim = sim_utils.SimulationContext(make_sim_cfg(device))
        self.scene = instantiate(make_scene_cfg(cameras=cameras))
        self.sim.reset()
        self.cameras = ["front", "wrist"] if cameras else []
        robot = self.scene["robot"]
        hand = SceneEntityCfg("robot", body_names=["panda_hand"])
        hand.resolve(self.scene)
        self.hand_id = hand.body_ids[0]
        self.joint_names = list(robot.joint_names)
        fingers = tuple(self.joint_names.index(n) for n in ("panda_finger_joint1", "panda_finger_joint2"))
        if fingers != FINGER_IDS or robot.num_joints != 9:
            raise RuntimeError(f"unexpected Franka joints {self.joint_names}: eval assumes fingers at {FINGER_IDS}")
        default = robot.data.default_joint_pos.torch[0].cpu().numpy()
        if not np.allclose(default, FRANKA_DEFAULT_JOINT_POS, atol=1e-3):
            raise RuntimeError(f"Franka default pose {default.tolist()} != sim_eval.start_state "
                               f"FRANKA_DEFAULT_JOINT_POS {FRANKA_DEFAULT_JOINT_POS}; update the constant")
        if start_joint_pos is None:
            self.start_q = robot.data.default_joint_pos.torch.clone()
        else:
            q = np.asarray(start_joint_pos, dtype=np.float32).reshape(1, -1)
            if q.shape != (1, robot.num_joints) or not np.isfinite(q).all():
                raise ValueError(f"start_joint_pos: expected {robot.num_joints} finite values, got {q.shape}")
            self.start_q = torch.tensor(q, device=self.sim.device)
        self.start_by_seed = {}
        for seed, pose in (start_poses or {}).items():
            q = np.asarray(pose, dtype=np.float32).reshape(1, -1)
            if q.shape != (1, robot.num_joints) or not np.isfinite(q).all():
                raise ValueError(f"start_poses[{seed}]: expected {robot.num_joints} finite values, got {q.shape}")
            self.start_by_seed[int(seed)] = torch.tensor(q, device=self.sim.device)

    # -- EvalEnv ----------------------------------------------------------------------------------------------------

    def reset(self, scene: Scene) -> None:
        sc, robot, dev = self.scene, self.scene["robot"], self.sim.device
        origin = sc.env_origins[0].cpu().numpy()
        start_q = self.start_by_seed.get(scene.seed, self.start_q)
        robot.write_joint_position_to_sim_index(position=start_q.clone())
        robot.write_joint_velocity_to_sim_index(velocity=robot.data.default_joint_vel.torch.clone())

        def put(name: str, pos, quat_wxyz) -> None:
            pose = torch.tensor([[*(np.asarray(pos) + origin), *_xyzw(quat_wxyz)]], dtype=torch.float32, device=dev)
            sc[name].write_root_pose_to_sim_index(root_pose=pose)
            sc[name].write_root_velocity_to_sim_index(root_velocity=torch.zeros(1, 6, device=dev))

        put("cube", scene.cube_pose.pos, scene.cube_pose.quat_wxyz)
        bp = scene.bin_pose
        for name, (_size, center) in BIN_PARTS.items():
            put(name, np.asarray(bp.pos) + _yaw_rotate(bp.quat_wxyz, center), bp.quat_wxyz)
        sc.reset()
        if self.cameras:
            eye = torch.tensor((np.asarray(FRONT_EYE) + origin)[None], dtype=torch.float32, device=dev)
            target = torch.tensor((np.asarray(FRONT_TARGET) + origin)[None], dtype=torch.float32, device=dev)
            sc["front"].set_world_poses_from_view(eye, target)
        # Hold the start pose for a few steps so the renderer produces real frames before the first observation.
        hold = start_q[0].cpu().numpy()
        for _ in range(CAMERA_WARMUP_STEPS):
            self._apply(hold)

    def observe(self) -> Observation:
        joint_pos = self.scene["robot"].data.joint_pos.torch[0].cpu().numpy().astype(np.float64)
        images = {cam: self.scene[cam].data.output["rgb"].torch[0, ..., :3].cpu().numpy().astype(np.uint8)
                  for cam in self.cameras}
        return Observation(joint_pos=joint_pos, images=images)

    def step(self, action: np.ndarray) -> StepRecord:
        self._apply(action)
        return self._record(gripper_command(action))

    def _record(self, gripper: int) -> StepRecord:
        """The StepRecord after a control step (sim_eval.isaac_distill_env records the teacher's steps with it)."""
        sc, robot = self.scene, self.scene["robot"]
        origin = sc.env_origins[0]
        hand = robot.data.body_pose_w.torch[:, self.hand_id]
        offset = torch.tensor([[0.0, 0.0, TCP_OFFSET]], device=self.sim.device)
        tcp = (hand[:, 0:3] + quat_apply(hand[:, 3:7], offset) - origin)[0].cpu().numpy().astype(np.float64)
        q = hand[0, 3:7].cpu().numpy().astype(np.float64)  # xyzw
        cq = sc["cube"].data.root_quat_w.torch[0].cpu().numpy().astype(np.float64)  # xyzw
        forces = {group: max(_max_pair_force(sc[name]) for name in sensors)
                  for group, sensors in ARM_CONTACT_SENSORS.items()}
        return StepRecord(
            tcp_pos=tcp,
            tcp_quat_wxyz=np.array([q[3], q[0], q[1], q[2]]),
            cube_pos=(sc["cube"].data.root_pos_w.torch[0] - origin).cpu().numpy().astype(np.float64),
            gripper=gripper,
            contact_gripper_cube=_max_pair_force(sc["cube_contact"]) > CONTACT_N,
            contact_arm_bin=forces["bin"] > CONTACT_N,
            contact_arm_table=forces["table"] > CONTACT_N,
            max_contact_force=max(forces.values()),
            cube_quat_wxyz=np.array([cq[3], cq[0], cq[1], cq[2]]),
        )

    # -- internals --------------------------------------------------------------------------------------------------

    def _apply(self, joint_targets: np.ndarray) -> None:
        """One control step: hold the 9-joint position target for DECIMATION physics steps (as replay does)."""
        target = torch.tensor(np.asarray(joint_targets, dtype=np.float32).reshape(1, -1), device=self.sim.device)
        robot = self.scene["robot"]
        for _ in range(DECIMATION):
            robot.set_joint_position_target_index(target=target)
            self.scene.write_data_to_sim()
            self.sim.step()
            self.scene.update(PHYSICS_DT)
