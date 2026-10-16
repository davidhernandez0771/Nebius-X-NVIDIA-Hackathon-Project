"""scripts/run_pipeline_batch.py: perfect a T1 experiment set through the sim worker, resumably. Fakes only."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from app.sim_client import SimWorkerError, SimWorkerUnavailable
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Demo, Diagnosis, Pose, Scene, Trajectory
from demo_pipeline.store import DemoStore
from fake_sim_worker import FakeSim

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_pipeline_batch.py"
IDS = ["pilot_0", "pilot_1", "pilot_2"]


def _load():
    spec = importlib.util.spec_from_file_location("run_pipeline_batch", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def batch():
    return _load()


def _traj(n=100):
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if 40 <= i < 80 else 0 for i in range(n)]
    return Trajectory(t=[i * 0.02 for i in range(n)], ee_pos=pos, ee_quat=[DOWN] * n, gripper=grip)


def _demo(id):
    scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                  bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=7)
    return Demo(id=id, source="human", trajectory=_traj(), scene=scene, human_seconds=2.0)


def _make_set(root: Path, ids=IDS, manifest=True) -> Path:
    set_dir = root / "sets" / "pilot"
    for id in ids:
        (set_dir / id).mkdir(parents=True)
        (set_dir / id / "demo.json").write_text(_demo(id).model_dump_json(), encoding="utf-8")
        (set_dir / id / "truth.json").write_text(json.dumps({"synthetic": True, "issues": []}), encoding="utf-8")
    if manifest:
        (set_dir / "manifest.json").write_text(json.dumps({"name": "pilot", "demos": [{"id": i} for i in ids]}),
                                               encoding="utf-8")
    return set_dir


@pytest.fixture
def env(tmp_path):
    """A camera-less worker: rules runs then write no frames, which keeps these tests fast."""
    return _make_set(tmp_path), DemoStore(tmp_path / "store"), FakeSim(tmp_path / "worker", cameras=False)


@pytest.fixture
def cam_sim(tmp_path):
    return FakeSim(tmp_path / "camworker", cameras=True)


def _run(batch, set_dir, store, sim, diagnoser="rules", **kw):
    kw.setdefault("sleep", lambda s: None)
    kw.setdefault("log", lambda msg: None)
    return batch.run_batch(set_dir, diagnoser, client=sim, store=store, **kw)


def _replayed(sim):
    return [r.out_name for r in sim.requests]


def _keep():
    return Diagnosis.model_validate({"segments": [], "issues": [], "repairs": [], "decision": "keep",
                                     "label": TASK_TEXT})


# --- a full run ---------------------------------------------------------------------------------

def test_every_demo_is_replayed_raw_then_perfected_and_stored(batch, env):
    set_dir, store, sim = env
    summary = _run(batch, set_dir, store, sim)
    assert summary["stopped"] is None
    assert summary["counts"] == {"perfected": 0, "kept": 3, "discarded": 0, "error": 0, "pending": 0}
    assert _replayed(sim) == ["pilot_0_raw", "pilot_0_rules_v1", "pilot_1_raw", "pilot_1_rules_v1",
                              "pilot_2_raw", "pilot_2_rules_v1"]
    for id in IDS:
        assert store.get_demo(id) == Demo.model_validate_json((set_dir / id / "demo.json").read_text("utf-8"))
        assert store.get_passport(f"{id}_rules").lineage == [id, f"{id}_rules"]
    out = set_dir / "pipeline" / "rules"
    assert json.loads((out / "pilot_0.json").read_text(encoding="utf-8"))["status"] == "kept"
    on_disk = json.loads((out / "summary.json").read_text(encoding="utf-8"))
    assert on_disk["counts"] == summary["counts"] and [d["id"] for d in on_disk["demos"]] == IDS


def test_raw_and_verified_replays_record_cameras_when_the_worker_has_them(batch, env, cam_sim, tmp_path):
    set_dir, store, _ = env
    sim = cam_sim
    _run(batch, set_dir, store, sim)
    assert all(r.record_cameras for r in sim.requests)
    other = FakeSim(tmp_path / "w2", cameras=False)
    _run(batch, set_dir, DemoStore(tmp_path / "s2"), other, out_dir=tmp_path / "o2")
    assert not any(r.record_cameras for r in other.requests)


def test_no_cameras_flag_turns_recording_off(batch, env, cam_sim):
    set_dir, store, _ = env
    sim = cam_sim
    _run(batch, set_dir, store, sim, record_cameras=False)
    assert not any(r.record_cameras for r in sim.requests)


def test_limit_processes_only_that_many_demos(batch, env):
    set_dir, store, sim = env
    summary = _run(batch, set_dir, store, sim, limit=2)
    assert summary["counts"]["kept"] == 2 and summary["counts"]["pending"] == 1
    assert [d["status"] for d in summary["demos"]] == ["kept", "kept", "pending"]


# --- resume (Review Focus 2) ---------------------------------------------------------------------

def test_worker_crash_mid_batch_stops_with_a_clear_message_and_resume_finishes_the_rest(batch, env, tmp_path):
    set_dir, store, sim = env
    sim.errors = {2: SimWorkerUnavailable("sim worker unavailable at http://127.0.0.1:8770/replay: "
                                          "RemoteProtocolError: disconnected; start the sim worker")}
    summary = _run(batch, set_dir, store, sim)
    assert "RemoteProtocolError" in summary["stopped"] and "--resume" in summary["stopped"]
    assert [d["status"] for d in summary["demos"]] == ["kept", "pending", "pending"]
    assert not (set_dir / "pipeline" / "rules" / "pilot_1.json").exists()

    fresh = FakeSim(tmp_path / "worker", cameras=False)
    summary = _run(batch, set_dir, store, fresh, resume=True)
    assert summary["stopped"] is None and summary["counts"]["kept"] == 3
    assert _replayed(fresh) == ["pilot_1_raw", "pilot_1_rules_v1", "pilot_2_raw", "pilot_2_rules_v1"]


def test_worker_down_at_the_start_stops_before_any_demo(batch, env, tmp_path):
    set_dir, store, _ = env
    down = FakeSim(tmp_path / "w", health_error=SimWorkerUnavailable("sim worker unavailable; start the sim worker"))
    summary = _run(batch, set_dir, store, down)
    assert "start the sim worker" in summary["stopped"] and down.requests == []
    assert summary["counts"]["pending"] == 3


def test_a_worker_that_cannot_serve_the_set_stops_before_any_demo(batch, env, tmp_path):
    set_dir, store, _ = env
    no_cams = FakeSim(tmp_path / "w", cameras=False)
    summary = _run(batch, set_dir, store, no_cams, diagnoser="nemotron")
    assert "--cameras" in summary["stopped"] and no_cams.requests == []


def test_nemotron_with_cameras_turned_off_is_refused_rather_than_silently_run_as_rules(batch, env, cam_sim):
    set_dir, store, _ = env
    sim = cam_sim
    with patch.object(batch, "diagnose_gated") as model:
        summary = _run(batch, set_dir, store, sim, diagnoser="nemotron", record_cameras=False)
    assert "--cameras" in summary["stopped"] and sim.requests == []
    model.assert_not_called()


def test_existing_results_without_resume_are_refused(batch, env):
    set_dir, store, sim = env
    _run(batch, set_dir, store, sim, limit=1)
    sim.requests.clear()
    with pytest.raises(batch.BatchRefused, match="--resume"):
        _run(batch, set_dir, store, sim)
    assert sim.requests == []


def test_force_runs_every_demo_again(batch, env):
    set_dir, store, sim = env
    _run(batch, set_dir, store, sim, limit=1)
    sim.requests.clear()
    _run(batch, set_dir, store, sim, force=True)
    assert len(_replayed(sim)) == 6


def test_a_demo_that_errored_is_retried_on_resume(batch, env, tmp_path):
    set_dir, store, sim = env
    sim.errors = {0: SimWorkerError("HTTP 500 sim_error: IK diverged", status=500, error="sim_error")}
    summary = _run(batch, set_dir, store, sim)
    assert summary["stopped"] is None and [d["status"] for d in summary["demos"]] == ["error", "kept", "kept"]
    assert "IK diverged" in summary["demos"][0]["error"]
    fresh = FakeSim(tmp_path / "worker", cameras=False)
    _run(batch, set_dir, store, fresh, resume=True)
    assert _replayed(fresh) == ["pilot_0_raw", "pilot_0_rules_v1"]


def test_a_corrupt_demo_is_an_error_and_the_batch_goes_on(batch, env):
    set_dir, store, sim = env
    (set_dir / "pilot_1" / "demo.json").write_text("{not json", encoding="utf-8")
    summary = _run(batch, set_dir, store, sim)
    assert [d["status"] for d in summary["demos"]] == ["kept", "error", "kept"]


def test_an_incomplete_set_is_refused(batch, tmp_path):
    set_dir = _make_set(tmp_path, manifest=False)
    with pytest.raises(batch.BatchRefused, match="manifest"):
        _run(batch, set_dir, DemoStore(tmp_path / "store"), FakeSim(tmp_path / "w"))


# --- Nemotron's call budget ------------------------------------------------------------------------

class Usage:
    """Fake usage log: each model call adds one entry costing $0.0015."""

    def __init__(self):
        self.calls = 0

    def __call__(self):
        return self.calls, self.calls * 0.0015


def test_nemotron_calls_are_counted_and_the_budget_stops_the_batch(batch, env, cam_sim):
    set_dir, store, _ = env
    sim = cam_sim
    usage = Usage()

    def model(*args, **kwargs):
        usage.calls += 1
        return _keep(), []

    with patch.object(batch, "diagnose_gated", side_effect=model):
        summary = _run(batch, set_dir, store, sim, diagnoser="nemotron", max_model_calls=3, model_usage=usage)
    # each diagnose may make 2 calls (one retry), so a third diagnose would risk calls 3 and 4 of 3
    assert usage.calls == 2
    assert [d["status"] for d in summary["demos"]] == ["kept", "kept", "pending"]
    assert "budget" in summary["stopped"]
    assert summary["model_calls"] == 2 and summary["est_cost_usd"] == pytest.approx(0.003)
    assert not store.has_demo("pilot_2_nemotron")


def test_the_cost_budget_also_stops_the_batch(batch, env, cam_sim):
    set_dir, store, _ = env
    sim = cam_sim
    usage = Usage()

    def model(*args, **kwargs):
        usage.calls += 1
        return _keep(), []

    with patch.object(batch, "diagnose_gated", side_effect=model):
        summary = _run(batch, set_dir, store, sim, diagnoser="nemotron", max_model_calls=100,
                       max_cost_usd=0.006, model_usage=usage)
    assert usage.calls == 1 and "budget" in summary["stopped"]  # $0.0015 spent + 2 x $0.0025 reserved > $0.006


def test_rules_never_touch_the_model(batch, env):
    set_dir, store, sim = env
    with patch.object(batch, "diagnose_gated") as model, patch("app.jobs.diagnose_gated") as default:
        summary = _run(batch, set_dir, store, sim, model_usage=Usage())
    default.assert_not_called()
    model.assert_not_called()
    assert summary["model_calls"] == 0


# --- CLI ------------------------------------------------------------------------------------------

def test_main_exit_codes(batch, env, tmp_path, monkeypatch):
    set_dir, _, _ = env
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    ok = FakeSim(tmp_path / "w", cameras=False)
    with patch.object(batch, "SimWorkerClient", return_value=ok):
        assert batch.main(["--set", str(set_dir), "--diagnoser", "rules"]) == 0
        assert batch.main(["--set", str(set_dir), "--diagnoser", "rules"]) == 1  # refused: results exist
        assert batch.main(["--set", str(set_dir), "--diagnoser", "rules", "--resume"]) == 0
    assert DemoStore(tmp_path / "data").has_demo("pilot_0_rules")
    down = FakeSim(tmp_path / "w2", health_error=SimWorkerUnavailable("down"))
    with patch.object(batch, "SimWorkerClient", return_value=down):
        assert batch.main(["--set", str(set_dir), "--diagnoser", "rules", "--force"]) == 2
