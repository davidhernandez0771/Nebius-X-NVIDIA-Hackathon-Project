"""/twin/episodes: a saved episode's joints for the robot twin's replay (src/app/routers/twin.py)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from demo_pipeline.episode_io import EpisodeMeta, save_episode, save_signals
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Demo, Passport, Pose, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.store import DemoStore

DOWN = (0.0, 1.0, 0.0, 0.0)
T0 = datetime(2026, 10, 18, 12, 0, 0, tzinfo=timezone.utc)
N = 6
# Isaac Lab's Franka start pose (isaaclab_assets/robots/franka.py), then the fingers half closed
REST = [0.0, -0.569, 0.0, -2.810, 0.0, 3.037, 0.741, 0.04, 0.04]


@pytest.fixture
def twin_api(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    return api


@pytest.fixture
def store(twin_api, tmp_path):
    return DemoStore(tmp_path / "data")


def _scene(robot="franka"):
    yaw = 0.3
    return Scene(cube_pose=Pose(pos=(0.5, -0.05, 0.025), quat_wxyz=(np.cos(yaw / 2), 0.0, 0.0, np.sin(yaw / 2))),
                 bin_pose=Pose(pos=(0.53, 0.27, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot=robot, seed=100002)


def _add(store, demo_id, *, source="variant", minutes=0, robot="franka", verified=True, episode=True, signals=True,
         width=9):
    traj = Trajectory(t=[i * 0.02 for i in range(N)], ee_pos=[(0.5, 0.0, 0.3)] * N, ee_quat=[DOWN] * N,
                      gripper=[0, 0, 1, 1, 1, 0])
    store.save_demo(Demo(id=demo_id, source=source, parent_id=None if source == "human" else "human_1",
                         trajectory=traj, scene=_scene(robot), created_at=T0 + timedelta(minutes=minutes),
                         human_seconds=5.0 if source == "human" else 0.0))
    if verified is not None:
        store.save_passport(demo_id, Passport(
            demo_id=demo_id, lineage=["human_1", demo_id], diagnosis_source="none", robot=robot,
            verification=VerificationResult(success=verified, duration=2.0, path_length=0.5, max_contact_force=0.0),
            pipeline_version="test"))
    if not episode:
        return
    ep = store.episode_dir(demo_id)
    q = np.tile(np.asarray(REST, dtype=np.float32), (N, 1))[:, :width]
    q[:, 0] = np.linspace(0.0, 0.123456, N)
    save_episode(ep, EpisodeMeta(demo_id=demo_id, robot=robot, task_text=TASK_TEXT, fps=50, n_steps=N), {
        "joint_pos": q, "action": q, "ee_pos": np.zeros((N, 3)), "ee_quat": np.tile(DOWN, (N, 1)),
        "gripper": np.asarray(traj.gripper, dtype=np.int8)})
    if signals:
        cube = np.tile([0.5, -0.05, 0.025], (N, 1))
        cube[3:] = [0.52, 0.1, 0.12]
        save_signals(ep, SimSignals(cube_pos=cube, contact_gripper_cube=np.zeros(N, dtype=bool),
                                    contact_arm_bin=np.zeros(N, dtype=bool), contact_arm_table=np.zeros(N, dtype=bool),
                                    max_contact_force=np.zeros(N)))


def test_an_episode_comes_with_named_joints_gripper_cube_and_scene(twin_api, store):
    _add(store, "s1_0000_m100002")
    body = twin_api.get("/twin/episodes/s1_0000_m100002").json()
    assert body["robot"] == "franka" and body["fps"] == 50 and body["n_steps"] == N
    assert body["joint_names"][:2] == ["panda_joint1", "panda_joint2"] and body["joint_names"][-1] == "panda_finger_joint2"
    assert len(body["joint_pos"]) == N and len(body["joint_pos"][0]) == 9
    assert body["joint_pos"][-1][0] == 0.1235 and body["joint_pos"][0][1] == -0.569  # 4 decimals
    assert body["gripper"] == [0, 0, 1, 1, 1, 0]
    assert body["cube_pos"][0] == [0.5, -0.05, 0.025] and body["cube_pos"][5] == [0.52, 0.1, 0.12]
    assert body["cube_quat"] == [0.9888, 0.0, 0.0, 0.1494]  # the scene's start yaw (0.3 rad), held
    assert body["bin"] == [0.53, 0.27, 0.0, 1.0, 0.0, 0.0, 0.0]
    assert body["base"] == [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0]
    assert body["verified"] is True and body["lineage"] == ["human_1", "s1_0000_m100002"]
    assert body["source"] == "variant"


def test_without_signals_there_is_no_cube_path(twin_api, store):
    _add(store, "v1", signals=False, verified=None)
    body = twin_api.get("/twin/episodes/v1").json()
    assert body["cube_pos"] is None and body["verified"] is None and body["lineage"] is None


def test_errors_say_what_is_missing(twin_api, store):
    assert twin_api.get("/twin/episodes/nope").status_code == 404
    _add(store, "no_ep", episode=False)
    r = twin_api.get("/twin/episodes/no_ep")
    assert r.status_code == 409 and "no recorded episode" in r.json()["detail"]
    _add(store, "oa", robot="openarm")
    r = twin_api.get("/twin/episodes/oa")
    assert r.status_code == 409 and "joint order" in r.json()["detail"]
    _add(store, "narrow", width=7)
    r = twin_api.get("/twin/episodes/narrow")
    assert r.status_code == 422 and "joint_pos" in r.json()["detail"]
    (store.episode_dir("narrow") / "steps.npz").write_bytes(b"not a zip")
    assert twin_api.get("/twin/episodes/narrow").status_code == 422


def test_the_list_finds_verified_copies_newest_first(twin_api, store):
    _add(store, "human_1", source="human", verified=None, minutes=0)
    _add(store, "copy_ok_1", minutes=1)
    _add(store, "copy_failed", minutes=2, verified=False)
    _add(store, "copy_ok_2", minutes=3)
    _add(store, "copy_no_episode", minutes=4, episode=False)
    _add(store, "openarm_copy", minutes=5, robot="openarm")

    rows = twin_api.get("/twin/episodes").json()
    assert [r["id"] for r in rows] == ["copy_ok_2", "copy_failed", "copy_ok_1", "human_1"]
    assert rows[0] == {"id": "copy_ok_2", "source": "variant", "robot": "franka", "n_steps": N, "fps": 50,
                       "verified": True, "lineage": ["human_1", "copy_ok_2"]}
    ok = twin_api.get("/twin/episodes?verified=true&robot=franka").json()
    assert [r["id"] for r in ok] == ["copy_ok_2", "copy_ok_1"]
    assert [r["id"] for r in twin_api.get("/twin/episodes?verified=false").json()] == ["copy_failed"]
    assert len(twin_api.get("/twin/episodes?limit=1").json()) == 1
    assert twin_api.get("/twin/episodes?robot=openarm").json() == []  # no known joint order yet
    assert twin_api.get("/twin/episodes?limit=0").status_code == 422
