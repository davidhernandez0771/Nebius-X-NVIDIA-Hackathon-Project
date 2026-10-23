"""sim_eval.bigtest: the 2026-10-23 big test's chain (T7's prereg). GPU commands are faked (FakeRunner writes what
each would); T3's held-human marker, the reused teacher round and the teacher checkpoint are tmp files."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from sim_eval.bigtest import BigTest, copy_teacher, final_choice, human_choice, plan, stage_config, wilson
from sim_eval.bigtest import test_cmd as bigtest_cmd  # not collected as a test
from sim_eval.overnight import PhaseFailed, run_phases
from sim_eval.tests.test_distill_round import FakeRunner, make_episode, write_scene


def _human_grid(root: Path, name: str, n_steps: int = 30) -> Path:
    eps = root / "eps"
    for i in range(2):
        write_scene(make_episode(eps, f"h{i}", [f"h{i}"], n_steps=n_steps), 0)
        write_scene(make_episode(eps, f"h{i}_v0", [f"h{i}", f"h{i}_v0"], n_steps=n_steps), 3100 + i)
    grid = root / "grid.json"
    grid.write_text(json.dumps({"name": "m", "cells": [
        {"condition": "perfected_multiply", "n_human": 2, "label": name,
         "episode_dirs": ["eps/h0", "eps/h1", "eps/h0_v0", "eps/h1_v0"]}]}), encoding="utf-8")
    return grid


def make_bigtest(tmp_path: Path, kept: int | None = 100, teacher_eps: int = 3) -> BigTest:
    repo = tmp_path / "repo"
    (repo / "data").mkdir(parents=True)
    ckpt = tmp_path / "t3" / "policy.pt"
    ckpt.parent.mkdir(parents=True)
    ckpt.write_bytes(b"teacher weights")
    src = tmp_path / "t6" / "r0"
    for s in range(4300, 4300 + teacher_eps):
        ep = write_scene(make_episode(src / "episodes", f"teacher_r0_{s}", ["teacher-rl", f"teacher_r0_{s}"],
                                      n_steps=50), s)
        (ep / "images").mkdir()
        (ep / "images" / "f0.png").write_bytes(b"png" * s)
    (src / "rollouts.jsonl").write_text("{}\n", encoding="utf-8")
    (src / "rollouts_done.json").write_text(json.dumps({
        "kind": "teacher", "round": 0, "seeds": [4300, 4300 + teacher_eps - 1], "attempted": teacher_eps,
        "successes": teacher_eps, "episodes": teacher_eps, "frames": 50 * teacher_eps, "teacher_execution": "held",
        "teacher_checkpoint": str(ckpt), "code": {"commit": "95663cb"}}), encoding="utf-8")
    start = tmp_path / "start"
    start.mkdir()
    (start / "start_state.json").write_text("{}", encoding="utf-8")
    held = tmp_path / "t3hh" / "held"
    if kept is not None:
        _human_grid(held, "held_human_10")
        (held / "held_human_done.json").write_text(json.dumps(
            {"kept": kept, "attempted": 110, "frames": 30000, "k": 2, "failures": {}}), encoding="utf-8")
    for exe in ("isaac.exe", "lerobot.exe"):
        (tmp_path / exe).write_text("", encoding="utf-8")
    return BigTest(repo=repo, isaac_py=tmp_path / "isaac.exe", lerobot_py=tmp_path / "lerobot.exe",
                   teacher_checkpoint=ckpt, teacher_sha256=hashlib.sha256(b"teacher weights").hexdigest().upper(),
                   teacher_source=src, teacher_seeds=(4300, 4300 + teacher_eps - 1), teacher_episodes=teacher_eps,
                   start_state=start, original_human=(_human_grid(tmp_path / "orig", "perfected_multiply_10"),
                                                      "perfected_multiply_10"),
                   held_human_dir=held, min_teacher=1, steps=300, save_freq=100, candidates=(100, 200, 300),
                   select_a=(5500, 3), select_b=(5529, 3), dagger=(5210, 2), test=(5400, 4))


class Runner(FakeRunner):
    """FakeRunner + the test's eval and the selection counts per candidate (practice: {step: successes})."""

    def __init__(self, data, practice_by_step, test_successes=2, **kw):
        super().__init__(data, **kw)
        self.by_step, self.test_successes = practice_by_step, test_successes

    def __call__(self, cmd, env, log_file):
        if cmd[1].endswith("eval_cells.py"):
            self.cmds.append((cmd, env))
            run_id, spec = cmd[cmd.index("--run-id") + 1], cmd[cmd.index("--checkpoint") + 1]
            seed0, n = int(cmd[cmd.index("--seed0") + 1]), int(cmd[cmd.index("--n") + 1])
            cell, ckpt = spec.split("=", 1)
            k = self.test_successes if cell == "bigtest_final" else self.by_step(run_id, int(cell.rsplit("_s", 1)[1]))
            out = self.data / "evals" / run_id / f"{cell}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps({"episodes": [
                {"seed": s, "success": i < k, "reasons": [], "ended_by": "success" if i < k else "time_limit"}
                for i, s in enumerate(range(seed0, seed0 + n))]}), encoding="utf-8")
            out.with_suffix(".episodes.jsonl").write_text(json.dumps({"header": {"checkpoint": ckpt}}) + "\n",
                                                          encoding="utf-8")
            return 0
        return super().__call__(cmd, env, log_file)


