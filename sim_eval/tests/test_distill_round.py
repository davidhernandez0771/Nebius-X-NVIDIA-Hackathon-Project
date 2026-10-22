"""sim_eval.distill_round: source mixing with weights, the DAgger stop rule, and the rounds as resumable phases, with
a fake runner standing in for Isaac and LeRobot (it writes what each GPU command would)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from lerobot_tools.assemble import Cell, build_manifest
from lerobot_tools.tests.test_assemble import make_episode
from sim_eval.distill_round import (
    RoundConfig, dagger_cmd, mix_cell, mix_repeats, plan_round, select_cmd, stop_decision, teacher_cmd,
)
from sim_eval.overnight import PhaseFailed, run_phases


# --- mixing ------------------------------------------------------------------------------------------------------------

def test_mix_repeats_hits_the_frame_shares():
    reps, shares = mix_repeats({"human": 1000, "teacher": 4000}, {"human": 1.0, "teacher": 1.0})
    assert reps == {"human": 4, "teacher": 1}
    assert shares == {"human": 0.5, "teacher": 0.5}
    reps, shares = mix_repeats({"human": 1000, "teacher": 4000, "dagger": 2000},
                               {"human": 0.25, "teacher": 0.5, "dagger": 0.25})
    assert reps == {"human": 2, "teacher": 1, "dagger": 1}
    assert shares == {"human": round(2000 / 8000, 4), "teacher": 0.5, "dagger": 0.25}


def test_mix_repeats_caps_and_drops_zero_weights():
    reps, _ = mix_repeats({"human": 10, "teacher": 100000}, {"human": 1.0, "teacher": 1.0}, max_repeat=8)
    assert reps["human"] == 8
    reps, shares = mix_repeats({"human": 10, "teacher": 1000}, {"human": 1.0, "teacher": 0.0})
    assert reps == {"human": 1, "teacher": 0} and shares == {"human": 1.0, "teacher": 0.0}
    with pytest.raises(ValueError):
        mix_repeats({"human": 10}, {"human": 0.0})
    with pytest.raises(ValueError):
        mix_repeats({"human": 10}, {"human": -1.0})
    with pytest.raises(ValueError):
        mix_repeats({"human": 0, "teacher": 10}, {"human": 1.0, "teacher": 1.0})  # a weighted source with no frames


def test_mix_repeats_are_fractional_so_the_shares_are_the_weights():
    """Round 0 has no DAgger source: human 0.25 / teacher 0.5 become 1/3 : 2/3 of the frames. Whole-number repeats
    gave 41/59 at 300 teacher rollouts; fractional ones give the weights."""
    reps, shares = mix_repeats({"human": 31536, "teacher": 44700}, {"human": 0.25, "teacher": 0.5, "dagger": 0.25})
    assert reps["human"] == 1.0 and reps["teacher"] == pytest.approx(63072 / 44700)
    assert shares == {"human": pytest.approx(1 / 3, abs=1e-4), "teacher": pytest.approx(2 / 3, abs=1e-4)}


def test_mix_cell_realises_a_fractional_repeat_with_evenly_spaced_extra_copies(tmp_path):
    h = [make_episode(tmp_path / "h", f"h{i}", [f"h{i}"], n_steps=10) for i in range(4)]
    t = [make_episode(tmp_path / "t", f"teacher_r0_{4000 + i}", ["teacher-rl", f"teacher_r0_{4000 + i}"], n_steps=10)
         for i in range(5)]
    cell, report = mix_cell({"human": h, "teacher": t}, {"human": 0.25, "teacher": 0.5}, label="x", n_human=4)
    dirs = [Path(d) for d in cell["episode_dirs"]]
    assert [dirs.count(e) for e in h] == [1, 1, 1, 1]
    assert [dirs.count(e) for e in t] == [2, 1, 2, 1, 2]  # 1.6 copies: one each + 3 of 5 again, spread out
    assert report["teacher"] == {"episodes": 5, "frames": 50, "weight": 0.5, "repeat": 1.6, "copies": 8,
                                 "target": pytest.approx(2 / 3, abs=1e-4), "share": pytest.approx(2 / 3, abs=1e-4)}
    assert report["human"]["share"] == pytest.approx(1 / 3, abs=1e-4)


def test_mix_cell_shares_land_on_the_weights_with_uneven_episode_lengths(tmp_path):
    """The mouse cell's real shape: 110 human episodes of varying length, ~300 teacher ones of 149 frames."""
    rng = np.random.default_rng(0)
    h = [make_episode(tmp_path / "h", f"h{i}", [f"h{i}"], n_steps=int(rng.integers(150, 450))) for i in range(110)]
    t = [make_episode(tmp_path / "t", f"teacher_r0_{4000 + i}", ["teacher-rl", f"teacher_r0_{4000 + i}"],
                      n_steps=149) for i in range(287)]
    _, report = mix_cell({"human": h, "teacher": t}, {"human": 0.25, "teacher": 0.5, "dagger": 0.25}, label="x",
                         n_human=10)
    assert abs(report["human"]["share"] - 1 / 3) < 0.005 and abs(report["teacher"]["share"] - 2 / 3) < 0.005


