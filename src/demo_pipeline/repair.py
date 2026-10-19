"""Repair menu (spec 8.4): deterministic trajectory edits, plus apply_repairs in the fixed order.

Every op returns a trajectory on an even 50 Hz grid starting at t = 0: positions are linearly
interpolated, quaternions slerped, and the gripper takes the nearest-previous value.

Op times always refer to the ORIGINAL demo (that is what the diagnosis saw). apply_repairs keeps
a monotone map from original time to current time, updated by every op that changes the
timeline, and maps each later op's times through it.
"""

from __future__ import annotations

import math
from typing import Callable

import numpy as np

from .measure import gripper_events
from .scene_geometry import (
    BIN_FOOTPRINT_HALF,
    BIN_INNER,
    BIN_RIM_HEIGHT,
    CUBE_HALF,
    RELEASE_CLEARANCE,
)
from .schemas import REPAIR_ORDER, RepairOp, Scene, Trajectory

DT = 0.02  # 50 Hz output grid
SMOOTH_SIGMA_S = {"low": 0.04, "med": 0.08, "high": 0.16}
SMOOTH_RAMP_S = 0.1  # smoothing fades to 0 this close to a gripper event or the span's edges
RECENTER_RAMP_S = 1.0  # recenter_grasp ramps in over 1 s, holds 1 s through the lift, ramps out over 1 s
MIN_TRANSIT_SPEED = 0.05  # m/s; replan_transit's speed when the original span barely moved
# release_above_bin (sizes from scene_geometry; these are timings and margins, the same for every demo and bin)
RELEASE_APPROACH_MARGIN = 0.05  # m outside the bin's footprint: the place starts once the tool comes this near
RELEASE_INSIDE_MARGIN = 0.01  # m kept between the held cube's side and an inner wall at the release point
RELEASE_SETTLE_S = 0.2  # held still, closed, over the release point before opening
RELEASE_OPEN_S = 0.5  # held open there while the cube drops in
RELEASE_LIFT_M, RELEASE_LIFT_S = 0.10, 1.0  # then straight up, away from the bin
RELEASE_END_S = 0.5  # and still at the top, so the cube's settling is on the record (check_success: 0.5 s)
_TOL = 1e-9

TimeMap = Callable[[np.ndarray], np.ndarray]
_Arrays = dict[str, np.ndarray]


class DiscardDemo(Exception):
    """The diagnosis said to drop this demo."""


# --- sampling helpers --------------------------------------------------------------

def _slerp(q0: np.ndarray, q1: np.ndarray, u: np.ndarray) -> np.ndarray:
    """Row-wise slerp from q0 to q1 ([M, 4] each) at fractions u [M]; takes the short way round."""
    q0, q1 = np.atleast_2d(q0), np.atleast_2d(q1)
    u = np.asarray(u, dtype=np.float64).reshape(-1, 1)
    dot = np.sum(q0 * q1, axis=1, keepdims=True)
    q1 = np.where(dot < 0, -q1, q1)
    dot = np.minimum(np.abs(dot), 1.0)
    theta = np.arccos(dot)
    sin = np.sin(theta)
    near = sin < 1e-6
    safe = np.where(near, 1.0, sin)
    w0 = np.where(near, 1.0 - u, np.sin((1.0 - u) * theta) / safe)
    w1 = np.where(near, u, np.sin(u * theta) / safe)
    out = w0 * q0 + w1 * q1
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def _sample(a: _Arrays, s: np.ndarray) -> _Arrays:
    """Sample the trajectory arrays at source times s."""
    t = a["t"]
    s = np.clip(np.asarray(s, dtype=np.float64), t[0], t[-1])
    i = np.clip(np.searchsorted(t, s, side="right") - 1, 0, len(t) - 2)
    u = np.clip((s - t[i]) / (t[i + 1] - t[i]), 0.0, 1.0)
    pos = a["ee_pos"][i] + u[:, None] * (a["ee_pos"][i + 1] - a["ee_pos"][i])
    quat = _slerp(a["ee_quat"][i], a["ee_quat"][i + 1], u)
    gi = np.clip(np.searchsorted(t, s + _TOL, side="right") - 1, 0, len(t) - 1)
    return {"ee_pos": pos, "ee_quat": quat, "gripper": a["gripper"][gi]}


def _grid(duration: float) -> np.ndarray:
    return np.arange(int(math.floor(duration / DT + 1e-6)) + 1) * DT


