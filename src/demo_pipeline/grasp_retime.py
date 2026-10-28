"""Grasp retime, a Neaten op (2026-10-20 research note, finding 4). Pure numpy.

The human mouse demos grasp in a "swoop": the hand is within 3 cm of the grasp point for a median of 7 frames,
closes while still moving at about 0.17 m/s, and lifts 14 frames later. The scripted data that trained the best
policies stops (0.01 m/s), spends 16 frames in the last 3 cm and holds 0.5 s before lifting. retime_grasp rewrites
just the grasp phase into that style and keeps the person's own approach, grasp point, carry and release:

1. the approach eases to a stop (a time-warp of the person's own path) at a hover HOVER_ABOVE_M over the person's
   grasp point, blended in by a quintic ramp (edit_plan's blend: the ramp's own jerk peaks at 10 m/s^3);
2. it holds there HOVER_S;
3. it descends straight down, the last SLOW_M at no more than SLOW_SPEED, and stops on the grasp point;
4. it closes, and holds closed and still HOLD_S;
5. it lifts straight up LIFT_M from rest (peak LIFT_SPEED);
6. it eases back into the person's own path from where that path reached the same height, blended out the same way.

The grasp point is where the person closed (centred first if the rules' recenter_grasp fired: REPAIR_ORDER runs it
before this op). Every step stays within BUDGET_M of the original at its source time (the repair budget of the edit
language), and the motion it makes adds no jitter: over the steps it made or eased, no 0.5 s window has a jerk_rms over
the jitter rule's limit. (The person's own motion around it keeps its own jerk, as everywhere else in the demo: the
mouse demos' windows have a median of 10-19 m/s^3 and reach 30, and a window of the new timeline can straddle two of
them, so whole windows would charge the person's jerk to the retime.) When that cannot be met, a longer ease, then
lower hover and lift heights are tried (the person came in far off-vertical); if none fits, GraspRetimeError, and the
rules report the swoop without repairing it.
"""

from __future__ import annotations

import math
from typing import Callable, NamedTuple

import numpy as np

from .repair import DT, _build, _regrid, _sample, _slerp
from .schemas import Trajectory

# what counts as a swoop (the research note's measures)
NEAR_M = 0.03  # "frames in the last 3 cm": consecutive steps before the close within this of the grasp point
CLOSE_WINDOW_S = 0.1  # the hand's mean speed over this long before the close
SWOOP_SPEED = 0.05  # m/s: closing faster than this is a swoop
SWOOP_FRAMES = 10  # or fewer frames than this near the grasp point
LIFTED_M = 0.01  # "close -> lifted": the hand has risen this much

# the retimed grasp
HOVER_ABOVE_M = 0.10
HOVER_S = 0.3
SLOW_M = 0.04  # the last part of the descent ...
SLOW_SPEED = 0.05  # ... at no more than this
SLOW_JOIN_SPEED = 0.04  # the descent's speed where the slow part starts
DESCENT_SPEED = 0.15  # peak speed above it (the scripted expert's average)
HOLD_S = 0.4
LIFT_M = 0.10
LIFT_SPEED = 0.15  # peak
EASES_S = (0.3, 0.5, 0.8)  # this much of the person's path is eased into the hover and out of the lift (it takes
# twice as long); of those that pass, the one with the smoothest windows around the edit is kept
HEIGHTS = ((0.10, 0.10), (0.08, 0.08), (0.06, 0.06))  # (hover, lift) tried in order when the budget is not met

BUDGET_M = 0.05  # = edit_plan.REPAIR_BUDGET_M (a test pins them equal; importing it would be circular)
JITTER_LIMIT = 20.0  # = rules.JITTER_MIN_JERK (likewise)
WINDOW_S = 0.5  # as measure.compute_windows
MIN_BLEND_S, BLEND_JERK = 0.25, 10.0  # edit_plan.blend_s
_TOL = 1e-9


class GraspRetimeError(ValueError):
    """The grasp cannot be retimed within the budget and the jitter rule (or there is no grasp)."""


class GraspStats(NamedTuple):
    close_index: int
    close_t: float
    frames_near: int  # consecutive steps just before the close within NEAR_M of the grasp point
    close_speed: float  # m/s, mean over CLOSE_WINDOW_S before the close
    frames_to_lift: int | None  # steps from the close until the hand is LIFTED_M higher


class GraspRetime(NamedTuple):
    trajectory: Trajectory
    tmap: Callable[[np.ndarray], np.ndarray]  # input time -> output time
    source_t: list[float]  # per output step, its time on the input's timeline
    before: GraspStats
    after: GraspStats
    hover_m: float
    lift_m: float
    max_moved_m: float
    added_s: float


