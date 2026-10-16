"""demo_pipeline.process: perfect_demo orchestration, every branch with injected fakes (no I/O)."""
from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.degrade import degrade
from demo_pipeline.measure import compute_windows
from demo_pipeline.process import PerfectResult, perfect_demo
from demo_pipeline.rules import detect_rules
from demo_pipeline.schemas import Demo, Diagnosis, Pose, Scene, SimSignals, Trajectory, VerificationResult
from sim_worker.scripted import scripted_expert

BIN_RIM_Z = 0.08
SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=0)


def _sim(n: int) -> SimSignals:
    return SimSignals(np.zeros((n, 3)), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n, bool), np.zeros(n))


@pytest.fixture(scope="module")
def paused():
    """A human-like demo with one exact 0.9 s pause and nothing else; returns (demo, true pause (t0, t1))."""
    traj, truth = degrade(scripted_expert(SCENE), np.random.default_rng(2), n_pauses=1, pause_s=(0.9, 0.9),
                          jitter_mm=0.0, grasp_offset_mm=0.0)
    [p] = [i for i in truth if i.type == "pause"]
    return Demo(id="h1", source="human", trajectory=traj, scene=SCENE, human_seconds=12.0), (p.t0, p.t1)


def _rules_diag(demo: Demo) -> Diagnosis:
    return detect_rules(demo.trajectory, compute_windows(demo.trajectory, _sim(len(demo.trajectory.t))))


def _with(diag: Diagnosis, **changes) -> Diagnosis:
    return Diagnosis.model_validate({**diag.model_dump(), **changes})


def _window_aligned(demo: Demo, true_pause) -> Diagnosis:
    """What Nemotron sends: the pause on the 0.5 s window grid, 0.5 s long."""
    t0 = math.floor(true_pause[0] * 2) / 2
    return _with(_rules_diag(demo), issues=[{"type": "pause", "t0": t0, "t1": t0 + 0.5, "evidence": "stops"}],
                 repairs=[{"op": "remove_pause", "t0": t0, "t1": t0 + 0.5}], decision="repair")


def _keep(demo: Demo) -> Diagnosis:
    return _with(_rules_diag(demo), issues=[], repairs=[], decision="keep")


class FakeDiagnose:
    """Returns (or raises) the scripted replies in order; records every call."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, demo, windows, reasons):
        self.calls.append((demo, windows, list(reasons)))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply(demo) if callable(reply) else reply


class FakeVerify:
    """Each reply is a list of failure reasons ([] = success) or an exception; records the trajectories."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, traj: Trajectory, scene: Scene):
        self.calls.append(traj)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        result = VerificationResult(success=not reply, reasons=reply, duration=traj.duration,
                                    path_length=1.0, max_contact_force=0.0)
        return result, _sim(len(traj.t))


def _run(demo, diagnose_fn, verify_fn, **kw) -> PerfectResult:
    return perfect_demo(demo, _sim(len(demo.trajectory.t)), diagnose_fn=diagnose_fn, verify_fn=verify_fn,
                        bin_rim_z=BIN_RIM_Z, **kw)


def test_nemotron_diagnosis_is_refined_repaired_and_verified(paused):
    demo, true_pause = paused
    diagnose, verify = FakeDiagnose(_window_aligned(demo, true_pause)), FakeVerify([])
    res = _run(demo, diagnose, verify)
    assert res.status == "perfected" and res.diagnosis_source == "nemotron" and res.attempts == 1
    assert diagnose.calls[0][0] is demo and diagnose.calls[0][2] == []
    assert len(diagnose.calls[0][1]) == math.ceil(demo.trajectory.duration / 0.5 - 1e-9)  # the metrics windows
    [rp] = [r for r in res.diagnosis.repairs if r.op == "remove_pause"]
    assert (rp.t0, rp.t1) == pytest.approx(true_pause, abs=0.06)  # refined to the data, not the 0.5 s window
    # the whole 0.9 s pause came out, not just the 0.5 s window Nemotron named
    assert res.trajectory.duration == pytest.approx(demo.trajectory.duration - 0.9, abs=0.1)
    assert verify.calls == [res.trajectory]
    assert res.verification.success


