"""demo_pipeline.export_robota: a tiny LeRobot-style dataset (manifest + source episode folders) -> anchors on disk."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from demo_pipeline import robota
from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode, save_signals
from demo_pipeline.export_robota import export, main
from demo_pipeline.schemas import SimSignals

FPS = 10
N = 40  # 4 s per episode
TASK = "pick up the red cube and place it in the blue bin"
BIN = [0.4, -0.25, 0.0]


def _episode(root: Path, demo_id: str, lineage: list[str], seed: int, success: bool = True) -> Path:
    rng = np.random.default_rng(seed)
    ep_dir = root / "episodes" / demo_id
    g = np.zeros(N, dtype=np.int8)
    g[12:30] = 1
    cube = np.tile([0.5, 0.0, 0.025], (N, 1))
    cube[18:24] = [0.5, 0.0, 0.2]
    cube[24:] = [0.4, -0.25, 0.035]
    action = rng.normal(size=(N, 9)).astype(np.float32) + seed
    passport = {"demo_id": demo_id, "lineage": lineage, "diagnosis_source": "none", "robot": "franka",
                "verification": {"success": success, "duration": N / FPS, "path_length": 1.0, "max_contact_force": 0.0},
                "pipeline_version": "0.1.0"}
    meta = EpisodeMeta(demo_id=demo_id, robot="franka", task_text=TASK, fps=FPS, n_steps=N, cameras=["front"],
                       passport=passport)
    save_episode(ep_dir, meta, {
        "joint_pos": action.copy(), "action": action, "ee_pos": np.tile([0.5, 0.0, 0.3], (N, 1)).astype(np.float32),
        "ee_quat": np.tile([0, 1, 0, 0], (N, 1)).astype(np.float32), "gripper": g})
    save_signals(ep_dir, SimSignals(cube_pos=cube, contact_gripper_cube=g.astype(bool),
                                    contact_arm_bin=np.zeros(N, bool), contact_arm_table=np.zeros(N, bool),
                                    max_contact_force=np.zeros(N)))
    (ep_dir / "scene.json").write_text(json.dumps({
        "cube_pose": {"pos": cube[0].tolist(), "quat_wxyz": [1, 0, 0, 0]},
        "bin_pose": {"pos": BIN, "quat_wxyz": [1, 0, 0, 0]}, "robot": "franka", "seed": seed}))
    for i in range(N):
        Image.new("RGB", (128, 128), (i * 6, 100, 50)).save(image_path(ep_dir, "front", i))
    return ep_dir


@pytest.fixture
def dataset(tmp_path):
    """4 source demos x 2 episodes (the source + one variant), plus one failed variant."""
    ds = tmp_path / "ds"
    (ds / "meta").mkdir(parents=True)
    entries, passports = [], []
    specs = []
    for r in range(4):
        root = f"src_{r}"
        specs += [(root, [root], True), (f"{root}_v", [root, f"{root}_v"], True)]
    specs.append(("src_0_bad", ["src_0", "src_0_bad"], False))
    for i, (demo_id, lineage, ok) in enumerate(specs):
        ep_dir = _episode(tmp_path, demo_id, lineage, seed=i, success=ok)
        entries.append({"episode_index": i, "episode_dir": str(ep_dir), "demo_id": demo_id, "n_steps": N,
                        "robot": "franka", "has_passport": True, "lineage": lineage, "human_root": lineage[0]})
        meta = json.loads((ep_dir / "episode.json").read_text())
        passports.append({"episode_index": i, "demo_id": demo_id, "passport": meta["passport"]})
    (ds / "manifest.json").write_text(json.dumps({"repo_id": "local/tiny", "fps": FPS, "episodes": entries}))
    (ds / "passports.jsonl").write_text("".join(json.dumps(p) + "\n" for p in passports))
    (ds / "meta" / "info.json").write_text(json.dumps({
        "codebase_version": "v3.0", "fps": FPS, "robot_type": "franka",
        "features": {"action": {"dtype": "float32", "shape": [9], "names": [f"joint_{i}" for i in range(9)]},
                     "observation.images.front": {"dtype": "video", "shape": [128, 128, 3]}}}))
    return ds


def _run(dataset, out, **kw):
    params = dict(stride_s=0.5, horizon_s=1.0, frames=4, val_frac=0.25, test_frac=0.25)
    params.update(kw)
    return export(dataset, out, **params)


def _anchors(out):
    return [json.loads(line) for line in (out / "anchors.jsonl").read_text(encoding="utf-8").splitlines()]


def test_export_writes_anchors_crops_manifest_and_readme(dataset, tmp_path):
    out = tmp_path / "out"
    manifest = _run(dataset, out)
    anchors = _anchors(out)
    assert (out / "README.md").exists()
    assert json.loads((out / "manifest.json").read_text()) == manifest
    # horizon 10 steps, stride 5: t + 11 < 40 allows 0, 5, ..., 25; the IoU dedup keeps 0, 10, 20
    per_ep = robota.dedup_anchors(robota.anchor_steps(N, 5, 10), 10)
    assert per_ep == [0, 10, 20]
    assert manifest["totals"]["anchors"] == len(anchors) == 8 * len(per_ep)  # the failed episode is skipped
    assert manifest["skipped"] == {"unverified": 1}
    a = anchors[0]
    assert a["query"]["instruction"] == a["target"]["instruction"] == TASK
    assert len(a["query"]["action"]["norm"]) == robota.PAD_DIM and len(a["query"]["action"]["raw"]) == 9
    assert a["target"]["window"] == [a["t"] + 1, a["t"] + 10]
    assert len(a["target"]["frame_index"]) == 4 and a["target"]["frame_index"][0] == a["t"] + 1
    assert len(a["target"]["actions"]["raw"]) == 10 and len(a["target"]["actions"]["norm"][0]) == robota.PAD_DIM
    assert a["labels"]["object_roles"] == {"cube": "manipulated", "bin": "target"}
    assert a["labels"]["phase"] in robota.PHASES and len(a["labels"]["target_phases"]) == 4
    with Image.open(out / a["query"]["crop"]) as im:
        assert im.size == (robota.CROP_W, robota.CROP_H) and im.format == "JPEG"
    assert manifest["action"]["names"] == robota.ACTION_NAMES["franka"]
    assert manifest["format_version"] == robota.FORMAT_VERSION


def test_no_source_demo_crosses_splits_and_stats_come_from_train(dataset, tmp_path):
    out = tmp_path / "out"
    manifest = _run(dataset, out)
    anchors = _anchors(out)
    by_source: dict[str, set[str]] = {}
    for a in anchors:
        by_source.setdefault(a["source_demo"], set()).add(a["split"])
    assert all(len(s) == 1 for s in by_source.values())
    assert {s for v in by_source.values() for s in v} == {"train", "val", "test"}
    train_dirs = [e["episode_dir"] for e in json.loads((dataset / "manifest.json").read_text())["episodes"]
                  if by_source.get(e["human_root"]) == {"train"} and not e["demo_id"].endswith("_bad")]
    train = np.concatenate([np.load(Path(d) / "steps.npz")["action"] for d in train_dirs])
    assert manifest["action"]["normalization"]["q01"] == pytest.approx(np.quantile(train, 0.01, axis=0))
    a = anchors[0]
    want = robota.normalize(np.array(a["query"]["action"]["raw"]), manifest["action"]["normalization"]["q01"],
                            manifest["action"]["normalization"]["q99"])
    assert a["query"]["action"]["norm"][:9] == pytest.approx(want, abs=1e-5)
    counts = manifest["splits"]
    assert sum(c["anchors"] for c in counts.values()) == len(anchors)
    assert sum(c["sources"] for c in counts.values()) == 4


def test_export_refuses_a_non_empty_out_dir(dataset, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "x").write_text("keep me")
    with pytest.raises(FileExistsError):
        _run(dataset, out)


def test_cli_runs_with_defaults_for_rate_and_frames(dataset, tmp_path, capsys):
    out = tmp_path / "cli"
    main(["--dataset", str(dataset), "--out", str(out), "--horizon-s", "1.0", "--frames", "4",
          "--val-frac", "0.25", "--test-frac", "0.25"])
    assert "anchors" in capsys.readouterr().out
    assert (out / "anchors.jsonl").exists()
