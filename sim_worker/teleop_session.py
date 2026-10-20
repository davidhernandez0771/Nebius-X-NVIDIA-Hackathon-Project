"""Sim-side webcam teleop: a pure state machine that turns HandPoseMsgs into a recorded human Demo (spec 8.1).

    idle --record_start--> recording --record_stop--> saving --(save_fn returns)--> idle
                           recording --record_discard--> idle (nothing saved, no demo folder written)

Every control step (TELEOP_DT = 50 Hz sim time) the session takes the latest HandPoseMsg, maps it
with demo_pipeline.teleop (to_ee_target + GripperLatch), and drives the robot through an injected
TeleopDriver. It follows the hand while idle too, so the person can line up before recording.

- Before any hand, or after reset_scene, it holds the robot's current tool pose with the gripper open.
- While tracking is lost it holds the last target; GripperLatch holds the gripper.
- Spec 8.1, "hand tracking lost: recording pauses": once no tracked message has arrived for
  more than LOST_PAUSE_S (wall clock), recording pauses. The steps are not recorded, so the
  pause is cut out of the demo, and the status says `paused`. It resumes with the next tracked
  message. Shorter dropouts are recorded as a hold.
- The Trajectory is the tool pose the arm reached per recorded step, at t = k * TELEOP_DT (sim time),
  whatever the wall-clock pace; Demo.commanded keeps the hand target per step. human_seconds is the
  wall-clock time from start to stop.
- On stop, the Demo (source "human") and the per-step StepStates go to an injected save_fn as a
  Recording. make_store_saver() writes them into a DemoStore with episode_io.
- set_input (the Record page's input switch: "camera", "keyboard" or "mouse") is kept on the session and saved as
  each demo's Demo.input. Keyboard and mouse targets are smoothed once more here (_smoothed: a critically
  damped filter, SMOOTH_TAU_S): the page sends ~30 messages a second and each 50 Hz step takes the newest, so even a
  perfectly smooth glide arrives as a staircase, and its jerk fails the rules' jitter check (~70 m/s^3 against 20).
  The camera path is not filtered, as before.
- record_discard ("Stop & discard" on the Record page) ends the recording and drops it: save_fn is never called.
  It also forgets the last saved demo id, so the page's "Delete last demo" can't reach back to an older one.
- The robot twin (the Record page's 3D view): twin_scene() and twin() are the relay's sim_twin_scene and
  sim_twin messages, the robot's joints, the gripper sent and the cube's pose. relay_loop sends them at most
  TWIN_HZ times a second, only while the relay says a page is watching, and only when they change. A driver
  without read_twin() sends none.
- The soft floor (demo_pipeline.soft_floor; set_assist, on by default): every step, for every input, the target can't
  go more than ~1 cm under the bin's rim inside the bin, or under the table top elsewhere. Each saved demo says so in
  Demo.assist (on for any recorded step, how many steps it held the target up, and in how many separate holds);
  sim_twin's "floor" says it is holding now. Contact: a driver with read_contact() adds the arm's push on the bin or table to each sim_twin (the
  twin glows), and sim_status's contact_peak_n is the take's largest arm contact force (from read_state, every
  recorded step). 9 of 10 webcam demos pressed into the bin at 75-927 N without the person noticing.

Pure: numpy + pydantic + demo_pipeline only (no torch, no Isaac), so it tests anywhere.
"""

from __future__ import annotations

import json
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, Protocol

import numpy as np
from pydantic import ValidationError

from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode, save_signals
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import INPUT_MODES, Assist, Demo, Pose, Scene, SimSignals, Trajectory
from demo_pipeline.soft_floor import clamp_to_floor
from demo_pipeline.store import DemoStore
from demo_pipeline.success import check_success
from demo_pipeline.teleop import Calibration, GripperLatch, HandPoseMsg, to_ee_target

from .robots import ROBOTS
from .teleop_trace import LatencyTrace, coalesce_hands, now_ms, split_trace

