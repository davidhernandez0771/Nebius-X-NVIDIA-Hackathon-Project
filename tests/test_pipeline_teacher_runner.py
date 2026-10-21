"""app.pipeline.teacher_runner: the teacher recipe's runner (scripts/run_teacher_pipeline.py). T3's RL teacher training,
the teacher gate (T3's eval + verify), T6's distill round 0 (+ an optional DAgger round): one subprocess per stage,
STOP-file cancel, resume from markers, the GPU lock where a stage doesn't take it itself. Every child is faked."""

from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.pipeline.teacher_runner import (Refused, Stop, TeacherConfig, TeacherDeps, TeacherRun, STOP_FILE, resolve_human)

RL_EXP = Path("data") / "rl" / "logs" / "rsl_rl" / "sant_rl_teacher"


def _w(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")


def _repo(tmp: Path) -> Path:
    repo = tmp / "repo"
    for f in ("scripts/rl_train.py", "scripts/rl_eval_teacher.py", "scripts/rl_verify_teacher.py",
              "sim_eval/scripts/distill_round.py", "sim_worker/rl_policy.py"):
        _w(repo / f, "# stand-in\n")
    _w(repo / "data" / "rl" / "bank_mouse20261020.npz", "bank")
    return repo


def _human(data: Path) -> None:
    root = data / "human_exp" / "mouse20261020"
    _w(root / "grid.json", {"name": "hx_mouse20261020", "cells": [{"condition": "raw", "n_human": 10, "name": "raw_10"},
                                                                  {"condition": "perfected_multiply", "n_human": 10,
                                                                   "name": "perfected_multiply_10"}]})
    raw = data / "experiments" / "hx_m_1" / "datasets" / "raw_10"
    raw.mkdir(parents=True, exist_ok=True)
    _w(root / "stages" / "train.json", {"ok": True, "cells": {"raw_10": {"dataset": str(raw)},
                                                              "perfected_multiply_10": {"dataset": str(raw.parent / "perfected_multiply_10")}}})


class FakeChildren:
    """Plays each stage's script: writes what the real one would, from its command line."""

    def __init__(self, repo: Path, *, gate_successes: int = 49, fail: str | None = None, rl_saves=(49, 99, 149)):
        self.repo, self.gate_successes, self.fail, self.rl_saves = repo, gate_successes, fail, rl_saves
        self.cmds: list[list[str]] = []
        self.hook = None

    def __call__(self, cmd: list[str], log: Path) -> int:
        self.cmds.append(cmd)
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text("ran\n", encoding="utf-8")
        script = Path(cmd[1]).name
        if self.fail and self.fail == script:
            return 1
        if script == "rl_train.py":
            name = cmd[cmd.index("--run-name") + 1]
            run = self.repo / RL_EXP / f"2026-10-21_09-00-00_{name}"
            for i in self.rl_saves:
                _w(run / f"model_{i}.pt", "w")
        elif script == "rl_eval_teacher.py":
            out = Path(cmd[cmd.index("--out") + 1])
            n = int(cmd[cmd.index("--n") + 1])
            for s in range(n):
                _w(out / "trajectories" / f"{5300 + s}.json", "{}")
            _w(out / "in_env.json", {"n": n, "in_env_successes": n})
            ck = Path(cmd[cmd.index("--checkpoint") + 1])
            _w(ck.parent / "exported" / "policy.pt", "jit")
        elif script == "rl_verify_teacher.py":
            runs = Path(cmd[cmd.index("--runs") + 1])
            n = len(list((runs / "trajectories").glob("*.json")))
            k = min(self.gate_successes, n)
            verdicts = {str(5300 + s): {"success": s < k, "reasons": [] if s < k else ["dropped"], "duration": 9.0}
                        for s in range(n)}
            _w(runs / "verify.json", {"summary": {"successes": k, "n": n, "rate": k / n, "ci95": [0.8, 0.99]},
                                      "verdicts": verdicts, "agree_with_in_env": n})
        elif script == "distill_round.py":
            # T6's names (sim_eval/distill_round.py): round 0's files are per teacher set ("_t300")
            r, run_id = cmd[cmd.index("--round") + 1], cmd[cmd.index("--run-id") + 1]
            n = int(cmd[cmd.index("--teacher-n") + 1])
            tag = f"_t{n}" if r == "0" else ""
            rdir = self.repo / "data" / "distill" / run_id / f"r{r}"
            train_run = self.repo / "data" / "experiments" / f"{run_id}_r{r}{tag}_20261021_120000"
            _w(train_run / "datasets" / f"distill_r{r}" / "meta" / "info.json", {"fps": 50})
            _w(train_run / "logs" / f"distill_r{r}.log", "step:200 smpl:1K ep:2 epch:0.1 loss:0.512 grdn:1\n")
            ck = train_run / "train" / f"distill_r{r}" / "checkpoints" / "060000" / "pretrained_model"
            _w(ck / "model.safetensors", "w")
            _w(rdir / "rollouts.jsonl", "".join(json.dumps({"seed": 4000 + i, "success": True}) + "\n" for i in range(n)))
            _w(rdir / "rollouts_done.json", {"attempted": n, "successes": n, "seeds": [4000, 4000 + n - 1]})
            _w(rdir / f"round{tag}.json", {"round": int(r), "teacher_gate": {"rate": 1.0}})
            _w(rdir / "selection.json", {"checkpoint": str(ck), "train_run": str(train_run), "chosen_step": 60000,
                                         "counts": {"60000": [20, 30]}, "seeds": [5300, 5329]})
        if self.hook:
            self.hook(cmd)
        return 0


def _run(tmp: Path, *, children=None, **kw) -> tuple[TeacherRun, FakeChildren, list[str]]:
    repo = _repo(tmp)
    data = tmp / "data"
    _human(data)
    locks: list[str] = []

    @contextmanager
    def lock(task):
        locks.append(task)
        yield

    children = children or FakeChildren(repo)
    kw.setdefault("rl_iterations", 150)  # the fake trainer saves model_149 by default
    cfg = TeacherConfig(name="pl_t", data=data, repo=repo, human_run="mouse20261020", **kw)
    return TeacherRun(cfg, TeacherDeps(run=children, gpu_lock=lock, log=lambda m: None)), children, locks


def test_the_stages_run_in_order_each_one_command(tmp_path):
    t, ch, locks = _run(tmp_path, rl_iterations=150, teacher_n=300)
    t.run()
    scripts = [Path(c[1]).name for c in ch.cmds]
    assert scripts == ["rl_train.py", "rl_eval_teacher.py", "rl_verify_teacher.py", "distill_round.py"]
    train, ev, _verify, distill = ch.cmds
    assert train[train.index("--max-iterations") + 1] == "150" and "--checkpoint" not in train
    assert ev[ev.index("--seed0") + 1] == "5300" and ev[ev.index("--n") + 1] == "50"  # practice seeds: the test seeds stay untouched
    assert ev[ev.index("--checkpoint") + 1].endswith("model_149.pt")
    assert distill[distill.index("--round") + 1] == "0" and distill[distill.index("--teacher-n") + 1] == "300"
    assert distill[distill.index("--teacher") + 1] == "sim_worker.rl_policy:make"
    assert distill[distill.index("--teacher-checkpoint") + 1].endswith(str(Path("exported") / "policy.pt"))
    assert distill[distill.index("--human-cell") + 1] == "perfected_multiply_10"
    assert distill[distill.index("--start-state") + 1].endswith("raw_10")
    # only the eval step doesn't take gpu.lock itself, so the runner holds it there (never around a child that locks)
    assert locks == ["teacher:pl_t:gate"]
    root = tmp_path / "data" / "teacher" / "pl_t"
    for m in ("teacher", "gate_eval", "gate_verify", "distill_r0", "results"):
        assert (root / "stages" / f"{m}.json").is_file()
    res = json.loads((root / "results.json").read_text(encoding="utf-8"))
    assert res["teacher_gate"]["successes"] == 49 and res["teacher_gate"]["n"] == 50
    assert res["rounds"][0]["selection"]["chosen_step"] == 60000 and res["rounds"][0]["round_json"]["round"] == 0
    assert t.train_run(0).name == "pl_t_r0_t300_20261021_120000"
    assert "done through 'results'" in (root / "run.log").read_text(encoding="utf-8")


def test_a_dagger_round_runs_after_round_0_when_asked(tmp_path):
    t, ch, _ = _run(tmp_path, dagger=True)
    t.run()
    rounds = [c[c.index("--round") + 1] for c in ch.cmds if Path(c[1]).name == "distill_round.py"]
    assert rounds == ["0", "1"]


def test_the_gate_refuses_a_teacher_under_90_percent_in_sants_eval_env(tmp_path):
    t, ch, _ = _run(tmp_path, children=None)
    t.deps.run.gate_successes = 40  # 40/50 = 80%
    with pytest.raises(Refused, match="teacher gate: 40/50 .* under 90%"):
        t.run()
    assert not any(Path(c[1]).name == "distill_round.py" for c in ch.cmds)


def test_resume_skips_finished_stages_and_continues_rl_from_its_last_checkpoint(tmp_path):
    repo = _repo(tmp_path)
    ch = FakeChildren(repo, rl_saves=(49, 99))  # it ended at 100 of 300 (a crash, a sleep)
    t, _, _ = _run(tmp_path, children=ch, rl_iterations=300)
    with pytest.raises(Stop, match="iteration 100 of 300"):
        t.run()
    assert not (tmp_path / "data" / "teacher" / "pl_t" / "stages" / "teacher.json").exists()
    ch2 = FakeChildren(repo, rl_saves=(149, 299))
    t2, _, _ = _run(tmp_path, children=ch2, rl_iterations=300)
    t2.run()
    train = ch2.cmds[0]
    assert Path(train[1]).name == "rl_train.py"
    assert train[train.index("--checkpoint") + 1].endswith("model_99.pt")
    # rsl_rl resumes AT the saved iteration (it re-runs index 99), so 201 more end at model_299: 300 in all
    assert train[train.index("--max-iterations") + 1] == "201"
    again = FakeChildren(repo)
    t3, _, _ = _run(tmp_path, children=again, rl_iterations=300)
    t3.run()
    assert again.cmds == []  # everything was done


def test_a_stop_file_stops_before_the_next_stage(tmp_path):
    t, ch, _ = _run(tmp_path)
    stop = tmp_path / "data" / "teacher" / "pl_t" / STOP_FILE

    def after(cmd):
        if Path(cmd[1]).name == "rl_eval_teacher.py":
            stop.write_text("cancelled", encoding="utf-8")

    ch.hook = after
    with pytest.raises(Stop, match="stop requested before gate_verify"):
        t.run()
    assert [Path(c[1]).name for c in ch.cmds] == ["rl_train.py", "rl_eval_teacher.py"]


def test_preflight_refuses_missing_scripts_or_inputs(tmp_path):
    t, _, _ = _run(tmp_path)
    (t.cfg.repo / "sim_eval" / "scripts" / "distill_round.py").unlink()
    with pytest.raises(Refused, match="distill_round.py.*pm/distill-dagger"):
        t.preflight()
    t2, _, _ = _run(tmp_path / "b")
    t2.cfg.human_run = "nope"
    with pytest.raises(Refused, match="no human run 'nope'"):
        t2.preflight()


def test_the_smoke_preset_uses_the_scripts_own_small_sizes_and_no_gate(tmp_path):
    t, ch, _ = _run(tmp_path, smoke=True)
    t.run()
    train, ev, _v, distill = ch.cmds
    assert "--smoke" in train and ev[ev.index("--n") + 1] == "5"
    for flag, val in (("--teacher-n", "4"), ("--min-teacher", "1"), ("--steps", "200"), ("--select-n", "2")):
        assert distill[distill.index(flag) + 1] == val
    assert t.cfg.gate_min == 0.0


def test_the_human_run_gives_the_grid_its_multiplied_cell_and_the_start_state(tmp_path):
    data = tmp_path / "data"
    _human(data)
    grid, cell, start = resolve_human(data, "mouse20261020")
    assert grid.name == "grid.json" and cell == "perfected_multiply_10" and start.name == "raw_10"
