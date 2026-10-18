"""Per-robot constants for the sim worker, and the tool <-> hand frame math. Pure (numpy only).

The contract's ee_pos/ee_quat describe a robot-agnostic TOOL frame: origin at the fingertip center,
+z = the fingers' approach direction (the Franka panda_hand convention; its fingers slide along +-y).
Each robot's IK link (the "hand") sits at a fixed pose in that tool frame; the OpenArm's fingers slide
along tool +-x (equivalent for the 90-degree-symmetric cube).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class RobotSpec:
    name: str
    arm_joints: str  # regex for the IK joints
    hand_body: str  # IK link
    finger_joints: tuple[str, ...]  # every finger joint gets the same target
    gripper_open: float | tuple[float, ...]
    gripper_closed: float | tuple[float, ...]
    tcp_offset: tuple[float, float, float]  # hand origin -> fingertip center, in the hand frame (m)
    hand_in_tool_wxyz: tuple[float, float, float, float]  # the hand frame's orientation in the tool frame
    base_pos: tuple[float, float, float]  # robot root position in the world (m)
    init_joint_pos: dict[str, float] | None = None  # overrides the asset's start pose (None: keep it)
    ik_limit_gain: float = 0.0  # Isaac DifferentialIK null-space joint-limit avoidance (0 = off)
    # "Bring your robot" (sim_worker.urdf_import) only; the built-in robots come from Isaac Lab asset configs.
    # gripper_open / gripper_closed may then be one value per finger joint.
    urdf_path: str | None = None  # the uploaded URDF; scene_cfg imports it through Isaac Lab's UrdfConverter
    ros_packages: tuple[tuple[str, str], ...] = ()  # (package name, folder) for package:// mesh paths
    passive_finger_joints: tuple[str, ...] = ()  # mimic joints: they follow a finger joint and get no drive
    arm_links: tuple[str, ...] = ()  # every moving body (arm links, hand, fingers), for the arm contact sensors
    finger_links: tuple[str, ...] = ()  # the bodies that touch the cube, for the grasp contact sensor


ROBOTS: dict[str, RobotSpec] = {
    "franka": RobotSpec(
        name="franka",
        arm_joints="panda_joint.*",
        hand_body="panda_hand",
        finger_joints=("panda_finger_joint1", "panda_finger_joint2"),
        gripper_open=0.04,
        gripper_closed=0.0,
        tcp_offset=(0.0, 0.0, 0.1034),
        hand_in_tool_wxyz=(1.0, 0.0, 0.0, 0.0),
        base_pos=(0.0, 0.0, 0.0),
    ),
    # Probed 2026-10-16 (Isaac Lab 3.0 OPENARM_UNI_HIGH_PD_CFG): at zero joints openarm_hand is at z 0.6586 and
    # openarm_ee_tcp at z 0.7516 with the same orientation, fingers at hand +-y. openarm_hand_joint and
    # openarm_ee_tcp_joint are locked ([0, 0] limits). Measured (T2 note, Task 5): with joint6 limited to
    # +-45 deg, top-down poses are reachable with the fingers turned 90 deg about the approach axis (hand
    # yawed -90 deg in the tool frame); the cube is 90-degree symmetric, so the grasp is equivalent. The start
    # pose is a joint-limit-clamped IK solution for the tool at (0.4, 0, 0.025) pointing down, away from limits.
    "openarm": RobotSpec(
        name="openarm",
        arm_joints="openarm_joint.*",
        hand_body="openarm_hand",
        finger_joints=("openarm_finger_joint1", "openarm_finger_joint2"),
        gripper_open=0.044,
        gripper_closed=0.0,
        tcp_offset=(0.0, 0.0, 0.093),
        hand_in_tool_wxyz=(math.cos(-math.pi / 4), 0.0, 0.0, math.sin(-math.pi / 4)),
        base_pos=(0.20, 0.0, 0.25),
        init_joint_pos={
            "openarm_joint1": 1.157, "openarm_joint2": -1.174, "openarm_joint3": -1.073, "openarm_joint4": 1.801,
            "openarm_joint5": 1.377, "openarm_joint6": 0.302, "openarm_joint7": 0.406, "openarm_finger_joint.*": 0.044,
        },
        ik_limit_gain=0.5,
    ),
    # Probed 2026-10-16 (Isaac Lab 3.0 FLEXIV_RIZON4S_GRAV_GRIPPER_CFG): at the asset's default joints link7 points
    # down (xyzw (1,0,0,0), like panda_hand), the Grav fingertips slide along link7 y, and the fingertip midpoint is
    # 0.271 / 0.288 / 0.287 m along link7 +z with finger_joint open (0.785) / 0 / closed (-0.155). Only finger_joint
    # is driven; the 5 knuckle joints follow by mimic. TCP = where the held cube's center ends up, measured: with the
    # tips' midpoint at the cube center (0.288) the closing linkage jams the fingers on the table (finger_joint stuck
    # at 0.62); 1.5 cm higher it grips (35 N) and the lifted cube sits 1.7 cm below the tips -> 0.288 + 0.017.
    "flexiv": RobotSpec(
        name="flexiv",
        arm_joints="joint[1-7]",
        hand_body="link7",
        finger_joints=("finger_joint",),
        gripper_open=0.785,
        gripper_closed=-0.155,
        tcp_offset=(0.0, 0.0, 0.305),
        hand_in_tool_wxyz=(1.0, 0.0, 0.0, 0.0),
        base_pos=(0.0, 0.0, 0.0),
    ),
}


_UPLOADED: dict[str, RobotSpec] = {}  # "Bring your robot" specs, registered by the process that runs them


def register_robot(spec: RobotSpec) -> None:
    if spec.name in ROBOTS:
        raise ValueError(f"{spec.name} is a built-in robot")
    _UPLOADED[spec.name] = spec


def robot_spec(name: str) -> RobotSpec:
    return ROBOTS[name] if name in ROBOTS else _UPLOADED[name]


def finger_targets(spec: RobotSpec, closed: bool) -> tuple[float, ...]:
    """The joint target of each of spec.finger_joints for the gripper closed or open."""
    value = spec.gripper_closed if closed else spec.gripper_open
    return tuple(value) if isinstance(value, tuple) else (value,) * len(spec.finger_joints)


def _qmul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return np.array([
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    ])


def _conj(q: np.ndarray) -> np.ndarray:
    return np.array([q[0], -q[1], -q[2], -q[3]])


def _rotate(q: np.ndarray, v) -> np.ndarray:
    return _qmul(_qmul(q, np.array([0.0, *v])), _conj(q))[1:]


def hand_from_tool(spec: RobotSpec, tool_pos: np.ndarray, tool_wxyz: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """World tool pose -> world hand (IK link) pose, wxyz."""
    hand_q = _qmul(np.asarray(tool_wxyz, dtype=float), np.asarray(spec.hand_in_tool_wxyz, dtype=float))
    return np.asarray(tool_pos, dtype=float) - _rotate(hand_q, spec.tcp_offset), hand_q


def tool_from_hand(spec: RobotSpec, hand_pos: np.ndarray, hand_wxyz: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """World hand pose -> world tool pose, wxyz (the inverse of hand_from_tool)."""
    hand_q = np.asarray(hand_wxyz, dtype=float)
    tool_q = _qmul(hand_q, _conj(np.asarray(spec.hand_in_tool_wxyz, dtype=float)))
    return np.asarray(hand_pos, dtype=float) + _rotate(hand_q, spec.tcp_offset), tool_q
