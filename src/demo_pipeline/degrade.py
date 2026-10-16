"""Degrader: turn a clean demo into a webcam-like human demo, with ground truth for scoring.

Order: a drop or a bad release, then the grasp offset, are applied on the clean timeline; one time
warp then adds the idle start/end, the pauses and the slow factor; tremor-like jitter goes on last,
on the degraded timeline (webcam noise is in real time, and it is everywhere, holds included).

A drop or a bad release needs the Scene (where the bin is). Both are recorded as point issues at
the step the gripper opens; both should fail sim verification (the cube does not end in the bin).

Every returned InjectedIssue time is on the degraded timeline, which starts at 0 on a 50 Hz grid.
"""

from __future__ import annotations

import math

import numpy as np
from pydantic import Field, model_validator

from .multiply import BIN_HALF, CUBE_HALF, CUBE_X, CUBE_Y, LIFT_S, SCENE_RANGES
from .repair import DT, _sample
from .schemas import IssueType, Scene, Trajectory, _Model

PAUSE_RAMP_S = 0.2  # the hand slows to a stop (and starts again) over this long, like a person
PAUSE_EVENT_MARGIN_S = 0.3  # a pause, ramps included, stays this far from start, end and gripper events
PAUSE_GAP_S = 1.0  # source-time spacing between two pauses, so they never merge
PAUSE_MIN_SPEED = 0.05  # m/s; a pause only starts where the hand is visibly moving
TREMOR_HZ = 6.0  # jitter is low-passed here (-3 dB), so it looks like hand tremor
OFFSET_RAMP_S = 1.0  # after the lift, the grasp offset fades out over this long (min-jerk)
EXPERT_STOP_SPEED = 0.03  # m/s; the clean expert slows below this at its waypoints (any still threshold is lower)
EXPERT_STOP_MIN_S = 0.1  # shorter dips are not worth reporting
G = 9.81  # m/s^2
BIN_RIM_Z = 0.09  # m, the bin's top edge (sim_worker.scripted.MIN_LIFT_Z clears it)
CUBE_REACH = CUBE_HALF * math.sqrt(2)  # m, the held cube's half-extent at any yaw
DROP_MIN_GAP = 0.05  # m; a drop happens at least this far (cube to bin footprint) from the bin...
DROP_MIN_HEIGHT = 0.05  # m; ...with the cube's bottom at least this high above the table...
DROP_MIN_SPEED = 0.05  # m/s; ...while the hand is carrying it sideways (not lifting at the cube)
RELEASE_OUTSIDE_GAP = (0.05, 0.08)  # m, cube to bin footprint at a release beside the bin
RELEASE_HIGH_ABOVE_RIM = (0.13, 0.16)  # m, cube bottom above the bin rim at a high release (> 12 cm)
BAD_RELEASES = ("outside", "high")


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


def _bin_gap(xy: np.ndarray, scene: Scene) -> np.ndarray:
    """[N] horizontal gap (m) between the held cube, at any yaw, and the bin's footprint."""
    w, x, y, z = scene.bin_pose.quat_wxyz
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    d = np.atleast_2d(xy)[:, :2] - np.asarray(scene.bin_pose.pos[:2])
    c, s = math.cos(yaw), math.sin(yaw)
    local = np.stack([c * d[:, 0] + s * d[:, 1], -s * d[:, 0] + c * d[:, 1]], axis=1)
    return np.hypot(*np.maximum(np.abs(local) - BIN_HALF - CUBE_REACH, 0.0).T)


def _close_open(g: np.ndarray) -> tuple[int, int]:
    """Indices of the first closed step and of the last close->open step after it."""
    closed = np.flatnonzero(g == 1)
    opens = np.flatnonzero((g[:-1] == 1) & (g[1:] == 0)) + 1
    if closed.size == 0 or opens.size == 0 or opens[-1] <= closed[0]:
        raise ValueError("degrade: the demo needs a grasp and a release for a drop or a bad release")
    return int(closed[0]), int(opens[-1])


def _drop(a: dict, scene: Scene, rng: np.random.Generator) -> None:
    """Open the gripper (in place) at a random carry step where the cube, and where it would land
    (ballistic, ignoring bounces), are DROP_MIN_GAP clear of the bin; it stays open to the end."""
    t, pos, g = a["t"], a["ee_pos"], a["gripper"]
    i_close, i_open = _close_open(g)
    v = np.gradient(pos, t, axis=0)
    h = pos[:, 2] - CUBE_HALF
    fall = np.sqrt(2 * np.maximum(h, 0.0) / G)
    k = np.arange(len(t))
    ok = ((k > i_close) & (k < i_open) & (g == 1) & (h >= DROP_MIN_HEIGHT)
          & (np.hypot(v[:, 0], v[:, 1]) >= DROP_MIN_SPEED) & (_bin_gap(pos, scene) >= DROP_MIN_GAP)
          & (_bin_gap(pos[:, :2] + v[:, :2] * fall[:, None], scene) >= DROP_MIN_GAP))
    cands = np.flatnonzero(ok)
    if cands.size == 0:
        raise ValueError("degrade: no carry step is far enough from the bin for a drop")
    a["gripper"] = g.copy()
    a["gripper"][int(rng.choice(cands)):] = 0


