"""sim_worker.teleop_session: the sim-side teleop state machine (pure; a fake driver stands in for Isaac)."""

from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.schemas import Demo, Pose, Scene
from demo_pipeline.store import DemoStore
from demo_pipeline.episode_io import load_episode, load_signals
from demo_pipeline.teleop import Calibration, HandPoseMsg, to_ee_target
from sim_worker.teleop_session import (
    LOST_PAUSE_S,
    TELEOP_DT,
    Recording,
    StepState,
    TeleopSession,
    make_store_saver,
)

DOWN = (0.0, 1.0, 0.0, 0.0)
SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=7)
START_TCP = (0.4, 0.0, 0.3)


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class FakeDriver:
    """Moves the TCP straight to each target; the cube follows the TCP while the gripper is closed."""

    def __init__(self) -> None:
        self.resets: list[Scene] = []
        self.applied: list[tuple[Pose, int]] = []
        self.tcp = np.array(START_TCP)
        self.cube = np.array(SCENE.cube_pose.pos)
        self.gripper = 0
        self.reads = 0

    def reset(self, scene: Scene) -> None:
        self.resets.append(scene)
        self.tcp = np.array(START_TCP)
        self.cube = np.array(scene.cube_pose.pos)
        self.gripper = 0

    def apply(self, target: Pose, gripper: int) -> None:
        self.applied.append((target, gripper))
        self.tcp = np.array(target.pos)
        self.gripper = gripper
        if gripper and np.linalg.norm(self.tcp - self.cube) < 0.03:
            self.cube = self.tcp.copy()

    def read_state(self) -> StepState:
        self.reads += 1
        return StepState(
            joint_pos=np.zeros(9), action=np.zeros(9), ee_pos=self.tcp.copy(), ee_quat=np.array(DOWN),
            cube_pos=self.cube.copy(), contact_gripper_cube=bool(self.gripper), contact_arm_bin=False,
            contact_arm_table=False, max_contact_force=0.0,
        )


def hand(u=0.5, v=0.5, palm=0.1, pinch=0.8, ok=True, t_ms=0.0) -> HandPoseMsg:
    return HandPoseMsg(t_ms=t_ms, tracking_ok=ok, wrist_uv=(u, v), palm_width=palm, pinch_ratio=pinch,
                       yaw_rad=0.0, frame_w=640, frame_h=480)


@pytest.fixture
def rig():
    clock, driver, saved = FakeClock(), FakeDriver(), []

    def save(rec: Recording) -> str:
        saved.append(rec)
        return f"saved {rec.demo.id}"

    ids = iter(f"human_test_{i}" for i in range(100))
    session = TeleopSession(driver, SCENE, save, clock=clock, new_id=lambda: next(ids))
    return session, driver, clock, saved


def run(session, clock, steps: int, msg: HandPoseMsg | None = None) -> None:
    """`steps` control ticks at 50 Hz wall time, the browser sending `msg` before each."""
    for _ in range(steps):
        if msg is not None:
            session.on_hand(msg)
        session.step()
        clock.advance(TELEOP_DT)


# --- states -----------------------------------------------------------------------------

def test_starts_idle_and_places_the_scene(rig):
    session, driver, _, _ = rig
    assert session.state == "idle"
    assert driver.resets == [SCENE]
    assert session.status() == {"type": "sim_status", "recording": False, "steps": 0, "demo_id": None,
                                "last_result": None, "paused": False, "soft_floor": True, "contact_peak_n": None}


def test_idle_follows_the_hand_without_recording(rig):
    session, driver, clock, _ = rig
    run(session, clock, 5, hand(u=0.3))
    assert len(driver.applied) == 5
    assert driver.applied[-1][0] == to_ee_target(hand(u=0.3))
    assert session.status()["steps"] == 0


def test_holds_the_start_pose_before_any_hand(rig):
    session, driver, clock, _ = rig
    run(session, clock, 3)
    assert [tuple(p.pos) for p, _ in driver.applied] == [START_TCP] * 3
    assert [g for _, g in driver.applied] == [0, 0, 0]


def test_start_stop_records_and_saves_a_human_demo(rig):
    session, driver, clock, saved = rig
    session.on_control("record_start")
    assert session.state == "recording"
    run(session, clock, 10, hand())
    assert session.status()["steps"] == 10 and session.status()["recording"] is True
    session.on_control("record_stop")

    assert session.state == "idle"
    assert len(saved) == 1
    demo = saved[0].demo
    assert isinstance(demo, Demo) and Demo.model_validate(demo.model_dump()) == demo
    assert demo.source == "human" and demo.parent_id is None and demo.scene == SCENE
    assert len(demo.trajectory.t) == 10 and len(saved[0].states) == 10
    assert session.status() == {"type": "sim_status", "recording": False, "steps": 10,
                                "demo_id": "human_test_0", "last_result": "saved human_test_0", "paused": False,
                                "soft_floor": True, "contact_peak_n": 0}


