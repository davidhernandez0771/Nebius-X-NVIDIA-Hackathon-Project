"""sim_eval.correction_round: the practice-and-correct round as resumable phases, with a fake runner standing in for
Isaac and LeRobot (it writes what each GPU command would)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

from sim_eval.correction_round import RoundConfig, practice_cmd, plan_round
from sim_eval.overnight import PhaseFailed, run_phases
from sim_eval.scenes import eval_scenes
from sim_worker.corrections import RetakeQueue

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests"))
from test_corrections import AT_CUBE, CUBE, HOME, closes_at, path, trace  # noqa: E402


def cfg(tmp_path: Path, **over) -> RoundConfig:
    repo = tmp_path / "repo"
    data = repo / "data"
    ckpt = data / "experiments" / "hx" / "train" / "perfected_multiply_10" / "checkpoints" / "030000" / "pretrained_model"
    ckpt.mkdir(parents=True)
    grid = data / "human_exp" / "m" / "grid.json"
    grid.parent.mkdir(parents=True)
    grid.write_text(json.dumps({"name": "m", "cells": [
        {"condition": "raw", "n_human": 10, "label": "raw_10", "episode_dirs": ["r/a"]},
        {"condition": "perfected_multiply", "n_human": 10, "label": "perfected_multiply_10", "episode_dirs": ["p/a", "p/b"]},
    ]}), encoding="utf-8")
    start = data / "experiments" / "hx" / "datasets" / "raw_10"
    start.mkdir(parents=True)
    (start / "start_state.json").write_text("{}", encoding="utf-8")
    for exe in ("isaac.exe", "lerobot.exe"):
        (tmp_path / exe).write_text("", encoding="utf-8")
    c = RoundConfig(repo=repo, run_id="corr_test", isaac_py=tmp_path / "isaac.exe", lerobot_py=tmp_path / "lerobot.exe",
                    checkpoint=ckpt, source_cell="perfected_multiply_10", base_grid=grid, start_state=start,
                    practice_seed0=5200, practice_n=3, min_corrections=1, min_free_gb=0.0)
    return c.with_(**over) if over else c


def failing_trace(seed: int) -> dict:
    """A rollout that closes on nothing over the cube of that seed's scene, after a still hold."""
    cube = np.array(eval_scenes(1, seed)[0].cube_pose.pos)
    shift = cube - CUBE
    tcp = path((HOME, AT_CUBE + [0, 0, 0.15], 60), (AT_CUBE + [0, 0, 0.15], AT_CUBE, 40), (AT_CUBE, AT_CUBE, 150)) + shift
    t = trace(tcp, grip=closes_at(len(tcp), 200))
    t["cube_pos"] = np.tile(cube, (len(tcp), 1))
    return t


class FakeRunner:
    """Writes what each GPU command would: traced practice results, a replay manifest."""

    def __init__(self, c: RoundConfig, verified=True):
        self.c, self.cmds, self.verified = c, [], verified

    def __call__(self, cmd, env, log_file):
        self.cmds.append((cmd, env))
        if "eval_cells.py" in cmd[1]:
            seed0, n = int(cmd[cmd.index("--seed0") + 1]), int(cmd[cmd.index("--n") + 1])
            self.c.traces_dir.mkdir(parents=True, exist_ok=True)
            for s in range(seed0, seed0 + n):
                np.savez(self.c.traces_dir / f"seed_{s}.npz", **failing_trace(s))
            self.c.practice_results.write_text(json.dumps({"episodes": [
                {"seed": s, "success": False, "reasons": ["not_in_bin"], "ended_by": "time_limit"}
                for s in range(seed0, seed0 + n)]}), encoding="utf-8")
        elif "recovery_dataset.py" in cmd[1]:
            states = json.loads(Path(cmd[cmd.index("--states") + 1]).read_text(encoding="utf-8"))["states"]
            rows = [{"name": s["name"], "seed": s["seed"], "mode": s["mode"], "success": self.verified, "reasons": [],
                     "ep_dir": str(Path(env["DATA_DIR"]) / "episodes" / s["name"])} for s in states]
            Path(cmd[cmd.index("--manifest") + 1]).write_text(json.dumps({"rows": rows, "verified_dirs": [
                r["ep_dir"] for r in rows if r["success"]]}), encoding="utf-8")
        return 0