def _carry_progress(pos: np.ndarray, i_close: int, i_open: int) -> np.ndarray:
    """[N] 0 up to the grasp, then the hand's horizontal progress from the grasp to the release, in [0, 1]."""
    g0, r = pos[i_close, :2], pos[i_open, :2]
    chord = r - g0
    if float(chord @ chord) < 1e-6:
        raise ValueError("degrade: the grasp and the release are at the same place; no carry to edit")
    w = np.clip((pos[:, :2] - g0) @ chord / float(chord @ chord), 0.0, 1.0)
    w[: i_close + 1] = 0.0
    w[i_open:] = 1.0
    return w


def _table_box(scene: Scene) -> tuple[tuple[float, float], tuple[float, float]]:
    """x and y ranges covering every cube and bin position the robot's scenes use (all reachable)."""
    r = SCENE_RANGES.get(scene.robot)
    cx, cy, bx, by = (r.cube_x, r.cube_y, r.bin_x, r.bin_y) if r else (CUBE_X, CUBE_Y, CUBE_X, CUBE_Y)
    return (min(cx[0], bx[0]), max(cx[1], bx[1])), (min(cy[0], by[0]), max(cy[1], by[1]))


def _bad_release(a: dict, kind: str, scene: Scene, rng: np.random.Generator) -> None:
    """Move the release (in place): beside the bin ("outside", at the usual height, on the robot's
    usual table area) or high over it ("high"). The edit grows with the carry's progress, so the
    approach and grasp are untouched and the path stays smooth."""
    pos = a["ee_pos"]
    i_close, i_open = _close_open(a["gripper"])
    w = _carry_progress(pos, i_close, i_open)
    if kind == "high":
        z_high = BIN_RIM_Z + CUBE_HALF + float(rng.uniform(*RELEASE_HIGH_ABOVE_RIM))
        pos[:, 2] += w * np.maximum(z_high - pos[:, 2], 0.0)
        return
    rel = pos[i_open, :2]
    gap = float(rng.uniform(*RELEASE_OUTSIDE_GAP))
    (x0, x1), (y0, y1) = _table_box(scene)
    a0 = float(rng.uniform(0.0, 2 * math.pi))
    for angle in a0 + np.arange(36) * (2 * math.pi / 36):
        u = np.array([math.cos(angle), math.sin(angle)])
        step = 0.0
        while _bin_gap(rel + step * u, scene)[0] < gap:  # push out along u until the cube clears the bin
            step += 0.002
        x, y = rel + step * u
        if x0 <= x <= x1 and y0 <= y <= y1:
            pos[:, :2] += w[:, None] * (step * u)
            return
    raise ValueError("degrade: no release point beside the bin is on the robot's table area")


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
    drop: bool = False,
    bad_release: str | None = None,
    scene: Scene | None = None,
) -> tuple[Trajectory, list[InjectedIssue]]:
    """A webcam-like copy of a clean demo, and the issues injected into it (degraded-timeline times).

    drop=True opens the gripper mid-carry, away from the bin; bad_release="outside" or "high" lets
    go beside the bin or more than 12 cm above its rim. grasp_offset_mm=0 grasps the cube at its
    center. drop and bad_release need scene; they draw from rng only when on.

    expert_stops=True also returns the clean expert's own waypoint stops as dont_care pauses, found
    on the path before the tremor is added (for honest scoring; off by default, so the list is
    exactly what was injected).
    """
    if slow_factor <= 0:
        raise ValueError(f"slow_factor must be > 0, got {slow_factor}")
    if not 0 < pause_s[0] <= pause_s[1]:
        raise ValueError(f"pause_s must be 0 < low <= high, got {pause_s}")
    if bad_release is not None and bad_release not in BAD_RELEASES:
        raise ValueError(f"bad_release must be one of {BAD_RELEASES} or None, got {bad_release!r}")
    if drop and bad_release:
        raise ValueError("degrade: a drop and a bad release do not go together (the cube is already gone)")
    if (drop or bad_release) and scene is None:
        raise ValueError("degrade: a drop or a bad release needs the scene (where the bin is)")
    a = traj.to_arrays()
    a["ee_pos"] = a["ee_pos"].copy()
    if drop:
        _drop(a, scene, rng)
    if bad_release:
        _bad_release(a, bad_release, scene, rng)
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
    if drop or bad_release:
        g = out["gripper"]
        t_open = float(grid[int(np.flatnonzero((g[:-1] == 1) & (g[1:] == 0))[-1]) + 1])
        kind = "drop" if drop else "bad_release"
        issues.append(InjectedIssue(type=kind, t0=t_open, t1=t_open))
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