def test_saving_is_the_state_while_save_fn_runs():
    seen = []
    clock = FakeClock()

    def save(rec):
        seen.append(session.state)
        return "ok"

    session = TeleopSession(FakeDriver(), SCENE, save, clock=clock, new_id=lambda: "human_x")
    session.on_control("record_start")
    run(session, clock, 3, hand())
    session.on_control("record_stop")
    assert seen == ["saving"] and session.state == "idle"


def test_human_seconds_is_wall_clock_from_start_to_stop(rig):
    session, _, clock, saved = rig
    session.on_control("record_start")
    run(session, clock, 50, hand())  # 1.0 s of ticks
    clock.advance(2.5)  # the person pauses before pressing stop
    session.on_control("record_stop")
    assert saved[0].demo.human_seconds == pytest.approx(3.5)


def test_trajectory_is_50_hz_sim_time_whatever_the_wall_clock(rig):
    session, _, clock, saved = rig
    session.on_control("record_start")
    for i in range(6):
        session.on_hand(hand())
        session.step()
        clock.advance(0.05 if i % 2 else 0.01)  # jittery wall-clock ticks
    session.on_control("record_stop")
    assert saved[0].demo.trajectory.t == pytest.approx([k * 0.02 for k in range(6)])
    assert TELEOP_DT == 0.02


class LaggingDriver(FakeDriver):
    """Covers half the remaining distance to the target each step, as the live arm trails a jittery hand."""

    def apply(self, target: Pose, gripper: int) -> None:
        self.applied.append((target, gripper))
        self.tcp = self.tcp + 0.5 * (np.array(target.pos) - self.tcp)
        self.gripper = gripper


def test_trajectory_records_the_achieved_path_and_keeps_the_commanded_targets():
    # Live test #10: the arm lagged the hand by 2.5-5 cm, so a demo of the targets replayed as a different motion
    # (0/10 in the bin on replay, 10/10 live). The demo is what the arm did; the targets stay for diagnostics.
    clock, driver, saved = FakeClock(), LaggingDriver(), []
    session = TeleopSession(driver, SCENE, lambda rec: saved.append(rec) or "saved", clock=clock,
                            new_id=lambda: "human_lag")
    session.on_control("record_start")
    run(session, clock, 4, hand(u=0.3, v=0.4, palm=0.08))
    session.on_control("record_stop")
    rec = saved[0]
    want = to_ee_target(hand(u=0.3, v=0.4, palm=0.08))
    reached = [s.ee_pos.tolist() for s in rec.states]
    assert np.allclose(rec.demo.trajectory.ee_pos, reached)
    assert np.allclose(rec.demo.trajectory.ee_quat, [s.ee_quat.tolist() for s in rec.states])
    assert rec.demo.commanded is not None
    assert np.allclose(rec.demo.commanded.ee_pos, [want.pos] * 4)
    assert rec.demo.commanded.ee_quat[0] == pytest.approx(want.quat_wxyz)
    assert rec.demo.commanded.t == rec.demo.trajectory.t and rec.demo.commanded.gripper == rec.demo.trajectory.gripper
    assert np.linalg.norm(np.subtract(reached[0], want.pos)) > 0.01  # the arm really lagged


def test_uses_the_given_calibration():
    clock, driver = FakeClock(), FakeDriver()
    calib = Calibration(x_range=(0.35, 0.45))
    session = TeleopSession(driver, SCENE, lambda r: "ok", calib=calib, clock=clock, new_id=lambda: "h")
    run(session, clock, 1, hand())
    assert driver.applied[-1][0] == to_ee_target(hand(), calib)


def test_gripper_hysteresis_passes_through(rig):
    session, driver, clock, saved = rig
    session.on_control("record_start")
    for pinch in (0.8, 0.30, 0.40, 0.50, 0.40, 0.30):  # latch: close below 0.35, open above 0.45
        run(session, clock, 1, hand(pinch=pinch))
    session.on_control("record_stop")
    assert saved[0].demo.trajectory.gripper == [0, 1, 1, 0, 0, 1]
    assert [g for _, g in driver.applied] == [0, 1, 1, 0, 0, 1]


# --- lost tracking (spec 8.1) -------------------------------------------------------------

def test_brief_tracking_loss_holds_the_target_and_keeps_recording(rig):
    session, driver, clock, saved = rig
    session.on_control("record_start")
    run(session, clock, 5, hand(u=0.3, pinch=0.2))
    run(session, clock, 10, hand(u=0.9, pinch=0.9, ok=False))  # 0.2 s lost: under the 0.3 s limit
    assert session.status()["paused"] is False
    assert session.status()["steps"] == 15
    held = to_ee_target(hand(u=0.3))
    assert driver.applied[-1] == (held, 1)
    session.on_control("record_stop")
    assert saved[0].demo.trajectory.gripper[-1] == 1


