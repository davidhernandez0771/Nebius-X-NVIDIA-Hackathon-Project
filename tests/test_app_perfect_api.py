"""POST /demos/{id}/perfect and GET /jobs/{id}, with a fake sim worker and an inline job runner."""
from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pytest

from app.jobs import JobRunner
from app.main import app
from app.routers.demos import get_jobs, get_sim_client
from app.sim_client import SimWorkerUnavailable
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Demo, Diagnosis, Pose, Scene, Trajectory
from demo_pipeline.store import DemoStore
from fake_sim_worker import FakeSim, InlineExecutor

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
N = 100


def _traj(n=N):
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if 40 <= i < 80 else 0 for i in range(n)]
    return Trajectory(t=[i * 0.02 for i in range(n)], ee_pos=pos, ee_quat=[DOWN] * n, gripper=grip)


def _demo(id="human_1", source="human", robot="franka"):
    scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                  bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot=robot, seed=7)
    return Demo(id=id, source=source, parent_id=None if source == "human" else "human_1", trajectory=_traj(),
                scene=scene, human_seconds=10.0 if source == "human" else 0.0)


@pytest.fixture
def env(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    store = DemoStore(tmp_path / "data")
    jobs = JobRunner(InlineExecutor())
    holder = {"sim": FakeSim(tmp_path / "worker")}
    app.dependency_overrides[get_jobs] = lambda: jobs
    app.dependency_overrides[get_sim_client] = lambda: holder["sim"]
    yield api, store, holder
    app.dependency_overrides.clear()


def _perfect(api, demo_id="human_1", **params):
    return api.post(f"/demos/{demo_id}/perfect", params=params)


def test_perfect_returns_202_and_the_job_reports_the_stored_result(env):
    api, store, holder = env
    store.save_demo(_demo())
    r = _perfect(api, diagnoser="rules")
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    assert r.headers["location"] == f"/jobs/{job_id}" and r.json()["poll"] == f"/jobs/{job_id}"

    job = api.get(f"/jobs/{job_id}").json()
    assert job["status"] == "succeeded" and job["kind"] == "perfect" and job["demo_id"] == "human_1"
    assert job["params"] == {"diagnoser": "rules"}
    assert job["result"]["status"] == "kept" and job["result"]["output_demo_id"] == "human_1_rules"
    assert api.get("/demos/human_1_rules").json()["source"] == "repaired"
    assert holder["sim"].closed  # the job closes its client when done


def test_default_diagnoser_is_nemotron(env):
    api, store, _ = env
    store.save_demo(_demo())
    keep = Diagnosis.model_validate({"segments": [], "issues": [], "repairs": [], "decision": "keep",
                                     "label": TASK_TEXT})
    with patch("app.jobs.diagnose_gated", return_value=(keep, [])) as model:
        job_id = _perfect(api).json()["job_id"]
    model.assert_called_once()
    result = api.get(f"/jobs/{job_id}").json()["result"]
    assert result["diagnoser"] == "nemotron" and result["diagnosis_source"] == "nemotron"


def test_unknown_diagnoser_is_422(env):
    api, store, _ = env
    store.save_demo(_demo())
    assert _perfect(api, diagnoser="gpt").status_code == 422


def test_perfect_missing_demo_is_404(env):
    api, _, _ = env
    assert _perfect(api, "nope", diagnoser="rules").status_code == 404


def test_perfect_a_derived_demo_is_409(env):
    api, store, _ = env
    store.save_demo(_demo())
    store.save_demo(_demo("rep_1", source="repaired"))
    r = _perfect(api, "rep_1", diagnoser="rules")
    assert r.status_code == 409 and "human" in r.json()["detail"]


def test_worker_down_is_503_with_a_clear_message_and_no_job(env, tmp_path):
    api, store, holder = env
    store.save_demo(_demo())
    holder["sim"] = FakeSim(tmp_path / "w", health_error=SimWorkerUnavailable(
        "sim worker unavailable at http://127.0.0.1:8770/health: ConnectError: refused; start the sim worker"))
    r = _perfect(api, diagnoser="rules")
    assert r.status_code == 503
    assert "start the sim worker" in r.json()["detail"]
    assert holder["sim"].requests == [] and holder["sim"].closed


def test_worker_reporting_not_ok_is_503(env, tmp_path):
    api, store, holder = env
    store.save_demo(_demo())
    holder["sim"] = FakeSim(tmp_path / "w", ok=False)
    assert _perfect(api, diagnoser="rules").status_code == 503


def test_worker_for_another_robot_is_409(env, tmp_path):
    api, store, holder = env
    store.save_demo(_demo(robot="openarm"))
    r = _perfect(api, diagnoser="rules")
    assert r.status_code == 409 and "openarm" in r.json()["detail"]


def test_nemotron_needs_a_worker_with_cameras_but_rules_does_not(env, tmp_path):
    api, store, holder = env
    store.save_demo(_demo())
    holder["sim"] = FakeSim(tmp_path / "w", cameras=False)
    r = _perfect(api, diagnoser="nemotron")
    assert r.status_code == 409 and "cameras" in r.json()["detail"]
    assert _perfect(api, diagnoser="rules").status_code == 202


def test_worker_crash_mid_job_shows_as_a_failed_job(env, tmp_path):
    api, store, holder = env
    store.save_demo(_demo())
    holder["sim"] = FakeSim(tmp_path / "w", errors={1: SimWorkerUnavailable(
        "sim worker unavailable at http://127.0.0.1:8770/replay: RemoteProtocolError: disconnected")})
    r = _perfect(api, diagnoser="rules")
    assert r.status_code == 202
    job = api.get(f"/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "failed" and "RemoteProtocolError" in job["error"] and job["result"] is None
    assert api.get("/demos/human_1_rules").status_code == 404


def test_unknown_job_is_404(env):
    api, _, _ = env
    assert api.get("/jobs/perfect_nope").status_code == 404


def test_default_dependencies_build_a_client_and_share_one_runner(monkeypatch):
    monkeypatch.setenv("SIM_WORKER_URL", "http://gpu-box:9000")
    assert get_sim_client().base_url == "http://gpu-box:9000"
    assert get_jobs() is get_jobs()