def sources(tmp_path):
    h = [make_episode(tmp_path / "h", f"h{i}", [f"h{i}"], n_steps=10) for i in range(2)]
    t = [make_episode(tmp_path / "t", f"teacher_r0_{4000 + i}", ["teacher-rl", f"teacher_r0_{4000 + i}"], n_steps=40)
         for i in range(2)]
    d = [make_episode(tmp_path / "d", f"dagger_r1_5200_{i}", ["dagger-r1-rl", f"dagger_r1_5200_{i}"], n_steps=20)
         for i in range(2)]
    return {"human": h, "teacher": t, "dagger": d}


def test_mix_cell_repeats_episodes_and_reports_provenance(tmp_path):
    src = sources(tmp_path)
    cell, report = mix_cell(src, {"human": 0.25, "teacher": 0.5, "dagger": 0.25}, label="distill_r1", n_human=2)
    assert cell["condition"] == "distill" and cell["label"] == "distill_r1" and cell["n_human"] == 2
    dirs = [Path(d) for d in cell["episode_dirs"]]
    assert dirs.count(src["human"][0]) == 2 and dirs.count(src["teacher"][0]) == 1 and dirs.count(src["dagger"][1]) == 1
    assert report["human"] == {"episodes": 2, "frames": 20, "weight": 0.25, "repeat": 2, "copies": 4, "target": 0.25,
                               "share": 0.25}
    assert report["teacher"]["share"] == 0.5
    m = build_manifest(Cell.model_validate(cell))
    assert m["human_roots"] == ["h0", "h1"]
    assert m["sources"] == {"human": {"episodes": 4, "frames": 40}, "teacher": {"episodes": 2, "frames": 80},
                            "dagger": {"episodes": 2, "frames": 40}}


def test_mix_cell_checks_sources(tmp_path):
    src = sources(tmp_path)
    with pytest.raises(ValueError, match="human"):
        mix_cell({"teacher": src["teacher"]}, {"teacher": 1.0}, label="x", n_human=1)
    with pytest.raises(ValueError, match="unknown"):
        mix_cell({**src, "nemo": src["human"]}, {"human": 1.0}, label="x", n_human=2)
    with pytest.raises(ValueError, match="teacher"):  # a human-labelled source holding teacher episodes
        mix_cell({"human": src["teacher"] + src["human"]}, {"human": 1.0}, label="x", n_human=2)


# --- the stop rule -----------------------------------------------------------------------------------------------------

def rnd(r, k, n=40, frames=40000):
    return {"round": r, "rollouts": {"successes": k, "n": n}, "new_frames": frames}


def test_stop_rule():
    assert stop_decision([rnd(1, 10)], max_rounds=2)["stop"] is False
    s = stop_decision([rnd(1, 37)], max_rounds=2, target_rate=0.9)
    assert s["stop"] and "near the teacher" in s["reason"]
    s = stop_decision([rnd(1, 10), rnd(2, 11)], max_rounds=2, min_gain=0.05)
    assert s["stop"] and "plateau" in s["reason"]
    assert stop_decision([rnd(1, 10), rnd(2, 16)], max_rounds=2)["stop"] is False
    s = stop_decision([rnd(1, 10, frames=100)], min_new_frames=5000)
    assert s["stop"] and "labelled frames" in s["reason"]
    with pytest.raises(ValueError):
        stop_decision([rnd(1, 10), rnd(2, 12), rnd(3, 14)], max_rounds=2)


# --- the rounds --------------------------------------------------------------------------------------------------------

