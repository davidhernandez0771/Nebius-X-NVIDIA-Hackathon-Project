"""Cross-site requests from a web page to the local API and the sim worker are refused (security pass, 2026-10-29).

A page on any site can send a "simple" POST (no CORS preflight) to http://localhost:8000, e.g. POST
/api/photos/{id}/analyze, which spends Token Factory credits. CORS only hides the answer from that page; it does not
stop the request. So writes and websockets that carry a browser Origin not in config.cors_origins() get 403. Requests
with no Origin (curl, scripts, the backend's own clients, tests) are unchanged.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from sim_worker.server import SimWorker, make_http_server

EVIL = "https://evil.example"
DEV = "http://localhost:5173"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "app.db"))
    monkeypatch.setenv("APP_UPLOAD_DIR", str(tmp_path / "uploads"))
    with TestClient(app) as c:
        yield c


def test_a_cross_site_post_is_refused_before_the_handler(client):
    r = client.post("/api/photos/999/analyze", headers={"Origin": EVIL})
    assert r.status_code == 403


@pytest.mark.parametrize("origin", ["null", "http://localhost.evil.example:5173"])
def test_odd_origins_are_refused_too(client, origin):
    assert client.post("/api/photos/999/analyze", headers={"Origin": origin}).status_code == 403


def test_the_dev_site_and_originless_callers_still_reach_the_handler(client):
    assert client.post("/api/photos/999/analyze", headers={"Origin": DEV}).status_code == 404
    assert client.post("/api/photos/999/analyze").status_code == 404


def test_reads_are_not_blocked_by_origin(client):
    assert client.get("/api/health", headers={"Origin": EVIL}).status_code == 200


def test_preflight_still_answered_for_the_dev_site(client):
    r = client.options("/api/rooms", headers={"Origin": DEV, "Access-Control-Request-Method": "POST"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == DEV


def test_responses_carry_nosniff(client):
    assert client.get("/api/health").headers["x-content-type-options"] == "nosniff"


def _ws_close_code(client, origin: str | None) -> int:
    headers = {"Origin": origin} if origin else {}
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/ws/teleop?role=nope", headers=headers) as ws:
            ws.receive_text()
    return e.value.code


def test_a_cross_site_websocket_is_refused(client):
    from app.routers.teleop import CLOSE_BAD_ROLE

    assert _ws_close_code(client, EVIL) == 1008  # policy violation, before the handler
    assert _ws_close_code(client, DEV) == CLOSE_BAD_ROLE  # reached the handler
    assert _ws_close_code(client, None) == CLOSE_BAD_ROLE


# ---------------------------------------------------------------------------------------------------- sim worker


class _NeverRuns:
    def execute(self, kind, req):  # pragma: no cover - the request must be refused before it is queued
        raise AssertionError("a browser request reached the executor")


def test_the_sim_worker_refuses_a_browser_post():
    worker = SimWorker(_NeverRuns(), robot="franka", cameras=False)
    srv = make_http_server(worker, "127.0.0.1", 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{srv.server_address[1]}/replay"
        req = urllib.request.Request(url, data=b"{}", method="POST",
                                     headers={"Content-Type": "text/plain", "Origin": EVIL})
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=10)
        assert e.value.code == 403
        assert json.loads(e.value.read())["error"] == "invalid"
    finally:
        srv.shutdown()
