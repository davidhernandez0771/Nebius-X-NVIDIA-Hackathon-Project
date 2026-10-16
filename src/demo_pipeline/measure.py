"""Measurer (spec 8.2): Trajectory + per-step sim signals -> metrics. numpy only."""

from __future__ import annotations

import math

import numpy as np

from .schemas import MetricsWindow, SimSignals, Trajectory

_EDGE_TOL = 1e-9  # absorbs float error when a step time falls exactly on a window edge


def speed_profile(traj: Trajectory) -> np.ndarray:
    """Per-step ee speed in m/s from backward differences; speed[0] copies speed[1]."""
    a = traj.to_arrays()
    step = np.linalg.norm(np.diff(a["ee_pos"], axis=0), axis=1) / np.diff(a["t"])
    return np.concatenate([step[:1], step])


def _line_pad(pos: np.ndarray, n_fit: int, n_pad: int) -> np.ndarray:
    """n_pad samples before pos[0], on the least-squares line through the first n_fit samples."""
    x = np.arange(n_fit, dtype=np.float64)
    slope, icept = np.polyfit(x, pos[:n_fit], 1)
    return icept + np.arange(-n_pad, 0, dtype=np.float64)[:, None] * slope


def _smooth_positions(pos: np.ndarray, sigma_steps: float) -> np.ndarray:
    """Gaussian low-pass of [N, 3] positions. Each end is padded along a line fitted to its last
    ~3 sigma of samples: a constant velocity stays constant up to the ends (an edge pad would
    slow the hand there), and the fit averages the end noise (pivoting on the end sample doubles it)."""
    half = int(math.ceil(3 * sigma_steps))
    kern = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma_steps) ** 2)
    kern /= kern.sum()
    n_fit = min(len(pos), half + 1)
    padded = np.concatenate([_line_pad(pos, n_fit, half), pos, _line_pad(pos[::-1], n_fit, half)[::-1]])
    return np.stack([np.convolve(padded[:, k], kern, mode="valid") for k in range(3)], axis=1)


def smoothed_speed(traj: Trajectory, sigma_s: float) -> np.ndarray:
    """speed_profile of the path low-passed by a Gaussian of sigma_s seconds (0 gives speed_profile exactly).

    Hand tremor (webcam noise) keeps the raw speed far above any still threshold; averaging the
    positions first removes it. Assumes an even time grid (the kernel is sized from the median step).
    """
    if sigma_s < 0:
        raise ValueError(f"sigma_s must be >= 0, got {sigma_s}")
    if sigma_s == 0:
        return speed_profile(traj)
    a = traj.to_arrays()
    smooth = _smooth_positions(a["ee_pos"], sigma_s / float(np.median(np.diff(a["t"]))))
    step = np.linalg.norm(np.diff(smooth, axis=0), axis=1) / np.diff(a["t"])
    return np.concatenate([step[:1], step])


def _jerk_norms(traj: Trajectory) -> np.ndarray:
    a = traj.to_arrays()
    d = a["ee_pos"]
    for _ in range(3):
        d = np.gradient(d, a["t"], axis=0)
    return np.linalg.norm(d, axis=1)


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2))) if x.size else 0.0


def jerk_rms(traj: Trajectory, t0: float, t1: float) -> float:
    """RMS of |d^3 ee_pos / dt^3| over the steps with t in [t0, t1]; 0.0 if none."""
    t = np.asarray(traj.t)
    mask = (t >= t0 - _EDGE_TOL) & (t <= t1 + _EDGE_TOL)
    return _rms(_jerk_norms(traj)[mask])


def gripper_events(traj: Trajectory) -> tuple[float | None, float | None]:
    """(time of the first closed step, time of the last close->open step after it). None when missing."""
    g = np.asarray(traj.gripper)
    t = traj.t
    closed = np.flatnonzero(g == 1)
    if closed.size == 0:
        return None, None
    first_close = int(closed[0])
    opens = np.flatnonzero((g[1:] == 0) & (g[:-1] == 1)) + 1
    opens = opens[opens > first_close]
    return t[first_close], (t[int(opens[-1])] if opens.size else None)


def compute_windows(traj: Trajectory, sim: SimSignals, window_s: float = 0.5) -> list[MetricsWindow]:
    """Consecutive windows [t0, t1) from the first step to the end; the last one may be shorter and includes the end."""
    t = np.asarray(traj.t)
    n = t.size
    if sim.n_steps != n:
        raise ValueError(f"sim signals have {sim.n_steps} steps; the trajectory has {n}")
    start, end = float(t[0]), float(t[-1])
    n_windows = max(1, math.ceil((end - start - _EDGE_TOL) / window_s))
    idx = np.minimum(np.floor((t - start) / window_s + _EDGE_TOL).astype(int), n_windows - 1)

    a = traj.to_arrays()
    speed = speed_profile(traj)
    jerk = _jerk_norms(traj)
    dist = np.linalg.norm(a["ee_pos"] - sim.cube_pos, axis=1)
    windows = []
    for k in range(n_windows):
        m = idx == k
        windows.append(MetricsWindow(
            t0=start + k * window_s,
            t1=min(start + (k + 1) * window_s, end),
            speed=float(speed[m].mean()),
            jerk_rms=_rms(jerk[m]),
            gripper=int(a["gripper"][m].mean() >= 0.5),  # majority; a tie counts as closed
            dist_ee_cube=float(dist[m].mean()),
            cube_height=float(sim.cube_pos[m, 2].mean()),
            contact_gripper_cube=bool(sim.contact_gripper_cube[m].any()),
            contact_arm_bin=bool(sim.contact_arm_bin[m].any()),
            contact_arm_table=bool(sim.contact_arm_table[m].any()),
        ))
    return windows
