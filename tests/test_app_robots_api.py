"""The "Bring your robot" routes (docs/design/byor-api.md): upload, parts, roles, evaluate, report."""

from __future__ import annotations

import io
import json
import re
import struct
import zipfile

import pytest

import urdf_samples as samples
from app.jobs import JobRunner
from app.main import app
from app.routers import robots as robots_router
from app.routers.demos import get_jobs, get_sim_client
from app.sim_client import SimWorkerUnavailable
from fake_sim_worker import InlineExecutor

FRANKA_ARM = [f"panda_joint{i}" for i in range(1, 8)]
FRANKA_ROLES = {"base": "panda_link0", "arm_joints": FRANKA_ARM, "hand": "panda_hand",
                "gripper_joints": ["panda_finger_joint1", "panda_finger_joint2"]}


class _NoWorker:
    def health(self):
        raise SimWorkerUnavailable("no sim worker")

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


class _Worker(_NoWorker):
    def health(self):
        return {"ok": True}


def _fake_report(robot_dir, seed0, n):
    """What sim_worker/scripts/robot_report.py leaves behind, minus the sim."""
    report = {"schema": "sant.robot_report/1", "robot": {"id": robot_dir.name},
              "pick_place": {"successes": {"value": n - 1, "of": n, "source": "fake"}},
              "reach_map": {"fraction": {"value": 0.9, "source": "fake"}}, "task": {"seeds": [seed0, seed0 + n - 1]}}
    (robot_dir / "report.json").write_text(json.dumps(report), encoding="utf-8")


