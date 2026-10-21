"""scripts/build_test_track.py: recorded Isaac runs -> the Test track's static JSON (web/public/test-track)."""
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
    assert btt.main(["--gate", str(gate), "--replay-check", str(tmp_path / "nope"), "--round0", str(tmp_path / "nope2"), "--out", str(out)]) == 0
    err = capsys.readouterr()
    assert "skipped replay-check" in err.err and "teacher-gate: 2/2 verified, 2 replays" in err.out
    assert [s["id"] for s in json.loads((out / "index.json").read_text())["sources"]] == ["teacher-gate"]