def write_scene(ep: Path, seed: int) -> Path:
    """The scene.json every real episode carries (the seed is what the training-data guard reads)."""
    (Path(ep) / "scene.json").write_text(json.dumps({"seed": seed}), encoding="utf-8")
    return Path(ep)


def cfg(tmp_path: Path, round_id: int = 0, **over) -> RoundConfig:
    repo = tmp_path / "repo"
    data = repo / "data"
    eps = data / "human_exp" / "m" / "eps"
    if not eps.exists():
        for i in range(2):
            write_scene(make_episode(eps, f"h{i}", [f"h{i}"], n_steps=30), 0)  # recorded at the home scene
            write_scene(make_episode(eps, f"h{i}_v0", [f"h{i}", f"h{i}_v0"], n_steps=30), 3100 + i)  # a variant
    grid = data / "human_exp" / "m" / "grid.json"
    grid.write_text(json.dumps({"name": "m", "cells": [
        {"condition": "raw", "n_human": 2, "episode_dirs": ["eps/h0", "eps/h1"]},
        {"condition": "perfected_multiply", "n_human": 2,
         "episode_dirs": ["eps/h0", "eps/h1", "eps/h0_v0", "eps/h1_v0"]},
    ]}), encoding="utf-8")
    start = data / "experiments" / "hx" / "datasets" / "raw_2"
    start.mkdir(parents=True, exist_ok=True)
    (start / "start_state.json").write_text("{}", encoding="utf-8")
    teacher_ckpt = data / "rl_teacher" / "model.pt"
    teacher_ckpt.parent.mkdir(parents=True, exist_ok=True)
    teacher_ckpt.write_text("", encoding="utf-8")
    for exe in ("isaac.exe", "lerobot.exe"):
        (tmp_path / exe).write_text("", encoding="utf-8")
    c = RoundConfig(repo=repo, run_id="dist_test", round_id=round_id, isaac_py=tmp_path / "isaac.exe",
                    lerobot_py=tmp_path / "lerobot.exe", teacher="rl_teacher.policy:make_teacher",
                    teacher_checkpoint=teacher_ckpt, human_grid=grid, human_cell="perfected_multiply_2",
                    start_state=start, teacher_n=4, dagger_n=3, select_n=2, steps=200, save_freq=100,
                    candidates=(100, 200), min_teacher=1, min_new_frames=1, min_free_gb=0.0)
    return c.with_(**over) if over else c


class FakeRunner:
    """Writes what each GPU command would: rollout episodes, a training run, practice results."""

    def __init__(self, data: Path, teacher_ok=True, student_success=0, practice=(1, 2), execution=None):
        self.data, self.cmds, self.execution = data, [], execution
        self.teacher_ok, self.student_success, self.practice = teacher_ok, student_success, practice

    def __call__(self, cmd, env, log_file):
        self.cmds.append((cmd, env))
        if cmd[1].endswith("distill_rollouts.py"):
            arg = lambda k: cmd[cmd.index(k) + 1]  # noqa: E731
            kind, r, out = arg("--kind"), int(arg("--round")), Path(arg("--out"))
            seed0, n = int(arg("--seed0")), int(arg("--n"))
            rows, frames = [], 0
            for s in range(seed0, seed0 + n):
                ok = self.teacher_ok if kind == "teacher" else s - seed0 < self.student_success
                names = []
                if kind == "dagger" or ok:
                    name = f"teacher_r0_{s}" if kind == "teacher" else f"dagger_r{r}_{s}_0"
                    root = "teacher-rl" if kind == "teacher" else f"dagger-r{r}-rl"
                    write_scene(make_episode(out / "episodes", name, [root, name], n_steps=50), s)
                    names, frames = [name], frames + 50
                rows.append({"seed": s, "success": ok, "episodes": names})
            (out / "rollouts.jsonl").write_text("".join(json.dumps(x) + "\n" for x in rows), encoding="utf-8")
            (out / "rollouts_done.json").write_text(json.dumps({
                "kind": kind, "round": r, "seeds": [seed0, seed0 + n - 1], "attempted": n,
                "successes": sum(x["success"] for x in rows), "episodes": sum(len(x["episodes"]) for x in rows),
                "frames": frames, "teacher": "rl",
                **({"teacher_execution": self.execution} if self.execution else {})}), encoding="utf-8")
        elif cmd[1:3] == ["-m", "lerobot_tools.experiments"]:
            grid = json.loads(Path(cmd[cmd.index("--grid") + 1]).read_text(encoding="utf-8"))
            (cell,) = grid["cells"]
            Cell.model_validate(cell)
            steps, freq = int(cmd[cmd.index("--steps") + 1]), int(cmd[cmd.index("--save-freq") + 1])
            run = self.data / "experiments" / f"{grid['name']}_20261022_010203"
            for s in range(freq, steps + 1, freq):
                (run / "train" / cell["label"] / "checkpoints" / f"{s:06d}" / "pretrained_model").mkdir(parents=True)
        elif cmd[1].endswith("eval_cells.py"):
            run_id, spec = cmd[cmd.index("--run-id") + 1], cmd[cmd.index("--checkpoint") + 1]
            seed0, n = int(cmd[cmd.index("--seed0") + 1]), int(cmd[cmd.index("--n") + 1])
            cell = spec.split("=", 1)[0]
            k = self.practice[0] if cell.endswith("_s100") else self.practice[1]
            out = self.data / "evals" / run_id / f"{cell}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps({"episodes": [
                {"seed": s, "success": i < k, "reasons": [], "ended_by": "success" if i < k else "time_limit"}
                for i, s in enumerate(range(seed0, seed0 + n))]}), encoding="utf-8")
        return 0


