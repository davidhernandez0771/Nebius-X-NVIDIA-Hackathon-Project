"""demo_pipeline.repair: the repair menu (spec 8.4) and apply_repairs' fixed order + time mapping."""
from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.measure import gripper_events, jerk_rms
from demo_pipeline.repair import (
    DiscardDemo,
    apply_repairs,
    recenter_grasp,
    remove_pause,
    replan_transit,
    retime,
    smooth,
    trim,
)
from demo_pipeline.schemas import Discard, Pose, RemovePause, Retime, Scene, Smooth, Trajectory

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
WAYPOINTS = [np.array(p) for p in [
    (0.35, -0.10, 0.250),  # start
    (0.50, 0.00, 0.175),   # above the cube
    (0.50, 0.00, 0.025),   # at the cube
    (0.50, 0.00, 0.250),   # lifted
    (0.50, 0.30, 0.250),   # above the bin
    (0.50, 0.30, 0.180),   # in the bin
    (0.50, 0.30, 0.330),   # retreated
]]
# Timeline: approach 0-2.2, close hold 2.2-2.7 (close at 2.46), lift 2.7-4.2, carry 4.2-6.2,
# descend 6.2-7.2, open hold 7.2-7.7 (open at 7.46), retreat 7.7-8.7.
PLAN = [("move", 1, 1.2), ("move", 2, 1.0), ("hold", 1, 0.5), ("move", 3, 1.5),
        ("move", 4, 2.0), ("move", 5, 1.0), ("hold", 0, 0.5), ("move", 6, 1.0)]
SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=0)
RIM_Z = 0.08


