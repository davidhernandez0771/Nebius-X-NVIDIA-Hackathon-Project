""""Bring your robot" routes (the contract is docs/design/byor-api.md).

    POST /robots                    multipart field `file` (.urdf or .zip) -> 201 (200 for the same bytes again)
    GET  /robots                    newest first
    GET  /robots/{id}               summary with roles_set, report_status and the headline
    GET  /robots/{id}/parts         the link/joint tree, suggested roles, derived values and issues
    PUT  /robots/{id}/roles         validate + save the roles with the resolved spec; 422 lists the errors
    POST /robots/{id}/evaluate      {"seed0": 100, "n": 30} -> 202 job; 409 roles_missing / roles_invalid / sim_busy
    GET  /robots/{id}/report        status, progress, the card and the error (always 200 for a known robot)

Every 4xx body is {"detail": {"errors": [issue, ...]}}. The robots live in DATA_DIR/robots (sim_worker.byor_store);
the report run is sim_worker/scripts/robot_report.py in the Isaac python, as its own process (get_report_runner).
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Body, Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from sim_worker.byor_store import RobotStore, UploadError
from sim_worker.urdf_import import Issue, Roles, UrdfError, build_spec, error, suggest_roles, validate_roles

from ..jobs import JobRunner
from ..sim_client import SimWorkerClient, SimWorkerError, SimWorkerUnavailable
from .demos import get_jobs, get_sim_client

router = APIRouter(prefix="/robots", tags=["robots"])

ReportRunner = Callable[[Path, int, int], None]  # (robot dir, seed0, n): leaves report.json in the robot dir
REPO = Path(__file__).resolve().parents[3]
DEFAULT_ISAAC_PYTHON = r"C:\isaac\_isaac_sim\python.bat"
RUNNING = ("queued", "running")


class EvaluateBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seed0: int = 100
    n: int = Field(30, ge=1, le=30)


def get_store() -> RobotStore:
    return RobotStore()


def _run_isaac_report(robot_dir: Path, seed0: int, n: int) -> None:
    """Run the report card in the Isaac python (ISAAC_PYTHON); its log goes to <robot dir>/run.log."""
    python = os.environ.get("ISAAC_PYTHON", DEFAULT_ISAAC_PYTHON)
    cmd = [python, str(REPO / "sim_worker" / "scripts" / "robot_report.py"), "--robot-dir", str(robot_dir),
           "--seed0", str(seed0), "--n", str(n)]
    with open(robot_dir / "run.log", "w", encoding="utf-8") as log:
        code = subprocess.call(cmd, cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
    if code != 0:
        tail = (robot_dir / "run.log").read_text(encoding="utf-8", errors="replace").strip().splitlines()[-5:]
        raise RuntimeError(f"Isaac exited with code {code}: {' | '.join(tail)}")


def get_report_runner() -> ReportRunner:
    return _run_isaac_report


def _fail(status: int, *issues: Issue) -> HTTPException:
    return HTTPException(status, {"errors": [i.to_dict() for i in issues]})


def _dir(store: RobotStore, robot_id: str) -> Path:
    try:
        return store.dir(robot_id)
    except KeyError:
        raise _fail(404, error("not_found", f"robot {robot_id!r} not found")) from None


def _analyse(store: RobotStore, robot_id: str) -> dict:
    """The parts view: tree, suggested roles, derived values, issues (mesh problems first)."""
    u = store.urdf(robot_id)
    sug = suggest_roles(u)
    issues = store.mesh_issues(robot_id, u) + sug.issues
    derived = None
    if not any(i.severity == "error" for i in issues):
        resolved = build_spec(u, Roles(**sug.roles), robot_id, mesh_loader=store.mesh_loader(robot_id))
        derived = resolved.derived
        issues += [i for i in resolved.issues if i not in issues]
    return {"urdf": u, "suggestion": sug, "derived": derived, "issues": issues}


def _summary(store: RobotStore, jobs: JobRunner, robot_id: str) -> dict:
    info = store.summary_file(robot_id)
    report = store.report(robot_id)
    headline = None
    if report is not None:
        pp, reach = report.get("pick_place", {}).get("successes", {}), report.get("reach_map", {}).get("fraction", {})
        headline = {"pick_place": f"{pp.get('value')}/{pp.get('of')}", "reach": reach.get("value")}
    return {"id": robot_id, "name": info["name"], "uploaded_at": info["uploaded_at"],
            "roles_set": store.roles(robot_id) is not None, "report_status": _status(store, jobs, robot_id)["status"],
            "headline": headline}


def _status(store: RobotStore, jobs: JobRunner, robot_id: str) -> dict:
    st = store.status(robot_id) or {"status": "none", "job_id": None, "error": None}
    if st["status"] in RUNNING and jobs.get(st.get("job_id") or "") is None:
        st = {**st, "status": "failed", "error": "the backend restarted during the run; evaluate again"}
    return st


def _spec_view(resolved, roles: Roles) -> dict:
    s = resolved.spec
    return {"name": s.name, "ik_link": s.hand_body, "arm_joints": list(roles.arm_joints),
            "finger_joints": list(s.finger_joints), "passive_finger_joints": list(s.passive_finger_joints),
            "gripper_open": s.gripper_open, "gripper_closed": s.gripper_closed, "tcp_offset": list(s.tcp_offset),
            "hand_in_tool_wxyz": [round(v, 6) for v in s.hand_in_tool_wxyz], "base_pos": list(s.base_pos),
            "start_joint_pos": {k: round(v, 6) for k, v in (s.init_joint_pos or {}).items()},
            "sources": resolved.sources}


def _resolve(store: RobotStore, robot_id: str, roles: Roles):
    """(resolved spec, issues) or raises the 422."""
    u = store.urdf(robot_id)
    found = validate_roles(u, roles)
    errs = [i for i in found if i.severity == "error"]
    if errs:
        raise _fail(422, *errs)
    resolved = build_spec(u, roles, robot_id, mesh_loader=store.mesh_loader(robot_id))
    return resolved, store.mesh_issues(robot_id, u) + resolved.issues


def _pydantic_issues(e: ValidationError, code: str) -> list[Issue]:
    return [error(code, f"{'.'.join(str(p) for p in d['loc']) or 'body'}: {d['msg']}",
                  str(d["loc"][0]) if d["loc"] else None) for d in e.errors()]


# --- routes ------------------------------------------------------------------------------------------------------

@router.post("", status_code=201)
async def upload_robot(file: UploadFile, response: Response, store: RobotStore = Depends(get_store)) -> dict:
    data = await file.read()
    try:
        info, created = store.add(file.filename or "", data)
    except UploadError as e:
        raise _fail(e.status, e.issue) from None
    except UrdfError as e:
        raise _fail(422 if e.issue.code == "urdf_parse" else 400, e.issue) from None
    if not created:
        response.status_code = 200
    issues = _analyse(store, info["id"])["issues"]
    return {"id": info["id"], "name": info["name"], "created": created, "urdf": info["urdf"], "sha256": info["sha256"],
            "n_links": info["n_links"], "n_joints": info["n_joints"], "issues": [i.to_dict() for i in issues],
            "parts": f"/robots/{info['id']}/parts"}


@router.get("")
def list_robots(store: RobotStore = Depends(get_store), jobs: JobRunner = Depends(get_jobs)) -> list[dict]:
    return [_summary(store, jobs, r["id"]) for r in store.list()]


@router.get("/{robot_id}")
def get_robot(robot_id: str, store: RobotStore = Depends(get_store), jobs: JobRunner = Depends(get_jobs)) -> dict:
    _dir(store, robot_id)
    return _summary(store, jobs, robot_id)


@router.get("/{robot_id}/parts")
def get_parts(robot_id: str, store: RobotStore = Depends(get_store)) -> dict:
    _dir(store, robot_id)
    a = _analyse(store, robot_id)
    u, sug = a["urdf"], a["suggestion"]
    links = [{"name": lk.name, "parent_joint": u.parent_joint(lk.name), "child_joints": u.child_joints(lk.name),
              "has_geometry": lk.has_geometry, "has_inertial": lk.has_inertial} for lk in u.links.values()]
    joints = [{"name": j.name, "type": j.type, "parent": j.parent, "child": j.child, "axis": list(j.axis),
               "origin": {"xyz": list(j.origin.xyz), "rpy": list(j.origin.rpy)},
               "limits": None if j.limits is None else vars(j.limits).copy(),
               "mimic": None if j.mimic is None else vars(j.mimic).copy()} for j in u.joints.values()]
    return {"id": robot_id, "name": u.name, "root": u.root, "links": links, "joints": joints,
            "suggested_roles": sug.roles, "why": sug.why, "derived": a["derived"],
            "issues": [i.to_dict() for i in a["issues"]]}


@router.put("/{robot_id}/roles")
def put_roles(robot_id: str, body: dict = Body(...), store: RobotStore = Depends(get_store)) -> dict:
    _dir(store, robot_id)
    try:
        roles = Roles.model_validate(body)
    except ValidationError as e:
        raise _fail(422, *_pydantic_issues(e, "roles_body")) from None
    resolved, issues = _resolve(store, robot_id, roles)
    spec = _spec_view(resolved, roles)
    store.save_roles(robot_id, roles, spec)
    return {"roles": roles.model_dump(mode="json"), "spec": spec, "issues": [i.to_dict() for i in issues],
            "ready": not any(i.severity == "error" for i in issues)}


@router.post("/{robot_id}/evaluate", status_code=202)
def evaluate(robot_id: str, body: dict | None = Body(None), store: RobotStore = Depends(get_store),
             client: SimWorkerClient = Depends(get_sim_client), jobs: JobRunner = Depends(get_jobs),
             runner: ReportRunner = Depends(get_report_runner)) -> dict:
    robot_dir = _dir(store, robot_id)
    try:
        params = EvaluateBody.model_validate(body or {})
    except ValidationError as e:
        raise _fail(422, *_pydantic_issues(e, "evaluate_body")) from None
    saved = store.roles(robot_id)
    if saved is None:
        raise _fail(409, error("roles_missing", "set the roles first (PUT /robots/{id}/roles)", "roles"))
    try:
        _, issues = _resolve(store, robot_id, Roles.model_validate(saved["roles"]))
    except (HTTPException, ValidationError) as e:
        detail = e.detail["errors"] if isinstance(e, HTTPException) else [{"message": str(e)}]
        raise _fail(409, error("roles_invalid", "the saved roles no longer validate: "
                                                + "; ".join(d["message"] for d in detail), "roles")) from None
    if any(i.severity == "error" for i in issues):
        raise _fail(409, *[i for i in issues if i.severity == "error"])
    busy = error("sim_busy", "another Isaac process is running (the sim worker answers /health, or another "
                             "evaluate); only one Isaac process runs at a time: stop the sim worker "
                             "(scripts/launch/stop.ps1) and retry")
    with client:
        try:
            client.health()
            worker_up = True
        except SimWorkerUnavailable:
            worker_up = False
        except SimWorkerError:  # it answers, but busy or hung: still an Isaac process
            worker_up = True
    if worker_up:
        raise _fail(409, busy)
    if any(_status(store, jobs, r["id"])["status"] in RUNNING for r in store.list()):
        raise _fail(409, busy)

    def run() -> dict:
        store.write_status(robot_id, {"status": "running", "job_id": job_id, "error": None})
        report = robot_dir / "report.json"
        before = report.stat().st_mtime_ns if report.is_file() else None
        try:
            runner(robot_dir, params.seed0, params.n)
            if not report.is_file() or report.stat().st_mtime_ns == before:
                raise RuntimeError("the run finished without writing report.json")
        except Exception as e:
            store.write_status(robot_id, {"status": "failed", "job_id": job_id, "error": f"{type(e).__name__}: {e}"})
            raise
        finally:
            store.clear_progress(robot_id)
        store.write_status(robot_id, {"status": "done", "job_id": job_id, "error": None})
        return {"report": f"/robots/{robot_id}/report"}

    job_id = jobs.new_id("robot_report")
    store.write_status(robot_id, {"status": "queued", "job_id": job_id, "error": None})
    job = jobs.submit("robot_report", run, params={"robot_id": robot_id, **params.model_dump()}, job_id=job_id)
    return {"job_id": job.id, "status": job.status, "poll": f"/jobs/{job.id}", "report": f"/robots/{robot_id}/report"}


@router.get("/{robot_id}/report")
def get_report(robot_id: str, store: RobotStore = Depends(get_store), jobs: JobRunner = Depends(get_jobs)) -> dict:
    _dir(store, robot_id)
    st = _status(store, jobs, robot_id)
    return {"status": st["status"], "progress": store.progress(robot_id) if st["status"] == "running" else None,
            "report": store.report(robot_id), "error": st.get("error")}

