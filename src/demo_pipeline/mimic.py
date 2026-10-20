"""SANT episodes as Isaac Lab Mimic source demos: the math, pure numpy (the file I/O is scripts/export_mimic.py).

Isaac Lab Mimic (isaaclab_mimic, the engine of NVIDIA's GR00T-Mimic blueprint) multiplies a few good demos into
many. Its generator reads an *annotated* source dataset: Isaac Lab's HDF5 layout (isaaclab.utils.datasets), one
`data/demo_N` group per demo holding

    actions                                   [N, A]      what env.step() took
    initial_state/...                         [1, ...]    InteractiveScene.get_state(is_relative=True) at reset
    obs/datagen_info/eef_pose/<eef>           [N, 4, 4]   the eef pose before each step (env frame)
    obs/datagen_info/target_eef_pose/<eef>    [N, 4, 4]   the pose each action asks for
    obs/datagen_info/object_pose/<object>     [N, 4, 4]   each object's pose before each step
    obs/datagen_info/subtask_term_signals/<s> [N]         0 until subtask s is done, 1 after

(annotate_demos.py records exactly these; DataGenInfoPool reads them.) SANT already knows all of it for a verified
episode, so it writes the annotated file directly: the commanded tool path (trajectory.json) is the target, the
reached tool path (steps.npz) the eef pose, the cube track (signals.npz) and the bin (scene.json) the objects, and
the subtask boundaries come from SANT's own phase split (robota.phases): grasp ends when the cube first leaves the
table, place runs to the end. The action is an absolute tool pose and a binary gripper, for an IK-abs env whose IK
frame is the tool centre (see docs/superpowers/notes/2026-10-20-mimic-export.md).

Quaternions: SANT stores (w, x, y, z); Isaac Lab (dataset format 1, isaaclab.utils.math) uses (x, y, z, w).
"""
from __future__ import annotations

import numpy as np

from . import robota
from .scene_geometry import BIN_INNER, BIN_WALL, CUBE_HALF

#: Isaac Lab's HDF5 dataset format with (x, y, z, w) quaternions (hdf5_dataset_file_handler.DATASET_FORMAT_VERSION).
FORMAT_VERSION = 1
#: The gym id of SANT's Mimic env (sim_worker/mimic_env.py), written into the file as its env_name.
ENV_NAME = "SANT-PickPlace-Franka-IK-Abs-Mimic-v0"
#: The Franka's tool centre in the panda_hand frame (sim_worker.robots: tcp_offset; the hand is not rotated in the
#: tool frame). The env's IK drives this point, and every pose in the file is of it.
TCP_OFFSET = (0.0, 0.0, 0.1034)
#: The one end effector's name in subtask_configs and datagen_info.
EEF = "franka"
#: The task's subtasks for the Mimic env's subtask_configs: grasp relative to the cube, then place relative to the
#: bin. Mimic splits each demo at the 0 -> 1 edge of `term_signal` (the last subtask needs none) and moves each
#: boundary by a random offset in `term_offset` steps (the values Isaac Lab's Franka stack task uses).
SUBTASKS = [
    {"name": "grasp", "object_ref": "cube", "term_signal": "grasp", "term_offset": [10, 20],
     "description": "Grasp the red cube"},
    {"name": "place", "object_ref": "bin", "term_signal": None, "term_offset": [0, 0],
     "description": "Place the cube in the blue bin"},
]
#: The robot's home tool pose (sim_worker.scripted HOME_TCP / DOWN_WXYZ): every Mimic source must start there,
#: since the Mimic env resets the robot to it.
HOME_TCP = (0.45, 0.0, 0.35)
HOME_WXYZ = (0.0, 1.0, 0.0, 0.0)
#: The world's gripper command: 1 = closed. Isaac Lab's BinaryJointPositionAction closes on a negative action.
OPEN, CLOSE = 1.0, -1.0

_POSE_KEYS = ("eef_pose", "target_eef_pose", "object_pose")

