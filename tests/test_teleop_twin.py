"""The robot twin's live stream: the sink's sim_twin_scene / sim_twin messages (sim_worker.teleop_session),
their rate limit (TwinSender), and the relay's read-only role=twin watchers (src/app/routers/teleop.py)."""
from __future__ import annotations

import json
import socket
import threading
import time

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, Scene
from demo_pipeline.teleop import HandPoseMsg
from sim_worker.teleop_session import TWIN_HZ, StepState, TeleopSession, TwinSender, TwinState, apply_inbox, dispatch

SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=7)
NAMES = [f"panda_joint{i}" for i in range(1, 8)] + ["panda_finger_joint1", "panda_finger_joint2"]
# Isaac Lab's Franka start pose (isaaclab_assets/robots/franka.py, FRANKA_PANDA_LEGACY_CFG.init_state)
REST = [0.0, -0.569, 0.0, -2.810, 0.0, 3.037, 0.741, 0.04, 0.04]


class TwinDriver:
    """Joint 1 follows the target's y and the cube sits where it was put; counts the twin reads."""

    joint_names = NAMES

    def __init__(self) -> None:
        self.q = np.array(REST)
        self.cube = np.array([0.5, 0.0, 0.025, 1.0, 0.0, 0.0, 0.0])
        self.twin_reads = 0

    def reset(self, scene: Scene) -> None:
        self.q = np.array(REST)

    def apply(self, target: Pose, gripper: int) -> None:
        self.q[0] = target.pos[1]

    def read_state(self) -> StepState:
        return StepState(joint_pos=self.q.copy(), action=self.q.copy(), ee_pos=np.array([0.4, 0.0, 0.3]),
                         ee_quat=np.array([0.0, 1.0, 0.0, 0.0]), cube_pos=self.cube[:3].copy(),
                         contact_gripper_cube=False, contact_arm_bin=False, contact_arm_table=False,
                         max_contact_force=0.0)

    def read_twin(self) -> TwinState:
        self.twin_reads += 1
        return TwinState(joint_pos=self.q.copy(), cube_pose=self.cube.copy())


class NoTwinDriver(TwinDriver):
    joint_names = None


def hand(u=0.5, pinch=0.8) -> HandPoseMsg:
    return HandPoseMsg(t_ms=0.0, tracking_ok=True, wrist_uv=(u, 0.5), palm_width=0.1, pinch_ratio=pinch,
                       yaw_rad=0.0, frame_w=640, frame_h=480)


@pytest.fixture
def session():
    return TeleopSession(TwinDriver(), SCENE, lambda r: "ok")


class Clock:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


# --- the session's messages -----------------------------------------------------------------------------------


def test_twin_scene_names_the_joints_and_places_the_base_and_bin(session):
    assert session.twin_scene() == {
        "type": "sim_twin_scene",
        "robot": "franka",
        "joint_names": NAMES,
        "base": [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],  # sim_worker.robots: the Franka's root at the origin
        "bin": [0.5, 0.3, 0.0, 1.0, 0.0, 0.0, 0.0],
    }


def test_twin_rounds_the_joints_and_reports_the_gripper_sent(session):
    session.driver.q[1] = -0.56912345
    session.driver.q[2] = -0.00001
    twin = session.twin()
    assert twin["type"] == "sim_twin" and twin["gripper"] == 0
    assert twin["q"][:3] == [0.0, -0.5691, 0.0]  # 4 decimals; -0.0 comes out as 0.0
    assert twin["cube"] == [0.5, 0.0, 0.025, 1.0, 0.0, 0.0, 0.0]
    session.on_hand(hand(pinch=0.1))  # a closed pinch latches the gripper shut
    session.step()
    assert session.twin()["gripper"] == 1


def test_a_driver_without_twin_reads_sends_no_twin():
    s = TeleopSession(NoTwinDriver(), SCENE, lambda r: "ok")
    assert not s.has_twin and s.twin_scene() is None and s.twin() is None
    s.twin_watchers = 1
    assert TwinSender(s).due(object()) == []


