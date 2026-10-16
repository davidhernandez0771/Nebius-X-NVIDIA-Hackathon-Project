"""demo_pipeline.measure: speed, jerk, per-window metrics and gripper events (spec 8.2)."""
from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.measure import compute_windows, gripper_events, jerk_rms, smoothed_speed, speed_profile
from demo_pipeline.schemas import SimSignals, Trajectory

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _line(duration: float, speed: float = 0.1, gripper=None, noise_m: float = 0.0, seed: int = 0) -> Trajectory:
    n = int(round(duration / DT)) + 1
    t = np.arange(n) * DT
    pos = np.stack([0.4 + speed * t, np.zeros(n), np.full(n, 0.2)], axis=1)
    if noise_m:
        pos = pos + np.random.default_rng(seed).normal(0.0, noise_m, size=pos.shape)
    return Trajectory.from_arrays(t, pos, np.tile(IDENTITY, (n, 1)), gripper if gripper is not None else np.zeros(n, int))


def _sim(n: int, cube_pos=None, contact_arm_bin=None) -> SimSignals:
    return SimSignals(
        cube_pos=np.zeros((n, 3)) if cube_pos is None else cube_pos,
        contact_gripper_cube=np.zeros(n, bool),
        contact_arm_bin=np.zeros(n, bool) if contact_arm_bin is None else contact_arm_bin,
        contact_arm_table=np.zeros(n, bool),
        max_contact_force=np.zeros(n),
    )


def test_speed_of_constant_velocity_line_is_constant():
    tr = _line(2.0, speed=0.1)
    speed = speed_profile(tr)
    assert speed.shape == (len(tr.t),)
    assert np.allclose(speed, 0.1, atol=1e-9)


def test_speed_first_element_equals_second():
    # 0 -> 1 cm -> 3 cm: steps of 0.5 m/s then 1.0 m/s
    tr = Trajectory.from_arrays([0.0, 0.02, 0.04], [(0, 0, 0), (0.01, 0, 0), (0.03, 0, 0)], [IDENTITY] * 3, [0, 0, 0])
    assert speed_profile(tr) == pytest.approx([0.5, 0.5, 1.0])


def test_jerk_is_zero_for_constant_velocity_and_positive_for_noise():
    clean = jerk_rms(_line(2.0), 0.0, 2.0)
    noisy = jerk_rms(_line(2.0, noise_m=0.001), 0.0, 2.0)
    assert clean < 1e-6
    assert noisy > 10 * clean
    assert noisy > 1.0  # 1 mm noise at 50 Hz is tens of m/s^3, far from zero


def test_jerk_only_counts_steps_inside_the_range():
    tr = _line(2.0)
    pos = np.asarray(tr.ee_pos)
    pos[75:] += np.random.default_rng(1).normal(0.0, 0.001, size=pos[75:].shape)  # noise from t = 1.5 s
    noisy_tail = Trajectory.from_arrays(tr.t, pos, tr.ee_quat, tr.gripper)
    assert jerk_rms(noisy_tail, 0.0, 1.0) < 1e-6
    assert jerk_rms(noisy_tail, 1.6, 2.0) > 1.0


def test_windows_cover_demo_and_aggregate_signals():
    n = 111  # 2.2 s at 50 Hz
    gripper = np.zeros(n, int)
    gripper[25:36] = 1  # [0.50, 0.70] closed: 11 of the 25 steps in [0.5, 1.0) -> majority open
    gripper[50:70] = 1  # 20 of the 25 steps in [1.0, 1.5) closed -> majority closed
    tr = _line(2.2, speed=0.1, gripper=gripper)
    cube = np.zeros((n, 3))
    cube[:, 0] = 0.4
    cube[:, 2] = np.where(np.arange(n) < 50, 0.025, 0.125)  # lifted from t = 1.0 s
    contact = np.zeros(n, bool)
    contact[80] = True  # t = 1.6 s
    windows = compute_windows(tr, _sim(n, cube_pos=cube, contact_arm_bin=contact))

    assert [(w.t0, w.t1) for w in windows] == pytest.approx([(0.0, 0.5), (0.5, 1.0), (1.0, 1.5), (1.5, 2.0), (2.0, 2.2)])
    assert [w.contact_arm_bin for w in windows] == [False, False, False, True, False]
    assert [w.cube_height for w in windows] == pytest.approx([0.025, 0.025, 0.125, 0.125, 0.125])
    assert [w.gripper for w in windows] == [0, 0, 1, 0, 0]
    assert all(w.speed == pytest.approx(0.1) for w in windows)
    # ee is at x = 0.4 + 0.1 t, y = 0, z = 0.2; cube at x = 0.4, y = 0. First window: steps t = 0 .. 0.48
    t_first = np.arange(25) * DT
    want = np.mean(np.hypot(0.1 * t_first, 0.2 - 0.025))
    assert windows[0].dist_ee_cube == pytest.approx(want)


