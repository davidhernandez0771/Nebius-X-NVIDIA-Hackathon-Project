"""scripts/ablation_diagnosis.py: rules vs hybrid on recorded degraded episodes plus a clean one. Model mocked."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from app.ai.diagnose import DiagnosisError
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Demo, Diagnosis, Pose, Scene, Trajectory
from demo_pipeline.sim_protocol import ReplayRequest
from fake_sim_worker import FakeSim

IDENTITY = (1.0, 0.0, 0.0, 0.0)
DOWN = (0.0, 1.0, 0.0, 0.0)
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ablation_diagnosis.py"
CLOSE = 40


def _load():
    spec = importlib.util.spec_from_file_location("ablation_diagnosis", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def abl():
    return _load()


def _traj(pause_steps=0, n=100):
    pos = [(0.5, 0.3 * i / (n - 1), 0.3 - 0.2 * np.sin(np.pi * i / (n - 1))) for i in range(n)]
    grip = [1 if CLOSE <= i < 80 else 0 for i in range(n)]
    pos = pos[:60] + [pos[60]] * pause_steps + pos[60:]
    grip = grip[:60] + [1] * pause_steps + grip[60:]
    m = len(pos)
    return Trajectory(t=[i * 0.02 for i in range(m)], ee_pos=pos, ee_quat=[DOWN] * m, gripper=grip)


def _scene():
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=0)


def _episode(root: Path, name: str, traj: Trajectory, truth: list[dict] | None, offset_m=0.0) -> Path:
    """An episode folder like T2's degraded_*: frames, steps, signals, plus demo/truth/verification json."""
    sim = FakeSim(root)
    resp = sim.replay(ReplayRequest(trajectory=traj, scene=_scene(), record_cameras=True, out_name=name))
    ep = Path(resp.ep_dir)
    sig = np.load(ep / "signals.npz")
    cube = sig["cube_pos"].copy()
    cube[:] = np.asarray(traj.ee_pos[CLOSE]) + [offset_m, 0.0, 0.0]  # the cube under the close position
    np.savez(ep / "signals.npz", **{**{k: sig[k] for k in sig.files}, "cube_pos": cube})
    if truth is not None:
        (ep / "demo.json").write_text(Demo(id=name, source="human", trajectory=traj, scene=_scene(),
                                           human_seconds=2.0).model_dump_json(), encoding="utf-8")
        (ep / "truth.json").write_text(json.dumps({"synthetic": True, "issues": truth}), encoding="utf-8")
        (ep / "verification.json").write_text(resp.verification.model_dump_json(), encoding="utf-8")
    return ep


PAUSE_TRUTH = {"type": "pause", "t0": 1.2, "t1": 2.0, "dont_care": False}
GRASP_TRUTH = {"type": "grasp_off_center", "t0": CLOSE * 0.02, "t1": CLOSE * 0.02, "dont_care": False}


@pytest.fixture
def cases(tmp_path):
    root = tmp_path / "eps"
    degraded = [_episode(root, f"degraded_{k:04d}", _traj(pause_steps=40), [PAUSE_TRUTH, GRASP_TRUTH], 0.008)
                for k in range(3)]
    clean = _episode(root, "smoke_cam", _traj(), None, 0.001)
    return degraded, clean, tmp_path / "out"


class Usage:
    def __init__(self):
        self.calls = 0

    def __call__(self):
        return self.calls, self.calls * 0.0015


def _hybrid_reply(usage, issues=()):
    def fake(frames, wrist, windows, traj, task_text, success, duration, **kw):
        assert kw["signals"].n_steps == len(traj.t)  # the measured grasp offset needs the replay's signals
        usage.calls += 1
        from app.ai.diagnose import merge_hybrid
        from demo_pipeline.rules import detect_rules

        model = Diagnosis.model_validate({"segments": [], "issues": list(issues), "repairs": [], "decision": "keep",
                                          "label": TASK_TEXT})
        return merge_hybrid(detect_rules(traj, windows, task_text), model, t_close=CLOSE * 0.02, offset_mm=8.0)
    return fake


def _run(abl, cases, diagnosers=("rules", "hybrid"), usage=None, model=None, **kw):
    degraded, clean, out = cases
    usage = usage or Usage()
    model = model or _hybrid_reply(usage, [{"type": "grasp_off_center", "t": 0.8, "evidence": "left finger"}])
    with patch.object(abl, "diagnose_hybrid", side_effect=model) as m:
        summary = abl.run_ablation(degraded, clean, list(diagnosers), out, model_usage=usage, log=lambda s: None, **kw)
    return summary, m


# --- loading cases ---------------------------------------------------------------------------------

def test_a_degraded_case_uses_the_demo_trajectory_and_its_truth(abl, cases):
    degraded, clean, _ = cases
    case = abl.load_case(degraded[0])
    assert case.name == "degraded_0000" and not case.clean
    assert case.traj == _traj(pause_steps=40)
    assert [t.type for t in case.truth] == ["pause", "grasp_off_center"]
    assert len(case.frames) == 7 and case.wrist is not None and case.replay_success is True
    assert case.signals.n_steps == len(case.traj.t)