def run(c: RoundConfig, runner: FakeRunner):
    run_phases(plan_round(c, log=lambda m: None, runner=runner), log=lambda m: None)


def test_round0_teacher_rollouts_mix_train_select(tmp_path):
    c = cfg(tmp_path)
    runner = FakeRunner(c.data)
    run(c, runner)
    kinds = [Path(x[0][1]).name if not x[0][1].startswith("-m") else x[0][2] for x in runner.cmds]
    assert kinds == ["distill_rollouts.py", "lerobot_tools.experiments", "eval_cells.py", "eval_cells.py"]
    t_cmd = runner.cmds[0][0]
    assert t_cmd[t_cmd.index("--kind") + 1] == "teacher" and t_cmd[t_cmd.index("--seed0") + 1] == "4000"
    assert t_cmd[t_cmd.index("--teacher") + 1] == "rl_teacher.policy:make_teacher"
    grid = json.loads(c.grid_file.read_text(encoding="utf-8"))
    (cell,) = grid["cells"]
    assert grid["name"] == "dist_test_r0_t4" and cell["label"] == "distill_r0" and cell["n_human"] == 2
    rnd0 = json.loads(c.round_file.read_text(encoding="utf-8"))
    assert rnd0["round"] == 0 and rnd0["teacher_gate"] == {"verified": 4, "attempted": 4, "rate": 1.0,
                                                           "passes": True, "threshold": 0.9}
    assert set(rnd0["mix"]) == {"human", "teacher"}
    assert rnd0["data_check"] == {"human": {"episodes": 4, "seeds": [0, 3101]},
                                  "teacher": {"episodes": 4, "seeds": [4000, 4003]}}
    sel = json.loads(c.selection_file.read_text(encoding="utf-8"))
    assert sel["chosen_step"] == 200 and sel["counts"] == {"100": [1, 2], "200": [2, 2]}
    assert sel["seeds"] == [5300, 5301]
    assert sel["checkpoint"].endswith(str(Path("distill_r0", "checkpoints", "000200", "pretrained_model")))
    assert sel["teacher_seeds"] == [4000, 4003]
    assert json.loads(c.selection_path(0).read_text(encoding="utf-8")) == sel  # the latest, for round 1
    # a re-run skips every finished phase
    again = FakeRunner(c.data)
    run(c, again)
    assert again.cmds == []


