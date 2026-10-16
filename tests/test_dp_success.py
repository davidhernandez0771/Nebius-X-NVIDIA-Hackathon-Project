"""check_success (spec 8.5): one test per failure reason, plus a clean success.

Synthetic pick-place at 50 Hz: the ee goes to the cube, closes, carries it to the bin,
opens, and the cube drops onto the bin floor and rests there for 1 s.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, SimSignals, Trajectory
from demo_pipeline.success import check_success

DT = 0.02
BIN = Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0))
DOWN = (0.0, 1.0, 0.0, 0.0)

# (time, ee_pos, gripper from this key on)
KEYS = [
    (0.0, (0.5, 0.0, 0.2), 0),
    (1.0, (0.5, 0.0, 0.025), 1),  # close at the cube
    (2.0, (0.5, 0.0, 0.25), 1),
    (3.5, (0.5, 0.3, 0.25), 1),
    (4.5, (0.5, 0.3, 0.135), 0),  # open above the bin floor
    (5.0, (0.5, 0.3, 0.30), 0),
    (6.0, (0.5, 0.3, 0.30), 0),
]
CUBE_REST = np.array([0.5, 0.3, 0.035])


def _clean():
    t = np.arange(0.0, KEYS[-1][0] + 1e-9, DT)
    kt = [k[0] for k in KEYS]
    ee = np.stack([np.interp(t, kt, [k[1][i] for k in KEYS]) for i in range(3)], axis=1)
    grip = np.zeros(len(t), dtype=int)
    grip[(t >= 1.0 - 1e-9) & (t < 4.5 - 1e-9)] = 1
    cube = np.tile([0.5, 0.0, 0.025], (len(t), 1))
    held = grip == 1
    cube[held] = ee[held]
    after = t >= 4.5 - 1e-9
    # falls over 0.2 s from the release height to the floor, then rests
    fall = np.clip((t[after] - 4.5) / 0.2, 0.0, 1.0)[:, None]
    cube[after] = ee[np.argmax(after)] * (1 - fall) + CUBE_REST * fall
    traj = Trajectory.from_arrays(t, ee, np.tile(DOWN, (len(t), 1)), grip)
    n = len(t)
    sim = SimSignals(
        cube_pos=cube,
        contact_gripper_cube=held.copy(),
        contact_arm_bin=np.zeros(n, dtype=bool),
        contact_arm_table=np.zeros(n, dtype=bool),
        max_contact_force=np.zeros(n),
    )
    return traj, sim


def _replace(sim: SimSignals, **arrays) -> SimSignals:
    return dataclasses.replace(sim, **arrays)


def test_clean_success():
    traj, sim = _clean()
    res = check_success(traj, sim, BIN)
    assert res.success, res.reasons
    assert res.reasons == []
    assert res.duration == pytest.approx(6.0)
    # ee path: 0.175 down + 0.225 up + 0.3 across + 0.115 down + 0.165 up
    assert res.path_length == pytest.approx(0.98, abs=1e-6)
    assert res.max_contact_force == 0.0
    assert res.settle_time == pytest.approx(6.0 - 4.7, abs=DT + 1e-9)


def test_cube_outside_bin_is_not_in_bin():
    traj, sim = _clean()
    cube = sim.cube_pos.copy()
    cube[-60:] = [0.5, 0.45, 0.025]  # resting beside the bin
    res = check_success(traj, _replace(sim, cube_pos=cube), BIN)
    assert not res.success
    assert "not_in_bin" in res.reasons


def test_bin_yaw_is_respected():
    """A cube 0.12 m along world y from the bin center is outside an unrotated bin but
    inside one yawed 45 degrees (the inner box's diagonal half-length is 0.141 m)."""
    traj, sim = _clean()
    cube = sim.cube_pos.copy()
    cube[-60:] = [0.5, 0.42, 0.035]
    s = np.sin(np.pi / 8)
    yawed = Pose(pos=BIN.pos, quat_wxyz=(float(np.cos(np.pi / 8)), 0.0, 0.0, float(s)))
    assert "not_in_bin" in check_success(traj, _replace(sim, cube_pos=cube), BIN).reasons
    assert "not_in_bin" not in check_success(traj, _replace(sim, cube_pos=cube), yawed).reasons


def test_gripper_still_closed_at_end():
    traj, sim = _clean()
    arr = traj.to_arrays()
    arr["gripper"][-1] = 1
    traj2 = Trajectory.from_arrays(arr["t"], arr["ee_pos"], arr["ee_quat"], arr["gripper"])
    res = check_success(traj2, sim, BIN)
    assert not res.success
    assert "gripper_closed" in res.reasons


def test_cube_still_moving_is_not_settled():
    traj, sim = _clean()
    cube = sim.cube_pos.copy()
    cube[-10:, 0] += np.linspace(0.0, 0.01, 10)  # sliding 5 cm/s in the last 0.2 s
    res = check_success(traj, _replace(sim, cube_pos=cube), BIN)
    assert not res.success
    assert "not_settled" in res.reasons
    assert res.settle_time < 0.5


def test_too_slow():
    traj, sim = _clean()
    res = check_success(traj, sim, BIN, time_limit=5.0)
    assert not res.success
    assert res.reasons == ["too_slow"]


def test_hard_arm_contact_is_collision():
    traj, sim = _clean()
    bin_contact = sim.contact_arm_bin.copy()
    force = sim.max_contact_force.copy()
    bin_contact[200] = True
    force[200] = 12.0
    res = check_success(traj, _replace(sim, contact_arm_bin=bin_contact, max_contact_force=force), BIN)
    assert not res.success
    assert res.reasons == ["collision"]
    assert res.max_contact_force == pytest.approx(12.0)


def test_light_arm_contact_is_not_collision():
    traj, sim = _clean()
    table = sim.contact_arm_table.copy()
    force = sim.max_contact_force.copy()
    table[100] = True
    force[100] = 3.0
    res = check_success(traj, _replace(sim, contact_arm_table=table, max_contact_force=force), BIN)
    assert res.success, res.reasons


def test_losing_cube_before_bin_is_dropped():
    traj, sim = _clean()
    contact = sim.contact_gripper_cube.copy()
    contact[125:] = False  # lost during the lift at t = 2.5 s, gripper still closed
    res = check_success(traj, _replace(sim, contact_gripper_cube=contact), BIN)
    assert not res.success
    assert "dropped" in res.reasons


def test_losing_contact_above_bin_is_not_dropped():
    traj, sim = _clean()
    contact = sim.contact_gripper_cube.copy()
    contact[200:] = False  # t = 4.0 s, already over the bin footprint
    res = check_success(traj, _replace(sim, contact_gripper_cube=contact), BIN)
    assert res.success, res.reasons


def test_length_mismatch_raises():
    traj, sim = _clean()
    short = SimSignals(
        cube_pos=sim.cube_pos[:-1],
        contact_gripper_cube=sim.contact_gripper_cube[:-1],
        contact_arm_bin=sim.contact_arm_bin[:-1],
        contact_arm_table=sim.contact_arm_table[:-1],
        max_contact_force=sim.max_contact_force[:-1],
    )
    with pytest.raises(ValueError):
        check_success(traj, short, BIN)


def _tcp_error(n: int, start_s: float, dur_s: float, err: float = 0.03) -> np.ndarray:
    e = np.full(n, 0.002)
    i0 = round(start_s / DT)
    e[i0 : i0 + round(dur_s / DT)] = err
    return e


def test_ik_residual_over_2cm_for_more_than_1s_is_unreachable():
    traj, sim = _clean()
    res = check_success(traj, sim, BIN, tcp_error=_tcp_error(len(traj.t), 1.0, 1.2))
    assert not res.success
    assert "unreachable" in res.reasons


def test_short_ik_residual_spike_is_not_unreachable():
    traj, sim = _clean()
    res = check_success(traj, sim, BIN, tcp_error=_tcp_error(len(traj.t), 1.0, 0.8))
    assert res.success, res.reasons


def test_small_ik_residual_is_not_unreachable_however_long():
    traj, sim = _clean()
    res = check_success(traj, sim, BIN, tcp_error=_tcp_error(len(traj.t), 0.0, 5.0, err=0.015))
    assert res.success, res.reasons


def test_tcp_error_length_mismatch_raises():
    traj, sim = _clean()
    with pytest.raises(ValueError):
        check_success(traj, sim, BIN, tcp_error=np.zeros(len(traj.t) - 1))


# --- sprint 5 Task 2: injected drops and bad releases must fail verification ---


def _demo(keys, t_close, t_open, rest, fall_s=0.2):
    """Like _clean, with the keys, the open time and where the cube comes to rest as arguments."""
    t = np.arange(0.0, keys[-1][0] + 1e-9, DT)
    kt = [k[0] for k in keys]
    ee = np.stack([np.interp(t, kt, [k[1][i] for k in keys]) for i in range(3)], axis=1)
    grip = ((t >= t_close - 1e-9) & (t < t_open - 1e-9)).astype(int)
    cube = np.tile([0.5, 0.0, 0.025], (len(t), 1))
    held = grip == 1
    cube[held] = ee[held]
    after = t >= t_open - 1e-9
    fall = np.clip((t[after] - t_open) / fall_s, 0.0, 1.0)[:, None]
    cube[after] = ee[np.argmax(after)] * (1 - fall) + np.asarray(rest) * fall
    n = len(t)
    traj = Trajectory.from_arrays(t, ee, np.tile(DOWN, (n, 1)), grip)
    sim = SimSignals(cube_pos=cube, contact_gripper_cube=held.copy(), contact_arm_bin=np.zeros(n, dtype=bool),
                     contact_arm_table=np.zeros(n, dtype=bool), max_contact_force=np.zeros(n))
    return traj, sim


def test_gripper_opened_mid_carry_fails_with_the_cube_on_the_table():
    """T1's drop: the gripper opens mid-carry, >= 5 cm from the bin footprint; the rest of the demo goes on."""
    keys = [(0.0, (0.5, 0.0, 0.2)), (1.0, (0.5, 0.0, 0.025)), (2.0, (0.5, 0.0, 0.25)), (2.6, (0.5, 0.1, 0.25)),
            (3.5, (0.5, 0.3, 0.25)), (4.5, (0.5, 0.3, 0.135)), (5.0, (0.5, 0.3, 0.30)), (6.0, (0.5, 0.3, 0.30))]
    traj, sim = _demo(keys, t_close=1.0, t_open=2.6, rest=(0.5, 0.11, 0.025), fall_s=0.25)
    res = check_success(traj, sim, BIN)
    assert not res.success
    assert "not_in_bin" in res.reasons


def test_release_beside_the_bin_fails_not_in_bin():
    """T1's bad_release, first kind: the gripper opens clearly outside the bin footprint."""
    keys = [(0.0, (0.5, 0.0, 0.2)), (1.0, (0.5, 0.0, 0.025)), (2.0, (0.5, 0.0, 0.25)), (3.5, (0.5, 0.15, 0.25)),
            (4.5, (0.5, 0.15, 0.135)), (5.0, (0.5, 0.15, 0.30)), (6.0, (0.5, 0.15, 0.30))]
    traj, sim = _demo(keys, t_close=1.0, t_open=4.5, rest=(0.5, 0.15, 0.025))
    res = check_success(traj, sim, BIN)
    assert not res.success
    assert res.reasons == ["not_in_bin"]


def test_opening_at_carry_height_over_the_bin_is_a_high_release_even_if_the_cube_lands_in_it():
    """T1's bad_release, second kind: no descent, the cube falls ~0.2 m. It can land in the bin, so in_bin alone
    would call this a success."""
    keys = [(0.0, (0.5, 0.0, 0.2)), (1.0, (0.5, 0.0, 0.025)), (2.0, (0.5, 0.0, 0.25)), (3.5, (0.5, 0.3, 0.25)),
            (4.0, (0.5, 0.3, 0.25)), (5.0, (0.5, 0.3, 0.30)), (6.0, (0.5, 0.3, 0.30))]
    traj, sim = _demo(keys, t_close=1.0, t_open=4.0, rest=CUBE_REST, fall_s=0.25)
    res = check_success(traj, sim, BIN)
    assert not res.success
    assert res.reasons == ["high_release"]


@pytest.mark.parametrize("cube_z,flagged", [(0.10, False), (0.135, False), (0.17, False), (0.19, True), (0.25, True)])
def test_high_release_threshold_is_the_cube_center_018_m_above_the_bin(cube_z, flagged):
    """The scripted expert opens with the cube center 0.10 m above the bin origin; the fixture above, 0.135."""
    keys = [(0.0, (0.5, 0.0, 0.2)), (1.0, (0.5, 0.0, 0.025)), (2.0, (0.5, 0.0, 0.25)), (3.5, (0.5, 0.3, 0.25)),
            (4.5, (0.5, 0.3, cube_z)), (5.0, (0.5, 0.3, 0.30)), (6.0, (0.5, 0.3, 0.30))]
    traj, sim = _demo(keys, t_close=1.0, t_open=4.5, rest=CUBE_REST)
    assert ("high_release" in check_success(traj, sim, BIN).reasons) is flagged


def test_high_release_measures_the_cube_not_the_hand():
    """A cube that already fell out of the hand is not released high, wherever the hand opens."""
    keys = [(0.0, (0.5, 0.0, 0.2)), (1.0, (0.5, 0.0, 0.025)), (2.0, (0.5, 0.0, 0.25)), (3.5, (0.5, 0.3, 0.25)),
            (4.0, (0.5, 0.3, 0.25)), (5.0, (0.5, 0.3, 0.30)), (6.0, (0.5, 0.3, 0.30))]
    traj, sim = _demo(keys, t_close=1.0, t_open=4.0, rest=CUBE_REST)
    cube = sim.cube_pos.copy()
    t = np.asarray(traj.t)
    cube[t >= 3.0 - 1e-9] = CUBE_REST  # slipped into the bin a second before the open
    contact = sim.contact_gripper_cube & (t < 3.0 - 1e-9)
    res = check_success(traj, _replace(sim, cube_pos=cube, contact_gripper_cube=contact), BIN)
    assert "high_release" not in res.reasons
