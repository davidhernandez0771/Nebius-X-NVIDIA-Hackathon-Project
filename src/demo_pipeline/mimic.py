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

#: Isaac Lab's HDF5 dataset format with (x, y, z, w) quaternions (hdf5_dataset_file_handler.DATASET_FORMAT_VERSION).
FORMAT_VERSION = 1
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
            "rigid_object": {
                "cube": {"root_pose": _root_pose(c["pos"], c["quat_wxyz"]), "root_velocity": np.zeros((1, 6), f32)},
                "bin": {"root_pose": _root_pose(b["pos"], b["quat_wxyz"]), "root_velocity": np.zeros((1, 6), f32)},
            },
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