@pytest.fixture
def env(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    jobs = JobRunner(InlineExecutor())
    holder = {"worker": _NoWorker(), "runner": _fake_report, "calls": []}

    def runner(robot_dir, seed0, n):
        holder["calls"].append((robot_dir.name, seed0, n))
        return holder["runner"](robot_dir, seed0, n)

    app.dependency_overrides[get_jobs] = lambda: jobs
    app.dependency_overrides[get_sim_client] = lambda: holder["worker"]
    app.dependency_overrides[robots_router.get_report_runner] = lambda: runner
    yield api, holder, tmp_path / "data"
    app.dependency_overrides.clear()


def _upload(api, name="panda.urdf", data=None):
    data = samples.franka().encode() if data is None else data
    return api.post("/robots", files={"file": (name, data, "application/octet-stream")})


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


def _stl(points) -> bytes:
    """A binary STL whose one triangle has these three corners."""
    return b"x" * 80 + struct.pack("<I", 1) + struct.pack("<12fH", 0, 0, 1, *[c for p in points for c in p], 0)


def _errors(r):
    return [e["code"] for e in r.json()["detail"]["errors"]]


# --- upload ------------------------------------------------------------------------------------------------------

def test_upload_a_urdf_gives_a_content_id_and_a_reupload_is_the_same_robot(env):
    api, _, data = env
    r = _upload(api)
    assert r.status_code == 201, r.text
    body = r.json()
    assert re.fullmatch(r"byor_[0-9a-f]{10}", body["id"])
    assert body["sha256"].startswith(body["id"][5:])
    assert (body["name"], body["created"], body["n_links"], body["n_joints"]) == ("panda", True, 12, 11)
    assert body["parts"] == f"/robots/{body['id']}/parts" and body["issues"] == []
    assert (data / "robots" / body["id"] / "source" / "panda.urdf").is_file()
    again = _upload(api)
    assert again.status_code == 200 and again.json()["id"] == body["id"] and again.json()["created"] is False


@pytest.mark.parametrize("name, data, status, code", [
    ("robot.txt", b"hello", 400, "not_urdf"),
    ("robot.urdf.xacro", b"<robot/>", 400, "xacro"),
    ("robot.urdf", b"<robot name='r'><link name='a'>", 422, "urdf_parse"),
    ("r.zip", _zip({"a.urdf": samples.franka().encode(), "b/b.urdf": samples.franka().encode()}), 400, "multiple_urdfs"),
    ("r.zip", _zip({"readme.md": b"x"}), 400, "no_urdf"),
    ("r.zip", _zip({"r.urdf.xacro": b"<robot/>"}), 400, "xacro"),
    ("r.zip", _zip({"../evil.urdf": samples.franka().encode()}), 400, "unsafe_zip"),
    ("r.zip", b"not a zip", 400, "unsafe_zip"),
])
def test_bad_uploads_name_the_problem(env, name, data, status, code):
    api, _, data_dir = env
    r = _upload(api, name, data)
    assert r.status_code == status, r.text
    assert _errors(r) == [code]
    assert not (data_dir / "robots").exists() or not any((data_dir / "robots").iterdir())


def test_an_upload_over_the_limit_is_413(env, monkeypatch):
    from sim_worker import byor_store

    monkeypatch.setattr(byor_store, "MAX_BYTES", 100)
    r = _upload(env[0])
    assert r.status_code == 413 and _errors(r) == ["too_large"]


def test_list_and_get_robots(env):
    api, _, _ = env
    assert api.get("/robots").json() == []
    rid = _upload(api).json()["id"]
    summary = api.get(f"/robots/{rid}").json()
    assert summary["id"] == rid and summary["name"] == "panda"
    assert (summary["roles_set"], summary["report_status"], summary["headline"]) == (False, "none", None)
    assert [r["id"] for r in api.get("/robots").json()] == [rid]
    assert api.get("/robots/byor_0000000000").status_code == 404


# --- parts -------------------------------------------------------------------------------------------------------

def test_parts_lists_the_tree_and_suggests_roles(env):
    api, _, _ = env
    rid = _upload(api).json()["id"]
    p = api.get(f"/robots/{rid}/parts").json()
    assert (p["id"], p["name"], p["root"]) == (rid, "panda", "panda_link0")
    assert len(p["links"]) == 12 and len(p["joints"]) == 11
    j2 = next(j for j in p["joints"] if j["name"] == "panda_finger_joint2")
    assert j2["mimic"] == {"joint": "panda_finger_joint1", "multiplier": 1.0, "offset": 0.0}
    assert j2["limits"] == {"lower": 0.0, "upper": 0.04, "effort": 20.0, "velocity": 0.2}
    assert j2["origin"] == {"xyz": [0.0, 0.0, 0.0584], "rpy": [0.0, 0.0, 0.0]}
    hand = next(lk for lk in p["links"] if lk["name"] == "panda_hand")
    assert hand["child_joints"] == ["panda_finger_joint1", "panda_finger_joint2"] and hand["has_geometry"]
    assert p["suggested_roles"] == FRANKA_ROLES
    assert set(p["why"]) == set(FRANKA_ROLES)
    assert p["derived"]["dof"] == 7 and p["derived"]["tcp"]["offset"][2] == pytest.approx(0.1034, abs=2e-4)
    assert p["issues"] == []


def test_parts_reads_meshes_through_package_paths_in_the_zip(env):
    api, _, _ = env
    urdf = samples.franka().replace('<box size="0.02 0.02 0.054"/>', '<mesh filename="package://fd/meshes/finger.stl"/>')
    z = _zip({"fd/robots/panda.urdf": urdf.encode(), "fd/package.xml": b"<package><name>fd</name></package>",
              "fd/meshes/finger.stl": _stl([(0, 0, -0.027), (0.01, 0.02, 0.027), (0, 0.01, 0)])})
    rid = _upload(api, "panda.zip", z).json()["id"]
    p = api.get(f"/robots/{rid}/parts").json()
    assert p["issues"] == []
    assert p["derived"]["tcp"]["offset"][2] == pytest.approx(0.1034, abs=2e-4)


def test_missing_meshes_and_packages_are_errors_in_parts(env):
    api, _, _ = env
    urdf = samples.franka().replace('<box size="0.02 0.02 0.054"/>', '<mesh filename="package://fd/meshes/finger.stl"/>')
    urdf = urdf.replace('<box size="0.05 0.2 0.06"/>', '<mesh filename="meshes/hand.glb"/>')
    rid = _upload(api, "panda.zip", _zip({"panda.urdf": urdf.encode(), "meshes/hand.glb": b"x"})).json()["id"]
    issues = api.get(f"/robots/{rid}/parts").json()["issues"]
    assert {(i["code"], i["severity"]) for i in issues} == {("package_unresolved", "error"), ("mesh_format", "error")}
    assert any("fd" in i["message"] for i in issues)


def test_parts_of_an_arm_without_a_gripper(env):
    api, _, _ = env
    rid = _upload(api, "flange.urdf", samples.no_gripper().encode()).json()["id"]
    p = api.get(f"/robots/{rid}/parts").json()
    assert p["suggested_roles"]["gripper_joints"] is None
    assert "no_gripper" in [i["code"] for i in p["issues"] if i["severity"] == "error"]
    assert p["derived"] is None


# --- roles -------------------------------------------------------------------------------------------------------

def test_put_roles_saves_them_with_the_resolved_spec(env):
    api, _, data = env
    rid = _upload(api).json()["id"]
    r = api.put(f"/robots/{rid}/roles", json=FRANKA_ROLES)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ready"] is True and body["issues"] == []
    assert body["roles"]["mount"] == {"pos": [0.0, 0.0, 0.0]} and body["roles"]["tcp_offset"] is None
    spec = body["spec"]
    assert (spec["name"], spec["ik_link"]) == (rid, "panda_link7")
    assert spec["arm_joints"] == FRANKA_ARM
    assert (spec["finger_joints"], spec["passive_finger_joints"]) == (["panda_finger_joint1"], ["panda_finger_joint2"])
    assert spec["tcp_offset"][2] == pytest.approx(0.2104, abs=2e-4)
    assert set(spec["start_joint_pos"]) == set(FRANKA_ARM) | {"panda_finger_joint1", "panda_finger_joint2"}
    assert {"ik_link", "tcp_offset", "gripper", "start_joint_pos"} <= set(spec["sources"])
    assert api.get(f"/robots/{rid}").json()["roles_set"] is True
    assert json.loads((data / "robots" / rid / "roles.json").read_text())["roles"]["hand"] == "panda_hand"


def test_bad_roles_are_422_and_not_saved(env):
    api, _, _ = env
    rid = _upload(api).json()["id"]
    r = api.put(f"/robots/{rid}/roles", json={**FRANKA_ROLES, "arm_joints": FRANKA_ARM[:4]})
    assert r.status_code == 422 and "arm_too_short" in _errors(r)
    assert "4 DOF" in r.json()["detail"]["errors"][0]["message"]
    assert api.get(f"/robots/{rid}").json()["roles_set"] is False
    assert api.put("/robots/byor_0000000000/roles", json=FRANKA_ROLES).status_code == 404


def test_roles_body_with_an_unknown_field_is_422(env):
    api, _, _ = env
    rid = _upload(api).json()["id"]
    assert api.put(f"/robots/{rid}/roles", json={**FRANKA_ROLES, "colour": "red"}).status_code == 422


# --- evaluate and report -----------------------------------------------------------------------------------------

def _ready(api):
    rid = _upload(api).json()["id"]
    assert api.put(f"/robots/{rid}/roles", json=FRANKA_ROLES).status_code == 200
    return rid


def test_report_is_none_before_any_run(env):
    api, _, _ = env
    rid = _upload(api).json()["id"]
    assert api.get(f"/robots/{rid}/report").json() == {"status": "none", "progress": None, "report": None,
                                                       "error": None}
    assert api.get("/robots/byor_0000000000/report").status_code == 404


def test_evaluate_needs_roles(env):
    api, _, _ = env
    rid = _upload(api).json()["id"]
    r = api.post(f"/robots/{rid}/evaluate")
    assert r.status_code == 409 and _errors(r) == ["roles_missing"]


def test_evaluate_refuses_while_the_sim_worker_is_up(env):
    api, holder, _ = env
    rid = _ready(api)
    holder["worker"] = _Worker()
    r = api.post(f"/robots/{rid}/evaluate")
    assert r.status_code == 409 and _errors(r) == ["sim_busy"]
    assert "one Isaac process" in r.json()["detail"]["errors"][0]["message"]
    assert holder["calls"] == []


def test_evaluate_runs_the_report_and_the_report_route_serves_it(env):
    api, holder, _ = env
    rid = _ready(api)
    r = api.post(f"/robots/{rid}/evaluate", json={"seed0": 100, "n": 3})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["poll"] == f"/jobs/{body['job_id']}" and body["report"] == f"/robots/{rid}/report"
    assert holder["calls"] == [(rid, 100, 3)]
    job = api.get(body["poll"]).json()
    assert job["status"] == "succeeded" and job["kind"] == "robot_report"
    assert job["result"] == {"report": f"/robots/{rid}/report"}
    rep = api.get(f"/robots/{rid}/report").json()
    assert rep["status"] == "done" and rep["error"] is None
    assert rep["report"]["pick_place"]["successes"]["value"] == 2
    assert api.get(f"/robots/{rid}").json()["headline"] == {"pick_place": "2/3", "reach": 0.9}


def test_evaluate_defaults_to_the_30_fixed_seeds_and_checks_n(env):
    api, holder, _ = env
    rid = _ready(api)
    assert api.post(f"/robots/{rid}/evaluate").status_code == 202
    assert holder["calls"] == [(rid, 100, 30)]
    assert api.post(f"/robots/{rid}/evaluate", json={"n": 31}).status_code == 422


def test_a_failed_run_keeps_the_last_good_report(env):
    api, holder, _ = env
    rid = _ready(api)
    api.post(f"/robots/{rid}/evaluate", json={"n": 2})

    def boom(robot_dir, seed0, n):
        raise RuntimeError("Isaac exited with code 1: CUDA error")

    holder["runner"] = boom
    job = api.get(api.post(f"/robots/{rid}/evaluate").json()["poll"]).json()
    assert job["status"] == "failed" and "CUDA error" in job["error"]
    rep = api.get(f"/robots/{rid}/report").json()
    assert rep["status"] == "failed" and "CUDA error" in rep["error"]
    assert rep["report"]["pick_place"]["successes"]["value"] == 1


def test_a_run_that_writes_no_report_fails(env):
    api, holder, _ = env
    rid = _ready(api)
    holder["runner"] = lambda robot_dir, seed0, n: None
    job = api.get(api.post(f"/robots/{rid}/evaluate").json()["poll"]).json()
    assert job["status"] == "failed" and "report.json" in job["error"]


def test_progress_written_by_the_run_is_served(env):
    api, holder, data = env
    rid = _ready(api)
    seen = {}

    def slow(robot_dir, seed0, n):
        (robot_dir / "report_progress.json").write_text(json.dumps({"stage": "pick_place", "done": 1, "total": n}))
        seen["during"] = api.get(f"/robots/{rid}/report").json()
        _fake_report(robot_dir, seed0, n)

    holder["runner"] = slow
    api.post(f"/robots/{rid}/evaluate", json={"n": 4})
    assert seen["during"]["status"] == "running"
    assert seen["during"]["progress"] == {"stage": "pick_place", "done": 1, "total": 4}
    assert api.get(f"/robots/{rid}/report").json()["progress"] is None


def test_a_stale_running_status_from_a_restarted_backend_reads_as_failed(env):
    api, _, data = env
    rid = _ready(api)
    (data / "robots" / rid / "report_status.json").write_text(json.dumps({"status": "running", "job_id": "gone"}))
    rep = api.get(f"/robots/{rid}/report").json()
    assert rep["status"] == "failed" and "restarted" in rep["error"]


# --- the real runner (Isaac as a subprocess) ---------------------------------------------------------------------

def test_the_isaac_runner_command(monkeypatch, tmp_path):
    seen = {}

    def call(cmd, cwd, stdout, stderr, env):
        seen.update(cmd=cmd, cwd=cwd, env=env)
        return 0

    monkeypatch.setattr(robots_router.subprocess, "call", call)
    monkeypatch.setenv("ISAAC_PYTHON", r"C:\isaac\py.exe")
    robots_router.get_report_runner()(tmp_path, 100, 30)
    cmd = seen["cmd"]
    assert cmd[0] == r"C:\isaac\py.exe" and cmd[1].endswith("robot_report.py")
    assert cmd[2:] == ["--robot-dir", str(tmp_path), "--seed0", "100", "--n", "30"]
    assert seen["env"]["PYTHONPATH"] == str(robots_router.REPO / "src") and seen["cwd"] == robots_router.REPO
    assert (tmp_path / "run.log").is_file()


def test_the_isaac_runner_reports_the_log_tail_on_failure(monkeypatch, tmp_path):
    def call(cmd, cwd, stdout, stderr, env):
        stdout.write("starting\nTraceback\nValueError: no such body\n")
        return 3

    monkeypatch.setattr(robots_router.subprocess, "call", call)
    with pytest.raises(RuntimeError, match=r"code 3: .*ValueError: no such body"):
        robots_router.get_report_runner()(tmp_path, 100, 2)