def test_nemotron_raises_so_the_rules_are_used(paused):
    demo, _ = paused
    res = _run(demo, FakeDiagnose(RuntimeError("token factory 503")), FakeVerify([]))
    assert res.status == "perfected" and res.diagnosis_source == "rules"
    assert [r.op for r in res.diagnosis.repairs] == ["remove_pause"]
    assert any("RuntimeError" in n and "token factory 503" in n for n in res.notes)


def test_no_diagnose_fn_uses_the_rules(paused):
    demo, _ = paused
    res = _run(demo, None, FakeVerify([]))
    assert res.status == "perfected" and res.diagnosis_source == "rules"


def test_a_diagnosis_with_times_past_the_end_falls_back_to_the_rules(paused):
    demo, _ = paused
    end = demo.trajectory.duration
    bad = _with(_keep(demo), issues=[{"type": "pause", "t0": end + 1.0, "t1": end + 2.0, "evidence": "?"}])
    res = _run(demo, FakeDiagnose(bad), FakeVerify([]))
    assert res.diagnosis_source == "rules" and res.status == "perfected"
    assert any("past the demo end" in n for n in res.notes)


def test_discard_decision_is_discarded_without_verifying(paused):
    demo, _ = paused
    diag = _with(_keep(demo), decision="discard", repairs=[{"op": "discard"}],
                 issues=[{"type": "wrong_object", "t": 1.0, "evidence": "grabs the bin"}])
    verify = FakeVerify()
    res = _run(demo, FakeDiagnose(diag), verify)
    assert (res.status, res.trajectory, res.attempts, res.verification) == ("discarded", None, 0, None)
    assert res.diagnosis.decision == "discard" and verify.calls == []


def test_keep_that_verifies_is_kept_unchanged(paused):
    demo, _ = paused
    verify = FakeVerify([])
    res = _run(demo, FakeDiagnose(_keep), verify)
    assert res.status == "kept" and res.trajectory == demo.trajectory and res.attempts == 1
    assert verify.calls == [demo.trajectory]


def test_keep_that_fails_is_rediagnosed_with_the_reasons_then_repaired(paused):
    demo, true_pause = paused
    diagnose = FakeDiagnose(_keep, _window_aligned(demo, true_pause))
    res = _run(demo, diagnose, FakeVerify(["too_slow"], []))
    assert res.status == "perfected" and res.attempts == 2
    assert diagnose.calls[1][2] == ["too_slow"]
    assert diagnose.calls[1][0].trajectory == demo.trajectory  # nothing was repaired yet


def test_discard_op_inside_a_repair_diagnosis_is_discarded_with_a_note(paused):
    demo, _ = paused
    diag = _with(_rules_diag(demo), repairs=[{"op": "discard"}], decision="repair")
    verify = FakeVerify()
    res = _run(demo, FakeDiagnose(diag), verify)
    assert res.status == "discarded" and res.trajectory is None and verify.calls == []
    assert any("discard" in n for n in res.notes)


def test_a_repair_that_raises_value_error_is_discarded_with_its_message(paused):
    demo, _ = paused
    t_close = demo.trajectory.t[demo.trajectory.gripper.index(1)]
    diag = _with(_rules_diag(demo), decision="repair",
                 repairs=[{"op": "replan_transit", "t0": t_close - 0.5, "t1": t_close + 0.5}])  # spans the close
    res = _run(demo, FakeDiagnose(diag), FakeVerify())
    assert res.status == "discarded" and res.attempts == 0
    assert any("ValueError" in n and "gripper changes" in n for n in res.notes)


