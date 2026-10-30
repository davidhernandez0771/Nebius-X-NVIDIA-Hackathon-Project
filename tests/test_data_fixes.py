"""The data recipe's fixes applied to a variant's trajectory (demo_pipeline.data_fixes): slow_carry, recenter_grasp,
filter_training, and their wiring into sim_worker.jobs.run_multiply."""
from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.data_fixes import (
    TRAINING_FEATURES, apply_fixes, fix_errors, keeps, recenter_grasp, slow_carry, training_features,
)
from demo_pipeline.data_recipe import DataRecipe, Fix, MechanismClaim, mechanism_errors
from demo_pipeline.schemas import Pose, Scene, Trajectory

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
CUBE = (0.5, 0.1, 0.025)
BIN = (0.55, -0.2, 0.0)


def _scene(seed: int = 300) -> Scene:
    return Scene(cube_pose=Pose(pos=CUBE, quat_wxyz=IDENTITY), bin_pose=Pose(pos=BIN, quat_wxyz=IDENTITY),
                 robot="franka", seed=seed)


def _lerp(a, b, n):
    return np.linspace(np.asarray(a, float), np.asarray(b, float), n)


def _traj(offset=(0.0, 0.0), carry_n: int = 20) -> Trajectory:
    """approach 60, hold closed 20 (close at step 60), lift 20, carry carry_n (fewer = faster), lower 20, open, rest 30.
    offset: the grasp's xy offset from the cube centre (m)."""
    grasp = np.array([CUBE[0] + offset[0], CUBE[1] + offset[1], 0.03])
    above_cube, above_bin, place = grasp + [0, 0, 0.15], np.array([BIN[0], BIN[1], 0.18]), np.array([BIN[0], BIN[1], 0.1])
    parts = [_lerp([0.3, 0.0, 0.3], grasp, 60), np.repeat(grasp[None], 20, 0), _lerp(grasp, above_cube, 20),
             _lerp(above_cube, above_bin, carry_n), _lerp(above_bin, place, 20), np.repeat(place[None], 31, 0)]
    pos = np.vstack(parts)
    n = len(pos)
    g = np.zeros(n, int)
    g[60:n - 30] = 1
    return Trajectory.from_arrays(np.arange(n) * DT, pos, np.tile(IDENTITY, (n, 1)), g)


def _speeds(traj: Trajectory) -> np.ndarray:
    return np.linalg.norm(np.diff(np.asarray(traj.ee_pos), axis=0), axis=1) / DT


def _closed_span(traj: Trajectory) -> tuple[int, int]:
    g = np.asarray(traj.gripper)
    on = np.flatnonzero(g == 1)
    return int(on[0]), int(on[-1])


# ---- slow_carry ----------------------------------------------------------------------------------------------------

def test_slow_carry_caps_the_held_speed_on_the_same_path_and_keeps_the_gripper_events():
    traj = _traj(carry_n=8)  # a fast carry, ~2 m/s
    i0, i1 = _closed_span(traj)
    assert _speeds(traj)[i0:i1].max() > 1.0
    out, rep = slow_carry(traj, 0.3)
    j0, j1 = _closed_span(out)
    assert j0 == i0  # the close happens at the same step
    assert _speeds(out)[j0:j1].max() <= 0.3 + 1e-9
    assert rep["applied"] and rep["speed_max_before"] > 1.0 and rep["speed_max_after"] <= 0.3 + 1e-9
    assert rep["carry_s_after"] > rep["carry_s_before"]
    np.testing.assert_allclose(out.t, np.arange(len(out.t)) * DT, atol=1e-9)  # still 50 Hz from 0
    # the same path: every new point lies on the old polyline, and both ends are the old ones
    old, new = np.asarray(traj.ee_pos)[i0:i1 + 1], np.asarray(out.ee_pos)[j0:j1 + 1]
    np.testing.assert_allclose(new[[0, -1]], old[[0, -1]], atol=1e-12)
    seg_a, seg_b = old[:-1], old[1:]
    for p in new:
        d = seg_b - seg_a
        u = np.clip(np.einsum("ij,ij->i", p - seg_a, d) / np.maximum(np.einsum("ij,ij->i", d, d), 1e-18), 0, 1)
        assert np.min(np.linalg.norm(seg_a + u[:, None] * d - p, axis=1)) < 1e-9
    # before the close and after the open, nothing changed
    np.testing.assert_allclose(np.asarray(out.ee_pos)[:i0], np.asarray(traj.ee_pos)[:i0])
    np.testing.assert_allclose(np.asarray(out.ee_pos)[j1 + 1:], np.asarray(traj.ee_pos)[i1 + 1:])
    assert list(out.gripper[j1 + 1:]) == list(traj.gripper[i1 + 1:])


