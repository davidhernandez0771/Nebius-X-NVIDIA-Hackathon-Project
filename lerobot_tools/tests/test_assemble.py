"""Dataset assembly per experiment cell. Manifest/validation tests are pure; the export test needs lerobot."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from demo_pipeline.episode_io import EpisodeMeta, save_episode
from demo_pipeline.schemas import Passport, VerificationResult
from lerobot_tools.assemble import MANIFEST_FILE, Cell, assemble, build_manifest

TASK = "pick up the red cube and place it in the blue bin"


def make_episode(root: Path, demo_id: str, lineage: list[str] | None, n_steps: int = 8,
                 repairs: list | None = None, source: str = "none") -> Path:
    passport = None
    if lineage is not None:
        passport = Passport(
            demo_id=demo_id, lineage=lineage, repairs_applied=repairs or [], diagnosis_source=source,
            robot="franka", pipeline_version="test",
            verification=VerificationResult(success=True, duration=n_steps / 50, path_length=0.4,
                                            max_contact_force=1.0),
        )
    meta = EpisodeMeta(demo_id=demo_id, robot="franka", task_text=TASK, fps=50, n_steps=n_steps, cameras=[],
                       passport=passport)
    rng = np.random.default_rng(len(demo_id))
    quat = np.tile([1.0, 0.0, 0.0, 0.0], (n_steps, 1))
    arrays = {
        "joint_pos": rng.normal(size=(n_steps, 9)).astype(np.float32),
        "action": rng.normal(size=(n_steps, 9)).astype(np.float32),
        "ee_pos": rng.normal(size=(n_steps, 3)),
        "ee_quat": quat,
        "gripper": np.zeros(n_steps, dtype=np.int8),
    }
    return save_episode(root / demo_id, meta, arrays)


@pytest.fixture
def multiply_eps(tmp_path):
    eps = tmp_path / "eps"
    return [
        make_episode(eps, "h0", ["h0"], n_steps=8),
        make_episode(eps, "h1", ["h1"], n_steps=6),
        make_episode(eps, "h0_v0", ["h0", "h0_v0"], n_steps=7),
        make_episode(eps, "h0_v1", ["h0", "h0_v1"], n_steps=9),
        make_episode(eps, "h1_v0", ["h1", "h1_v0"], n_steps=5),
    ]


def test_cell_name_and_validation(multiply_eps):
    assert Cell(condition="raw_multiply", n_human=2, episode_dirs=multiply_eps).name == "raw_multiply_2"
    with pytest.raises(ValidationError):
        Cell(condition="raw_multiply", n_human=2, episode_dirs=[])
    with pytest.raises(ValidationError):
        Cell(condition="magic", n_human=2, episode_dirs=multiply_eps)
    with pytest.raises(ValidationError):
        Cell(condition="raw", n_human=0, episode_dirs=multiply_eps)


def test_manifest_records_lineage_from_passports(multiply_eps):
    m = build_manifest(Cell(condition="raw_multiply", n_human=2, episode_dirs=multiply_eps))
    assert m["cell"] == {"condition": "raw_multiply", "n_human": 2, "name": "raw_multiply_2"}
    assert m["n_episodes"] == 5 and m["n_frames"] == 8 + 6 + 7 + 9 + 5
    assert m["human_roots"] == ["h0", "h1"]
    third = m["episodes"][2]
    assert third["episode_index"] == 2
    assert third["demo_id"] == "h0_v0"
    assert third["lineage"] == ["h0", "h0_v0"]
    assert third["human_root"] == "h0"
    assert third["has_passport"] is True
    assert Path(third["episode_dir"]) == multiply_eps[2].resolve()


def test_episode_without_passport_is_its_own_root(tmp_path):
    ep = make_episode(tmp_path, "raw_a", None)
    row = build_manifest(Cell(condition="raw", n_human=1, episode_dirs=[ep]))["episodes"][0]
    assert row["lineage"] == ["raw_a"] and row["has_passport"] is False and row["diagnosis_source"] is None


def test_more_human_roots_than_n_human_is_rejected(multiply_eps):
    with pytest.raises(ValueError, match="2 human demos .* n_human=1"):
        build_manifest(Cell(condition="raw_multiply", n_human=1, episode_dirs=multiply_eps))


def test_raw_conditions_reject_repaired_episodes(tmp_path):
    ep = make_episode(tmp_path, "h0_fixed", ["h0", "h0_fixed"], repairs=[{"op": "remove_pause", "t0": 1.0, "t1": 1.5}],
                      source="rules")
    with pytest.raises(ValueError, match="repairs"):
        build_manifest(Cell(condition="raw_multiply", n_human=1, episode_dirs=[ep]))
    m = build_manifest(Cell(condition="rules_multiply", n_human=1, episode_dirs=[ep]))
    assert m["episodes"][0]["repairs"] == ["remove_pause"]
    assert m["diagnosis_sources"] == {"rules": 1}


def test_assemble_exports_matching_counts_and_writes_manifest(multiply_eps, tmp_path):
    pytest.importorskip("lerobot")
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    cell = Cell(condition="raw_multiply", n_human=2, episode_dirs=multiply_eps)
    out = assemble(cell, tmp_path / "datasets")
    assert out == tmp_path / "datasets" / "raw_multiply_2"
    ds = LeRobotDataset("local/raw_multiply_2", root=out, video_backend="pyav")
    assert ds.num_episodes == 5
    assert ds.num_frames == 35
    assert [ds.meta.episodes[i]["length"] for i in range(5)] == [8, 6, 7, 9, 5]
    manifest = json.loads((out / MANIFEST_FILE).read_text(encoding="utf-8"))
    assert manifest["dataset"] == str(out.resolve())
    assert manifest["repo_id"] == "local/raw_multiply_2"
    assert manifest["n_episodes"] == ds.num_episodes and manifest["n_frames"] == ds.num_frames
    with pytest.raises(FileExistsError):
        assemble(cell, tmp_path / "datasets")