def _build(pos: np.ndarray, quat: np.ndarray, grip: np.ndarray) -> Trajectory:
    quat = quat / np.linalg.norm(quat, axis=1, keepdims=True)
    return Trajectory.from_arrays(np.arange(len(pos)) * DT, pos, quat, grip)


def _regrid(traj: Trajectory) -> Trajectory:
    """The same trajectory on the even 50 Hz grid from t = 0 (returned as is if already there)."""
    t = np.asarray(traj.t)
    if abs(t[0]) <= _TOL and np.allclose(t, np.arange(len(t)) * DT, atol=_TOL, rtol=0):
        return traj
    a = traj.to_arrays()
    s = t[0] + _grid(t[-1] - t[0])
    out = _sample(a, s)
    return _build(out["ee_pos"], out["ee_quat"], out["gripper"])


def _resampled(traj: Trajectory, s: np.ndarray) -> Trajectory:
    out = _sample(traj.to_arrays(), s)
    return _build(out["ee_pos"], out["ee_quat"], out["gripper"])


def _index(traj: Trajectory, t: float) -> int:
    return int(np.clip(round(t / DT), 0, len(traj.t) - 1))


def _identity(x: np.ndarray) -> np.ndarray:
    return np.asarray(x, dtype=np.float64)


def _span_map(t0: float, t1: float, new_len: float) -> TimeMap:
    """Times before t0 unchanged, [t0, t1] stretched to [t0, t0 + new_len], later times shifted."""
    def f(x):
        x = np.asarray(x, dtype=np.float64)
        inside = t0 + (x - t0) * (new_len / (t1 - t0))
        return np.where(x <= t0, x, np.where(x >= t1, x + new_len - (t1 - t0), inside))
    return f


def _splice(traj: Trajectory, i0: int, i1: int, new: _Arrays) -> tuple[Trajectory, TimeMap]:
    """Replace steps i0..i1 (inclusive) with `new`, whose first and last rows are the new span's endpoints."""
    a = traj.to_arrays()
    parts = {k: np.concatenate([a[k][:i0], new[k], a[k][i1 + 1 :]]) for k in ("ee_pos", "ee_quat", "gripper")}
    out = _build(parts["ee_pos"], parts["ee_quat"], parts["gripper"])
    return out, _span_map(a["t"][i0], a["t"][i1], (len(new["ee_pos"]) - 1) * DT)


def _along_path(a: _Arrays, i0: int, i1: int, n_steps: int) -> _Arrays:
    """n_steps + 1 samples at equal arc-length spacing along the recorded path from step i0 to i1."""
    seg = np.linalg.norm(np.diff(a["ee_pos"][i0 : i1 + 1], axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)]) + np.arange(i1 - i0 + 1) * 1e-12  # strictly increasing
    arc = np.linspace(0.0, cum[-1], n_steps + 1)
    return _sample(a, np.interp(arc, cum, a["t"][i0 : i1 + 1]))


def _arc_length(a: _Arrays, i0: int, i1: int) -> float:
    return float(np.linalg.norm(np.diff(a["ee_pos"][i0 : i1 + 1], axis=0), axis=1).sum())


# --- the ops (each returns the new trajectory and how it moved time) -----------------

def _trim(traj: Trajectory, t0: float, t1: float) -> tuple[Trajectory, TimeMap]:
    traj = _regrid(traj)
    end = traj.t[-1]
    t_close, t_open = gripper_events(traj)
    if t_close is not None:
        t0 = min(t0, t_close - DT)  # keep the open step just before the first close
    if t_open is not None:
        t1 = max(t1, t_open)
    t0, t1 = max(t0, 0.0), min(t1, end)
    out = _resampled(traj, t0 + _grid(t1 - t0))
    return out, lambda x: np.clip(np.asarray(x, dtype=np.float64) - t0, 0.0, t1 - t0)


def _remove_pause(traj: Trajectory, t0: float, t1: float) -> tuple[Trajectory, TimeMap]:
    traj = _regrid(traj)
    t0, t1 = max(t0, 0.0), min(t1, traj.t[-1])
    cut = t1 - t0
    u = _grid(traj.t[-1] - cut)
    out = _resampled(traj, np.where(u < t0 - _TOL, u, u + cut))

    def f(x):
        x = np.asarray(x, dtype=np.float64)
        return np.where(x < t0, x, np.where(x > t1, x - cut, t0))
    return out, f


