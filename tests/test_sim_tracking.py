"""sim_worker.tracking: the pure parts of the IK-lag options (no sim needed)."""

from __future__ import annotations

import numpy as np
import pytest
import torch

from sim_worker.tracking import (
    TrackingOptions,
    dls_iterate,
    gate_hold,
    lookahead_index,
    tracking_stats,
)


def test_default_options_are_velocity_feedforward_only():
    """Measured best (T2 note, sprint 2 Task 2): it leaves the recorded demo unchanged."""
    o = TrackingOptions()
    assert (o.lookahead, o.ik_iters, o.gate_tol, o.vel_ff) == (0, 1, None, True)


@pytest.mark.parametrize("kw", [{"lookahead": -1}, {"ik_iters": 0}, {"gate_tol": 0.0}, {"gate_max_s": -0.1}])
def test_options_reject_nonsense(kw):
    with pytest.raises(ValueError):
        TrackingOptions(**kw)


@pytest.mark.parametrize("k, n, la, want", [(0, 10, 0, 0), (3, 10, 5, 8), (7, 10, 5, 9), (9, 10, 3, 9)])
def test_lookahead_index_clamps_to_the_last_sample(k, n, la, want):
    assert lookahead_index(k, n, la) == want


def test_gate_off_never_holds():
    assert not gate_hold(0, 1, err=0.05, waited_steps=0, opts=TrackingOptions())


def test_gate_holds_a_gripper_change_while_the_tcp_is_off_target():
    o = TrackingOptions(gate_tol=0.005, gate_max_s=0.5)
    assert gate_hold(0, 1, err=0.016, waited_steps=0, opts=o)
    assert gate_hold(1, 0, err=0.006, waited_steps=3, opts=o)


def test_gate_releases_on_target_or_after_the_max_wait():
    o = TrackingOptions(gate_tol=0.005, gate_max_s=0.5)
    assert not gate_hold(0, 1, err=0.004, waited_steps=0, opts=o)
    assert not gate_hold(0, 1, err=0.05, waited_steps=25, opts=o)  # 25 steps x 0.02 s = 0.5 s


def test_gate_ignores_steps_without_a_gripper_change():
    o = TrackingOptions(gate_tol=0.005)
    assert not gate_hold(1, 1, err=0.05, waited_steps=0, opts=o)


def test_one_dls_iteration_matches_the_damped_formula():
    g = torch.Generator().manual_seed(0)
    jac = torch.randn(1, 6, 7, generator=g, dtype=torch.float64)
    err = torch.randn(1, 6, generator=g, dtype=torch.float64) * 0.01
    lam = 0.01
    jt = jac.transpose(1, 2)
    want = (jt @ torch.inverse(jac @ jt + lam**2 * torch.eye(6, dtype=torch.float64)) @ err.unsqueeze(-1)).squeeze(-1)
    assert torch.allclose(dls_iterate(jac, err, lam, iters=1), want)


def test_more_dls_iterations_shrink_the_linear_residual():
    g = torch.Generator().manual_seed(1)
    jac = torch.randn(1, 6, 7, generator=g, dtype=torch.float64)
    jac[:, :, 0] *= 1e-3  # badly conditioned, so damping leaves a residual after one step
    jac[:, 5, :] *= 1e-2
    err = torch.randn(1, 6, generator=g, dtype=torch.float64) * 0.01
    res = [torch.linalg.norm(err - (jac @ dls_iterate(jac, err, 0.01, iters=i).unsqueeze(-1)).squeeze(-1)) for i in (1, 4)]
    assert res[1] < res[0]


def test_tracking_stats_reports_mean_max_and_error_at_the_close():
    cmd = np.zeros((6, 3))
    tcp = np.zeros((6, 3))
    tcp[:, 2] = [0.0, 0.010, 0.016, 0.004, 0.0, 0.002]
    grip = np.array([0, 0, 1, 1, 0, 0])
    s = tracking_stats(cmd, tcp, grip)
    assert s["mean_mm"] == pytest.approx(32 / 6)
    assert s["max_mm"] == pytest.approx(16.0)
    assert s["close_mm"] == pytest.approx(16.0)
    assert s["open_mm"] == pytest.approx(0.0)


def test_tracking_stats_without_a_close_reports_none():
    s = tracking_stats(np.zeros((3, 3)), np.zeros((3, 3)), np.zeros(3, dtype=int))
    assert s["close_mm"] is None and s["open_mm"] is None


def _parse(argv):
    import argparse

    from sim_worker.tracking import add_tracking_args, options_from_args

    p = argparse.ArgumentParser()
    add_tracking_args(p)
    return options_from_args(p.parse_args(argv))


def test_cli_defaults_match_the_default_options():
    assert _parse([]) == TrackingOptions()


def test_cli_flags_select_every_option():
    o = _parse(["--lookahead", "5", "--ik-iters", "4", "--gate-mm", "5", "--gate-max-s", "0.3", "--no-vel-ff"])
    assert o == TrackingOptions(lookahead=5, ik_iters=4, gate_tol=0.005, gate_max_s=0.3, vel_ff=False)
    assert _parse(["--vel-ff"]).vel_ff is True


def test_cli_gate_zero_means_off():
    assert _parse(["--gate-mm", "0"]).gate_tol is None
