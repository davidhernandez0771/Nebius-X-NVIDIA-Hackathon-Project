"""Pure sim_eval parts: test-scene seeding, results aggregation, registry update. No Isaac imports."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sim_eval.registry import update_registry
from sim_eval.results import EpisodeResult, aggregate
from sim_eval.scenes import EVAL_SEED_MIN, eval_scenes


# --- scene seeding -------------------------------------------------------------------------------------------------

def test_fifty_scenes_with_their_own_seeds():
    scenes = eval_scenes(50)
    assert [s.seed for s in scenes] == list(range(5000, 5050))
    assert all(s.robot == "franka" for s in scenes)
    assert len({s.cube_pose.pos for s in scenes}) == 50


def test_scenes_are_deterministic_and_prefix_stable():
    # Scene i depends only on its seed, so --n 3 tests the same first 3 scenes as --n 50.
    assert eval_scenes(3) == eval_scenes(50)[:3]
    assert eval_scenes(5, seed0=5100) == eval_scenes(5, seed0=5100)
    assert eval_scenes(1, seed0=5001)[0] == eval_scenes(2)[1]


def test_training_seeds_are_refused():
    assert EVAL_SEED_MIN == 5000
    with pytest.raises(ValueError, match="5000"):
        eval_scenes(10, seed0=4995)
    with pytest.raises(ValueError):
        eval_scenes(0)


# --- aggregation ---------------------------------------------------------------------------------------------------

def _ep(seed, success, reasons=(), ended_by=None, wall=2.0, steps=100):
    return EpisodeResult(seed=seed, success=success, reasons=list(reasons),
                         ended_by=ended_by or ("success" if success else "time_limit"),
                         steps=steps, sim_s=steps / 50, wall_s=wall)


def test_aggregate_counts_successes_and_reasons():
    eps = [
        _ep(5000, True),
        _ep(5001, False, ["not_in_bin", "gripper_closed"]),
        _ep(5002, False, ["not_in_bin"]),
        _ep(5003, False, ["policy_error"], ended_by="policy_error", wall=0.1, steps=3),
    ]
    s = aggregate(eps)
    assert (s.n, s.successes) == (4, 1)
    assert s.success_rate == pytest.approx(0.25)
    assert s.reasons == {"not_in_bin": 2, "gripper_closed": 1, "policy_error": 1}
    assert s.ended_by == {"success": 1, "time_limit": 2, "policy_error": 1}
    assert s.mean_wall_s == pytest.approx((2 + 2 + 2 + 0.1) / 4)
    assert s.seeds == [5000, 5001, 5002, 5003]


def test_a_failed_episode_must_say_why():
    with pytest.raises(ValueError):
        EpisodeResult(seed=1, success=False, reasons=[], ended_by="time_limit", steps=10, sim_s=0.2, wall_s=1.0)
    with pytest.raises(ValueError):
        EpisodeResult(seed=1, success=True, reasons=["not_in_bin"], ended_by="success", steps=10, sim_s=0.2,
                      wall_s=1.0)


def test_aggregate_of_nothing_is_an_error():
    with pytest.raises(ValueError):
        aggregate([])


# --- registry update -----------------------------------------------------------------------------------------------

def _row(name, checkpoint, status="ok", run_id="g_1"):
    return {"run_id": run_id, "grid": "g", "cell": {"condition": name.rsplit("_", 1)[0], "n_human": 5,
            "name": name}, "checkpoint": checkpoint, "status": status, "eval_success": None}


def _write(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def _read(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


@pytest.fixture
def summary():
    return aggregate([_ep(5000, True), _ep(5001, False, ["not_in_bin"]), _ep(5002, True), _ep(5003, True)])


def test_eval_success_is_written_into_the_matching_cell_row(tmp_path, summary):
    reg = tmp_path / "results" / "registry.jsonl"
    ck_a, ck_b = str(tmp_path / "a" / "pretrained_model"), str(tmp_path / "b" / "pretrained_model")
    _write(reg, [_row("raw_5", ck_a), _row("raw_multiply_5", ck_b)])
    n = update_registry(reg, "raw_multiply_5", summary, seed0=5000, results_file="evals/x.json")
    assert n == 1
    rows = _read(reg)
    assert rows[0]["eval_success"] is None  # other cells untouched
    assert rows[1]["eval_success"] == pytest.approx(0.75)
    ev = rows[1]["eval"]
    assert (ev["n"], ev["successes"], ev["seed0"]) == (4, 3, 5000)
    assert ev["reasons"] == {"not_in_bin": 1} and ev["results_file"] == "evals/x.json"


def test_checkpoint_disambiguates_reruns_of_a_cell(tmp_path, summary):
    reg = tmp_path / "registry.jsonl"
    old, new = tmp_path / "run1" / "pretrained_model", tmp_path / "run2" / "pretrained_model"
    _write(reg, [_row("raw_5", str(old), run_id="g_1"), _row("raw_5", str(new), run_id="g_2")])
    with pytest.raises(ValueError, match="2 rows"):
        update_registry(reg, "raw_5", summary, seed0=5000)
    # The server may report the same checkpoint spelled differently; paths are compared once resolved.
    spelled_differently = f"{new}/../pretrained_model".replace("\\", "/")
    assert update_registry(reg, "raw_5", summary, seed0=5000, checkpoint=spelled_differently) == 1
    assert [r["eval_success"] for r in _read(reg)] == [None, pytest.approx(0.75)]


def test_failed_training_rows_and_unknown_cells_are_not_matched(tmp_path, summary):
    reg = tmp_path / "registry.jsonl"
    _write(reg, [_row("raw_5", None, status="failed")])
    with pytest.raises(LookupError, match="raw_5"):
        update_registry(reg, "raw_5", summary, seed0=5000)
    with pytest.raises(LookupError):
        update_registry(reg, "nope_1", summary, seed0=5000)
    with pytest.raises(FileNotFoundError):
        update_registry(tmp_path / "missing.jsonl", "raw_5", summary, seed0=5000)


def test_registry_rewrite_keeps_every_other_line_byte_for_byte(tmp_path, summary):
    reg = tmp_path / "registry.jsonl"
    rows = [_row("raw_5", str(tmp_path / "a")), _row("raw_10", str(tmp_path / "b"))]
    _write(reg, rows)
    before = reg.read_text(encoding="utf-8").splitlines()
    update_registry(reg, "raw_10", summary, seed0=5000)
    after = reg.read_text(encoding="utf-8").splitlines()
    assert after[0] == before[0] and after[1] != before[1]
    assert not list(tmp_path.glob("*.tmp"))