def test_the_relay_s_watcher_count_is_kept_and_a_bad_one_is_reported(session):
    assert session.twin_watchers == 0
    assert dispatch(session, json.dumps({"type": "twin_watchers", "count": 2})) is None
    assert session.twin_watchers == 2
    assert "twin_watchers" in dispatch(session, json.dumps({"type": "twin_watchers", "count": -1}))
    assert "twin_watchers" in dispatch(session, json.dumps({"type": "twin_watchers", "count": True}))
    problems, stamps = apply_inbox(session, [(json.dumps({"type": "twin_watchers", "count": 0}), 1.0)])
    assert problems == [] and stamps is None and session.twin_watchers == 0


# --- TwinSender: when relay_loop sends ------------------------------------------------------------------------


def test_nothing_is_read_or_sent_while_no_page_watches(session):
    sender = TwinSender(session, clock=Clock())
    assert sender.due(object()) == []
    assert session.driver.twin_reads == 0


def test_scene_first_then_at_most_twin_hz_frames_and_none_while_still(session):
    clock, conn = Clock(), object()
    sender = TwinSender(session, clock=clock)
    session.twin_watchers = 1
    first = [json.loads(t) for t in sender.due(conn)]
    assert [m["type"] for m in first] == ["sim_twin_scene", "sim_twin"]

    clock.t += 0.02  # the next 50 Hz step: too soon
    session.driver.q[0] = 0.1
    assert sender.due(conn) == [] and session.driver.twin_reads == 1
    clock.t += 0.02  # 40 ms after the last frame: due
    (frame,) = [json.loads(t) for t in sender.due(conn)]
    assert frame["q"][0] == 0.1

    clock.t += 1.0 / TWIN_HZ
    assert sender.due(conn) == []  # nothing moved: read, but not sent
    assert session.driver.twin_reads == 3


def test_a_new_connection_or_a_lost_send_starts_with_the_scene_again(session):
    clock = Clock()
    sender = TwinSender(session, clock=clock)
    session.twin_watchers = 1
    sender.due("conn-1")
    clock.t += 1.0
    assert [json.loads(t)["type"] for t in sender.due("conn-2")] == ["sim_twin_scene", "sim_twin"]
    sender.lost()
    clock.t += 1.0
    assert [json.loads(t)["type"] for t in sender.due("conn-2")] == ["sim_twin_scene", "sim_twin"]


def test_steady_50_hz_ticks_send_25_frames_a_second(session):
    clock, conn = Clock(), object()
    sender = TwinSender(session, clock=clock)
    session.twin_watchers = 1
    frames = 0
    for k in range(50):
        session.driver.q[0] = k * 0.001  # moving every step
        frames += sum(json.loads(t)["type"] == "sim_twin" for t in sender.due(conn))
        clock.t += 0.02
    assert frames == 25


# --- the relay ------------------------------------------------------------------------------------------------

SIM = "/ws/teleop?role=sim"
TWIN = "/ws/teleop?role=twin"
BROWSER = "/ws/teleop?role=browser"
SCENE_MSG = {"type": "sim_twin_scene", "robot": "franka", "joint_names": NAMES,
             "base": [0, 0, 0, 1, 0, 0, 0], "bin": [0.5, 0.3, 0, 1, 0, 0, 0]}
FRAME = {"type": "sim_twin", "q": REST, "gripper": 0, "cube": [0.5, 0, 0.025, 1, 0, 0, 0]}