def test_tracking_lost_over_the_limit_pauses_and_resumes(rig):
    session, driver, clock, saved = rig
    session.on_control("record_start")
    run(session, clock, 5, hand())
    run(session, clock, 25, hand(ok=False))  # 0.5 s lost
    status = session.status()
    assert status["paused"] is True and status["recording"] is True
    paused_steps = status["steps"]
    assert paused_steps < 5 + 25
    run(session, clock, 5, hand())
    assert session.status()["paused"] is False
    assert session.status()["steps"] == paused_steps + 5
    session.on_control("record_stop")
    traj = saved[0].demo.trajectory
    assert traj.t == pytest.approx([k * TELEOP_DT for k in range(len(traj.t))])  # the pause is cut out


def test_pause_starts_just_after_the_limit(rig):
    session, _, clock, _ = rig
    session.on_control("record_start")
    run(session, clock, 1, hand())  # last good message at t0
    lost_ticks = 0
    while not session.status()["paused"]:
        run(session, clock, 1, hand(ok=False))
        lost_ticks += 1
    # Paused on the first tick more than LOST_PAUSE_S after the last tracked message, not before.
    assert LOST_PAUSE_S - 1e-9 <= lost_ticks * TELEOP_DT <= LOST_PAUSE_S + TELEOP_DT + 1e-9
    assert LOST_PAUSE_S == 0.3


def test_no_messages_at_all_counts_as_lost(rig):
    session, _, clock, _ = rig
    session.on_control("record_start")
    run(session, clock, 1, hand())
    run(session, clock, 20)  # the browser went silent
    assert session.status()["paused"] is True


def test_recording_with_no_hand_yet_is_paused(rig):
    session, _, clock, _ = rig
    session.on_control("record_start")
    run(session, clock, 3)
    assert session.status()["paused"] is True and session.status()["steps"] == 0


# --- edge cases ---------------------------------------------------------------------------

def test_stop_with_too_few_steps_saves_nothing(rig):
    session, _, clock, saved = rig
    session.on_control("record_start")
    run(session, clock, 1, hand())
    session.on_control("record_stop")
    assert saved == []
    assert session.state == "idle"
    assert "not saved" in session.status()["last_result"]
    assert session.status()["demo_id"] is None


def test_a_failing_save_is_reported_and_the_session_recovers(rig):
    clock = FakeClock()

    def broken(rec):
        raise OSError("disk full")

    session = TeleopSession(FakeDriver(), SCENE, broken, clock=clock, new_id=lambda: "human_y")
    session.on_control("record_start")
    run(session, clock, 3, hand())
    session.on_control("record_stop")
    assert session.state == "idle"
    assert "disk full" in session.status()["last_result"]
    assert session.status()["demo_id"] is None
    session.on_control("record_start")
    assert session.state == "recording"


def test_idle_steps_do_not_read_the_robot_state(rig):
    # the state (and its camera frames) is only for the recording; reading it costs GPU syncs every step
    session, driver, clock, _ = rig
    driver.reads = 0
    run(session, clock, 10, hand(u=0.3))
    assert driver.reads == 0 and len(driver.applied) == 10


def test_each_recorded_step_reads_the_state_once(rig):
    session, driver, clock, _ = rig
    session.on_control("record_start")
    driver.reads = 0
    run(session, clock, 7, hand())
    assert driver.reads == 7 and session.status()["steps"] == 7


def test_paused_steps_do_not_read_the_state(rig):
    session, driver, clock, _ = rig
    session.on_control("record_start")  # no hand yet: paused
    driver.reads = 0
    run(session, clock, 5)
    assert session.paused and driver.reads == 0


class CameraDriver(FakeDriver):
    """A driver that can pause its recording cameras while nothing is recorded."""

    def __init__(self) -> None:
        super().__init__()
        self.recording_calls: list[bool] = []

    def set_recording(self, on: bool) -> None:
        self.recording_calls.append(on)


def test_the_driver_is_told_when_recording_starts_and_ends():
    driver = CameraDriver()
    session = TeleopSession(driver, SCENE, lambda r: "saved", clock=FakeClock())
    session.on_control("record_start")
    assert driver.recording_calls == [True]
    for _ in range(3):
        session.on_hand(hand())
        session.step()
    session.on_control("record_stop")
    assert driver.recording_calls == [True, False]


def test_the_driver_is_told_recording_ended_even_when_the_save_fails():
    driver = CameraDriver()

    def fail(rec):
        raise OSError("disk full")

    session = TeleopSession(driver, SCENE, fail, clock=FakeClock())
    session.on_control("record_start")
    for _ in range(3):
        session.on_hand(hand())
        session.step()
    session.on_control("record_stop")
    assert driver.recording_calls == [True, False] and "save failed" in session.last_result


