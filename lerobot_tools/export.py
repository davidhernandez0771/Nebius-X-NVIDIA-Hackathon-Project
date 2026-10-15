"""Export verified episodes (demo_pipeline.episode_io format) to a LeRobot v3.0 dataset.

Lives outside demo_pipeline because it imports lerobot (purity rule). Run in C:\\venvs\\lerobot.
API notes (lerobot 0.6.1): docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from demo_pipeline.episode_io import EpisodeMeta, load_episode

PASSPORTS_FILE = "passports.jsonl"


def _image_key(camera: str) -> str:
    return f"observation.images.{camera}"


def _read_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)  # HWC


def _features(meta: EpisodeMeta, arrays: dict[str, np.ndarray], images: dict[str, list[Path]]) -> dict:
    n_joints, n_act = arrays["joint_pos"].shape[1], arrays["action"].shape[1]
    features = {
        "observation.state": {"dtype": "float32", "shape": (n_joints,), "names": [f"joint_{i}" for i in range(n_joints)]},
        "action": {"dtype": "float32", "shape": (n_act,), "names": [f"joint_{i}" for i in range(n_act)]},
    }
    for cam in meta.cameras:
        h, w, c = _read_rgb(images[cam][0]).shape
        features[_image_key(cam)] = {"dtype": "video", "shape": (h, w, c), "names": ["height", "width", "channels"]}
    return features


def export_episodes(
    ep_dirs: list[Path], out_root: Path, repo_id: str = "local/perfect_then_multiply", fps: int = 50
) -> Path:
    """Write one LeRobot dataset at `out_root` (must not exist yet) and `out_root/passports.jsonl`. Returns `out_root`.

    Features: observation.state = joint_pos, action = action, observation.images.<camera> for each camera in
    meta.cameras (video). Every episode must share the same cameras and fps; state-only episodes (cameras=[]) are fine.
    """
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    if not ep_dirs:
        raise ValueError("no episodes to export")
    out_root = Path(out_root)
    episodes = [load_episode(Path(d)) for d in ep_dirs]

    first_meta = episodes[0][0]
    for meta, _, _ in episodes:
        if meta.fps != fps:
            raise ValueError(f"episode {meta.demo_id} has fps {meta.fps}, export fps is {fps}")
        if meta.cameras != first_meta.cameras:
            raise ValueError(
                f"episode {meta.demo_id} has cameras {meta.cameras}, but {first_meta.demo_id} has {first_meta.cameras}; "
                "one dataset needs one camera set"
            )

    ds = LeRobotDataset.create(
        repo_id,
        fps=fps,
        features=_features(*episodes[0]),
        root=out_root,
        robot_type=first_meta.robot,
        use_videos=True,
    )
    passports = []
    for ep_index, (meta, arrays, images) in enumerate(episodes):
        state = arrays["joint_pos"].astype(np.float32)
        action = arrays["action"].astype(np.float32)
        for i in range(meta.n_steps):
            frame = {"observation.state": state[i], "action": action[i], "task": meta.task_text}
            for cam in meta.cameras:
                frame[_image_key(cam)] = _read_rgb(images[cam][i])
            ds.add_frame(frame)
        ds.save_episode()
        passports.append({
            "episode_index": ep_index,
            "demo_id": meta.demo_id,
            "passport": meta.passport.model_dump(mode="json") if meta.passport else None,
        })
    ds.finalize()

    with (out_root / PASSPORTS_FILE).open("w", encoding="utf-8") as f:
        for row in passports:
            f.write(json.dumps(row) + "\n")
    return out_root
