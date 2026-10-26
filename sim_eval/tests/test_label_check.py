"""sim_eval.label_check: replaying training labels through the eval's executor (pure parts, Isaac faked)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from sim_eval.eval_policy import StepRecord, run_episode
from sim_eval.label_check import (
    LabelPolicy, LabelResult, TcpRecorder, drift, load_label_episode, summarize, verdict, wilson, write_report,
)

DATA = Path(__file__).resolve().parents[2] / "tests" / "data" / "rl_episodes"


class ReplayingEnv:
    """Stands in for IsaacEvalEnv: plays back a recorded episode's signals, the fingertips `lag` m behind in x.
    It ignores the action, so success depends only on the recording (and the drift on lag)."""

    cameras: list[str] = []
    bin_inner = (0.20, 0.20, 0.08)

    def __init__(self, ep_dir: Path, lag: float = 0.0):
        with np.load(ep_dir / "signals.npz") as s, np.load(ep_dir / "steps.npz") as st:
            self.sig = {k: s[k] for k in s.files}
            self.ee, self.q, self.grip = st["ee_pos"], st["joint_pos"], st["gripper"]
        self.lag, self.k = lag, 0

    def reset(self, scene):
        self.k = 0

    def observe(self):
        from sim_eval.eval_policy import Observation
        return Observation(joint_pos=self.q[min(self.k, len(self.q) - 1)], images={})

    def step(self, action):
        k = min(self.k, len(self.ee) - 1)
        self.k += 1
        return StepRecord(tcp_pos=self.ee[k] + [self.lag, 0, 0], tcp_quat_wxyz=np.array([0.0, 1.0, 0.0, 0.0]),
                          cube_pos=self.sig["cube_pos"][k], gripper=int(self.grip[k]),
                          contact_gripper_cube=bool(self.sig["contact_gripper_cube"][k]),
                          contact_arm_bin=bool(self.sig["contact_arm_bin"][k]),
                          contact_arm_table=bool(self.sig["contact_arm_table"][k]),
                          max_contact_force=float(self.sig["max_contact_force"][k]))


def test_a_replay_folder_loads_as_labels_start_pose_and_verified_path():
    ep = load_label_episode(DATA / "verified")
    assert ep.actions.shape == (404, 9) and ep.start_q.shape == (9,) and ep.ee_pos.shape == (404, 3)
    assert ep.scene.seed == json.loads((DATA / "verified" / "scene.json").read_text())["seed"]


def test_a_folder_without_steps_is_refused(tmp_path):
    (tmp_path / "scene.json").write_text((DATA / "verified" / "scene.json").read_text())
    np.savez(tmp_path / "steps.npz", joint_pos=np.zeros((3, 9)))
    with pytest.raises(ValueError, match="action"):
        load_label_episode(tmp_path)


def test_the_label_policy_plays_in_order_then_holds_and_resets():
    p = LabelPolicy(np.arange(6.0).reshape(3, 2))
    assert [p.act(None, None)[0] for _ in range(5)] == [0, 2, 4, 4, 4]
    p.reset()
    assert p.act(None, None)[0] == 0


@pytest.mark.parametrize("folder,ok", [("verified", True), ("dropped", False)])
def test_a_faithful_executor_reproduces_the_verification(folder, ok):
    ep = load_label_episode(DATA / folder)
    env = TcpRecorder(ReplayingEnv(DATA / folder))
    res = run_episode(env, LabelPolicy(ep.actions), ep.scene, max_seconds=len(ep.actions) / 50 + 2)
    assert res.success is ok
    mean, mx, _ = drift(ep.ee_pos, env.tcp, ep.gripper)
    assert mean == pytest.approx(0.0) and mx == pytest.approx(0.0)


def test_a_lagging_executor_shows_as_drift():
    ep = load_label_episode(DATA / "verified")
    env = TcpRecorder(ReplayingEnv(DATA / "verified", lag=0.027))
    run_episode(env, LabelPolicy(ep.actions), ep.scene, max_seconds=len(ep.actions) / 50 + 2)
    mean, mx, at_close = drift(ep.ee_pos, env.tcp, ep.gripper)
    assert mean == pytest.approx(27.0) and mx == pytest.approx(27.0) and at_close == pytest.approx(27.0)


def test_wilson_matches_the_notes():
    lo, hi = wilson(15, 40)  # the distill final test: Wilson 0.242-0.530
    assert (round(lo, 3), round(hi, 3)) == (0.242, 0.530)


def _r(ok, reasons=(), d=5.0):
    return LabelResult(name="e", seed=1, success=ok, reasons=list(reasons), steps=10, drift_mean_mm=d,
                       drift_max_mm=d, drift_at_close_mm=d)


def test_the_verdict_separates_all_pass_from_a_broken_executor():
    assert verdict(110, 110).startswith("all labels execute")
    assert "can't produce" in verdict(20, 110)
    assert "a few fail" in verdict(108, 110)


def test_the_report_counts_reasons_and_drift(tmp_path):
    rs = [_r(True), _r(False, ["dropped", "not_in_bin"], 30.0), _r(False, ["dropped"], 40.0)]
    s = write_report(tmp_path / "r.json", rs, {"n": 3})
    assert s["successes"] == 1 and s["reasons"] == {"dropped": 2, "not_in_bin": 1}
    assert s["drift_mean_mm_median"] == 30.0
    assert json.loads((tmp_path / "r.json").read_text())["summary"]["n"] == 3