def test_a_refused_start_or_stop_does_not_tell_the_driver():
    driver = CameraDriver()
    session = TeleopSession(driver, SCENE, lambda r: "saved", clock=FakeClock())
    session.on_control("record_stop")  # not recording
    session.on_control("record_start")
    session.on_control("record_start")  # already recording
    assert driver.recording_calls == [True]


def test_start_while_recording_does_not_restart(rig):
    session, _, clock, _ = rig
    session.on_control("record_start")
    run(session, clock, 4, hand())
    session.on_control("record_start")
    assert session.status()["steps"] == 4
    assert "already recording" in session.status()["last_result"]


def test_stop_while_idle_is_a_no_op(rig):
    session, _, _, saved = rig
    session.on_control("record_stop")
    assert saved == [] and session.state == "idle"
    assert "not recording" in session.status()["last_result"]


def test_reset_scene_while_idle_resets_the_driver_and_the_hold_pose(rig):
    session, driver, clock, _ = rig
    run(session, clock, 2, hand(u=0.3))
    session.on_control("reset_scene")
    assert driver.resets == [SCENE, SCENE]
    run(session, clock, 1)  # no new hand message: hold the start pose again, not the old target
    assert tuple(driver.applied[-1][0].pos) == START_TCP
    assert session.status()["last_result"] == "scene reset"


def test_reset_scene_is_refused_while_recording(rig):
    session, driver, clock, _ = rig
    session.on_control("record_start")
    run(session, clock, 2, hand())
    session.on_control("reset_scene")
    assert driver.resets == [SCENE]
    assert session.state == "recording"
    assert "stop" in session.status()["last_result"]


def test_unknown_control_is_rejected(rig):
    session, _, _, _ = rig
    with pytest.raises(ValueError):
        session.on_control("self_destruct")


def test_each_recording_gets_a_new_id_and_starts_empty(rig):
    session, _, clock, saved = rig
    for _ in range(2):
        session.on_control("record_start")
        run(session, clock, 3, hand())
        session.on_control("record_stop")
    assert [r.demo.id for r in saved] == ["human_test_0", "human_test_1"]
    assert [len(r.demo.trajectory.t) for r in saved] == [3, 3]


# --- the store saver (episode_io + save_signals + DemoStore) ------------------------------

def _recording(n: int = 60) -> Recording:
    clock, saved = FakeClock(), []
    session = TeleopSession(FakeDriver(), SCENE, lambda r: saved.append(r) or "ok", clock=clock,
                            new_id=lambda: "human_store_1")
    session.on_control("record_start")
    run(session, clock, n, hand())
    session.on_control("record_stop")
    return saved[0]


def test_store_saver_writes_demo_episode_and_signals(tmp_path):
    store = DemoStore(tmp_path)
    rec = _recording()
    result = make_store_saver(store)(rec)

    assert store.get_demo(rec.demo.id) == rec.demo
    meta, arrays, _ = load_episode(store.episode_dir(rec.demo.id))
    assert meta.n_steps == 60 and meta.robot == "franka" and meta.fps == 50 and meta.cameras == []
    assert arrays["ee_pos"].shape == (60, 3) and arrays["gripper"].shape == (60,)
    signals = load_signals(store.episode_dir(rec.demo.id))
    assert signals is not None and signals.n_steps == 60
    assert result.startswith(f"saved {rec.demo.id}")


class StuckDriver(FakeDriver):
    """An arm that can't follow the hand at all."""

    def apply(self, target: Pose, gripper: int) -> None:
        self.applied.append((target, gripper))
        self.gripper = gripper


def test_store_saver_measures_reach_against_the_commanded_targets(tmp_path):
    # the demo is the achieved path now, so the residual against it is 0; "unreachable" needs the targets
    clock, saved = FakeClock(), []
    session = TeleopSession(StuckDriver(), SCENE, lambda r: saved.append(r) or "ok", clock=clock,
                            new_id=lambda: "human_stuck")
    session.on_control("record_start")
    run(session, clock, 60, hand(u=0.3, v=0.4, palm=0.08))
    session.on_control("record_stop")
    assert "unreachable" in make_store_saver(DemoStore(tmp_path))(saved[0])


def test_store_saver_reports_the_success_check(tmp_path):
    rec = _recording()  # the fake hand never moves the cube to the bin
    result = make_store_saver(DemoStore(tmp_path))(rec)
    assert "not verified" in result and "not_in_bin" in result


def test_store_saver_writes_camera_frames(tmp_path):
    pytest.importorskip("PIL")
    rec = _recording(3)
    frames = [{"front": np.full((8, 8, 3), k, np.uint8)} for k in range(3)]
    rec = Recording(demo=rec.demo, states=[
        StepState(**{**s.__dict__, "frames": f}) for s, f in zip(rec.states, frames)
    ])
    store = DemoStore(tmp_path)
    make_store_saver(store)(rec)
    meta, _, images = load_episode(store.episode_dir(rec.demo.id))
    assert meta.cameras == ["front"]
    assert all(p.is_file() for p in images["front"])


