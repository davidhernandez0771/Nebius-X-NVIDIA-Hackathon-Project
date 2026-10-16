"""The pure part of the submission media (scripts/make_media.py draws with Pillow).

Covers which steps become GIF frames and for how long, how two episodes of different length line up
side by side, and where segments and issues sit on the timeline bar under each frame. Times are seconds
from the episode's first step (step i is at i / fps), as in Diagnosis.
"""

from __future__ import annotations

from typing import NamedTuple

import numpy as np

from .schemas import Diagnosis

SEGMENT_COLORS = {"approach": "#93c5fd", "carry": "#86efac", "retreat": "#d1d5db"}
ISSUE_COLORS = {
    "pause": "#f59e0b", "jitter": "#a855f7", "slow": "#64748b", "idle_start_end": "#9ca3af",
    "grasp_off_center": "#ef4444", "wrong_object": "#b91c1c", "rim_contact": "#f97316", "bad_release": "#ec4899",
    "drop": "#7f1d1d", "other": "#111827",
}
DEFAULT_COLOR = "#6b7280"
POINT_HALF_S = 0.25  # a point issue counts as "now" this close to its time (as in scoring)


def select_frames(n_steps: int, k: int) -> list[int]:
    """k evenly spaced step indices from the first to the last (all steps if there are fewer)."""
    if n_steps < 1:
        raise ValueError(f"an episode needs at least one step, got {n_steps}")
    if k >= n_steps:
        return list(range(n_steps))
    return [int(i) for i in np.round(np.linspace(0, n_steps - 1, k)).astype(int)]


def _delays_ms(steps: list[int], n_steps: int, fps: float) -> list[int]:
    """How long each frame shows: until the next frame's time, the last until the episode ends. Rounded on
    the cumulative clock to whole hundredths (GIF delays), so the GIF lasts exactly as long as the episode."""
    bounds = [s / fps * 1000 for s in steps] + [n_steps / fps * 1000]
    tick = [int(round(b / 10.0)) * 10 for b in bounds]
    return [max(b - a, 10) for a, b in zip(tick[:-1], tick[1:])]


def gif_frames(n_steps: int, fps: float, gif_fps: float = 10.0, max_frames: int | None = None) -> tuple[list[int], list[int]]:
    """(step indices, per-frame delays in ms) for a real-time GIF: every fps/gif_fps-th step plus the last,
    thinned evenly to max_frames if given."""
    if n_steps < 1:
        raise ValueError(f"an episode needs at least one step, got {n_steps}")
    stride = max(1, int(round(fps / gif_fps)))
    steps = list(range(0, n_steps, stride))
    if steps[-1] != n_steps - 1:
        steps.append(n_steps - 1)
    if max_frames is not None and len(steps) > max_frames:
        steps = select_frames(n_steps, max_frames)
    return steps, _delays_ms(steps, n_steps, fps)


def pair_frames(n_a: int, n_b: int, fps: float, gif_fps: float = 10.0,
                max_frames: int | None = None) -> tuple[list[tuple[int, int]], list[int]]:
    """Frames for two episodes played side by side in real time; the shorter one holds its last frame."""
    steps, ms = gif_frames(max(n_a, n_b), fps, gif_fps, max_frames)
    return [(min(s, n_a - 1), min(s, n_b - 1)) for s in steps], ms


def step_time(step: int, fps: float) -> float:
    return step / fps


def panel_time(t: float, n_steps: int, fps: float) -> tuple[float, bool]:
    """(the time a side-by-side panel shows, whether its episode is over): a finished episode's clock and
    cursor stop at its last step, rather than running on over its held last frame."""
    end = step_time(n_steps - 1, fps)
    return (end, True) if t > end + 1e-9 else (t, False)


class TimelineBar(NamedTuple):
    """Maps seconds onto pixels: 0 s at x = pad, `duration` at x = width - pad, clipped to the bar."""

    width: int
    duration: float
    pad: int = 8

    def x(self, t: float) -> int:
        frac = min(max(t / self.duration, 0.0), 1.0) if self.duration > 0 else 0.0
        return int(round(self.pad + frac * (self.width - 2 * self.pad)))


class Mark(NamedTuple):
    label: str
    x0: int
    x1: int
    color: str
    point: bool = False


class Layout(NamedTuple):
    bar: TimelineBar
    segments: list[Mark]
    issues: list[Mark]


def timeline_layout(diag: Diagnosis | None, duration: float, width: int, pad: int = 8) -> Layout:
    """Pixel spans of the diagnosis's segments (bands) and issues (ranges, or ticks for point issues)."""
    bar = TimelineBar(width, duration, pad)
    if diag is None:
        return Layout(bar, [], [])
    segments = [Mark(s.name, bar.x(s.t0), bar.x(s.t1), SEGMENT_COLORS.get(s.name, DEFAULT_COLOR)) for s in diag.segments]
    issues = []
    for i in diag.issues:
        color = ISSUE_COLORS.get(i.type, DEFAULT_COLOR)
        if i.t is not None:
            issues.append(Mark(i.type, bar.x(i.t), bar.x(i.t), color, point=True))
        else:
            issues.append(Mark(i.type, bar.x(i.t0), bar.x(i.t1), color))
    return Layout(bar, segments, issues)


def side_by_side_layouts(diagnoses: tuple[Diagnosis | None, Diagnosis | None], n_a: int, n_b: int, fps: float,
                         width: int, pad: int = 8) -> tuple[Layout, Layout]:
    """Both panels' timelines on one time scale (the longer episode's), so the shorter one visibly ends first."""
    duration = max(n_a, n_b) / fps
    return (timeline_layout(diagnoses[0], duration, width, pad), timeline_layout(diagnoses[1], duration, width, pad))


def active_labels(diag: Diagnosis | None, t: float) -> list[str]:
    """The segment the time falls in, then every issue that covers it (point issues within POINT_HALF_S)."""
    if diag is None:
        return []
    out = [s.name for s in diag.segments if s.t0 <= t < s.t1 or (s is diag.segments[-1] and t == s.t1)]
    for i in diag.issues:
        if (i.t is not None and abs(t - i.t) <= POINT_HALF_S) or (i.t is None and i.t0 <= t <= i.t1):
            out.append(i.type)
    return out


def load_diagnosis(data: dict) -> Diagnosis:
    """A Diagnosis from its JSON, or from a stored one (the demo store's diagnosis.json: {"diagnosis": ...})."""
    if isinstance(data.get("diagnosis"), dict):
        return Diagnosis.model_validate(data["diagnosis"])
    if "segments" in data and "issues" in data:
        return Diagnosis.model_validate(data)
    raise ValueError("not a diagnosis: expected a Diagnosis or a stored diagnosis with a 'diagnosis' key")
