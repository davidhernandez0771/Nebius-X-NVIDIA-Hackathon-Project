"""scripts/export_mimic.py: a SANT store's verified demos -> an Isaac Lab Mimic source dataset (HDF5).

The selection runs anywhere. The HDF5 tests need h5py, which SANT's venv doesn't carry: run them with Isaac Lab's
Python, where the last tests also load the file with Isaac Lab's own HDF5DatasetFileHandler and Mimic's
DataGenInfoPool (CPU only, no simulator):

    set PYTHONPATH=src
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe -m pytest --noconftest -p no:cacheprovider tests/test_export_mimic.py tests/test_dp_mimic.py
"""
from __future__ import annotations

import json
import os
import sys
from types import SimpleNamespace as NS

import numpy as np
import pytest

import mimic_episode as fx
from demo_pipeline import mimic
from scripts import export_mimic as ex

MIMIC_SRC = os.environ.get("ISAACLAB_MIMIC_SRC", r"C:\isaac\IsaacLab\source\isaaclab_mimic")


@pytest.fixture
def store(tmp_path):
    s = tmp_path / "store"
    fx.write_demo(s, "h1_rules_home", lineage=["h1", "h1_rules", "h1_rules_home"])
    fx.write_demo(s, "h1_rules", start=[0.3, 0.1, 0.2], lineage=["h1", "h1_rules"])  # verified, but not from home
    fx.write_demo(s, "h1_rules_home_m3301", variant_seed=3301, lineage=["h1", "h1_rules", "h1_rules_home", "h1_rules_home_m3301"])
    fx.write_demo(s, "h2", success=False)
    fx.write_demo(s, "h3_rules_home", lineage=["h3", "h3_rules", "h3_rules_home"])
    return s


def test_sources_are_the_verified_perfected_demos_from_home_not_the_variants(store):
    picked = ex.select(ex.find_demos(store), "sources")
    assert [d.demo_id for d in picked] == ["h1_rules_home", "h3_rules_home"]


def test_all_takes_every_verified_demo_from_home_variants_included(store):
    picked = ex.select(ex.find_demos(store), "all")
    assert [d.demo_id for d in picked] == ["h1_rules_home", "h1_rules_home_m3301", "h3_rules_home"]


def test_a_store_with_nothing_verified_says_so(tmp_path):
    fx.write_demo(tmp_path / "s", "h2", success=False)
    with pytest.raises(SystemExit, match="no demos"):
        ex.main(["--store", str(tmp_path / "s"), "--out", str(tmp_path / "x.hdf5")])


# --- the file (needs h5py) ---------------------------------------------------------------------------


@pytest.fixture
def written(store, tmp_path):
    pytest.importorskip("h5py")
    out = tmp_path / "out" / "sant_mimic.hdf5"
    summary = ex.main(["--store", str(store), "--out", str(out)])
    return out, summary


def test_the_file_has_isaac_labs_layout_and_sants_provenance(written):
    import h5py

    out, summary = written
    assert summary["demos"] == 2 and summary["steps"] == 2 * fx.N
    with h5py.File(out, "r") as f:
        assert int(f.attrs["format_version"]) == 1  # xyzw quaternions
        data = f["data"]
        assert list(data) == ["demo_0", "demo_1"]
        assert int(data.attrs["total"]) == 2 * fx.N
        env_args = json.loads(data.attrs["env_args"])
        assert env_args == {"env_name": ex.DEFAULT_ENV, "type": 2}
        sant = json.loads(data.attrs["sant"])
        assert sant["subtasks"] == mimic.SUBTASKS and sant["eef"] == mimic.EEF
        d0 = data["demo_0"]
        assert int(d0.attrs["num_samples"]) == fx.N and bool(d0.attrs["success"]) and int(d0.attrs["seed"]) == 7
        assert d0.attrs["sant_demo_id"] == "h1_rules_home"
        assert json.loads(d0.attrs["sant_lineage"]) == ["h1", "h1_rules", "h1_rules_home"]
        assert d0["actions"].shape == (fx.N, 8)
        info = d0["obs/datagen_info"]
        assert info["eef_pose/franka"].shape == (fx.N, 4, 4)
        assert info["subtask_term_signals/grasp"].dtype == bool
        assert d0["initial_state/articulation/robot/joint_position"].shape == (1, 9)


def test_the_arrays_round_trip_exactly(written, store):
    import h5py

    out, _ = written
    want = ex.load_demo(ex.select(ex.find_demos(store), "sources")[0])
    with h5py.File(out, "r") as f:
        g = f["data/demo_0"]

        def walk(d, prefix=""):
            for k, v in d.items():
                if isinstance(v, dict):
                    walk(v, f"{prefix}{k}/")
                else:
                    got = np.asarray(g[prefix + k])
                    assert got.dtype == v.dtype, prefix + k
                    assert np.array_equal(got, v), prefix + k

        walk(want)


def test_it_refuses_to_overwrite_a_file(written):
    out, _ = written
    with pytest.raises(SystemExit, match="exists"):
        ex.main(["--store", str(out.parent.parent / "store"), "--out", str(out)])


# --- Isaac Lab's own reader and Mimic's pool (Isaac Lab's Python, CPU only) ---------------------------


def _isaaclab():
    pytest.importorskip("h5py")
    pytest.importorskip("torch")
    datasets = pytest.importorskip("isaaclab.utils.datasets")
    if MIMIC_SRC not in sys.path and os.path.isdir(MIMIC_SRC):
        sys.path.insert(0, MIMIC_SRC)
    pool = pytest.importorskip("isaaclab_mimic.datagen.datagen_info_pool")
    return datasets, pool


def test_isaac_labs_reader_loads_every_demo(written):
    datasets, _ = _isaaclab()
    out, _ = written
    h = datasets.HDF5DatasetFileHandler()
    h.open(str(out))
    try:
        assert h.get_env_name() == ex.DEFAULT_ENV
        assert h.get_num_episodes() == 2
        assert not h.is_legacy_quaternion_format()
        ep = h.load_episode("demo_0", "cpu")
        assert tuple(ep.data["actions"].shape) == (fx.N, 8)
        assert bool(ep.success)
        assert set(ep.data["obs"]["datagen_info"]) == {"eef_pose", "object_pose", "target_eef_pose", "subtask_term_signals"}
    finally:
        h.close()


def test_mimics_datagen_pool_splits_the_demos_into_grasp_then_place(written):
    _, pool_mod = _isaaclab()
    out, _ = written
    # The pool needs only these from the env: the eef's subtasks and how to read the gripper out of an action.
    subtasks = [NS(subtask_term_signal=s["term_signal"], subtask_start_offset_range=(0, 0),
                   subtask_term_offset_range=tuple(s["term_offset"])) for s in mimic.SUBTASKS]
    env_cfg = NS(subtask_configs={mimic.EEF: subtasks}, datagen_config=NS(use_skillgen=False))
    env = NS(actions_to_gripper_actions=lambda a: {mimic.EEF: a[:, -1:]})
    pool = pool_mod.DataGenInfoPool(env, env_cfg, "cpu")
    pool.load_from_dataset_file(str(out))
    assert pool.num_datagen_infos == 2
    assert pool.subtask_boundaries[mimic.EEF] == [[(0, fx.GRASP_FLAG + 1), (fx.GRASP_FLAG + 1, fx.N)]] * 2
    info = pool.datagen_infos[0]
    assert set(info.object_poses) == {"cube", "bin"}
    assert tuple(info.eef_pose[mimic.EEF].shape) == (fx.N, 4, 4)
    assert info.gripper_action[mimic.EEF][fx.CLOSE].item() == -1
