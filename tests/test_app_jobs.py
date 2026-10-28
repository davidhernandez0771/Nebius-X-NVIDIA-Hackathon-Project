"""app.jobs: the job runner and the perfect job (perfect_demo through the sim worker), with fakes only."""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import numpy as np
import pytest

from app.ai.diagnose import DiagnosisError
from app.jobs import (
    BIN_RIM_HEIGHT,
    JobRunner,
    PipelineAbort,
    align_signals,
    bin_rim_z,
    check_worker,
    is_infrastructure,
    output_demo_id,
    perfect_stored_demo,
)
from app.sim_client import SimWorkerBusy, SimWorkerError, SimWorkerUnavailable
from demo_pipeline import PIPELINE_VERSION
from demo_pipeline.rules import TASK_TEXT, detect_rules
from demo_pipeline.schemas import Demo, Diagnosis, Pose, Scene, SimSignals, Trajectory
from demo_pipeline.store import DemoStore
from fake_sim_worker import FakeSim, InlineExecutor, frame_bytes, verification
from nebius_llm.config import get_vision_model

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
N, CLOSE_STEP, OPEN_STEP = 100, 40, 80
VL_MODEL = get_vision_model("nemotron-vl").model_id


def _traj(n=N, pause_steps=0):
    """A smooth pick-and-place sweep; pause_steps holds still mid-carry (gripper closed)."""
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if CLOSE_STEP <= i < OPEN_STEP else 0 for i in range(n)]
    at = 60
    pos = pos[:at] + [pos[at]] * pause_steps + pos[at:]
    grip = grip[:at] + [1] * pause_steps + grip[at:]
    m = len(pos)
    return Trajectory(t=[i * 0.02 for i in range(m)], ee_pos=pos, ee_quat=[DOWN] * m, gripper=grip)


def _scene(bin_z=0.0):
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, bin_z), quat_wxyz=IDENTITY), robot="franka", seed=7)


def _demo(id="human_1", source="human", pause_steps=0):
    return Demo(id=id, source=source, parent_id=None if source == "human" else "x",
                trajectory=_traj(pause_steps=pause_steps), scene=_scene(),
                human_seconds=10.0 if source == "human" else 0.0)


def _keep(label=TASK_TEXT):
    return Diagnosis.model_validate({"segments": [{"name": "approach", "t0": 0.0, "t1": 0.8}], "issues": [],
                                     "repairs": [], "decision": "keep", "label": label})


@pytest.fixture
def store(tmp_path):
    return DemoStore(tmp_path / "store")


@pytest.fixture
def no_sleep():
    calls = []
    return calls, calls.append


def _perfect(store, sim, demo_id="human_1", diagnoser="rules", **kw):
    kw.setdefault("sleep", lambda s: None)
    return perfect_stored_demo(store, sim, demo_id, diagnoser, **kw)


# --- small helpers ---------------------------------------------------------------------------

def test_bin_rim_is_wall_plus_inner_height_above_the_bin_origin():
    assert BIN_RIM_HEIGHT == pytest.approx(0.09)  # sim_worker/scene_cfg.py: BIN_WALL 0.01 + inner 0.08
    assert bin_rim_z(_scene(bin_z=0.02)) == pytest.approx(0.11)


def test_output_demo_id_is_per_diagnoser():
    assert output_demo_id("human_1", "rules") == "human_1_rules"
    assert output_demo_id("human_1", "nemotron") == "human_1_nemotron"


def _sig(n):
    return SimSignals(cube_pos=np.arange(3 * n, dtype=float).reshape(n, 3), contact_gripper_cube=np.arange(n) % 2 == 0,
                      contact_arm_bin=np.zeros(n, dtype=bool), contact_arm_table=np.zeros(n, dtype=bool),
                      max_contact_force=np.arange(n, dtype=float))


def test_align_signals_is_identity_when_lengths_match():
    s = _sig(5)
    assert align_signals(s, [0.0, 0.1, 0.2, 0.3, 0.4]) is s


def test_align_signals_stretches_a_longer_replay_onto_the_trajectory_keeping_both_ends():
    s = align_signals(_sig(7), [0.0, 0.02, 0.04, 0.06])
    assert s.n_steps == 4
    assert s.max_contact_force.tolist() == [0.0, 2.0, 4.0, 6.0]
    np.testing.assert_array_equal(s.cube_pos[-1], _sig(7).cube_pos[-1])


