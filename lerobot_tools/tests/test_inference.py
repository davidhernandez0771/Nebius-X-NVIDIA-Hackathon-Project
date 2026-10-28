"""lerobot_tools.inference: eval-time policy options, all off by default so pre-registered evals are unchanged.

From the 2026-10-20 research note (docs/superpowers/notes/2026-10-20-research-cube-in-bin.md, Part 3 (c), Stage 0):
binarize the gripper, re-plan every N steps instead of running each 100-step chunk open loop, or ACT's temporal
ensembling (which re-queries every step)."""

from __future__ import annotations

import argparse
from types import SimpleNamespace

import numpy as np
import pytest

from lerobot_tools.inference import (
    GRIPPER_THRESHOLD,
    GripperBinarizer,
    GripperHysteresis,
    InferenceOptions,
    add_inference_args,
    apply_to_config,
    binarize_gripper,
    served_problems,
    wrap_gripper,
)


def _parse(*argv: str) -> InferenceOptions:
    p = argparse.ArgumentParser()
    add_inference_args(p)
    return InferenceOptions.from_args(p.parse_args(list(argv)))


def test_the_defaults_change_nothing():
    opts = _parse()
    assert opts == InferenceOptions() and opts.is_default
    assert opts.server_args() == [] and opts.run_eval_args() == []
    assert opts.record() == {"binarize_gripper": False, "n_action_steps": None, "temporal_ensemble_coeff": None}


def test_flags_parse_and_pass_on():
    opts = _parse("--binarize-gripper", "--n-action-steps", "20")
    assert opts == InferenceOptions(binarize_gripper=True, n_action_steps=20) and not opts.is_default
    assert opts.server_args() == ["--n-action-steps", "20"]  # binarizing happens on the eval side
    assert opts.run_eval_args() == ["--binarize-gripper", "--n-action-steps", "20"]
    assert _parse("--temporal-ensemble", "0.01").server_args() == ["--temporal-ensemble", "0.01"]


def test_temporal_ensembling_implies_querying_every_step():
    opts = _parse("--temporal-ensemble", "0.01")
    assert opts.effective_n_action_steps == 1
    assert _parse("--temporal-ensemble", "0.01", "--n-action-steps", "1").effective_n_action_steps == 1
    with pytest.raises(ValueError, match="re-queries every step"):
        InferenceOptions(n_action_steps=20, temporal_ensemble_coeff=0.01).validate()


@pytest.mark.parametrize("bad", [InferenceOptions(n_action_steps=0), InferenceOptions(temporal_ensemble_coeff=-0.1)])
def test_bad_values_are_refused(bad):
    with pytest.raises(ValueError):
        bad.validate()


def test_binarize_thresholds_the_fingers_at_the_label_midpoint():
    assert GRIPPER_THRESHOLD == pytest.approx(0.02)  # labels are exactly 0.0 (closed) or 0.04 m (open)
    arm = np.arange(7, dtype=np.float64) * 0.1
    for fingers, want in (([0.035, 0.03], 0.04), ([0.021, 0.0201], 0.04), ([0.019, 0.02], 0.0), ([0.005, 0.0], 0.0)):
        a = np.concatenate([arm, fingers])
        out = binarize_gripper(a)
        assert out[7] == out[8] == want
        np.testing.assert_array_equal(out[:7], arm)  # the arm is untouched
        assert a[7] == fingers[0]  # and the input is not modified


def test_the_binarizer_wraps_any_policy():
    class Fake:
        def __init__(self):
            self.resets = 0

        def reset(self):
            self.resets += 1

        def act(self, state, images):
            return np.array([0.0] * 7 + [0.012, 0.011])

    inner = Fake()
    policy = GripperBinarizer(inner)
    policy.reset()
    assert inner.resets == 1
    assert policy.act(np.zeros(9), {}).tolist()[7:] == [0.0, 0.0]


def _act_cfg(**kw):
    return SimpleNamespace(type="act", chunk_size=100, n_action_steps=100, temporal_ensemble_coeff=None, **kw)


def test_apply_to_config_sets_only_what_was_asked():
    cfg = _act_cfg()
    assert apply_to_config(cfg, InferenceOptions()) == {}
    assert (cfg.n_action_steps, cfg.temporal_ensemble_coeff) == (100, None)

    cfg = _act_cfg()
    assert apply_to_config(cfg, InferenceOptions(n_action_steps=20)) == {"n_action_steps": 20}
    assert cfg.n_action_steps == 20

    cfg = _act_cfg()
    assert apply_to_config(cfg, InferenceOptions(temporal_ensemble_coeff=0.01)) == {
        "n_action_steps": 1, "temporal_ensemble_coeff": 0.01}
    assert (cfg.n_action_steps, cfg.temporal_ensemble_coeff) == (1, 0.01)