def _closes(g: np.ndarray) -> np.ndarray:
    return np.flatnonzero((g[1:] == 1) & (g[:-1] == 0)) + 1


def grasp_stats(traj: Trajectory, t: float | None = None) -> GraspStats | None:
    """The grasp's measures at the close nearest t (the first close if t is None); None if the gripper never closes."""
    a = traj.to_arrays()
    times, p, g = a["t"], a["ee_pos"], a["gripper"]
    closes = _closes(g)
    if closes.size == 0:
        return None
    k = int(closes[0] if t is None else closes[np.argmin(np.abs(times[closes] - t))])
    near = np.linalg.norm(p[:k] - p[k], axis=1) <= NEAR_M
    far = np.flatnonzero(~near)
    frames_near = k - 1 - int(far[-1]) if far.size else k
    step = np.linalg.norm(np.diff(p, axis=0), axis=1) / np.diff(times)  # step[j]: the motion into step j + 1
    n = max(1, round(CLOSE_WINDOW_S / float(np.median(np.diff(times)))))
    close_speed = float(step[max(0, k - n) : k].mean()) if k else 0.0
    up = np.flatnonzero(p[k:, 2] >= p[k, 2] + LIFTED_M)
    return GraspStats(k, float(times[k]), frames_near, close_speed, int(up[0]) if up.size else None)


def is_swoop(s: GraspStats) -> bool:
    return s.close_speed > SWOOP_SPEED or s.frames_near < SWOOP_FRAMES


def _blend_s(distance: float) -> float:
    return max(MIN_BLEND_S, (60.0 * distance / BLEND_JERK) ** (1 / 3))


def _smoothstep(u: np.ndarray) -> np.ndarray:
    u = np.clip(u, 0.0, 1.0)
    return u**3 * (10 - 15 * u + 6 * u**2)


def _hermite5(x0: float, v0: float, x1: float, v1: float, n: int) -> np.ndarray:
    """n + 1 samples (both ends) of the quintic from (x0, v0) to (x1, v1) over n steps of DT, zero acceleration at
    both ends, so it joins a hold, a ramp or another such piece without a jump in acceleration."""
    tau = np.arange(n + 1) / n
    T = n * DT
    h00 = 1 - 10 * tau**3 + 15 * tau**4 - 6 * tau**5
    h10 = tau - 6 * tau**3 + 8 * tau**4 - 3 * tau**5
    h01 = 10 * tau**3 - 15 * tau**4 + 6 * tau**5
    h11 = -4 * tau**3 + 7 * tau**4 - 3 * tau**5
    return h00 * x0 + h10 * T * v0 + h01 * x1 + h11 * T * v1


def _move(x0: float, v0: float, x1: float, v1: float, peak: float) -> np.ndarray:
    """The shortest _hermite5 from x0 to x1 that never goes back and never exceeds `peak` (m/s or s/s)."""
    sign = 1.0 if x1 >= x0 else -1.0
    n = max(2, math.ceil(abs(x1 - x0) / peak / DT))
    for _ in range(2000):
        x = _hermite5(x0, v0, x1, v1, n)
        v = np.diff(x) / DT * sign
        if v.min() >= -_TOL and v.max() <= peak + _TOL:
            return x
        n += 1
    raise GraspRetimeError(f"no smooth move from {x0:.3f} to {x1:.3f} under {peak} per second")


def _match(z_new: np.ndarray, z_src: np.ndarray, t_src: np.ndarray, falling: bool) -> np.ndarray:
    """For each new height, the source time where the person's path (made monotone) passed it."""
    zz = (np.minimum if falling else np.maximum).accumulate(z_src)
    key = -zz if falling else zz
    key = key + np.arange(len(key)) * 1e-12  # strictly increasing for interp
    return np.interp(-z_new if falling else z_new, key, t_src)


def _windows(t: np.ndarray, jerk: np.ndarray) -> list[tuple[float, float, float]]:
    n_windows = max(1, math.ceil((t[-1] - t[0] - _TOL) / WINDOW_S))
    idx = np.minimum(np.floor((t - t[0]) / WINDOW_S + _TOL).astype(int), n_windows - 1)
    return [(t[0] + k * WINDOW_S, min(t[0] + (k + 1) * WINDOW_S, t[-1]), float(np.sqrt(np.mean(jerk[idx == k] ** 2))))
            for k in range(n_windows) if np.any(idx == k)]


