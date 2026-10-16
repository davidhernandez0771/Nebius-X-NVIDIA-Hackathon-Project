"""SimWorkerClient against the sim-worker contract (demo_pipeline.sim_protocol), with httpx.MockTransport only."""
from __future__ import annotations

import json

import httpx
import numpy as np
import pytest

from app.sim_client import (
    DEFAULT_URL,
    SimWorkerBusy,
    SimWorkerClient,
    SimWorkerError,
    SimWorkerUnavailable,
)
from demo_pipeline.schemas import Pose, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.sim_protocol import (
    DEFAULT_PORT,
    MultiplyRequest,
    MultiplyResponse,
    MultiplyVariant,
    ReplayRequest,
    ReplayResponse,
    SignalsPayload,
)

IDENTITY = (1.0, 0.0, 0.0, 0.0)
N = 4


def _traj():
    return Trajectory(t=[0.0, 0.02, 0.04, 0.06], ee_pos=[(0.5, 0.0, 0.2)] * N, ee_quat=[IDENTITY] * N,
                      gripper=[0, 1, 1, 0])


def _scene(seed=1):
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=seed)


def _verification(success=True):
    return VerificationResult(success=success, reasons=[] if success else ["not_in_bin"], duration=0.06,
                              path_length=0.0, max_contact_force=0.0)


def _signals_payload():
    return SignalsPayload.from_signals(SimSignals(
        cube_pos=np.zeros((N, 3)), contact_gripper_cube=np.zeros(N, dtype=bool),
        contact_arm_bin=np.zeros(N, dtype=bool), contact_arm_table=np.zeros(N, dtype=bool),
        max_contact_force=np.zeros(N)))


def _replay_request():
    return ReplayRequest(trajectory=_traj(), scene=_scene(), record_cameras=True, out_name="human_1_raw")


def _replay_response():
    return ReplayResponse(verification=_verification(), signals=_signals_payload(), ep_dir="C:/data/episodes/x",
                          n_steps=N, wall_s=1.5)


def _multiply_response():
    variants = [MultiplyVariant(seed=s, scene=_scene(s), trajectory=_traj(), verification=_verification(s != 2),
                                ep_dir=None) for s in (1, 2)]
    return MultiplyResponse(attempts=2, successes=1, variants=variants, wall_s=3.0)


def _client(handler, **kw):
    kw.setdefault("sleep", lambda s: None)  # retries wait 10 s each by default
    return SimWorkerClient("http://sim.test:8770", transport=httpx.MockTransport(handler), **kw)


def _json(status, model_or_dict):
    body = model_or_dict if isinstance(model_or_dict, dict) else json.loads(model_or_dict.model_dump_json())
    return httpx.Response(status, json=body)


# --- URL ---------------------------------------------------------------------------------

def test_default_url_is_localhost_on_the_contract_port(monkeypatch):
    monkeypatch.delenv("SIM_WORKER_URL", raising=False)
    assert DEFAULT_URL == f"http://127.0.0.1:{DEFAULT_PORT}"
    assert SimWorkerClient().base_url == DEFAULT_URL


def test_url_comes_from_sim_worker_url(monkeypatch):
    monkeypatch.setenv("SIM_WORKER_URL", "http://gpu-box:9000/")
    assert SimWorkerClient().base_url == "http://gpu-box:9000"


def test_explicit_url_wins_over_the_env(monkeypatch):
    monkeypatch.setenv("SIM_WORKER_URL", "http://gpu-box:9000")
    assert SimWorkerClient("http://other:1").base_url == "http://other:1"


# --- happy paths -----------------------------------------------------------------------------

def test_health_parses_the_response():
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path))
        return _json(200, {"ok": True, "robots": ["franka"], "cameras": True, "busy": False})

    health = _client(handler).health()
    assert seen == [("GET", "/health")]
    assert health.ok and health.cameras and health.robots == ["franka"] and not health.busy


def test_replay_posts_the_request_and_parses_the_response():
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path, json.loads(request.content)))
        return _json(200, _replay_response())

    resp = _client(handler).replay(_replay_request())
    method, path, body = seen[0]
    assert (method, path) == ("POST", "/replay")
    assert ReplayRequest.model_validate(body) == _replay_request()
    assert resp == _replay_response()