@pytest.fixture
def client(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers import teleop

    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("APP_UPLOAD_DIR", str(tmp_path / "uploads"))
    teleop.reset_relay()
    with TestClient(app) as c:
        yield c
    teleop.reset_relay()



def test_watchers_get_the_scene_and_frames_and_the_sim_hears_how_many_watch(client):
    with client.websocket_connect(SIM) as sim:
        with client.websocket_connect(TWIN) as a:
            assert a.receive_json() == {"type": "status", "sim_connected": True}
            assert sim.receive_json() == {"type": "twin_watchers", "count": 1}
            with client.websocket_connect(TWIN) as b:
                assert b.receive_json() == {"type": "status", "sim_connected": True}
                assert sim.receive_json() == {"type": "twin_watchers", "count": 2}
                from app.routers import teleop

                assert len(teleop._relay.twins) == 2
                sim.send_text(json.dumps(SCENE_MSG))
                sim.send_text(json.dumps(FRAME))
                for w in (a, b):
                    assert w.receive_json()["type"] == "sim_twin_scene"
                    got = w.receive_json()
                    assert got["type"] == "sim_twin" and got["q"] == REST and got["gripper"] == 0
            assert sim.receive_json() == {"type": "twin_watchers", "count": 1}


def test_a_late_watcher_gets_the_last_scene_and_frame(client):
    with client.websocket_connect(SIM) as sim:
        sim.send_text(json.dumps(SCENE_MSG))
        sim.send_text(json.dumps(FRAME))
        moved = {**FRAME, "q": [0.1, *REST[1:]], "gripper": 1}
        sim.send_text(json.dumps(moved))
        time.sleep(0.1)  # the relay handles the sim's messages in order; let it get through them
        with client.websocket_connect(TWIN) as w:
            assert w.receive_json() == {"type": "status", "sim_connected": True}
            assert w.receive_json()["joint_names"] == NAMES
            last = w.receive_json()
            assert last["q"][0] == 0.1 and last["gripper"] == 1


def test_a_bad_twin_message_is_refused_and_not_forwarded(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(TWIN) as w:
        w.receive_json()
        sim.receive_json()  # twin_watchers 1
        sim.send_text(json.dumps({**FRAME, "cube": [0.5, 0, 0.025]}))
        error = sim.receive_json()
        assert error["type"] == "error" and "pose is" in error["detail"]
        sim.send_text(json.dumps({**FRAME, "gripper": 2}))
        assert sim.receive_json()["type"] == "error"
        sim.send_text(json.dumps(FRAME))
        assert w.receive_json()["type"] == "sim_twin"  # the first thing the watcher sees is the valid frame


def test_when_the_sim_leaves_watchers_hear_it_and_the_twin_is_forgotten(client):
    with client.websocket_connect(TWIN) as w:
        assert w.receive_json() == {"type": "status", "sim_connected": False}
        with client.websocket_connect(SIM) as sim:
            assert w.receive_json() == {"type": "status", "sim_connected": True}
            assert sim.receive_json() == {"type": "twin_watchers", "count": 1}  # told on connect: someone watches
            sim.send_text(json.dumps(SCENE_MSG))
            w.receive_json()
        assert w.receive_json() == {"type": "status", "sim_connected": False}
    from app.routers import teleop

    assert teleop._relay.last_twin_scene is None and teleop._relay.last_twin is None


def test_the_browser_socket_carries_no_twin_and_watchers_cannot_drive(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(BROWSER) as browser:
        assert browser.receive_json() == {"type": "status", "sim_connected": True}
        with client.websocket_connect(TWIN) as w:
            w.receive_json()
            sim.receive_json()  # twin_watchers 1
            w.send_text(json.dumps({"type": "control", "action": "record_start"}))  # ignored
            sim.send_text(json.dumps(FRAME))
            assert w.receive_json()["type"] == "sim_twin"
            sim.send_text(json.dumps({"type": "sim_status", "recording": False, "steps": 0}))
            assert browser.receive_json()["type"] == "sim_status"  # the frame never reached the browser
        assert sim.receive_json() == {"type": "twin_watchers", "count": 0}  # not the watcher's control


# --- end to end: the sink's relay_loop through the real relay -------------------------------------------------


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def relay_server(monkeypatch, tmp_path):
    uvicorn = pytest.importorskip("uvicorn")
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("APP_UPLOAD_DIR", str(tmp_path / "uploads"))
    app = pytest.importorskip("app.main").app
    from app.routers import teleop

    teleop.reset_relay()
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert time.monotonic() < deadline, "relay server did not start"
        time.sleep(0.05)
    yield f"ws://127.0.0.1:{port}/ws/teleop"
    server.should_exit = True
    thread.join(timeout=10)
    teleop.reset_relay()


def test_relay_loop_streams_the_twin_to_a_watcher_at_most_30_a_second(relay_server):
    from websockets.sync.client import connect

    from sim_worker.teleop_session import relay_loop

    driver, stop = TwinDriver(), threading.Event()
    session = TeleopSession(driver, SCENE, lambda r: "ok")
    sink = threading.Thread(target=relay_loop, args=(session, relay_server + "?role=sim"),
                            kwargs={"should_stop": stop.is_set, "log": lambda m: None}, daemon=True)
    sink.start()
    frames, first = [], []
    try:
        with connect(relay_server + "?role=twin") as w, connect(relay_server + "?role=browser") as browser:
            deadline = time.monotonic() + 10
            while not first and time.monotonic() < deadline:
                msg = json.loads(w.recv(timeout=10))
                if msg["type"] == "sim_twin_scene":
                    first.append(msg)
            t0 = time.monotonic()
            u = 0.5
            while time.monotonic() - t0 < 1.0:  # a moving hand: the robot changes every step
                u = 0.3 if u > 0.6 else u + 0.01
                browser.send(hand(u=u).model_dump_json())
                try:
                    msg = json.loads(w.recv(timeout=0.01))
                except TimeoutError:
                    continue
                if msg["type"] == "sim_twin":
                    frames.append(msg)
    finally:
        stop.set()
        sink.join(timeout=10)
    assert first[0]["joint_names"] == NAMES
    assert 10 <= len(frames) <= 31  # ~25 a second at 50 Hz steps; never more than 30
    assert len({f["q"][0] for f in frames}) > 5  # the joints moved with the hand


def test_the_twin_frame_carries_the_contact_and_the_floor(client):
    with client.websocket_connect(SIM) as sim, client.websocket_connect(TWIN) as w:
        w.receive_json()
        sim.receive_json()  # twin_watchers 1
        sim.send_text(json.dumps(SCENE_MSG))
        frame = {**FRAME, "floor": True, "contact": {"force_n": 7.3, "body": "panda_hand", "against": "bin"}}
        sim.send_text(json.dumps(frame))
        w.receive_json()  # the scene
        assert w.receive_json() == frame
        sim.send_text(json.dumps({**FRAME, "contact": {"force_n": 3, "against": "floor"}}))
        assert sim.receive_json()["type"] == "error"
        sim.send_text(json.dumps(FRAME))
        assert w.receive_json() == FRAME  # an older sim's frame goes through as before


def test_a_plans_twin_carries_every_object_and_every_cube(client):
    objects = [{"id": "cube", "kind": "cube", "color": "red", "size": 0.05, "pose": [0.5, 0.1, 0.025, 1, 0, 0, 0]},
               {"id": "distractor", "kind": "cube", "color": "yellow", "size": 0.05, "pose": [0.5, 0.185, 0.025, 1, 0, 0, 0]},
               {"id": "bin", "kind": "bin", "color": "blue", "inner": [0.2, 0.2, 0.08], "pose": [0.55, -0.2, 0, 1, 0, 0, 0]}]
    with client.websocket_connect(SIM) as sim, client.websocket_connect(TWIN) as w:
        w.receive_json()
        sim.receive_json()  # twin_watchers 1
        scene = {**SCENE_MSG, "objects": objects}
        sim.send_text(json.dumps(scene))
        assert w.receive_json() == scene
        frame = {**FRAME, "cubes": {"cube": [0.5, 0.1, 0.025, 1, 0, 0, 0], "distractor": [0.5, 0.185, 0.025, 1, 0, 0, 0]}}
        sim.send_text(json.dumps(frame))
        assert w.receive_json() == frame
        sim.send_text(json.dumps({**SCENE_MSG, "objects": [{**objects[0], "kind": "sphere"}]}))
        assert sim.receive_json()["type"] == "error"
