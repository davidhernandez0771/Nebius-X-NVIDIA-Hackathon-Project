"""A fake browser for measuring teleop latency without a person: it streams traced hand messages to the relay.

    uv run python -m sim_worker.teleop_probe --seconds 60            (relay + teleop_sink.py --latency running)

It connects as the browser (ws://127.0.0.1:8000/ws/teleop?role=browser), waits for the sim, then sends a hand
moving in a slow circle (~0.25 m/s at the tool, a calm human pace) at --rate Hz, like TeleopClient, each with a
latency "trace" (cap = send: there is no webcam or MediaPipe here, so the browser stage is 0). With --record-s
it records that long in the middle of the run (the sink saves a demo: point its --data-dir somewhere disposable).
The sink's [latency] lines show the result.
"""

from __future__ import annotations

import argparse
import json
import math
import time

from demo_pipeline.teleop import HandPoseMsg

from .teleop_trace import TRACE_KEY, now_ms

CIRCLE_HZ = 0.25
CIRCLE_R = 0.12  # in normalized image coords


def circle_message(t_s: float, *, t_ms: float, sent_ms: float) -> dict:
    """The hand message for time t_s on the circle, as a JSON object with its trace."""
    a = 2 * math.pi * CIRCLE_HZ * t_s
    msg = HandPoseMsg(t_ms=t_ms, tracking_ok=True, wrist_uv=(0.5 + CIRCLE_R * math.cos(a), 0.5 + CIRCLE_R * math.sin(a)),
                      palm_width=0.1, pinch_ratio=0.8, yaw_rad=0.0, frame_w=640, frame_h=480)
    return {**msg.model_dump(mode="json", exclude_none=True), TRACE_KEY: {"cap": sent_ms, "send": sent_ms}}


def _drain(ws) -> None:
    while True:
        try:
            ws.recv(timeout=0)
        except TimeoutError:
            return


def _connect_when_sim_is_up(connect, url: str, wait_s: float):
    """A browser connection to the relay once it reports a connected sim; reconnects if the socket drops while
    waiting (the sim takes a minute to start, and local sockets here are occasionally reset)."""
    deadline = time.monotonic() + wait_s
    while True:
        ws = connect(url)
        try:
            while True:  # the relay says {"type": "status", "sim_connected": ...} on connect and on change
                msg = json.loads(ws.recv(timeout=max(0.1, deadline - time.monotonic())))
                if msg.get("type") == "status" and msg.get("sim_connected"):
                    return ws
        except TimeoutError:
            ws.close()
            raise
        except Exception as e:  # dropped while waiting: try again
            ws.close()
            if time.monotonic() > deadline:
                raise
            print(f"[probe] relay connection dropped while waiting for the sim ({type(e).__name__}); reconnecting",
                  flush=True)
            time.sleep(1.0)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--url", default="ws://127.0.0.1:8000/ws/teleop?role=browser")
    p.add_argument("--seconds", type=float, default=60.0)
    p.add_argument("--rate", type=float, default=30.0, help="messages per second (TeleopClient sends <= 30)")
    p.add_argument("--record-s", type=float, default=0.0, help="record this long in the middle of the run")
    p.add_argument("--sim-wait-s", type=float, default=120.0)
    args = p.parse_args(argv)
    from websockets.sync.client import connect

    with _connect_when_sim_is_up(connect, args.url, args.sim_wait_s) as ws:
        print(f"[probe] sim connected; sending {args.rate:g} Hz for {args.seconds:g} s", flush=True)
        t0 = time.monotonic()
        rec_start = (args.seconds - args.record_s) / 2 if args.record_s > 0 else None
        recording = False
        k = 0
        while (t := time.monotonic() - t0) < args.seconds:
            if rec_start is not None and not recording and t >= rec_start and t < rec_start + args.record_s:
                ws.send(json.dumps({"type": "control", "action": "record_start"}))
                recording = True
            elif recording and t >= rec_start + args.record_s:
                ws.send(json.dumps({"type": "control", "action": "record_stop"}))
                recording, rec_start = False, None
            ws.send(json.dumps(circle_message(t, t_ms=t * 1000.0, sent_ms=now_ms())))
            k += 1
            _drain(ws)  # the sim's status messages: unread, they fill the socket's queue and keepalive fails
            time.sleep(max(0.0, t0 + k / args.rate - time.monotonic()))
        if recording:
            ws.send(json.dumps({"type": "control", "action": "record_stop"}))
        print(f"[probe] sent {k} hand messages", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