def test_multiply_posts_the_request_and_parses_the_response():
    req = MultiplyRequest(trajectory=_traj(), scene=_scene(), robot="franka", n=2, seed0=1, out_prefix="v")
    seen = []

    def handler(request):
        seen.append(request.url.path)
        assert MultiplyRequest.model_validate_json(request.content) == req
        return _json(200, _multiply_response())

    assert _client(handler).multiply(req) == _multiply_response()
    assert seen == ["/multiply"]


# --- timeouts -------------------------------------------------------------------------------

def test_each_call_uses_its_own_read_timeout():
    seen = {}

    def handler(request):
        seen[request.url.path] = request.extensions["timeout"]
        if request.url.path == "/health":
            return _json(200, {"ok": True, "robots": ["franka"], "cameras": False, "busy": False})
        if request.url.path == "/replay":
            return _json(200, _replay_response())
        return _json(200, _multiply_response())

    client = _client(handler, connect_timeout=2.0, health_timeout=3.0, replay_timeout=40.0,
                     multiply_timeout_per_variant=10.0)
    client.health()
    client.replay(_replay_request())
    client.multiply(MultiplyRequest(trajectory=_traj(), scene=_scene(), robot="franka", n=5, seed0=0,
                                    out_prefix="v"))
    assert seen["/health"]["connect"] == 2.0 and seen["/health"]["read"] == 3.0
    assert seen["/replay"]["read"] == 40.0
    assert seen["/multiply"]["read"] == 40.0 + 5 * 10.0  # scales with n


# --- errors (Review Focus 2) ---------------------------------------------------------------

@pytest.mark.parametrize("exc", [
    httpx.ConnectError("[WinError 10061] connection refused"),
    httpx.ReadTimeout("timed out"),
    httpx.RemoteProtocolError("server disconnected without sending a response"),
])
def test_transport_failures_are_unavailable_with_the_url_in_the_message(exc):
    def handler(request):
        raise exc

    with pytest.raises(SimWorkerUnavailable) as info:
        _client(handler).replay(_replay_request())
    msg = str(info.value)
    assert "http://sim.test:8770/replay" in msg and type(exc).__name__ in msg
    assert "start the sim worker" in msg


def test_busy_is_its_own_error():
    def handler(request):
        return _json(409, {"error": "busy", "detail": "a replay job is running"})

    with pytest.raises(SimWorkerBusy) as info:
        _client(handler).replay(_replay_request())
    assert info.value.status == 409 and info.value.error == "busy"
    assert "a replay job is running" in str(info.value)


def test_unavailable_and_busy_are_sim_worker_errors():
    assert issubclass(SimWorkerUnavailable, SimWorkerError)
    assert issubclass(SimWorkerBusy, SimWorkerError)


@pytest.mark.parametrize("status,error", [(500, "sim_error"), (422, "invalid"), (404, "not_found")])
def test_other_error_responses_carry_status_error_and_detail(status, error):
    def handler(request):
        return _json(status, {"error": error, "detail": "RuntimeError: IK diverged"})

    with pytest.raises(SimWorkerError) as info:
        _client(handler).replay(_replay_request())
    assert type(info.value) is SimWorkerError
    assert (info.value.status, info.value.error) == (status, error)
    assert "IK diverged" in str(info.value)


def test_an_error_body_that_is_not_an_error_response_still_raises_with_the_text():
    def handler(request):
        return httpx.Response(502, text="Bad Gateway")

    with pytest.raises(SimWorkerError) as info:
        _client(handler).health()
    assert info.value.status == 502 and info.value.error is None
    assert "Bad Gateway" in str(info.value)


def test_a_success_body_that_breaks_the_contract_raises():
    def handler(request):
        return _json(200, {"verification": "nope"})

    with pytest.raises(SimWorkerError) as info:
        _client(handler).replay(_replay_request())
    assert "contract" in str(info.value)


def test_client_closes_its_http_client():
    client = _client(lambda r: _json(200, {"ok": True, "robots": [], "cameras": False, "busy": False}))
    with client as c:
        c.health()
    assert client.closed


# --- retries on dropped connections and 409 busy, against a real local server (T2's sprint-4 finding) ------

import socket  # noqa: E402
import struct  # noqa: E402
import threading  # noqa: E402
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # noqa: E402


