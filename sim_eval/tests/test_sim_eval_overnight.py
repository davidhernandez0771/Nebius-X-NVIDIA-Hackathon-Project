"""sim_eval.overnight (pure): the grasp-fix run 2 pipeline (recovery copies + longer training), one unattended
command. Practice seeds 5200-5279 only for building and tuning; the official 5020-5059 run once, at the end."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from sim_eval import overnight as ov


def cfg(tmp_path, **kw):
    return ov.Config.default(repo=tmp_path / "repo", **kw)


# --- seeds -------------------------------------------------------------------------------------------------------

def test_the_seed_plan_keeps_building_and_tuning_on_practice_seeds():
    c = ov.Config.default(repo=Path("r"))
    collect = set(range(c.collect_seed0, c.collect_seed0 + c.collect_n))
    select = set(range(c.select_seed0, c.select_seed0 + c.select_n))
    assert collect == set(range(5200, 5250)) and select == set(range(5250, 5280))
    assert not collect & select and (collect | select) <= set(ov.PRACTICE_SEEDS)
    assert (c.test_seed0, c.test_n) == (5020, 40) and not set(ov.PRACTICE_SEEDS) & set(range(5020, 5060))


def test_eval_commands_refuse_test_seeds_unless_final(tmp_path):
    c = cfg(tmp_path)
    with pytest.raises(ValueError, match="practice"):
        ov.eval_cmd(c, "x", Path("ck"), seed0=5020, n=40)
    with pytest.raises(ValueError, match="practice"):
        ov.eval_cmd(c, "x", Path("ck"), seed0=5270, n=20)  # runs past 5279
    with pytest.raises(ValueError, match="5020"):
        ov.eval_cmd(c, "x", Path("ck"), seed0=5200, n=40, final=True)
    cmd = ov.eval_cmd(c, "recovery_10x10_final", Path("ck"), seed0=5020, n=40, final=True, trace=True)
    assert cmd[cmd.index("--seed0") + 1] == "5020" and "--trace" in cmd


def test_eval_commands_match_the_headline_eval(tmp_path):
    c = cfg(tmp_path)
    cmd = ov.eval_cmd(c, "centered_10x10_practice", Path("CK"), seed0=5200, n=50, trace=True)
    assert cmd[0] == str(c.isaac_py) and cmd[1].endswith("eval_cells.py")
    assert cmd[cmd.index("--run-id") + 1] == c.run_id
    assert cmd[cmd.index("--checkpoint") + 1] == "centered_10x10_practice=CK"
    assert cmd[cmd.index("--start-state") + 1] == str(c.start_state)
    assert cmd[cmd.index("--start-pose") + 1] == "dataset" and cmd[cmd.index("--n") + 1] == "50"
    declared = set(__import__("re").findall(r'add_argument\(\s*"(--[a-z0-9_-]+)"',
                   (Path(ov.__file__).parent / "scripts" / "eval_cells.py").read_text("utf-8")))
    assert {a for a in cmd if a.startswith("--")} <= declared


# --- results files -----------------------------------------------------------------------------------------------

def write_results(path: Path, seeds_ok: dict[int, bool], checkpoint="ck", errors=()):
    path.parent.mkdir(parents=True, exist_ok=True)
    eps = [{"seed": s, "success": ok, "reasons": [] if ok else ["dropped"],
            "ended_by": "sim_error" if s in errors else ("success" if ok else "time_limit")}
           for s, ok in seeds_ok.items()]
    path.write_text(json.dumps({"run": {"checkpoint": checkpoint}, "episodes": eps}), encoding="utf-8")
    lines = [{"header": {"checkpoint": checkpoint}}] + [{"episode": e} for e in eps]
    path.with_suffix(".episodes.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n", encoding="utf-8")


def test_results_complete_needs_a_valid_episode_for_every_seed(tmp_path):
    p = tmp_path / "a.json"
    assert not ov.results_complete(p, 5200, 3)
    write_results(p, {5200: True, 5201: False})
    assert not ov.results_complete(p, 5200, 3)
    write_results(p, {5200: True, 5201: False, 5202: True}, errors={5202})
    assert not ov.results_complete(p, 5200, 3)
    write_results(p, {5200: True, 5201: False, 5202: True})
    assert ov.results_complete(p, 5200, 3) and ov.count_successes(p, 5200, 3) == (2, 3)


# --- collecting the recovery states ------------------------------------------------------------------------------

def test_collect_states_reads_every_trace_and_names_its_source(tmp_path, monkeypatch):
    tdir = tmp_path / "traces"
    tdir.mkdir()
    for s in (5200, 5201):
        np.savez(tdir / f"seed_{s}.npz", gripper=np.zeros(3))
    seen = []

    def fake_find(trace, scene, *, source):
        seen.append((scene.seed, source))
        return [f"state-{scene.seed}"]

    monkeypatch.setattr(ov, "find_recovery_states", fake_find)
    states = ov.collect_states(tdir, source="centered_10x10")
    assert states == ["state-5200", "state-5201"] and seen == [(5200, "centered_10x10"), (5201, "centered_10x10")]


def test_collect_states_refuses_traces_from_test_seeds(tmp_path):
    tdir = tmp_path / "traces"
    tdir.mkdir()
    np.savez(tdir / "seed_5030.npz", gripper=np.zeros(3))
    with pytest.raises(ValueError, match="practice"):
        ov.collect_states(tdir, source="c")


# --- the training grid -------------------------------------------------------------------------------------------

def test_the_grid_is_the_centered_cell_plus_the_verified_recovery_copies(tmp_path):
    centered = tmp_path / "centered.json"
    centered.write_text(json.dumps({"name": "grasp_fix_centered", "cells": [
        {"condition": "raw_multiply", "n_human": 10, "label": "centered_10x10",
         "episode_dirs": [f"C{i}" for i in range(110)]}]}), encoding="utf-8")
    manifest = {"verified_dirs": [f"R{i}" for i in range(40)]}
    grid = ov.build_grid(centered, manifest, name="recovery_run2", label="recovery_10x10")
    (cell,) = grid["cells"]
    assert grid["name"] == "recovery_run2" and cell["label"] == "recovery_10x10"
    assert cell["condition"] == "raw_multiply" and cell["n_human"] == 10
    assert cell["episode_dirs"] == [f"C{i}" for i in range(110)] + [f"R{i}" for i in range(40)]


def test_too_few_verified_recovery_copies_stop_the_run(tmp_path):
    centered = tmp_path / "centered.json"
    centered.write_text(json.dumps({"name": "g", "cells": [
        {"condition": "raw_multiply", "n_human": 10, "label": "c", "episode_dirs": ["C"] * 110}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="recovery copies"):
        ov.build_grid(centered, {"verified_dirs": ["R"] * 9}, name="n", label="l", min_recovery=10)


# --- training and step selection ---------------------------------------------------------------------------------

def test_train_command_is_the_usual_recipe_with_more_steps(tmp_path):
    c = cfg(tmp_path)
    cmd = ov.train_cmd(c, Path("grid.json"))
    assert cmd[:3] == [str(c.lerobot_py), "-m", "lerobot_tools.experiments"]
    assert cmd[cmd.index("--steps") + 1] == "60000" and cmd[cmd.index("--save-freq") + 1] == "5000"
    assert "--batch-size" not in cmd  # the default 8, as in every earlier run


def test_find_train_run_takes_the_newest_finished_run(tmp_path):
    exp = tmp_path / "experiments"
    for run, done in (("recovery_run2_20261018_200000", True), ("recovery_run2_20261018_230000", False),
                      ("recovery_run2_20261018_210000", True), ("other_20261019_000000", True)):
        ck = exp / run / "train" / "recovery_10x10" / "checkpoints" / ("060000" if done else "030000")
        (ck / "pretrained_model").mkdir(parents=True)
    got = ov.find_train_run(exp, "recovery_run2", "recovery_10x10", 60000)
    assert got.name == "recovery_run2_20261018_210000"
    assert ov.find_train_run(exp, "nothing", "recovery_10x10", 60000) is None


def test_step_selection_takes_the_most_successes_and_ties_go_to_more_steps():
    assert ov.pick_step({30000: (14, 30), 40000: (17, 30), 50000: (16, 30), 60000: (12, 30)}) == 40000
    assert ov.pick_step({30000: (15, 30), 40000: (17, 30), 50000: (17, 30), 60000: (12, 30)}) == 50000
    with pytest.raises(ValueError):
        ov.pick_step({30000: (15, 30), 40000: (17, 29)})  # every candidate must have the same n


def test_the_final_eval_refuses_a_second_checkpoint(tmp_path):
    p = tmp_path / "final.json"
    ov.guard_final(p, "ckA")  # nothing yet: fine
    write_results(p, {5020: True}, checkpoint="ckA")
    ov.guard_final(p, "ckA")  # the same checkpoint may finish crashed seeds
    with pytest.raises(RuntimeError, match="once"):
        ov.guard_final(p, "ckB")


# --- the pre-registered summary ----------------------------------------------------------------------------------

def test_summary_applies_the_pre_registered_rules():
    s = ov.summarize(30, 40, chosen_step=50000)
    assert s["vs"]["centered_10x10"]["baseline"] == [20, 40] and s["vs"]["raw_multiply_10_30k"]["baseline"] == [17, 40]
    assert s["vs"]["centered_10x10"]["p"] == pytest.approx(0.0368, abs=1e-3)
    assert s["vs"]["centered_10x10"]["verdict"] == "improved"
    assert s["vs"]["raw_multiply_10_30k"]["verdict"] == "improved"
    s = ov.summarize(27, 40, chosen_step=50000)
    assert s["vs"]["centered_10x10"]["verdict"] == "no detectable difference"
    assert s["vs"]["raw_multiply_10_30k"]["verdict"] == "improved"
    assert ov.summarize(18, 40, chosen_step=1)["vs"]["centered_10x10"]["verdict"] == "no improvement"
    lo, hi = s["wilson_95"]
    assert 0 < lo < 27 / 40 < hi < 1
    assert "27/40" in ov.summary_markdown(s)


# --- the phase runner ----------------------------------------------------------------------------------------------

def test_phases_run_in_order_skip_done_ones_and_stop_at_a_failure(tmp_path):
    done, ran = {"a": True, "b": False, "c": False, "d": False}, []

    def phase(name, ok=True):
        def run():
            ran.append(name)
            done[name] = ok
        return ov.Phase(name, lambda: done[name], run)

    log = []
    with pytest.raises(ov.PhaseFailed, match="c"):
        ov.run_phases([phase("a"), phase("b"), phase("c", ok=False), phase("d")], log=log.append)
    assert ran == ["b", "c"] and any("skip a" in m for m in log)


def test_the_plan_lists_every_phase_with_the_final_test_last(tmp_path):
    names = [p.name for p in ov.plan(cfg(tmp_path), log=lambda m: None)]
    assert names == ["preflight", "collect", "states", "recovery", "grid", "train", "select", "final", "summary"]
    smoke = [p.name for p in ov.plan(cfg(tmp_path, smoke=True), log=lambda m: None)]
    assert "final" not in smoke and "summary" not in smoke


def test_smoke_config_is_tiny_and_never_touches_the_test_seeds(tmp_path):
    c = cfg(tmp_path, smoke=True)
    assert c.collect_n <= 3 and c.select_n <= 3 and c.steps <= 500 and c.run_id.endswith("_smoke")
    assert c.candidates == (c.steps // 2, c.steps)


# --- the one command (sim_eval/scripts/overnight_recovery.py) -----------------------------------------------------

def _load_script():
    import importlib.util

    path = Path(ov.__file__).parent / "scripts" / "overnight_recovery.py"
    spec = importlib.util.spec_from_file_location("overnight_recovery", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FakeLock:
    events: list = []

    def __init__(self, **kw):
        self.kw = kw

    def __enter__(self):
        FakeLock.events.append(("lock", self.kw["task"]))
        return self

    def __exit__(self, *exc):
        FakeLock.events.append(("unlock",))


class FakeAwake:
    def __enter__(self):
        FakeLock.events.append(("awake",))

    def __exit__(self, *exc):
        FakeLock.events.append(("sleep ok",))


def _patched(monkeypatch, tmp_path, phases):
    mod = _load_script()
    FakeLock.events = []
    monkeypatch.setattr(mod, "GpuLock", FakeLock)
    monkeypatch.setattr(mod, "KeepAwake", FakeAwake)
    original = ov.Config.default  # mod.Config is ov.Config: keep the real one before patching
    monkeypatch.setattr(mod.Config, "default", classmethod(lambda cls, repo, smoke=False: original(
        tmp_path / "repo", smoke=smoke)))
    monkeypatch.setattr(mod, "plan", lambda cfg, log: phases)
    return mod


def test_the_command_holds_the_lock_and_keepawake_around_every_phase(monkeypatch, tmp_path):
    ran = []
    phases = [ov.Phase("a", lambda: "a" in ran, lambda: (ran.append("a"), FakeLock.events.append(("phase a",))))]
    mod = _patched(monkeypatch, tmp_path, phases)
    assert mod.main([]) == 0
    assert FakeLock.events == [("lock", "recovery_run2"), ("awake",), ("phase a",), ("sleep ok",), ("unlock",)]
    status = json.loads((ov.Config.default(tmp_path / "repo").evals_dir / "overnight_status.json").read_text())
    assert status["status"] == "done" and "finished" in status


def test_a_failing_phase_releases_the_lock_and_records_the_failure(monkeypatch, tmp_path):
    def boom():
        raise RuntimeError("CUDA error: unknown error")

    mod = _patched(monkeypatch, tmp_path, [ov.Phase("train", lambda: False, boom)])
    assert mod.main([]) == 1
    assert FakeLock.events[-1] == ("unlock",)
    evals = ov.Config.default(tmp_path / "repo").evals_dir
    status = json.loads((evals / "overnight_status.json").read_text())
    assert status["status"] == "failed" and "CUDA" in status["error"]
    assert "FAILED" in (evals / "overnight.log").read_text(encoding="utf-8")


def test_dry_run_takes_no_lock(monkeypatch, tmp_path, capsys):
    mod = _patched(monkeypatch, tmp_path, [ov.Phase("a", lambda: True, lambda: None, "x")])
    assert mod.main(["--dry-run"]) == 0
    assert FakeLock.events == [] and "a" in capsys.readouterr().out