# --- the job runner ------------------------------------------------------------------------

def test_runner_records_a_finished_job_with_its_result():
    jobs = JobRunner(InlineExecutor())
    job = jobs.submit("perfect", lambda: {"status": "kept"}, demo_id="human_1", params={"diagnoser": "rules"})
    got = jobs.get(job.id)
    assert got.status == "succeeded" and got.result == {"status": "kept"} and got.error is None
    assert (got.kind, got.demo_id, got.params) == ("perfect", "human_1", {"diagnoser": "rules"})
    assert got.created_at <= got.started_at <= got.finished_at


def test_a_job_that_raises_fails_with_the_error_message():
    def boom():
        raise SimWorkerUnavailable("sim worker unavailable at http://x/replay: ConnectError")

    jobs = JobRunner(InlineExecutor())
    got = jobs.get(jobs.submit("perfect", boom).id)
    assert got.status == "failed" and got.result is None
    assert got.error == "SimWorkerUnavailable: sim worker unavailable at http://x/replay: ConnectError"


def test_unknown_job_is_none():
    assert JobRunner(InlineExecutor()).get("nope") is None


def test_jobs_run_one_at_a_time_in_the_background():
    release = threading.Event()
    jobs = JobRunner(ThreadPoolExecutor(max_workers=1))
    first = jobs.submit("perfect", lambda: release.wait(5) and {"n": 1})
    second = jobs.submit("perfect", lambda: {"n": 2})
    assert jobs.get(second.id).status == "queued"  # the first one is still running
    release.set()
    jobs.wait(second.id, timeout=5)
    assert jobs.get(first.id).result == {"n": 1} and jobs.get(second.id).result == {"n": 2}


def test_get_returns_a_snapshot_not_the_live_job():
    jobs = JobRunner(InlineExecutor())
    job = jobs.submit("perfect", lambda: {})
    jobs.get(job.id).status = "failed"
    assert jobs.get(job.id).status == "succeeded"


# --- perfect: rules ---------------------------------------------------------------------------