def _clean_arrays():
    pos, grip, cur, g = [WAYPOINTS[0]], [0], WAYPOINTS[0], 0
    for kind, arg, secs in PLAN:
        n = int(round(secs / DT))
        if kind == "move":
            s = np.arange(1, n + 1) / n
            b = 10 * s**3 - 15 * s**4 + 6 * s**5
            pos += list(cur + (WAYPOINTS[arg] - cur) * b[:, None])
            grip += [g] * n
            cur = WAYPOINTS[arg]
        else:
            pos += [cur] * n
            grip += [g] * (n // 2) + [arg] * (n - n // 2)
            g = arg
    return np.array(pos), np.array(grip)


def _traj(pos, grip, quat=None) -> Trajectory:
    n = len(pos)
    return Trajectory.from_arrays(np.arange(n) * DT, pos, np.tile(IDENTITY, (n, 1)) if quat is None else quat, grip)


def _with_pause(noise_m: float = 0.0):
    """Clean demo with a 0.9 s hold inserted at t = 1.5 s (mid-descent): still from 1.5 to 2.4."""
    pos, grip = _clean_arrays()
    if noise_m:
        pos = pos + np.random.default_rng(5).normal(0.0, noise_m, size=pos.shape)
    k = 45
    pos = np.concatenate([pos[:76], np.repeat(pos[75:76], k, axis=0), pos[76:]])
    grip = np.concatenate([grip[:76], np.repeat(grip[75:76], k), grip[76:]])
    return _traj(pos, grip)


def _noisy(noise_m: float = 0.001, seed: int = 2) -> Trajectory:
    pos, grip = _clean_arrays()
    return _traj(pos + np.random.default_rng(seed).normal(0.0, noise_m, size=pos.shape), grip)


def _pos(tr: Trajectory) -> np.ndarray:
    return np.asarray(tr.ee_pos)


def _at(tr: Trajectory, t: float) -> int:
    return int(np.argmin(np.abs(np.asarray(tr.t) - t)))


def _transitions(tr: Trajectory) -> list[tuple[int, int]]:
    g = tr.gripper
    return [(a, b) for a, b in zip(g, g[1:]) if a != b]


def _assert_even_grid(tr: Trajectory):
    assert tr.t[0] == pytest.approx(0.0)
    assert np.allclose(np.diff(tr.t), DT)


def _dist_to_polyline(points: np.ndarray, poly: np.ndarray) -> np.ndarray:
    a, b = poly[:-1], poly[1:]
    ab = b - a
    len2 = np.maximum((ab**2).sum(axis=1), 1e-30)
    out = []
    for p in points:
        u = np.clip(((p - a) * ab).sum(axis=1) / len2, 0.0, 1.0)
        out.append(np.min(np.linalg.norm(a + u[:, None] * ab - p, axis=1)))
    return np.array(out)


# --- trim / remove_pause -----------------------------------------------------------

def test_trim_keeps_the_range_on_an_even_grid():
    tr = _traj(*_clean_arrays())
    out = trim(tr, 1.0, 8.0)
    _assert_even_grid(out)
    assert out.duration == pytest.approx(7.0, abs=DT)
    assert np.allclose(out.ee_pos[0], tr.ee_pos[_at(tr, 1.0)], atol=1e-9)


def test_trim_never_cuts_the_first_close_or_the_last_open():
    tr = _traj(*_clean_arrays())
    out = trim(tr, 3.0, 7.0)  # would cut both the close (2.46) and the open (7.46)
    assert _transitions(out) == [(0, 1), (1, 0)]


def test_remove_pause_shortens_by_pause_and_has_no_jump():
    tr = _with_pause()
    out = remove_pause(tr, 1.5, 2.4)
    _assert_even_grid(out)
    assert tr.duration - out.duration == pytest.approx(0.9, abs=0.04)
    assert np.max(np.linalg.norm(np.diff(_pos(out), axis=0), axis=1)) < 0.01
    assert _transitions(out) == _transitions(tr) == [(0, 1), (1, 0)]
    before, after = gripper_events(tr), gripper_events(out)
    assert after == pytest.approx((before[0] - 0.9, before[1] - 0.9), abs=0.04)


# --- smooth -----------------------------------------------------------------------

def test_smooth_reduces_jerk_and_keeps_event_poses():
    tr = _noisy()
    out = smooth(tr, 0.0, tr.duration, "med")
    _assert_even_grid(out)
    assert jerk_rms(out, 0.0, out.duration) < 0.5 * jerk_rms(tr, 0.0, tr.duration)
    for t_event in gripper_events(tr):
        i = _at(tr, t_event)
        assert np.linalg.norm(_pos(out)[i] - _pos(tr)[i]) < 1e-3
    assert out.gripper == tr.gripper


def test_smooth_only_changes_its_span():
    tr = _noisy()
    out = smooth(tr, 4.5, 6.0, "high")
    changed = np.flatnonzero(np.linalg.norm(_pos(out) - _pos(tr), axis=1) > 1e-12)
    assert changed.size > 0
    assert tr.t[changed[0]] >= 4.5 - 1e-9 and tr.t[changed[-1]] <= 6.0 + 1e-9


def test_smooth_handles_quaternion_sign_flips():
    # A slowly turning q (0.6 -> 0.8 rad about an oblique axis), sign flipped every other step.
    # With a constant q any signed average stays parallel to q, so the turn is what makes this bite.
    n = 100
    angle = 0.6 + 0.2 * np.arange(n) / (n - 1)
    axis = np.array([1.0, 1.0, 0.5]) / np.linalg.norm([1.0, 1.0, 0.5])
    q = np.column_stack([np.cos(angle / 2), np.sin(angle / 2)[:, None] * axis])
    quats = q * np.where(np.arange(n) % 2 == 0, 1.0, -1.0)[:, None]
    pos = np.stack([0.4 + 0.1 * np.arange(n) * DT, np.zeros(n), np.full(n, 0.2)], axis=1)
    tr = _traj(pos, np.zeros(n, int), quat=quats)
    out = np.asarray(smooth(tr, 0.0, tr.duration, "high").ee_quat)
    assert np.all(np.isfinite(out))
    assert np.allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-9)
    assert np.all(np.abs(np.sum(out * q, axis=1)) > 0.999)  # same rotation as q (q and -q are one rotation)


# --- retime -----------------------------------------------------------------------

def test_retime_keeps_shape_and_changes_duration():
    tr = _traj(*_clean_arrays())
    out = retime(tr, 4.2, 6.2, 0.3)  # the 0.30 m carry, 2.0 s -> 1.0 s
    _assert_even_grid(out)
    assert tr.duration - out.duration == pytest.approx(1.0, abs=DT)
    assert np.max(_dist_to_polyline(_pos(out), _pos(tr))) < 1e-9
    i0 = _at(out, 4.2)
    step_speed = np.linalg.norm(np.diff(_pos(out)[i0 : i0 + 51], axis=0), axis=1) / DT
    assert np.allclose(step_speed, 0.3, atol=1e-6)
    assert _transitions(out) == _transitions(tr)


# --- recenter_grasp ----------------------------------------------------------------

def test_recenter_grasp_closes_at_cube_center():
    tr = _traj(*_clean_arrays())
    cube = (0.52, -0.01, 0.025)  # 2 cm / 1 cm off from where the demo grasped
    t_close, _ = gripper_events(tr)
    out = recenter_grasp(tr, t_close + 0.06, cube)  # a slightly late time still anchors on the real close
    i = _at(out, t_close)
    assert out.gripper[i] == 1 and out.gripper[i - 1] == 0
    assert np.linalg.norm(_pos(out)[i, :2] - np.array(cube[:2])) < 0.002
    assert np.allclose(_pos(out)[:, 2], _pos(tr)[:, 2])  # z unchanged
    untouched = (np.asarray(tr.t) <= t_close - 1.0) | (np.asarray(tr.t) >= t_close + 2.0)
    assert np.allclose(_pos(out)[untouched], _pos(tr)[untouched], atol=1e-12)