def test_windows_reject_sim_signals_of_another_length():
    with pytest.raises(ValueError):
        compute_windows(_line(1.0), _sim(10))


def test_gripper_events():
    tr = Trajectory.from_arrays(np.arange(5) * DT, np.zeros((5, 3)), [IDENTITY] * 5, [0, 0, 1, 1, 0])
    assert gripper_events(tr) == pytest.approx((0.04, 0.08))
    never = Trajectory.from_arrays(np.arange(5) * DT, np.zeros((5, 3)), [IDENTITY] * 5, [0] * 5)
    assert gripper_events(never) == (None, None)


def test_gripper_events_uses_last_open_after_regrasp_and_none_if_never_reopened():
    tr = Trajectory.from_arrays(np.arange(7) * DT, np.zeros((7, 3)), [IDENTITY] * 7, [0, 1, 0, 1, 1, 0, 0])
    assert gripper_events(tr) == pytest.approx((0.02, 0.10))
    held = Trajectory.from_arrays(np.arange(4) * DT, np.zeros((4, 3)), [IDENTITY] * 4, [0, 1, 1, 1])
    t_close, t_open = gripper_events(held)
    assert t_close == pytest.approx(0.02)
    assert t_open is None


# --- smoothed_speed: speed that tremor cannot hold above the still threshold -------------------

def _with_hold(hold_from: float, hold_s: float, duration: float = 4.0, speed: float = 0.1) -> Trajectory:
    """A line at `speed` that stops dead for hold_s seconds from hold_from."""
    n = int(round(duration / DT)) + 1
    t = np.arange(n) * DT
    moving = ~((t > hold_from + 1e-9) & (t <= hold_from + hold_s + 1e-9))
    moving[0] = False
    x = 0.4 + np.cumsum(np.where(moving, speed * DT, 0.0))
    pos = np.stack([x, np.zeros(n), np.full(n, 0.2)], axis=1)
    return Trajectory.from_arrays(t, pos, np.tile(IDENTITY, (n, 1)), np.zeros(n, int))


def test_smoothed_speed_with_zero_sigma_is_the_raw_speed():
    tr = _line(2.0, speed=0.1, noise_m=0.002)
    assert np.array_equal(smoothed_speed(tr, 0.0), speed_profile(tr))


def test_smoothed_speed_keeps_constant_velocity_up_to_both_ends():
    # a plain edge pad would slow the hand near the ends and fake idle time there
    tr = _line(2.0, speed=0.1)
    s = smoothed_speed(tr, 0.2)
    assert s.shape == (len(tr.t),)
    assert np.allclose(s, 0.1, atol=1e-9)


def test_smoothed_speed_puts_2_mm_tremor_well_below_the_still_threshold():
    tr = _line(4.0, speed=0.0, noise_m=0.002)  # holding still, 2 mm white noise
    assert np.median(speed_profile(tr)) > 0.1
    assert np.percentile(smoothed_speed(tr, 0.2), 99) < 0.01


def test_smoothed_speed_still_shows_a_hold_inside_motion():
    tr = _with_hold(hold_from=1.5, hold_s=1.0)
    s = smoothed_speed(tr, 0.2)
    t = np.asarray(tr.t)
    assert s[np.argmin(np.abs(t - 2.0))] < 0.002  # the middle of the hold
    assert s[np.argmin(np.abs(t - 0.6))] == pytest.approx(0.1, abs=1e-3)  # far from it
    assert s[np.argmin(np.abs(t - 3.4))] == pytest.approx(0.1, abs=1e-3)


def test_smoothed_speed_rejects_negative_sigma():
    with pytest.raises(ValueError):
        smoothed_speed(_line(1.0), -0.1)