def test_verify_failing_every_time_is_discarded_after_max_rediagnose_with_all_reasons(paused):
    demo, true_pause = paused
    first = _window_aligned(demo, true_pause)
    smooth_more = lambda d: _with(_keep(d), decision="repair",  # noqa: E731
                                  repairs=[{"op": "smooth", "t0": 1.0, "t1": 3.0, "strength": "high"}])
    diagnose = FakeDiagnose(first, smooth_more, smooth_more)
    verify = FakeVerify(["cube_not_in_bin"], ["dropped_early"], ["arm_bin_contact"])
    res = _run(demo, diagnose, verify)
    assert res.status == "discarded" and res.trajectory is None
    assert res.attempts == 3 and len(diagnose.calls) == 3
    assert [c[2] for c in diagnose.calls] == [[], ["cube_not_in_bin"], ["dropped_early"]]
    assert res.verification.reasons == ["arm_bin_contact"]
    notes = " | ".join(res.notes)
    assert "cube_not_in_bin" in notes and "dropped_early" in notes and "arm_bin_contact" in notes
    # each re-diagnosis sees the trajectory that just failed, with the windows from its replay
    for (d, windows, _), tried in zip(diagnose.calls[1:], verify.calls):
        assert d.trajectory == tried and d.source == "repaired" and d.parent_id == demo.id
        assert windows[-1].t1 == pytest.approx(tried.t[-1])


def test_verify_fails_twice_with_one_rediagnose_is_discarded(paused):
    demo, true_pause = paused
    smooth = lambda d: _with(_keep(d), decision="repair",  # noqa: E731
                             repairs=[{"op": "smooth", "t0": 1.0, "t1": 3.0, "strength": "low"}])
    diagnose = FakeDiagnose(_window_aligned(demo, true_pause), smooth)
    res = _run(demo, diagnose, FakeVerify(["a"], ["b"]), max_rediagnose=1)
    assert res.status == "discarded" and res.attempts == 2 and len(diagnose.calls) == 2


def test_a_rediagnosis_with_no_new_fix_ends_early(paused):
    demo, true_pause = paused
    diagnose = FakeDiagnose(_window_aligned(demo, true_pause), RuntimeError("timeout"))  # then rules: nothing left
    verify = FakeVerify(["cube_not_in_bin"])
    res = _run(demo, diagnose, verify)
    assert res.status == "discarded" and res.attempts == 1 and len(verify.calls) == 1
    assert res.diagnosis_source == "rules"
    assert any("no change" in n for n in res.notes)


class ShortSignalsVerify(FakeVerify):
    """A replay whose signals do not match the trajectory (e.g. the sim worker padded or cut it)."""

    def __call__(self, traj, scene):
        result, sig = super().__call__(traj, scene)
        return result, _sim(len(traj.t) - 5)


def test_replay_signals_that_do_not_match_are_a_recorded_discard(paused):
    demo, true_pause = paused
    diagnose = FakeDiagnose(_window_aligned(demo, true_pause))
    res = _run(demo, diagnose, ShortSignalsVerify(["cube_not_in_bin"]))
    assert res.status == "discarded" and res.attempts == 1 and len(diagnose.calls) == 1
    assert any("cannot measure" in n for n in res.notes)


def test_the_last_failure_is_not_measured_for_a_rediagnosis_that_never_comes(paused):
    demo, true_pause = paused
    res = _run(demo, FakeDiagnose(_window_aligned(demo, true_pause)), ShortSignalsVerify(["x"]), max_rediagnose=0)
    assert res.status == "discarded" and res.attempts == 1
    assert not any("cannot measure" in n for n in res.notes)


def test_verify_raising_is_a_recorded_discard_not_a_crash(paused):
    demo, true_pause = paused
    res = _run(demo, FakeDiagnose(_window_aligned(demo, true_pause)), FakeVerify(RuntimeError("sim worker died")))
    assert res.status == "discarded" and res.trajectory is None and res.attempts == 1
    assert any("sim worker died" in n for n in res.notes)
