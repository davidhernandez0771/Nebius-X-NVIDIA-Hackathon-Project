"""Teleop latency trace: where the delay between the person's hand and the arm goes. Off by default.

Turn it on with `teleop_sink.py --latency [PATH]` (sim side) and the Record page's `?latency=1` (browser side).
Each traced hand message carries a "trace" object beside the HandPoseMsg fields; the relay and the sink take it
off before validating the message, so HandPoseMsg itself is unchanged. Stamps are epoch milliseconds from the
machine's wall clock (browser Date.now(), Python time.time()), so they compare across the three processes:

    cap        browser: the webcam frame went into MediaPipe (HandFrame.timestamp, as epoch ms)
    send       browser: TeleopClient sent the message
    relay_in   relay (src/app/routers/teleop.py) received it
    relay_out  relay forwarded it to the sim
    recv       the sink's reader thread received it
    applied    a control step started with it as the newest hand (sink main thread)
    done       that control step finished: IK, physics, render, state read

Stages: browser = cap -> send, to_relay, relay, to_sink, wait = recv -> applied, step = applied -> done, and
total = cap -> done. Per control step the trace also keeps the step's wall time split into the driver's timed
sections (ik, physics, render, read; "other" is the rest), the loop's sleep, steps per wall second, and the
real-time factor (sim time advanced / wall time). A step that reuses an older hand (no new message) counts as a
step but not as a message. Every report_every_s it logs one line and, with a path, appends one JSON row.

Pure: stdlib only, so it tests anywhere.
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, TypeVar

TELEOP_DT = 0.02  # s of sim time per control step (sim_worker.teleop_session.TELEOP_DT)
TRACE_KEY = "trace"
STAMPS = ("cap", "send", "relay_in", "relay_out", "recv")
STAGES = (  # name, from stamp, to stamp ("applied" and "done" are the sink's own)
    ("browser", "cap", "send"),
    ("to_relay", "send", "relay_in"),
    ("relay", "relay_in", "relay_out"),
    ("to_sink", "relay_out", "recv"),
    ("wait", "recv", "applied"),
    ("step", "applied", "done"),
    ("total", "cap", "done"),
)

T = TypeVar("T")


def now_ms() -> float:
    return time.time() * 1000.0


def split_trace(data: dict) -> tuple[dict, dict | None]:
    """(the message without its trace, the trace's numeric stamps or None). A malformed trace is dropped: it is
    diagnostics, never a reason to refuse a hand."""
    if TRACE_KEY not in data:
        return data, None
    rest = {k: v for k, v in data.items() if k != TRACE_KEY}
    raw = data[TRACE_KEY]
    if not isinstance(raw, dict):
        return rest, None
    stamps = {k: float(v) for k, v in raw.items()
              if isinstance(v, (int, float)) and not isinstance(v, bool)}
    return rest, stamps or None


def coalesce_hands(items: list[T], is_hand: Callable[[T], bool]) -> tuple[list[T], int]:
    """Keep every control, in order, and of each run of hand messages only the newest (a newer hand replaces an
    older one before the session ever steps). Returns (kept, number of stale hands dropped)."""
    kept: list[T] = []
    pending: T | None = None
    dropped = 0
    for item in items:
        if is_hand(item):
            if pending is not None:
                dropped += 1
            pending = item
            continue
        if pending is not None:
            kept.append(pending)
            pending = None
        kept.append(item)
    if pending is not None:
        kept.append(pending)
    return kept, dropped


class Sections:
    """Milliseconds per named section within one control step (the driver adds them; the loop takes them)."""

    def __init__(self, clock: Callable[[], float] = time.perf_counter) -> None:
        self.clock = clock
        self._ms: dict[str, float] = {}

    def add(self, name: str, ms: float) -> None:
        self._ms[name] = self._ms.get(name, 0.0) + ms

    @contextmanager
    def time(self, name: str) -> Iterator[None]:
        t0 = self.clock()
        try:
            yield
        finally:
            self.add(name, (self.clock() - t0) * 1000.0)

    def take(self) -> dict[str, float]:
        out, self._ms = self._ms, {}
        return out


def _stats(values: list[float]) -> dict:
    v = sorted(values)
    pick = lambda q: v[min(len(v) - 1, int(q * len(v)))]  # noqa: E731
    return {"n": len(v), "p50": round(pick(0.5), 2), "p95": round(pick(0.95), 2), "max": round(v[-1], 2)}


class LatencyTrace:
    def __init__(self, *, report_every_s: float = 2.0, log: Callable[[str], None] = print,
                 clock: Callable[[], float] = time.time, path: Path | None = None) -> None:
        self.report_every_s, self.log, self.clock = report_every_s, log, clock
        self.path = Path(path) if path is not None else None
        self.sections = Sections()
        self._new_window()

    def _new_window(self) -> None:
        self._window_start = self.clock()
        self._stages: dict[str, list[float]] = {}
        self._step_wall: list[float] = []
        self._sleep: list[float] = []
        self._sections: dict[str, list[float]] = {}
        self._applied = 0
        self._stale = 0
        self._pending: dict | None = None

    # --- events ----------------------------------------------------------------------------------

    def hand_applied(self, stamps: dict, *, applied: float) -> None:
        """The control step starting at `applied` (epoch ms) uses this message (its stamps, recv included)."""
        self._pending = {**stamps, "applied": applied}
        self._applied += 1

    def stale(self, n: int) -> None:
        self._stale += n

    def step_done(self, *, start: float, end: float, sections: dict[str, float], sleep_ms: float) -> None:
        wall = end - start
        self._step_wall.append(wall)
        self._sleep.append(sleep_ms)
        for name, ms in sections.items():
            self._sections.setdefault(name, []).append(ms)
        self._sections.setdefault("other", []).append(wall - sum(sections.values()))
        if self._pending is not None:
            stamps = {**self._pending, "done": end}
            for name, a, b in STAGES:
                if a in stamps and b in stamps:
                    self._stages.setdefault(name, []).append(stamps[b] - stamps[a])
            self._pending = None

    # --- reports ---------------------------------------------------------------------------------

    def summary(self, now_s: float | None = None) -> dict:
        now_s = self.clock() if now_s is None else now_s
        window = max(now_s - self._window_start, 1e-9)
        n = len(self._step_wall)
        steps = {"n": n, "per_s": round(n / window, 2), "rtf": round(n * TELEOP_DT / window, 3)}
        if n:
            steps["wall_ms"] = _stats(self._step_wall)
            steps["sleep_ms"] = _stats(self._sleep)
            steps["sections_ms"] = {k: _stats(v) for k, v in self._sections.items()}
        return {
            "window_s": round(window, 3),
            "stages_ms": {name: _stats(self._stages[name]) for name, _, _ in STAGES if name in self._stages},
            "steps": steps,
            "messages": {"applied": self._applied, "stale_dropped": self._stale},
        }

    def maybe_report(self) -> dict | None:
        """At the end of each window: log a line (and append a JSON row) if anything happened, start a new one."""
        now_s = self.clock()
        if now_s - self._window_start < self.report_every_s:
            return None
        if not self._step_wall and not self._applied:
            self._new_window()
            return None
        s = self.summary(now_s)
        self.log(format_summary(s))
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"at": round(now_s, 3), **s}) + "\n")
        self._new_window()
        return s


def format_summary(s: dict) -> str:
    st, steps = s["stages_ms"], s["steps"]
    parts = [f"[latency] {s['window_s']:.1f} s: {steps['per_s']:.1f} steps/s (RTF {steps['rtf']:.2f}), "
             f"{s['messages']['applied']} hands applied, {s['messages']['stale_dropped']} stale dropped"]
    if st:
        parts.append("ms p50/p95 " + " ".join(f"{k} {v['p50']:g}/{v['p95']:g}" for k, v in st.items()))
    if steps.get("sections_ms"):
        parts.append("step ms p50/p95 " + " ".join(
            f"{k} {v['p50']:g}/{v['p95']:g}" for k, v in steps["sections_ms"].items())
                     + f" sleep {steps['sleep_ms']['p50']:g}")
    return " | ".join(parts)
