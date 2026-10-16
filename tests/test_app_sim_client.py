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
