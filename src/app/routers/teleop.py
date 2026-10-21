"""Teleop relay: the browser streams HandPoseMsg JSON, the sim worker receives it.

    browser --/ws/teleop?role=browser--> this relay --/ws/teleop?role=sim--> sim worker

Each browser message is validated as demo_pipeline.teleop.HandPoseMsg. A valid one is
forwarded verbatim to the sim (or dropped if no sim is connected); an invalid one gets
{"type": "error", "detail": ...} back and is not forwarded. The browser is told
{"type": "status", "sim_connected": bool} when it connects and whenever the sim
connects or disconnects.

Control (sprint 3c): a browser message with a "type" key must be a ControlMsg,
{"type": "control", "action": "record_start" | "record_stop" | "record_discard" | "reset_scene"}, or
{"type": "control", "action": "set_input", "input": "camera" | "keyboard" | "mouse"} (how the page drives the arm:
the sim smooths keyboard and mouse targets and saves the input with each demo), or
{"type": "control", "action": "set_assist", "soft_floor": bool} (demo_pipeline.soft_floor, on by default). A valid one is
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

Robot twin (the Record page's 3D view, web/src/twin): pages watch it on /ws/teleop?role=twin, read-only and
as many as like. The sim sends SimTwinSceneMsg (robot, joint names, base and bin poses) once per connection and
SimTwinMsg (joints, gripper, cube pose) at most ~30 times a second (sim_worker.teleop_session.TwinSender). The
relay validates both, forwards them to every watcher, and keeps the last of each for a watcher that connects
later; it forgets them when the sim disconnects. It tells the sim {"type": "twin_watchers", "count": n} whenever
a watcher comes or goes, and on connect if any are watching, so the sim reads and sends twins only while someone
watches.
A watcher gets {"type": "status", "sim_connected": bool} on connect and whenever the sim comes or goes; whatever
it sends is ignored.

At most one browser and one sim: a second one is closed with code 4409; an unknown
role is closed with 4400. State is module-level: this is a single-user local app.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Annotated, Literal

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError, field_validator, model_validator

from demo_pipeline.schemas import InputMode
from demo_pipeline.teleop import HandPoseMsg

router = APIRouter(tags=["teleop"])

CLOSE_ROLE_TAKEN = 4409
CLOSE_BAD_ROLE = 4400
ROLES = ("browser", "sim", "twin")
TRACE_KEY = "trace"


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ControlMsg(_Msg):
    """Browser -> sim: drive the sim-side TeleopSession (sim_worker/teleop_session.py)."""

    type: Literal["control"]
    action: Literal["record_start", "record_stop", "record_discard", "reset_scene", "set_input", "set_assist",
                    "set_scene"]
    input: InputMode | None = None  # set_input only
    soft_floor: StrictBool | None = None  # set_assist only: the soft floor on or off (demo_pipeline.soft_floor)
    scene: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$")] | None = None  # set_scene only: a library id

    @model_validator(mode="after")
    def _input_with_set_input(self) -> "ControlMsg":
        if (self.action == "set_input") != (self.input is not None):
            raise ValueError("set_input needs an input, and only set_input takes one")
        if (self.action == "set_assist") != (self.soft_floor is not None):
            raise ValueError("set_assist needs soft_floor, and only set_assist takes one")
        if (self.action == "set_scene") != (self.scene is not None):
            raise ValueError("set_scene needs a scene, and only set_scene takes one")
        return self


class SettleMsg(_Msg):
    ok: bool
    errors: list[str] = Field(default_factory=list)


class PlaylistMsg(_Msg):
    index: int = Field(ge=0)  # the current scene's place in the list
    of: int = Field(ge=1)
    take: int = Field(ge=0)  # takes saved in it so far
    takes_per_scene: int = Field(ge=1)


class SceneStatusMsg(_Msg):
    """The live scene (demo_pipeline.scene_library): its id, name and plan hash; the Isaac settle check when the sim
    ran it; the scene a requested sim restart will bring up."""

    id: str
    name: str = ""
    hash: str = Field(pattern=r"^[0-9a-f]{16}$")
    settle: SettleMsg | None = None
    switching: str | None = None
    playlist: PlaylistMsg | None = None  # a recording session's scene list: where it is


class SimStatusMsg(_Msg):
    """Sim -> browser: the session's state, for the Record page."""

    type: Literal["sim_status"]
    recording: bool
    steps: int = Field(ge=0)  # control steps recorded so far (50 Hz)
    demo_id: str | None = None  # the last saved demo
    last_result: str | None = None  # one human-readable line about the last action
    paused: bool = False  # recording, but held because hand tracking was lost
    soft_floor: bool | None = None  # the soft floor is on (None: a sim from before it)
    contact_peak_n: float | None = Field(default=None, ge=0)  # the take's largest arm contact force, N
    scene: SceneStatusMsg | None = None  # the scene picker's scene (None: today's sink, no library)


