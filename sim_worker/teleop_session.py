"""Sim-side webcam teleop: a pure state machine that turns HandPoseMsgs into a recorded human Demo (spec 8.1).

    idle --record_start--> recording --record_stop--> saving --(save_fn returns)--> idle

Every control step (TELEOP_DT = 50 Hz sim time) the session takes the latest HandPoseMsg, maps it
with demo_pipeline.teleop (to_ee_target + GripperLatch), and drives the robot through an injected
TeleopDriver. It follows the hand while idle too, so the person can line up before recording.

- Before any hand, or after reset_scene, it holds the robot's current tool pose with the gripper open.
- While tracking is lost it holds the last target; GripperLatch holds the gripper.
- Spec 8.1, "hand tracking lost: recording pauses": once no tracked message has arrived for
  more than LOST_PAUSE_S (wall clock), recording pauses. The steps are not recorded, so the
  pause is cut out of the demo, and the status says `paused`. It resumes with the next tracked
  message. Shorter dropouts are recorded as a hold.
- The Trajectory is the commanded target per recorded step, at t = k * TELEOP_DT (sim time),
  whatever the wall-clock pace. human_seconds is the wall-clock time from start to stop.
- On stop, the Demo (source "human") and the per-step StepStates go to an injected save_fn as a
  Recording. make_store_saver() writes them into a DemoStore with episode_io.

Pure: numpy + pydantic + demo_pipeline only (no torch, no Isaac), so it tests anywhere.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, Protocol

import numpy as np

from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode, save_signals
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Demo, Pose, Scene, SimSignals, Trajectory
from demo_pipeline.store import DemoStore
from demo_pipeline.success import check_success
from demo_pipeline.teleop import Calibration, GripperLatch, HandPoseMsg, to_ee_target

TELEOP_DT = 0.02  # s per control step; equals sim_worker.tracking.CONTROL_DT (that module imports torch)
FPS = 50
LOST_PAUSE_S = 0.3  # spec 8.1: tracking lost for longer than this pauses the recording
MIN_STEPS = 2  # a Trajectory needs at least 2 steps

State = Literal["idle", "recording", "saving"]
ACTIONS = ("record_start", "record_stop", "reset_scene")


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


class TeleopDriver(Protocol):
    def reset(self, scene: Scene) -> None:
        """Place the scene and put the robot at its start pose."""

    def apply(self, target: Pose, gripper: int) -> None:
        """Run one control step (TELEOP_DT of sim time) toward the tool target, gripper 0 open / 1 closed."""

    def read_state(self) -> StepState:
        """The robot and scene right now."""


@dataclass(frozen=True)
class Recording:
    demo: Demo
    states: list[StepState]  # one per trajectory step


SaveFn = Callable[[Recording], str]  # returns one human-readable line for the Record page


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
        self._steps = 0
        self._reset()

    # --- inputs -------------------------------------------------------------------------

    def on_hand(self, msg: HandPoseMsg) -> None:
        self._latest = msg
        if msg.tracking_ok:
            self._last_good_at = self.clock()

    def on_control(self, action: str) -> None:
        if action not in ACTIONS:
            raise ValueError(f"unknown control action {action!r}; expected one of {ACTIONS}")
        if action == "record_start":
            if self.state == "recording":
                self.last_result = "already recording"
                return
            self.state = "recording"
            self._started_at = self.clock()
            self._rec: dict[str, list] = {"pos": [], "quat": [], "gripper": [], "states": []}
            self._steps = 0
            self.last_result = "recording"
        elif action == "record_stop":
            if self.state != "recording":
                self.last_result = "not recording; nothing to stop"
                return
            self._save()
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
        self.driver.apply(self._target, self._gripper)
        state = self.driver.read_state()
        if self.state == "recording" and not self.paused:
            self._rec["pos"].append(self._target.pos)
            self._rec["quat"].append(self._target.quat_wxyz)
            self._rec["gripper"].append(self._gripper)
            self._rec["states"].append(state)
            self._steps += 1

    def status(self) -> dict:
        """The relay's SimStatusMsg (src/app/routers/teleop.py)."""
        return {
            "type": "sim_status",
            "recording": self.state == "recording",
            "steps": self._steps,
            "demo_id": self.last_demo_id,
            "last_result": self.last_result,
            "paused": self.paused,
        }

    # --- internals ----------------------------------------------------------------------

    def _reset(self) -> None:
        self.driver.reset(self.scene)
        start = self.driver.read_state()
        self._target = Pose(pos=tuple(float(v) for v in start.ee_pos), quat_wxyz=tuple(float(v) for v in start.ee_quat))
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
            traj = Trajectory.from_arrays(
                np.arange(n) * TELEOP_DT, np.asarray(rec["pos"]), np.asarray(rec["quat"]), rec["gripper"]
            )
            demo = Demo(id=self.new_id(), source="human", trajectory=traj, scene=self.scene,
                        human_seconds=human_seconds)
            self.last_result = self.save_fn(Recording(demo=demo, states=list(rec["states"])))
            self.last_demo_id = demo.id
        except Exception as e:  # a failed save must not wedge the session
            self.last_result = f"save failed: {type(e).__name__}: {e}"
        finally:
            self.state = "idle"


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
        residual = np.linalg.norm(reached - np.asarray(demo.trajectory.ee_pos), axis=1)
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
    from PIL import Image  # only needed with cameras; Isaac's venv has it

    for cam in cameras:
        for k, s in enumerate(states):
            Image.fromarray(s.frames[cam]).save(image_path(ep_dir, cam, k))
