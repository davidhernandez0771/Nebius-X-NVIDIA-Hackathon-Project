"""/ws/teleop relay: browser hand-pose messages are validated and forwarded to the sim worker."""
from __future__ import annotations

import json
import time

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


# --- sprint 3c: control (browser -> sim) and sim_status (sim -> browser) ------------------

def _control(action: str) -> dict:
    return {"type": "control", "action": action}


def _sim_status(**over) -> dict:
    status = {"type": "sim_status", "recording": True, "steps": 123, "demo_id": None, "last_result": None}
    status.update(over)
    return status


@pytest.mark.parametrize("action", ["record_start", "record_stop", "record_discard", "reset_scene"])
def test_control_message_is_forwarded_to_sim(client, action):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        browser.send_json(_control(action))

        assert sim.receive_json() == _control(action)


def test_invalid_control_is_rejected_and_not_forwarded(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        browser.send_json({"type": "control", "action": "self_destruct"})
        error = browser.receive_json()
        browser.send_json({"type": "control", "action": "record_start", "extra": 1})
        error_2 = browser.receive_json()
        browser.send_json({"type": "teleport"})
        error_3 = browser.receive_json()
        browser.send_json(_control("record_stop"))

        assert error["type"] == "error" and "action" in error["detail"]
        assert error_2["type"] == "error"
        assert error_3["type"] == "error"
        assert sim.receive_json() == _control("record_stop")  # the first thing the sim sees


def test_control_without_a_sim_is_answered_with_an_error(client):
    with client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        browser.send_json(_control("record_start"))
        error = browser.receive_json()

    assert error["type"] == "error" and "sim" in error["detail"]


def test_controls_do_not_count_as_forwarded_hand_messages(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        browser.send_json(_control("reset_scene"))
        sim.receive_json()
        assert client.get("/teleop/status").json()["messages_forwarded"] == 0


def test_sim_status_is_forwarded_to_browser(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        status = _sim_status(recording=False, steps=376, demo_id="human_20261016_ab12",
                             last_result="saved human_20261016_ab12: verified success")
        sim.send_json(status)

        assert browser.receive_json() == {**status, "paused": False}


def test_sim_status_paused_flag_passes_through(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        sim.send_json(_sim_status(paused=True))

        assert browser.receive_json()["paused"] is True


def test_invalid_sim_status_gets_an_error_back_and_is_not_forwarded(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        sim.send_json({"type": "sim_status", "recording": "maybe", "steps": -1})
        error = sim.receive_json()
        sim.send_text("not json")
        error_2 = sim.receive_json()
        sim.send_json(_sim_status(steps=1))

        assert error["type"] == "error"
        assert error_2["type"] == "error"
        assert browser.receive_json()["steps"] == 1  # the first thing the browser sees


def test_a_reconnecting_browser_gets_the_last_sim_status(client):
    with client.websocket_connect(SIM) as sim:
        with client.websocket_connect(BROWSER) as browser:
            browser.receive_json()
            sim.send_json(_sim_status(steps=7))
            browser.receive_json()
        with client.websocket_connect(BROWSER) as browser:
            assert browser.receive_json() == {"type": "status", "sim_connected": True}
            assert browser.receive_json()["steps"] == 7


def test_sim_disconnect_forgets_its_status(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        sim.send_json(_sim_status())
        browser.receive_json()
    with client.websocket_connect(BROWSER) as browser:
        assert browser.receive_json() == {"type": "status", "sim_connected": False}
        browser.send_text("bad")  # the next message must be this error, not a stale sim_status
        assert browser.receive_json()["type"] == "error"


def test_a_new_sim_does_not_inherit_the_old_sims_status(client):
    with client.websocket_connect(SIM) as sim:
        sim.send_json(_sim_status(steps=99))
        sim.send_text("bad")  # the error reply proves the status above was processed
        sim.receive_json()
    with client.websocket_connect(SIM), client.websocket_connect(BROWSER) as browser:
        assert browser.receive_json() == {"type": "status", "sim_connected": True}
        browser.send_text("bad")
        assert browser.receive_json()["type"] == "error"  # not the old sim's steps=99


# --- latency trace (sim_worker/teleop_trace.py): an optional "trace" object beside the HandPoseMsg fields ---

def _traced_text(**stamps) -> str:
    data = json.loads(_msg_text())
    data["trace"] = stamps
    return json.dumps(data)


def test_a_traced_message_is_forwarded_with_the_relays_stamps_added(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        before = time.time() * 1000.0
        browser.send_text(_traced_text(cap=1.0, send=2.0))
        got = json.loads(sim.receive_text())
        after = time.time() * 1000.0

        trace = got.pop("trace")
        assert got == json.loads(_msg_text())  # the hand fields are untouched
        assert trace["cap"] == 1.0 and trace["send"] == 2.0
        assert before <= trace["relay_in"] <= trace["relay_out"] <= after
        assert client.get("/teleop/status").json()["messages_forwarded"] == 1


def test_a_traced_message_is_still_validated(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        browser.receive_json()
        browser.send_text(json.dumps({"t_ms": 1, "tracking_ok": True, "trace": {"cap": 1.0}}))
        error = browser.receive_json()
        browser.send_text(_msg_text(2000.0))

        assert error["type"] == "error" and "wrist_uv" in error["detail"]
        assert sim.receive_text() == _msg_text(2000.0)
