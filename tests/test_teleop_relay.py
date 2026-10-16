"""/ws/teleop relay: browser hand-pose messages are validated and forwarded to the sim worker."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.routers import teleop
from demo_pipeline.teleop import HandPoseMsg

BROWSER = "/ws/teleop?role=browser"
SIM = "/ws/teleop?role=sim"


@pytest.fixture
def client(monkeypatch, tmp_path):
    # Same throwaway-DB setup as conftest's `api` fixture, but entered as a context
    # manager so every WebSocket shares one event loop (the relay forwards across them).
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("APP_UPLOAD_DIR", str(tmp_path / "uploads"))
    teleop.reset_relay()
    with TestClient(app) as c:
        yield c
    teleop.reset_relay()


def _msg_text(t_ms: float = 1000.0) -> str:
    return HandPoseMsg(
        t_ms=t_ms, tracking_ok=True, wrist_uv=(0.5, 0.4), palm_width=0.1,
        pinch_ratio=0.8, yaw_rad=0.1, frame_w=1280, frame_h=720,
    ).model_dump_json()


def test_browser_message_is_forwarded_to_sim(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        assert browser.receive_json() == {"type": "status", "sim_connected": True}
        text = _msg_text()
        browser.send_text(text)

        assert sim.receive_text() == text


def test_untracked_message_is_forwarded_too(client):
    untracked = HandPoseMsg(
        t_ms=5.0, tracking_ok=False, wrist_uv=(0.0, 0.0), palm_width=0.0,
        pinch_ratio=0.0, yaw_rad=0.0, frame_w=640, frame_h=480,
    ).model_dump_json()
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        browser.send_text(untracked)

        assert sim.receive_text() == untracked


def test_invalid_message_returns_error_and_is_not_forwarded(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        browser.send_text('{"t_ms": 1, "tracking_ok": true}')
        error = browser.receive_json()
        browser.send_text("not json at all")
        error_2 = browser.receive_json()
        valid = _msg_text(2000.0)
        browser.send_text(valid)

        assert error["type"] == "error" and "wrist_uv" in error["detail"]
        assert error_2["type"] == "error"
        assert sim.receive_text() == valid  # the first thing the sim sees is the valid message
        assert client.get("/teleop/status").json()["messages_forwarded"] == 1


def test_browser_gets_sim_status_on_connect_and_change(client):
    with client.websocket_connect(BROWSER) as browser:
        assert browser.receive_json() == {"type": "status", "sim_connected": False}

        # No sim: a valid message is dropped without any error.
        browser.send_text(_msg_text())
        browser.send_text("bad")  # processed in order, so this reply proves the first was handled
        assert browser.receive_json()["type"] == "error"

        with client.websocket_connect(SIM):
            assert browser.receive_json() == {"type": "status", "sim_connected": True}
        assert browser.receive_json() == {"type": "status", "sim_connected": False}

    assert client.get("/teleop/status").json() == {
        "browser_connected": False, "sim_connected": False, "messages_forwarded": 0,
    }


def test_second_connection_for_same_role_is_rejected_4409(client):
    for role_url in (BROWSER, SIM):
        with client.websocket_connect(role_url):
            with client.websocket_connect(role_url) as second:
                with pytest.raises(WebSocketDisconnect) as closed:
                    second.receive_text()
                    second.receive_text()  # the browser role gets a status message first
            assert closed.value.code == 4409


def test_unknown_role_is_rejected(client):
    with client.websocket_connect("/ws/teleop?role=spy") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
    assert closed.value.code == 4400


def test_status_endpoint_counts_forwarded_messages(client):
    assert client.get("/teleop/status").json() == {
        "browser_connected": False, "sim_connected": False, "messages_forwarded": 0,
    }
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        for i in range(3):
            browser.send_text(_msg_text(1000.0 + i))
            sim.receive_text()

        assert client.get("/teleop/status").json() == {
            "browser_connected": True, "sim_connected": True, "messages_forwarded": 3,
        }