class ContactMsg(_Msg):
    """The arm's hardest push on the bin or table over the last control step (sim_worker.teleop_session.ContactReading)."""

    force_n: float = Field(ge=0)
    body: str | None = None  # the robot link pushing (the twin's URDF link name)
    against: Literal["bin", "table"] | None = None


def _pose7(v: list[float]) -> list[float]:
    if len(v) != 7:
        raise ValueError(f"a pose is [x, y, z, qw, qx, qy, qz]; got {len(v)} numbers")
    return v


class TwinObjectMsg(_Msg):
    """One object of a plan's scene, for the twin: a cube (edge size) or a bin (inner size), its colour and pose7."""

    id: str
    kind: Literal["cube", "bin"]
    color: str
    size: float | None = Field(default=None, gt=0)  # cube edge, m
    inner: list[float] | None = Field(default=None, min_length=3, max_length=3)  # bin inside x, y, wall height, m
    pose: list[float]

    _check_pose = field_validator("pose")(_pose7)

    @model_validator(mode="after")
    def _size_for_kind(self) -> "TwinObjectMsg":
        if (self.kind == "cube") != (self.size is not None) or (self.kind == "bin") != (self.inner is not None):
            raise ValueError("a cube has a size, a bin has inner sizes")
        return self


class SimTwinSceneMsg(_Msg):
    """Sim -> twin watchers: what stays put while the twin moves. Poses are [x, y, z, qw, qx, qy, qz], env frame."""

    type: Literal["sim_twin_scene"]
    robot: str
    joint_names: list[str] = Field(min_length=1, max_length=64)
    base: list[float]  # the robot's root
    bin: list[float]
    objects: list[TwinObjectMsg] | None = Field(default=None, max_length=10)  # a plan's every cube and bin

    _check_poses = field_validator("base", "bin")(_pose7)


class SimTwinMsg(_Msg):
    """Sim -> twin watchers: the robot now. q follows the scene's joint_names."""

    type: Literal["sim_twin"]
    q: list[float] = Field(min_length=1, max_length=64)
    gripper: Literal[0, 1]  # the gripper sent: 0 open, 1 closed
    cube: list[float]  # [x, y, z, qw, qx, qy, qz]
    floor: bool | None = None  # the soft floor is holding the target up now
    contact: ContactMsg | None = None  # from a sim that reads contacts: the twin glows where the arm pushes
    cubes: dict[str, list[float]] | None = Field(default=None, max_length=10)  # a plan's every cube, id -> pose7

    _check_cube = field_validator("cube")(_pose7)

    @field_validator("cubes")
    @classmethod
    def _check_cubes(cls, v):
        if v is not None:
            for pose in v.values():
                _pose7(pose)
        return v


# Fields added later: left out of what the relay forwards while a sim doesn't send them, so older sims' messages
# go through exactly as before.
_OPTIONAL = ("soft_floor", "contact_peak_n", "floor", "contact", "scene", "objects", "cubes")