def test_round0_with_more_teacher_runs_keeps_the_old_ones_and_retrains(tmp_path):
    """The preregistered "round 0 at 600" path: the same command with a larger --teacher-n after a finished round 0
    resumes the rollouts (only the new seeds), then mixes, trains and selects again from scratch, under new names; the
    smaller set's grid, training run and selection stay as they were."""
    small = cfg(tmp_path, teacher_n=2)
    run(small, FakeRunner(small.data, practice=(2, 1)))
    sel_small = json.loads(small.selection_file.read_text(encoding="utf-8"))
    assert sel_small["chosen_step"] == 100 and small.selection_file.name == "selection_t2.json"

    big = cfg(tmp_path, teacher_n=4)
    runner = FakeRunner(big.data)
    run(big, runner)
    kinds = [Path(x[0][1]).name if not x[0][1].startswith("-m") else x[0][2] for x in runner.cmds]
    assert kinds == ["distill_rollouts.py", "lerobot_tools.experiments", "eval_cells.py", "eval_cells.py"]
    t_cmd = runner.cmds[0][0]
    assert t_cmd[t_cmd.index("--n") + 1] == "4" and t_cmd[t_cmd.index("--out") + 1] == str(small.round_dir())
    (cell,) = json.loads(big.grid_file.read_text(encoding="utf-8"))["cells"]
    assert big.grid_file.name == "dist_test_r0_t4.json" and small.grid_file.exists()
    teacher = {Path(d).name for d in cell["episode_dirs"] if "teacher" in Path(d).name}
    assert teacher == {f"teacher_r0_{s}" for s in range(4000, 4004)}
    (small_cell,) = json.loads(small.grid_file.read_text(encoding="utf-8"))["cells"]
    assert {Path(d).name for d in small_cell["episode_dirs"] if "teacher" in Path(d).name} == {
        "teacher_r0_4000", "teacher_r0_4001"}
    sel_big = json.loads(big.selection_file.read_text(encoding="utf-8"))
    assert sel_big["chosen_step"] == 200 and sel_big["teacher_seeds"] == [4000, 4003]
    assert "dist_test_r0_t4_" in sel_big["train_run"]
    assert json.loads(big.selection_path(0).read_text(encoding="utf-8")) == sel_big
    assert json.loads(small.selection_file.read_text(encoding="utf-8")) == sel_small  # kept as it was


def test_round0_takes_only_its_own_teacher_seeds(tmp_path):
    """A 300 run after a 600 one (or a 50-seed gate folder with more in it) mixes only its own seed range."""
    big = cfg(tmp_path, teacher_n=4)
    run(big, FakeRunner(big.data))
    small = cfg(tmp_path, teacher_n=2)
    run(small, FakeRunner(small.data))
    (cell,) = json.loads(small.grid_file.read_text(encoding="utf-8"))["cells"]
    assert {Path(d).name for d in cell["episode_dirs"] if "teacher" in Path(d).name} == {
        "teacher_r0_4000", "teacher_r0_4001"}


def test_round0_stops_when_the_teacher_fails_in_our_env(tmp_path):
    c = cfg(tmp_path, min_teacher=2)
    with pytest.raises(PhaseFailed, match="teacher"):
        run(c, FakeRunner(c.data, teacher_ok=False))
    assert not c.grid_file.exists()


def test_round1_relabels_the_round0_student_and_aggregates(tmp_path):
    c0 = cfg(tmp_path)
    run(c0, FakeRunner(c0.data))
    c1 = cfg(tmp_path, round_id=1)
    runner = FakeRunner(c1.data, student_success=1)
    run(c1, runner)
    d_cmd = runner.cmds[0][0]
    assert Path(d_cmd[1]).name == "distill_rollouts.py" and d_cmd[d_cmd.index("--kind") + 1] == "dagger"
    sel0 = json.loads(c0.selection_file.read_text(encoding="utf-8"))
    assert d_cmd[d_cmd.index("--checkpoint") + 1] == sel0["checkpoint"]  # round 0's chosen student
    assert d_cmd[d_cmd.index("--seed0") + 1] == "5200" and d_cmd[d_cmd.index("--n") + 1] == "3"
    (cell,) = json.loads(c1.grid_file.read_text(encoding="utf-8"))["cells"]
    m = build_manifest(Cell.model_validate(cell))
    assert set(m["sources"]) == {"human", "teacher", "dagger"}
    rnd1 = json.loads(c1.round_file.read_text(encoding="utf-8"))
    assert rnd1["decision"]["stop"] is False and rnd1["student_checkpoint"] == sel0["checkpoint"]
    assert rnd1["rollouts"] == {"successes": 1, "n": 3}
    # round 2 visits new seeds and keeps rounds 1 and 2
    c2 = cfg(tmp_path, round_id=2)
    r2 = FakeRunner(c2.data, student_success=2)
    run(c2, r2)
    d2 = r2.cmds[0][0]
    assert d2[d2.index("--seed0") + 1] == "5203"
    (cell2,) = json.loads(c2.grid_file.read_text(encoding="utf-8"))["cells"]
    names = {Path(d).name for d in cell2["episode_dirs"]}
    assert {"dagger_r1_5200_0", "dagger_r2_5203_0"} <= names


