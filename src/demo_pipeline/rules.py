"""Rules detector (spec 8.4): code-only diagnosis, the baseline Nemotron is compared against.

It only finds timing/smoothness problems (pause, jitter, idle_start_end). It never emits the
semantic issues (grasp_off_center, wrong_object, rim_contact, bad_release); that gap is what
the ablation measures.
"""

from __future__ import annotations

import numpy as np

from .measure import gripper_events, speed_profile
from .schemas import Diagnosis, Discard, Issue, MetricsWindow, RemovePause, Segment, Smooth, Trajectory, Trim

TASK_TEXT = "pick up the red cube and place it in the blue bin"

STILL_SPEED = 0.01  # m/s; below this the hand counts as still
MIN_STILL_S = 0.4  # a still span this long is a pause (inside) or idle time (at the start or end)
JITTER_RATIO = 3.0  # a window is jittery above this multiple of the median window jerk_rms...
JITTER_MIN_JERK = 20.0  # ...and above this floor (m/s^3). Smooth min-jerk motion stays under ~5; 1 mm noise gives ~100.
RELEASE_MARGIN_S = 0.5  # a trim keeps this long after the last open, so the release can finish
_TOL = 1e-9


def _still_runs(t: np.ndarray, speed: np.ndarray) -> list[tuple[int, int, float, float]]:
    """(first index, last index, still-from time, still-until time) for each run of still steps.

    speed[i] is the motion between steps i-1 and i, so a run a..b means the hand was still from t[a-1] to t[b].
    """
    runs, i, n = [], 0, len(speed)
    while i < n:
        if speed[i] >= STILL_SPEED:
            i += 1
            continue
        a = i
        while i < n and speed[i] < STILL_SPEED:
            i += 1
        b = i - 1
        runs.append((a, b, float(t[max(a - 1, 0)]), float(t[b])))
    return runs


def _segments(t_close: float, t_open: float | None, end: float) -> list[Segment]:
    bounds = [("approach", 0.0, t_close)]
    if t_open is None:
        bounds.append(("carry", t_close, end))
    else:
        bounds += [("carry", t_close, t_open), ("retreat", t_open, end)]
    return [Segment(name=name, t0=a, t1=b) for name, a, b in bounds if b > a]


def _jitter_spans(windows: list[MetricsWindow]) -> list[tuple[float, float]]:
    """Runs of consecutive jittery windows, merged into one span each."""
    if not windows:
        return []
    limit = max(JITTER_RATIO * float(np.median([w.jerk_rms for w in windows])), JITTER_MIN_JERK)
    spans: list[tuple[float, float]] = []
    for w in windows:
        if w.jerk_rms <= limit:
            continue
        if spans and abs(spans[-1][1] - w.t0) <= _TOL:
            spans[-1] = (spans[-1][0], w.t1)
        else:
            spans.append((w.t0, w.t1))
    return spans


def detect_rules(traj: Trajectory, windows: list[MetricsWindow], task_text: str = TASK_TEXT) -> Diagnosis:
    t = np.asarray(traj.t)
    g = np.asarray(traj.gripper)
    start, end = float(t[0]), float(t[-1])
    t_close, t_open = gripper_events(traj)

    if t_close is None:
        return Diagnosis(
            segments=[],
            issues=[Issue(type="other", t0=start, t1=end, evidence="the gripper never closes, so nothing was grasped")],
            repairs=[Discard(op="discard")],
            decision="discard",
            label=task_text,
        )

    issues: list[Issue] = []
    repairs = []
    keep_from, keep_to = start, end
    for a, b, still_from, still_to in _still_runs(t, speed_profile(traj)):
        if still_to - still_from < MIN_STILL_S - _TOL:
            continue
        if a == 0:  # idle start; never trim past the first close
            keep_from = min(still_to, t_close)
            if keep_from - start >= MIN_STILL_S - _TOL:
                issues.append(Issue(type="idle_start_end", t0=start, t1=keep_from,
                                    evidence=f"still for the first {keep_from - start:.2f} s"))
        elif b == len(t) - 1:  # idle end; keep the last open plus time to release
            keep_to = still_from if t_open is None else max(still_from, min(t_open + RELEASE_MARGIN_S, end))
            if end - keep_to >= MIN_STILL_S - _TOL:
                issues.append(Issue(type="idle_start_end", t0=keep_to, t1=end,
                                    evidence=f"still for the last {end - keep_to:.2f} s"))
            else:
                keep_to = end
        elif np.all(g[a - 1 : b + 1] == g[a - 1]):  # a hold while the gripper acts is not a pause
            issues.append(Issue(type="pause", t0=still_from, t1=still_to,
                                evidence=f"speed < {STILL_SPEED} m/s for {still_to - still_from:.2f} s"))
            repairs.append(RemovePause(op="remove_pause", t0=still_from, t1=still_to))
    if keep_from - start < MIN_STILL_S - _TOL:
        keep_from = start
    if (keep_from, keep_to) != (start, end) and keep_to > keep_from:
        repairs.insert(0, Trim(op="trim", t0=keep_from, t1=keep_to))

    for t0, t1 in _jitter_spans(windows):
        issues.append(Issue(type="jitter", t0=t0, t1=t1,
                            evidence=f"jerk_rms above {JITTER_RATIO:g}x the median window over [{t0:.2f}, {t1:.2f}] s"))
        repairs.append(Smooth(op="smooth", t0=t0, t1=t1, strength="med"))

    issues.sort(key=lambda i: i.t0 if i.t0 is not None else i.t)
    return Diagnosis(
        segments=_segments(t_close, t_open, end),
        issues=issues,
        repairs=repairs,
        decision="repair" if issues else "keep",
        label=task_text,
    )