def _forward(msg: BaseModel) -> dict:
    out = msg.model_dump(mode="json")
    for key in _OPTIONAL:
        if out.get(key, 0) is None:
            out.pop(key)
    if out.get("objects"):  # a cube has no inner sizes, a bin no edge: leave the unused one out
        out["objects"] = [{k: v for k, v in o.items() if v is not None} for o in out["objects"]]
    return out


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
    twins: set[WebSocket] = field(default_factory=set)
    last_twin_scene: dict | None = None
    last_twin: dict | None = None


_relay = _Relay()


def reset_relay() -> None:
    """Forget all connections and counters (tests)."""
    global _relay
    _relay = _Relay()


async def _send_sim_status() -> None:
    status = {"type": "status", "sim_connected": _relay.sim is not None}
    for ws in [_relay.browser, *_relay.twins]:
        if ws is not None:
            try:
                await ws.send_json(status)
            except Exception:
                pass  # the page is going away; its own handler cleans up


async def _send_twin_watchers() -> None:
    if _relay.sim is not None:
        try:
            await _relay.sim.send_json({"type": "twin_watchers", "count": len(_relay.twins)})
        except Exception:
            pass  # the sim dropped; its handler reports the disconnect


async def _to_twins(msg: dict) -> None:
    for ws in list(_relay.twins):
        try:
            await ws.send_json(msg)
        except Exception:
            pass  # the watcher is going away; its own handler cleans up


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


_TWIN_MSGS = {"sim_twin_scene": (SimTwinSceneMsg, "last_twin_scene"), "sim_twin": (SimTwinMsg, "last_twin")}


async def _run_sim(ws: WebSocket) -> None:
    await _send_sim_status()
    if _relay.twins:  # the sim starts at 0 watchers; tell it only when that's wrong
        await _send_twin_watchers()
    while True:
        text = await ws.receive_text()
        data = _parse(text)
        kind = data.get("type") if isinstance(data, dict) else None
        if kind in _TWIN_MSGS:
            model, memory = _TWIN_MSGS[kind]
            try:
                msg = _forward(model.model_validate(data))
            except ValidationError as e:
                await ws.send_json({"type": "error", "detail": str(e)})
                continue
            setattr(_relay, memory, msg)
            await _to_twins(msg)
            continue
        try:
            status = SimStatusMsg.model_validate_json(text)
        except ValidationError as e:
            await ws.send_json({"type": "error", "detail": str(e)})
            continue
        _relay.last_sim_status = _forward(status)
        browser = _relay.browser
        if browser is not None:
            try:
                await browser.send_json(_relay.last_sim_status)
            except Exception:
                pass  # the browser is going away; its own handler cleans up


async def _run_twin(ws: WebSocket) -> None:
    _relay.twins.add(ws)
    try:
        await ws.send_json({"type": "status", "sim_connected": _relay.sim is not None})
        for last in (_relay.last_twin_scene, _relay.last_twin):
            if _relay.sim is not None and last is not None:
                await ws.send_json(last)
        await _send_twin_watchers()
        while True:
            await ws.receive_text()  # read-only: what a watcher sends is ignored
    finally:
        _relay.twins.discard(ws)
        await _send_twin_watchers()


@router.websocket("/ws/teleop")
async def teleop_ws(ws: WebSocket, role: str = "") -> None:
    await ws.accept()
    if role not in ROLES:
        await ws.close(code=CLOSE_BAD_ROLE, reason=f"role must be one of {ROLES}")
        return
    if role == "twin":
        try:
            await _run_twin(ws)
        except WebSocketDisconnect:
            pass
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
                _relay.last_twin_scene = _relay.last_twin = None
                await _send_sim_status()


@router.get("/teleop/status")
def teleop_status() -> dict:
    return {
        "browser_connected": _relay.browser is not None,
        "sim_connected": _relay.sim is not None,
        "messages_forwarded": _relay.messages_forwarded,
    }