def test_a_stopped_round_skips_training(tmp_path):
    c0 = cfg(tmp_path)
    run(c0, FakeRunner(c0.data))
    c1 = cfg(tmp_path, round_id=1, target_rate=0.5)
    runner = FakeRunner(c1.data, student_success=3)  # 3/3 >= 0.5: the student is near the teacher
    run(c1, runner)
    assert [Path(x[0][1]).name for x in runner.cmds] == ["distill_rollouts.py"]
    rnd1 = json.loads(c1.round_file.read_text(encoding="utf-8"))
    assert rnd1["decision"]["stop"] is True and not c1.grid_file.exists()


def test_round1_needs_round0_selected(tmp_path):
    c1 = cfg(tmp_path, round_id=1)
    with pytest.raises(PhaseFailed, match="round 0"):
        run(c1, FakeRunner(c1.data))


def test_seed_rules(tmp_path):
    c = cfg(tmp_path)
    with pytest.raises(ValueError, match="training-side"):
        teacher_cmd(c.with_(teacher_seed0=4990, teacher_n=20))
    with pytest.raises(ValueError, match="practice"):
        dagger_cmd(cfg(tmp_path, round_id=1, dagger_seed0=5020), Path("ckpt"))
    with pytest.raises(ValueError, match="practice"):
        dagger_cmd(cfg(tmp_path, round_id=1, dagger_seed0=5270, dagger_n=20), Path("ckpt"))
    with pytest.raises(ValueError):
        select_cmd(c.with_(select_seed0=5030), "x", Path("ckpt"))
    with pytest.raises(ValueError):
        select_cmd(c.with_(select_seed0=5200), "x", Path("ckpt"))  # the DAgger seeds are not for selection
    with pytest.raises(ValueError):
        cfg(tmp_path, round_id=3)
    # by default each round visits its own practice seeds
    assert cfg(tmp_path, round_id=2, dagger_n=40).dagger_seed0_effective == 5240


def test_inference_and_train_options_pass_through(tmp_path):
    c = cfg(tmp_path, round_id=1, inference_args=("--binarize-gripper", "--n-action-steps", "20"),
            train_args=("--augment", "shift"))
    d = dagger_cmd(c, Path("ckpt"))
    assert d[-3:] == ["--binarize-gripper", "--n-action-steps", "20"]
    s = select_cmd(c, "distill_r1_s100", Path("ckpt"))
    assert s[-3:] == ["--binarize-gripper", "--n-action-steps", "20"]
    assert "--beta" in d and d[d.index("--beta") + 1] == "0.0"


def test_stop_after_rollouts_then_a_bigger_run_resumes(tmp_path):
    c = cfg(tmp_path, teacher_n=2)
    runner = FakeRunner(c.data)
    run_phases(plan_round(c, log=lambda m: None, runner=runner, stop_after="rollouts"), log=lambda m: None)
    assert len(runner.cmds) == 1 and not c.grid_file.exists()
    full = cfg(tmp_path, teacher_n=4)
    names = [ph.name for ph in plan_round(full, log=lambda m: None, runner=runner) if not ph.done()]
    assert names == ["preflight", "rollouts", "grid", "train", "select"]  # the 2-seed rollouts don't cover 4
    with pytest.raises(ValueError, match="decide"):
        plan_round(c, log=lambda m: None, stop_after="decide")  # round 0 has no decide phase