TELEOP_DT = 0.02  # s per control step; equals sim_worker.tracking.CONTROL_DT (that module imports torch)
FPS = 50
LOST_PAUSE_S = 0.3  # spec 8.1: tracking lost for longer than this pauses the recording
MIN_STEPS = 2  # a Trajectory needs at least 2 steps
PNG_WRITERS = 8  # threads writing an episode's camera frames (16 measured no faster)
TWIN_HZ = 30  # at most this many sim_twin messages a second (at 50 Hz control steps: every second step, 25 Hz)
TWIN_DECIMALS = 4  # 0.1 mm / 0.1 mrad: below what the twin can show, and it keeps the message small
SMOOTH_TAU_S = 0.08  # keyboard/mouse target filter: max jerk 4-7 m/s^3 at 0.6-1.0x real time, ~2.5 cm behind at 0.12 m/s
SMOOTHED_INPUTS = ("keyboard", "mouse")
# The Kit window's camera for live teleop (teleop_sink.py --kit-camera behind): behind the robot and a little to its
# right, over its shoulder, like the Record page's twin (web/src/twin/RobotTwin.tsx View). From there the robot's right
# is on the screen's right and forward is away. Isaac Lab's default viewer (4, -4, 3) looks at the robot from the front,
# where moving to the robot's right shows on the screen's left: it looked mirrored.
KIT_CAMERA_TARGET = (0.42, 0.0, 0.08)
KIT_CAMERA_EYE = (KIT_CAMERA_TARGET[0] - 0.8, KIT_CAMERA_TARGET[1] - 0.5, KIT_CAMERA_TARGET[2] + 1.25)

State = Literal["idle", "recording", "saving"]
ACTIONS = ("record_start", "record_stop", "record_discard", "reset_scene", "set_input", "set_assist")
CONTACT_DECIMALS = 1  # N, in the twin's contact reading


@dataclass(frozen=True)
class StepState:
    """What the driver measured right after one control step."""

    joint_pos: np.ndarray  # [J] all robot joints
    action: np.ndarray  # [J] the joint targets sent this step
    ee_pos: np.ndarray  # [3] tool position reached, env frame
    ee_quat: np.ndarray  # [4] tool orientation reached, (w, x, y, z)
    cube_pos: np.ndarray  # [3]
    contact_gripper_cube: bool
    contact_arm_bin: bool
    contact_arm_table: bool
    max_contact_force: float  # N, arm vs bin/table
    frames: dict[str, np.ndarray] = field(default_factory=dict)  # camera -> HxWx3 uint8


@dataclass(frozen=True)
class ContactReading:
    """The arm pushing on the bin or the table over the last control step (the success check's contact pairs)."""

    force: float  # N, the largest arm/gripper normal force against the bin or the table; 0 when nothing touches
    body: str | None  # the robot body pushing hardest (its link name, as the twin's URDF names it); None if none
    against: Literal["bin", "table"] | None


def peak_contact(forces: dict[str, list[np.ndarray]], bodies: list[str]) -> ContactReading:
    """The hardest push from contact sensors' force matrices: group ("bin", "table") -> each sensor's normal forces,
    shaped [..., len(bodies), 3] with the last-but-one axis the sensor's filter bodies, in `bodies` order (env, history
    and sensor-body axes in front are maxed over). Pure numpy, for drivers (sim_worker.teleop_isaac) and tests."""
    best = ContactReading(force=0.0, body=None, against=None)
    for group, arrays in forces.items():
        for a in arrays:
            per_body = np.linalg.norm(np.asarray(a, dtype=float), axis=-1).reshape(-1, len(bodies)).max(axis=0)
            i = int(per_body.argmax())
            if per_body[i] > best.force:
                best = ContactReading(force=float(per_body[i]), body=bodies[i], against=group)  # type: ignore[arg-type]
    return best


@dataclass(frozen=True)
class TwinState:
    """The little the robot twin needs, read cheaply (no contacts, no cameras)."""

    joint_pos: np.ndarray  # [J] all robot joints, in the driver's joint_names order
    cube_pose: np.ndarray  # [7] position (env frame) + orientation (w, x, y, z)