def _with_frames(rec: Recording) -> Recording:
    return Recording(demo=rec.demo, states=[
        StepState(**{**s.__dict__, "frames": {"front": np.full((8, 8, 3), k, np.uint8)}})
        for k, s in enumerate(rec.states)
    ])


def test_store_saver_writes_camera_frames_concurrently(tmp_path, monkeypatch):
    """PNG encoding is the whole save (~1 s for a 7.5 s demo, the sim loop blocked); it runs on a thread pool."""
    pil = pytest.importorskip("PIL.Image")
    import threading

    meet, calls, original = threading.Barrier(2, timeout=5), [], pil.Image.save

    def save(self, *args, **kwargs):
        calls.append(None)
        if len(calls) <= 2:
            meet.wait()  # the first two writes must be in flight at once
        return original(self, *args, **kwargs)

    monkeypatch.setattr(pil.Image, "save", save)
    rec = _with_frames(_recording(4))
    store = DemoStore(tmp_path)
    make_store_saver(store)(rec)
    _, _, images = load_episode(store.episode_dir(rec.demo.id))
    assert len(images["front"]) == 4
    assert [int(np.asarray(pil.open(p))[0, 0, 0]) for p in images["front"]] == [0, 1, 2, 3]


def test_a_failing_frame_write_fails_the_save(tmp_path, monkeypatch):
    pil = pytest.importorskip("PIL.Image")

    def save(self, *args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(pil.Image, "save", save)
    with pytest.raises(OSError, match="disk full"):
        make_store_saver(DemoStore(tmp_path))(_with_frames(_recording(3)))


# --- the scripted fake hand (Task 3 smoke input) --------------------------------------------

from demo_pipeline.teleop import GripperLatch  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402
from sim_worker.teleop_session import scripted_hand  # noqa: E402


def test_scripted_hand_round_trips_through_to_ee_target():
    traj = scripted_expert(SCENE)
    msgs = scripted_hand(traj)
    assert len(msgs) == len(traj.t)
    for msg, pos, quat in zip(msgs, traj.ee_pos, traj.ee_quat):
        pose = to_ee_target(msg)
        assert pose.pos == pytest.approx(pos, abs=1e-9)
        assert pose.quat_wxyz == pytest.approx(quat, abs=1e-9)


def test_scripted_hand_pinch_reproduces_the_gripper_through_the_latch():
    traj = scripted_expert(SCENE)
    latch = GripperLatch()
    assert [latch.update(m) for m in scripted_hand(traj)] == traj.gripper


def test_scripted_hand_messages_are_valid_and_timed_at_50_hz():
    msgs = scripted_hand(scripted_expert(SCENE), frame=(1280, 720))
    assert all(m.tracking_ok and 0 <= m.wrist_uv[0] <= 1 and 0 <= m.wrist_uv[1] <= 1 for m in msgs)
    assert [m.t_ms for m in msgs[:3]] == pytest.approx([0.0, 20.0, 40.0])
    assert (msgs[0].frame_w, msgs[0].frame_h) == (1280, 720)


def test_scripted_hand_refuses_poses_outside_the_workspace():
    traj = scripted_expert(SCENE)
    narrow = Calibration(y_range=(-0.1, 0.1))  # the bin sits at y = 0.3
    with pytest.raises(ValueError, match="outside"):
        scripted_hand(traj, narrow)


def test_scripted_hand_drives_a_session_to_the_expert_trajectory(rig):
    session, _, clock, saved = rig
    traj = scripted_expert(SCENE)
    session.on_control("record_start")
    for msg in scripted_hand(traj):
        session.on_hand(msg)
        session.step()
        clock.advance(TELEOP_DT)
    session.on_control("record_stop")
    got = saved[0].demo.trajectory
    assert len(got.t) == len(traj.t)
    assert np.allclose(got.ee_pos, traj.ee_pos) and got.gripper == traj.gripper


# --- the sink's relay side: dispatch + relay_loop (no Isaac) ---------------------------------

import json  # noqa: E402
import socket  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402

from sim_worker.teleop_session import apply_inbox, dispatch, relay_loop  # noqa: E402
from sim_worker.teleop_trace import LatencyTrace  # noqa: E402


def test_dispatch_routes_hand_and_control_messages(rig):
    session, driver, clock, _ = rig
    assert dispatch(session, hand(u=0.3).model_dump_json()) is None
    session.step()
    assert driver.applied[-1][0] == to_ee_target(hand(u=0.3))
    assert dispatch(session, json.dumps({"type": "control", "action": "record_start"})) is None
    assert session.state == "recording"


def test_dispatch_ignores_relay_chatter_and_reports_garbage(rig):
    session, _, _, _ = rig
    assert dispatch(session, json.dumps({"type": "error", "detail": "x"})) == "relay error: x"
    assert dispatch(session, json.dumps({"type": "status", "sim_connected": True})) is None
    assert "invalid" in dispatch(session, "not json")
    assert "invalid" in dispatch(session, json.dumps({"type": "control", "action": "self_destruct"}))
    assert session.state == "idle"


def test_dispatch_takes_a_traced_hand_message(rig):
    # the latency trace rides beside the HandPoseMsg fields; it must not make the hand invalid
    session, driver, _, _ = rig
    data = json.loads(hand(u=0.3).model_dump_json())
    data["trace"] = {"cap": 1.0, "send": 2.0, "relay_in": 3.0, "relay_out": 4.0}
    assert dispatch(session, json.dumps(data)) is None
    session.step()
    assert driver.applied[-1][0] == to_ee_target(hand(u=0.3))


def _traced(u: float, **stamps) -> str:
    data = json.loads(hand(u=u).model_dump_json())
    if stamps:
        data["trace"] = stamps
    return json.dumps(data)


def test_apply_inbox_uses_only_the_newest_hand_and_counts_the_stale_ones(rig):
    session, driver, _, _ = rig
    trace = LatencyTrace()
    items = [(_traced(0.1, cap=1.0), 10.0), (_traced(0.2, cap=2.0), 11.0), (_traced(0.3, cap=3.0), 12.0)]
    problems, stamps = apply_inbox(session, items, trace=trace)
    assert problems == [] and stamps == {"cap": 3.0, "recv": 12.0}
    session.step()
    assert driver.applied[-1][0] == to_ee_target(hand(u=0.3))
    assert trace.summary()["messages"]["stale_dropped"] == 2


def test_apply_inbox_keeps_controls_in_order(rig):
    session, driver, _, _ = rig
    items = [(_traced(0.1), 1.0), (json.dumps({"type": "control", "action": "record_start"}), 2.0),
             (_traced(0.2), 3.0), (_traced(0.3), 4.0)]
    problems, stamps = apply_inbox(session, items)
    assert problems == [] and session.state == "recording" and stamps == {"recv": 4.0}
    session.step()
    assert driver.applied[-1][0] == to_ee_target(hand(u=0.3))


def test_apply_inbox_with_no_hand_applies_nothing_new(rig):
    session, _, _, _ = rig
    problems, stamps = apply_inbox(session, [("not json", 1.0)])
    assert stamps is None and len(problems) == 1 and "invalid" in problems[0]
    assert apply_inbox(session, []) == ([], None)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def relay_server(monkeypatch, tmp_path):
    """The real FastAPI relay on a real port, in a thread."""
    uvicorn = pytest.importorskip("uvicorn")
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("APP_UPLOAD_DIR", str(tmp_path / "uploads"))
    app = pytest.importorskip("app.main").app  # the backend venv only (Isaac's lacks sqlalchemy)
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


def test_relay_loop_records_a_demo_end_to_end_through_the_real_relay(relay_server):
    from websockets.sync.client import connect

    saved, stop = [], threading.Event()
    session = TeleopSession(FakeDriver(), SCENE, lambda r: saved.append(r) or f"saved {r.demo.id}",
                            new_id=lambda: "human_e2e")
    sink = threading.Thread(target=relay_loop, args=(session, relay_server + "?role=sim"),
                            kwargs={"should_stop": stop.is_set}, daemon=True)
    sink.start()
    try:
        with connect(relay_server + "?role=browser") as browser:
            def next_json(pred, timeout=10.0):
                deadline = time.monotonic() + timeout
                while True:
                    msg = json.loads(browser.recv(timeout=max(0.01, deadline - time.monotonic())))
                    if pred(msg):
                        return msg

            next_json(lambda m: m == {"type": "status", "sim_connected": True})
            browser.send(json.dumps({"type": "control", "action": "record_start"}))
            next_json(lambda m: m.get("type") == "sim_status" and m["recording"])
            for msg in scripted_hand(scripted_expert(SCENE))[:60]:
                browser.send(msg.model_dump_json())
                time.sleep(0.005)
            next_json(lambda m: m.get("type") == "sim_status" and m["steps"] >= 10)
            browser.send(json.dumps({"type": "control", "action": "record_stop"}))
            done = next_json(lambda m: m.get("type") == "sim_status" and m["demo_id"] is not None)
    finally:
        stop.set()
        sink.join(timeout=10)

    assert not sink.is_alive()
    assert done["demo_id"] == "human_e2e" and done["last_result"] == "saved human_e2e"
    assert done["recording"] is False
    assert len(saved) == 1 and len(saved[0].demo.trajectory.t) == done["steps"] >= 10


def test_relay_loop_traces_a_traced_hand_through_the_real_relay(relay_server):
    from websockets.sync.client import connect

    lines, stop = [], threading.Event()
    trace = LatencyTrace(report_every_s=0.3, log=lines.append)
    session = TeleopSession(FakeDriver(), SCENE, lambda r: "ok")
    sink = threading.Thread(target=relay_loop, args=(session, relay_server + "?role=sim"),
                            kwargs={"should_stop": stop.is_set, "trace": trace, "log": lambda m: None}, daemon=True)
    sink.start()
    try:
        with connect(relay_server + "?role=browser") as browser:
            while json.loads(browser.recv(timeout=10)) != {"type": "status", "sim_connected": True}:
                pass
            deadline = time.monotonic() + 10
            while not any("to_sink" in line for line in lines) and time.monotonic() < deadline:
                t = time.time() * 1000.0
                browser.send(_traced(0.4, cap=t - 5.0, send=t))
                time.sleep(0.03)
    finally:
        stop.set()
        sink.join(timeout=10)
    line = next(line for line in lines if "to_sink" in line)
    for stage in ("browser", "to_relay", "relay", "to_sink", "wait", "step", "total"):
        assert f" {stage} " in line
    assert "steps/s" in line


def test_relay_loop_keeps_stepping_while_the_relay_is_down():
    """No backend at all: the loop keeps the robot stepping (holding) and retries, and stops on request."""
    driver, stop = FakeDriver(), threading.Event()
    session = TeleopSession(driver, SCENE, lambda r: "ok")
    sink = threading.Thread(target=relay_loop, args=(session, f"ws://127.0.0.1:{_free_port()}/ws/teleop?role=sim"),
                            kwargs={"should_stop": stop.is_set, "retry_s": 0.05}, daemon=True)
    sink.start()
    time.sleep(0.5)
    stop.set()
    sink.join(timeout=10)
    assert not sink.is_alive()
    assert len(driver.applied) > 5


# --- discarding a recording -------------------------------------------------------------

def test_discard_ends_the_recording_without_saving(rig):
    session, _, clock, saved = rig
    session.on_control("record_start")
    run(session, clock, 10, hand())
    session.on_control("record_discard")
    assert session.state == "idle" and saved == []
    status = session.status()
    assert status["recording"] is False and status["demo_id"] is None
    assert status["last_result"] == "discarded: 10 step(s) not saved"
    run(session, clock, 3, hand())  # idle again: follows the hand, records nothing
    assert session.status()["steps"] == 10


def test_discard_forgets_the_last_saved_demo_so_delete_cannot_hit_an_older_one(rig):
    session, _, clock, saved = rig
    session.on_control("record_start")
    run(session, clock, 5, hand())
    session.on_control("record_stop")
    assert session.status()["demo_id"] == "human_test_0"
    session.on_control("record_start")
    run(session, clock, 5, hand())
    session.on_control("record_discard")
    assert session.status()["demo_id"] is None and len(saved) == 1


def test_discard_while_idle_is_refused(rig):
    session, _, _, saved = rig
    session.on_control("record_discard")
    assert session.last_result == "not recording; nothing to discard" and session.state == "idle"
    assert saved == []


def test_discard_writes_no_demo_folder(tmp_path):
    store = DemoStore(tmp_path)
    clock = FakeClock()
    session = TeleopSession(FakeDriver(), SCENE, make_store_saver(store), clock=clock, new_id=lambda: "human_x")
    session.on_control("record_start")
    run(session, clock, 5, hand())
    session.on_control("record_discard")
    assert not (tmp_path / "demos").exists() and store.list_demos() == []


def test_the_driver_is_told_recording_ended_on_discard():
    driver = CameraDriver()
    session = TeleopSession(driver, SCENE, lambda r: "saved", clock=FakeClock())
    session.on_control("record_discard")  # refused: not recording
    session.on_control("record_start")
    session.on_hand(hand())
    session.step()
    session.on_control("record_discard")
    assert driver.recording_calls == [True, False]


# --- keyboard and mouse input: set_input, smoothing, the demo's "input" ------------------

from demo_pipeline.measure import jerk_rms  # noqa: E402
from demo_pipeline.rules import JITTER_MIN_JERK  # noqa: E402
from sim_worker.teleop_session import SMOOTH_TAU_S  # noqa: E402


def drive_msg(x: float, t_ms: float = 0.0) -> HandPoseMsg:
    """What drive.ts sends for target (x, 0, 0.21): control is the target in workspace fractions."""
    return HandPoseMsg(t_ms=t_ms, tracking_ok=True, wrist_uv=(0.5, 0.5), palm_width=0.1, pinch_ratio=0.8, yaw_rad=0.0,
                       frame_w=640, frame_h=480, control=(0.5, 0.5, (x - 0.3) / 0.4), grip=0)


def record_staircase(session, clock, input_mode):
    """A smooth 0.1 m/s glide sent at 30 Hz, the sim ticking at 50 Hz: each tick sees the newest message."""
    if input_mode:
        session.on_control("set_input", input_mode)
    session.on_control("record_start")
    sent_every = 1 / 30
    for k in range(150):  # 3 s of ticks
        t = k * TELEOP_DT
        x_sent = 0.4 + 0.1 * min(2.0, max(0.0, (t // sent_every) * sent_every - 0.5))
        session.on_hand(drive_msg(x_sent, t_ms=t * 1000))
        session.step()
        clock.advance(TELEOP_DT)
    session.on_control("record_stop")


def max_window_jerk(traj):
    return max(jerk_rms(traj, t0, t0 + 0.5) for t0 in np.arange(0.0, traj.t[-1], 0.5))


def test_set_input_is_kept_and_saved_with_the_demo(rig):
    session, _, clock, saved = rig
    assert session.input is None
    session.on_control("set_input", "keyboard")
    assert session.input == "keyboard" and session.last_result == "input: keyboard"
    session.on_control("record_start")
    run(session, clock, 5, drive_msg(0.45))
    session.on_control("record_stop")
    assert saved[0].demo.input == "keyboard"


def test_an_unknown_input_is_refused(rig):
    session, *_ = rig
    with pytest.raises(ValueError):
        session.on_control("set_input", "joystick")
    with pytest.raises(ValueError):
        session.on_control("set_input")


def test_a_demo_without_set_input_has_no_input(rig):
    session, _, clock, saved = rig
    session.on_control("record_start")
    run(session, clock, 5, hand())
    session.on_control("record_stop")
    assert saved[0].demo.input is None


def test_keyboard_targets_are_smoothed_enough_to_pass_the_jitter_check(rig):
    session, _, clock, saved = rig
    record_staircase(session, clock, "keyboard")
    assert max_window_jerk(saved[0].demo.trajectory) < JITTER_MIN_JERK


def test_the_same_stream_unsmoothed_fails_it_which_is_why_keyboard_and_mouse_are_smoothed(rig):
    session, _, clock, saved = rig
    record_staircase(session, clock, None)  # the camera path: no smoothing, as before
    assert max_window_jerk(saved[0].demo.trajectory) > JITTER_MIN_JERK


def test_mouse_is_smoothed_too_and_camera_is_not(rig):
    session, driver, clock, _ = rig
    session.on_control("set_input", "camera")
    run(session, clock, 1, drive_msg(0.6))
    assert driver.applied[-1][0].pos == pytest.approx(to_ee_target(drive_msg(0.6)).pos)  # straight to the target
    session.on_control("set_input", "mouse")
    run(session, clock, 1, drive_msg(0.4))
    assert driver.applied[-1][0].pos[0] > 0.5  # one tick after a 20 cm jump it is still on its way
    run(session, clock, int(10 * SMOOTH_TAU_S / TELEOP_DT), drive_msg(0.4))
    assert driver.applied[-1][0].pos == pytest.approx(to_ee_target(drive_msg(0.4)).pos, abs=1e-3)


def test_switching_to_a_smoothed_input_starts_from_where_the_arm_is_told_to_be(rig):
    session, driver, clock, _ = rig
    run(session, clock, 3, drive_msg(0.6))  # camera (no input yet): at 0.6
    session.on_control("set_input", "keyboard")
    run(session, clock, 1, drive_msg(0.6))
    assert driver.applied[-1][0].pos[0] == pytest.approx(0.6)  # no jump back to the start pose


def test_reset_scene_restarts_the_smoothing_at_the_start_pose(rig):
    session, driver, clock, _ = rig
    session.on_control("set_input", "keyboard")
    run(session, clock, 30, drive_msg(0.6))
    session.on_control("reset_scene")
    run(session, clock, 1)  # no hand yet: holds the start pose
    assert driver.applied[-1][0].pos == pytest.approx(START_TCP)


def test_the_kit_window_looks_from_behind_the_robot_over_its_right_shoulder():
    from sim_worker.teleop_session import KIT_CAMERA_EYE, KIT_CAMERA_TARGET

    eye, target = np.asarray(KIT_CAMERA_EYE), np.asarray(KIT_CAMERA_TARGET)
    assert eye[0] < 0 < target[0]  # behind the base, looking forward
    assert eye[1] < 0 and eye[2] > target[2] + 1.0  # a little to the robot's right, well above
    forward = (target - eye) / np.linalg.norm(target - eye)
    screen_right = np.cross(forward, (0.0, 0.0, 1.0))
    assert screen_right @ (0.0, -1.0, 0.0) > 0  # the robot's right (-y) is on the screen's right
    assert np.allclose(eye - target, (-0.8, -0.5, 1.25))  # the Record page twin's View offset, in the sim frame
