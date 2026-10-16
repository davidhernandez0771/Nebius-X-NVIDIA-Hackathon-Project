"""Refiner: snap a diagnosis' stillness times to the per-step data.

Nemotron reads 0.5 s metrics windows, so its pause and idle times are window-aligned (T4
measured this). The rules detector's still detection knows where the hand really stopped, so
each pause, idle_start_end, remove_pause and trim moves onto that stillness; one that matches no
real stillness is dropped. Every other issue and op passes through unchanged.
"""

from __future__ import annotations

import numpy as np

from . import rules
from .measure import gripper_events
from .schemas import Diagnosis, Issue, Trajectory

_TOL = 1e-9
Span = tuple[float, float]


class _Stillness:
    """Where the hand is really still, in the rules detector's terms."""

    def __init__(self, traj: Trajectory) -> None:
        t, g = np.asarray(traj.t), np.asarray(traj.gripper)
        n = len(t)
        self.start, self.end = float(t[0]), float(t[-1])
        long = [r for r in rules.still_runs(traj) if r[3] - r[2] >= rules.MIN_STILL_S - _TOL]
        # a pause is an interior still run with the gripper unchanged; a hold while it acts is not one
        self.pauses: list[Span] = [(f, u) for a, b, f, u in long
                                   if a > 0 and b < n - 1 and np.all(g[a - 1 : b + 1] == g[a - 1])]
        t_close, t_open = gripper_events(traj)
        self.keep_from, self.keep_to = self.start, self.end  # the active range, as the rules would trim it
        for a, b, f, u in long:
            if a == 0:
                kf = u if t_close is None else min(u, t_close)
                if kf - self.start >= rules.MIN_STILL_S - _TOL:
                    self.keep_from = kf
            elif b == n - 1:
                kt = f if t_open is None else max(f, min(t_open + rules.RELEASE_MARGIN_S, self.end))
                if self.end - kt >= rules.MIN_STILL_S - _TOL:
                    self.keep_to = kt
        self.idle: list[Span] = []
        if self.keep_from > self.start:
            self.idle.append((self.start, self.keep_from))
        if self.keep_to < self.end:
            self.idle.append((self.keep_to, self.end))


def _snap(t0: float, t1: float, candidates: list[Span]) -> Span | None:
    """The candidate overlapping [t0, t1] the most (a point t0 == t1 must lie inside one), else None."""
    best, best_overlap = None, -_TOL if t0 == t1 else _TOL
    for c0, c1 in candidates:
        overlap = min(t1, c1) - max(t0, c0)
        if overlap > best_overlap:
            best, best_overlap = (c0, c1), overlap
    return best


def _snap_trim(t0: float, t1: float, still: _Stillness) -> Span | None:
    """Move the trim's edges onto the idle edges; None if it would no longer trim anything."""
    keep_from = still.keep_from if t0 > still.start + _TOL else still.start
    keep_to = still.keep_to if t1 < still.end - _TOL else still.end
    if (keep_from, keep_to) == (still.start, still.end):
        return None
    return keep_from, keep_to


def _range(item) -> Span:
    return (item.t, item.t) if item.t0 is None else (item.t0, item.t1)


def refine_diagnosis(diag: Diagnosis, traj: Trajectory) -> Diagnosis:
    still = _Stillness(traj)
    candidates = {"pause": still.pauses, "idle_start_end": still.idle}

    issues, seen = [], set()
    for issue in diag.issues:
        if issue.type in candidates:
            span = _snap(*_range(issue), candidates[issue.type])
            if span is None or (issue.type, span) in seen:
                continue
            seen.add((issue.type, span))
            issue = Issue(**{**issue.model_dump(), "t": None, "t0": span[0], "t1": span[1]})
        issues.append(issue)

    repairs = []
    for op in diag.repairs:
        if op.op in ("remove_pause", "trim"):
            span = _snap(op.t0, op.t1, still.pauses) if op.op == "remove_pause" else _snap_trim(op.t0, op.t1, still)
            if span is None or (op.op, span) in seen:
                continue
            seen.add((op.op, span))
            op = type(op)(**{**op.model_dump(), "t0": span[0], "t1": span[1]})
        repairs.append(op)

    decision = "keep" if diag.decision == "repair" and not repairs else diag.decision
    return Diagnosis(segments=diag.segments, issues=issues, repairs=repairs, decision=decision, label=diag.label)
