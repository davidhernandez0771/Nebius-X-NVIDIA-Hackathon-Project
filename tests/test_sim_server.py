"""sim_worker.server: HTTP handling and the one-job queue, with a fake executor (pure, no sim)."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest

from demo_pipeline.schemas import Pose, Scene, VerificationResult
from demo_pipeline.sim_protocol import (
    ErrorResponse,
    HealthResponse,
    MultiplyRequest,
    MultiplyResponse,
    ReplayRequest,
    ReplayResponse,
    SignalsPayload,
)
from sim_worker.jobs import WrongRobot
from sim_worker.scripted import scripted_expert
from sim_worker.server import Busy, SimWorker, make_http_server

IDENTITY = (1.0, 0.0, 0.0, 0.0)
SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=0)
TRAJ = scripted_expert(SCENE)


def _replay_body(**kw) -> bytes:
    return ReplayRequest(trajectory=TRAJ, scene=SCENE, out_name="d1", **kw).model_dump_json().encode()


def _ok_response(req: ReplayRequest) -> ReplayResponse:
    from demo_pipeline.schemas import SimSignals
    import numpy as np

    n = len(req.trajectory.t)
    sig = SimSignals(cube_pos=np.zeros((n, 3)), contact_gripper_cube=np.zeros(n, bool),
                     contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
                     max_contact_force=np.zeros(n))
    v = VerificationResult(success=True, reasons=[], duration=1.0, path_length=1.0, max_contact_force=0.0)
    return ReplayResponse(verification=v, signals=SignalsPayload.from_signals(sig), ep_dir=None, n_steps=n, wall_s=0.1)


class FakeExecutor:
    def __init__(self):
        self.gate = threading.Event()
        self.gate.set()
        self.started = threading.Event()
        self.thread_names: list[str] = []
        self.raise_exc: Exception | None = None

    def execute(self, kind, req):
        self.thread_names.append(threading.current_thread().name)
        self.started.set()
        self.gate.wait(10)
        if self.raise_exc is not None:
            raise self.raise_exc
        if kind == "replay":
            return _ok_response(req)
        return MultiplyResponse(attempts=0, successes=0, variants=[], wall_s=0.0)


@pytest.fixture
def served():
    ex = FakeExecutor()
    worker = SimWorker(ex, robot="franka", cameras=False)
    srv = make_http_server(worker, "127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True, name="http").start()
    stop = threading.Event()
    loop = threading.Thread(target=worker.serve_jobs, args=(stop,), daemon=True, name="sim-main")
    loop.start()
    yield ex, worker, f"http://127.0.0.1:{srv.server_address[1]}"
    stop.set()
    ex.gate.set()
    srv.shutdown()
    loop.join(5)


def _call(url, method="GET", body: bytes | None = None):
    req = urllib.request.Request(url, data=body, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_health_reports_robot_cameras_and_idle(served):
    _, _, url = served
    status, body = _call(url + "/health")
    assert status == 200
    assert HealthResponse.model_validate(body) == HealthResponse(ok=True, robots=["franka"], cameras=False, busy=False)


def test_replay_runs_on_the_job_loop_thread_not_the_http_thread(served):
    ex, _, url = served
    status, body = _call(url + "/replay", "POST", _replay_body())
    assert status == 200
    ReplayResponse.model_validate(body)
    assert ex.thread_names == ["sim-main"]


def test_multiply_round_trip(served):
    _, _, url = served
    body = MultiplyRequest(trajectory=TRAJ, scene=SCENE, robot="franka", n=2, seed0=0, out_prefix="m").model_dump_json()
    status, resp = _call(url + "/multiply", "POST", body.encode())
    assert status == 200 and MultiplyResponse.model_validate(resp).attempts == 0


def test_a_second_job_while_busy_gets_409_and_health_says_busy(served):
    ex, _, url = served
    ex.gate.clear()
    first: dict = {}
    t = threading.Thread(target=lambda: first.update(r=_call(url + "/replay", "POST", _replay_body())))
    t.start()
    assert ex.started.wait(5)
    status, body = _call(url + "/replay", "POST", _replay_body())
    assert status == 409 and ErrorResponse.model_validate(body).error == "busy"
    assert _call(url + "/health")[1]["busy"] is True
    ex.gate.set()
    t.join(10)
    assert first["r"][0] == 200
    assert len(ex.thread_names) == 1  # the refused request never reached the sim
    assert _call(url + "/health")[1]["busy"] is False


@pytest.mark.parametrize("body", [b"{not json", b'{"trajectory": 1}', _replay_body().replace(b'"d1"', b'"../x"')])
def test_invalid_bodies_get_422(served, body):
    ex, _, url = served
    status, resp = _call(url + "/replay", "POST", body)
    assert status == 422 and ErrorResponse.model_validate(resp).error == "invalid"
    assert ex.thread_names == []


def test_a_request_the_worker_refuses_is_422_with_the_reason(served):
    ex, _, url = served
    ex.raise_exc = WrongRobot("this sim worker runs 'franka', not 'openarm'")
    status, resp = _call(url + "/replay", "POST", _replay_body())
    assert status == 422 and "openarm" in resp["detail"]


def test_a_sim_crash_is_500_sim_error_and_the_worker_keeps_serving(served):
    ex, _, url = served
    ex.raise_exc = RuntimeError("Warp CUDA error 999")
    status, resp = _call(url + "/replay", "POST", _replay_body())
    assert status == 500 and resp["error"] == "sim_error" and "999" in resp["detail"]
    ex.raise_exc = None
    assert _call(url + "/replay", "POST", _replay_body())[0] == 200


def test_unknown_paths_are_404(served):
    _, _, url = served
    assert _call(url + "/nope")[0] == 404
    assert _call(url + "/health", "POST", b"{}")[0] == 404


def test_submit_raises_busy_without_a_job_loop():
    worker = SimWorker(FakeExecutor(), robot="franka", cameras=False)
    worker._slot.acquire()  # a job is in flight
    with pytest.raises(Busy):
        worker.submit("replay", ReplayRequest.model_validate_json(_replay_body()))


def test_jobs_run_inside_the_keep_awake_guard_on_the_job_thread():
    events: list[str] = []

    class Guard:
        def __enter__(self):
            events.append(f"awake:{threading.current_thread().name}")

        def __exit__(self, *exc):
            events.append("release")

    class Ex(FakeExecutor):
        def execute(self, kind, req):
            events.append("job")
            return super().execute(kind, req)

    worker = SimWorker(Ex(), robot="franka", cameras=False, keep_awake=Guard)
    done = threading.Event()
    t = threading.Thread(target=lambda: (worker.submit("replay", ReplayRequest.model_validate_json(_replay_body())),
                                         done.set()))
    t.start()
    while not worker.run_one(timeout=0.5):
        pass
    t.join(5)
    assert done.is_set()
    assert events == [f"awake:{threading.current_thread().name}", "job", "release"]
