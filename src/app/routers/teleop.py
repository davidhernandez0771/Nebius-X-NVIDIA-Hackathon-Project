"""Teleop relay: the browser streams HandPoseMsg JSON, the sim worker receives it.

    browser --/ws/teleop?role=browser--> this relay --/ws/teleop?role=sim--> sim worker

Each browser message is validated as demo_pipeline.teleop.HandPoseMsg. A valid one is
forwarded verbatim to the sim (or dropped if no sim is connected); an invalid one gets
{"type": "error", "detail": ...} back and is not forwarded. The browser is told
{"type": "status", "sim_connected": bool} when it connects and whenever the sim
connects or disconnects.

Control (sprint 3c): a browser message with a "type" key must be a ControlMsg,
{"type": "control", "action": "record_start" | "record_stop" | "reset_scene"}. A valid one is
forwarded verbatim to the sim; an invalid one, or one sent while no sim is connected, gets an
error back. Controls are not counted in messages_forwarded (that counts hand poses only).

Sim status (sprint 3c): the sim may send SimStatusMsg, {"type": "sim_status", "recording",
"steps", "demo_id", "last_result", "paused"}. A valid one is forwarded to the browser (with
defaults filled in) and remembered, so a browser that connects later gets it right after its
"status" message; the memory is cleared when the sim disconnects. An invalid one gets
{"type": "error", ...} back to the sim.

Latency trace (off unless the browser opts in; sim_worker/teleop_trace.py): a hand message may carry a
"trace" object beside its HandPoseMsg fields. The relay validates the message without it, adds its own
"relay_in" / "relay_out" stamps (epoch ms) to it and forwards the result. Untraced messages are forwarded verbatim.

At most one connection per role: a second one is closed with code 4409; an unknown
role is closed with 4400. State is module-level: this is a single-user local app.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from demo_pipeline.teleop import HandPoseMsg

router = APIRouter(tags=["teleop"])

CLOSE_ROLE_TAKEN = 4409
CLOSE_BAD_ROLE = 4400
ROLES = ("browser", "sim")
TRACE_KEY = "trace"


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ControlMsg(_Msg):
    """Browser -> sim: drive the sim-side TeleopSession (sim_worker/teleop_session.py)."""

    type: Literal["control"]
    action: Literal["record_start", "record_stop", "reset_scene"]


class SimStatusMsg(_Msg):
    """Sim -> browser: the session's state, for the Record page."""

    type: Literal["sim_status"]
    recording: bool
    steps: int = Field(ge=0)  # control steps recorded so far (50 Hz)
    demo_id: str | None = None  # the last saved demo
    last_result: str | None = None  # one human-readable line about the last action
    paused: bool = False  # recording, but held because hand tracking was lost


def _parse(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None


def _is_typed(data) -> bool:
    """A JSON object with a "type" key: a control message rather than a HandPoseMsg."""
    return isinstance(data, dict) and "type" in data


def _now_ms() -> float:
    return time.time() * 1000.0


@dataclass
class _Relay:
    browser: WebSocket | None = None
    sim: WebSocket | None = None
    messages_forwarded: int = 0
    last_sim_status: dict | None = None


_relay = _Relay()


def reset_relay() -> None:
    """Forget all connections and counters (tests)."""
    global _relay
    _relay = _Relay()


async def _send_sim_status() -> None:
    if _relay.browser is not None:
        try:
            await _relay.browser.send_json({"type": "status", "sim_connected": _relay.sim is not None})
        except Exception:
            pass  # the browser is going away; its own handler cleans up


async def _forward_control(ws: WebSocket, text: str) -> None:
    try:
        ControlMsg.model_validate_json(text)
    except ValidationError as e:
        await ws.send_json({"type": "error", "detail": str(e)})
        return
    sim = _relay.sim
    if sim is None:
        await ws.send_json({"type": "error", "detail": "no sim worker is connected; the control was not delivered"})
        return
    try:
        await sim.send_text(text)
    except Exception:
        pass  # the sim dropped mid-send; its handler reports the disconnect


async def _run_browser(ws: WebSocket) -> None:
    await _send_sim_status()
    if _relay.sim is not None and _relay.last_sim_status is not None:
        await ws.send_json(_relay.last_sim_status)
    while True:
        text = await ws.receive_text()
        relay_in = _now_ms()
        data = _parse(text)
        if _is_typed(data):
            await _forward_control(ws, text)
            continue
        trace = data.pop(TRACE_KEY) if isinstance(data, dict) and TRACE_KEY in data else None
        try:
            HandPoseMsg.model_validate_json(text if trace is None else json.dumps(data))
        except ValidationError as e:
            await ws.send_json({"type": "error", "detail": str(e)})
            continue
        sim = _relay.sim
        if sim is None:
            continue
        if trace is not None:
            stamps = trace if isinstance(trace, dict) else {}
            text = json.dumps({**data, TRACE_KEY: {**stamps, "relay_in": relay_in, "relay_out": _now_ms()}})
        try:
            await sim.send_text(text)
            _relay.messages_forwarded += 1
        except Exception:
            pass  # the sim dropped mid-send; its handler reports the disconnect


async def _run_sim(ws: WebSocket) -> None:
    await _send_sim_status()
    while True:
        text = await ws.receive_text()
        try:
            status = SimStatusMsg.model_validate_json(text)
        except ValidationError as e:
            await ws.send_json({"type": "error", "detail": str(e)})
            continue
        _relay.last_sim_status = status.model_dump(mode="json")
        browser = _relay.browser
        if browser is not None:
            try:
                await browser.send_json(_relay.last_sim_status)
            except Exception:
                pass  # the browser is going away; its own handler cleans up


@router.websocket("/ws/teleop")
async def teleop_ws(ws: WebSocket, role: str = "") -> None:
    await ws.accept()
    if role not in ROLES:
        await ws.close(code=CLOSE_BAD_ROLE, reason=f"role must be one of {ROLES}")
        return
    if getattr(_relay, role) is not None:
        await ws.close(code=CLOSE_ROLE_TAKEN, reason=f"a {role} is already connected")
        return

    setattr(_relay, role, ws)
    try:
        await (_run_browser(ws) if role == "browser" else _run_sim(ws))
    except WebSocketDisconnect:
        pass
    finally:
        if getattr(_relay, role) is ws:
            setattr(_relay, role, None)
            if role == "sim":
                _relay.last_sim_status = None
                await _send_sim_status()


@router.get("/teleop/status")
def teleop_status() -> dict:
    return {
        "browser_connected": _relay.browser is not None,
        "sim_connected": _relay.sim is not None,
        "messages_forwarded": _relay.messages_forwarded,
    }