# --- SANT's Franka scene (sim_worker/scene_cfg.py builds it from the same numbers; a test holds them equal) ---
_ix, _iy, _iz = BIN_INNER
_wall_z = BIN_WALL + _iz / 2
#: Each bin box's centre in the bin frame (origin: the centre of the floor's underside), as scene_cfg.BIN_PARTS.
BIN_PART_CENTERS = {
    "bin_floor": (0.0, 0.0, BIN_WALL / 2),
    "bin_wall_px": ((_ix + BIN_WALL) / 2, 0.0, _wall_z),
    "bin_wall_nx": (-(_ix + BIN_WALL) / 2, 0.0, _wall_z),
    "bin_wall_py": (0.0, (_iy + BIN_WALL) / 2, _wall_z),
    "bin_wall_ny": (0.0, -(_iy + BIN_WALL) / 2, _wall_z),
}
#: scene_cfg.TABLE_CENTER.
TABLE_CENTER = (0.575, 0.0, -0.025)
#: Every rigid object in the Franka scene: what InteractiveScene.get_state / reset_to name.
SCENE_OBJECTS = ("cube", "table", *BIN_PART_CENTERS)
#: check_success's end state: the cube's centre in the bin's inner box, slower than this (m/s), the gripper open.
SETTLE_SPEED = 0.01
_EPS = 1e-9


def xyzw(q_wxyz) -> np.ndarray:
    """(w, x, y, z) -> (x, y, z, w), for one quaternion or a stack of them."""
    q = np.asarray(q_wxyz, dtype=np.float64)
    return np.concatenate([q[..., 1:4], q[..., 0:1]], axis=-1)


def _rotation(q_wxyz: np.ndarray) -> np.ndarray:
    q = np.asarray(q_wxyz, dtype=np.float64)
    q = q / np.linalg.norm(q, axis=-1, keepdims=True)
    w, x, y, z = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    return np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], axis=-1),
        np.stack([2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], axis=-1),
        np.stack([2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)], axis=-1),
    ], axis=-2)


def pose_matrix(pos, quat_wxyz) -> np.ndarray:
    """[N, 3] positions and [N, 4] (w, x, y, z) quaternions -> [N, 4, 4] poses (isaaclab.utils.math.make_pose)."""
    pos = np.asarray(pos, dtype=np.float64)
    out = np.zeros((len(pos), 4, 4))
    out[:, :3, :3] = _rotation(quat_wxyz)
    out[:, :3, 3] = pos
    out[:, 3, 3] = 1.0
    return out


def gripper_actions(gripper) -> np.ndarray:
    """SANT's gripper command (1 = closed) -> [N, 1] binary gripper actions (+1 open, -1 close)."""
    g = np.asarray(gripper).astype(bool)
    return np.where(g, CLOSE, OPEN).astype(np.float32)[:, None]


def subtask_signals(phases: list[str]) -> dict[str, np.ndarray]:
    """Mimic's subtask term signals from SANT's phases: `grasp` turns on at the first step the cube is lifted
    (carry or place), `place` at the first release after that. Each is 0 before and 1 after, for good."""
    p = list(phases)
    lifted = [i for i, s in enumerate(p) if s in ("carry", "place")]
    if not lifted:
        raise ValueError("the cube is never lifted: no grasp to cut the demo at")
    g = lifted[0]
    if g == 0:
        raise ValueError("the cube is lifted at the first step: Mimic needs the grasp signal to go 0 -> 1")
    released = [i for i in range(g, len(p)) if p[i] == "release"]
    if not released:
        raise ValueError("the gripper never opens after the lift: no place")
    n = len(p)
    grasp, place = np.zeros(n, dtype=bool), np.zeros(n, dtype=bool)
    grasp[g:] = True
    place[released[0]:] = True
    return {"grasp": grasp, "place": place}