class TeleopDriver(Protocol):
    def reset(self, scene: Scene) -> None:
        """Place the scene and put the robot at its start pose."""

    def apply(self, target: Pose, gripper: int) -> None:
        """Run one control step (TELEOP_DT of sim time) toward the tool target, gripper 0 open / 1 closed."""

    def read_state(self) -> StepState:
        """The robot and scene right now."""

    # Optional: set_recording(on: bool) -> None. The session calls it when a recording starts (True) and when
    # it ends, saved or not (False), so a driver can pause work only a recording needs (camera rendering).
    # Optional, for the robot twin: joint_names (the robot's joints, in joint_pos order) and
    # read_twin() -> TwinState; read_contact() -> ContactReading adds the contact glow to each twin message.


@dataclass(frozen=True)
class Recording:
    demo: Demo
    states: list[StepState]  # one per trajectory step


SaveFn = Callable[[Recording], str]  # returns one human-readable line for the Record page


def _rounded(values) -> list[float]:
    return [round(float(v), TWIN_DECIMALS) + 0.0 for v in values]  # + 0.0 turns -0.0 into 0.0


class TeleopSession:
    def __init__(
        self,
        driver: TeleopDriver,
        scene: Scene,
        save_fn: SaveFn,
        *,
        calib: Calibration = Calibration(),
        clock: Callable[[], float] = time.monotonic,
        new_id: Callable[[], str] = lambda: DemoStore.new_id("human"),
    ) -> None:
        self.driver, self.scene, self.save_fn = driver, scene, save_fn
        self.calib, self.clock, self.new_id = calib, clock, new_id
        self.state: State = "idle"
        self.last_result: str | None = None
        self.last_demo_id: str | None = None
        self.twin_watchers = 0  # pages watching the twin, as the relay last said (relay_loop sends twins only then)
        self.input: str | None = None  # how the page drives the arm (set_input); saved with each demo
        self.soft_floor = True  # demo_pipeline.soft_floor, on by default (set_assist); saved as Demo.assist
        self.floored = False  # the soft floor held the target up on the last step
        self.contact_peak: float | None = None  # N, the largest arm contact force in the current (or last) take
        self._steps = 0
        self._reset()

    # --- inputs -------------------------------------------------------------------------

    def on_hand(self, msg: HandPoseMsg) -> None:
        self._latest = msg
        if msg.tracking_ok:
            self._last_good_at = self.clock()

    def on_control(self, action: str, input: str | None = None, soft_floor: bool | None = None) -> None:
        if action not in ACTIONS:
            raise ValueError(f"unknown control action {action!r}; expected one of {ACTIONS}")
        if action == "set_assist":
            if not isinstance(soft_floor, bool):
                raise ValueError(f"set_assist needs soft_floor true or false; got {soft_floor!r}")
            self.soft_floor = soft_floor
            self.last_result = f"soft floor {'on' if soft_floor else 'off'}"
        elif action == "set_input":
            if input not in INPUT_MODES:
                raise ValueError(f"set_input needs an input, one of {INPUT_MODES}; got {input!r}")
            if input != self.input:
                self._smooth = (np.asarray(self._cmd.pos, dtype=float), np.zeros(3))  # from where the arm is told to be
            self.input = input
            self.last_result = f"input: {input}"
        elif action == "record_start":
            if self.state == "recording":
                self.last_result = "already recording"
                return
            self._tell_driver_recording(True)
            self.state = "recording"
            self._started_at = self.clock()
            self._rec: dict[str, list] = {"pos": [], "quat": [], "gripper": [], "states": []}
            self._steps = 0
            self._assist = {"on": False, "steps": 0, "dips": 0, "held": False}  # the soft floor in this take's recorded steps
            self.contact_peak = 0.0
            self.last_result = "recording"
        elif action == "record_stop":
            if self.state != "recording":
                self.last_result = "not recording; nothing to stop"
                return
            self._save()
        elif action == "record_discard":
            if self.state != "recording":
                self.last_result = "not recording; nothing to discard"
                return
            self._discard()
        else:  # reset_scene
            if self.state == "recording":
                self.last_result = "stop recording first, then reset the scene"
                return
            self._reset()
            self.last_result = "scene reset"

    # --- the control loop ---------------------------------------------------------------

    @property
    def paused(self) -> bool:
        if self.state != "recording":
            return False
        return self._last_good_at is None or self.clock() - self._last_good_at > LOST_PAUSE_S

    def step(self) -> None:
        """One control tick: map the latest hand to a command, drive the robot, record if recording."""
        msg = self._latest
        if msg is not None:
            gripper = self._latch.update(msg)  # holds while tracking is lost
            if msg.tracking_ok:
                self._target = to_ee_target(msg, self.calib)
            self._gripper = gripper
        # The soft floor holds the hand target up (and the smoothed command, which can dip a little past it), for every
        # input, recording or not, so lining up feels the same as recording.
        floored = False
        if self.soft_floor:
            self._target, floored = self._floor(self._target)
        self._cmd = self._smoothed(self._target) if self.input in SMOOTHED_INPUTS else self._target
        if self.soft_floor:
            self._cmd, held = self._floor(self._cmd)
            floored = floored or held
        self.floored = floored
        self.driver.apply(self._cmd, self._gripper)
        if self.state == "recording" and not self.paused:
            state = self.driver.read_state()  # only recorded steps: it syncs the GPU and copies the cameras
            self._rec["pos"].append(self._cmd.pos)
            self._rec["quat"].append(self._cmd.quat_wxyz)
            self._rec["gripper"].append(self._gripper)
            self._rec["states"].append(state)
            self._steps += 1
            self._assist["on"] = self._assist["on"] or self.soft_floor
            self._assist["steps"] += int(floored)
            self._assist["dips"] += int(floored and not self._assist["held"])  # a new hold starts
            self._assist["held"] = floored
            self.contact_peak = max(self.contact_peak or 0.0, float(state.max_contact_force))

    def _floor(self, pose: Pose) -> tuple[Pose, bool]:
        pos, held = clamp_to_floor(pose.pos, self.scene.bin_pose)
        return (Pose(pos=pos, quat_wxyz=pose.quat_wxyz), True) if held else (pose, False)

    def status(self) -> dict:
        """The relay's SimStatusMsg (src/app/routers/teleop.py). contact_peak_n: the largest arm contact force of the
        current (or last) take, whole newtons, so the status only changes when it grows by one."""
        return {
            "type": "sim_status",
            "recording": self.state == "recording",
            "steps": self._steps,
            "demo_id": self.last_demo_id,
            "last_result": self.last_result,
            "paused": self.paused,
            "soft_floor": self.soft_floor,
            "contact_peak_n": None if self.contact_peak is None else round(self.contact_peak),
        }

    @property
    def has_twin(self) -> bool:
        return callable(getattr(self.driver, "read_twin", None)) and getattr(self.driver, "joint_names", None) is not None

    def twin_scene(self) -> dict | None:
        """The relay's SimTwinSceneMsg: what stays put while the twin moves (None if the driver can't read twins).
        Poses are [x, y, z, qw, qx, qy, qz] in the env frame; base is the robot's root (sim_worker.robots)."""
        if not self.has_twin:
            return None
        spec = ROBOTS.get(self.scene.robot)
        base = spec.base_pos if spec is not None else (0.0, 0.0, 0.0)
        return {
            "type": "sim_twin_scene",
            "robot": self.scene.robot,
            "joint_names": [str(n) for n in self.driver.joint_names],
            "base": _rounded([*base, 1.0, 0.0, 0.0, 0.0]),
            "bin": _rounded([*self.scene.bin_pose.pos, *self.scene.bin_pose.quat_wxyz]),
        }

    def twin(self) -> dict | None:
        """The relay's SimTwinMsg: the robot's joints now (joint_names order), the gripper sent (0 open, 1 closed),
        and the cube's pose; whether the soft floor is holding the target up ("floor"); and, from a driver that reads
        contacts, the arm's push on the bin or table ("contact": force_n, body, against) for the twin's glow. None if
        the driver can't read twins."""
        if not self.has_twin:
            return None
        state = self.driver.read_twin()
        msg = {
            "type": "sim_twin",
            "q": _rounded(state.joint_pos),
            "gripper": int(self._gripper),
            "cube": _rounded(state.cube_pose),
            "floor": self.floored,
        }
        read_contact = getattr(self.driver, "read_contact", None)
        if callable(read_contact):
            c: ContactReading = read_contact()
            msg["contact"] = {"force_n": round(float(c.force), CONTACT_DECIMALS) + 0.0, "body": c.body, "against": c.against}
        return msg

    # --- internals ----------------------------------------------------------------------

    def _smoothed(self, target: Pose) -> Pose:
        """One TELEOP_DT step of a critically damped filter toward the target's position (orientation as is)."""
        pos, vel = self._smooth
        w = 1.0 / SMOOTH_TAU_S
        vel = vel + TELEOP_DT * (w * w * (np.asarray(target.pos) - pos) - 2.0 * w * vel)
        pos = pos + TELEOP_DT * vel
        self._smooth = (pos, vel)
        return Pose(pos=tuple(float(v) for v in pos), quat_wxyz=target.quat_wxyz)

    def _reset(self) -> None:
        self.driver.reset(self.scene)
        start = self.driver.read_state()
        self._target = Pose(pos=tuple(float(v) for v in start.ee_pos), quat_wxyz=tuple(float(v) for v in start.ee_quat))
        self._cmd = self._target  # what the robot is told (the target, smoothed for keyboard and mouse)
        self._smooth = (np.asarray(self._target.pos, dtype=float), np.zeros(3))
        self._gripper = 0
        self._latch = GripperLatch()
        self._latest: HandPoseMsg | None = None
        self._last_good_at: float | None = None

    def _save(self) -> None:
        self.state = "saving"
        rec, n = self._rec, self._steps
        human_seconds = self.clock() - self._started_at
        self.last_demo_id = None
        try:
            if n < MIN_STEPS:
                self.last_result = f"only {n} step(s) recorded; not saved"
                return
            t, states = np.arange(n) * TELEOP_DT, rec["states"]
            # The demo is the path the arm reached, which is what the person watched and steered. The arm lags the
            # hand target (2.5-5 cm in live test #10), so replaying the targets was another motion: 0/10 in the bin
            # on replay, 10/10 live. The targets are kept for diagnostics.
            achieved = Trajectory.from_arrays(
                t, np.asarray([s.ee_pos for s in states]), np.asarray([s.ee_quat for s in states]), rec["gripper"]
            )
            commanded = Trajectory.from_arrays(t, np.asarray(rec["pos"]), np.asarray(rec["quat"]), rec["gripper"])
            demo = Demo(id=self.new_id(), source="human", trajectory=achieved, commanded=commanded, scene=self.scene,
                        human_seconds=human_seconds, input=self.input,
                        assist=Assist(soft_floor=self._assist["on"], soft_floor_steps=self._assist["steps"],
                                      soft_floor_dips=self._assist["dips"]))
            self.last_result = self.save_fn(Recording(demo=demo, states=list(rec["states"])))
            self.last_demo_id = demo.id
        except Exception as e:  # a failed save must not wedge the session
            self.last_result = f"save failed: {type(e).__name__}: {e}"
        finally:
            self.state = "idle"
            self._tell_driver_recording(False)

    def _discard(self) -> None:
        n = self._steps
        self._rec = {"pos": [], "quat": [], "gripper": [], "states": []}
        self.last_demo_id = None
        self.last_result = f"discarded: {n} step(s) not saved"
        self.state = "idle"
        self._tell_driver_recording(False)

    def _tell_driver_recording(self, on: bool) -> None:
        hook = getattr(self.driver, "set_recording", None)
        if hook is not None:
            hook(on)