def test_clean_demo_is_kept_and_stored_with_a_passport(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    with patch("app.jobs.diagnose_gated") as model:
        out = _perfect(store, sim)
    model.assert_not_called()
    assert out["status"] == "kept" and out["diagnosis_source"] == "rules" and out["model_id"] is None
    assert out["output_demo_id"] == "human_1_rules" and out["attempts"] == 1
    raw, verify = sim.requests
    assert raw.out_name == "human_1_raw" and raw.trajectory == _demo().trajectory and not raw.record_cameras
    assert verify.out_name == "human_1_rules_v1"

    rep = store.get_demo("human_1_rules")
    assert (rep.source, rep.parent_id, rep.human_seconds) == ("repaired", "human_1", 0.0)
    assert rep.trajectory == _demo().trajectory and rep.scene == _demo().scene
    passport = store.get_passport("human_1_rules")
    assert passport.lineage == ["human_1", "human_1_rules"] and passport.repairs_applied == []
    assert (passport.diagnosis_source, passport.model_id, passport.robot) == ("rules", None, "franka")
    assert passport.verification == verification() and passport.pipeline_version == PIPELINE_VERSION
    assert store.get_stored_diagnosis("human_1_rules").source == "rules"
    assert store.get_stored_diagnosis("human_1").diagnosis == store.get_stored_diagnosis("human_1_rules").diagnosis


def test_paused_demo_is_repaired_and_the_verified_trajectory_is_stored(store, tmp_path):
    store.save_demo(_demo(pause_steps=50))
    sim = FakeSim(tmp_path / "worker")
    out = _perfect(store, sim)
    assert out["status"] == "perfected"
    rep = store.get_demo("human_1_rules")
    assert len(rep.trajectory.t) < len(_demo(pause_steps=50).trajectory.t)
    assert sim.requests[-1].trajectory == rep.trajectory  # what was verified is what was stored
    ops = [r.op for r in store.get_passport("human_1_rules").repairs_applied]
    assert "remove_pause" in ops


def test_verified_episodes_are_copied_into_the_store(store, tmp_path):
    store.save_demo(_demo())
    _perfect(store, FakeSim(tmp_path / "worker"))
    assert (store.episode_dir("human_1") / "episode.json").is_file()  # the raw replay
    assert (store.episode_dir("human_1_rules") / "signals.npz").is_file()  # the verified one


def test_a_demo_that_never_verifies_is_discarded_and_nothing_is_stored_as_repaired(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", results=[verification(False, ["not_in_bin"])])
    out = _perfect(store, sim)
    assert out["status"] == "discarded" and out["output_demo_id"] is None
    assert any("not_in_bin" in n for n in out["notes"])
    assert not store.has_demo("human_1_rules")
    assert store.get_stored_diagnosis("human_1") is not None  # why it was discarded stays visible
    assert out["raw_verification"]["success"] is False


def test_only_human_demos_are_perfected(store, tmp_path):
    store.save_demo(_demo())
    store.save_demo(Demo(id="rep_1", source="repaired", parent_id="human_1", trajectory=_traj(), scene=_scene(),
                         human_seconds=0.0))
    with pytest.raises(ValueError, match="human"):
        _perfect(store, FakeSim(tmp_path / "worker"), demo_id="rep_1")


def test_a_given_raw_replay_is_not_replayed_again(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    raw = sim.replay(_raw_request())
    sim.requests.clear()
    _perfect(store, sim, raw=raw)
    assert [r.out_name for r in sim.requests] == ["human_1_rules_v1"]


def _raw_request():
    from demo_pipeline.sim_protocol import ReplayRequest

    return ReplayRequest(trajectory=_demo().trajectory, scene=_scene(), record_cameras=True, out_name="human_1_raw")


def test_a_replay_longer_than_the_trajectory_is_aligned_and_noted(store, tmp_path):
    store.save_demo(_demo())
    out = _perfect(store, FakeSim(tmp_path / "worker", extra_steps=6))
    assert out["status"] == "kept"
    assert any("106 steps" in n and "100" in n for n in out["notes"])


# --- perfect: nemotron ------------------------------------------------------------------------

def test_nemotron_sees_frames_from_the_raw_replay_and_its_gated_list_is_stored(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    gated = ["dropped issue slow 0.00-1.00: median speed 0.15 m/s is not below 0.05"]
    with patch("app.jobs.diagnose_gated", return_value=(_keep(), gated)) as model:
        out = _perfect(store, sim, diagnoser="nemotron")
    assert sim.requests[0].record_cameras and sim.requests[1].record_cameras
    frames, wrist, windows, task_text, replay_success, duration = model.call_args.args
    assert len(frames) == 7 and all(b.startswith(b"PNG human_1_raw front ") for _, b in frames)
    assert wrist == frame_bytes("human_1_raw", "wrist", CLOSE_STEP)
    assert task_text == TASK_TEXT and replay_success is True and duration == pytest.approx(_traj().t[-1])
    assert out["status"] == "kept" and out["diagnosis_source"] == "nemotron" and out["model_id"] == VL_MODEL
    assert out["gated"] == gated
    assert store.get_stored_diagnosis("human_1_nemotron").gated == gated
    passport = store.get_passport("human_1_nemotron")
    assert (passport.diagnosis_source, passport.model_id) == ("nemotron", VL_MODEL)


def test_nemotron_failure_falls_back_to_rules(store, tmp_path):
    store.save_demo(_demo())
    with patch("app.jobs.diagnose_gated", side_effect=DiagnosisError("no valid diagnosis after 2 attempts")):
        out = _perfect(store, FakeSim(tmp_path / "worker"), diagnoser="nemotron")
    assert out["status"] == "kept" and out["diagnosis_source"] == "rules"
    assert out["model_id"] is None and out["gated"] == []
    assert any("DiagnosisError" in n for n in out["notes"])
    assert store.get_passport("human_1_nemotron").diagnosis_source == "rules"


def test_a_model_reply_rejected_after_the_gate_leaves_no_gated_list(store, tmp_path):
    store.save_demo(_demo())
    late = Diagnosis.model_validate({"segments": [{"name": "approach", "t0": 0.0, "t1": 50.0}], "issues": [],
                                     "repairs": [], "decision": "keep", "label": TASK_TEXT})  # past the demo end
    with patch("app.jobs.diagnose_gated", return_value=(late, ["dropped issue slow 0.00-1.00: fast"])):
        out = _perfect(store, FakeSim(tmp_path / "worker"), diagnoser="nemotron")
    assert out["diagnosis_source"] == "rules" and out["gated"] == [] and out["model_id"] is None
    assert store.get_stored_diagnosis("human_1_nemotron").gated == []


def test_rediagnosis_uses_the_frames_of_the_replay_that_failed(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", results=[verification(), verification(False), verification()])
    repair = Diagnosis.model_validate({"segments": [], "issues": [{"type": "jitter", "t0": 0.5, "t1": 1.0,
                                                                     "evidence": "e"}],
                                       "repairs": [{"op": "smooth", "t0": 0.5, "t1": 1.0}], "decision": "repair",
                                       "label": TASK_TEXT})
    with patch("app.jobs.diagnose_gated", side_effect=[(_keep(), []), (repair, [])]) as model:
        out = _perfect(store, sim, diagnoser="nemotron")
    second_frames = model.call_args_list[1].args[0]
    assert all(b.startswith(b"PNG human_1_nemotron_v1 front ") for _, b in second_frames)
    assert model.call_args_list[1].args[4] is False  # that replay failed
    assert out["status"] == "perfected" and out["attempts"] == 2


def test_a_custom_diagnose_function_is_used_instead_of_diagnose_gated(store, tmp_path):
    store.save_demo(_demo())
    calls = []

    def diagnose(*args, **kwargs):
        calls.append(args)
        return _keep(), []

    with patch("app.jobs.diagnose_gated") as default:
        out = _perfect(store, FakeSim(tmp_path / "worker"), diagnoser="nemotron", diagnose=diagnose)
    default.assert_not_called()
    assert len(calls) == 1 and out["diagnosis_source"] == "nemotron"


def test_an_abort_from_the_diagnoser_fails_the_job_instead_of_falling_back(store, tmp_path):
    store.save_demo(_demo())

    def diagnose(*args, **kwargs):
        raise PipelineAbort("model call budget reached: 10 of 10 calls used")

    with pytest.raises(PipelineAbort, match="budget"):
        _perfect(store, FakeSim(tmp_path / "worker"), diagnoser="nemotron", diagnose=diagnose)
    assert store.get_stored_diagnosis("human_1") is None and not store.has_demo("human_1_nemotron")


# --- the worker preflight shared by the route and the batch -----------------------------------

def _health(**kw):
    from demo_pipeline.sim_protocol import HealthResponse

    return HealthResponse(**{"ok": True, "robots": ["franka"], "cameras": True, "busy": False, **kw})


def test_check_worker_accepts_a_matching_worker_even_when_busy():
    assert check_worker(_health(busy=True), "franka", "nemotron") is None


def test_check_worker_without_a_robot_skips_the_robot_check():
    assert check_worker(_health(robots=["openarm"]), None, "rules") is None
    assert check_worker(_health(ok=False), None, "rules")[0] == 503


@pytest.mark.parametrize("health,robot,diagnoser,status,text", [
    (dict(ok=False), "franka", "rules", 503, "ok=false"),
    (dict(), "openarm", "rules", 409, "--robot openarm"),
    (dict(cameras=False), "franka", "nemotron", 409, "--cameras"),
])
def test_check_worker_refusals(health, robot, diagnoser, status, text):
    got = check_worker(_health(**health), robot, diagnoser)
    assert got[0] == status and text in got[1]


def test_infrastructure_errors_are_everything_but_a_sim_error():
    assert is_infrastructure(SimWorkerUnavailable("x"))
    assert is_infrastructure(SimWorkerBusy("x", status=409, error="busy"))
    assert is_infrastructure(SimWorkerError("x", status=422, error="invalid"))
    assert is_infrastructure(SimWorkerError("x", status=502))
    assert not is_infrastructure(SimWorkerError("x", status=500, error="sim_error"))


# --- perfect: the sim worker fails (Review Focus 2) -------------------------------------------

def test_worker_down_at_the_raw_replay_fails_the_job_and_stores_nothing(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", errors={0: SimWorkerUnavailable("sim worker unavailable at x")})
    with pytest.raises(SimWorkerUnavailable):
        _perfect(store, sim)
    assert store.get_stored_diagnosis("human_1") is None and not store.has_demo("human_1_rules")


def test_worker_crash_during_verification_fails_the_job_instead_of_discarding(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", errors={1: SimWorkerUnavailable("RemoteProtocolError: disconnected")})
    with pytest.raises(SimWorkerUnavailable, match="disconnected"):
        _perfect(store, sim)
    assert store.get_stored_diagnosis("human_1") is None and not store.has_demo("human_1_rules")


def test_a_config_error_during_verification_fails_the_job(store, tmp_path):
    store.save_demo(_demo())
    err = SimWorkerError("HTTP 422 invalid: started without --cameras", status=422, error="invalid")
    with pytest.raises(SimWorkerError, match="cameras"):
        _perfect(store, FakeSim(tmp_path / "worker", errors={1: err}))


def test_a_sim_error_on_one_verification_discards_that_demo(store, tmp_path):
    store.save_demo(_demo())
    err = SimWorkerError("HTTP 500 sim_error: RuntimeError: IK diverged", status=500, error="sim_error")
    out = _perfect(store, FakeSim(tmp_path / "worker", errors={1: err}))
    assert out["status"] == "discarded" and any("IK diverged" in n for n in out["notes"])


def test_busy_worker_is_retried(store, tmp_path, no_sleep):
    sleeps, sleep = no_sleep
    store.save_demo(_demo())
    busy = SimWorkerBusy("busy", status=409, error="busy")
    sim = FakeSim(tmp_path / "worker", errors={0: busy, 1: busy})
    out = _perfect(store, sim, busy_retries=3, busy_wait_s=7.0, sleep=sleep)
    assert out["status"] == "kept" and sleeps == [7.0, 7.0]


def test_busy_beyond_the_retries_fails_the_job(store, tmp_path):
    store.save_demo(_demo())
    busy = SimWorkerBusy("busy", status=409, error="busy")
    with pytest.raises(SimWorkerBusy):
        _perfect(store, FakeSim(tmp_path / "worker", errors={0: busy, 1: busy, 2: busy}), busy_retries=2)


# --- re-diagnosis: failure reasons and every round's repairs (sprint 3b, Task 1) ------------------

def _repair_diag(t0, t1):
    return Diagnosis.model_validate({"segments": [], "issues": [{"type": "jitter", "t0": t0, "t1": t1, "evidence": "e"}],
                                     "repairs": [{"op": "smooth", "t0": t0, "t1": t1}], "decision": "repair",
                                     "label": TASK_TEXT})


def test_rediagnosis_tells_nemotron_why_the_previous_repair_failed(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", results=[verification(), verification(False, ["not_in_bin", "not_settled"]),
                                                verification()])
    with patch("app.jobs.diagnose_gated", side_effect=[(_repair_diag(0.5, 1.0), []),
                                                       (_repair_diag(1.0, 1.5), [])]) as model:
        _perfect(store, sim, diagnoser="nemotron")
    first, second = model.call_args_list
    assert not first.kwargs.get("failure_reasons")
    assert second.kwargs["failure_reasons"] == ["not_in_bin", "not_settled"]


def test_passport_lists_the_repairs_of_every_round_in_order(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", results=[verification(), verification(False), verification()])
    with patch("app.jobs.diagnose_gated", side_effect=[(_repair_diag(0.5, 1.0), []),
                                                       (_repair_diag(1.0, 1.5), [])]):
        out = _perfect(store, sim, diagnoser="nemotron")
    assert out["status"] == "perfected" and out["attempts"] == 2
    applied = store.get_passport("human_1_nemotron").repairs_applied
    assert [(r.op, r.t0) for r in applied] == [("smooth", 0.5), ("smooth", 1.0)]
    assert [r["source"] for r in out["rounds"]] == ["nemotron", "nemotron"]
    assert out["rounds"][1]["reasons"] == ["not_in_bin"]


def test_a_round_that_fell_back_to_rules_is_recorded_as_rules(store, tmp_path):
    store.save_demo(_demo(pause_steps=50))
    sim = FakeSim(tmp_path / "worker", results=[verification(), verification(False), verification()])
    with patch("app.jobs.diagnose_gated", side_effect=[(_repair_diag(0.2, 0.6), []), DiagnosisError("bad reply")]):
        out = _perfect(store, sim, diagnoser="nemotron")
    assert out["status"] == "perfected"
    assert [r["source"] for r in out["rounds"]] == ["nemotron", "rules"]
    passport = store.get_passport("human_1_nemotron")
    assert passport.diagnosis_source == "rules" and passport.model_id is None  # the last round decides
    assert [r.op for r in passport.repairs_applied][0] == "smooth"
    assert "remove_pause" in [r.op for r in passport.repairs_applied]
    assert any("DiagnosisError" in n for n in out["notes"])


def test_rules_rounds_are_recorded_too(store, tmp_path):
    store.save_demo(_demo(pause_steps=50))
    out = _perfect(store, FakeSim(tmp_path / "worker"))
    assert [r["source"] for r in out["rounds"]] == ["rules"]
    assert "remove_pause" in [r["op"] for r in out["rounds"][0]["repairs"]]
    assert out["diagnosis_source"] == "rules"


# --- episodes with passports, raw replays and stored variants (sprint 3b, Task 2) ------------------

from demo_pipeline.episode_io import load_episode  # noqa: E402
from demo_pipeline.sim_protocol import MultiplyRequest  # noqa: E402


def test_record_raw_stores_the_episode_with_a_human_passport(store, tmp_path):
    from app.jobs import record_raw

    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    raw = record_raw(store, sim, store.get_demo("human_1"), record_cameras=True, sleep=lambda s: None)
    assert sim.requests[0].out_name == "human_1_raw" and sim.requests[0].record_cameras
    assert raw.ep_dir == str(store.episode_dir("human_1"))
    passport = store.get_passport("human_1")
    assert passport.lineage == ["human_1"] and passport.repairs_applied == []
    assert passport.diagnosis_source == "none" and passport.verification == verification()
    meta, _, _ = load_episode(store.episode_dir("human_1"))
    assert meta.passport == passport and meta.demo_id == "human_1"


def test_stamping_a_linked_copy_leaves_the_workers_episode_untouched(store, tmp_path):
    from app.jobs import record_raw

    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    record_raw(store, sim, store.get_demo("human_1"), record_cameras=True, sleep=lambda s: None)
    worker_meta, _, _ = load_episode(tmp_path / "worker" / "episodes" / "human_1_raw")
    assert worker_meta.passport is None and worker_meta.demo_id == "human_1_raw"


def test_stored_raw_rebuilds_the_replay_from_the_store(store, tmp_path):
    from app.jobs import record_raw, stored_raw

    store.save_demo(_demo())
    assert stored_raw(store, "human_1", need_cameras=False) is None
    raw = record_raw(store, FakeSim(tmp_path / "worker"), store.get_demo("human_1"), record_cameras=False,
                     sleep=lambda s: None)
    again = stored_raw(store, "human_1", need_cameras=False)
    assert again.verification == raw.verification and again.signals == raw.signals
    assert again.ep_dir == raw.ep_dir and again.n_steps == raw.n_steps
    assert stored_raw(store, "human_1", need_cameras=True) is None  # recorded without cameras


def test_perfect_reuses_a_stored_raw_replay_without_copying_it_onto_itself(store, tmp_path):
    from app.jobs import record_raw, stored_raw

    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    record_raw(store, sim, store.get_demo("human_1"), record_cameras=True, sleep=lambda s: None)
    sim.requests.clear()
    out = _perfect(store, sim, raw=stored_raw(store, "human_1", need_cameras=True))
    assert out["status"] == "kept" and [r.out_name for r in sim.requests] == ["human_1_rules_v1"]
    assert (store.episode_dir("human_1") / "steps.npz").is_file()


def test_the_verified_episode_carries_the_output_passport(store, tmp_path):
    store.save_demo(_demo(pause_steps=50))
    _perfect(store, FakeSim(tmp_path / "worker"))
    meta, _, _ = load_episode(store.episode_dir("human_1_rules"))
    assert meta.passport == store.get_passport("human_1_rules") and meta.demo_id == "human_1_rules"


def test_successful_variants_are_stored_with_lineage_seed_and_inherited_repairs(store, tmp_path):
    from app.jobs import store_variants

    store.save_demo(_demo(pause_steps=50))
    sim = FakeSim(tmp_path / "worker", failing_seeds={11})
    _perfect(store, sim)
    parent = store.get_demo("human_1_rules")
    resp = sim.multiply(MultiplyRequest(trajectory=parent.trajectory, scene=parent.scene, robot="franka", n=3,
                                        seed0=10, record_cameras=True, out_prefix="human_1_rules_mx"))
    ids = store_variants(store, "human_1_rules", resp)
    assert ids == ["human_1_rules_m0010", "human_1_rules_m0012"]  # seed 11 failed verification
    v = store.get_demo("human_1_rules_m0010")
    assert (v.source, v.parent_id, v.human_seconds) == ("variant", "human_1_rules", 0.0)
    passport = store.get_passport("human_1_rules_m0010")
    assert passport.lineage == ["human_1", "human_1_rules", "human_1_rules_m0010"]
    assert passport.variant_seed == 10 and passport.diagnosis_source == "rules"
    assert passport.repairs_applied == store.get_passport("human_1_rules").repairs_applied != []
    meta, _, _ = load_episode(store.episode_dir("human_1_rules_m0010"))
    assert meta.passport == passport
    assert not store.has_demo("human_1_rules_m0011")


def test_variants_of_a_human_demo_carry_no_repairs(store, tmp_path):
    from app.jobs import record_raw, store_variants

    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    record_raw(store, sim, store.get_demo("human_1"), record_cameras=True, sleep=lambda s: None)
    resp = sim.multiply(MultiplyRequest(trajectory=_traj(), scene=_scene(), robot="franka", n=1, seed0=5,
                                        record_cameras=True, out_prefix="human_1_mx"))
    (vid,) = store_variants(store, "human_1", resp)
    passport = store.get_passport(vid)
    assert passport.lineage == ["human_1", vid] and passport.repairs_applied == []
    assert passport.diagnosis_source == "none"


# --- hybrid (sprint 4, Task 2) ---------------------------------------------------------------------

def test_hybrid_calls_diagnose_hybrid_with_the_trajectory_signals_and_reasons(store, tmp_path):
    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", results=[verification(), verification(False, ["dropped"]), verification()])
    calls = []

    def hybrid(frames, wrist, windows, traj, task_text, success, duration, **kw):
        calls.append((traj, success, kw))
        return (_repair_diag(0.5, 1.0) if len(calls) == 1 else _repair_diag(1.0, 1.5)), ["dropped model issue x"]

    with patch("app.jobs.diagnose_hybrid", side_effect=hybrid), patch("app.jobs.diagnose_gated") as gated_model:
        out = _perfect(store, sim, diagnoser="hybrid")
    gated_model.assert_not_called()
    (traj0, ok0, kw0), (_, ok1, kw1) = calls
    assert traj0 == _demo().trajectory and ok0 is True and not kw0["failure_reasons"]
    assert kw0["signals"].n_steps == len(traj0.t)  # the replay's signals, on the trajectory's steps
    assert ok1 is False and kw1["failure_reasons"] == ["dropped"]
    assert out["status"] == "perfected" and out["output_demo_id"] == "human_1_hybrid"
    assert out["hybrid"] is True and out["diagnoser"] == "hybrid"
    assert [r["source"] for r in out["rounds"]] == ["hybrid", "hybrid"]


def test_hybrid_is_stored_as_hybrid(store, tmp_path):
    store.save_demo(_demo())
    with patch("app.jobs.diagnose_hybrid", return_value=(_keep(), [])):
        out = _perfect(store, FakeSim(tmp_path / "worker"), diagnoser="hybrid")
    passport = store.get_passport("human_1_hybrid")
    assert (passport.diagnosis_source, passport.model_id) == ("hybrid", VL_MODEL)
    assert store.get_stored_diagnosis("human_1_hybrid").source == "hybrid"
    assert store.get_stored_diagnosis("human_1").source == "hybrid"
    meta, _, _ = load_episode(store.episode_dir("human_1_hybrid"))
    assert meta.passport.diagnosis_source == "hybrid"
    assert out["diagnosis_source"] == "hybrid" and out["hybrid"] is True  # the flag stays for older readers


def test_variants_of_a_hybrid_output_inherit_the_hybrid_source(store, tmp_path):
    from app.jobs import store_variants

    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker")
    with patch("app.jobs.diagnose_hybrid", return_value=(_keep(), [])):
        _perfect(store, sim, diagnoser="hybrid")
    parent = store.get_demo("human_1_hybrid")
    resp = sim.multiply(MultiplyRequest(trajectory=parent.trajectory, scene=parent.scene, robot="franka", n=1,
                                        seed0=3, record_cameras=True, out_prefix="human_1_hybrid_mx"))
    (vid,) = store_variants(store, "human_1_hybrid", resp)
    assert store.get_passport(vid).diagnosis_source == "hybrid"


def test_hybrid_failure_falls_back_to_the_rules_and_is_not_marked_hybrid(store, tmp_path):
    store.save_demo(_demo())
    with patch("app.jobs.diagnose_hybrid", side_effect=DiagnosisError("bad reply")):
        out = _perfect(store, FakeSim(tmp_path / "worker"), diagnoser="hybrid")
    assert out["diagnosis_source"] == "rules" and out["hybrid"] is False
    assert any("hybrid failed" in n and "DiagnosisError" in n for n in out["notes"])


def test_before_model_call_runs_before_every_model_call_and_its_abort_fails_the_job(store, tmp_path):
    store.save_demo(_demo())
    seen = []

    def budget():
        seen.append(1)
        if len(seen) > 1:
            raise PipelineAbort("model budget reached")

    sim = FakeSim(tmp_path / "worker", results=[verification(), verification(False), verification()])
    with patch("app.jobs.diagnose_hybrid", return_value=(_repair_diag(0.5, 1.0), [])) as model:
        with pytest.raises(PipelineAbort):
            _perfect(store, sim, diagnoser="hybrid", before_model_call=budget)
    assert model.call_count == 1 and len(seen) == 2
    with patch("app.jobs.diagnose_gated", return_value=(_keep(), [])):
        _perfect(store, FakeSim(tmp_path / "w2"), diagnoser="nemotron", before_model_call=lambda: seen.append(2))
    assert seen[-1] == 2


def test_rules_never_call_the_model_hook(store, tmp_path):
    store.save_demo(_demo())
    _perfect(store, FakeSim(tmp_path / "worker"), before_model_call=lambda: pytest.fail("no model for rules"))


def test_check_worker_hybrid_needs_cameras_like_nemotron():
    assert check_worker(_health(cameras=False), "franka", "hybrid")[0] == 409
    assert check_worker(_health(cameras=False), "franka", "rules") is None


def test_rediagnosis_measures_the_grasp_on_the_failed_replays_signals(store, tmp_path):
    from demo_pipeline.sim_protocol import SignalsPayload

    store.save_demo(_demo())
    sim = FakeSim(tmp_path / "worker", results=[verification(), verification(False), verification()])
    real = sim.replay

    def replay(req):
        resp = real(req)
        if req.out_name.endswith("_v1"):  # the failed replay: its cube sits 5 cm further in x
            s = resp.signals.to_signals()
            moved = SimSignals(cube_pos=s.cube_pos + [0.05, 0.0, 0.0], contact_gripper_cube=s.contact_gripper_cube,
                               contact_arm_bin=s.contact_arm_bin, contact_arm_table=s.contact_arm_table,
                               max_contact_force=s.max_contact_force)
            resp = resp.model_copy(update={"signals": SignalsPayload.from_signals(moved)})
        return resp

    sim.replay = replay
    seen = []

    def hybrid(frames, wrist, windows, traj, task_text, success, duration, **kw):
        seen.append(kw["signals"].cube_pos[0, 0])
        return (_repair_diag(0.5, 1.0) if len(seen) == 1 else _repair_diag(1.0, 1.5)), []

    with patch("app.jobs.diagnose_hybrid", side_effect=hybrid):
        _perfect(store, sim, diagnoser="hybrid")
    assert seen == [pytest.approx(0.5), pytest.approx(0.55)]


def test_rules_see_the_verdict_the_replay_signals_and_the_scene(store, tmp_path):
    # release_above_bin and recenter_grasp come from the replay's contacts and cube track, not the trajectory alone
    store.save_demo(_demo())
    seen = []
    real = detect_rules

    def spy(traj, windows, *a, **kw):
        seen.append(kw)
        return real(traj, windows, *a, **kw)

    sim = FakeSim(tmp_path / "worker", results=[verification(False, reasons=["collision"]), verification()])
    with patch("app.jobs.detect_rules", spy):
        _perfect(store, sim)
    assert seen and seen[0]["reasons"] == ["collision"]
    assert seen[0]["scene"] == store.get_demo("human_1").scene
    assert seen[0]["signals"] is not None and seen[0]["signals"].n_steps == len(store.get_demo("human_1").trajectory.t)