def _go(bt: BigTest, runner, **kw):
    lines = []
    run_phases(plan(bt, lines.append, runner=runner, gpu_sampler=None, **kw), lines.append)
    return lines


def test_the_whole_chain_runs_in_order_and_records_every_decision(tmp_path):
    bt = make_bigtest(tmp_path)
    counts = {("bigtest_r0_t3", 100): 1, ("bigtest_r0_t3", 200): 2, ("bigtest_r0_t3", 300): 2,
              ("bigtest_r1", 100): 3, ("bigtest_r1", 200): 1, ("bigtest_r1", 300): 2}
    runner = Runner(bt.repo / "data", lambda run_id, step: counts[(run_id, step)], execution="held",
                    student_success=1)
    lines = _go(bt, runner)
    names = [Path(c[1]).name if not c[1].startswith("-m") else c[2] for c, _ in runner.cmds]
    assert names == ["lerobot_tools.experiments", *["eval_cells.py"] * 3,  # A: the teacher rollouts are reused
                     "distill_rollouts.py", "lerobot_tools.experiments", *["eval_cells.py"] * 3,  # B
                     "eval_cells.py"]  # the test
    # A: held human set, 180k-style candidates, its own selection block, the deadband on every student action
    a = json.loads((bt.dir / "r0" / "selection_t3.json").read_text(encoding="utf-8"))
    assert a["chosen_step"] == 300 and a["seeds"] == [5500, 5502]  # a tie goes to the later checkpoint
    assert a["inference_args"] == ["--gripper-deadband", "0.25"]
    rnd0 = json.loads((bt.dir / "r0" / "round_t3.json").read_text(encoding="utf-8"))
    assert rnd0["human"]["cell"] == "held_human_10" and rnd0["teacher_execution"] == "held"
    assert rnd0["rollouts_code"] == {"commit": "95663cb"}  # the reused rollouts name the code that made them
    # B: DAgger from A's best on 5210-5211, no stop rule, its own block
    dag = runner.cmds[4][0]
    assert dag[dag.index("--seed0") + 1] == "5210" and dag[dag.index("--checkpoint") + 1] == a["checkpoint"]
    assert dag[-2:] == ["--gripper-deadband", "0.25"]
    b = json.loads((bt.dir / "r1" / "selection.json").read_text(encoding="utf-8"))
    assert b["chosen_step"] == 100 and b["seeds"] == [5529, 5531]
    assert json.loads((bt.dir / "r1" / "decision.json").read_text(encoding="utf-8"))["stop_rule"] is False
    # the final model: B 3/3 beats A 2/3; the test on 5400-5403 with the deadband and traces
    choice = json.loads((bt.dir / "final_choice.json").read_text(encoding="utf-8"))
    assert choice["stage"] == "B" and choice["checkpoint"] == b["checkpoint"]
    t = runner.cmds[-1][0]
    assert t[t.index("--seed0") + 1] == "5400" and t[t.index("--n") + 1] == "4"
    assert t[t.index("--checkpoint") + 1] == f"bigtest_final={b['checkpoint']}"
    assert "--gripper-deadband" in t and "--trace" in t
    res = json.loads((bt.dir / "test_result.json").read_text(encoding="utf-8"))
    assert res["successes"] == 2 and res["n"] == 4 and res["seeds"] == [5400, 5403]
    assert any("RESULT 2/4" in ln for ln in lines)
    # a restart runs nothing
    again = Runner(bt.repo / "data", lambda *a: 0)
    _go(bt, again)
    assert again.cmds == []


