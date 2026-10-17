"""Start-state check (Review Focus 4): does the eval's reset pose match where the training episodes start?

The eval resets the Franka to its asset default pose. T2's recorded episodes start where replay's pre-roll put the
hand: 15 cm above that episode's cube, so their first-frame joint positions differ per episode and sit ~0.6-0.9 rad
from the default on joints 2 and 6 (measured 2026-10-16 on batch_franka_cam). A policy started far outside the states
it was trained from fails for a reason that has nothing to do with the data condition being measured.

Rule: compare the 7 arm joints of the default pose with the mean of the dataset's first frames. If any differs by
more than START_TOL_RAD, reset to the dataset mean start pose instead (all 9 joints, fingers included).

Why 0.1 rad: on the Franka's shoulder joints, 0.1 rad moves the hand ~5 cm at the ~0.5 m reach used here, one cube
width (CUBE_SIZE = 0.05 m), and it is far inside the spread of starts the policy saw (the 13 T2 starts sit up to
0.91 rad from their own mean, on joint 7, the wrist yaw that follows the cube's yaw), so a mean start within 0.1 rad
is in-distribution. The T2 default-vs-mean gap is 0.73 rad (joint 2), outside the whole range of training starts.
Finger joints are prismatic (metres, 0..0.04) and are not compared.

`start_state.json` (written next to a LeRobot dataset by lerobot_tools.start_state / assemble) holds the first-frame
joint positions of every episode. Pure numpy + pydantic: no Isaac, no lerobot.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

import numpy as np
from pydantic import BaseModel

# isaaclab_assets FRANKA_PANDA_HIGH_PD_CFG.init_state.joint_pos (panda_joint1..7, two fingers). IsaacEvalEnv checks
# the live robot against this, so the pure check and the sim cannot silently disagree.
FRANKA_DEFAULT_JOINT_POS = (0.0, -0.569, 0.0, -2.810, 0.0, 3.037, 0.741, 0.04, 0.04)
ARM_JOINTS = 7
START_TOL_RAD = 0.1
START_STATE_FILE = "start_state.json"
Mode = Literal["auto", "default", "dataset"]


class StartCheck(BaseModel):
    n_episodes: int
    threshold_rad: float
    dataset_mean: list[float]
    reset_default: list[float]
    abs_diff: list[float]  # arm joints: |default - dataset mean|
    max_abs_diff: float
    worst_joint: int  # 0-based arm joint index of max_abs_diff
    dataset_spread: float  # max |start - mean| over episodes and arm joints
    differs: bool
    chosen: Literal["default", "dataset_mean"]
    reset_pose: list[float]


def _as_starts(starts) -> np.ndarray:
    a = np.asarray(starts, dtype=np.float64)
    if a.ndim != 2 or a.shape[0] == 0 or a.shape[1] != len(FRANKA_DEFAULT_JOINT_POS):
        raise ValueError(f"starts: expected (n_episodes >= 1, {len(FRANKA_DEFAULT_JOINT_POS)}), got {a.shape}")
    if not np.isfinite(a).all():
        raise ValueError("starts: non-finite joint positions")
    return a


def check_start(starts, default=FRANKA_DEFAULT_JOINT_POS, tol: float = START_TOL_RAD,
                mode: Mode = "auto") -> StartCheck:
    """Compare the reset pose with the dataset's first frames and choose the eval reset pose.

    mode "auto" resets to the dataset mean when the arm joints differ by more than `tol`; "default" and "dataset"
    force one pose (the comparison is still reported)."""
    if mode not in ("auto", "default", "dataset"):
        raise ValueError(f"mode must be auto, default or dataset, got {mode!r}")
    a = _as_starts(starts)
    default = np.asarray(default, dtype=np.float64)
    mean = a.mean(axis=0)
    diff = np.abs(default[:ARM_JOINTS] - mean[:ARM_JOINTS])
    differs = bool(diff.max() > tol)
    use_mean = mode == "dataset" or (mode == "auto" and differs)
    return StartCheck(
        n_episodes=len(a),
        threshold_rad=tol,
        dataset_mean=mean.tolist(),
        reset_default=default.tolist(),
        abs_diff=diff.tolist(),
        max_abs_diff=float(diff.max()),
        worst_joint=int(diff.argmax()),
        dataset_spread=float(np.abs(a[:, :ARM_JOINTS] - mean[:ARM_JOINTS]).max()),
        differs=differs,
        chosen="dataset_mean" if use_mean else "default",
        reset_pose=(mean if use_mean else default).tolist(),
    )


def _file(path: Path) -> Path:
    path = Path(path)
    return path / START_STATE_FILE if path.is_dir() else path


def save_starts(path: Path, starts, source: str) -> Path:
    """Write start_state.json into `path` (a dataset root) or to `path` itself if it isn't a directory."""
    a = _as_starts(starts)
    path = Path(path)
    out = path / START_STATE_FILE if path.is_dir() or not path.suffix else path
    out.parent.mkdir(parents=True, exist_ok=True)
    data = {"source": source, "n_episodes": len(a), "state_dim": a.shape[1], "starts": a.tolist()}
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return out


def load_starts(path: Path) -> np.ndarray:
    """First-frame joint positions from a start_state.json, or from a dataset root that contains one."""
    f = _file(path)
    if not f.is_file():
        raise FileNotFoundError(f"no {START_STATE_FILE} at {path}")
    return _as_starts(json.loads(f.read_text(encoding="utf-8"))["starts"])
