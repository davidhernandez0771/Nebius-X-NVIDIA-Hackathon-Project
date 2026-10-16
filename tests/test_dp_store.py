"""demo_pipeline.store: the on-disk demo store (demos, diagnoses, passports, lineage)."""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

import pytest

from demo_pipeline.schemas import Demo, Diagnosis, Passport, Pose, Scene, Trajectory, VerificationResult
from demo_pipeline.store import DemoStore

IDENTITY = (1.0, 0.0, 0.0, 0.0)
T0 = datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)


def _traj(n=5):
    return Trajectory(
        t=[i * 0.02 for i in range(n)],
        ee_pos=[(0.5, 0.0, 0.3 - 0.01 * i) for i in range(n)],
        ee_quat=[IDENTITY] * n,
        gripper=[0] * (n - 2) + [1, 1],
    )


def _scene():
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=7)


def _demo(id, source="human", parent_id=None, minutes=0):
    return Demo(id=id, source=source, parent_id=parent_id, trajectory=_traj(), scene=_scene(),
                created_at=T0 + timedelta(minutes=minutes), human_seconds=12.0 if source == "human" else 0.0)


def _diagnosis():
    return Diagnosis.model_validate({
        "segments": [{"name": "approach", "t0": 0.0, "t1": 0.04}],
        "issues": [{"type": "pause", "t0": 0.02, "t1": 0.04, "evidence": "speed 0"}],
        "repairs": [{"op": "remove_pause", "t0": 0.02, "t1": 0.04}],
        "decision": "repair",
        "label": "pick up the red cube and place it in the blue bin",
    })


def _passport(demo_id, lineage):
    return Passport(
        demo_id=demo_id, lineage=lineage, diagnosis_source="rules", robot="franka",
        verification=VerificationResult(success=True, duration=0.08, path_length=0.04, max_contact_force=0.0),
        pipeline_version="test",
    )


@pytest.fixture
def store(tmp_path):
    return DemoStore(tmp_path)


# --- ids ---------------------------------------------------------------------------

def test_new_id_has_prefix_timestamp_and_four_hex(store):
    assert re.fullmatch(r"human_\d{14}_[0-9a-f]{4}", store.new_id("human"))


def test_new_ids_are_unique(store):
    assert len({store.new_id("variant") for _ in range(50)}) == 50


def test_default_root_is_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "elsewhere"))
    assert DemoStore().root == tmp_path / "elsewhere"


# --- demos -------------------------------------------------------------------------

def test_demo_round_trips(store, tmp_path):
    demo = _demo("human_1")
    path = store.save_demo(demo)
    assert path == tmp_path / "demos" / "human_1" / "demo.json"
    assert store.get_demo("human_1") == demo


def test_saving_again_overwrites(store):
    store.save_demo(_demo("human_1"))
    changed = _demo("human_1").model_copy(update={"human_seconds": 99.0})
    store.save_demo(changed)
    assert store.get_demo("human_1").human_seconds == 99.0


def test_missing_demo_raises_key_error(store):
    with pytest.raises(KeyError):
        store.get_demo("nope")


@pytest.mark.parametrize("bad_id", ["../escape", "a/b", "a\\b", "..", "", "x y"])
def test_unsafe_ids_are_never_found(store, bad_id):
    with pytest.raises(KeyError):
        store.get_demo(bad_id)


def test_unsafe_id_cannot_be_saved(store):
    demo = _demo("ok").model_copy(update={"id": "../escape"})
    with pytest.raises(ValueError):
        store.save_demo(demo)


def test_has_demo(store):
    store.save_demo(_demo("human_1"))
    assert store.has_demo("human_1")
    assert not store.has_demo("human_2")
    assert not store.has_demo("../human_1")


def test_list_is_newest_first(store):
    store.save_demo(_demo("human_old", minutes=0))
    store.save_demo(_demo("human_new", minutes=10))
    store.save_demo(_demo("human_mid", minutes=5))
    assert [d.id for d in store.list_demos()] == ["human_new", "human_mid", "human_old"]


def test_list_filters_by_source(store):
    store.save_demo(_demo("human_1"))
    store.save_demo(_demo("variant_1", source="variant", parent_id="human_1", minutes=1))
    assert [d.id for d in store.list_demos(source="variant")] == ["variant_1"]
    assert [d.id for d in store.list_demos(source="human")] == ["human_1"]


def test_list_on_empty_store_is_empty(store):
    assert store.list_demos() == []


def test_list_skips_folders_without_a_demo_and_corrupt_demos(store):
    store.save_demo(_demo("human_1"))
    (store.root / "demos" / "stray").mkdir()
    (store.root / "demos" / "broken").mkdir()
    (store.root / "demos" / "broken" / "demo.json").write_text("{not json", encoding="utf-8")
    assert [d.id for d in store.list_demos()] == ["human_1"]