# --- the sink's relay side --------------------------------------------------------------------

def _parse(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None


def _is_hand(data) -> bool:
    return isinstance(data, dict) and "type" not in data


def _dispatch_data(session: TeleopSession, data, text: str) -> str | None:
    if data is None:
        return f"invalid message (not JSON): {text[:80]!r}"
    kind = data.get("type") if isinstance(data, dict) else None
    if kind == "error":
        return f"relay error: {data.get('detail')}"
    if kind == "status":
        return None
    if kind == "twin_watchers":
        count = data.get("count")
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            return f"invalid message: twin_watchers count {count!r}"
        session.twin_watchers = count
        return None
    try:
        if kind == "control":
            session.on_control(str(data.get("action")), data.get("input"), data.get("soft_floor"))
        else:
            session.on_hand(HandPoseMsg.model_validate(split_trace(data)[0] if isinstance(data, dict) else data))
    except (ValueError, ValidationError) as e:
        return f"invalid message: {e}"
    return None


def dispatch(session: TeleopSession, text: str) -> str | None:
    """Apply one relay message to the session: a control, or a HandPoseMsg (its latency "trace", if any, is
    ignored here). The relay's own "status" chatter is ignored; its "twin_watchers" count is kept on the session
    (TwinSender reads it). Returns a line to log for an "error" from the
    relay or for a message that is invalid (dropped), else None."""
    return _dispatch_data(session, _parse(text), text)


def apply_inbox(
    session: TeleopSession, items: list[tuple[str, float]], *, trace: LatencyTrace | None = None
) -> tuple[list[str], dict | None]:
    """Apply what arrived since the last tick, (text, received at epoch ms) in arrival order. Controls apply in
    order; of each run of hand messages only the newest is validated and applied (the session only ever steps
    with its latest hand, so the older ones are stale). Returns (lines to log, the applied hand's trace stamps
    plus "recv", or None if no new hand applied)."""
    parsed = [(_parse(text), text, recv) for text, recv in items]
    kept, stale = coalesce_hands(parsed, lambda p: _is_hand(p[0]))
    if trace is not None:
        trace.stale(stale)
    problems, stamps = [], None
    for data, text, recv in kept:
        problem = _dispatch_data(session, data, text)
        if problem:
            problems.append(problem)
        elif _is_hand(data):
            stamps = {**(split_trace(data)[1] or {}), "recv": recv}
    return problems, stamps


class TwinSender:
    """What relay_loop sends for the robot twin on each tick: the sim_twin_scene once per connection (and again if
    it changes), then a sim_twin at most `hz` times a second (wall clock), skipped when nothing moved since the last
    one. The relay keeps the last of each for pages that open later. Nothing is read or sent while no page watches
    (session.twin_watchers, from the relay), so the sink pays for the twin only while someone looks at it."""

    def __init__(self, session: TeleopSession, *, hz: float = TWIN_HZ, clock: Callable[[], float] = time.monotonic):
        self.session, self.period, self.clock = session, 1.0 / hz, clock
        self._conn = None
        self._scene: dict | None = None
        self._last: dict | None = None
        self._next_at = float("-inf")

    def due(self, conn) -> list[str]:
        """The messages to send on `conn` now (JSON texts, in order)."""
        session = self.session
        if session.twin_watchers <= 0 or not session.has_twin:
            return []
        out = []
        scene = session.twin_scene()
        if conn is not self._conn or scene != self._scene:
            self._conn, self._scene, self._last = conn, scene, None
            out.append(json.dumps(scene))
        now = self.clock()
        if now < self._next_at:
            return out
        self._next_at = now + self.period
        twin = session.twin()
        if twin != self._last:
            self._last = twin
            out.append(json.dumps(twin))
        return out

    def lost(self) -> None:
        """A send failed: start over (scene first) on the next connection."""
        self._conn = None


def relay_loop(
    session: TeleopSession,
    url: str,
    *,
    period: float = TELEOP_DT,
    status_every: int = 5,
    retry_s: float = 2.0,
    should_stop: Callable[[], bool] = lambda: False,
    log: Callable[[str], None] = print,
    trace: LatencyTrace | None = None,
) -> None:
    """Run the session against the relay (src/app/routers/teleop.py, role=sim) until should_stop().

    The session and the robot stay on the calling thread (Isaac's main thread). A reader thread
    keeps a WebSocket open, reconnecting every retry_s while the relay is down, and queues what
    arrives with its arrival time. Each tick applies the queue (apply_inbox: controls in order, the
    newest hand only), then calls session.step(), at most once per `period` of wall clock. A slower
    sim just runs slower; it never tries to catch up. The status goes back to the relay whenever it
    changes apart from the step count, and every status_every ticks. The robot twin's messages follow it
    (TwinSender: at most TWIN_HZ, only while a page watches). While the relay is down, the
    robot keeps holding its pose. With a trace (sim_worker.teleop_trace), each tick is timed and a
    summary is logged every trace.report_every_s."""
    from websockets.sync.client import connect  # lazy: only the live sink needs it

    inbox: queue.SimpleQueue[tuple[str, float]] = queue.SimpleQueue()
    conn_box: list = [None]

    def reader() -> None:
        while not should_stop():
            try:
                with connect(url, open_timeout=retry_s) as conn:
                    conn_box[0] = conn
                    log(f"[teleop] connected to {url}")
                    for text in conn:
                        inbox.put((text if isinstance(text, str) else text.decode(), now_ms()))
            except Exception as e:  # refused, dropped, closed: retry while running
                if conn_box[0] is not None:
                    log(f"[teleop] relay connection lost: {type(e).__name__}: {e}")
            conn_box[0] = None
            if not should_stop():
                time.sleep(retry_s)

    threading.Thread(target=reader, name="teleop-relay-reader", daemon=True).start()
    next_tick, tick, last_sent = time.monotonic(), 0, None
    twin = TwinSender(session)
    try:
        while not should_stop():
            items = []
            while True:
                try:
                    items.append(inbox.get_nowait())
                except queue.Empty:
                    break
            problems, stamps = apply_inbox(session, items, trace=trace)
            for problem in problems:
                log(f"[teleop] {problem}")
            t_start = now_ms()
            if trace is not None and stamps is not None:
                trace.hand_applied(stamps, applied=t_start)
            session.step()
            t_end = now_ms()
            status = session.status()
            changed = last_sent is None or {**status, "steps": 0} != {**last_sent, "steps": 0}
            conn = conn_box[0]
            if conn is not None and (changed or tick % status_every == 0):
                try:
                    conn.send(json.dumps(status))
                    last_sent = status
                except Exception:
                    pass  # the reader thread notices the drop and reconnects
            if conn is not None:
                for text in twin.due(conn):
                    try:
                        conn.send(text)
                    except Exception:
                        twin.lost()
                        break
            tick += 1
            next_tick += period
            delay = next_tick - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_tick = time.monotonic()  # behind real time: don't try to catch up
            if trace is not None:
                trace.step_done(start=t_start, end=t_end, sections=trace.sections.take(),
                                sleep_ms=max(delay, 0.0) * 1000.0)
                trace.maybe_report()
    finally:
        conn = conn_box[0]
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# --- a scripted fake hand (the automated smoke's input) -------------------------------------

PINCH_CLOSED, PINCH_OPEN = 0.2, 0.8  # well past GripperLatch's 0.35 / 0.45 hysteresis band


def scripted_hand(
    traj: Trajectory, calib: Calibration = Calibration(), frame: tuple[int, int] = (640, 480)
) -> list[HandPoseMsg]:
    """The HandPoseMsg stream a perfect hand would send for `traj`, one per step: the exact inverse
    of to_ee_target, so to_ee_target(msg) reproduces each pose, and the pinch reproduces the gripper
    through GripperLatch. Raises ValueError for a pose the calibration's workspace cannot express
    (to_ee_target would clamp it)."""
    if calib.invert_y or calib.invert_z:
        raise ValueError("scripted_hand supports the default (non-inverted) calibration only")
    (x0, x1), (y0, y1), (z0, z1) = calib.x_range, calib.y_range, calib.z_range
    msgs = []
    for k, (t, (x, y, z), q, g) in enumerate(zip(traj.t, traj.ee_pos, traj.ee_quat, traj.gripper)):
        s_x, s_y, s_z = (x - x0) / (x1 - x0), (y1 - y) / (y1 - y0), (z - z0) / (z1 - z0)
        if not all(-1e-9 <= s <= 1 + 1e-9 for s in (s_x, s_y, s_z)):
            raise ValueError(f"step {k}: pose {(x, y, z)} is outside the calibration workspace")
        w, qx, qy, qz = q
        if abs(w) > 1e-6 or abs(qz) > 1e-6:
            raise ValueError(f"step {k}: {q} is not a gripper-down pose with a yaw")
        yaw = 2.0 * np.arctan2(qy, qx)
        if abs(yaw) > calib.yaw_limit + 1e-9:
            raise ValueError(f"step {k}: yaw {yaw:.3f} rad is outside the calibration's yaw limit")
        u_mirrored = calib.u_min + s_y * (calib.u_max - calib.u_min)
        msgs.append(HandPoseMsg(
            t_ms=t * 1000.0,
            tracking_ok=True,
            wrist_uv=(1.0 - u_mirrored, calib.v_max - s_z * (calib.v_max - calib.v_min)),
            palm_width=calib.palm_far + s_x * (calib.palm_near - calib.palm_far),
            pinch_ratio=PINCH_CLOSED if g else PINCH_OPEN,
            yaw_rad=float(yaw + calib.yaw0),
            frame_w=frame[0],
            frame_h=frame[1],
        ))
    return msgs


# --- saving into the DemoStore --------------------------------------------------------------

def episode_signals(states: list[StepState]) -> SimSignals:
    return SimSignals(
        cube_pos=np.asarray([s.cube_pos for s in states], dtype=np.float64),
        contact_gripper_cube=np.asarray([s.contact_gripper_cube for s in states], dtype=bool),
        contact_arm_bin=np.asarray([s.contact_arm_bin for s in states], dtype=bool),
        contact_arm_table=np.asarray([s.contact_arm_table for s in states], dtype=bool),
        max_contact_force=np.asarray([s.max_contact_force for s in states], dtype=np.float64),
    )


def make_store_saver(
    store: DemoStore, *, bin_inner: tuple[float, float, float] = (0.20, 0.20, 0.08), task_text: str = TASK_TEXT
) -> SaveFn:
    """A save_fn that stores the Demo, writes its episode (steps, signals, camera PNGs) where the
    /demos routes look for it (store.episode_dir), and reports the success check on the live signals.

    The check uses the reached-vs-commanded residual as the reach signal, as replay does with
    velocity feedforward. Pass the scene's real bin_inner (sim_worker.scene_cfg.BIN_INNER)."""

    def save(rec: Recording) -> str:
        demo, states = rec.demo, rec.states
        n = len(states)
        signals = episode_signals(states)
        reached = np.asarray([s.ee_pos for s in states], dtype=np.float64)
        target = demo.commanded if demo.commanded is not None else demo.trajectory
        residual = np.linalg.norm(reached - np.asarray(target.ee_pos), axis=1)
        result = check_success(demo.trajectory, signals, demo.scene.bin_pose, bin_inner=bin_inner, tcp_error=residual)

        store.save_demo(demo)
        ep_dir = store.episode_dir(demo.id)
        cameras = sorted(states[0].frames) if all(s.frames for s in states) else []
        meta = EpisodeMeta(demo_id=demo.id, robot=demo.scene.robot, task_text=task_text, fps=FPS, n_steps=n,
                           cameras=cameras)
        save_episode(ep_dir, meta, {
            "joint_pos": np.asarray([s.joint_pos for s in states], dtype=np.float32),
            "action": np.asarray([s.action for s in states], dtype=np.float32),
            "ee_pos": reached.astype(np.float32),
            "ee_quat": np.asarray([s.ee_quat for s in states], dtype=np.float32),
            "gripper": np.asarray(demo.trajectory.gripper, dtype=np.int8),
        })
        save_signals(ep_dir, signals)
        if cameras:
            _write_frames(Path(ep_dir), states, cameras)

        if result.success:
            return f"saved {demo.id}: verified success"
        return f"saved {demo.id}: not verified ({', '.join(result.reasons)})"

    return save


def _write_frames(ep_dir: Path, states: list[StepState], cameras: list[str]) -> None:
    """PNG encoding was the whole save (0.93 s for 752 frames, with the sim loop blocked); zlib releases the GIL,
    so a thread pool writes the same bytes in 0.14 s."""
    from PIL import Image  # only needed with cameras; Isaac's venv has it

    def write(job: tuple[str, int]) -> None:
        cam, k = job
        Image.fromarray(states[k].frames[cam]).save(image_path(ep_dir, cam, k))

    with ThreadPoolExecutor(PNG_WRITERS) as pool:
        list(pool.map(write, [(cam, k) for cam in cameras for k in range(len(states))]))  # re-raises a failed write
