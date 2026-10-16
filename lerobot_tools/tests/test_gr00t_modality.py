"""GR00T meta/modality.json writer. Pure tests, plus one on a real exported dataset (lerobot venv)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lerobot_tools.gr00t_modality import LAYOUTS, build_modality, write_modality

DATA = Path(__file__).parent / "data"


def _info(dim: int, cameras: list[str], names: list[str] | None = None) -> dict:
    vec = {"dtype": "float32", "shape": [dim], "names": names or [f"joint_{i}" for i in range(dim)]}
    feats = {"action": dict(vec), "observation.state": dict(vec), "timestamp": {"dtype": "float32", "shape": [1]}}
    for cam in cameras:
        feats[f"observation.images.{cam}"] = {"dtype": "video", "shape": [128, 128, 3],
                                              "names": ["height", "width", "channels"]}
    return {"codebase_version": "v3.0", "fps": 50, "features": feats}


def test_matches_nvidia_cube_to_bowl_sample():
    """The official SO-101 sample: 6-D state/action (5 arm joints + gripper), front + wrist cameras."""
    expected = json.loads((DATA / "gr00t_cube_to_bowl_5_modality.json").read_text(encoding="utf-8"))
    layout = {"single_arm": (0, 5), "gripper": (5, 6)}
    assert build_modality(_info(6, ["front", "wrist"]), layout) == expected


def test_franka_layout_covers_our_nine_joints():
    m = build_modality(_info(9, ["front", "wrist"]), LAYOUTS["franka"])
    assert m["state"] == {"arm": {"start": 0, "end": 7}, "gripper": {"start": 7, "end": 9}}
    assert m["action"] == m["state"]
    assert m["video"] == {"front": {"original_key": "observation.images.front"},
                          "wrist": {"original_key": "observation.images.wrist"}}
    assert m["annotation"] == {"human.task_description": {"original_key": "task_index"}}


def test_state_only_dataset_has_no_video_section():
    assert "video" not in build_modality(_info(9, []), LAYOUTS["franka"])


@pytest.mark.parametrize("layout, msg", [
    ({"arm": (0, 7)}, "cover"),                       # gap at the end
    ({"arm": (0, 7), "gripper": (6, 9)}, "overlap"),
    ({"arm": (0, 7), "gripper": (7, 10)}, "cover"),   # past the end
    ({"arm": (3, 2), "gripper": (2, 9)}, "empty"),
])
def test_bad_layouts_are_rejected(layout, msg):
    with pytest.raises(ValueError, match=msg):
        build_modality(_info(9, []), layout)


def test_action_layout_can_differ_from_state():
    info = _info(9, [])
    info["features"]["action"]["shape"] = [8]
    m = build_modality(info, LAYOUTS["franka"], action_layout={"arm": (0, 7), "gripper": (7, 8)})
    assert m["action"]["gripper"] == {"start": 7, "end": 8}


def test_write_modality_reads_info_and_writes_meta(tmp_path):
    (tmp_path / "meta").mkdir()
    (tmp_path / "meta" / "info.json").write_text(json.dumps(_info(9, ["front"])), encoding="utf-8")
    path = write_modality(tmp_path, robot="franka")
    assert path == tmp_path / "meta" / "modality.json"
    assert json.loads(path.read_text(encoding="utf-8"))["video"] == {
        "front": {"original_key": "observation.images.front"}}
    with pytest.raises(KeyError, match="unknown robot"):
        write_modality(tmp_path, robot="so101")


def test_on_a_real_exported_dataset(tmp_path):
    pytest.importorskip("lerobot")
    from lerobot_tools.export import export_episodes
    from lerobot_tools.train_smoke import FPS, make_synthetic_episodes

    root = export_episodes(make_synthetic_episodes(tmp_path / "eps", n_episodes=2, n_steps=10), tmp_path / "ds",
                           repo_id="local/gr00t_test", fps=FPS)
    m = json.loads(write_modality(root, robot="franka").read_text(encoding="utf-8"))
    assert set(m["video"]) == {"front", "wrist"}
    assert m["state"]["gripper"] == {"start": 7, "end": 9}