def test_apply_to_config_refuses_what_the_checkpoint_cannot_do():
    with pytest.raises(ValueError, match="chunk_size"):
        apply_to_config(_act_cfg(), InferenceOptions(n_action_steps=101))
    no_ensembling = SimpleNamespace(type="diffusion", n_action_steps=8)
    with pytest.raises(ValueError, match="temporal ensembling"):
        apply_to_config(no_ensembling, InferenceOptions(temporal_ensemble_coeff=0.01))


def test_served_problems_compares_the_server_with_the_request():
    plain = {"inference": {"overrides": {}, "n_action_steps": 100, "temporal_ensemble_coeff": None}}
    tuned = {"inference": {"overrides": {"n_action_steps": 20}, "n_action_steps": 20, "temporal_ensemble_coeff": None}}
    assert served_problems(InferenceOptions(), plain) == []
    assert served_problems(InferenceOptions(binarize_gripper=True), plain) == []  # eval side only
    assert served_problems(InferenceOptions(n_action_steps=20), tuned) == []
    assert served_problems(InferenceOptions(), tuned)  # a tuned server must not pass for a plain eval
    assert served_problems(InferenceOptions(n_action_steps=20), plain)
    assert served_problems(InferenceOptions(n_action_steps=20), {})  # an old server that can't say
    assert served_problems(InferenceOptions(), {}) == []  # but a plain eval of an old server is fine


# --- the teacher's deadband (the 2026-10-23 big test) ----------------------------------------------------------------

def _fingers(f: float) -> np.ndarray:
    return np.array([0.1] * 7 + [f, f])


class _Seq:
    """A policy that sends the given finger targets, one per act()."""

    def __init__(self, fingers):
        self.fingers, self.i, self.resets = list(fingers), 0, 0

    def reset(self):
        self.resets += 1

    def act(self, state, images):
        self.i += 1
        return _fingers(self.fingers[self.i - 1])


def test_the_deadband_flag_parses_reaches_run_eval_only_and_is_recorded():
    opts = _parse("--gripper-deadband", "0.25")
    assert opts == InferenceOptions(gripper_deadband=0.25) and not opts.is_default
    assert opts.server_args() == []  # eval side, like --binarize-gripper
    assert opts.run_eval_args() == ["--gripper-deadband", "0.25"]
    assert opts.record() == {"binarize_gripper": False, "n_action_steps": None, "temporal_ensemble_coeff": None,
                             "gripper_deadband": 0.25}
    assert "gripper_deadband" not in InferenceOptions().record()  # older evals' records stay as they were


@pytest.mark.parametrize("bad", [InferenceOptions(gripper_deadband=-0.1), InferenceOptions(gripper_deadband=1.0),
                                 InferenceOptions(gripper_deadband=0.25, binarize_gripper=True)])
def test_bad_deadbands_are_refused(bad):
    with pytest.raises(ValueError):
        bad.validate()


def test_the_deadband_is_the_teachers_hysteresis_in_finger_metres():
    """0.25 of the half range around 20 mm: closed below 15 mm, open above 25 mm, in between the last state holds;
    every episode starts open. Output is exactly 0.0 or 0.04 m on both fingers; the arm is untouched."""
    seq = [0.030, 0.016, 0.0149, 0.020, 0.0249, 0.0251, 0.017, 0.010, 0.040]
    want = [0.04, 0.04, 0.0, 0.0, 0.0, 0.04, 0.04, 0.0, 0.04]
    inner = _Seq(seq + [0.020])
    policy = GripperHysteresis(inner, 0.25)
    policy.reset()
    got = []
    for _ in seq:
        out = policy.act(np.zeros(9), {})
        np.testing.assert_array_equal(out[:7], [0.1] * 7)
        assert out[7] == out[8]
        got.append(out[7])
    assert got == want
    assert policy.thresholds == pytest.approx((0.015, 0.025))
    policy.reset()  # a new episode starts open, whatever the last one ended with
    assert inner.resets == 2 and policy.act(np.zeros(9), {})[7] == 0.04


def test_a_deadband_of_zero_is_the_midpoint_binarizer():
    seq = [0.0201, 0.0199, 0.02, 0.0201]
    a, b = GripperHysteresis(_Seq(seq), 0.0), GripperBinarizer(_Seq(seq))
    a.reset(), b.reset()
    assert [a.act(None, {})[7] for _ in seq] == [b.act(None, {})[7] for _ in seq] == [0.04, 0.0, 0.0, 0.04]


def test_wrap_gripper_picks_the_wrapper_the_options_ask_for():
    inner = _Seq([0.01])
    assert wrap_gripper(inner, InferenceOptions()) is inner
    assert isinstance(wrap_gripper(inner, InferenceOptions(binarize_gripper=True)), GripperBinarizer)
    w = wrap_gripper(inner, InferenceOptions(gripper_deadband=0.25))
    assert isinstance(w, GripperHysteresis) and w.deadband == 0.25