def _smooth(traj: Trajectory, t0: float, t1: float, strength: str) -> tuple[Trajectory, TimeMap]:
    traj = _regrid(traj)
    a = traj.to_arrays()
    t, pos, quat, g = a["t"], a["ee_pos"], a["ee_quat"], a["gripper"]
    sigma = SMOOTH_SIGMA_S[strength]
    weight = np.clip((t - t0) / SMOOTH_RAMP_S, 0.0, 1.0) * np.clip((t1 - t) / SMOOTH_RAMP_S, 0.0, 1.0)
    for t_event in t[1:][g[1:] != g[:-1]]:
        weight *= np.clip(np.abs(t - t_event) / SMOOTH_RAMP_S, 0.0, 1.0)

    half = int(math.ceil(3 * sigma / DT))
    new_pos, new_quat = pos.copy(), quat.copy()
    for i in np.flatnonzero(weight > 0):
        j = np.arange(max(i - half, 0), min(i + half, len(t) - 1) + 1)
        k = np.exp(-0.5 * ((t[j] - t[i]) / sigma) ** 2)
        k /= k.sum()
        new_pos[i] = pos[i] + weight[i] * (k @ pos[j] - pos[i])
        near = quat[j] * np.where(quat[j] @ quat[i] < 0, -1.0, 1.0)[:, None]  # one hemisphere before averaging
        mean = k @ near
        new_quat[i] = _slerp(quat[i], mean / np.linalg.norm(mean), weight[i])[0]
    return _build(new_pos, new_quat, g), _identity


def _retime(traj: Trajectory, t0: float, t1: float, target_speed: float) -> tuple[Trajectory, TimeMap]:
    traj = _regrid(traj)
    i0, i1 = _index(traj, t0), _index(traj, t1)
    if i1 <= i0:
        return traj, _identity
    a = traj.to_arrays()
    n_steps = max(1, round(_arc_length(a, i0, i1) / target_speed / DT))
    return _splice(traj, i0, i1, _along_path(a, i0, i1, n_steps))


def _recenter_grasp(traj: Trajectory, t: float, cube_pos: tuple[float, float, float]) -> tuple[Trajectory, TimeMap]:
    traj = _regrid(traj)
    a = traj.to_arrays()
    times, g = a["t"], a["gripper"]
    closes = times[1:][(g[1:] == 1) & (g[:-1] == 0)]
    if closes.size:  # anchor on the real close nearest the diagnosed time
        t = float(closes[np.argmin(np.abs(closes - t))])
    ee_xy = _sample(a, np.array([t]))["ee_pos"][0, :2]
    offset = np.asarray(cube_pos[:2], dtype=np.float64) - ee_xy
    r = RECENTER_RAMP_S
    w = np.interp(times, [t - r, t, t + r, t + 2 * r], [0.0, 1.0, 1.0, 0.0], left=0.0, right=0.0)
    pos = a["ee_pos"].copy()
    pos[:, :2] += w[:, None] * offset
    return _build(pos, a["ee_quat"], g), _identity


def _replan_transit(traj: Trajectory, t0: float, t1: float, bin_rim_z: float,
                    clearance: float = 0.10) -> tuple[Trajectory, TimeMap]:
    traj = _regrid(traj)
    i0, i1 = _index(traj, t0), _index(traj, t1)
    if i1 <= i0:
        raise ValueError(f"replan_transit needs t1 > t0, got [{t0}, {t1}]")
    a = traj.to_arrays()
    g = a["gripper"][i0 : i1 + 1]
    if np.any(g != g[0]):
        raise ValueError(f"replan_transit: the gripper changes inside [{t0}, {t1}]")
    p0, p1 = a["ee_pos"][i0], a["ee_pos"][i1]
    z_clear = max(p0[2], p1[2], bin_rim_z + clearance)
    corners = np.array([p0, [p0[0], p0[1], z_clear], [p1[0], p1[1], z_clear], p1])
    corners = corners[np.r_[True, np.linalg.norm(np.diff(corners, axis=0), axis=1) > _TOL]]
    cum = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(corners, axis=0), axis=1))])
    speed = max(_arc_length(a, i0, i1) / (a["t"][i1] - a["t"][i0]), MIN_TRANSIT_SPEED)
    n_steps = max(1, math.ceil(cum[-1] / speed / DT - 1e-6))
    arc = np.linspace(0.0, cum[-1], n_steps + 1)
    pos = np.stack([np.interp(arc, cum, corners[:, k]) for k in range(3)], axis=1)
    pos[0], pos[-1] = p0, p1
    u = np.linspace(0.0, 1.0, n_steps + 1)
    quat = _slerp(np.tile(a["ee_quat"][i0], (n_steps + 1, 1)), np.tile(a["ee_quat"][i1], (n_steps + 1, 1)), u)
    return _splice(traj, i0, i1, {"ee_pos": pos, "ee_quat": quat, "gripper": np.full(n_steps + 1, g[0])})


