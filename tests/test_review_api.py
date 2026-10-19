"""GET /demos/{id}/review: the Review page's verdict card data (physics, the stored Nemotron verdict, fixes)."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from demo_pipeline.episode_io import EpisodeMeta, save_episode, save_signals
from demo_pipeline.schemas import Demo, Passport, Pose, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.store import DemoStore
from demo_pipeline.success import check_success

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
T0 = datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)
N = 100  # 2 s at 50 Hz
CLOSE_STEP, OPEN_STEP = 40, 80


@pytest.fixture
def review_api(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    return api


@pytest.fixture
def store(review_api, tmp_path):
    return DemoStore(tmp_path / "data")


def _traj(n=N):
    t = [i * 0.02 for i in range(n)]
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if CLOSE_STEP <= i < OPEN_STEP else 0 for i in range(n)]
    return Trajectory(t=t, ee_pos=pos, ee_quat=[DOWN] * n, gripper=grip)


def _scene():
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=7)


def _demo(id="human_1", source="human", parent_id=None, minutes=0):
    return Demo(id=id, source=source, parent_id=parent_id, trajectory=_traj(), scene=_scene(),
                created_at=T0 + timedelta(minutes=minutes), human_seconds=10.0 if source == "human" else 0.0)


def _signals(n=N):
    traj = _traj(n).to_arrays()
    cube = np.tile([0.5, 0.0, 0.025], (n, 1))
    cube[CLOSE_STEP:] = traj["ee_pos"][CLOSE_STEP:]
    cube[OPEN_STEP:] = [0.5, 0.3, 0.025]
    grip = np.zeros(n, dtype=bool)
    grip[CLOSE_STEP:OPEN_STEP] = True
    return SimSignals(cube_pos=cube, contact_gripper_cube=grip, contact_arm_bin=np.zeros(n, dtype=bool),
                      contact_arm_table=np.zeros(n, dtype=bool), max_contact_force=np.zeros(n))


def _write_episode(store, demo_id="human_1", *, signals=True, passport=None):
    ep = store.episode_dir(demo_id)
    meta = EpisodeMeta(demo_id=demo_id, robot="franka", task_text="pick up the red cube", fps=50, n_steps=N,
                       cameras=["front"], passport=passport)
    traj = _traj().to_arrays()
    save_episode(ep, meta, {"joint_pos": np.zeros((N, 9)), "action": np.zeros((N, 9)), "ee_pos": traj["ee_pos"],
                            "ee_quat": traj["ee_quat"], "gripper": traj["gripper"]})
    if signals:
        save_signals(ep, _signals())


REPAIRS = [{"op": "trim", "t0": 0.0, "t1": 1.8}, {"op": "remove_pause", "t0": 0.4, "t1": 0.9},
           {"op": "smooth", "t0": 0.0, "t1": 1.8, "strength": "med"}]


def _passport(demo_id, lineage, *, success=True, reasons=(), repairs=(), source="rules"):
    return Passport.model_validate({
        "demo_id": demo_id, "lineage": lineage, "repairs_applied": list(repairs), "diagnosis_source": source,
        "robot": "franka", "pipeline_version": "test",
        "verification": {"success": success, "reasons": list(reasons), "duration": 1.8, "path_length": 0.42,
                         "max_contact_force": 0.0, "settle_time": 0.6},
    })


# A ReviewVerdict in the shape of docs/design/nemotron-judge.md, test data only.
def _verdict(physics="verified", match="yes"):
    return {
        "physics": {"status": physics, "reasons": [] if physics == "verified" else ["dropped"]},
        "label": {"status": "ok", "task": "The robot picks up a red cube and places it inside a blue bin.",
                  "object": {"name": "cube", "color": "red"}, "destination": "bin",
                  "steps": [{"name": "reach", "frames": [0, 39]}, {"name": "grasp", "frames": [40, 45]},
                            {"name": "carry", "frames": [46, 79]}, {"name": "release", "frames": [80, 99]}],
                  "error": None},
        "match": {"status": match,
                  "checks": {"same_object": True, "same_goal": True, "same_order": True, "copy_completes": True},
                  "reason": "Both demos move the same red cube into the blue bin."},
        "conflict": None,
    }


def _perfected(store, review_api, *, success=True, reasons=()):
    """A human demo and its repaired child, the child with a passport (the fixes Neaten applied)."""
    store.save_demo(_demo())
    store.save_demo(_demo("human_1_rules", "repaired", "human_1", minutes=3))
    store.save_passport("human_1_rules", _passport("human_1_rules", ["human_1", "human_1_rules"],
                                                   success=success, reasons=reasons, repairs=REPAIRS))


def test_unknown_demo_is_404(review_api):
    assert review_api.get("/demos/nope/review").status_code == 404


def test_physics_comes_from_the_passport(review_api, store):
    _perfected(store, review_api)
    body = review_api.get("/demos/human_1_rules/review").json()
    assert body["demo_id"] == "human_1_rules"
    assert body["lineage"] == ["human_1", "human_1_rules"]
    assert body["physics"] == {"status": "verified", "source": "passport", "reasons": [], "duration": 1.8,
                               "path_length": 0.42, "max_contact_force": 0.0, "settle_time": 0.6, "detail": None}


def test_a_failed_passport_keeps_its_reasons(review_api, store):
    _perfected(store, review_api, success=False, reasons=["not_in_bin", "dropped"])
    physics = review_api.get("/demos/human_1_rules/review").json()["physics"]
    assert physics["status"] == "failed"
    assert physics["reasons"] == ["not_in_bin", "dropped"]


def test_fixes_are_the_passports_repairs_applied_with_their_times(review_api, store):
    _perfected(store, review_api)
    fixes = review_api.get("/demos/human_1_rules/review").json()["fixes"]
    assert fixes["applied"] == REPAIRS
    assert fixes["diagnosis_source"] == "rules"
    # When Neaten applied them: the repaired demo's own created_at.
    assert fixes["applied_to"] == "human_1_rules"
    assert datetime.fromisoformat(fixes["applied_at"]) == T0 + timedelta(minutes=3)


def test_a_variant_reports_the_repaired_parent_as_where_the_fixes_were_applied(review_api, store):
    _perfected(store, review_api)
    store.save_demo(_demo("human_1_rules_m1", "variant", "human_1_rules", minutes=9))
    store.save_passport("human_1_rules_m1", _passport("human_1_rules_m1", ["human_1", "human_1_rules", "human_1_rules_m1"],
                                                      repairs=REPAIRS))
    fixes = review_api.get("/demos/human_1_rules_m1/review").json()["fixes"]
    assert fixes["applied"] == REPAIRS
    assert fixes["applied_to"] == "human_1_rules"
    assert datetime.fromisoformat(fixes["applied_at"]) == T0 + timedelta(minutes=3)


def test_without_a_passport_physics_comes_from_the_success_check_on_the_signals(review_api, store):
    store.save_demo(_demo())
    _write_episode(store)
    body = review_api.get("/demos/human_1/review").json()
    expected = check_success(_traj(), _signals(), _scene().bin_pose)
    assert body["physics"]["source"] == "success_check"
    assert body["physics"]["status"] == ("verified" if expected.success else "failed")
    assert body["physics"]["reasons"] == expected.reasons
    assert body["physics"]["duration"] == pytest.approx(expected.duration)
    assert body["fixes"] == {"source": None, "diagnosis_source": None, "model_id": None, "applied_to": None,
                             "applied_at": None, "applied": []}
    assert body["lineage"] is None


def test_the_episode_passport_is_used_before_the_success_check(review_api, store):
    store.save_demo(_demo())
    _write_episode(store, passport=_passport("human_1", ["human_1"], source="none"))
    physics = review_api.get("/demos/human_1/review").json()["physics"]
    assert physics["source"] == "episode_passport"
    assert physics["status"] == "verified"  # the signals alone say not_settled


def test_no_passport_and_no_signals_is_unknown_not_a_guess(review_api, store):
    store.save_demo(_demo())
    _write_episode(store, signals=False)
    physics = review_api.get("/demos/human_1/review").json()["physics"]
    assert physics["status"] == "unknown"
    assert physics["source"] is None
    assert physics["reasons"] == [] and physics["duration"] is None
    assert "no passport" in physics["detail"]


def test_the_stored_verdict_is_served_as_written(review_api, store):
    _perfected(store, review_api)
    store.save_review_verdict("human_1_rules", _verdict())
    body = review_api.get("/demos/human_1_rules/review").json()
    assert body["verdict"] == _verdict()
    assert body["verdict_source"] == "review_verdict.json"
    assert body["warnings"] == []


def test_no_verdict_file_is_null_never_a_no(review_api, store):
    _perfected(store, review_api)
    body = review_api.get("/demos/human_1_rules/review").json()
    assert body["verdict"] is None and body["verdict_source"] is None


def test_a_verdict_whose_physics_disagrees_with_the_passport_is_flagged(review_api, store):
    _perfected(store, review_api, success=False, reasons=["dropped"])
    store.save_review_verdict("human_1_rules", _verdict(physics="verified"))
    body = review_api.get("/demos/human_1_rules/review").json()
    assert body["physics"]["status"] == "failed"  # physics decides
    assert body["verdict"]["physics"]["status"] == "verified"  # served unchanged
    assert len(body["warnings"]) == 1 and "physics decides" in body["warnings"][0]


@pytest.mark.parametrize("text", [
    "not json",
    "[1, 2]",
    json.dumps({"physics": {"status": "verified", "reasons": []}}),  # no label or match
    json.dumps({**_verdict(), "match": {"status": "maybe", "checks": None, "reason": None}}),
])
def test_a_corrupt_verdict_file_is_422(review_api, store, text):
    _perfected(store, review_api)
    (store.episode_dir("human_1_rules").parent / "review_verdict.json").write_text(text, encoding="utf-8")
    r = review_api.get("/demos/human_1_rules/review")
    assert r.status_code == 422
    assert "review_verdict.json" in r.json()["detail"]


def test_a_corrupt_passport_is_422(review_api, store):
    _perfected(store, review_api)
    (store.episode_dir("human_1_rules").parent / "passport.json").write_text("{", encoding="utf-8")
    assert review_api.get("/demos/human_1_rules/review").status_code == 422