class FakeWorker:
    """A stdlib HTTP server whose answers are scripted per request: "reset" (TCP RST, WinError 10054 on Windows),
    "drop" (close without a response), "busy" (409), "sim_error" (500), or "ok" (the contract's 200)."""

    def __init__(self, script):
        self.script = list(script)
        self.paths = []
        worker = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _answer(self):
                length = int(self.headers.get("content-length") or 0)
                self.rfile.read(length)
                worker.paths.append(self.path)
                action = worker.script.pop(0) if worker.script else "ok"
                if action == "reset":
                    self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
                    self.connection.close()
                    return
                if action == "drop":
                    self.connection.close()
                    return
                if action == "busy":
                    return self._send(409, {"error": "busy", "detail": "a multiply job is running"})
                if action == "sim_error":
                    return self._send(500, {"error": "sim_error", "detail": "RuntimeError: boom"})
                body = {"/replay": lambda: json.loads(_replay_response().model_dump_json()),
                        "/multiply": lambda: json.loads(_multiply_response().model_dump_json()),
                        "/health": lambda: {"ok": True, "robots": ["franka"], "cameras": True, "busy": False}}
                self._send(200, body[self.path]())

            def _send(self, status, obj):
                data = json.dumps(obj).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = _answer

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def worker():
    made = []

    def make(*script):
        w = FakeWorker(script)
        made.append(w)
        return w

    yield make
    for w in made:
        w.close()


def _live_client(w, sleeps, **kw):
    return SimWorkerClient(w.url, sleep=sleeps.append, **kw)


def _multiply_request():
    return MultiplyRequest(trajectory=_traj(), scene=_scene(), robot="franka", n=2, seed0=1, out_prefix="v")


@pytest.mark.parametrize("failure", ["reset", "drop"])
def test_replay_is_retried_after_a_dropped_connection(worker, failure):
    w, sleeps = worker(failure, failure), []
    assert _live_client(w, sleeps).replay(_replay_request()) == _replay_response()
    assert w.paths == ["/replay"] * 3 and sleeps == [10.0, 10.0]


def test_multiply_is_retried_after_a_reset(worker):
    w, sleeps = worker("reset"), []
    assert _live_client(w, sleeps).multiply(_multiply_request()) == _multiply_response()
    assert w.paths == ["/multiply"] * 2 and sleeps == [10.0]


def test_busy_is_retried_the_same_way(worker):
    w, sleeps = worker("busy", "busy", "busy"), []
    assert _live_client(w, sleeps).replay(_replay_request()) == _replay_response()
    assert len(w.paths) == 4 and sleeps == [10.0] * 3


def test_after_three_retries_a_dropped_connection_is_unavailable(worker):
    w, sleeps = worker("reset", "reset", "reset", "reset"), []
    with pytest.raises(SimWorkerUnavailable) as info:
        _live_client(w, sleeps).multiply(_multiply_request())
    assert len(w.paths) == 4 and sleeps == [10.0] * 3
    assert "4 attempts" in str(info.value) and "start the sim worker" in str(info.value)


def test_after_three_retries_busy_is_still_busy(worker):
    w, sleeps = worker("busy", "busy", "busy", "busy"), []
    with pytest.raises(SimWorkerBusy):
        _live_client(w, sleeps).replay(_replay_request())
    assert len(w.paths) == 4


def test_other_error_answers_are_not_retried(worker):
    w, sleeps = worker("sim_error"), []
    with pytest.raises(SimWorkerError) as info:
        _live_client(w, sleeps).replay(_replay_request())
    assert info.value.error == "sim_error" and len(w.paths) == 1 and sleeps == []


def test_health_is_not_retried_so_the_preflight_fails_fast(worker):
    w, sleeps = worker("reset"), []
    with pytest.raises(SimWorkerUnavailable):
        _live_client(w, sleeps).health()
    assert len(w.paths) == 1 and sleeps == []


def test_a_timeout_is_not_retried():
    def handler(request):
        raise httpx.ReadTimeout("timed out")

    sleeps = []
    client = SimWorkerClient("http://sim.test:8770", transport=httpx.MockTransport(handler), sleep=sleeps.append)
    with pytest.raises(SimWorkerUnavailable, match="ReadTimeout"):
        client.replay(_replay_request())
    assert sleeps == []


def test_retries_and_wait_are_configurable(worker):
    w, sleeps = worker("reset", "reset"), []
    with pytest.raises(SimWorkerUnavailable):
        _live_client(w, sleeps, retries=1, retry_wait_s=2.5).replay(_replay_request())
    assert len(w.paths) == 2 and sleeps == [2.5]