def _bin_frame(scene: Scene) -> tuple[np.ndarray, float]:
    """(bin origin xy, bin yaw) from the scene."""
    w, x, y, z = scene.bin_pose.quat_wxyz
    return np.asarray(scene.bin_pose.pos[:2], dtype=np.float64), math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def _rot(xy: np.ndarray, yaw: float) -> np.ndarray:
    c, s = math.cos(yaw), math.sin(yaw)
    return np.stack([c * xy[..., 0] - s * xy[..., 1], s * xy[..., 0] + c * xy[..., 1]], axis=-1)


def _release_above_bin(traj: Trajectory, t: float, scene: Scene) -> tuple[Trajectory, TimeMap]:
    traj = _regrid(traj)
    a = traj.to_arrays()
    times, g, pos, quat = a["t"], a["gripper"], a["ee_pos"], a["ee_quat"]
    opens = np.flatnonzero((g[1:] == 0) & (g[:-1] == 1)) + 1
    if opens.size == 0:
        raise ValueError("release_above_bin: the gripper never opens after a close")
    k_open = int(opens[np.argmin(np.abs(times[opens] - t))])  # anchor on the real open nearest the diagnosed time
    closes = np.flatnonzero((g[1:] == 1) & (g[:-1] == 0)) + 1
    closes = closes[closes < k_open]
    k_close = int(closes[-1]) if closes.size else 0

    origin, yaw = _bin_frame(scene)
    local = _rot(pos[:, :2] - origin, -yaw)
    near = np.all(np.abs(local) <= BIN_FOOTPRINT_HALF + RELEASE_APPROACH_MARGIN, axis=1)
    entering = np.flatnonzero(near[k_close + 1 : k_open + 1])
    k_s = k_close + 1 + int(entering[0]) if entering.size else k_open  # the place starts as the tool nears the bin

    inside = np.array([BIN_INNER[0], BIN_INNER[1]]) / 2 - CUBE_HALF - RELEASE_INSIDE_MARGIN
    xy = origin + _rot(np.clip(local[k_open], -inside, inside), yaw)  # the person's release point, kept inside
    z_place = scene.bin_pose.pos[2] + BIN_RIM_HEIGHT + CUBE_HALF + RELEASE_CLEARANCE
    p_s = pos[k_s]
    z_high = max(p_s[2], z_place)
    corners = np.array([p_s, [p_s[0], p_s[1], z_high], [xy[0], xy[1], z_high], [xy[0], xy[1], z_place]])
    corners = corners[np.r_[True, np.linalg.norm(np.diff(corners, axis=0), axis=1) > _TOL]]
    cum = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(corners, axis=0), axis=1))])
    span = times[k_open] - times[k_s]
    speed = max(_arc_length(a, k_s, k_open) / span if span > 0 else 0.0, MIN_TRANSIT_SPEED)
    n_move = max(1, math.ceil(cum[-1] / speed / DT - 1e-6))
    move = np.stack([np.interp(np.linspace(0.0, cum[-1], n_move + 1), cum, corners[:, k]) for k in range(3)], axis=1)
    move[0] = p_s
    q_open = quat[k_open]
    move_q = _slerp(np.tile(quat[k_s], (n_move + 1, 1)), np.tile(q_open, (n_move + 1, 1)), np.linspace(0, 1, n_move + 1))

    top = np.array([xy[0], xy[1], z_place])
    n_settle, n_open = round(RELEASE_SETTLE_S / DT), round(RELEASE_OPEN_S / DT)
    n_lift, n_end = round(RELEASE_LIFT_S / DT), round(RELEASE_END_S / DT)
    lift = top + np.outer(np.arange(1, n_lift + 1) / n_lift, [0.0, 0.0, RELEASE_LIFT_M])
    new_pos = np.concatenate([move, np.tile(top, (n_settle + n_open, 1)), lift, np.tile(lift[-1], (n_end, 1))])
    new_q = np.concatenate([move_q, np.tile(q_open, (len(new_pos) - len(move_q), 1))])
    new_g = np.concatenate([np.ones(n_move + 1 + n_settle, dtype=g.dtype), np.zeros(len(new_pos) - n_move - 1 - n_settle,
                                                                                    dtype=g.dtype)])
    out = _build(np.concatenate([pos[:k_s], new_pos]), np.concatenate([quat[:k_s], new_q]), np.concatenate([g[:k_s], new_g]))
    t_s, old_len, new_len = times[k_s], times[-1] - times[k_s], (len(new_pos) - 1) * DT
    scale = new_len / old_len if old_len > 0 else 1.0
    return out, lambda x: np.where(np.asarray(x) <= t_s, x, t_s + (np.asarray(x, dtype=np.float64) - t_s) * scale)


