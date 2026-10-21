"""A small, strict trajectory edit language (what Nemotron writes to repair a demo) and apply_edits, its pure
interpreter with the safety rules in code.

The edits, all times in seconds on the ORIGINAL demo's timeline (t = 0 at its first step), positions in metres in the
world frame (the tool point = the fingertip centre; a held cube's centre sits about there):
  shift_segment(t0, t1, dx, dy, dz)  move every step in [t0, t1] by (dx, dy, dz), blending in before t0, out after t1
  move_point(t, x, y, z)             make the tool pass through (x, y, z) at t, blending in and out around t
  insert_waypoints(t0, t1, points)   re-route [t0, t1] through points [{t, x, y, z}] (t0 < t < t1, in order)
  set_gripper(t, state)              the gripper switches to state ("open" | "closed") at t: if it is not in that state
                                     at t, the next switch to it moves back to t (none: one is added, held until the
                                     next switch); if it is, the switch that put it there moves forward to t
  retime(t0, t1, factor)             [t0, t1] lasts factor times as long (> 1 slower, < 1 faster)
  cut(t0, t1)                        remove [t0, t1] (no gripper switch inside) and stitch the ends smoothly

apply_edits regrids the demo to 50 Hz, applies the path and gripper edits in list order (each sees the path the
earlier ones left), then the timing edits in list order (their times mapped through the earlier timing edits, as
repair.apply_repairs does), and checks the result. Every output step keeps its source time on the original
timeline, so "moved" is the distance from where the original demo had the tool at that moment. The rules:
  - repair budget: no step moves more than REPAIR_BUDGET_M (5 cm), whatever the edits add up to;
  - workspace: every moved step stays inside WORKSPACE;
  - smoothness: blends are min-jerk (quintic) ramps sized so the edit alone peaks at EDIT_JERK_PEAK; the edit field
    (new path - original at the source time) must keep jerk_rms under EDIT_JERK_LIMIT in every 0.5 s window (half the
    rules' jitter limit, so an edit never makes a jitter window on its own), and the tremor-free path (Gaussian
    TREMOR_SIGMA_S) must stay under the jitter limit, or no worse than the original's worst window (catches cuts in
    mid-motion and fast retimes), or no worse than the original's worst window plus EDIT_JERK_LIMIT.
Any problem raises EditError with every problem as a readable line (fed back to the model as is).
"""

from __future__ import annotations

import math
from typing import Annotated, Literal, Union

import numpy as np
from pydantic import Field, TypeAdapter, model_validator

from .measure import _smooth_positions
from .repair import DT, _regrid, _sample
from .rules import JITTER_MIN_JERK
from .schemas import Trajectory, _Model

REPAIR_BUDGET_M = 0.05  # no step of the repaired demo is more than this from the original at the same moment
WORKSPACE = {"x": (0.20, 0.80), "y": (-0.45, 0.45), "z": (0.01, 0.50)}  # m, Franka on the 0.85 x 1.2 m table, top z = 0
MOVED_M = 0.001  # a step counts as moved (and is held to WORKSPACE) above this
EDIT_JERK_PEAK = 10.0  # m/s^3: blends are sized so one edit's own jerk peaks here
EDIT_JERK_LIMIT = JITTER_MIN_JERK / 2  # m/s^3, per 0.5 s window of the edit field
MIN_BLEND_S = 0.25  # the shortest blend, even for a tiny move
TREMOR_SIGMA_S = 0.1  # the tremor-free path for the smoothness check
WINDOW_S = 0.5  # as measure.compute_windows
RETIME_FACTOR = (0.5, 3.0)
RETIME_BLEND_S = 0.3  # the speed change ramps over this (or a third of a short span) at each end of a retime
MAX_EDITS = 8
_TOL = 1e-9


