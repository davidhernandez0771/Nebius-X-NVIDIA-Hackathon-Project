"""scripts/run_experiment.py: raw, perfected and multiplied episodes for a set, written as T3's grid JSON. Fakes only.

The grid is checked with T3's own reader (lerobot_tools.experiments.load_grid) and integrity check
(lerobot_tools.assemble.build_manifest: lineage to <= n_human human demos, no repairs in raw cells).
"""
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
from fake_sim_worker import FakeSim, verification
from lerobot_tools.assemble import build_manifest
from lerobot_tools.experiments import load_grid

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
IDS = ["s1_0", "s1_1", "s1_2"]
SEED0 = 100_000


def _load():
    spec = importlib.util.spec_from_file_location("run_experiment", SCRIPTS / "run_experiment.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def exp():
    return _load()


def _traj(n=100, pause_steps=0):
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if 40 <= i < 80 else 0 for i in range(n)]
    pos = pos[:60] + [pos[60]] * pause_steps + pos[60:]
    grip = grip[:60] + [1] * pause_steps + grip[60:]
    m = len(pos)
    return Trajectory(t=[i * 0.02 for i in range(m)], ee_pos=pos, ee_quat=[DOWN] * m, gripper=grip)


def _scene(seed=7):
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=seed)


def _make_set(root: Path, ids=IDS) -> Path:
    set_dir = root / "sets" / "s1"
    for k, id in enumerate(ids):
        (set_dir / id).mkdir(parents=True)
        demo = Demo(id=id, source="human", trajectory=_traj(pause_steps=40 if k == 1 else 0), scene=_scene(k),
                    human_seconds=2.0)
        (set_dir / id / "demo.json").write_text(demo.model_dump_json(), encoding="utf-8")
    (set_dir / "manifest.json").write_text(json.dumps({"name": "s1", "demos": [{"id": i} for i in ids]}),
                                           encoding="utf-8")
    return set_dir


def _keep():
    return Diagnosis.model_validate({"segments": [], "issues": [], "repairs": [], "decision": "keep",
                                     "label": TASK_TEXT})


class Usage:
    def __init__(self):
        self.calls = 0

    def __call__(self):
        return self.calls, self.calls * 0.0015


@pytest.fixture
def env(tmp_path):
    return _make_set(tmp_path), DemoStore(tmp_path / "store"), FakeSim(tmp_path / "worker")


def _run(exp, set_dir, store, sim, *, model=None, usage=None, **kw):
    kw.setdefault("n_human", [1, 2])
    kw.setdefault("variants_per_demo", 2)
    kw.setdefault("robot", "franka")
    kw.setdefault("seed0", SEED0)
    kw.setdefault("sleep", lambda s: None)
    kw.setdefault("log", lambda msg: None)
    usage = usage or Usage()

    def fake_model(*args, **kwargs):
        usage.calls += 1
        return _keep(), []

    with patch.object(exp.run_pipeline_batch, "diagnose_gated", side_effect=model or fake_model):
        return exp.run_experiment(set_dir, client=sim, store=store, model_usage=usage, **kw)


def _cells(summary):
    return {c["name"]: c for c in summary["cells"]}


def _grid(set_dir):
    return load_grid(set_dir / "experiment" / "grid.json")


# --- a full run -----------------------------------------------------------------------------------

def test_full_run_writes_a_grid_that_t3s_reader_and_integrity_check_accept(exp, env):
    set_dir, store, sim = env
    summary = _run(exp, set_dir, store, sim)
    assert summary["stopped"] is None
    grid = _grid(set_dir)
    assert grid.name == "s1"
    names = [c.name for c in grid.cells]
    assert names == ["raw_1", "raw_multiply_1", "rules_multiply_1", "perfected_multiply_1",
                     "raw_2", "raw_multiply_2", "rules_multiply_2", "perfected_multiply_2"]
    for cell in grid.cells:
        manifest = build_manifest(cell)  # raises on a lineage or repair violation
        assert len(manifest["human_roots"]) <= cell.n_human
    by = {c.name: c for c in grid.cells}
    assert len(by["raw_2"].episode_dirs) == 2
    assert len(by["raw_multiply_2"].episode_dirs) == 2 + 2 * 2  # sources + 2 variants each
    assert build_manifest(by["rules_multiply_2"])["human_roots"] == ["s1_0", "s1_1"]


def test_only_the_first_n_human_demos_are_used(exp, env):
    set_dir, store, sim = env
    _run(exp, set_dir, store, sim)
    assert not any(r.out_name.startswith("s1_2") for r in sim.requests)
    assert not store.has_demo("s1_2")