def _jerk(t: np.ndarray, p: np.ndarray) -> np.ndarray:
    d = p
    for _ in range(3):
        d = np.gradient(d, t, axis=0)
    return np.linalg.norm(d, axis=1)


def _build_retime(a: dict, k: int, hover: float, lift: float, ease_s: float) -> tuple[np.ndarray, ...]:
    """(pos, quat, gripper, source times, t_a, t_b) of the retimed demo with these hover and lift heights; the
    person's path is kept up to t_a and from t_b on (eased in between them and the new grasp)."""
    t, p, q, g = a["t"], a["ee_pos"], a["ee_quat"], a["gripper"]
    grasp = p[k].copy()
    z_c = grasp[2]
    if hover <= SLOW_M:
        raise GraspRetimeError(f"a hover {hover} m up leaves no room for the {SLOW_M} m slow descent")
    # where the person's path was at the hover height on the way down, and at the lift height on the way up
    opened = np.flatnonzero(g[:k] != 0)
    first = int(opened[-1]) + 1 if opened.size else 0
    high = np.flatnonzero(p[first:k, 2] >= z_c + hover - _TOL)
    if high.size == 0:
        raise GraspRetimeError(f"the hand is never {hover * 100:.0f} cm above the grasp before it closes")
    i_h = first + int(high[-1])
    reopen = np.flatnonzero(g[k:] != 1)
    last = k + int(reopen[0]) - 1 if reopen.size else len(t) - 1
    up = np.flatnonzero(p[k : last + 1, 2] >= z_c + lift - _TOL)
    if up.size == 0:
        raise GraspRetimeError(f"the hand never rises {lift * 100:.0f} cm above the grasp while holding the cube")
    i_r = k + int(up[0])
    t_h, t_r, t_c = float(t[i_h]), float(t[i_r]), float(t[k])
    H = np.array([grasp[0], grasp[1], z_c + hover])
    L = np.array([grasp[0], grasp[1], z_c + lift])
    d_h, d_r = H - p[i_h], L - p[i_r]
    for name, d in (("hover", d_h), ("lift", d_r)):
        if np.linalg.norm(d) > BUDGET_M:
            raise GraspRetimeError(f"over the repair budget: the person's path is {np.linalg.norm(d) * 100:.1f} cm "
                                   f"from the {name} point straight over the grasp (max {BUDGET_M * 100:.0f} cm)")

    # 1. the approach, eased to a stop at the hover: source times run at full rate, then slow to 0 at t_h
    t_a = max(float(t[0]), t_h - ease_s)
    if t_h - t_a < 2 * DT:
        raise GraspRetimeError("the approach is too short to slow into a hover")
    ease = _move(t_a, 1.0, t_h, 0.0, 1.0)
    s_app = np.concatenate([t[t < t_a - _TOL], ease])
    # 6. the person's path again after the lift: source times start at rest and reach full rate
    t_b = min(float(t[-1]), t_r + ease_s)
    if t_b - t_r < 2 * DT:
        raise GraspRetimeError("the demo ends too soon after the lift to rejoin it")
    s_out = np.concatenate([_move(t_r, 0.0, t_b, 1.0, 1.0), t[t > t_b + _TOL]])

    b_h, b_r = _blend_s(float(np.linalg.norm(d_h))), _blend_s(float(np.linalg.norm(d_r)))
    app = _sample(a, s_app)
    app["ee_pos"] = app["ee_pos"] + d_h * _smoothstep((s_app - (t_h - b_h)) / b_h)[:, None]
    out = _sample(a, s_out)
    out["ee_pos"] = out["ee_pos"] + d_r * (1 - _smoothstep((s_out - t_r) / b_r))[:, None]
    q_h, q_c, q_r = app["ee_quat"][-1], q[k], out["ee_quat"][0]

    # 2. hover, 3. descent (fast, then the slow last SLOW_M), 4. hold closed, 5. lift
    n_hover, n_hold = round(HOVER_S / DT), round(HOLD_S / DT)
    z1 = _move(H[2], 0.0, z_c + SLOW_M, -SLOW_JOIN_SPEED, DESCENT_SPEED)
    z2 = _move(z_c + SLOW_M, -SLOW_JOIN_SPEED, z_c, 0.0, SLOW_SPEED)
    z_down = np.concatenate([z1[1:], z2[1:]])
    z_up = _move(z_c, 0.0, z_c + lift, 0.0, LIFT_SPEED)[1:]
    down_pos = np.column_stack([np.full(len(z_down), grasp[0]), np.full(len(z_down), grasp[1]), z_down])
    up_pos = np.column_stack([np.full(len(z_up), grasp[0]), np.full(len(z_up), grasp[1]), z_up])
    u_down = (H[2] - z_down) / (H[2] - z_c)
    u_up = (z_up - z_c) / lift
    s_down = _match(z_down, p[i_h : k + 1, 2], t[i_h : k + 1], falling=True)
    s_up = _match(z_up, p[k : i_r + 1, 2], t[k : i_r + 1], falling=False)

    pos = np.concatenate([app["ee_pos"], np.tile(H, (n_hover, 1)), down_pos, np.tile(grasp, (n_hold, 1)), up_pos,
                          out["ee_pos"][1:]])
    quat = np.concatenate([app["ee_quat"], np.tile(q_h, (n_hover, 1)), _slerp(np.tile(q_h, (len(u_down), 1)),
                           np.tile(q_c, (len(u_down), 1)), u_down), np.tile(q_c, (n_hold, 1)),
                           _slerp(np.tile(q_c, (len(u_up), 1)), np.tile(q_r, (len(u_up), 1)), u_up),
                           out["ee_quat"][1:]])
    grip = np.concatenate([app["gripper"], np.zeros(n_hover + len(z_down), dtype=g.dtype),
                           np.ones(n_hold + len(z_up), dtype=g.dtype), out["gripper"][1:]])
    # the close is the first hold step: the hand has stopped on the grasp point (z_down's last step) before it
    src = np.concatenate([s_app, np.full(n_hover, t_h), s_down, np.full(n_hold, t_c), s_up, s_out[1:]])
    return pos, quat, grip, src, t_a, t_b


