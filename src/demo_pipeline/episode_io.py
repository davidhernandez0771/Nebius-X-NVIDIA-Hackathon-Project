"""On-disk episode format: written by the sim worker's verifier, read by the LeRobot exporter.

<ep_dir>/episode.json   EpisodeMeta
<ep_dir>/steps.npz      joint_pos [N,J], action [N,J], ee_pos [N,3], ee_quat [N,4] (w,x,y,z), gripper [N]
<ep_dir>/signals.npz    SimSignals (cube_pos, contacts, max_contact_force), optional, written by the verifier
<ep_dir>/<camera>/000000.png ...   one RGB image per step per camera
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from .schemas import Passport, RobotName, SimSignals

# name -> required trailing shape (None = any width)
REQUIRED_ARRAYS: dict[str, tuple[int | None, ...]] = {
    "joint_pos": (None,),
    "action": (None,),
    "ee_pos": (3,),
    "ee_quat": (4,),
    "gripper": (),
}


class EpisodeMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    demo_id: str
    robot: RobotName
    task_text: str
    fps: int = Field(gt=0)
    n_steps: int = Field(gt=0)
    cameras: list[str] = Field(default_factory=list)
    passport: Passport | None = None


def image_path(ep_dir: Path, camera: str, step: int) -> Path:
    return Path(ep_dir) / camera / f"{step:06d}.png"


def _check_arrays(meta: EpisodeMeta, arrays: dict[str, np.ndarray]) -> None:
    missing = set(REQUIRED_ARRAYS) - set(arrays)
    if missing:
        raise ValueError(f"missing arrays: {sorted(missing)}")
    for name, tail in REQUIRED_ARRAYS.items():
        a = arrays[name]
        if a.shape[0] != meta.n_steps or a.ndim != 1 + len(tail):
            raise ValueError(f"{name} has shape {a.shape}; expected ({meta.n_steps}, ...) with {1 + len(tail)} dims")
        if any(want is not None and got != want for want, got in zip(tail, a.shape[1:])):
            raise ValueError(f"{name} has shape {a.shape}; expected trailing shape {tail}")


def save_episode(ep_dir: Path, meta: EpisodeMeta, arrays: dict[str, np.ndarray]) -> Path:
    """Validate and write episode.json + steps.npz, and create one folder per camera. Images are written by the caller via image_path()."""
    _check_arrays(meta, arrays)
    ep_dir = Path(ep_dir)
    ep_dir.mkdir(parents=True, exist_ok=True)
    (ep_dir / "episode.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")
    np.savez(ep_dir / "steps.npz", **{k: arrays[k] for k in REQUIRED_ARRAYS})
    for cam in meta.cameras:
        (ep_dir / cam).mkdir(exist_ok=True)
    return ep_dir


_SIGNAL_FIELDS = ("cube_pos", "contact_gripper_cube", "contact_arm_bin", "contact_arm_table", "max_contact_force")


def save_signals(ep_dir: Path, signals: SimSignals) -> Path:
    """Write <ep_dir>/signals.npz so a recorded episode can be measured and diagnosed later."""
    ep_dir = Path(ep_dir)
    ep_dir.mkdir(parents=True, exist_ok=True)
    path = ep_dir / "signals.npz"
    np.savez(path, **{k: getattr(signals, k) for k in _SIGNAL_FIELDS})
    return path


def load_signals(ep_dir: Path) -> SimSignals | None:
    """Read <ep_dir>/signals.npz, or None if the episode has none."""
    path = Path(ep_dir) / "signals.npz"
    if not path.exists():
        return None
    with np.load(path) as npz:
        return SimSignals(**{k: npz[k] for k in _SIGNAL_FIELDS})


def load_episode(ep_dir: Path) -> tuple[EpisodeMeta, dict[str, np.ndarray], dict[str, list[Path]]]:
    ep_dir = Path(ep_dir)
    meta = EpisodeMeta.model_validate_json((ep_dir / "episode.json").read_text(encoding="utf-8"))
    with np.load(ep_dir / "steps.npz") as npz:
        arrays = {k: npz[k] for k in npz.files}
    images = {cam: [image_path(ep_dir, cam, i) for i in range(meta.n_steps)] for cam in meta.cameras}
    return meta, arrays, images
