"""scripts/build_test_track.py: recorded Isaac runs -> the Test track's static JSON (web/public/test-track-data)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("build_test_track", REPO / "scripts" / "build_test_track.py")
btt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(btt)

N = 12
SCENE = {"cube_pose": {"pos": [0.5, -0.1, 0.025], "quat_wxyz": [1.0, 0.0, 0.0, 0.0]},
         "bin_pose": {"pos": [0.5, 0.3, 0.0], "quat_wxyz": [1.0, 0.0, 0.0, 0.0]}, "robot": "franka", "seed": 0}


def _path():
    """The gripper goes down to the cube, closes, carries it over the bin and lets go."""
    ee = np.zeros((N, 3))
    ee[:4] = [0.5, -0.1, 0.04]
    for k in range(4, 9):
        ee[k] = [0.5, -0.1 + 0.4 * (k - 3) / 5, 0.2]
    ee[9:] = [0.5, 0.3, 0.2]
    grip = np.array([0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0], dtype=np.int8)
    return ee, grip


def _episode(d: Path, demo_id: str, *, signals: bool, verification: dict | None, cameras=()):
    d.mkdir(parents=True)
    ee, grip = _path()
    q = np.tile(np.linspace(0, 1, 9, dtype=np.float32), (N, 1))
    np.savez(d / "steps.npz", joint_pos=q, action=q, ee_pos=ee.astype(np.float32), ee_quat=np.zeros((N, 4), np.float32), gripper=grip)
    meta = {"demo_id": demo_id, "robot": "franka", "task_text": "t", "fps": 50, "n_steps": N, "cameras": list(cameras), "passport": None}
    if verification is not None and not signals:
        meta["passport"] = {"verification": verification}
    (d / "episode.json").write_text(json.dumps(meta))
    (d / "scene.json").write_text(json.dumps(SCENE))
    if signals:
        cube = np.tile([0.5, -0.1, 0.025], (N, 1))
        force = np.zeros(N)
        force[5] = 3.21
        np.savez(d / "signals.npz", cube_pos=cube, max_contact_force=force, contact_gripper_cube=np.zeros(N, bool),
                 contact_arm_bin=np.zeros(N, bool), contact_arm_table=np.zeros(N, bool))
    if verification is not None and signals:
        (d / "verification.json").write_text(json.dumps(verification))


VER = {"success": True, "reasons": [], "duration": 0.24, "path_length": 0.61234, "max_contact_force": 3.21, "settle_time": 0.1}


@pytest.fixture
def gate(tmp_path):
    root = tmp_path / "gate"
    for s in (5350, 5351):
        _episode(root / "replay" / "episodes" / f"teacher_{s}", f"teacher_{s}", signals=True, verification=VER)
    (root / "verify.json").write_text(json.dumps({
        "summary": {"successes": 2, "n": 2, "rate": 1.0, "ci95": [0.342, 1.0]},
        "verdicts": {"5351": {"success": True, "reasons": [], "duration": 0.24}, "5350": {"success": True, "reasons": [], "duration": 0.24}}}))
    (root / "in_env.json").write_text(json.dumps({"checkpoint": "data\\rl\\model_2098.pt", "in_env": {"5350": {"success": True, "steps": 12}}}))
    return root


@pytest.fixture
def round0(tmp_path):
    root = tmp_path / "r0"
    _episode(root / "episodes" / "teacher_r0_4000", "teacher_r0_4000", signals=False, verification=VER, cameras=("front",))
    rows = [
        {"seed": 4000, "success": True, "ended_by": "success", "reasons": [], "steps": 12, "episodes": ["teacher_r0_4000"]},
        {"seed": 4001, "success": False, "ended_by": "time_limit", "reasons": ["dropped"], "steps": 1500, "episodes": []},
    ]
    (root / "rollouts.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    (root / "round_t300.json").write_text(json.dumps({"teacher_checkpoint": "C:\\x\\policy.pt"}))
    return root


def test_the_gate_replays_carry_the_recorded_cube_and_contact_in_the_twins_shape(gate, tmp_path):
    out = tmp_path / "out"
    index = btt.build(gate, None, None, out)
    src = index["sources"][0]
    assert src["id"] == "teacher-gate" and src["seeds"] == [5350, 5351]
    assert src["summary"] == {"successes": 2, "n": 2, "ci95": [0.342, 1.0], "judge": "SANT's physics replay"}
    assert src["checkpoint"] == "data\\rl\\model_2098.pt"
    assert [r["seed"] for r in src["runs"]] == [5350, 5351]  # numeric order, whatever verify.json's
    run = src["runs"][0]
    assert run["recorded"] and run["file"] == "runs/teacher-gate/5350.json" and run["in_env"] is True
    assert src["runs"][1]["in_env"] is None  # in_env.json has no 5351
    assert run["peak_contact_n"] == 3.21 and run["path_m"] == 0.612 and run["duration_s"] == 0.24
    ep = json.loads((out / run["file"]).read_text())
    assert ep["cube_source"] == "recorded" and ep["cube_pos"][0] == [0.5, -0.1, 0.025]
    assert ep["contact_n"][5] == 3.21 and len(ep["joint_pos"]) == N and len(ep["joint_names"]) == 9
    assert len(ep["hand_pos"]) == N and ep["hand_pos"][0] == [0.5, -0.1, 0.04]
    assert ep["bin"] == [0.5, 0.3, 0.0, 1.0, 0.0, 0.0, 0.0] and ep["facts"]["success"] is True
    assert json.loads((out / "index.json").read_text())["sources"][0]["id"] == "teacher-gate"


def test_round0_estimates_the_cube_and_lists_failed_rollouts_without_a_replay(round0, tmp_path):
    out = tmp_path / "out"
    src = btt.build(None, None, round0, out)["sources"][0]
    assert src["id"] == "distill-r0" and src["checkpoint"] == "C:\\x\\policy.pt"
    assert src["summary"]["successes"] == 1 and src["summary"]["n"] == 2 and src["summary"]["ci95"] == btt.wilson(1, 2)
    ok, failed = src["runs"]
    assert ok["recorded"] and ok["cube_source"] == "estimated" and ok["peak_contact_n"] == 3.21
    assert failed == {**failed, "recorded": False, "file": None, "success": False, "reasons": ["dropped"], "ended_by": "time_limit", "steps": 1500}
    ep = json.loads((out / ok["file"]).read_text())
    assert ep["cube_source"] == "estimated" and ep["contact_n"] is None
    assert not (out / "runs" / "distill-r0" / "4001.json").exists()


def test_the_cube_estimate_follows_the_gripper_then_falls_into_the_bin():
    ee, grip = _path()
    est = btt.estimate_cube(ee, grip, np.array([0.5, -0.1, 0.025]), [0.5, 0.3, 0.0], [0.2, 0.2, 0.08], fps=50)
    assert np.allclose(est[:3], [0.5, -0.1, 0.025])  # untouched until the gripper closes on it
    offset = np.array([0.5, -0.1, 0.025]) - ee[3]
    assert np.allclose(est[5], ee[5] + offset)  # carried
    assert est[9][2] < est[8][2] or est[9][2] == pytest.approx(est[8][2])  # let go: it starts to fall
    assert est[-1][2] >= btt.REST_IN_BIN_Z and np.allclose(est[-1][:2], est[8][:2])  # straight down, never through the floor


def test_a_gripper_that_closes_far_from_the_cube_leaves_it_where_it_is():
    ee = np.tile([0.1, 0.1, 0.3], (N, 1))
    grip = np.array([0, 1] * (N // 2), dtype=np.int8)
    est = btt.estimate_cube(ee, grip, np.array([0.5, -0.1, 0.025]), [0.5, 0.3, 0.0], [0.2, 0.2, 0.08], fps=50)
    assert np.allclose(est, [0.5, -0.1, 0.025])


def test_a_cube_dropped_outside_the_bin_lands_on_the_table():
    ee, grip = _path()
    ee[4:] = [0.9, 0.9, 0.2]
    est = btt.estimate_cube(ee, grip, np.array([0.5, -0.1, 0.025]), [0.5, 0.3, 0.0], [0.2, 0.2, 0.08], fps=5)
    assert est[-1][2] == pytest.approx(btt.CUBE_HALF)


def test_check_estimate_measures_against_recorded_runs(gate):
    r = btt.check_estimate([gate])
    assert r["episodes"] == 2 and r["held_median_mm"] > 0 and r["landed_median_mm"] >= 0


def test_wilson_matches_the_gates_interval():
    assert btt.wilson(50, 50) == pytest.approx([0.9287, 1.0], abs=1e-4)
    assert btt.wilson(0, 0) == [0.0, 1.0]


def test_main_skips_missing_sources(tmp_path, gate, capsys):
    out = tmp_path / "o"
    assert btt.main(["--gate", str(gate), "--replay-check", str(tmp_path / "nope"), "--round0", str(tmp_path / "nope2"), "--final", str(tmp_path / "nope3"),
                     "--out", str(out)]) == 0
    err = capsys.readouterr()
    assert "skipped replay-check" in err.err and "skipped final" in err.err and "teacher-gate: 2/2 verified, 2 replays" in err.out
    assert [s["id"] for s in json.loads((out / "index.json").read_text())["sources"]] == ["teacher-gate"]


# ---- the final test (the big test's pre-registered one-shot run): per-step traces + the eval's episode log ----

FINAL_N = 6
CKPT = r"C:\x\checkpoints\180000\pretrained_model"


def _trace(d: Path, seed: int, n: int = FINAL_N, *, meta_steps: int | None = None) -> None:
    d.mkdir(parents=True, exist_ok=True)
    k = np.arange(n, dtype=np.float64)
    cube = np.stack([0.5 + 0 * k, -0.1 + 0.08 * k, 0.025 + 0 * k], axis=1)
    contact = np.zeros(n, bool)
    contact[1:3] = True
    np.savez(d / f"seed_{seed}.npz", joint_pos=np.tile(np.linspace(0, 1, 9), (n, 1)), action=np.zeros((n, 9)),
             tcp_pos=cube + [0, 0, 0.1], tcp_quat_wxyz=np.tile([0, 1.0, 0, 0], (n, 1)), cube_pos=cube,
             cube_quat_wxyz=np.tile([1.0, 0, 0, 0], (n, 1)), gripper=np.array([0, 1, 1, 1, 0, 0][:n]),
             contact_gripper_cube=contact, contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool),
             max_contact_force=np.where(contact, 2.345, 0.0))
    (d / f"seed_{seed}.json").write_text(json.dumps({"seed": seed, "n_steps": meta_steps or n, "fps": 50}))


@pytest.fixture
def final(tmp_path):
    root = tmp_path / "bigtest_test"
    eps = [
        {"seed": 5401, "success": True, "reasons": [], "ended_by": "success", "steps": FINAL_N, "sim_s": 0.1},
        {"seed": 5400, "success": False, "reasons": ["not_in_bin", "dropped"], "ended_by": "time_limit", "steps": FINAL_N, "sim_s": 0.1},
        {"seed": 5402, "success": True, "reasons": [], "ended_by": "success", "steps": FINAL_N, "sim_s": 0.1},
    ]
    for e in eps:
        _trace(root / "bigtest_final_traces", e["seed"])
        e["final_cube_pos"] = [0.5, -0.1 + 0.08 * (FINAL_N - 1), 0.025]
    lines = [{"header": {"checkpoint": CKPT, "seed0": 5400, "n": 3}}] + [{"episode": e} for e in eps]
    (root / "bigtest_final.episodes.jsonl").write_text("\n".join(json.dumps(r) for r in lines) + "\n")
    return root


def _scene_for(seed: int) -> dict:
    return {**SCENE, "seed": seed}


VERDICTS = {5400: {"success": False, "reasons": ["dropped", "not_in_bin"]}, 5401: {"success": True, "reasons": []}, 5402: {"success": True, "reasons": []}}


def _judge(arrays, scene, fps):
    return {**VERDICTS[scene["seed"]], "duration": 0.1, "path_length": 0.43219, "max_contact_force": 2.345, "settle_time": 0.0612}


def _build_final(root, out, **kw):
    return btt.build_final_test(root, "final-test-v2", "The final test", "40 unseen scenes", out, scene_for=_scene_for, judge=kw.pop("judge", _judge), **kw)


def test_the_final_test_carries_every_episode_its_verdict_reasons_and_contacts(final, tmp_path):
    out = tmp_path / "out"
    src = _build_final(final, out)
    assert src["id"] == "final-test-v2" and src["seeds"] == [5400, 5402]
    assert src["checkpoint"] == CKPT
    assert src["summary"]["successes"] == 2 and src["summary"]["n"] == 3 and src["summary"]["ci95"] == btt.wilson(2, 3)
    assert "check_success" in src["summary"]["judge"]
    assert [r["seed"] for r in src["runs"]] == [5400, 5401, 5402]
    failed = src["runs"][0]
    assert failed["recorded"] and failed["file"] == "runs/final-test-v2/5400.json"
    assert failed["success"] is False and failed["reasons"] == ["not_in_bin", "dropped"]  # the eval's own words, its order
    assert failed["ended_by"] == "time_limit" and failed["steps"] == FINAL_N
    assert failed["duration_s"] == 0.1 and failed["path_m"] == 0.432 and failed["peak_contact_n"] == 2.35 and failed["settle_s"] == 0.06
    ep = json.loads((out / failed["file"]).read_text())
    assert ep["n_steps"] == FINAL_N and len(ep["joint_pos"]) == FINAL_N and len(ep["joint_names"]) == 9
    assert ep["cube_source"] == "recorded" and ep["cube_pos"][-1] == [0.5, 0.3, 0.025]
    assert ep["bin"] == [0.5, 0.3, 0.0, 1.0, 0.0, 0.0, 0.0]  # from the scene, as the eval placed it
    assert ep["hand_pos"][0] == [0.5, -0.1, 0.125] and ep["contact_n"][1] == 2.35
    assert len(ep["cube_quat_path"]) == FINAL_N and ep["cube_quat_path"][0] == [1.0, 0.0, 0.0, 0.0]
    assert ep["contacts"] == {"gripper_cube": [[1, 3]], "arm_bin": [], "arm_table": []}
    assert ep["verified"] is False and ep["facts"]["reasons"] == ["not_in_bin", "dropped"]


def test_the_final_test_refuses_a_trace_that_disagrees_with_its_verdict(final, tmp_path):
    with pytest.raises(ValueError, match="5400"):
        _build_final(final, tmp_path / "o1", judge=lambda a, s, f: {**_judge(a, s, f), "success": True, "reasons": []})
    _trace(final / "bigtest_final_traces", 5401, meta_steps=FINAL_N + 1)
    with pytest.raises(ValueError, match="5401"):
        _build_final(final, tmp_path / "o2")


def test_build_puts_the_final_test_first(final, gate, tmp_path, monkeypatch):
    monkeypatch.setattr(btt, "final_scene", _scene_for)
    monkeypatch.setattr(btt, "judge_trace", _judge)
    index = btt.build(gate, None, None, tmp_path / "out", final=final)
    assert [s["id"] for s in index["sources"]] == ["final-test-v2", "teacher-gate"]
    assert "30/40" not in index["sources"][0]["title"]  # the title counts what it read, not a hard-coded result
    assert index["sources"][0]["title"].endswith("2/3")


def test_the_final_tests_scenes_are_the_evals_own():
    import sys
    sys.path[:0] = [str(REPO / "src"), str(REPO)]
    from sim_eval.scenes import eval_scenes

    for seed in (5400, 5439):
        assert btt.final_scene(seed) == eval_scenes(1, seed)[0].model_dump(mode="json")


REAL_FINAL = btt.FINAL


@pytest.mark.skipif(not (REAL_FINAL / "bigtest_final.episodes.jsonl").is_file(), reason="the big test's data is only on the lead's machine")
def test_the_real_final_test_is_40_runs_30_verified_and_each_rejudged_alike(tmp_path):
    src = btt.build_final_test(REAL_FINAL, "final-test-v2", "t", "w", tmp_path)
    assert src["summary"]["n"] == 40 and src["summary"]["successes"] == 30
    assert src["summary"]["ci95"] == pytest.approx([0.598, 0.858], abs=5e-4)
    assert src["seeds"] == [5400, 5439] and all(r["recorded"] for r in src["runs"])
    assert all(r["reasons"] for r in src["runs"] if not r["success"])
