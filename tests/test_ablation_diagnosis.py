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


# --- sprint 5 (pre-registered): v2 arms, manifest check, negatives' false-positive rates -----------------

import hashlib  # noqa: E402


def _v2_episode(root: Path, name: str, kind: str, close=40, open_=80, bin_y=0.3, offset_m=0.0, truth=None):
    """A v2-style episode: the cube rides in the gripper between the close and the first open, then rests where
    it was let go. truth.json carries the demo type, as T1's v2 does."""
    traj = _traj()
    grip = [1 if close <= i < open_ else 0 for i in range(len(traj.t))]
    traj = traj.model_copy(update={"gripper": grip})
    scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                  bin_pose=Pose(pos=(0.5, bin_y, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=0)
    sim = FakeSim(root)
    resp = sim.replay(ReplayRequest(trajectory=traj, scene=scene, record_cameras=True, out_name=name))
    ep = Path(resp.ep_dir)
    a = traj.to_arrays()
    n = len(traj.t)
    cube = np.tile(a["ee_pos"][close] + [offset_m, 0.0, 0.0], (n, 1))
    cube[close:open_] = a["ee_pos"][close:open_] + [offset_m, 0.0, 0.0]
    cube[open_:] = (cube[open_ - 1][0], cube[open_ - 1][1], 0.025)
    held = np.zeros(n, dtype=bool)
    held[close:open_] = True
    sig = np.load(ep / "signals.npz")
    np.savez(ep / "signals.npz", **{**{k: sig[k] for k in sig.files}, "cube_pos": cube,
                                    "contact_gripper_cube": held})
    (ep / "demo.json").write_text(Demo(id=name, source="human", trajectory=traj, scene=scene,
                                       human_seconds=2.0).model_dump_json(), encoding="utf-8")
    (ep / "truth.json").write_text(json.dumps({"synthetic": True, "demo_id": name, "type": kind,
                                               "issues": truth or []}), encoding="utf-8")
    ok = kind not in ("drop", "bad_release")
    (ep / "verification.json").write_text(json.dumps({"success": ok, "reasons": [] if ok else ["not_in_bin"],
                                                      "duration": 2.0, "path_length": 0.5,
                                                      "max_contact_force": 0.0}), encoding="utf-8")
    return ep


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _t1_demo_sha(path: Path) -> str:
    """T1's manifest definition (scripts/make_measurement_set_v2.py): the Demo's JSON without created_at, not the
    file's bytes. truth_sha256 is the file's bytes."""
    demo = Demo.model_validate_json(path.read_text(encoding="utf-8"))
    return hashlib.sha256(demo.model_dump_json(exclude={"created_at"}).encode()).hexdigest()


@pytest.fixture
def v2(tmp_path):
    root = tmp_path / "eps"
    t_open = lambda k: k * 0.02  # noqa: E731
    eps = [
        _v2_episode(root, "v2_0", "timing_off_center", offset_m=0.008, truth=[GRASP_TRUTH]),
        _v2_episode(root, "v2_1", "timing_centered", offset_m=0.0),
        _v2_episode(root, "v2_2", "drop", open_=45,
                    truth=[{"type": "drop", "t0": t_open(45), "t1": t_open(45), "dont_care": False}]),
        _v2_episode(root, "v2_3", "bad_release", bin_y=0.45,
                    truth=[{"type": "bad_release", "t0": t_open(80), "t1": t_open(80), "dont_care": False}]),
        _v2_episode(root, "v2_4", "clean"),
    ]
    manifest = {"name": "v2", "demos": [{"id": ep.name, "type": json.loads((ep / "truth.json").read_text())["type"],
                                         "demo_sha256": _t1_demo_sha(ep / "demo.json"),
                                         "truth_sha256": _sha(ep / "truth.json")} for ep in eps]}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return eps, tmp_path / "manifest.json", tmp_path / "out"


def _run_v2(abl, v2, diagnosers, model=None, usage=None, **kw):
    eps, manifest, out = v2
    usage = usage or Usage()
    calls = []

    def default(frames, wrist, windows, traj, task_text, success, duration, **k):
        usage.calls += 1
        calls.append(k)
        from app.ai.diagnose import merge_hybrid
        from demo_pipeline.rules import detect_rules

        reply = Diagnosis.model_validate({"segments": [], "issues": [{"type": "grasp_off_center", "t": 0.8,
                                                                      "evidence": "x"}],
                                          "repairs": [], "decision": "keep", "label": TASK_TEXT})
        return merge_hybrid(detect_rules(traj, windows, task_text), reply, t_close=0.8, offset_mm=None,
                            replay_success=success)

    with patch.object(abl, "diagnose_hybrid", side_effect=model or default):
        summary = abl.run_ablation(eps, None, list(diagnosers), out, manifest=manifest, model_usage=usage,
                                   log=lambda s: None, **kw)
    return summary, calls


def test_v2_case_carries_its_type_and_bin_pose(abl, v2):
    eps, _, _ = v2
    case = abl.load_case(eps[2])
    assert case.kind == "drop" and case.bin_pose.pos == (0.5, 0.3, 0.0) and case.replay_success is False


def test_code_all_finds_the_drop_and_the_bad_release_from_sim_state(abl, v2):
    summary, calls = _run_v2(abl, v2, ["code_all"])
    assert calls == []
    pt = summary["diagnosers"]["code_all"]["per_type"]
    assert pt["drop"]["tp"] == 1 and pt["drop"]["fp"] == 0
    assert pt["bad_release"]["tp"] == 1 and pt["bad_release"]["fp"] == 0
    assert pt["grasp_off_center"]["tp"] == 1 and pt["grasp_off_center"]["fp"] == 0


def test_hybrid_blind_is_called_blind_and_both_hybrid_arms_get_the_bin(abl, v2):
    _, calls = _run_v2(abl, v2, ["hybrid", "hybrid_blind"])
    assert [k["blind"] for k in calls] == [False, True] * 5  # per episode: hybrid, then hybrid_blind
    assert all(k["bin_pose"] is not None and k["signals"] is not None for k in calls)


def test_negatives_false_positive_rates_per_type(abl, v2):
    summary, _ = _run_v2(abl, v2, ["hybrid_blind"])
    blind = summary["diagnosers"]["hybrid_blind"]
    # the fake claims an off-center grasp everywhere: 4 grasp negatives, all false positives
    assert blind["negatives_fp_rate"]["grasp_off_center"] == {"episodes": 4, "with_fp": 4, "rate": 1.0}
    assert blind["grasp_fp_rate_on_centered"] == {"episodes": 1, "with_fp": 1, "rate": 1.0}
    assert blind["negatives_fp_rate"]["drop"] == {"episodes": 4, "with_fp": 0, "rate": 0.0}


def test_the_r1_bar_is_evaluated_for_the_blind_arm(abl, v2):
    summary, _ = _run_v2(abl, v2, ["hybrid_blind"])
    bar = summary["diagnosers"]["hybrid_blind"]["r1_bar"]
    assert bar == {"recall": 1.0, "fp_rate_centered": 1.0, "passes": False,
                   "rule": "grasp recall >= 0.75 and FP rate <= 0.25 on the centered negatives"}


def test_an_episode_whose_files_do_not_match_the_manifest_is_not_scored(abl, v2):
    eps, manifest, _ = v2
    (eps[4] / "truth.json").write_text(json.dumps({"type": "clean", "issues": [], "edited": True}), encoding="utf-8")
    summary, calls = _run_v2(abl, v2, ["rules"])
    assert summary["rejected"] == [{"episode": "v2_4", "reason": "truth.json does not match the manifest"}]
    assert summary["n_degraded"] == 4


def test_after_a_budget_stop_every_arm_is_scored_on_the_same_episodes(abl, v2):
    summary, calls = _run_v2(abl, v2, ["rules", "hybrid", "hybrid_blind"], max_model_calls=4)
    # 2 calls reserved per diagnose: calls 1 and 2 (episode 0), 3 (episode 1 hybrid), then the blind call stops
    assert len(calls) == 3 and "budget" in summary["stopped"]
    assert summary["scored_episodes"] == ["v2_0"]
    assert summary["diagnosers"]["rules"]["cases_scored"] == 1


def test_the_demo_hash_follows_t1s_definition_not_the_file_bytes(abl, v2):
    eps, manifest, _ = v2
    entry = json.loads(manifest.read_text())["demos"][0]
    assert entry["demo_sha256"] != _sha(eps[0] / "demo.json")  # so a file-bytes check would reject it
    ok, rejected = abl.check_manifest(eps, manifest)
    assert [e.name for e in ok] == [e.name for e in eps] and rejected == []


def test_an_edited_demo_is_still_rejected(abl, v2):
    eps, manifest, _ = v2
    demo = Demo.model_validate_json((eps[0] / "demo.json").read_text())
    edited = demo.model_copy(update={"human_seconds": 99.0})
    (eps[0] / "demo.json").write_text(edited.model_dump_json(), encoding="utf-8")
    ok, rejected = abl.check_manifest(eps, manifest)
    assert rejected == [{"episode": eps[0].name, "reason": "demo.json does not match the manifest"}]


def test_a_new_created_at_alone_does_not_count_as_an_edit(abl, v2):
    from datetime import datetime, timezone

    eps, manifest, _ = v2
    demo = Demo.model_validate_json((eps[0] / "demo.json").read_text())
    (eps[0] / "demo.json").write_text(demo.model_copy(update={"created_at": datetime(2030, 1, 1, tzinfo=timezone.utc)})
                                      .model_dump_json(), encoding="utf-8")
    assert abl.check_manifest(eps, manifest)[1] == []