class EditError(ValueError):
    """The edits break a rule; .errors holds one readable line per problem."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


# --- the language ---------------------------------------------------------------------------------

_Time = Annotated[float, Field(ge=0, allow_inf_nan=False)]
_Coord = Annotated[float, Field(allow_inf_nan=False)]
_Delta = Annotated[float, Field(ge=-REPAIR_BUDGET_M, le=REPAIR_BUDGET_M, allow_inf_nan=False)]


class _Span(_Model):
    t0: _Time
    t1: _Time

    @model_validator(mode="after")
    def _ordered(self):
        if self.t1 <= self.t0:
            raise ValueError("t1 must be greater than t0")
        return self


class ShiftSegment(_Span):
    op: Literal["shift_segment"]
    dx: _Delta = 0.0
    dy: _Delta = 0.0
    dz: _Delta = 0.0


class MovePoint(_Model):
    op: Literal["move_point"]
    t: _Time
    x: _Coord
    y: _Coord
    z: _Coord


class Waypoint(_Model):
    t: _Time
    x: _Coord
    y: _Coord
    z: _Coord


class InsertWaypoints(_Span):
    op: Literal["insert_waypoints"]
    points: list[Waypoint] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def _inside(self):
        ts = [self.t0, *(p.t for p in self.points), self.t1]
        if any(b <= a for a, b in zip(ts, ts[1:])):
            raise ValueError("points need t0 < t < t1, in increasing t")
        return self


class SetGripper(_Model):
    op: Literal["set_gripper"]
    t: _Time
    state: Literal["open", "closed"]


class Retime(_Span):
    op: Literal["retime"]
    factor: float = Field(ge=RETIME_FACTOR[0], le=RETIME_FACTOR[1], allow_inf_nan=False)


class Cut(_Span):
    op: Literal["cut"]


Edit = Annotated[
    Union[ShiftSegment, MovePoint, InsertWaypoints, SetGripper, Retime, Cut],
    Field(discriminator="op"),
]
PATH_OPS = ("shift_segment", "move_point", "insert_waypoints", "set_gripper")
TIMING_OPS = ("retime", "cut")


class EditPlan(_Model):
    edits: list[Edit] = Field(max_length=MAX_EDITS)  # [] means "no edit can fix this demo"
    why: str = Field(default="", max_length=1000)


EDITS = TypeAdapter(list[Edit])


class TimingChange(_Model):
    op: Literal["retime", "cut"]
    t0: float  # original timeline
    t1: float
    before_s: float
    after_s: float


class GripperChange(_Model):
    t: float  # original timeline
    state: Literal["open", "closed"]
    moved_from: float | None  # the switch it moved, or None when one was added


class EditReport(_Model):
    """What changed, for the prompt, the notes and the UI."""

    n_edits: int
    max_moved_cm: float
    mean_moved_cm: float  # over every step
    moved_steps: int  # steps moved more than MOVED_M
    max_moved_at: float | None  # original-timeline time of the largest move
    duration_before_s: float
    duration_after_s: float
    timing: list[TimingChange] = Field(default_factory=list)
    gripper: list[GripperChange] = Field(default_factory=list)

    def text(self) -> str:
        parts = [f"moved up to {self.max_moved_cm:.1f} cm (mean {self.mean_moved_cm:.2f} cm, "
                 f"{self.moved_steps} steps over {MOVED_M * 1000:.0f} mm)",
                 f"duration {self.duration_before_s:.2f} s -> {self.duration_after_s:.2f} s"]
        parts += [f"{c.op} [{c.t0:.2f}, {c.t1:.2f}] {c.before_s:.2f} s -> {c.after_s:.2f} s" for c in self.timing]
        parts += [f"gripper {c.state} at {c.t:.2f}" + (f" (was {c.moved_from:.2f})" if c.moved_from is not None
                                                        else " (added)") for c in self.gripper]
        return "; ".join(parts)


class EditResult(_Model):
    trajectory: Trajectory
    report: EditReport
    source_t: list[float]  # per output step, its time on the original timeline


# --- helpers ------------------------------------------------------------------------------------

def _smoothstep(u: np.ndarray) -> np.ndarray:
    """Quintic min-jerk ramp 0 -> 1 on [0, 1], flat (zero velocity and acceleration) at both ends."""
    u = np.clip(u, 0.0, 1.0)
    return u ** 3 * (10 - 15 * u + 6 * u ** 2)


def blend_s(distance: float) -> float:
    """How long a quintic ramp must be for a move of `distance` m to peak at EDIT_JERK_PEAK (peak jerk = 60 d / T^3)."""
    return max(MIN_BLEND_S, (60.0 * distance / EDIT_JERK_PEAK) ** (1 / 3))


def _at(t: np.ndarray, values: np.ndarray, x: float) -> np.ndarray:
    return np.array([np.interp(x, t, values[:, k]) for k in range(values.shape[1])])


def _window_jerk(t: np.ndarray, pos: np.ndarray) -> list[tuple[float, float, float]]:
    """(t0, t1, jerk_rms) per WINDOW_S window, as measure.compute_windows splits them."""
    d = pos
    for _ in range(3):
        d = np.gradient(d, t, axis=0)
    jerk = np.linalg.norm(d, axis=1)
    n_windows = max(1, math.ceil((t[-1] - t[0] - _TOL) / WINDOW_S))
    idx = np.minimum(np.floor((t - t[0]) / WINDOW_S + _TOL).astype(int), n_windows - 1)
    out = []
    for k in range(n_windows):
        m = idx == k
        if m.any():
            out.append((t[0] + k * WINDOW_S, min(t[0] + (k + 1) * WINDOW_S, t[-1]), float(np.sqrt(np.mean(jerk[m] ** 2)))))
    return out


def _resample(a: dict, s: np.ndarray) -> dict:
    """The working arrays sampled at current-timeline times s (pos/quat/gripper as repair._sample; the rest linear)."""
    out = _sample({"t": a["t"], "ee_pos": a["pos"], "ee_quat": a["quat"], "gripper": a["grip"]}, s)
    t = a["t"]
    s = np.clip(s, t[0], t[-1])
    return {"t": np.arange(len(s)) * DT, "pos": out["ee_pos"], "quat": out["ee_quat"], "grip": out["gripper"],
            "src": np.interp(s, t, a["src"]),
            "smooth": np.stack([np.interp(s, t, a["smooth"][:, k]) for k in range(3)], axis=1)}


# --- the edits ----------------------------------------------------------------------------------
# Path edits work on the original timeline (no timing edit has run yet): each adds a displacement field to "pos" and
# "smooth" alike, so the tremor-free copy sees the same edit.

def _add(a: dict, disp: np.ndarray) -> None:
    a["pos"] = a["pos"] + disp
    a["smooth"] = a["smooth"] + disp


def _shift_segment(a: dict, e: ShiftSegment) -> None:
    t, d = a["t"], np.array([e.dx, e.dy, e.dz])
    r = blend_s(float(np.linalg.norm(d)))
    w = _smoothstep((t - (e.t0 - r)) / r) * _smoothstep(((e.t1 + r) - t) / r)
    _add(a, w[:, None] * d)


def _move_point(a: dict, e: MovePoint) -> None:
    t = a["t"]
    d = np.array([e.x, e.y, e.z]) - _at(t, a["pos"], e.t)
    r = blend_s(float(np.linalg.norm(d)))
    w = np.where(t <= e.t, _smoothstep((t - (e.t - r)) / r), _smoothstep(((e.t + r) - t) / r))
    _add(a, w[:, None] * d)


def _insert_waypoints(a: dict, e: InsertWaypoints) -> None:
    t = a["t"]
    knots = [e.t0, *(p.t for p in e.points), e.t1]
    deltas = [np.zeros(3), *(np.array([p.x, p.y, p.z]) - _at(t, a["pos"], p.t) for p in e.points), np.zeros(3)]
    disp = np.zeros_like(a["pos"])
    for (ka, kb), (da, db) in zip(zip(knots, knots[1:]), zip(deltas, deltas[1:])):
        m = (t >= ka) & (t <= kb)
        disp[m] = da + _smoothstep((t[m] - ka) / (kb - ka))[:, None] * (db - da)
    _add(a, disp)


def _set_gripper(a: dict, e: SetGripper, errors: list[str]) -> GripperChange | None:
    """Not in `state` at t: the next switch to it moves back to t (none: one is added, held until the next switch).
    Already in `state` at t: the switch that put it there moves forward to t. The gripper is binary, so a move never
    crosses another switch."""
    g, t = a["grip"], a["t"]
    v = 1 if e.state == "closed" else 0
    k = int(np.clip(round(e.t / DT), 0, len(t) - 1))
    switches = np.flatnonzero((g[1:] == v) & (g[:-1] != v)) + 1
    if g[k] != v:
        after = switches[switches > k]
        if after.size:
            ks = int(after[0])
            g[k:ks] = v
            return GripperChange(t=float(t[k]), state=e.state, moved_from=float(t[ks]))
        later = np.flatnonzero(g[k:] != g[k])
        g[k : k + int(later[0]) if later.size else len(g)] = v
        return GripperChange(t=float(t[k]), state=e.state, moved_from=None)
    before = switches[switches <= k]
    if before.size and int(before[-1]) == k:  # the switch is already at t: nothing to move
        return None
    if before.size == 0:
        errors.append(f"set_gripper({e.t:.2f}, {e.state}): the gripper is already {e.state} at {e.t:.2f} s")
        return None
    ks = int(before[-1])
    g[ks:k] = 1 - v
    return GripperChange(t=float(t[k]), state=e.state, moved_from=float(t[ks]))


def _retime(a: dict, t0: float, t1: float, factor: float) -> tuple[dict, callable]:
    t = a["t"]
    ramp = min(RETIME_BLEND_S, (t1 - t0) / 3)
    fine = np.linspace(t[0], t[-1], 20 * (len(t) - 1) + 1)
    inside = _smoothstep((fine - t0) / ramp) * _smoothstep((t1 - fine) / ramp)
    rate = 1.0 + (factor - 1.0) * inside  # d(new time) / d(old time)
    tau = np.concatenate([[0.0], np.cumsum((rate[1:] + rate[:-1]) / 2 * np.diff(fine))])
    new_t = np.arange(int(math.floor(tau[-1] / DT + 1e-6)) + 1) * DT
    out = _resample(a, np.interp(new_t, tau, fine))
    return out, lambda x: np.interp(np.asarray(x, dtype=np.float64), fine, tau)


def _cut(a: dict, t0: float, t1: float) -> tuple[dict, callable]:
    t = a["t"]
    i0, i1 = int(round(t0 / DT)), int(round(t1 / DT))
    keep = np.r_[np.arange(i0), np.arange(i1, len(t))]
    out = {k: v[keep] for k, v in a.items()}
    out["t"] = np.arange(len(keep)) * DT
    gap = a["pos"][i1] - a["pos"][i0]  # the jump the cut leaves, shared by both sides of the joint
    r = blend_s(float(np.linalg.norm(gap)) / 2)
    tj = i0 * DT  # the joint: the first kept step after the cut
    w = np.where(out["t"] < tj, 0.5 * _smoothstep((out["t"] - (tj - r)) / r),
                 -0.5 * _smoothstep(((tj + r) - out["t"]) / r))
    _add(out, w[:, None] * gap)
    cut_len = (i1 - i0) * DT
    return out, lambda x: np.where(np.asarray(x) < t0, x, np.where(np.asarray(x) > t1, np.asarray(x) - cut_len, t0))


# --- apply ----------------------------------------------------------------------------------------

def parse_edits(edits) -> list:
    """An EditPlan, a list of edit models, or plain dicts -> edit models (pydantic errors as EditError)."""
    if isinstance(edits, EditPlan):
        return list(edits.edits)
    try:
        return EDITS.validate_python(list(edits))
    except Exception as e:  # pydantic.ValidationError
        raise EditError([str(e)]) from e


def _check_times(edits: list, duration: float, errors: list[str]) -> None:
    for e in edits:
        times = [v for v in (getattr(e, k, None) for k in ("t", "t0", "t1")) if v is not None]
        times += [p.t for p in getattr(e, "points", [])]
        if any(v > duration + _TOL for v in times):
            errors.append(f"{e.op}: a time is past the demo's end ({duration:.2f} s)")
    timing = sorted((e for e in edits if e.op in TIMING_OPS), key=lambda e: e.t0)
    for x, y in zip(timing, timing[1:]):
        if y.t0 < x.t1 - _TOL:
            errors.append(f"{x.op} [{x.t0:.2f}, {x.t1:.2f}] and {y.op} [{y.t0:.2f}, {y.t1:.2f}] overlap; "
                          "timing edits must not")


def apply_edits(trajectory: Trajectory, edits, *, budget_m: float = REPAIR_BUDGET_M) -> EditResult:
    """Apply the edits (see the module docstring) and check the result; raises EditError listing every problem."""
    edits = parse_edits(edits)
    orig = _regrid(trajectory).to_arrays()
    t_orig, p_orig = orig["t"], orig["ee_pos"]
    duration = float(t_orig[-1])
    errors: list[str] = []
    _check_times(edits, duration, errors)
    if errors:
        raise EditError(errors)

    sigma_steps = TREMOR_SIGMA_S / DT
    a = {"t": t_orig.copy(), "pos": p_orig.copy(), "quat": orig["ee_quat"].copy(), "grip": orig["gripper"].copy(),
         "src": t_orig.copy(), "smooth": _smooth_positions(p_orig, sigma_steps)}
    smooth_orig = a["smooth"].copy()
    gripper_changes: list[GripperChange] = []
    for e in (e for e in edits if e.op in PATH_OPS):
        if e.op == "shift_segment":
            _shift_segment(a, e)
        elif e.op == "move_point":
            _move_point(a, e)
        elif e.op == "insert_waypoints":
            _insert_waypoints(a, e)
        else:
            change = _set_gripper(a, e, errors)
            if change is not None:
                gripper_changes.append(change)

    tmap = lambda x: np.asarray(x, dtype=np.float64)  # noqa: E731  original -> current time
    timing: list[TimingChange] = []
    for e in (e for e in edits if e.op in TIMING_OPS):
        t0, t1 = (float(v) for v in tmap([e.t0, e.t1]))
        before = len(a["t"])
        if e.op == "cut":
            i0, i1 = int(round(t0 / DT)), int(round(t1 / DT))
            if np.any(a["grip"][i0 : i1 + 1] != a["grip"][i0]):
                errors.append(f"cut [{e.t0:.2f}, {e.t1:.2f}]: the gripper switches inside; a cut must not remove "
                              "a grasp or a release (use set_gripper)")
                continue
            if i1 - i0 < 1 or i1 >= before - 1:
                errors.append(f"cut [{e.t0:.2f}, {e.t1:.2f}]: too short, or it reaches the demo's last step")
                continue
            a, step_map = _cut(a, t0, t1)
        else:
            a, step_map = _retime(a, t0, t1, e.factor)
        timing.append(TimingChange(op=e.op, t0=e.t0, t1=e.t1, before_s=t1 - t0,
                                   after_s=float(step_map(t1) - step_map(t0)) if e.op == "retime" else 0.0))
        tmap = (lambda f, g: lambda x: f(g(x)))(step_map, tmap)

    # --- the rules ---
    src = a["src"]
    base = np.stack([np.interp(src, t_orig, p_orig[:, k]) for k in range(3)], axis=1)
    field = a["pos"] - base
    moved = np.linalg.norm(field, axis=1)
    if moved.max() > budget_m + 1e-6:
        over = src[moved > budget_m + 1e-6]
        errors.append(f"over the repair budget: a step moves {moved.max() * 100:.1f} cm (max {budget_m * 100:.0f} cm "
                      f"per step) between t = {over.min():.2f} and {over.max():.2f} s")
    lo = np.array([WORKSPACE[k][0] for k in "xyz"])
    hi = np.array([WORKSPACE[k][1] for k in "xyz"])
    out_of = (moved > MOVED_M) & np.any((a["pos"] < lo - _TOL) | (a["pos"] > hi + _TOL), axis=1)
    if out_of.any():
        k = int(np.flatnonzero(out_of)[0])
        errors.append(f"outside the workspace (x {WORKSPACE['x']}, y {WORKSPACE['y']}, z {WORKSPACE['z']} m): "
                      f"the tool goes to {np.round(a['pos'][k], 3).tolist()} at t = {src[k]:.2f} s")
    t_new = a["t"]
    if len(t_new) >= 4:
        for w0, w1, j in _window_jerk(t_new, field):
            if j > EDIT_JERK_LIMIT:
                errors.append(f"not smooth: the edits add jerk_rms {j:.0f} m/s^3 around t = "
                              f"{float(np.interp(w0, t_new, src)):.2f}-{float(np.interp(w1, t_new, src)):.2f} s "
                              f"(limit {EDIT_JERK_LIMIT:g}); spread the change over more time or make it smaller")
                break
        # an edit may add EDIT_JERK_LIMIT on top of the demo's own worst window (check A grants it the same)
        worst = max(JITTER_MIN_JERK, max(j for _, _, j in _window_jerk(t_orig, smooth_orig))) + EDIT_JERK_LIMIT
        for w0, w1, j in _window_jerk(t_new, a["smooth"]):
            if j > worst + _TOL:
                errors.append(f"not smooth: the motion's jerk_rms reaches {j:.0f} m/s^3 around t = "
                              f"{float(np.interp(w0, t_new, src)):.2f}-{float(np.interp(w1, t_new, src)):.2f} s "
                              f"(the limit here is {worst:.0f}); cut only where the tool is still, and retime "
                              "less")
                break
    else:
        errors.append("the result has fewer than 4 steps")
    if errors:
        raise EditError(errors)

    k_max = int(np.argmax(moved))
    report = EditReport(
        n_edits=len(edits), max_moved_cm=float(moved.max() * 100), mean_moved_cm=float(moved.mean() * 100),
        moved_steps=int((moved > MOVED_M).sum()), max_moved_at=float(src[k_max]) if moved.max() > MOVED_M else None,
        duration_before_s=duration, duration_after_s=float(t_new[-1]), timing=timing, gripper=gripper_changes)
    traj = Trajectory.from_arrays(t_new, a["pos"], a["quat"] / np.linalg.norm(a["quat"], axis=1, keepdims=True),
                                  a["grip"])
    return EditResult(trajectory=traj, report=report, source_t=src.tolist())
