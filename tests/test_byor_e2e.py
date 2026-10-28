"""'Bring your robot' end to end, the way the setup page (/robots/setup, web/src/site/setup/client.ts on T1's
pm/web-setup) drives it: upload the real Franka URDF as a zip, read the parts, PUT the suggested roles with a mount,
evaluate, poll the report. The Isaac run is replaced by a cached one: tests/data/byor/franka.report.json is the
report.json of a real 30-scene run of the same URDF (tests/data/byor/README.md), so no GPU is needed.

The field lists below are what T1's types.ts reads; if the card loses one, the page breaks.
"""

from __future__ import annotations

import io
import json
import re
import shutil
import zipfile
from pathlib import Path

import pytest

from app.jobs import JobRunner
from app.main import app
from app.routers import robots as robots_router
from app.routers.demos import get_jobs, get_sim_client
from app.sim_client import SimWorkerUnavailable
from fake_sim_worker import InlineExecutor

DATA = Path(__file__).parent / "data" / "byor"
CACHED = DATA / "franka.report.json"
FRANKA_ARM = [f"panda_joint{i}" for i in range(1, 8)]


class _NoWorker:
    def health(self):
        raise SimWorkerUnavailable("no sim worker")

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


def franka_zip() -> bytes:
    """franka_description as committed (URDF, package.xml, collision STLs), the URDF's <visual> blocks dropped:
    their 11 MB of DAE meshes are not committed, and the sim never reads them."""
    root = DATA / "franka_description"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for f in sorted(root.rglob("*")):
            if f.is_file():
                data = f.read_bytes()
                if f.suffix == ".urdf":
                    data = re.sub(rb"\s*<visual>.*?</visual>", b"", data, flags=re.DOTALL)
                z.writestr("franka_description/" + f.relative_to(root).as_posix(), data)
    return buf.getvalue()


@pytest.fixture
def env(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    jobs = JobRunner(InlineExecutor())
    seen = {}

    def cached_run(robot_dir: Path, seed0: int, n: int) -> None:
        """What robot_report.py leaves behind, from the cached run: progress while it runs, then report.json."""
        seen["args"] = (seed0, n)
        (robot_dir / "report_progress.json").write_text(json.dumps({"stage": "pick_place", "done": 3, "total": n}))
        seen["during"] = api.get(f"/robots/{robot_dir.name}/report").json()
        shutil.copyfile(CACHED, robot_dir / "report.json")

    app.dependency_overrides[get_jobs] = lambda: jobs
    app.dependency_overrides[get_sim_client] = lambda: _NoWorker()
    app.dependency_overrides[robots_router.get_report_runner] = lambda: cached_run
    yield api, seen
    app.dependency_overrides.clear()


REPORT_KEYS = {"schema", "robot", "roles", "task", "verdict", "pick_place", "reach_map", "joint_limit_hits", "scenes",
               "provenance"}
ROW_KEYS = {"seed", "success", "reasons", "cube", "bin", "tracking_mean_mm", "limit_hits"}


def _sourced(node, path="report"):
    if isinstance(node, dict):
        if "value" in node:  # a sourced number or table: its source covers what is inside the value
            assert "source" in node, f"{path} has a value but no source"
        for k, v in node.items():
            if k != "value" or "source" not in node:
                _sourced(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _sourced(v, f"{path}[{i}]")


def test_upload_roles_evaluate_report_like_the_setup_page(env):
    api, seen = env
    cached = json.loads(CACHED.read_text(encoding="utf-8"))

    up = api.post("/robots", files={"file": ("franka_description.zip", franka_zip(), "application/zip")})
    assert up.status_code == 201, up.text
    up = up.json()
    assert (up["name"], up["urdf"], up["issues"]) == ("panda", "franka_description/robots/panda_arm_hand.urdf", [])
    rid = up["id"]

    parts = api.get(up["parts"]).json()
    assert parts["suggested_roles"] == {"base": "panda_link0", "arm_joints": FRANKA_ARM, "hand": "panda_hand",
                                        "gripper_joints": ["panda_finger_joint1", "panda_finger_joint2"]}
    assert parts["issues"] == [] and parts["derived"]["tcp"]["offset"][2] == pytest.approx(0.10328, abs=1e-5)

    body = {**parts["suggested_roles"], "mount": {"pos": [0, 0, 0]}}  # roles.ts toBody(roles, mount)
    roles = api.put(f"/robots/{rid}/roles", json=body)
    assert roles.status_code == 200, roles.text
    roles = roles.json()
    assert roles["ready"] is True and roles["issues"] == []
    # the cached run resolved the same spec from the same URDF (it was uploaded with its visual meshes)
    assert {k: v for k, v in roles["spec"].items() if k != "name"} == \
        {k: v for k, v in cached["spec"].items() if k != "name"}
    assert cached["roles"] == roles["roles"]

    ev = api.post(f"/robots/{rid}/evaluate", json={"seed0": 100, "n": 30})
    assert ev.status_code == 202, ev.text
    ev = ev.json()
    assert seen["args"] == (100, 30)
    assert seen["during"]["status"] == "running" and seen["during"]["progress"]["stage"] == "pick_place"
    job = api.get(ev["poll"]).json()
    assert job["status"] == "succeeded" and job["kind"] == "robot_report"

    rep = api.get(ev["report"]).json()
    assert (rep["status"], rep["progress"], rep["error"]) == ("done", None, None)
    card = rep["report"]
    assert card == cached
    assert REPORT_KEYS <= set(card) and card["schema"] == "sant.robot_report/1"
    assert {"id", "name", "urdf_sha256", "dof"} <= set(card["robot"])
    assert {"name", "text", "seeds", "source", "workspace"} <= set(card["task"]) and card["task"]["seeds"] == [100, 129]
    assert {"value", "of", "source"} <= set(card["pick_place"]["successes"]) and card["pick_place"]["successes"]["of"] == 30
    assert {"fraction", "grid", "layers", "source"} <= set(card["reach_map"])
    assert all({"name", "z", "yaw_deg", "reachable"} <= set(lay) for lay in card["reach_map"]["layers"])
    assert len(card["scenes"]["rows"]) == 30 and all(ROW_KEYS <= set(r) for r in card["scenes"]["rows"])
    _sourced(card)

    pp = card["pick_place"]["successes"]
    summary = api.get(f"/robots/{rid}").json()
    assert summary["headline"] == {"pick_place": f"{pp['value']}/30", "reach": card["reach_map"]["fraction"]["value"]}
    assert (summary["roles_set"], summary["report_status"]) == (True, "done")


def test_errors_reach_the_page_in_the_contract_shape(env):
    api, _ = env
    r = api.post("/robots", data={"other": "x"})  # no `file` field
    assert r.status_code == 400 and r.json()["detail"]["errors"][0]["code"] == "not_urdf"
    rid = api.post("/robots", files={"file": ("f.zip", franka_zip(), "application/zip")}).json()["id"]
    parts = api.get(f"/robots/{rid}/parts").json()
    r = api.put(f"/robots/{rid}/roles", json={**parts["suggested_roles"], "base": None})  # the page's unset base
    assert r.status_code == 422
    errs = r.json()["detail"]["errors"]
    assert errs and {"code", "severity", "message", "where"} <= set(errs[0]) and "base" in errs[0]["message"]


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_the_vite_dev_server_may_call_the_api(api, origin):
    r = api.options("/robots", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == origin