def subtask_boundaries(signals: dict[str, np.ndarray], n: int) -> list[tuple[int, int]]:
    """[start, end) of each subtask, as isaaclab_mimic's DataGenInfoPool computes them: a subtask ends one step
    past the first 0 -> 1 edge of its term signal, the next starts there, and the last runs to the end."""
    out, start = [], 0
    for i, s in enumerate(SUBTASKS):
        if i == len(SUBTASKS) - 1:
            end = n
        else:
            flags = np.asarray(signals[s["term_signal"]]).astype(int).ravel()
            edges = np.flatnonzero(flags[1:] - flags[:-1])
            if len(edges) == 0:
                raise ValueError(f"subtask signal {s['term_signal']!r} never goes 0 -> 1")
            end = int(edges[0]) + 2
        if end <= start:
            raise ValueError(f"subtask {s['name']!r} is empty ({start}, {end})")
        out.append((start, end))
        start = end
    return out


def starts_at_home(trajectory: dict, pos_tol: float = 0.01, ang_tol: float = 0.05) -> bool:
    """Does the commanded tool path start at the robot's home pose (within `pos_tol` m and `ang_tol` rad)?"""
    p = np.asarray(trajectory["ee_pos"][0], dtype=float)
    q = np.asarray(trajectory["ee_quat"][0], dtype=float)
    q = q / np.linalg.norm(q)
    angle = 2 * np.arccos(min(1.0, abs(float(np.dot(q, HOME_WXYZ)))))
    return bool(np.linalg.norm(p - HOME_TCP) <= pos_tol and angle <= ang_tol)


def scene_objects(cube_pose: dict, bin_pose: dict) -> dict[str, tuple[list[float], list[float]]]:
    """Each rigid object's (position, (w, x, y, z)) in the env frame: the cube, the table, and the five bin boxes
    placed round the bin frame and turned with it (as sim_worker.placement.place_scene puts them)."""
    out = {"cube": (list(map(float, cube_pose["pos"])), list(map(float, cube_pose["quat_wxyz"]))),
           "table": (list(TABLE_CENTER), [1.0, 0.0, 0.0, 0.0])}
    rot = _rotation(np.asarray(bin_pose["quat_wxyz"], dtype=np.float64))
    for name, center in BIN_PART_CENTERS.items():
        pos = np.asarray(bin_pose["pos"], dtype=np.float64) + rot @ np.asarray(center)
        out[name] = (pos.tolist(), list(map(float, bin_pose["quat_wxyz"])))
    return out


def placed(cube_in_bin, speed, gripper_open):
    """check_success's end state, per step: the cube's centre ([..., 3], bin frame) inside the bin's inner box, the
    cube slower than SETTLE_SPEED, the gripper open. Plain operators only, so it runs on numpy arrays (SANT) and on
    torch tensors (the Mimic env's success term) alike."""
    x, y, z = cube_in_bin[..., 0], cube_in_bin[..., 1], cube_in_bin[..., 2]
    inside = (abs(x) <= _ix / 2 + _EPS) & (abs(y) <= _iy / 2 + _EPS) & (z >= -_EPS) & (z <= _iz + _EPS)
    return inside & (speed < SETTLE_SPEED) & gripper_open


def grasped(cube_z, gripper_closed):
    """The export's grasp signal, per step: the gripper closed and the cube at least robota.LIFT_M above its rest
    height (numpy or torch, like placed)."""
    return gripper_closed & (cube_z - CUBE_HALF >= robota.LIFT_M - _EPS)


def _root_pose(pos, quat_wxyz) -> np.ndarray:
    return np.concatenate([np.asarray(pos, dtype=np.float64), xyzw(quat_wxyz)])[None].astype(np.float32)


