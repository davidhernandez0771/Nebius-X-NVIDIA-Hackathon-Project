"""Rules detector (spec 8.4): code-only diagnosis, the baseline Nemotron is compared against.

It only finds timing/smoothness problems (pause, jitter, idle_start_end). It never emits the
semantic issues (grasp_off_center, wrong_object, rim_contact, bad_release); that gap is what
the ablation measures.
"""

from __future__ import annotations

import numpy as np

from .measure import gripper_events, position_noise, smoothed_speed, speed_profile
from .schemas import Diagnosis, Discard, Issue, MetricsWindow, RemovePause, Segment, Smooth, Trajectory, Trim

TASK_TEXT = "pick up the red cube and place it in the blue bin"

STILL_SPEED = 0.01  # m/s; below this the hand counts as still
MIN_STILL_S = 0.4  # a still span this long is a pause (inside) or idle time (at the start or end)
JITTER_MIN_JERK = 20.0  # m/s^3; a window above it is jittery. Smooth min-jerk motion stays under ~5; 0.5 mm tremor exceeds it.
# An absolute limit, not "3x the demo's median window" (spec 8.4): webcam tremor is everywhere, so no
# window stands out from the median and the relative rule found none of it (T1 status note, 2026-10-16).
RELEASE_MARGIN_S = 0.5  # a trim keeps this long after the last open, so the release can finish

# Tremor (webcam noise) keeps the raw speed far above STILL_SPEED, so a noisy demo is judged on a
# smoothed path instead. The values were chosen on the scorer; see the T1 status note (2026-10-16).
NOISE_GATE_M = 0.0002  # position_noise above this means tremor: clean 50 Hz demos <= 0.14 mm, 0.25 mm tremor >= 0.23 mm
STILL_SIGMA_S = 0.2  # Gaussian smoothing of the path for noisy demos
STILL_SPEED_NOISY = 0.02  # m/s on the smoothed path; tremor alone gives p99 0.004 / 0.007 / 0.014 at 1 / 2 / 4 mm
STILL_WIDEN_S = 0.2  # smoothing shrinks a stop by about this much at each moving edge, so the run is widened back
_TOL = 1e-9

StillRun = tuple[int, int, float, float]


def _still_runs(t: np.ndarray, speed: np.ndarray, threshold: float | None = None) -> list[StillRun]:
    """(first index, last index, still-from time, still-until time) for each run of still steps.

    speed[i] is the motion between steps i-1 and i, so a run a..b means the hand was still from t[a-1] to t[b].
    """
    limit = STILL_SPEED if threshold is None else threshold
    runs, i, n = [], 0, len(speed)
    while i < n:
        if speed[i] >= limit:
            i += 1
            continue
        a = i
        while i < n and speed[i] < limit:
            i += 1
        b = i - 1
        runs.append((a, b, float(t[max(a - 1, 0)]), float(t[b])))
    return runs


def still_runs(traj: Trajectory) -> list[StillRun]:
    """Where the hand is still, in the detector's terms (shared with refine).

    A noise-free demo uses the raw speed against STILL_SPEED, exactly as before. A demo with
    tremor (position_noise >= NOISE_GATE_M) uses the speed of a path smoothed by STILL_SIGMA_S
    against STILL_SPEED_NOISY; each run is widened by STILL_WIDEN_S at both edges (clipped to the
    demo), and runs that then touch are merged.
    """
    t = np.asarray(traj.t)
    if position_noise(traj) < NOISE_GATE_M:
        return _still_runs(t, speed_profile(traj))
    n, w = len(t), int(round(STILL_WIDEN_S / float(np.median(np.diff(t)))))
    merged: list[list[int]] = []
    for a, b, _, _ in _still_runs(t, smoothed_speed(traj, STILL_SIGMA_S), STILL_SPEED_NOISY):
        a, b = max(a - w, 0), min(b + w, n - 1)
        if merged and a <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b, float(t[max(a - 1, 0)]), float(t[b])) for a, b in merged]


def _segments(t_close: float, t_open: float | None, end: float) -> list[Segment]:
    bounds = [("approach", 0.0, t_close)]
    if t_open is None:
        bounds.append(("carry", t_close, end))
    else:
        bounds += [("carry", t_close, t_open), ("retreat", t_open, end)]
    return [Segment(name=name, t0=a, t1=b) for name, a, b in bounds if b > a]


def _jitter_spans(windows: list[MetricsWindow]) -> list[tuple[float, float]]:
    """Runs of consecutive windows above JITTER_MIN_JERK, merged into one span each."""
    if not windows:
        return []
    limit = JITTER_MIN_JERK
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
    for a, b, still_from, still_to in still_runs(traj):
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
                            evidence=f"jerk_rms above {JITTER_MIN_JERK:g} m/s^3 over [{t0:.2f}, {t1:.2f}] s"))
        repairs.append(Smooth(op="smooth", t0=t0, t1=t1, strength="med"))

    issues.sort(key=lambda i: i.t0 if i.t0 is not None else i.t)
    return Diagnosis(
        segments=_segments(t_close, t_open, end),
        issues=issues,
        repairs=repairs,
        decision="repair" if issues else "keep",
        label=task_text,
    )
