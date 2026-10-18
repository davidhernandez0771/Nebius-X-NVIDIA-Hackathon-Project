"""Replay a Trajectory on the Franka or OpenArm with differential IK, record the episode, and verify it (spec 8.5).

The caller must already be inside ``isaaclab.app.launch_simulation(make_sim_cfg(...), args)``.
Isaac Lab 3.0 quaternions are (x, y, z, w); everything that crosses into demo_pipeline is (w, x, y, z).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch

import isaaclab.sim as sim_utils
from isaaclab.controllers import DifferentialIKController, DifferentialIKControllerCfg
from isaaclab.managers import SceneEntityCfg
from isaaclab.utils import instantiate
from isaaclab.utils.math import compute_pose_error, subtract_frame_transforms

from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode, save_signals
from demo_pipeline.schemas import Pose, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.success import check_success

from .placement import place_scene, xyzw
from .scene_cfg import ARM_CONTACT_SENSORS, BIN_INNER, make_scene_cfg
from .robots import RobotSpec, finger_targets, hand_from_tool, robot_spec, tool_from_hand
from .tracking import CONTROL_DT, TrackingOptions, dls_iterate, gate_hold, lookahead_index, tracking_stats

TASK_TEXT = "pick up the red cube and place it in the blue bin"
PHYSICS_DT = 0.01
DECIMATION = 2
FPS = 50
CONTACT_N = 0.1  # newtons; below this a pair is "not in contact"
PREROLL_MAX_STEPS = 200  # control steps to reach the first pose before recording starts
PREROLL_POS_TOL = 0.003
CAMERA_WARMUP_STEPS = 5
IK_LAMBDA = 0.01  # DifferentialIKControllerCfg's default "dls" damping
TCP_OFFSET = robot_spec("franka").tcp_offset[2]  # public (sim_eval): panda_hand -> fingertip center, m


def make_sim_cfg(device: str = "cuda:0") -> sim_utils.SimulationCfg:
    return sim_utils.SimulationCfg(dt=PHYSICS_DT, device=device)


def _wxyz(q_xyzw: np.ndarray) -> np.ndarray:
    return np.concatenate([q_xyzw[..., 3:4], q_xyzw[..., :3]], axis=-1)


@dataclass
class _Session:
    sim: sim_utils.SimulationContext
    scene: object
    cameras: bool
    spec: RobotSpec
    ik: DifferentialIKController
    arm: SceneEntityCfg
    finger_ids: list[int]
    jacobi_idx: int


_SESSION: _Session | None = None


def _session(record_cameras: bool, robot_name: str = "franka") -> _Session:
    """One SimulationContext + scene (one robot) per process; built on first use."""
    global _SESSION
    if _SESSION is not None:
        if record_cameras and not _SESSION.cameras:
            raise RuntimeError("this sim session was built without cameras")
        if robot_name != _SESSION.spec.name:
            raise RuntimeError(f"this sim session was built for {_SESSION.spec.name}, not {robot_name}")
        return _SESSION
    spec = robot_spec(robot_name)
    sim = sim_utils.SimulationContext(make_sim_cfg())
    scene = instantiate(make_scene_cfg(cameras=record_cameras, robot=robot_name))
    sim.reset()
    robot = scene["robot"]
    arm = SceneEntityCfg("robot", joint_names=[spec.arm_joints], body_names=[spec.hand_body])
    arm.resolve(scene)
    ik = DifferentialIKController(
        DifferentialIKControllerCfg(
            command_type="pose", use_relative_mode=False, ik_method="dls", joint_limit_avoidance_gain=spec.ik_limit_gain
        ),
        num_envs=scene.num_envs,
        device=sim.device,
    )
    if spec.ik_limit_gain > 0:
        limits = robot.data.joint_pos_limits.torch[0, arm.joint_ids]
        ik.set_joint_pos_limits(limits[:, 0], limits[:, 1])
    finger_ids = [robot.joint_names.index(j) for j in spec.finger_joints]
    jacobi_idx = arm.body_ids[0] - 1 if robot.is_fixed_base else arm.body_ids[0]
    _SESSION = _Session(sim, scene, record_cameras, spec, ik, arm, finger_ids, jacobi_idx)
    return _SESSION


def _place_scene(s: _Session, scene_spec: Scene) -> None:
    place_scene(s.scene, scene_spec, aim_front_camera=s.cameras)
    s.ik.reset()


def _hand_target(s: _Session, tcp_pos: np.ndarray, quat_wxyz) -> torch.Tensor:
    """Tool pose (env frame, wxyz) -> hand (IK link) pose command in the robot root frame (pos + xyzw)."""
    dev, robot = s.sim.device, s.scene["robot"]
    hand_pos, hand_q = hand_from_tool(s.spec, tcp_pos, quat_wxyz)
    q = torch.tensor([xyzw(hand_q)], dtype=torch.float32, device=dev)
    hand_w = torch.tensor([hand_pos], dtype=torch.float32, device=dev) + s.scene.env_origins[0]
    root = robot.data.root_pose_w.torch
    pos_b, quat_b = subtract_frame_transforms(root[:, 0:3], root[:, 3:7], hand_w, q)
    return torch.cat([pos_b, quat_b], dim=-1)


def _ik_inputs(s: _Session) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """(jacobian, hand pos in root frame, hand quat xyzw in root frame, arm joint positions)."""
    robot = s.scene["robot"]
    jacobi_joint_ids = [j + robot.num_base_dofs for j in s.arm.joint_ids]
    jacobian = robot.data.body_link_jacobian_w.torch[:, s.jacobi_idx, :, jacobi_joint_ids]
    ee_pose_w = robot.data.body_pose_w.torch[:, s.arm.body_ids[0]]
    root = robot.data.root_pose_w.torch
    joint_pos = robot.data.joint_pos.torch[:, s.arm.joint_ids]
    ee_pos_b, ee_quat_b = subtract_frame_transforms(root[:, 0:3], root[:, 3:7], ee_pose_w[:, 0:3], ee_pose_w[:, 3:7])
    return jacobian, ee_pos_b, ee_quat_b, joint_pos


def _joint_vel_ff(s: _Session, cmd_now: torch.Tensor, cmd_next: torch.Tensor) -> torch.Tensor:
    """Joint velocities that move the hand from cmd_now to cmd_next in one control step."""
    jacobian = _ik_inputs(s)[0]
    pos_err, rot_err = compute_pose_error(cmd_now[:, 0:3], cmd_now[:, 3:7], cmd_next[:, 0:3], cmd_next[:, 3:7])
    twist = torch.cat([pos_err, rot_err], dim=1) / CONTROL_DT
    return dls_iterate(jacobian, twist, IK_LAMBDA, 1)


def _physics_step(
    s: _Session, command: torch.Tensor, gripper: int, *, ik_iters: int = 1, joint_vel: torch.Tensor | None = None
) -> torch.Tensor:
    """Two physics steps (decimation 2) tracking `command`. Returns the full joint target vector."""
    robot = s.scene["robot"]
    s.ik.set_command(command)
    vel = joint_vel if joint_vel is not None else torch.zeros(1, len(s.arm.joint_ids), device=s.sim.device)
    for _ in range(DECIMATION):
        jacobian, ee_pos_b, ee_quat_b, joint_pos = _ik_inputs(s)
        if ik_iters == 1:
            arm_target = s.ik.compute(ee_pos_b, ee_quat_b, jacobian, joint_pos)
        else:
            task_jacobian, task_error = s.ik._compute_pose_task(ee_pos_b, ee_quat_b, jacobian)
            arm_target = joint_pos + dls_iterate(task_jacobian, task_error, IK_LAMBDA, ik_iters)
        finger = torch.tensor([finger_targets(s.spec, bool(gripper))], dtype=torch.float32, device=s.sim.device)
        robot.set_joint_position_target_index(target=arm_target, joint_ids=s.arm.joint_ids)
        robot.set_joint_velocity_target_index(target=vel, joint_ids=s.arm.joint_ids)
        robot.set_joint_position_target_index(target=finger, joint_ids=s.finger_ids)
        s.scene.write_data_to_sim()
        s.sim.step()
        s.scene.update(PHYSICS_DT)
    full = robot.data.joint_pos.torch.clone()
    full[:, s.arm.joint_ids] = arm_target
    full[:, s.finger_ids] = finger
    return full


def _tcp_pose(s: _Session) -> tuple[np.ndarray, np.ndarray]:
    """Tool pose (env frame, wxyz) of the robot right now."""
    hand = s.scene["robot"].data.body_pose_w.torch[0, s.arm.body_ids[0]].cpu().numpy().astype(np.float64)
    origin = s.scene.env_origins[0].cpu().numpy().astype(np.float64)
    return tool_from_hand(s.spec, hand[0:3] - origin, _wxyz(hand[3:7]))


def _max_pair_force(sensor) -> float:
    """Largest filtered normal-force magnitude over both physics substeps of the last control step."""
    hist = sensor.data.normal_force_matrix_w_history
    forces = (hist.torch if hist is not None else sensor.data.normal_force_matrix_w.torch)
    return float(torch.linalg.norm(forces, dim=-1).max().item())


def replay(
    traj: Trajectory,
    scene: Scene,
    *,
    ep_dir: Path | None,
    record_cameras: bool,
    tracking: TrackingOptions | None = None,
    stats: dict | None = None,
    robot: str | None = None,
) -> tuple[VerificationResult, SimSignals]:
    """Replay and verify. If `stats` is given it is filled with tracking errors (mm), the gate's hold
    steps, "trajectory": the executed Trajectory (longer than `traj` when the gate held a gripper
    change), and the recorded "joint_pos" [steps, joints] with their "joint_names". SimSignals and the
    episode follow the executed trajectory. `robot` runs another robot than scene.robot in the scene
    (an uploaded one: the scene then only says whose workspace it is)."""
    opts = tracking or TrackingOptions()
    s = _session(record_cameras, robot or scene.robot)
    _place_scene(s, scene)
    arr = traj.to_arrays()
    n = len(arr["t"])

    # Pre-roll (not recorded): bring the hand to the first pose with the gripper as at step 0.
    first = _hand_target(s, arr["ee_pos"][0], arr["ee_quat"][0])
    for i in range(PREROLL_MAX_STEPS):
        _physics_step(s, first, int(arr["gripper"][0]))
        if i >= CAMERA_WARMUP_STEPS and np.linalg.norm(_tcp_pose(s)[0] - arr["ee_pos"][0]) < PREROLL_POS_TOL:
            break
    preroll_err = float(np.linalg.norm(_tcp_pose(s)[0] - arr["ee_pos"][0]))
    print(f"[replay] pre-roll: {i + 1} steps, residual {preroll_err * 1000:.1f} mm")

    rec = {k: [] for k in ("joint_pos", "action", "ee_pos", "ee_quat", "cube_pos")}
    contacts = {k: [] for k in ("gripper_cube", "arm_bin", "arm_table")}
    max_force = []
    frames: dict[str, list[np.ndarray]] = {"front": [], "wrist": []} if record_cameras else {}
    exe = {k: [] for k in ("ee_pos", "ee_quat", "gripper")}  # the executed trajectory, gate holds included
    ik_residual = []  # m, reached TCP vs the pose actually commanded (step j); feeds "unreachable"
    hold_steps, waited, grip_prev, k = 0, 0, int(arr["gripper"][0]), 0

    while k < n:
        g = int(arr["gripper"][k])
        err_now = float(np.linalg.norm(_tcp_pose(s)[0] - arr["ee_pos"][k]))
        hold = gate_hold(grip_prev, g, err=err_now, waited_steps=waited, opts=opts)
        if hold:
            j, nxt, g_cmd = k, k, grip_prev
            waited += 1
            hold_steps += 1
        else:
            j, nxt, g_cmd = lookahead_index(k, n, opts.lookahead), lookahead_index(k + 1, n, opts.lookahead), g
            waited = 0
        cmd = _hand_target(s, arr["ee_pos"][j], arr["ee_quat"][j])
        vel = None
        if opts.vel_ff and nxt != j:
            vel = _joint_vel_ff(s, cmd, _hand_target(s, arr["ee_pos"][nxt], arr["ee_quat"][nxt]))
        action = _physics_step(s, cmd, g_cmd, ik_iters=opts.ik_iters, joint_vel=vel)
        exe["ee_pos"].append(arr["ee_pos"][k])
        exe["ee_quat"].append(arr["ee_quat"][k])
        exe["gripper"].append(g_cmd)
        grip_prev = g_cmd
        if not hold:
            k += 1

        robot, cube = s.scene["robot"], s.scene["cube"]
        tcp, q = _tcp_pose(s)
        ik_residual.append(float(np.linalg.norm(tcp - arr["ee_pos"][j])))
        rec["joint_pos"].append(robot.data.joint_pos.torch[0].cpu().numpy())
        rec["action"].append(action[0].cpu().numpy())
        rec["ee_pos"].append(tcp)
        rec["ee_quat"].append(q)
        rec["cube_pos"].append((cube.data.root_pos_w.torch[0] - s.scene.env_origins[0]).cpu().numpy())
        contacts["gripper_cube"].append(_max_pair_force(s.scene["cube_contact"]) > CONTACT_N)
        forces = {}
        for group, sensors in ARM_CONTACT_SENSORS.items():
            forces[group] = max(_max_pair_force(s.scene[name]) for name in sensors)
        contacts["arm_bin"].append(forces["bin"] > CONTACT_N)
        contacts["arm_table"].append(forces["table"] > CONTACT_N)
        max_force.append(max(forces.values()))
        for cam in frames:
            frames[cam].append(s.scene[cam].data.output["rgb"].torch[0, ..., :3].cpu().numpy().astype(np.uint8))

    m = len(exe["gripper"])
    executed = traj if hold_steps == 0 else Trajectory.from_arrays(
        np.arange(m) * CONTROL_DT, np.asarray(exe["ee_pos"]), np.asarray(exe["ee_quat"]), exe["gripper"]
    )
    track = tracking_stats(np.asarray(exe["ee_pos"]), np.asarray(rec["ee_pos"]), np.asarray(exe["gripper"]))
    print(
        f"[replay] tracking error mm: mean {track['mean_mm']:.1f}, max {track['max_mm']:.1f}, "
        f"at close {track['close_mm']}, gate hold steps {hold_steps}"
    )
    signals = SimSignals(
        cube_pos=np.asarray(rec["cube_pos"], dtype=np.float64),
        contact_gripper_cube=np.asarray(contacts["gripper_cube"], dtype=bool),
        contact_arm_bin=np.asarray(contacts["arm_bin"], dtype=bool),
        contact_arm_table=np.asarray(contacts["arm_table"], dtype=bool),
        max_contact_force=np.asarray(max_force, dtype=np.float64),
    )
    reach = np.asarray(ik_residual) if opts.residual_is_reach_signal else None
    result = check_success(executed, signals, scene.bin_pose, bin_inner=BIN_INNER, tcp_error=reach)
    if stats is not None:
        stats.update(track, hold_steps=hold_steps, preroll_mm=preroll_err * 1000, trajectory=executed,
                     joint_pos=np.asarray(rec["joint_pos"]), joint_names=list(s.scene["robot"].joint_names))

    if ep_dir is not None:
        ep_dir = Path(ep_dir)
        meta = EpisodeMeta(
            demo_id=ep_dir.name, robot=scene.robot, task_text=TASK_TEXT, fps=FPS, n_steps=m, cameras=sorted(frames)
        )
        save_episode(ep_dir, meta, {
            "joint_pos": np.asarray(rec["joint_pos"], dtype=np.float32),
            "action": np.asarray(rec["action"], dtype=np.float32),
            "ee_pos": np.asarray(rec["ee_pos"], dtype=np.float32),
            "ee_quat": np.asarray(rec["ee_quat"], dtype=np.float32),
            "gripper": np.asarray(exe["gripper"], dtype=np.int8),
        })
        save_signals(ep_dir, signals)
        if frames:
            from PIL import Image

            for cam, imgs in frames.items():
                for k, img in enumerate(imgs):
                    Image.fromarray(img).save(image_path(ep_dir, cam, k))
    return result, signals


def bin_pose_for(x: float, y: float, yaw: float = 0.0) -> Pose:
    return Pose(pos=(x, y, 0.0), quat_wxyz=(math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)))
