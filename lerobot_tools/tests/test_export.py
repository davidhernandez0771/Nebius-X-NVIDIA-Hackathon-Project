"""Exporter tests. Run with the lerobot venv:  C:\\venvs\\lerobot\\Scripts\\python.exe -m pytest -q lerobot_tools\\tests"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

# The repo-wide `pytest` run (SANT venv) collects this folder too; lerobot only lives in C:\venvs\lerobot.
pytest.importorskip("lerobot")
from PIL import Image  # noqa: E402  (ships with lerobot)

from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode
from demo_pipeline.schemas import Passport, VerificationResult
from lerobot_tools.export import export_episodes

TASK = "pick up the red cube and place it in the blue bin"
REPO_ID = "local/test_export"
N_JOINTS = 9
IMG = 128


def make_episode(root: Path, demo_id: str, n_steps: int, cameras: list[str], seed: int = 0) -> Path:
    rng = np.random.default_rng(seed)
    passport = Passport(
        demo_id=demo_id,
        lineage=[demo_id],
        diagnosis_source="none",
        robot="franka",
        verification=VerificationResult(success=True, duration=n_steps / 50, path_length=0.5, max_contact_force=1.0),
        pipeline_version="test",
    )
    meta = EpisodeMeta(demo_id=demo_id, robot="franka", task_text=TASK, fps=50, n_steps=n_steps,
                       cameras=cameras, passport=passport)
    quat = np.zeros((n_steps, 4))
    quat[:, 0] = 1.0
    arrays = {
        "joint_pos": rng.normal(size=(n_steps, N_JOINTS)).astype(np.float32),
        "action": rng.normal(size=(n_steps, N_JOINTS)).astype(np.float32),
        "ee_pos": rng.normal(size=(n_steps, 3)),
        "ee_quat": quat,
        "gripper": (np.arange(n_steps) > n_steps // 2).astype(np.int8),
    }
    ep_dir = save_episode(root / demo_id, meta, arrays)
    for cam in cameras:
        for i in range(n_steps):
            px = rng.integers(0, 256, size=(IMG, IMG, 3), dtype=np.uint8)
            Image.fromarray(px).save(image_path(ep_dir, cam, i))
    return ep_dir


def load_dataset(out: Path):
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    # torchcodec can't load on this machine (no shared FFmpeg 4-8); PyAV ships its own. See the t3-lerobot-windows note.
    return LeRobotDataset(REPO_ID, root=out, video_backend="pyav")


def test_export_two_episodes_and_reload(tmp_path):
    eps = [
        make_episode(tmp_path / "eps", "demo_a", 12, ["front", "wrist"], seed=1),
        make_episode(tmp_path / "eps", "demo_b", 7, ["front", "wrist"], seed=2),
    ]
    out = export_episodes(eps, tmp_path / "ds", repo_id=REPO_ID, fps=50)

    ds = load_dataset(out)
    assert ds.num_episodes == 2
    assert ds.num_frames == 12 + 7
    lengths = [int(ds.meta.episodes[i]["length"]) for i in range(2)]
    assert lengths == [12, 7]
    for key in ("observation.state", "action", "observation.images.front", "observation.images.wrist"):
        assert key in ds.meta.features

    first = ds[0]
    assert first["task"] == TASK
    assert tuple(first["observation.state"].shape) == (N_JOINTS,)
    assert tuple(first["observation.images.front"].shape) == (3, IMG, IMG)

    # The joint state round-trips: frame 0 of episode b is global index 12.
    with np.load(eps[1] / "steps.npz") as npz:
        want = npz["joint_pos"][0]
    np.testing.assert_allclose(ds[12]["observation.state"].numpy(), want, rtol=1e-6)


def test_export_state_only_episode(tmp_path):
    """Review Focus 5: cameras=[] must still export."""
    ep = make_episode(tmp_path / "eps", "demo_s", 5, [], seed=3)
    out = export_episodes([ep], tmp_path / "ds", repo_id=REPO_ID, fps=50)

    ds = load_dataset(out)
    assert ds.num_episodes == 1
    assert ds.num_frames == 5
    assert not any(k.startswith("observation.images.") for k in ds.meta.features)
    assert ds[4]["task"] == TASK


def test_passports_are_written_per_episode(tmp_path):
    eps = [
        make_episode(tmp_path / "eps", "demo_a", 4, [], seed=4),
        make_episode(tmp_path / "eps", "demo_b", 4, [], seed=5),
    ]
    out = export_episodes(eps, tmp_path / "ds", repo_id=REPO_ID, fps=50)

    lines = (out / "passports.jsonl").read_text(encoding="utf-8").splitlines()
    rows = [json.loads(line) for line in lines]
    assert [r["episode_index"] for r in rows] == [0, 1]
    assert [r["passport"]["demo_id"] for r in rows] == ["demo_a", "demo_b"]


def test_mixed_camera_sets_are_rejected(tmp_path):
    """One dataset has one feature schema; silently dropping a camera would be worse than failing."""
    eps = [
        make_episode(tmp_path / "eps", "demo_a", 4, ["front"], seed=6),
        make_episode(tmp_path / "eps", "demo_b", 4, [], seed=7),
    ]
    with pytest.raises(ValueError, match="cameras"):
        export_episodes(eps, tmp_path / "ds", repo_id=REPO_ID, fps=50)


def test_fps_mismatch_is_rejected(tmp_path):
    ep = make_episode(tmp_path / "eps", "demo_a", 4, [], seed=8)
    with pytest.raises(ValueError, match="fps"):
        export_episodes([ep], tmp_path / "ds", repo_id=REPO_ID, fps=30)
