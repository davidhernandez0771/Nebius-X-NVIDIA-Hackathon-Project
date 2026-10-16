"""Degrader: turn a clean demo into a webcam-like human demo, with ground truth for scoring.

Order: the grasp offset is applied on the clean timeline; one time warp then adds the idle
start/end, the pauses and the slow factor; tremor-like jitter goes on last, on the degraded
timeline (webcam noise is in real time, and it is everywhere, holds included).

Every returned InjectedIssue time is on the degraded timeline, which starts at 0 on a 50 Hz grid.
"""

from __future__ import annotations

import math

import numpy as np
from pydantic import Field, model_validator

from .multiply import LIFT_S
from .repair import DT, _sample
from .schemas import IssueType, Trajectory, _Model

PAUSE_RAMP_S = 0.2  # the hand slows to a stop (and starts again) over this long, like a person
PAUSE_EVENT_MARGIN_S = 0.3  # a pause, ramps included, stays this far from start, end and gripper events
PAUSE_GAP_S = 1.0  # source-time spacing between two pauses, so they never merge
PAUSE_MIN_SPEED = 0.05  # m/s; a pause only starts where the hand is visibly moving
TREMOR_HZ = 6.0  # jitter is low-passed here (-3 dB), so it looks like hand tremor
OFFSET_RAMP_S = 1.0  # after the lift, the grasp offset fades out over this long (min-jerk)
EXPERT_STOP_SPEED = 0.03  # m/s; the clean expert slows below this at its waypoints (any still threshold is lower)
EXPERT_STOP_MIN_S = 0.1  # shorter dips are not worth reporting


class InjectedIssue(_Model):
    """One ground-truth issue. A point issue (grasp_off_center) has t0 == t1.

    dont_care marks the clean expert's own stop at a waypoint (degrade(..., expert_stops=True)):
    not injected, so missing it is no miss, but a real stop, so flagging it is no false alarm.
    """

    type: IssueType
    t0: float = Field(ge=0)
    t1: float
    dont_care: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> "InjectedIssue":
        if self.t1 < self.t0:
            raise ValueError("t1 must be >= t0")
        return self


def _min_jerk(s: np.ndarray) -> np.ndarray:
    return 10 * s**3 - 15 * s**4 + 6 * s**5


def _offset_grasp(a: dict, mm: float, rng: np.random.Generator) -> None:
    """Shift the approach, grasp and lift by mm in a random xy direction (in place), then fade out."""
    t, g = a["t"], a["gripper"]
    closed = np.flatnonzero(g == 1)
    if closed.size == 0:
        raise ValueError("degrade: the demo never closes the gripper, so there is no grasp to offset")
    angle = rng.uniform(0.0, 2 * math.pi)
    off = mm / 1000.0 * np.array([math.cos(angle), math.sin(angle)])
    fade = _min_jerk(np.clip((t - (t[closed[0]] + LIFT_S)) / OFFSET_RAMP_S, 0.0, 1.0))
    a["ee_pos"][:, :2] += (1.0 - fade)[:, None] * off


def _place_pauses(a: dict, n: int, pause_s: tuple[float, float], r0: float,
                  rng: np.random.Generator) -> list[tuple[float, float]]:
    """(source time, hold seconds) for each pause, sorted by time."""
    t, g = a["t"], a["gripper"]
    half = r0 * PAUSE_RAMP_S / 2  # source time one ramp consumes
    margin = half + r0 * PAUSE_EVENT_MARGIN_S
    speed = np.concatenate([[0.0], np.linalg.norm(np.diff(a["ee_pos"], axis=0), axis=1) / np.diff(t)])
    ok = (speed >= PAUSE_MIN_SPEED) & (t >= t[0] + margin) & (t <= t[-1] - margin)
    for e in t[1:][g[1:] != g[:-1]]:
        ok &= np.abs(t - e) >= margin
    pauses = []
    for _ in range(n):
        cands = np.flatnonzero(ok)
        if cands.size == 0:
            raise ValueError(f"degrade: no room for {n} pauses in a {t[-1] - t[0]:.2f} s demo")
        s_p = float(t[rng.choice(cands)])
        pauses.append((s_p, float(rng.uniform(*pause_s))))
        ok &= np.abs(t - s_p) >= PAUSE_GAP_S
    return sorted(pauses)


def _warp(t_src: np.ndarray, pauses, r0: float, idle_start: float, idle_end: float):
    """Source time at each degraded 50 Hz step, plus the degraded [t0, t1] of every hold kind."""
    R = PAUSE_RAMP_S
    half = r0 * R / 2
    pieces: list[tuple[str, float, float]] = []  # (kind, degraded duration, source time at its start)
    holds: list[tuple[str, int]] = []  # (issue type, index into pieces)

    def add(kind: str, dur: float, s0: float, issue: str | None = None) -> None:
        if dur > 1e-12:
            if issue:
                holds.append((issue, len(pieces)))
            pieces.append((kind, dur, s0))

    s = float(t_src[0])
    add("hold", idle_start, s, "idle_start_end")
    for s_p, d in pauses:
        add("cruise", (s_p - half - s) / r0, s)
        add("decel", R, s_p - half)
        add("hold", d, s_p, "pause")
        add("accel", R, s_p)
        s = s_p + half
    add("cruise", (float(t_src[-1]) - s) / r0, s)
    add("hold", idle_end, float(t_src[-1]), "idle_start_end")

    starts = np.concatenate([[0.0], np.cumsum([p[1] for p in pieces])])
    total = float(starts[-1])
    grid = np.arange(int(math.ceil(total / DT - 1e-6)) + 1) * DT
    k = np.clip(np.searchsorted(starts, grid, side="right") - 1, 0, len(pieces) - 1)
    s_out = np.empty_like(grid)
    for j, (kind, dur, s0) in enumerate(pieces):
        m = k == j
        tau = np.minimum(grid[m] - starts[j], dur)
        wave = R / (2 * math.pi) * np.sin(math.pi * tau / R)
        s_out[m] = {
            "hold": lambda: np.full_like(tau, s0),
            "cruise": lambda: s0 + r0 * tau,
            "decel": lambda: s0 + r0 * (0.5 * tau + wave),
            "accel": lambda: s0 + r0 * (0.5 * tau - wave),
        }[kind]()
    s_out = np.clip(s_out, t_src[0], t_src[-1])
    spans = [(issue, float(starts[j]), min(float(starts[j + 1]), float(grid[-1]))) for issue, j in holds]
    if idle_end > 1e-12:  # the grid may run a few ms past the last piece; the idle end includes that
        spans[-1] = (spans[-1][0], spans[-1][1], float(grid[-1]))
    return grid, s_out, spans