# --- public API ---------------------------------------------------------------------

def trim(traj: Trajectory, t0: float, t1: float) -> Trajectory:
    """Keep [t0, t1], widened if needed so the first close and the last open survive."""
    return _trim(traj, t0, t1)[0]


def remove_pause(traj: Trajectory, t0: float, t1: float) -> Trajectory:
    """Cut [t0, t1] out and stitch the pose at t0 to the pose at t1."""
    return _remove_pause(traj, t0, t1)[0]


def smooth(traj: Trajectory, t0: float, t1: float, strength: str) -> Trajectory:
    """Gaussian-smooth position and orientation in [t0, t1], fading out near gripper events and the span edges."""
    return _smooth(traj, t0, t1, strength)[0]


def retime(traj: Trajectory, t0: float, t1: float, target_speed: float) -> Trajectory:
    """Move along the same path in [t0, t1] at a constant target_speed (m/s)."""
    return _retime(traj, t0, t1, target_speed)[0]


def recenter_grasp(traj: Trajectory, t: float, cube_pos: tuple[float, float, float]) -> Trajectory:
    """Shift xy so the gripper closes over the cube center: ramp in over 1 s, hold 1 s, ramp out over 1 s."""
    return _recenter_grasp(traj, t, cube_pos)[0]


def replan_transit(traj: Trajectory, t0: float, t1: float, bin_rim_z: float, clearance: float = 0.10) -> Trajectory:
    """Replace [t0, t1] with rise -> across at bin_rim_z + clearance -> descend, at the span's average speed."""
    return _replan_transit(traj, t0, t1, bin_rim_z, clearance)[0]


def release_above_bin(traj: Trajectory, t: float, scene: Scene) -> Trajectory:
    """Rewrite the place: from where the tool nears the bin, rise if low, cross over to the release point (kept
    over the bin's inside) with the held cube's bottom RELEASE_CLEARANCE above the rim, stop, open, lift away.
    Every size comes from demo_pipeline.scene_geometry and the scene's bin pose; t anchors on the nearest open."""
    return _release_above_bin(traj, t, scene)[0]


def apply_repairs(traj: Trajectory, repairs: list[RepairOp], scene: Scene, bin_rim_z: float) -> Trajectory:
    """Apply the ops in REPAIR_ORDER (list order is ignored), mapping their original-demo times as the timeline changes."""
    if any(r.op == "discard" for r in repairs):
        raise DiscardDemo("the diagnosis contains a discard op")
    start = traj.t[0]
    tmap: TimeMap = lambda x: np.asarray(x, dtype=np.float64) - start  # noqa: E731
    cur = _regrid(traj)
    for op in sorted(repairs, key=lambda r: REPAIR_ORDER.index(r.op)):
        if op.op == "recenter_grasp":
            cur, step_map = _recenter_grasp(cur, float(tmap(op.t)), scene.cube_pose.pos)
        elif op.op == "release_above_bin":
            cur, step_map = _release_above_bin(cur, float(tmap(op.t)), scene)
        else:
            t0, t1 = (float(v) for v in np.clip(tmap([op.t0, op.t1]), 0.0, cur.t[-1]))
            if t1 - t0 < DT / 2:  # the span vanished, e.g. it lay inside a removed pause
                continue
            if op.op == "trim":
                cur, step_map = _trim(cur, t0, t1)
            elif op.op == "remove_pause":
                cur, step_map = _remove_pause(cur, t0, t1)
            elif op.op == "replan_transit":
                cur, step_map = _replan_transit(cur, t0, t1, bin_rim_z)
            elif op.op == "smooth":
                cur, step_map = _smooth(cur, t0, t1, op.strength)
            else:
                cur, step_map = _retime(cur, t0, t1, op.target_speed)
        tmap = (lambda f, g: lambda x: f(g(x)))(step_map, tmap)
    return cur