def test_teacher_copy_is_verified_and_refuses_another_teacher_set(tmp_path):
    bt = make_bigtest(tmp_path)
    info = copy_teacher(bt, log=lambda m: None)
    src_files = [f for f in (bt.teacher_source / "episodes").rglob("*") if f.is_file()]
    assert info["episodes"] == 3 and info["files"] == len(src_files) and info["bytes"] == sum(f.stat().st_size for f in src_files)
    eps = sorted(p.name for p in (bt.dir / "r0" / "episodes").iterdir())
    assert eps == ["teacher_r0_4300", "teacher_r0_4301", "teacher_r0_4302"]
    assert (bt.dir / "r0" / "rollouts_done.json").read_text() == (bt.teacher_source / "rollouts_done.json").read_text()
    assert copy_teacher(bt) == info  # done once
    other = make_bigtest(tmp_path / "o")
    done = json.loads((other.teacher_source / "rollouts_done.json").read_text(encoding="utf-8"))
    done["teacher_execution"] = "tracking"
    (other.teacher_source / "rollouts_done.json").write_text(json.dumps(done), encoding="utf-8")
    with pytest.raises(PhaseFailed, match="pre-registered teacher set"):
        copy_teacher(other)


def test_the_held_human_floor(tmp_path):
    held = human_choice(make_bigtest(tmp_path / "a", kept=80))
    assert held["held"] is True and held["cell"] == "held_human_10" and held["kept"] == 80
    low = make_bigtest(tmp_path / "b", kept=79)
    orig = human_choice(low)
    assert orig["held"] is False and orig["cell"] == "perfected_multiply_10" and "ORIGINAL" in orig["reason"]
    (low.held_human_dir / "held_human_done.json").write_text(json.dumps({"kept": 110, "attempted": 110}))
    assert human_choice(low) == orig  # decided once
    with pytest.raises(PhaseFailed, match="no done marker"):
        human_choice(make_bigtest(tmp_path / "c", kept=None))


def test_the_chain_waits_for_t3_and_checks_the_teacher_checkpoint(tmp_path):
    bt = make_bigtest(tmp_path, kept=None)
    with pytest.raises(PhaseFailed, match="no done marker"):
        _go(bt, Runner(bt.repo / "data", lambda *a: 0))
    bad = make_bigtest(tmp_path / "x").with_(teacher_sha256="00" * 32)
    with pytest.raises(PhaseFailed, match="sha256"):
        _go(bad, Runner(bad.repo / "data", lambda *a: 0))
    assert not (bad.dir / "r0" / "teacher_copy.json").exists()


def test_stage_configs_are_the_preregistered_ones(tmp_path):
    bt = BigTest(repo=tmp_path)
    human = {"grid": str(tmp_path / "g.json"), "cell": "held_human_10"}
    a, b = stage_config(bt, "A", human), stage_config(bt, "B", human)
    assert (a.round_id, a.teacher_seed0, a.teacher_n, a.teacher_execution) == (0, 4300, 600, "held")
    assert (a.steps, a.save_freq, a.candidates) == (180_000, 10_000, (60_000, 120_000, 180_000))
    assert (a.select_seed0, a.select_n, b.select_seed0, b.select_n) == (5500, 29, 5529, 29)
    assert (b.round_id, b.dagger_seed0, b.dagger_n, b.beta, b.stop_rule) == (1, 5210, 40, 0.0, False)
    assert a.inference_args == b.inference_args == ("--gripper-deadband", "0.25")
    assert a.weights == b.weights == {"human": 0.25, "teacher": 0.5, "dagger": 0.25}
    assert bt.teacher_sha256.startswith("811382A3") and bt.teacher_sha256.endswith("AA2")
    with pytest.raises(ValueError):
        bigtest_cmd(bt.with_(test=(5020, 40)), "ck")  # only 5400-5439
    cmd = bigtest_cmd(bt, "ck")
    assert cmd[cmd.index("--seed0") + 1] == "5400"