def test_the_clean_case_has_an_empty_truth(abl, cases):
    _, clean, _ = cases
    case = abl.load_case(clean, clean=True)
    assert case.clean and case.truth == [] and case.name == "smoke_cam"


# --- a run -----------------------------------------------------------------------------------------

def test_rules_and_hybrid_are_scored_per_type_with_the_clean_false_positives(abl, cases):
    summary, model = _run(abl, cases)
    assert model.call_count == 4  # 3 degraded + 1 clean
    rules, hybrid = summary["diagnosers"]["rules"], summary["diagnosers"]["hybrid"]
    assert rules["per_type"]["pause"]["tp"] == 3 and rules["per_type"]["grasp_off_center"]["fn"] == 3
    assert hybrid["per_type"]["grasp_off_center"]["tp"] == 3 and hybrid["per_type"]["pause"]["tp"] == 3
    assert hybrid["clean_false_positives"] == {"grasp_off_center": 1}  # the fake claims a grasp on the clean too
    assert hybrid["per_type"]["grasp_off_center"]["fp"] == 0  # ...which is not mixed into the degraded scores
    assert rules["clean_false_positives"] == {}
    assert hybrid["model_calls"] == 4 and hybrid["est_cost_usd"] == pytest.approx(0.006)
    assert rules["model_calls"] == 0


def test_the_zero_call_grasp_metric_counterfactual_is_scored_too(abl, cases):
    summary, _ = _run(abl, cases, diagnosers=("rules", "rules_grasp_metric"))
    cf = summary["diagnosers"]["rules_grasp_metric"]
    assert cf["per_type"]["grasp_off_center"]["tp"] == 3 and cf["clean_false_positives"] == {}
    assert cf["model_calls"] == 0


def test_scores_and_table_are_written(abl, cases):
    _, _, out = cases
    summary, _ = _run(abl, cases)
    on_disk = json.loads((out / "scores.json").read_text(encoding="utf-8"))
    assert on_disk["diagnosers"].keys() == summary["diagnosers"].keys()
    assert on_disk["n_degraded"] == 3 and on_disk["clean"] == "smoke_cam"
    table = (out / "table.md").read_text(encoding="utf-8")
    assert "| grasp_off_center |" in table and "| pause |" in table and "clean false positives" in table
    assert "calls" in table


def test_finished_cases_are_not_rerun(abl, cases):
    usage = Usage()
    _run(abl, cases, usage=usage)
    summary, model = _run(abl, cases, usage=usage)
    model.assert_not_called()
    assert summary["diagnosers"]["hybrid"]["per_type"]["grasp_off_center"]["tp"] == 3


def test_the_budget_stops_the_run_and_leaves_the_rest_pending(abl, cases):
    summary, model = _run(abl, cases, max_model_calls=3)  # 2 reserved per diagnose: two cases fit
    assert model.call_count == 2 and "budget" in summary["stopped"]
    assert summary["diagnosers"]["hybrid"]["cases_done"] == 2 and summary["diagnosers"]["hybrid"]["pending"] == 2


def test_a_failed_model_call_scores_the_rules_fallback_and_says_so(abl, cases):
    def broken(*args, **kwargs):
        raise DiagnosisError("no valid diagnosis after 2 attempts")

    summary, _ = _run(abl, cases, model=broken)
    hybrid = summary["diagnosers"]["hybrid"]
    assert hybrid["fallbacks"] == 4 and hybrid["per_type"]["pause"]["tp"] == 3
    assert hybrid["per_type"]["grasp_off_center"]["fn"] == 3


def test_limit_runs_only_the_first_episodes(abl, cases):
    summary, model = _run(abl, cases, limit=1)
    assert model.call_count == 2  # 1 degraded + the clean
    assert summary["n_degraded"] == 1


def test_main_parses_flags(abl, cases, monkeypatch):
    degraded, clean, out = cases
    seen = {}

    def fake(episode_dirs, clean_dir, diagnosers, out_dir, **kw):
        seen.update(episodes=episode_dirs, clean=clean_dir, diagnosers=diagnosers, out=out_dir, **kw)
        return {"stopped": None, "diagnosers": {}}

    with patch.object(abl, "run_ablation", side_effect=fake), patch("dotenv.load_dotenv"):
        code = abl.main(["--episodes", str(degraded[0].parent / "degraded_*"), "--diagnosers", "rules,hybrid",
                         "--clean", str(clean), "--out", str(out)])
    assert code == 0
    assert [p.name for p in seen["episodes"]] == ["degraded_0000", "degraded_0001", "degraded_0002"]
    assert seen["diagnosers"] == ["rules", "hybrid"] and seen["max_model_calls"] == 50
    assert seen["max_cost_usd"] == 0.10