def test_slow_carry_is_a_no_op_when_already_under_the_cap():
    traj = _traj(carry_n=200)
    out, rep = slow_carry(traj, 0.9)
    assert out == traj and not rep["applied"] and rep["why"] == "already under the cap"


def test_slow_carry_without_a_close_and_open_changes_nothing():
    traj = _traj()
    open_only = Trajectory.from_arrays(traj.t, traj.ee_pos, traj.ee_quat, [0] * len(traj.t))
    out, rep = slow_carry(open_only, 0.3)
    assert out == open_only and not rep["applied"]


@pytest.mark.parametrize("bad", [0.0, -0.1, 0.01, 2.0, math.nan, math.inf])
def test_slow_carry_refuses_a_cap_outside_the_range(bad):
    with pytest.raises(ValueError, match="max_speed_mps"):
        slow_carry(_traj(), bad)


# ---- recenter_grasp ------------------------------------------------------------------------------------------------

def test_recenter_grasp_puts_the_close_over_the_cube_and_blends_back():
    traj = _traj(offset=(0.02, -0.015))
    out, rep = recenter_grasp(traj, _scene())
    i0, _ = _closed_span(out)
    assert rep["applied"] and rep["shift_mm"] == pytest.approx(25.0, abs=0.1)
    assert np.hypot(*(np.asarray(out.ee_pos)[i0, :2] - CUBE[:2])) < 1e-6
    assert np.max(np.linalg.norm(np.diff(np.asarray(out.ee_pos), axis=0), axis=1)) < 0.02  # no jump
    np.testing.assert_allclose(out.ee_pos[0], traj.ee_pos[0])  # the start and the end are the original ones
    np.testing.assert_allclose(out.ee_pos[-1], traj.ee_pos[-1])
    assert out.gripper == traj.gripper and len(out.t) == len(traj.t)


def test_recenter_grasp_on_a_centred_grasp_is_a_no_op():
    traj = _traj()
    out, rep = recenter_grasp(traj, _scene())
    assert out == traj and not rep["applied"] and rep["shift_mm"] < 0.5


# ---- filter_training -----------------------------------------------------------------------------------------------

def test_training_features_measure_the_commanded_path():
    f = training_features(_traj(offset=(0.03, 0.04), carry_n=10), _scene())
    assert f["grasp_offset_xy"] == pytest.approx(0.05)
    assert f["grasp_height"] == pytest.approx(0.03 - CUBE[2])
    assert f["n_closes"] == 1 and f["t_first_close"] == pytest.approx(60 * DT)
    assert f["carry_speed_max"] > f["carry_speed_median"] > 0
    assert 0 < f["min_reach_dist"] <= f["grasp_offset_xy"]  # the approach line passes nearer the cube than the grasp
    assert set(f) == set(TRAINING_FEATURES)


@pytest.mark.parametrize("keep, threshold, kept", [("below", 1.0, False), ("below", 5.0, True),
                                                   ("above", 1.0, True), ("above", 5.0, False)])
def test_filter_keeps_by_the_measured_feature(keep, threshold, kept):
    fix = Fix(lever="filter_training", addresses=["carry_speed_max"], feature="carry_speed_max", keep=keep,
              threshold=threshold, rationale="r")
    f = training_features(_traj(carry_n=8), _scene())  # carry_speed_max ~2.2 m/s
    assert 1.0 < f["carry_speed_max"] < 5.0
    assert keeps(fix, f) is kept


def test_a_feature_the_trajectory_cannot_show_is_refused_with_a_reason():
    fix = Fix(lever="filter_training", addresses=["held_s"], feature="held_s", keep="above", threshold=1.0,
              rationale="r")
    assert any("held_s" in e and "simulator" in e for e in fix_errors([fix]))
    with pytest.raises(ValueError, match="held_s"):
        apply_fixes(_traj(), _scene(), [fix])


def test_the_analyst_is_told_a_filter_on_an_unmeasurable_feature_cannot_run():
    rec = DataRecipe(summary="s", mechanism=[MechanismClaim(feature="max_lift", direction="lower_in_failures",
                                                            explanation="e")],
                     fixes=[Fix(lever="filter_training", addresses=["max_lift"], feature="max_lift", keep="above",
                                threshold=0.05, rationale="r")], uniform_share=1.0)
    assert any("max_lift" in e and "training" in e for e in mechanism_errors(rec, []))