# --- replan_transit -----------------------------------------------------------------

def test_replan_transit_clears_rim_and_keeps_endpoints():
    tr = _traj(*_clean_arrays())
    t0, t1 = 2.7, 7.2  # lift start (at the cube) .. descend end (in the bin); gripper closed throughout
    out = replan_transit(tr, t0, t1, bin_rim_z=0.2)
    _assert_even_grid(out)
    i0, i1 = _at(tr, t0), _at(tr, t1)
    n_tail = len(tr.t) - i1
    p, q = _pos(out), _pos(tr)
    assert np.allclose(p[: i0 + 1], q[: i0 + 1], atol=1e-6)  # up to and including the start pose
    assert np.allclose(p[-n_tail:], q[i1:], atol=1e-6)       # from the end pose on
    span = p[i0 : len(p) - n_tail + 1]
    away = (np.linalg.norm(span[:, :2] - q[i0, :2], axis=1) > 1e-6) & (np.linalg.norm(span[:, :2] - q[i1, :2], axis=1) > 1e-6)
    assert away.any()
    assert span[away, 2].min() >= 0.2 + 0.10 - 1e-6
    assert _transitions(out) == _transitions(tr)


def test_replan_transit_keeps_average_speed():
    tr = _traj(*_clean_arrays())
    i0, i1 = _at(tr, 2.7), _at(tr, 7.2)
    q = _pos(tr)
    v = np.linalg.norm(np.diff(q[i0 : i1 + 1], axis=0), axis=1).sum() / 4.5
    out = replan_transit(tr, 2.7, 7.2, bin_rim_z=0.2)
    # new path: up 0.275, across 0.30, down 0.12 (from z 0.30 to 0.18)
    new_len = 0.275 + 0.30 + 0.12
    assert out.duration - tr.duration == pytest.approx(new_len / v - 4.5, abs=DT)


def test_replan_transit_rejects_gripper_change_in_span():
    tr = _traj(*_clean_arrays())
    with pytest.raises(ValueError):
        replan_transit(tr, 2.0, 3.0, bin_rim_z=0.2)  # the close at 2.46 is inside


# --- apply_repairs ------------------------------------------------------------------

def test_apply_repairs_maps_times_after_pause_removal():
    tr = _with_pause(noise_m=0.001)
    ops = [RemovePause(op="remove_pause", t0=1.5, t1=2.4), Smooth(op="smooth", t0=3.0, t1=4.0, strength="med")]
    out = apply_repairs(tr, ops, SCENE, RIM_Z)
    ref = remove_pause(tr, 1.5, 2.4)
    changed = np.flatnonzero(np.linalg.norm(_pos(out) - _pos(ref), axis=1) > 1e-9)
    assert out.t[changed[0]] == pytest.approx(3.0 - 0.9, abs=0.04)
    assert out.t[changed[-1]] == pytest.approx(4.0 - 0.9, abs=0.04)


def test_apply_repairs_runs_in_fixed_order_regardless_of_list_order():
    tr = _noisy()
    rt = Retime(op="retime", t0=4.2, t1=6.2, target_speed=0.3)
    sm = Smooth(op="smooth", t0=3.5, t1=7.0, strength="high")
    a = apply_repairs(tr, [rt, sm], SCENE, RIM_Z)
    b = apply_repairs(tr, [sm, rt], SCENE, RIM_Z)
    want = retime(smooth(tr, 3.5, 7.0, "high"), 4.2, 6.2, 0.3)  # REPAIR_ORDER: smooth before retime
    assert np.allclose(_pos(a), _pos(want), atol=1e-12) and np.allclose(_pos(b), _pos(want), atol=1e-12)
    # list order would have smoothed the retimed path instead, which is a different trajectory
    wrong = smooth(retime(tr, 4.2, 6.2, 0.3), 3.5, 6.0, "high")
    assert len(wrong.t) != len(want.t) or not np.allclose(_pos(wrong), _pos(want), atol=1e-6)


def test_discard_raises():
    tr = _traj(*_clean_arrays())
    with pytest.raises(DiscardDemo):
        apply_repairs(tr, [Smooth(op="smooth", t0=1.0, t1=2.0), Discard(op="discard")], SCENE, RIM_Z)
