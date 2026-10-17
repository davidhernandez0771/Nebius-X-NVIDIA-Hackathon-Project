"""sim_worker.setrender: render a frozen demo set (T1's set v2) and tabulate verification per demo type (pure)."""

from __future__ import annotations

import json

import pytest

from demo_pipeline.degrade import InjectedIssue
from demo_pipeline.schemas import Demo, Pose, Scene
from sim_worker.scripted import scripted_expert
from sim_worker.setrender import copy_case_files, must_fail, outcome_table, set_entries

SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1, 0, 0, 0)),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1, 0, 0, 0)), robot="franka", seed=7)


def _write_set(root, entries):
    root.mkdir(parents=True, exist_ok=True)
    for e in entries:
        d = root / e["id"]
        d.mkdir()
        traj = scripted_expert(SCENE)
        demo = Demo(id=e["id"], source="human", trajectory=traj, scene=SCENE, human_seconds=traj.duration)
        (d / "demo.json").write_text(demo.model_dump_json(), encoding="utf-8")
        (d / "truth.json").write_text(json.dumps({"issues": e.get("issues", [])}), encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps({"name": "v2", "demos": entries}), encoding="utf-8")


def test_set_entries_read_the_manifest_in_order_with_their_files(tmp_path):
    _write_set(tmp_path / "v2", [{"id": "v2_0001", "type": "drop"}, {"id": "v2_0000", "type": "clean"}])
    got = set_entries(tmp_path / "v2")
    assert [(e.id, e.type) for e in got] == [("v2_0001", "drop"), ("v2_0000", "clean")]
    assert got[0].demo.id == "v2_0001" and got[0].demo.scene == SCENE
    assert got[0].truth == {"issues": []}


def test_set_entries_fail_loudly_on_a_missing_demo(tmp_path):
    _write_set(tmp_path / "v2", [{"id": "v2_0000", "type": "clean"}])
    (tmp_path / "v2" / "v2_0000" / "demo.json").unlink()
    with pytest.raises(FileNotFoundError):
        set_entries(tmp_path / "v2")


def test_an_entry_without_a_type_is_unknown(tmp_path):
    _write_set(tmp_path / "v2", [{"id": "v2_0000"}])
    assert set_entries(tmp_path / "v2")[0].type == "unknown"


@pytest.mark.parametrize("issues,expected", [
    ([], False),
    ([InjectedIssue(type="pause", t0=1, t1=2)], False),
    ([InjectedIssue(type="drop", t0=3, t1=3)], True),
    ([InjectedIssue(type="bad_release", t0=5, t1=5)], True),
    ([InjectedIssue(type="drop", t0=3, t1=3, dont_care=True)], False),
])
def test_must_fail_is_read_from_the_truth_not_the_type_name(issues, expected):
    assert must_fail({"issues": [i.model_dump() for i in issues]}) is expected


def test_outcome_table_counts_per_type_and_lists_must_fail_demos_that_verified():
    rows = [
        {"id": "a", "type": "drop", "must_fail": True, "success": False, "reasons": ["not_in_bin"]},
        {"id": "b", "type": "drop", "must_fail": True, "success": True, "reasons": []},
        {"id": "c", "type": "clean", "must_fail": False, "success": True, "reasons": []},
        {"id": "d", "type": "clean", "must_fail": False, "success": False, "reasons": ["sim_error"]},
    ]
    table = outcome_table(rows)
    assert table["drop"] == {"n": 2, "verified": 1, "failed": 1, "reasons": {"not_in_bin": 1},
                             "must_fail": 2, "violations": ["b"], "sim_errors": []}
    assert table["clean"]["sim_errors"] == ["d"] and table["clean"]["violations"] == []


def test_copy_case_files_keeps_t1s_demo_and_truth_verbatim(tmp_path):
    _write_set(tmp_path / "v2", [{"id": "v2_0000", "type": "drop",
                                  "issues": [InjectedIssue(type="drop", t0=3, t1=3).model_dump()]}])
    entry = set_entries(tmp_path / "v2")[0]
    ep = tmp_path / "episodes" / "v2_0000"
    copy_case_files(entry, ep)
    for name in ("demo.json", "truth.json"):
        assert (ep / name).read_bytes() == (tmp_path / "v2" / "v2_0000" / name).read_bytes()
