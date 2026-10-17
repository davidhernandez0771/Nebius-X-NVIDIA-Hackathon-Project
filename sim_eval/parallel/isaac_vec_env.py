"""N copies of the eval scene in one Isaac Lab process, stepped together: the VecEvalEnv for sim_eval.parallel.

This is sim_eval.isaac_env.IsaacEvalEnv with an env axis. The scene, physics constants, cameras and contact sensors
are the same public sim_worker names, with the scene's num_envs set to N (envs sit env_spacing = 3 m apart and do not
collide with each other). Everything is reported in each env's own frame (env origin subtracted), wxyz.

Differences from the serial env, on purpose:
  - reset_envs(...) places scenes in some envs without stepping; the camera warmup (holding the start pose for
    CAMERA_WARMUP_STEPS) is done by vec_loop, because any step moves every env.
  - contact forces are reduced per env (the serial env takes the max over the whole tensor, which is env 0).

Import and construct this only inside isaaclab.app.launch_simulation(...), once per process.
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
from sim_worker.replay import CONTACT_N, DECIMATION, PHYSICS_DT, TCP_OFFSET, make_sim_cfg
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


def _max_pair_force_per_env(sensor) -> torch.Tensor:
    """(N,) largest filtered contact force per env, over both physics substeps (history) and every pair."""
    hist = sensor.data.normal_force_matrix_w_history
    forces = hist.torch if hist is not None else sensor.data.normal_force_matrix_w.torch
    return torch.linalg.norm(forces, dim=-1).flatten(1).max(dim=1).values


class IsaacVecEvalEnv:
    bin_inner = BIN_INNER

    def __init__(self, num_envs: int, cameras: bool, device: str = "cuda:0", start_joint_pos=None):
        """start_joint_pos: 9 joint positions every env resets to; None = the asset default (as IsaacEvalEnv)."""
        if num_envs < 1:
            raise ValueError(f"num_envs must be >= 1, got {num_envs}")
        self.num_envs = num_envs
        self.sim = sim_utils.SimulationContext(make_sim_cfg(device))
        cfg = make_scene_cfg(cameras=cameras)
        cfg.num_envs = num_envs
        self.scene = instantiate(cfg)
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
            raise RuntimeError(f"Franka default pose {default.tolist()} != FRANKA_DEFAULT_JOINT_POS")
        if start_joint_pos is None:
            self.start_q = robot.data.default_joint_pos.torch[0].clone()
        else:
            q = np.asarray(start_joint_pos, dtype=np.float32).reshape(-1)
            if q.shape != (robot.num_joints,) or not np.isfinite(q).all():
                raise ValueError(f"start_joint_pos: expected {robot.num_joints} finite values, got {q.shape}")
            self.start_q = torch.tensor(q, device=self.sim.device)
        self.origins = self.scene.env_origins.clone()  # (N, 3)
        if self.cameras:
            eye = torch.tensor(FRONT_EYE, dtype=torch.float32, device=self.sim.device) + self.origins
            target = torch.tensor(FRONT_TARGET, dtype=torch.float32, device=self.sim.device) + self.origins
            self.scene["front"].set_world_poses_from_view(eye, target)

    # -- VecEvalEnv -------------------------------------------------------------------------------------------------

    def reset_envs(self, scenes: dict[int, Scene]) -> dict[int, np.ndarray]:
        if not scenes:
            return {}
        sc, robot, dev = self.scene, self.scene["robot"], self.sim.device
        ids = sorted(scenes)
        env_ids = torch.tensor(ids, dtype=torch.long, device=dev)
        k = len(ids)
        robot.write_joint_position_to_sim_index(position=self.start_q.repeat(k, 1), env_ids=env_ids)
        robot.write_joint_velocity_to_sim_index(velocity=robot.data.default_joint_vel.torch[env_ids].clone(),
                                                env_ids=env_ids)
        origins = self.origins[env_ids].cpu().numpy()

        def put(name: str, poses) -> None:  # poses: k x (pos, quat_wxyz), env frame
            rows = [[*(np.asarray(p) + o), *_xyzw(q)] for (p, q), o in zip(poses, origins)]
            sc[name].write_root_pose_to_sim_index(root_pose=torch.tensor(rows, dtype=torch.float32, device=dev),
                                                  env_ids=env_ids)
            sc[name].write_root_velocity_to_sim_index(root_velocity=torch.zeros(k, 6, device=dev), env_ids=env_ids)

        put("cube", [(scenes[i].cube_pose.pos, scenes[i].cube_pose.quat_wxyz) for i in ids])
        for name, (_size, center) in BIN_PARTS.items():
            put(name, [(np.asarray(scenes[i].bin_pose.pos) + _yaw_rotate(scenes[i].bin_pose.quat_wxyz, center),
                        scenes[i].bin_pose.quat_wxyz) for i in ids])
        sc.reset(ids)
        if self.cameras:
            eye = torch.tensor(FRONT_EYE, dtype=torch.float32, device=dev) + self.origins[env_ids]
            target = torch.tensor(FRONT_TARGET, dtype=torch.float32, device=dev) + self.origins[env_ids]
            sc["front"].set_world_poses_from_view(eye, target, env_ids=ids)
        start = self.start_q.cpu().numpy().astype(np.float64)
        return {i: start.copy() for i in ids}

    def observe(self) -> list[Observation]:
        joint_pos = self.scene["robot"].data.joint_pos.torch.cpu().numpy().astype(np.float64)  # (N, 9)
        images = {cam: self.scene[cam].data.output["rgb"].torch[..., :3].cpu().numpy().astype(np.uint8)
                  for cam in self.cameras}  # one GPU->CPU copy per camera for all envs
        return [Observation(joint_pos=joint_pos[i], images={c: images[c][i] for c in self.cameras})
                for i in range(self.num_envs)]

    def step(self, actions: np.ndarray) -> list[StepRecord]:
        actions = np.asarray(actions, dtype=np.float32)
        if actions.shape != (self.num_envs, 9):
            raise ValueError(f"actions: expected ({self.num_envs}, 9), got {actions.shape}")
        target = torch.tensor(actions, device=self.sim.device)
        robot = self.scene["robot"]
        for _ in range(DECIMATION):
            robot.set_joint_position_target_index(target=target)
            self.scene.write_data_to_sim()
            self.sim.step()
            self.scene.update(PHYSICS_DT)
        sc = self.scene
        hand = robot.data.body_pose_w.torch[:, self.hand_id]  # (N, 7) xyzw
        offset = torch.tensor([[0.0, 0.0, TCP_OFFSET]], device=self.sim.device).repeat(self.num_envs, 1)
        tcp = (hand[:, 0:3] + quat_apply(hand[:, 3:7], offset) - self.origins).cpu().numpy().astype(np.float64)
        quat = hand[:, 3:7].cpu().numpy().astype(np.float64)
        cube = (sc["cube"].data.root_pos_w.torch - self.origins).cpu().numpy().astype(np.float64)
        grip = _max_pair_force_per_env(sc["cube_contact"]).cpu().numpy()
        groups = {g: torch.stack([_max_pair_force_per_env(sc[name]) for name in sensors]).max(dim=0).values
                  .cpu().numpy() for g, sensors in ARM_CONTACT_SENSORS.items()}
        return [
            StepRecord(
                tcp_pos=tcp[i],
                tcp_quat_wxyz=np.array([quat[i, 3], quat[i, 0], quat[i, 1], quat[i, 2]]),
                cube_pos=cube[i],
                gripper=gripper_command(actions[i]),
                contact_gripper_cube=bool(grip[i] > CONTACT_N),
                contact_arm_bin=bool(groups["bin"][i] > CONTACT_N),
                contact_arm_table=bool(groups["table"][i] > CONTACT_N),
                max_contact_force=float(max(groups["bin"][i], groups["table"][i])),
            )
            for i in range(self.num_envs)
        ]