def episode_to_mimic(steps: dict, trajectory: dict, cube_pos, scene: dict) -> dict:
    """One verified SANT episode -> one annotated Mimic source demo, as a nested dict of numpy arrays.

    steps: steps.npz (joint_pos, ee_pos, ee_quat (wxyz), gripper), the reached path, recorded after each step.
    trajectory: trajectory.json (ee_pos, ee_quat (wxyz), gripper), what each step commanded.
    cube_pos: signals.npz cube_pos [N, 3]. scene: scene.json (cube_pose, bin_pose, seed).
    """
    n = len(steps["ee_pos"])
    cmd_pos = np.asarray(trajectory["ee_pos"], dtype=np.float64)
    cmd_quat = np.asarray(trajectory["ee_quat"], dtype=np.float64)
    cmd_grip = np.asarray(trajectory["gripper"])
    cube = np.asarray(cube_pos, dtype=np.float64)
    if not (len(cmd_pos) == len(cmd_quat) == len(cmd_grip) == len(cube) == n):
        raise ValueError(f"the trajectory ({len(cmd_pos)}), cube track ({len(cube)}) and steps ({n}) differ in length")

    actions = np.concatenate([cmd_pos, xyzw(cmd_quat), gripper_actions(cmd_grip)], axis=1).astype(np.float32)
    # Mimic records the eef pose *before* each step: the pose the previous step reached (the start, for step 0).
    pre_pos = np.vstack([cmd_pos[:1], np.asarray(steps["ee_pos"], dtype=np.float64)[:-1]])
    pre_quat = np.vstack([cmd_quat[:1], np.asarray(steps["ee_quat"], dtype=np.float64)[:-1]])
    pre_joints = np.vstack([steps["joint_pos"][:1], steps["joint_pos"][:-1]]).astype(np.float32)

    c, b = scene["cube_pose"], scene["bin_pose"]
    # SANT tracks the cube's position only, so it keeps its start rotation. Mimic reads object poses at the start
    # of each subtask, where the cube is resting (grasp) or the reference is the bin (place), so this holds there.
    cube_quat = np.tile(np.asarray(c["quat_wxyz"], dtype=np.float64), (n, 1))
    bin_pose = pose_matrix(np.tile(b["pos"], (n, 1)), np.tile(b["quat_wxyz"], (n, 1)))
    phases = robota.phases(steps["gripper"], cube, b["pos"], b["quat_wxyz"])

    f32 = np.float32
    return {
        "actions": actions,
        "initial_state": {
            "articulation": {"robot": {
                "root_pose": _root_pose([0, 0, 0], [1, 0, 0, 0]),
                "root_velocity": np.zeros((1, 6), f32),
                "joint_position": np.asarray(steps["joint_pos"][:1], dtype=f32),
                "joint_velocity": np.zeros((1, np.shape(steps["joint_pos"])[1]), f32),
            }},
            "rigid_object": {name: {"root_pose": _root_pose(p, q), "root_velocity": np.zeros((1, 6), f32)}
                             for name, (p, q) in scene_objects(c, b).items()},
        },
        "obs": {
            "eef_pos": pre_pos.astype(f32),
            "eef_quat": xyzw(pre_quat).astype(f32),
            "joint_pos": pre_joints,
            "cube_pos": np.vstack([cube[:1], cube[:-1]]).astype(f32),
            "datagen_info": {
                "eef_pose": {EEF: pose_matrix(pre_pos, pre_quat).astype(f32)},
                "target_eef_pose": {EEF: pose_matrix(cmd_pos, cmd_quat).astype(f32)},
                "object_pose": {"cube": pose_matrix(cube, cube_quat).astype(f32), "bin": bin_pose.astype(f32)},
                "subtask_term_signals": subtask_signals(phases),
            },
        },
    }


def _leaves(d: dict, prefix: str = ""):
    for k, v in d.items():
        if isinstance(v, dict):
            yield from _leaves(v, f"{prefix}{k}/")
        else:
            yield prefix + k, v