def run(c: RoundConfig, runner: FakeRunner):
    run_phases(plan_round(c, log=lambda m: None, runner=runner), log=lambda m: None)


def test_the_round_runs_practice_candidates_corrections_provenance_grid(tmp_path):
    c = cfg(tmp_path)
    runner = FakeRunner(c)
    run(c, runner)
    practice, replay = runner.cmds[0][0], runner.cmds[1][0]
    assert "--trace" in practice and f"practice_perfected_multiply_10={c.checkpoint}" in practice
    assert practice[practice.index("--seed0") + 1] == "5200" and practice[practice.index("--n") + 1] == "3"
    assert "recovery_dataset.py" in replay[1] and runner.cmds[1][1]["DATA_DIR"] == str(c.round_data)
    cands = json.loads(c.candidates_file.read_text(encoding="utf-8"))
    assert [x["moment"]["kind"] for x in cands["candidates"]] == ["failed_grasp"] * 3
    prov = json.loads(c.provenance_file.read_text(encoding="utf-8"))
    assert len(prov["corrections"]) == 3 and prov["corrections"][0]["rewind"]["back_s"] == 1.0
    assert prov["checkpoint"] == str(c.checkpoint) and prov["practice_seeds"] == [5200, 5202]
    grid = json.loads(c.grid_file.read_text(encoding="utf-8"))
    (cell,) = grid["cells"]
    assert cell["label"] == "corrections_3" and cell["condition"] == "perfected_multiply"
    assert cell["episode_dirs"][:2] == ["p/a", "p/b"] and len(cell["episode_dirs"]) == 5


def test_both_retakes_also_queue_every_candidate_for_a_human(tmp_path):
    c = cfg(tmp_path, retake="both")
    run(c, FakeRunner(c))
    items = RetakeQueue(c.data).list()
    assert [i.seed for i in items] == [5200, 5201, 5202] and all(i.status == "open" for i in items)
    assert items[0].checkpoint == str(c.checkpoint) and items[0].round_id == "corr_test"


def test_human_only_queues_and_replays_nothing(tmp_path):
    c = cfg(tmp_path, retake="human")
    runner = FakeRunner(c)
    run(c, runner)
    assert [Path(cmd[1]).name for cmd, _ in runner.cmds] == ["eval_cells.py"]
    assert len(RetakeQueue(c.data).list()) == 3 and not c.grid_file.exists()


def test_a_finished_round_is_skipped_on_a_rerun(tmp_path):
    c = cfg(tmp_path)
    run(c, FakeRunner(c))
    again = FakeRunner(c)
    run(c, again)
    assert again.cmds == []


def test_too_few_verified_corrections_stop_the_round_before_the_grid(tmp_path):
    c = cfg(tmp_path, min_corrections=5)
    with pytest.raises(ValueError, match="only 3 verified"):
        run(c, FakeRunner(c))


def test_practice_never_touches_the_test_seeds(tmp_path):
    c = cfg(tmp_path)
    with pytest.raises(ValueError, match="practice seeds"):
        practice_cmd(c.with_(practice_seed0=5020))
    with pytest.raises(ValueError, match="practice seeds"):
        practice_cmd(c.with_(practice_seed0=5270, practice_n=20))


def test_preflight_names_whats_missing(tmp_path):
    c = cfg(tmp_path)
    c = c.with_(checkpoint=tmp_path / "nope")
    with pytest.raises(PhaseFailed, match="missing .*nope"):
        run(c, FakeRunner(c))
