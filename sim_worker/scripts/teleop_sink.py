"""Webcam teleop sink: the Isaac side of the Record page (sim_worker.teleop_session + teleop_isaac).

Live (a person at the webcam; open a window with --viz kit so they can see the arm):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\teleop_sink.py --viz kit
  Connects to the backend relay as the sim (ws://127.0.0.1:8000/ws/teleop?role=sim) and runs the
  TeleopSession on Isaac's main thread. Record page Start/Stop/Reset drive it. Each stop saves a
  human Demo + its episode into the DemoStore under DATA_DIR (or --data-dir).

Automated smoke (no person, no backend; headless is fine):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\teleop_sink.py --fake-hand --no-cameras
  A scripted fake hand (teleop_session.scripted_hand of the scripted expert) feeds HandPoseMsgs
  in-process: it holds the first pose for --lead-in-s to line up, as a person would, then records
  one message per control step and stops. The saved demo is then replayed with sim_worker.replay
  for an independent check. Prints RESULT_JSON; exit 0 only if both checks succeed.

Latency (off by default): --latency logs a [latency] line every 2 s (stages from the webcam to the finished
control step, steps per second, real-time factor, ik/physics/render/read ms per step; sim_worker.teleop_trace);
--latency-log PATH also appends each window as a JSON row. The browser adds its stamps with the Record page's
?latency=1. --render legacy | fast | fastest: how often the window and the recording cameras are rendered
(sim_worker.teleop_isaac). --no-high-qos leaves Windows free to throttle the sink while its window
is in the background (sim_worker.teleop_qos).
"""

import argparse
import json
import sys
import time
from pathlib import Path

from isaaclab.app import add_launcher_args, launch_simulation

RENDER_DEFAULT = "fast"

parser = argparse.ArgumentParser(description="Run the webcam-teleop session in Isaac Lab.")
parser.add_argument("--relay", default="ws://127.0.0.1:8000/ws/teleop?role=sim", help="backend relay URL (live)")
parser.add_argument("--fake-hand", action="store_true", help="automated smoke: scripted fake hand, no relay")
parser.add_argument("--lead-in-s", type=float, default=1.5, help="fake hand: hold the first pose this long first")
parser.add_argument("--no-cameras", action="store_true", help="state-only episodes (no front/wrist images)")
parser.add_argument("--robot", default="franka", choices=["franka"], help="teleop is calibrated for the Franka")
parser.add_argument("--data-dir", type=Path, default=None, help="DemoStore root (default: DATA_DIR / data)")
parser.add_argument("--num_envs", type=int, default=1, help="must be 1")
parser.add_argument("--latency", action="store_true", help="log where the teleop delay goes, every 2 s")
parser.add_argument("--latency-log", type=Path, default=None, help="also append each window here (JSONL); implies --latency")
parser.add_argument("--high-qos", action=argparse.BooleanOptionalAction, default=True,
                    help="opt out of Windows power throttling, so the sim keeps full speed while the browser is "
                         "in front (sim_worker.teleop_qos)")
parser.add_argument("--kit-camera", choices=["behind", "isaac"], default="behind",
                    help="the window's camera: behind the robot, over its shoulder (as the Record page's twin), or Isaac's "
                         "default view from the front")
parser.add_argument("--render", choices=["fast", "legacy", "fastest"], default=RENDER_DEFAULT,
                    help="fast: while not recording, render the window once per control step and pause the "
                         "recording cameras; recording renders as legacy (frames unchanged). legacy: render "
                         "after every physics step. fastest: fast, and once per control step while recording too "
                         "(recorded frames change slightly)")
add_launcher_args(parser)
args_cli = parser.parse_args()
if args_cli.num_envs != 1:
    parser.error("--num_envs must be 1")
if not args_cli.no_cameras:
    args_cli.enable_cameras = True  # cameras need the rendering extensions in headless launches

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, for `sim_worker`

from demo_pipeline.schemas import Pose, Scene  # noqa: E402
from demo_pipeline.store import DemoStore  # noqa: E402
from sim_worker.replay import bin_pose_for, make_sim_cfg, replay  # noqa: E402
from sim_worker.scene_cfg import BIN_INNER  # noqa: E402
from sim_worker.scripted import scripted_expert  # noqa: E402
from sim_worker.teleop_isaac import IsaacTeleopDriver  # noqa: E402
from sim_worker.teleop_session import (KIT_CAMERA_EYE, KIT_CAMERA_TARGET, TELEOP_DT, TeleopSession,  # noqa: E402
                                       make_store_saver, relay_loop, scripted_hand)
