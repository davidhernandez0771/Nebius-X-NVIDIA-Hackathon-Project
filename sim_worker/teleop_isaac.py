"""IsaacTeleopDriver: the TeleopDriver (sim_worker.teleop_session) on Isaac Lab.

It drives the same scene and the same control as sim_worker.replay: scene placement through
sim_worker.placement.place_scene, and differential IK with joint-velocity feedforward through
replay's step helpers. Those helpers are imported, not copied; they are module-private in
replay.py (T2's file), so a rename there breaks this module loudly at import.

Feedforward differs in one way. Replay knows the next pose, so it feeds forward the twist from
this command to the next. Teleop only knows the past, so it feeds forward the twist from the
previous command to this one: the hand's own velocity, one control step late. A jump (the first
hand after a reset, or tracking regained far away) is not fed forward: above MAX_FF_STEP_M per
step, the IK position target alone moves the arm.

The caller must already be inside isaaclab.app.launch_simulation(make_sim_cfg(...), args).
Isaac Lab 3.0 quaternions are (x, y, z, w); everything here that crosses into demo_pipeline is (w, x, y, z).
"""

from __future__ import annotations

import numpy as np
import torch

from demo_pipeline.schemas import Pose, Scene

from . import replay as _replay
from .replay import CAMERA_WARMUP_STEPS, CONTACT_N, PHYSICS_DT
from .scene_cfg import ARM_CONTACT_SENSORS
from .teleop_session import TELEOP_DT, StepState
from .tracking import CONTROL_DT

if TELEOP_DT != CONTROL_DT:
    raise RuntimeError(f"teleop_session.TELEOP_DT {TELEOP_DT} != tracking.CONTROL_DT {CONTROL_DT}")

SETTLE_STEPS = CAMERA_WARMUP_STEPS  # control steps holding the default joint pose after a reset
MAX_FF_STEP_M = 0.02  # 1 m/s at 50 Hz; a hand moves ~0.3 m/s, so anything faster is a jump


class IsaacTeleopDriver:
    def __init__(self, *, record_cameras: bool, robot: str = "franka", vel_ff: bool = True) -> None:
        self.s = _replay._session(record_cameras, robot)
        self.record_cameras = record_cameras
        self.vel_ff = vel_ff
        self._prev_cmd: torch.Tensor | None = None
        self._prev_pos: np.ndarray | None = None
        self._action: torch.Tensor | None = None

    def reset(self, scene: Scene) -> None:
        """Place the scene, then hold the robot's default joint pose for a few control steps, so the
        robot data is fresh (and the cameras warm) before the session reads the start tool pose."""
        s = self.s
        _replay._place_scene(s, scene)
        robot = s.scene["robot"]
        default = robot.data.default_joint_pos.torch.clone()
        zeros = torch.zeros_like(default)
        for _ in range(SETTLE_STEPS):
            for _ in range(_replay.DECIMATION):
                robot.set_joint_position_target_index(target=default)
                robot.set_joint_velocity_target_index(target=zeros)
                s.scene.write_data_to_sim()
                s.sim.step()
                s.scene.update(PHYSICS_DT)
        self._prev_cmd = None
        self._prev_pos = None
        self._action = default

    def apply(self, target: Pose, gripper: int) -> None:
        s = self.s
        pos = np.asarray(target.pos, dtype=np.float64)
        cmd = _replay._hand_target(s, pos, target.quat_wxyz)
        vel = None
        if self.vel_ff and self._prev_cmd is not None and np.linalg.norm(pos - self._prev_pos) <= MAX_FF_STEP_M:
            vel = _replay._joint_vel_ff(s, self._prev_cmd, cmd)
        self._action = _replay._physics_step(s, cmd, int(gripper), joint_vel=vel)
        self._prev_cmd, self._prev_pos = cmd, pos

    def read_state(self) -> StepState:
        s = self.s
        robot, cube = s.scene["robot"], s.scene["cube"]
        tcp, quat = _replay._tcp_pose(s)
        forces = {group: max(_replay._max_pair_force(s.scene[name]) for name in sensors)
                  for group, sensors in ARM_CONTACT_SENSORS.items()}
        frames = {}
        if self.record_cameras:
            for cam in ("front", "wrist"):
                frames[cam] = s.scene[cam].data.output["rgb"].torch[0, ..., :3].cpu().numpy().astype(np.uint8)
        return StepState(
            joint_pos=robot.data.joint_pos.torch[0].cpu().numpy(),
            action=self._action[0].cpu().numpy(),
            ee_pos=np.asarray(tcp, dtype=np.float64),
            ee_quat=np.asarray(quat, dtype=np.float64),
            cube_pos=(cube.data.root_pos_w.torch[0] - s.scene.env_origins[0]).cpu().numpy(),
            contact_gripper_cube=_replay._max_pair_force(s.scene["cube_contact"]) > CONTACT_N,
            contact_arm_bin=forces["bin"] > CONTACT_N,
            contact_arm_table=forces["table"] > CONTACT_N,
            max_contact_force=float(max(forces.values())),
            frames=frames,
        )