def test_the_wrapper_dry_run_writes_nothing(tmp_path, capsys):
    import importlib.util

    script = Path(__file__).resolve().parents[1] / "scripts" / "distill_round.py"
    spec = importlib.util.spec_from_file_location("distill_round_script", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rc = mod.main(["--round", "1", "--run-id", "dryrun_test_never_written", "--teacher", "m:f",
                   "--teacher-checkpoint", str(tmp_path / "t.pt"), "--human-grid", str(tmp_path / "g.json"),
                   "--human-cell", "x", "--start-state", str(tmp_path), "--stop-after", "decide", "--dry-run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert [ln.split()[0] for ln in out.splitlines() if not ln.startswith("[imports]")] == [
        "preflight", "rollouts", "decide"]
    assert not (mod.REPO / "data" / "distill" / "dryrun_test_never_written").exists()


def test_code_version_names_the_commit_and_whether_it_is_clean(tmp_path):
    import subprocess

    from sim_eval.distill_round import code_version

    assert code_version(tmp_path) == {"commit": None, "branch": None, "dirty": None}  # not a checkout
    repo = tmp_path / "r"
    repo.mkdir()
    run_git = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True)  # noqa: E731
    run_git("init", "-q", "-b", "trial")
    (repo / "f.txt").write_text("a", encoding="utf-8")
    run_git("add", "f.txt")
    run_git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x")
    v = code_version(repo)
    assert len(v["commit"]) == 40 and v["branch"] == "trial" and v["dirty"] is False
    (repo / "f.txt").write_text("b", encoding="utf-8")
    assert code_version(repo)["dirty"] is True


def test_training_data_guard_refuses_eval_side_seeds_and_rl_folders(tmp_path):
    """Nothing seen on the selection (5300-5399) or test (5020-5059) seeds may train the student: T3's gate writes
    teacher trajectories on 5300-5349 under data/rl/eval. Human and teacher episodes stay on the training side
    (< 5000; the teacher's within this round's range), DAgger ones on the practice seeds, and teacher / DAgger ones
    inside their round's own episodes folder."""
    from sim_eval.distill_round import check_training_episodes

    h = [write_scene(make_episode(tmp_path / "h", "h0", ["h0"]), 0),
         write_scene(make_episode(tmp_path / "h", "h0_v", ["h0", "h0_v"]), 4009)]
    r0 = tmp_path / "r0" / "episodes"
    r1 = tmp_path / "r1" / "episodes"
    t = [write_scene(make_episode(r0, f"teacher_r0_{s}", ["teacher-rl", f"teacher_r0_{s}"]), s) for s in (4000, 4001)]
    d = [write_scene(make_episode(r1, "dagger_r1_5200_0", ["dagger-r1-rl", "dagger_r1_5200_0"]), 5200)]
    ok = {"human": h, "teacher": t, "dagger": d}
    folders = {"teacher": [r0], "dagger": [r1]}
    report = check_training_episodes(ok, teacher_seeds=(4000, 4001), folders=folders)
    assert report == {"human": {"episodes": 2, "seeds": [0, 4009]}, "teacher": {"episodes": 2, "seeds": [4000, 4001]},
                      "dagger": {"episodes": 1, "seeds": [5200, 5200]}}

    def refused(src, ep, match):
        with pytest.raises(ValueError, match=match):
            check_training_episodes({**ok, src: ok[src] + [ep]}, teacher_seeds=(4000, 4001), folders=folders)

    gate = tmp_path / "data" / "rl" / "eval" / "v6_gate"
    refused("human", write_scene(make_episode(gate, "ep_4000", ["ep_4000"]), 4000), "rl")  # T3's folder, any seed
    refused("human", write_scene(make_episode(tmp_path / "h", "h_sel", ["h_sel"]), 5301), "5301")
    refused("human", write_scene(make_episode(tmp_path / "h", "h_test", ["h_test"]), 5020), "5020")
    refused("teacher", write_scene(make_episode(r0, "teacher_r0_5302", ["teacher-rl", "x"]), 5302), "5302")
    refused("teacher", write_scene(make_episode(r0, "teacher_r0_4002", ["teacher-rl", "y"]), 4002), "4002")
    stray = write_scene(make_episode(tmp_path / "elsewhere", "teacher_r0_4000", ["teacher-rl", "z"]), 4000)
    refused("teacher", stray, "folder")
    refused("dagger", write_scene(make_episode(r1, "dagger_r1_5300_0", ["dagger-r1-rl", "w"]), 5300), "5300")
    no_scene = make_episode(tmp_path / "h", "h_noscene", ["h_noscene"])
    refused("human", no_scene, "scene.json")


def test_round_grid_stops_on_a_selection_seed_episode(tmp_path):
    c = cfg(tmp_path, teacher_n=2)
    run_phases(plan_round(c, log=lambda m: None, runner=FakeRunner(c.data), stop_after="rollouts"),
               log=lambda m: None)
    write_scene(c.round_dir(0) / "episodes" / "teacher_r0_4001", 5301)  # a selection-seed scene under a teacher name
    with pytest.raises(PhaseFailed, match="5301"):
        run(c, FakeRunner(c.data))
    assert not c.grid_file.exists()


def test_held_teacher_execution_is_passed_on_recorded_and_not_mixed(tmp_path):
    """Option A: --teacher-execution held reaches distill_rollouts and round.json; a round-0 folder whose rollouts
    were made with the teacher's tracking does not count as done for a held round (it needs its own run id)."""
    c = cfg(tmp_path, teacher_n=2)
    run_phases(plan_round(c, log=lambda m: None, runner=FakeRunner(c.data), stop_after="rollouts"),
               log=lambda m: None)
    assert "--teacher-execution" in teacher_cmd(c) and teacher_cmd(c)[-1] == "tracking"
    held = cfg(tmp_path, teacher_n=2, teacher_execution="held")
    assert teacher_cmd(held)[-2:] == ["--teacher-execution", "held"]
    pending = [ph.name for ph in plan_round(held, log=lambda m: None, runner=FakeRunner(held.data)) if not ph.done()]
    assert "rollouts" in pending  # the tracking rollouts_done.json does not cover a held round
    h2 = cfg(tmp_path / "h2", teacher_n=2, teacher_execution="held")
    runner = FakeRunner(h2.data, execution="held")
    run(h2, runner)
    rnd0 = json.loads(h2.round_file.read_text(encoding="utf-8"))
    assert rnd0["teacher_execution"] == "held"
    with pytest.raises(ValueError):
        cfg(tmp_path, teacher_execution="fast")


def test_amendment_4_ranges_are_accepted(tmp_path, capsys):
    """Amendment 4 (2026-10-21): gate (b) on 4950-4999 (its own run id, never training data), round 0 on 4300-4599
    (extension 4300-4899), selection on 5301-5329 (5300 excluded: 29 seeds), DAgger round 1 from 5210."""
    gate = cfg(tmp_path, teacher_seed0=4950, teacher_n=50, teacher_execution="held")
    t = teacher_cmd(gate)
    assert t[t.index("--seed0") + 1] == "4950" and t[t.index("--n") + 1] == "50"
    for n in (300, 600):
        t = teacher_cmd(cfg(tmp_path, teacher_seed0=4300, teacher_n=n))
        assert t[t.index("--seed0") + 1] == "4300" and t[t.index("--n") + 1] == str(n)
    s = select_cmd(cfg(tmp_path, select_seed0=5301, select_n=29), "x", Path("ckpt"))
    assert s[s.index("--seed0") + 1] == "5301" and s[s.index("--n") + 1] == "29"
    d = dagger_cmd(cfg(tmp_path, round_id=1, dagger_seed0=5210, dagger_n=40), Path("ckpt"))
    assert d[d.index("--seed0") + 1] == "5210" and d[d.index("--n") + 1] == "40"
    # the wrapper takes --select-seed0
    import importlib.util

    script = Path(__file__).resolve().parents[1] / "scripts" / "distill_round.py"
    spec = importlib.util.spec_from_file_location("distill_round_script_a4", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    rc = mod.main(["--round", "0", "--run-id", "dryrun_a4_never_written", "--teacher", "m:f",
                   "--teacher-checkpoint", str(tmp_path / "t.pt"), "--human-grid", str(tmp_path / "g.json"),
                   "--human-cell", "x", "--start-state", str(tmp_path), "--teacher-seed0", "4300", "--teacher-n", "300",
                   "--select-seed0", "5301", "--select-n", "29", "--teacher-execution", "held", "--dry-run"])
    out = capsys.readouterr().out
    assert rc == 0 and "seeds 4300-4599" in out and "seeds 5301-5329" in out
    assert not (mod.REPO / "data" / "distill" / "dryrun_a4_never_written").exists()


def test_round_records_name_the_code(tmp_path):
    c = cfg(tmp_path)
    run(c, FakeRunner(c.data))
    rnd0 = json.loads(c.round_file.read_text(encoding="utf-8"))
    sel = json.loads(c.selection_file.read_text(encoding="utf-8"))
    assert set(rnd0["code"]) == {"commit", "branch", "dirty"} and set(sel["code"]) == {"commit", "branch", "dirty"}