from sim_worker.teleop_qos import high_qos  # noqa: E402
from sim_worker.teleop_trace import LatencyTrace, now_ms  # noqa: E402


def base_scene() -> Scene:
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                 bin_pose=bin_pose_for(0.5, 0.3), robot=args_cli.robot, seed=0)


def _smoke_step(session: TeleopSession, msg, trace: LatencyTrace | None) -> None:
    """One control step as relay_loop runs it (no pacing: as fast as the sim goes)."""
    t_start = now_ms()
    session.on_hand(msg)
    if trace is not None:
        trace.hand_applied({"recv": t_start}, applied=t_start)
    session.step()
    if trace is not None:
        trace.step_done(start=t_start, end=now_ms(), sections=trace.sections.take(), sleep_ms=0.0)
        trace.maybe_report()


def fake_hand_smoke(session: TeleopSession, store: DemoStore, scene: Scene, trace: LatencyTrace | None,
                    qos: bool) -> int:
    msgs = scripted_hand(scripted_expert(scene))
    lead_in = round(args_cli.lead_in_s / TELEOP_DT)
    t0 = time.time()
    for _ in range(lead_in):  # line up, not recorded
        _smoke_step(session, msgs[0], trace)
    session.on_control("record_start")
    t_rec = time.time()
    for msg in msgs:
        _smoke_step(session, msg, trace)
    t_steps = time.time()
    session.on_control("record_stop")
    t_saved = time.time()
    status = session.status()
    print(f"[teleop-smoke] {status}")
    demo_id = status["demo_id"]
    if demo_id is None:
        print("RESULT_JSON " + json.dumps({"ok": False, "status": status}), flush=True)
        return 1
    demo = store.get_demo(demo_id)
    replay_result, _ = replay(demo.trajectory, demo.scene, ep_dir=None, record_cameras=False)
    t_done = time.time()
    live_ok = status["last_result"].endswith("verified success")
    result = {
        "ok": live_ok and replay_result.success,
        "demo_id": demo_id,
        "steps": status["steps"],
        "expected_steps": len(msgs),
        "live_check": status["last_result"],
        "replay_check": replay_result.model_dump(),
        "episode_dir": str(store.episode_dir(demo_id)),
        "wall_s": {"lead_in": round(t_rec - t0, 1), "record": round(t_steps - t_rec, 1),
                   "save": round(t_saved - t_steps, 1), "replay": round(t_done - t_saved, 1)},
        "ms_per_step": round(1000 * (t_steps - t_rec) / len(msgs), 1),
        "ms_per_idle_step": round(1000 * (t_rec - t0) / max(lead_in, 1), 1),
        "render": args_cli.render,
        "high_qos": qos,
    }
    print("RESULT_JSON " + json.dumps(result), flush=True)
    return 0 if result["ok"] else 1


def main() -> int:
    store = DemoStore(args_cli.data_dir)
    scene = base_scene()
    qos = high_qos() if args_cli.high_qos else False
    with launch_simulation(make_sim_cfg(args_cli.device), args_cli):
        trace = None
        if args_cli.latency or args_cli.latency_log is not None:
            trace = LatencyTrace(path=args_cli.latency_log, log=lambda line: print(line, flush=True))
        driver = IsaacTeleopDriver(record_cameras=not args_cli.no_cameras, robot=args_cli.robot,
                                   render=args_cli.render,
                                   sections=trace.sections if trace is not None else None)
        # store.new_id: never the name of a demo folder already there (live or under _discarded)
        session = TeleopSession(driver, scene, make_store_saver(store, bin_inner=BIN_INNER),
                                new_id=lambda: store.new_id("human"))
        if args_cli.kit_camera == "behind":
            try:
                driver.s.sim.set_camera_view(KIT_CAMERA_EYE, KIT_CAMERA_TARGET)
            except Exception as e:  # a viewer that can't be aimed must never stop the sink
                print(f"[teleop] could not aim the window camera: {type(e).__name__}: {e}", flush=True)
        # print and exit inside the context: closing the app ends the process
        if args_cli.fake_hand:
            return fake_hand_smoke(session, store, scene, trace, qos)
        print(f"[teleop] store: {store.root}; relay: {args_cli.relay}; render {args_cli.render}; "
              f"high QoS {'on' if qos else 'off'}; latency trace {'on' if trace else 'off'}; Ctrl+C to stop", flush=True)
        try:
            relay_loop(session, args_cli.relay, trace=trace)
        except KeyboardInterrupt:
            pass
        return 0


if __name__ == "__main__":
    sys.exit(main())