def test_cells_use_the_right_episodes(exp, env):
    set_dir, store, sim = env
    _run(exp, set_dir, store, sim)
    by = {c.name: c for c in _grid(set_dir).cells}
    names = lambda cell: sorted(Path(d).name for d in by[cell].episode_dirs)  # noqa: E731
    assert names("raw_1") == ["episode"] and Path(by["raw_1"].episode_dirs[0]).parent.name == "s1_0"
    roots = lambda cell: sorted(Path(d).parent.name for d in by[cell].episode_dirs)  # noqa: E731
    assert roots("rules_multiply_1") == ["s1_0_rules", "s1_0_rules_m100000", "s1_0_rules_m100001"]
    assert roots("perfected_multiply_1") == ["s1_0_nemotron", "s1_0_nemotron_m100000", "s1_0_nemotron_m100001"]
    assert roots("raw_multiply_1") == ["s1_0", "s1_0_m100000", "s1_0_m100001"]


def test_every_condition_multiplies_with_the_same_seeds_per_human_demo(exp, env):
    set_dir, store, sim = env
    _run(exp, set_dir, store, sim)
    seeds = {r.out_prefix: (r.seed0, r.n, r.robot, r.record_cameras) for r in sim.multiply_requests}
    assert seeds["s1_0_mx"] == seeds["s1_0_rules_mx"] == seeds["s1_0_nemotron_mx"] == (SEED0, 2, "franka", True)
    assert seeds["s1_1_mx"][0] == SEED0 + 1000


def test_all_replays_record_cameras_and_raw_is_replayed_once(exp, env):
    set_dir, store, sim = env
    _run(exp, set_dir, store, sim)
    assert all(r.record_cameras for r in sim.requests)
    assert [r.out_name for r in sim.requests].count("s1_0_raw") == 1


def test_failed_variants_count_in_the_yield_but_not_in_the_cells(exp, env, tmp_path):
    set_dir, store, _ = env
    sim = FakeSim(tmp_path / "w", failing_seeds={SEED0 + 1, SEED0 + 1000 + 1})  # one per human demo
    summary = _run(exp, set_dir, store, sim)
    assert summary["multiply"]["raw_multiply"] == {"sources": 2, "attempts": 4, "successes": 2, "yield": 0.5}
    by = {c.name: c for c in _grid(set_dir).cells}
    assert len(by["raw_multiply_2"].episode_dirs) == 2 + 2


def test_a_discarded_demo_adds_nothing_but_its_cell_is_still_complete(exp, env, tmp_path):
    set_dir, store, _ = env
    # s1_1's rules repair fails every verification (raw replays still record): it is discarded
    sim = FakeSim(tmp_path / "w")
    real_replay = sim.replay

    def replay(req):
        resp = real_replay(req)
        if req.out_name.startswith("s1_1_rules_v"):
            resp = resp.model_copy(update={"verification": verification(False)})
        return resp

    sim.replay = replay
    summary = _run(exp, set_dir, store, sim)
    cell = _cells(summary)["rules_multiply_2"]
    assert cell["complete"] and cell["discarded"] == ["s1_1"]
    by = {c.name: c for c in _grid(set_dir).cells}
    assert build_manifest(by["rules_multiply_2"])["human_roots"] == ["s1_0"]


def test_rules_only_has_no_perfected_cells(exp, env):
    set_dir, store, sim = env
    summary = _run(exp, set_dir, store, sim, diagnosers=["rules"])
    assert all(not c.name.startswith("perfected") for c in _grid(set_dir).cells)
    assert summary["stages"]["nemotron"] is None


# --- resume and stops (Review Focus 2) ---------------------------------------------------------

def test_worker_crash_during_multiply_stops_and_resume_finishes_without_redoing_work(exp, env, tmp_path):
    set_dir, store, _ = env
    sim = FakeSim(tmp_path / "w", multiply_errors={2: SimWorkerUnavailable("RemoteProtocolError: disconnected")})
    summary = _run(exp, set_dir, store, sim)
    assert summary["stop_kind"] == "worker" and "disconnected" in summary["stopped"]
    assert "--resume" in summary["stopped"]
    done = len(sim.multiply_requests)

    fresh = FakeSim(tmp_path / "w")
    summary = _run(exp, set_dir, store, fresh, resume=True)
    assert summary["stopped"] is None
    assert len(fresh.multiply_requests) == 6 - (done - 1)  # the failed call is redone, finished ones are not
    assert not any(r.out_name.endswith("_raw") for r in fresh.requests)
    assert len(_grid(set_dir).cells) == 8


