"""scripts/build_look_clip.py: two policies' traces on the same seeds -> the LOOK clip's static JSON."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
_spec = importlib.util.spec_from_file_location("build_look_clip", REPO / "scripts" / "build_look_clip.py")
blc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(blc)

N = 6
POSE = [0.0, -0.3, 0.0, -2.4, 0.0, 2.1, 0.78, 0.04, 0.04]
RAW_CKPT = r"C:\data\raw_10\checkpoints\030000\pretrained_model"
V2_CKPT = r"C:\data\distill_r0\checkpoints\180000\pretrained_model"
SCENE = {"cube_pose": {"pos": [0.5, -0.1, 0.025], "quat_wxyz": [1.0, 0.0, 0.0, 0.0]},
         "bin_pose": {"pos": [0.5, 0.3, 0.0], "quat_wxyz": [1.0, 0.0, 0.0, 0.0]}, "robot": "franka"}


def _scene_for(seed: int) -> dict:
    return {**SCENE, "seed": seed}


def _judge(a, scene, fps):
    """A gripper that closed took the cube to the bin (the v2 traces); one that never closed did nothing (raw)."""
    ok = bool(np.asarray(a["gripper"]).any())
    return {"success": ok, "reasons": [] if ok else ["not_in_bin"], "duration": 0.1, "path_length": 0.5,
            "max_contact_force": 0.0, "settle_time": 0.05}


def _trace(d: Path, seed: int, *, grips: bool) -> list[float]:
    d.mkdir(parents=True, exist_ok=True)
    k = np.arange(N, dtype=np.float64)
    cube = np.stack([0.5 + 0 * k, -0.1 + (0.08 * k if grips else 0 * k), 0.025 + 0 * k], axis=1)
    np.savez(d / f"seed_{seed}.npz", joint_pos=np.tile(np.linspace(0, 1, 9), (N, 1)), action=np.zeros((N, 9)),
             tcp_pos=cube + [0, 0, 0.1], tcp_quat_wxyz=np.tile([0, 1.0, 0, 0], (N, 1)), cube_pos=cube,
             cube_quat_wxyz=np.tile([1.0, 0, 0, 0], (N, 1)), gripper=np.array([0, 1, 1, 1, 0, 0] if grips else [0] * N),
             contact_gripper_cube=np.zeros(N, bool), contact_arm_bin=np.zeros(N, bool), contact_arm_table=np.zeros(N, bool),
             max_contact_force=np.zeros(N))
    (d / f"seed_{seed}.json").write_text(json.dumps({"seed": seed, "n_steps": N, "fps": 50}))
    return cube[-1].tolist()


def _eval(root: Path, cell: str, ckpt: str, seeds: dict[int, bool], *, traces: bool, inference=None, pose=POSE,
          final_cube=None) -> Path:
    """An eval folder as run_eval writes it: <cell>.json, <cell>.episodes.jsonl and, with traces, <cell>_traces."""
    root.mkdir(parents=True, exist_ok=True)
    eps = []
    for seed, ok in seeds.items():
        last = _trace(root / f"{cell}_traces", seed, grips=ok) if traces else [0.5, -0.1 + (0.4 if ok else 0.0), 0.025]
        eps.append({"seed": seed, "success": ok, "reasons": [] if ok else ["not_in_bin"], "ended_by": "success" if ok else "time_limit",
                    "steps": N, "sim_s": 0.1, "final_cube_pos": (final_cube or {}).get(seed, last)})
    header = {"checkpoint": ckpt, "seed0": min(seeds), "n": len(seeds), "cell": cell, "reset_pose": pose}
    if inference is not None:
        header["inference"] = inference
    (root / f"{cell}.episodes.jsonl").write_text("\n".join(json.dumps(r) for r in [{"header": header}, *({"episode": e} for e in eps)]) + "\n")
    (root / f"{cell}.json").write_text(json.dumps({"run": {"checkpoint": ckpt}, "summary": {"n": len(eps), "successes": sum(seeds.values())}}))
    return root


V2_INF = {"binarize_gripper": False, "n_action_steps": None, "temporal_ensemble_coeff": None, "gripper_deadband": 0.25}


@pytest.fixture
def heads(tmp_path):
    """The raw arm's headline (no traces, all failed) and v2's final test (traced, one failure)."""
    raw = _eval(tmp_path / "raw_head", "raw_10", RAW_CKPT, {5020: False, 5021: False, 5022: False}, traces=False)
    v2 = _eval(tmp_path / "v2_head", "bigtest_final", V2_CKPT, {5402: False, 5403: True, 5404: True}, traces=True, inference=V2_INF)
    return (raw, "raw_10"), (v2, "bigtest_final")


def _build(raw, v2, out, heads, **kw):
    return blc.build(raw, v2, out, raw_head=heads[0], v2_head=heads[1], scene_for=_scene_for, judge=_judge, **kw)


def test_the_raw_policy_on_v2s_seeds_pairs_with_v2s_counted_runs(heads, tmp_path):
    # the raw checkpoint run for the clip on v2's seeds (eval_cells --checkpoint: its header lists the inference defaults)
    raw = _eval(tmp_path / "look", "look_raw", RAW_CKPT, {5402: False, 5403: False, 5404: False}, traces=True,
                inference={"binarize_gripper": False, "gripper_deadband": None})
    out = tmp_path / "out"
    index = _build((raw, "look_raw"), heads[1], out, heads)
    assert index["caption"] == "Same 10 demos. Same scene. 0/3 vs 2/3."  # read from the headline logs
    assert index["label"] == "Illustrative replay"
    assert [p["seed"] for p in index["pairs"]] == [5403, 5404]  # 5402: v2 failed, so not picked
    assert "2 of 3 shared seeds" in index["pick"] and "cherry-pick" in index["pick"]
    p = index["pairs"][0]
    assert p["raw"]["standing"] == "illustrative" and p["v2"]["standing"] == "counted"
    assert p["raw"]["file"] == "runs/raw/5403.json" and p["v2"]["file"] == "runs/v2/5403.json"
    assert p["raw"]["success"] is False and p["v2"]["success"] is True
    a, b = (json.loads((out / p[s]["file"]).read_text()) for s in ("raw", "v2"))
    assert a["bin"] == b["bin"] and a["cube_pos"][0] == b["cube_pos"][0]  # the same scene
    assert not (out / "runs" / "raw" / "5402.json").exists()  # only the picked seeds are written
    sides = index["sides"]
    assert sides["raw"]["headline"] == {"successes": 0, "n": 3, "seeds": [5020, 5022]} and sides["raw"]["checkpoint"] == RAW_CKPT
    assert sides["v2"]["headline"] == {"successes": 2, "n": 3, "seeds": [5402, 5404]}
    assert json.loads((out / "index.json").read_text())["pairs"][1]["seed"] == 5404


def test_v2_on_the_raw_seeds_pairs_with_the_raw_policys_traced_rerun(heads, tmp_path):
    rerun = _eval(tmp_path / "trace_eval", "trace_raw_10", RAW_CKPT, {5020: False, 5021: False}, traces=True)
    v2 = _eval(tmp_path / "look", "look_v2", V2_CKPT, {5020: True, 5021: False}, traces=True, inference=V2_INF)
    index = _build((rerun, "trace_raw_10"), (v2, "look_v2"), tmp_path / "out", heads)
    assert [p["seed"] for p in index["pairs"]] == [5020]
    assert index["pairs"][0]["raw"]["standing"] == "rerun" and index["pairs"][0]["v2"]["standing"] == "illustrative"


def test_a_rerun_that_ended_differently_from_the_counted_run_stops_the_build(heads, tmp_path):
    # the counted run left the cube elsewhere: the re-run is not that run
    raw_head = _eval(tmp_path / "raw_head2", "raw_10", RAW_CKPT, {5020: False}, traces=False, final_cube={5020: [0.1, 0.1, 0.025]})
    rerun = _eval(tmp_path / "trace_eval", "trace_raw_10", RAW_CKPT, {5020: False}, traces=True)
    v2 = _eval(tmp_path / "look", "look_v2", V2_CKPT, {5020: True}, traces=True, inference=V2_INF)
    with pytest.raises(ValueError, match="re-run ended differently"):
        _build((rerun, "trace_raw_10"), (v2, "look_v2"), tmp_path / "out", ((raw_head, "raw_10"), heads[1]))


def test_seeds_asked_for_must_be_a_raw_failure_and_a_v2_success(heads, tmp_path):
    raw = _eval(tmp_path / "look", "look_raw", RAW_CKPT, {5402: False, 5403: False, 5404: False}, traces=True)
    with pytest.raises(ValueError, match=r"\[5402\]"):
        _build((raw, "look_raw"), heads[1], tmp_path / "out", heads, seeds=[5402])
    index = _build((raw, "look_raw"), heads[1], tmp_path / "out", heads, seeds=[5404, 5403])
    assert [p["seed"] for p in index["pairs"]] == [5404, 5403]  # the asked order
    assert "chosen by hand" in index["pick"]


@pytest.mark.parametrize("what", ["checkpoint", "inference", "pose"])
def test_traces_from_another_policy_or_start_stop_the_build(heads, tmp_path, what):
    kw = {"checkpoint": {"ckpt": V2_CKPT}, "inference": {"inference": {"gripper_deadband": 0.25}}, "pose": {"pose": [0.0] * 9}}[what]
    ckpt = kw.pop("ckpt", RAW_CKPT)
    raw = _eval(tmp_path / "look", "look_raw", ckpt, {5403: False}, traces=True, **kw)
    with pytest.raises(ValueError, match={"checkpoint": "headline from", "inference": "ran with", "pose": "same arm pose"}[what]):
        _build((raw, "look_raw"), heads[1], tmp_path / "out", heads)


def test_no_shared_seed_is_an_error_not_an_empty_clip(heads, tmp_path):
    raw = _eval(tmp_path / "look", "look_raw", RAW_CKPT, {5020: False}, traces=True)
    with pytest.raises(ValueError, match="no seed"):
        _build((raw, "look_raw"), heads[1], tmp_path / "out", heads)


@pytest.mark.skipif(not all((r / f"{c}.json").is_file() for r, c in (blc.RAW_HEADLINE, blc.V2_HEADLINE)),
                    reason="the headline evals are only on the lead's machine")
def test_the_real_headlines_are_0_of_40_and_30_of_40():
    raw, v2 = blc.headline(*blc.RAW_HEADLINE), blc.headline(*blc.V2_HEADLINE)
    assert (raw["successes"], raw["n"], raw["seeds"]) == (0, 40, [5020, 5059])
    assert (v2["successes"], v2["n"], v2["seeds"]) == (30, 40, [5400, 5439])
    assert raw["header"]["reset_pose"] == v2["header"]["reset_pose"]  # both started from the raw demos' mean pose