def test_final_choice_a_tie_goes_to_b_and_is_decided_once(tmp_path):
    bt = make_bigtest(tmp_path)
    human = {"grid": str(bt.original_human[0]), "cell": "perfected_multiply_10"}
    a, b = stage_config(bt, "A", human), stage_config(bt, "B", human)
    for c, k, step in ((a, 2, 300), (b, 2, 200)):
        c.selection_file.parent.mkdir(parents=True, exist_ok=True)
        c.selection_file.write_text(json.dumps({"counts": {str(step): [k, 3]}, "chosen_step": step,
                                                "checkpoint": f"ck_{c.round_id}", "seeds": [0, 2]}))
    assert final_choice(bt, a, b)["stage"] == "B"
    b.selection_file.write_text(json.dumps({"counts": {"200": [0, 3]}, "chosen_step": 200, "checkpoint": "x",
                                            "seeds": [0, 2]}))
    assert final_choice(bt, a, b)["stage"] == "B"  # already decided


def test_the_test_runs_once(tmp_path):
    """A results log made with another checkpoint stops the test (overnight.guard_final)."""
    bt = make_bigtest(tmp_path)
    runner = Runner(bt.repo / "data", lambda run_id, step: 1, execution="held", student_success=1)
    _go(bt, runner, stop_after="B")
    log = bt.test_results.with_suffix(".episodes.jsonl")
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(json.dumps({"header": {"checkpoint": "some_other_checkpoint"}}) + "\n", encoding="utf-8")
    with pytest.raises(PhaseFailed, match="runs once"):
        _go(bt, runner)


def test_wilson():
    assert wilson(15, 40) == (0.242, 0.53)


def test_the_human_set_is_never_implicit(tmp_path):
    """T7 (2026-10-23): run 1's folder must not be read by default; the rerun lands in another folder. Without
    --held-human-dir or --human-grid/--human-cell the chain refuses to decide."""
    bt = make_bigtest(tmp_path).with_(held_human_dir=None)
    assert BigTest(repo=tmp_path).held_human_dir is None and BigTest(repo=tmp_path).human_override is None
    with pytest.raises(PhaseFailed, match="--held-human-dir or --human-grid"):
        human_choice(bt)
    assert not (bt.dir / "human_choice.json").exists()


def test_the_held_dir_given_is_judged_and_recorded(tmp_path):
    bt = make_bigtest(tmp_path, kept=95)
    choice = human_choice(bt)
    assert choice["held"] is True and choice["held_human_dir"] == str(bt.held_human_dir)
    assert choice["decided_by"].startswith("--held-human-dir")


def test_an_explicit_human_set_wins_and_is_recorded(tmp_path):
    """The lead's go names the exact grid and cell (run 1, the settle rerun, or the original 110)."""
    bt = make_bigtest(tmp_path, kept=40)
    grid, cell = bt.original_human
    choice = human_choice(bt.with_(human_override=(grid, cell)))
    assert choice["grid"] == str(grid) and choice["cell"] == cell and choice["held"] is False
    assert choice["decided_by"].startswith("--human-grid/--human-cell")
    held = make_bigtest(tmp_path / "h", kept=40)
    c2 = human_choice(held.with_(human_override=(held.held_human_dir / "grid.json", "held_human_10")))
    assert c2["held"] is True and c2["kept"] == 40 and c2["attempted"] == 110  # the counts of the folder named
    with pytest.raises(PhaseFailed, match="no cell"):
        human_choice(make_bigtest(tmp_path / "x").with_(human_override=(grid, "no_such_cell")))


def test_a_recorded_choice_refuses_a_different_one(tmp_path):
    bt = make_bigtest(tmp_path, kept=100)
    first = human_choice(bt)
    assert human_choice(bt) == first
    with pytest.raises(PhaseFailed, match="already decided"):
        human_choice(bt.with_(human_override=bt.original_human))
