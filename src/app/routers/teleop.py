"""Teleop relay: the browser streams HandPoseMsg JSON, the sim worker receives it.

    browser --/ws/teleop?role=browser--> this relay --/ws/teleop?role=sim--> sim worker

Each browser message is validated as demo_pipeline.teleop.HandPoseMsg. A valid one is
forwarded verbatim to the sim (or dropped if no sim is connected); an invalid one gets
{"type": "error", "detail": ...} back and is not forwarded. The browser is told
{"type": "status", "sim_connected": bool} when it connects and whenever the sim
connects or disconnects.

At most one connection per role: a second one is closed with code 4409; an unknown
role is closed with 4400. State is module-level: this is a single-user local app.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from demo_pipeline.teleop import HandPoseMsg

router = APIRouter(tags=["teleop"])

CLOSE_ROLE_TAKEN = 4409
CLOSE_BAD_ROLE = 4400
ROLES = ("browser", "sim")


@dataclass
class _Relay:
    browser: WebSocket | None = None
    sim: WebSocket | None = None
    messages_forwarded: int = 0


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


async def _run_browser(ws: WebSocket) -> None:
    await _send_sim_status()
    while True:
        text = await ws.receive_text()
        try:
            HandPoseMsg.model_validate_json(text)
        except ValidationError as e:
            await ws.send_json({"type": "error", "detail": str(e)})
            continue
        sim = _relay.sim
        if sim is None:
            continue
        try:
            await sim.send_text(text)
            _relay.messages_forwarded += 1
        except Exception:
            pass  # the sim dropped mid-send; its handler reports the disconnect


async def _run_sim(ws: WebSocket) -> None:
    await _send_sim_status()
    while True:
        await ws.receive_text()  # nothing is expected from the sim yet; just wait for disconnect


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
                await _send_sim_status()


@router.get("/teleop/status")
def teleop_status() -> dict:
    return {
        "browser_connected": _relay.browser is not None,
        "sim_connected": _relay.sim is not None,
        "messages_forwarded": _relay.messages_forwarded,
    }