# ---- all together ----------------------------------------------------------------------------------------------------

def test_apply_fixes_runs_recenter_then_slow_then_filter_and_reports_each():
    fixes = [Fix(lever="filter_training", addresses=["carry_speed_max"], feature="carry_speed_max", keep="below",
                 threshold=0.35, rationale="r"),
             Fix(lever="slow_carry", addresses=["carry_speed_max"], max_speed_mps=0.3, rationale="r"),
             Fix(lever="recenter_grasp", addresses=["grasp_offset_xy"], rationale="r")]
    out, reports, kept = apply_fixes(_traj(offset=(0.02, 0.0), carry_n=8), _scene(), fixes)
    assert [r["lever"] for r in reports] == ["recenter_grasp", "slow_carry", "filter_training"]
    assert kept and reports[2]["kept"] and reports[2]["value"] <= 0.3 + 1e-9  # measured after the slow-down
    i0, _ = _closed_span(out)
    assert np.hypot(*(np.asarray(out.ee_pos)[i0, :2] - CUBE[:2])) < 1e-6


def test_no_fixes_change_nothing():
    traj = _traj()
    assert apply_fixes(traj, _scene(), []) == (traj, [], True)


@pytest.mark.parametrize("fix, needle", [
    (Fix(lever="slow_carry", addresses=["a"], rationale="r"), "max_speed_mps"),
    (Fix(lever="filter_training", addresses=["a"], feature="grasp_offset_xy", rationale="r"), "keep"),
    (Fix(lever="filter_training", addresses=["a"], feature="grasp_offset_xy", keep="below", threshold=math.nan,
         rationale="r"), "finite"),
    (Fix(lever="filter_training", addresses=["a"], feature="nope", keep="below", threshold=1.0, rationale="r"), "nope"),
])
def test_bad_fix_settings_are_refused(fix, needle):
    assert any(needle in e for e in fix_errors([fix]))


# ---- the sim worker's /multiply ------------------------------------------------------------------------------------

def test_run_multiply_applies_the_fixes_before_each_replay_and_skips_filtered_ones(tmp_path):
    from demo_pipeline.schemas import VerificationResult
    from demo_pipeline.sim_protocol import MultiplyRequest
    from sim_worker.jobs import run_multiply

    replayed = []

    def replay_fn(traj, scene, ep, record_cameras):
        replayed.append(traj)
        ep.mkdir(parents=True, exist_ok=True)
        v = VerificationResult(success=True, reasons=[], duration=traj.duration, path_length=0.0,
                               max_contact_force=0.0)
        return v, None, traj

    slow = Fix(lever="slow_carry", addresses=["carry_speed_max"], max_speed_mps=0.3, rationale="r")
    req = MultiplyRequest(trajectory=_traj(carry_n=8), scene=_scene(), robot="franka", n=3, seed0=300,
                          out_prefix="fx", fixes=[slow])
    resp = run_multiply(req, replay_fn, root=tmp_path, worker_robot="franka", worker_cameras=False, log=lambda m: None)
    assert resp.attempts == 3 and len(replayed) == 3
    for traj in replayed:
        i0, i1 = _closed_span(traj)
        assert _speeds(traj)[i0:i1].max() <= 0.3 + 1e-9
    assert all(v.fixes and v.fixes[0]["lever"] == "slow_carry" for v in resp.variants)

    drop_all = Fix(lever="filter_training", addresses=["carry_speed_max"], feature="carry_speed_max", keep="above",
                   threshold=50.0, rationale="r")
    replayed.clear()
    req2 = req.model_copy(update={"fixes": [drop_all], "out_prefix": "fx2"})
    resp2 = run_multiply(req2, replay_fn, root=tmp_path, worker_robot="franka", worker_cameras=False,
                         log=lambda m: None)
    assert not replayed and resp2.successes == 0 and all(v.verification.reasons == ["filtered"] for v in resp2.variants)


def test_a_multiply_request_refuses_bad_fixes():
    from pydantic import ValidationError
    from demo_pipeline.sim_protocol import MultiplyRequest

    with pytest.raises(ValidationError, match="max_speed_mps"):
        MultiplyRequest(trajectory=_traj(), scene=_scene(), robot="franka", n=1, seed0=300, out_prefix="x",
                        fixes=[Fix(lever="slow_carry", addresses=["a"], max_speed_mps=5.0, rationale="r")])