def test_a_stop_still_writes_the_grid_with_only_complete_cells(exp, env, tmp_path):
    set_dir, store, _ = env
    sim = FakeSim(tmp_path / "w", multiply_errors={3: SimWorkerUnavailable("gone")})
    summary = _run(exp, set_dir, store, sim)
    complete = {c["name"] for c in summary["cells"] if c["complete"]}
    assert {c.name for c in _grid(set_dir).cells} == complete
    assert "raw_2" in complete and "perfected_multiply_2" not in complete


def test_worker_down_at_the_start_runs_nothing(exp, env, tmp_path):
    set_dir, store, _ = env
    down = FakeSim(tmp_path / "w", health_error=SimWorkerUnavailable("down; start the sim worker"))
    summary = _run(exp, set_dir, store, down)
    assert summary["stop_kind"] == "worker" and down.requests == []
    assert not (set_dir / "experiment" / "grid.json").exists()


@pytest.mark.parametrize("kw,text", [(dict(cameras=False), "--cameras"), (dict(robots=["openarm"]), "franka")])
def test_a_worker_that_cannot_run_the_experiment_is_refused(exp, env, tmp_path, kw, text):
    set_dir, store, _ = env
    sim = FakeSim(tmp_path / "w", **kw)
    summary = _run(exp, set_dir, store, sim)
    assert summary["stop_kind"] == "refused" and text in summary["stopped"] and sim.requests == []


def test_the_nemotron_budget_leaves_perfected_cells_out_and_the_rest_runs(exp, env):
    set_dir, store, sim = env
    summary = _run(exp, set_dir, store, sim, max_model_calls=2)  # room for one diagnose (2 calls reserved)
    assert summary["stop_kind"] == "budget" and "budget" in summary["stopped"]
    cells = _cells(summary)
    assert cells["perfected_multiply_1"]["complete"] and not cells["perfected_multiply_2"]["complete"]
    assert cells["perfected_multiply_2"]["missing"] == ["s1_1"]
    assert cells["rules_multiply_2"]["complete"] and cells["raw_multiply_2"]["complete"]
    assert "perfected_multiply_2" not in {c.name for c in _grid(set_dir).cells}
    assert summary["stages"]["nemotron"]["model_calls"] == 1


def test_a_sim_error_on_one_multiply_is_recorded_and_its_cells_stay_incomplete(exp, env, tmp_path):
    set_dir, store, _ = env
    err = SimWorkerError("HTTP 500 sim_error: boom", status=500, error="sim_error")
    sim = FakeSim(tmp_path / "w", multiply_errors={0: err})
    summary = _run(exp, set_dir, store, sim)
    assert summary["stopped"] is None
    assert "boom" in summary["errors"]["s1_0_mx"]
    assert not _cells(summary)["raw_multiply_1"]["complete"]


def test_more_human_demos_than_the_set_has_is_refused(exp, env):
    set_dir, store, sim = env
    with pytest.raises(exp.ExperimentRefused, match="3"):
        _run(exp, set_dir, store, sim, n_human=[5])


def test_an_existing_experiment_needs_resume_or_force(exp, env):
    set_dir, store, sim = env
    _run(exp, set_dir, store, sim, n_human=[1])
    with pytest.raises(exp.ExperimentRefused, match="--resume"):
        _run(exp, set_dir, store, sim, n_human=[1])


def test_force_redoes_every_stage(exp, env):
    set_dir, store, sim = env
    _run(exp, set_dir, store, sim, n_human=[1])
    before = (len(sim.requests), len(sim.multiply_requests))
    _run(exp, set_dir, store, sim, n_human=[1], force=True)
    assert len(sim.multiply_requests) == 2 * before[1] and len(sim.requests) == 2 * before[0]


# --- CLI ------------------------------------------------------------------------------------------

def test_main_parses_the_plan_flags_and_returns_exit_codes(exp, env, tmp_path, monkeypatch):
    set_dir, _, _ = env
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    seen = {}

    def fake_run(set_dir, **kw):
        seen.update(kw)
        return {"stopped": None, "stop_kind": None, "cells": [], "multiply": {}, "grid": None}

    with patch.object(exp, "run_experiment", side_effect=fake_run), patch.object(exp, "SimWorkerClient"):
        code = exp.main(["--set", str(set_dir), "--n-human", "5,10,20", "--variants-per-demo", "10",
                         "--robot", "franka", "--resume"])
    assert code == 0
    assert seen["n_human"] == [5, 10, 20] and seen["variants_per_demo"] == 10 and seen["robot"] == "franka"
    assert seen["resume"] is True and seen["diagnosers"] == ["rules", "nemotron"]
    assert seen["max_model_calls"] == 10 and seen["max_cost_usd"] == 0.05