def check(demo: dict, term_offset: tuple[int, int] | None = None) -> list[tuple[int, int]]:
    """Check a demo the way Mimic will use it and return its subtask boundaries. Every per-step array has one row
    per action, every pose is a rigid transform, the signals are 0-then-1, and the first subtask's latest boundary
    (end + its largest offset) still falls before the demo ends (DataGenInfoPool's own sanity check)."""
    n = len(demo["actions"])
    info = demo["obs"]["datagen_info"]
    for name, a in _leaves(demo["obs"]):
        if len(a) != n:
            raise ValueError(f"obs/{name} has {len(a)} rows, the demo has {n} actions")
    for key in _POSE_KEYS:
        for name, m in info[key].items():
            r = np.asarray(m, dtype=np.float64)[:, :3, :3]
            if not np.allclose(r @ np.swapaxes(r, 1, 2), np.eye(3), atol=1e-4):
                raise ValueError(f"datagen_info/{key}/{name} is not a rotation")
    for name, s in info["subtask_term_signals"].items():
        s = np.asarray(s).astype(int)
        if np.any(np.diff(s) < 0):
            raise ValueError(f"subtask signal {name!r} turns off again")
    bounds = subtask_boundaries(info["subtask_term_signals"], n)
    offsets = [tuple(s["term_offset"]) for s in SUBTASKS]
    if term_offset is not None:
        offsets[0] = tuple(term_offset)
    for i in range(1, len(bounds)):
        hi, lo_next = offsets[i - 1][1], offsets[i][0]
        if not bounds[i - 1][1] + hi < bounds[i][1] + lo_next:
            raise ValueError(f"subtask {i - 1} ends at {bounds[i - 1][1]}: with Mimic's largest offset ({hi}) it "
                             f"would run past subtask {i}'s end ({bounds[i][1]})")
    return bounds


# --- re-verifying Mimic's generated demos with SANT's check_success (CPU) ----------------------------------

#: sim_worker.replay's contact threshold: a pair below this (N) is "not in contact".
CONTACT_N = 0.1
#: The SANT Mimic env's control rate (Hz).
RATE_HZ = 50


def bin_pose_from_state(initial_state: dict):
    """The bin's Pose (its origin, (w, x, y, z)) from a demo's initial_state: the floor box, less its centre."""
    from .schemas import Pose

    root = np.asarray(initial_state["rigid_object"]["bin_floor"]["root_pose"], dtype=np.float64)[0]
    q_wxyz = np.concatenate([root[6:7], root[3:6]])
    origin = root[:3] - _rotation(q_wxyz) @ np.asarray(BIN_PART_CENTERS["bin_floor"])
    return Pose(pos=tuple(origin.tolist()), quat_wxyz=tuple((q_wxyz / np.linalg.norm(q_wxyz)).tolist()))


def verify_generated(demo: dict):
    """SANT's check_success on one demo the SANT Mimic env generated (sim_worker/mimic_env.py records it):

    actions [N, 8]            the commanded tool pose (xyzw) and gripper: the trajectory, at RATE_HZ;
    obs/eef_pos [N, 3]        the tool before each step, so the reached pose after step t is row t + 1;
    obs/sant/cube_pos [N, 3]  the cube after each step;
    obs/sant/contact_forces   [N, 3] after each step: fingers on the cube, arm on the bin, arm on the table (N);
    initial_state             the bin, from its floor box.

    The arm's tracking error (`unreachable`) is |commanded - reached| per step. Returns the VerificationResult.
    """
    from .schemas import SimSignals, Trajectory
    from .success import check_success

    a = np.asarray(demo["actions"], dtype=np.float64)
    n = len(a)
    q = a[:, 3:7]
    traj = Trajectory(t=(np.arange(n) / RATE_HZ).tolist(), ee_pos=a[:, :3].tolist(),
                      ee_quat=np.concatenate([q[:, 3:4], q[:, :3]], axis=1).tolist(),
                      gripper=(a[:, 7] < 0).astype(int).tolist())
    sant = demo["obs"]["sant"]
    f = np.asarray(sant["contact_forces"], dtype=np.float64)
    sim = SimSignals(cube_pos=np.asarray(sant["cube_pos"], dtype=np.float64), contact_gripper_cube=f[:, 0] > CONTACT_N,
                     contact_arm_bin=f[:, 1] > CONTACT_N, contact_arm_table=f[:, 2] > CONTACT_N,
                     max_contact_force=f[:, 1:].max(axis=1))
    eef = np.asarray(demo["obs"]["eef_pos"], dtype=np.float64)
    reached = np.vstack([eef[1:], eef[-1:]])
    tcp_error = np.linalg.norm(a[:, :3] - reached, axis=1)
    return check_success(traj, sim, bin_pose_from_state(demo["initial_state"]), tcp_error=tcp_error)