def test_corrupt_demo_raises_value_error_on_get(store):
    (store.root / "demos" / "broken").mkdir(parents=True)
    (store.root / "demos" / "broken" / "demo.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        store.get_demo("broken")


def test_episode_dir(store, tmp_path):
    assert store.episode_dir("human_1") == tmp_path / "demos" / "human_1" / "episode"


def test_episode_dir_rejects_unsafe_id(store):
    with pytest.raises(KeyError):
        store.episode_dir("../x")


# --- atomic writes -----------------------------------------------------------------

def test_writes_go_through_os_replace_and_leave_no_temp_files(store, monkeypatch):
    calls = []
    real_replace = os.replace

    def spy(src, dst):
        calls.append((str(src), str(dst)))
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy)
    store.save_demo(_demo("human_1"))
    assert len(calls) == 1 and calls[0][1].endswith("demo.json") and calls[0][0] != calls[0][1]
    assert sorted(p.name for p in (store.root / "demos" / "human_1").iterdir()) == ["demo.json"]


def test_failed_write_keeps_the_old_file_and_cleans_up(store, monkeypatch):
    store.save_demo(_demo("human_1"))

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        store.save_demo(_demo("human_1").model_copy(update={"human_seconds": 99.0}))
    monkeypatch.undo()
    assert store.get_demo("human_1").human_seconds == 12.0
    assert sorted(p.name for p in (store.root / "demos" / "human_1").iterdir()) == ["demo.json"]


# --- diagnoses ---------------------------------------------------------------------

def test_diagnosis_round_trips_with_source_and_model(store):
    store.save_demo(_demo("human_1"))
    store.save_diagnosis("human_1", _diagnosis(), "nemotron", "nvidia/Nemotron-3.5-Super-VL")
    assert store.get_diagnosis("human_1") == (_diagnosis(), "nemotron", "nvidia/Nemotron-3.5-Super-VL")


def test_rules_diagnosis_has_no_model(store):
    store.save_demo(_demo("human_1"))
    store.save_diagnosis("human_1", _diagnosis(), "rules", None)
    assert store.get_diagnosis("human_1") == (_diagnosis(), "rules", None)


def test_no_diagnosis_yet_is_none(store):
    store.save_demo(_demo("human_1"))
    assert store.get_diagnosis("human_1") is None


def test_diagnosis_for_missing_demo_raises_key_error(store):
    with pytest.raises(KeyError):
        store.save_diagnosis("nope", _diagnosis(), "rules", None)
    with pytest.raises(KeyError):
        store.get_diagnosis("nope")


def test_diagnosis_source_must_be_known(store):
    store.save_demo(_demo("human_1"))
    with pytest.raises(ValueError):
        store.save_diagnosis("human_1", _diagnosis(), "gpt", None)


# --- passports ---------------------------------------------------------------------

def test_passport_round_trips(store):
    store.save_demo(_demo("human_1"))
    store.save_passport("human_1", _passport("human_1", ["human_1"]))
    assert store.get_passport("human_1") == _passport("human_1", ["human_1"])


def test_no_passport_yet_is_none(store):
    store.save_demo(_demo("human_1"))
    assert store.get_passport("human_1") is None


def test_passport_for_missing_demo_raises_key_error(store):
    with pytest.raises(KeyError):
        store.save_passport("nope", _passport("nope", ["nope"]))
    with pytest.raises(KeyError):
        store.get_passport("nope")


# --- lineage -----------------------------------------------------------------------

def test_lineage_of_three_generations_is_root_first(store):
    store.save_demo(_demo("human_1"))
    store.save_demo(_demo("repaired_1", source="repaired", parent_id="human_1", minutes=1))
    store.save_demo(_demo("variant_1", source="variant", parent_id="repaired_1", minutes=2))
    assert store.lineage("variant_1") == ["human_1", "repaired_1", "variant_1"]
    assert store.lineage("repaired_1") == ["human_1", "repaired_1"]
    assert store.lineage("human_1") == ["human_1"]


def test_lineage_matches_passport_convention(store):
    store.save_demo(_demo("human_1"))
    store.save_demo(_demo("variant_1", source="variant", parent_id="human_1", minutes=1))
    _passport("variant_1", store.lineage("variant_1"))  # validates: human first, this demo last


def test_lineage_of_missing_demo_raises_key_error(store):
    with pytest.raises(KeyError):
        store.lineage("nope")


def test_lineage_with_missing_parent_raises_key_error(store):
    store.save_demo(_demo("variant_1", source="variant", parent_id="gone", minutes=1))
    with pytest.raises(KeyError):
        store.lineage("variant_1")


def test_lineage_cycle_raises_value_error(store):
    store.save_demo(_demo("a", source="variant", parent_id="b"))
    store.save_demo(_demo("b", source="variant", parent_id="a"))
    with pytest.raises(ValueError):
        store.lineage("a")
