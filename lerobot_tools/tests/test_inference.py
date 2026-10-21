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
    InferenceOptions,
    add_inference_args,
    apply_to_config,
    binarize_gripper,
    served_problems,
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