def _expert_stops(t: np.ndarray, pos: np.ndarray, grip: np.ndarray,
                  held: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Interior spans where the noise-free hand moves slower than EXPERT_STOP_SPEED for at least
    EXPERT_STOP_MIN_S with the gripper unchanged, outside the injected holds (pauses, idle).

    Spans follow the rules' convention: still steps a..b mean "still from t[a-1] to t[b]".
    """
    step = np.linalg.norm(np.diff(pos, axis=0), axis=1) / np.diff(t)
    still = np.concatenate([step[:1], step]) < EXPERT_STOP_SPEED
    for h0, h1 in held:
        still &= ~((t > h0 + 1e-9) & (t <= h1 + 1e-9))
    n, spans, i = len(t), [], 0
    while i < n:
        if not still[i]:
            i += 1
            continue
        a = i
        while i < n and still[i]:
            i += 1
        b = i - 1
        if a > 0 and b < n - 1 and t[b] - t[a - 1] >= EXPERT_STOP_MIN_S - 1e-9 and np.all(grip[a - 1 : b + 1] == grip[a - 1]):
            spans.append((float(t[a - 1]), float(t[b])))
    return spans


def _tremor(n: int, mm: float, rng: np.random.Generator) -> np.ndarray:
    """[n, 3] zero-mean Gaussian noise, low-passed at TREMOR_HZ, with std mm/1000 per axis."""
    sigma = math.sqrt(math.log(2)) / (2 * math.pi * TREMOR_HZ)  # Gaussian kernel with -3 dB at TREMOR_HZ
    half = int(math.ceil(4 * sigma / DT))
    kern = np.exp(-0.5 * (np.arange(-half, half + 1) * DT / sigma) ** 2)
    kern /= kern.sum()
    raw = rng.standard_normal((n + 2 * half, 3))
    noise = np.stack([np.convolve(raw[:, k], kern, mode="valid") for k in range(3)], axis=1)
    noise -= noise.mean(axis=0)
    return noise / noise.std(axis=0) * (mm / 1000.0)


def degrade(
    traj: Trajectory,
    rng: np.random.Generator,
    *,
    n_pauses: int = 1,
    pause_s: tuple[float, float] = (0.5, 1.2),
    jitter_mm: float = 2.0,
    grasp_offset_mm: float = 8.0,
    slow_factor: float = 1.0,
    idle_start_s: float = 0.0,
    idle_end_s: float = 0.0,
    expert_stops: bool = False,
) -> tuple[Trajectory, list[InjectedIssue]]:
    """A webcam-like copy of a clean demo, and the issues injected into it (degraded-timeline times).

    expert_stops=True also returns the clean expert's own waypoint stops as dont_care pauses, found
    on the path before the tremor is added (for honest scoring; off by default, so the list is
    exactly what was injected).
    """
    if slow_factor <= 0:
        raise ValueError(f"slow_factor must be > 0, got {slow_factor}")
    if not 0 < pause_s[0] <= pause_s[1]:
        raise ValueError(f"pause_s must be 0 < low <= high, got {pause_s}")
    a = traj.to_arrays()
    a["ee_pos"] = a["ee_pos"].copy()
    if grasp_offset_mm > 0:
        _offset_grasp(a, grasp_offset_mm, rng)
    r0 = 1.0 / slow_factor
    pauses = _place_pauses(a, n_pauses, pause_s, r0, rng) if n_pauses > 0 else []
    grid, s, spans = _warp(a["t"], pauses, r0, idle_start_s, idle_end_s)
    out = _sample(a, s)
    pos = out["ee_pos"]
    if jitter_mm > 0:
        pos = pos + _tremor(len(grid), jitter_mm, rng)
    result = Trajectory.from_arrays(grid, pos, out["ee_quat"], out["gripper"])

    end = float(grid[-1])
    issues = [InjectedIssue(type=kind, t0=t0, t1=t1) for kind, t0, t1 in spans]
    if grasp_offset_mm > 0:
        t_close = float(grid[int(np.argmax(out["gripper"] == 1))])
        issues.append(InjectedIssue(type="grasp_off_center", t0=t_close, t1=t_close))
    if slow_factor > 1:
        issues.append(InjectedIssue(type="slow", t0=0.0, t1=end))
    if jitter_mm > 0:
        issues.append(InjectedIssue(type="jitter", t0=0.0, t1=end))
    if expert_stops:
        held = [(t0, t1) for _, t0, t1 in spans]
        issues += [InjectedIssue(type="pause", t0=t0, t1=t1, dont_care=True)
                   for t0, t1 in _expert_stops(grid, out["ee_pos"], out["gripper"], held)]
    issues.sort(key=lambda i: (i.t0, i.t1))
    return result, issues