def retime_grasp(traj: Trajectory, t: float) -> GraspRetime:
    """The demo with the grasp at the close nearest t retimed (see the module docstring)."""
    traj = _regrid(traj)
    a = traj.to_arrays()
    times, p, g = a["t"], a["ee_pos"], a["gripper"]
    closes = _closes(g)
    if closes.size == 0:
        raise GraspRetimeError("the gripper never closes, so there is no grasp to retime")
    k = int(closes[np.argmin(np.abs(times[closes] - t))])
    before = grasp_stats(traj, float(times[k]))
    errors = []
    for hover, lift in HEIGHTS:
        passed = []  # (the worst whole window around the edit, the result) per ease that passes
        for ease_s in EASES_S:
            try:
                pos, quat, grip, src, t_a, t_b = _build_retime(a, k, hover, lift, ease_s)
            except GraspRetimeError as e:
                errors.append(str(e))
                continue
            t_new = np.arange(len(pos)) * DT
            base = np.stack([np.interp(src, times, p[:, i]) for i in range(3)], axis=1)
            moved = np.linalg.norm(pos - base, axis=1)
            if moved.max() > BUDGET_M + _TOL:
                errors.append(f"over the repair budget: a step moves {moved.max() * 100:.1f} cm")
                continue
            jerk = _jerk(t_new, pos)
            made = (src > t_a + _TOL) & (src < t_b - _TOL)  # the steps this op made or eased
            worst = max((j for _, _, j in _windows(t_new[made], jerk[made])), default=0.0)
            if worst > JITTER_LIMIT + _TOL:
                errors.append(f"not smooth: the retimed grasp's jerk_rms reaches {worst:.0f} m/s^3 "
                              f"(the jitter rule's limit is {JITTER_LIMIT:.0f})")
                continue
            e0, e1 = t_new[made][0], t_new[made][-1]
            around = max((j for w0, w1, j in _windows(t_new, jerk) if w1 > e0 and w0 < e1), default=0.0)
            passed.append((around, ease_s, pos, quat, grip, src, t_new, moved))
        if passed:
            # of the eases that pass, the one whose whole windows (the person's own motion around it included) are
            # smoothest: where the rejoin meets a fast, jerky carry, a longer ease helps
            _, _, pos, quat, grip, src, t_new, moved = min(passed, key=lambda r: (r[0], r[1]))
            out = _build(pos, quat, grip)
            key = src + np.arange(len(src)) * 1e-9
            return GraspRetime(
                trajectory=out,
                tmap=lambda x, key=key, t_new=t_new: np.interp(np.asarray(x, dtype=np.float64), key, t_new),
                source_t=src.tolist(), before=before, after=grasp_stats(out), hover_m=hover, lift_m=lift,
                max_moved_m=float(moved.max()), added_s=float(t_new[-1] - times[-1]))
    raise GraspRetimeError("; ".join(dict.fromkeys(errors)))
