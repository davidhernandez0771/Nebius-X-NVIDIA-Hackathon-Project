"""SANT's closed loop (src/demo_pipeline/loop.py, scripts/sant_loop.py): diagnose -> freeze the recipe -> recipe arm
and uniform control arm -> eval both on the same fresh seeds -> one-sided Fisher. No GPU here: every child process is
a fake runner that writes the files the real scripts write."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from demo_pipeline import loop as L

RECIPE = {
    "summary": "drops with the cube on the left and the bin on the right",
    "hypotheses": [], "mechanism": [], "fixes": [],
    "regions": [{"name": "left_cube_right_bin", "targets": ["dropped"], "cube_x": [0.4, 0.6], "cube_y": [0.067, 0.2],
                 "cube_yaw_deg": [-45.0, 45.0], "bin_x": [0.4, 0.65], "bin_y": [-0.3, -0.1], "share": 0.4,
                 "rationale": "r"}],
    "uniform_share": 0.6,
}


def write_eval(path: Path, seeds=range(5500, 5510)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps({"header": {"run": "x"}})]
    lines += [json.dumps({"episode": {"seed": s, "success": s % 2 == 0, "ended_by": "timeout", "reasons": []}})
              for s in seeds]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _arg(cmd: list[str], flag: str) -> str:
    return cmd[cmd.index(flag) + 1]


class FakeRunner:
    """Writes what analyze_failures.py and run_human_demo_experiment.py write, records every command."""

    def __init__(self, recipe_k: int = 30, control_k: int = 18, n: int = 40, fail: str | None = None):
        self.calls: list[list[str]] = []
        self.envs: list[dict | None] = []
        self.k = {"recipe": recipe_k, "control": control_k}
        self.n, self.fail = n, fail

    def __call__(self, cmd: list[str], log_path: Path, env: dict | None = None) -> int:
        self.calls.append(list(cmd))
        self.envs.append(env)
        script = Path(cmd[1]).name
        if self.fail and self.fail in " ".join(cmd):
            return 2
        if script == "analyze_failures.py":
            out = Path(_arg(cmd, "--out"))
            out.mkdir(parents=True, exist_ok=True)
            (out / "recipe_nemotron.json").write_text(json.dumps(RECIPE), encoding="utf-8")
            (out / "recipe_rules.json").write_text(json.dumps(RECIPE), encoding="utf-8")
            (out / "report.md").write_text("# report\n", encoding="utf-8")
            return 0
        assert script == "run_human_demo_experiment.py"
        name, data = _arg(cmd, "--name"), Path(_arg(cmd, "--data-dir"))
        root = data / "human_exp" / name
        until = _arg(cmd, "--until")
        seed0, n = int(_arg(cmd, "--eval-seed0")), int(_arg(cmd, "--eval-n"))
        (root / "stages").mkdir(parents=True, exist_ok=True)
        (root / "config.json").write_text(json.dumps({"name": name, "eval_seed0": seed0, "eval_n": n}))
        if until == "train":
            (root / "stages" / "train.json").write_text(json.dumps({"ok": True, "run_id": f"run_{name}"}))
        elif until == "results":
            arm = "recipe" if name.endswith("_recipe") else "control"
            k = self.k[arm]
            (root / "results.json").write_text(json.dumps({"sample": False, "experiment": {"name": name, "headline": {
                "multiplied": {"seed0": seed0, "n_registered": n, "n": self.n, "successes": k, "complete": True,
                               "missing_seeds": []}}}}))
        return 0


@pytest.fixture
def root(tmp_path) -> Path:
    (tmp_path / "data").mkdir()
    return tmp_path


def default_eval(root: Path) -> Path:
    path = root / "evals" / "sel.episodes.jsonl"
    return path if path.is_file() else write_eval(path)


def config(root: Path, **kw) -> L.LoopConfig:
    base = dict(name="loop1", root=root, data_dir=root / "data", evals=(default_eval(root),),
                eval_seed0=5680, eval_n=40, tag="human_2026102[01]*", input="mouse", min_demos=5, python="PY")
    base.update(kw)
    return L.LoopConfig(**base)


def make(root, runner=None, **kw) -> tuple[L.Loop, list[str]]:
    lines: list[str] = []
    return L.Loop(config(root, **kw), runner=runner or FakeRunner(), log=lines.append), lines


# ------------------------------------------------------------------ dry run: the exact commands


def test_dry_run_prints_every_command_and_runs_nothing(root):
    runner = FakeRunner()
    loop, lines = make(root, runner)
    assert loop.run(dry_run=True) == 0
    assert runner.calls == []
    assert not (root / "data" / "loops" / "loop1" / "loop.json").exists()
    text = "\n".join(lines)
    for stage in L.STAGES:
        assert stage in text
    assert "analyze_failures.py" in text and "run_human_demo_experiment.py" in text


def test_arms_pass_fresh_seeds_and_differ_only_in_the_recipe(root):
    loop, _ = make(root)
    plan = {p.stage: p.command for p in loop.plan()}
    rec, ctl = plan["train_recipe"], plan["train_control"]
    for cmd in (rec, ctl, plan["eval_recipe"], plan["eval_control"]):
        assert _arg(cmd, "--eval-seed0") == "5680" and _arg(cmd, "--eval-n") == "40"
        assert "--multiplied-only" in cmd and "--no-nemotron" in cmd
    assert "--scene-recipe" in rec and "--scene-recipe" not in ctl
    assert _arg(rec, "--scene-recipe") == str(root / "data" / "loops" / "loop1" / "recipe.json")

    def strip(cmd):  # everything but the arm's name and its recipe
        out, skip = [], 0
        for i, a in enumerate(cmd):
            if skip:
                skip -= 1
                continue
            if a in ("--scene-recipe", "--name"):
                skip = 1
                continue
            out.append(a)
        return out

    assert strip(rec) == strip(ctl)
    assert _arg(rec, "--name") == "loop1_recipe" and _arg(ctl, "--name") == "loop1_control"
    assert _arg(rec, "--until") == "train" and _arg(plan["eval_recipe"], "--until") == "results"
    assert strip(plan["eval_recipe"]) == strip(plan["eval_control"])


def test_diagnose_command_reuses_the_analyst_script(root):
    loop, _ = make(root, results_only=True, post_hoc=True, k=2)
    cmd = {p.stage: p.command for p in loop.plan()}["diagnose"]
    assert cmd[0] == "PY" and Path(cmd[1]).name == "analyze_failures.py"
    assert "--results-only" in cmd and _arg(cmd, "--protect") == "none" and _arg(cmd, "--k") == "2"
    assert _arg(cmd, "--out") == str(root / "data" / "loops" / "loop1" / "diagnose")


def test_a_given_recipe_skips_the_model(root):
    recipe = root / "my_recipe.json"
    recipe.write_text(json.dumps(RECIPE))
    loop, _ = make(root, evals=(), recipe=recipe)
    assert {p.stage: p.command for p in loop.plan()}["diagnose"] is None


# ------------------------------------------------------------------ the seed guard


@pytest.mark.parametrize("seed0", [5020, 5040, 5400, 5420, 5500, 5300, 5210, 5230, 5600, 4990])
def test_spent_or_training_seeds_are_refused(root, seed0):
    with pytest.raises(L.Refused, match="seed"):
        make(root, eval_seed0=seed0)


def test_seeds_overlapping_the_diagnosed_eval_are_refused(root):
    ev = write_eval(root / "evals" / "fresh.episodes.jsonl", seeds=range(5700, 5710))
    with pytest.raises(L.Refused, match="diagnos"):
        make(root, evals=(ev,), eval_seed0=5690, eval_n=40)


def test_seeds_another_experiment_froze_are_refused(root):
    other = root / "data" / "human_exp" / "mouse_uniform_20261026"
    other.mkdir(parents=True)
    (other / "config.json").write_text(json.dumps({"eval_seed0": 5640, "eval_n": 40}))
    with pytest.raises(L.Refused, match="mouse_uniform_20261026"):
        make(root, eval_seed0=5660, eval_n=40)
    make(root, eval_seed0=5680, eval_n=40)  # just past it is fine


# ------------------------------------------------------------------ names and paths


@pytest.mark.parametrize("name", ["", "Loop", "a b", "../x", "x;rm -rf", "a" * 60, "x\n"])
def test_unsafe_names_are_refused(root, name):
    with pytest.raises(L.Refused):
        make(root, name=name)


@pytest.mark.parametrize("tag", ["a;b", "$(x)", "a b", "`x`"])
def test_unsafe_tags_are_refused(root, tag):
    with pytest.raises(L.Refused):
        make(root, tag=tag)


def test_paths_outside_the_root_are_refused(root, tmp_path_factory):
    outside = write_eval(tmp_path_factory.mktemp("elsewhere") / "e.episodes.jsonl")
    with pytest.raises(L.Refused, match="outside"):
        make(root, evals=(outside,))


# ------------------------------------------------------------------ the full loop, resume, hashes


def test_fake_end_to_end_writes_the_comparison(root):
    runner = FakeRunner(recipe_k=30, control_k=18)
    loop, _ = make(root, runner)
    assert loop.run() == 0
    folder = root / "data" / "loops" / "loop1"
    state = json.loads((folder / "loop.json").read_text())
    assert [state["stages"][s]["status"] for s in L.STAGES] == ["done"] * len(L.STAGES)
    for s in L.STAGES:
        st = state["stages"][s]
        assert st["started"] and st["ended"] and st["inputs_hash"]
    res = state["result"]
    assert res["recipe"]["successes"] == 30 and res["control"]["successes"] == 18
    assert res["test"] == "fisher_exact_two_sided"
    assert res["p_two_sided"] <= 0.05 and res["decision"] == "recipe_better"
    assert 0 < res["recipe"]["ci"][0] < res["recipe"]["ci"][1] < 1
    assert (folder / "report.md").read_text().count("30/40") >= 1
    # the recipe was frozen before any arm trained
    prereg = (folder / "preregistration.md").read_text()
    assert "5680" in prereg and "5719" in prereg and "two-sided" in prereg
    assert state["stages"]["freeze"]["ended"] <= state["stages"]["train_recipe"]["started"]
    assert json.loads((folder / "freeze.json").read_text())["recipe_sha256"] in prereg


def test_no_difference_is_reported_as_such(root):
    loop, _ = make(root, FakeRunner(recipe_k=20, control_k=19))
    assert loop.run() == 0
    res = json.loads((root / "data" / "loops" / "loop1" / "loop.json").read_text())["result"]
    assert res["decision"] == "no_difference_shown" and res["p_two_sided"] > 0.05


def test_resume_skips_done_stages(root):
    runner = FakeRunner()
    loop, _ = make(root, runner)
    loop.run()
    n = len(runner.calls)
    loop2, lines = make(root, runner)
    assert loop2.run() == 0
    assert len(runner.calls) == n
    assert any("skip" in line for line in lines)


def test_a_failed_stage_stops_and_a_rerun_resumes_from_it(root):
    runner = FakeRunner(fail="loop1_control --")
    loop, _ = make(root, runner)
    assert loop.run() == 2
    state = json.loads((root / "data" / "loops" / "loop1" / "loop.json").read_text())
    assert state["stages"]["train_recipe"]["status"] == "done"
    assert state["stages"]["train_control"]["status"] == "failed"
    assert state["stages"]["train_control"]["exit"] == 2
    runner.fail = None
    before = len(runner.calls)
    loop2, _ = make(root, runner)
    assert loop2.run() == 0
    names = [_arg(c, "--name") for c in runner.calls[before:]]
    assert names[0] == "loop1_control"  # train_recipe was not re-run


def test_changed_eval_input_reruns_diagnose(root):
    runner = FakeRunner()
    loop, _ = make(root, runner)
    loop.run(stage="diagnose")
    loop.run(stage="diagnose")
    assert len(runner.calls) == 1
    write_eval(root / "evals" / "sel.episodes.jsonl", seeds=range(5500, 5512))
    loop2, _ = make(root, runner)
    loop2.run(stage="diagnose")
    assert len(runner.calls) == 2


def test_a_changed_recipe_after_training_is_refused(root):
    recipe = root / "my_recipe.json"
    recipe.write_text(json.dumps(RECIPE))
    loop, _ = make(root, evals=(), recipe=recipe)
    assert loop.run() == 0
    changed = dict(RECIPE, summary="something else")
    recipe.write_text(json.dumps(changed))
    loop2, lines = make(root, evals=(), recipe=recipe)
    assert loop2.run() == 1
    assert any("new --name" in line for line in lines)


def test_one_stage_needs_its_inputs(root):
    loop, lines = make(root)
    assert loop.run(stage="train_recipe") == 1
    assert any("needs diagnose, freeze first" in line for line in lines)


def test_a_recipe_that_changes_nothing_is_refused_at_freeze(root):
    recipe = root / "noop.json"
    recipe.write_text(json.dumps(dict(RECIPE, regions=[], uniform_share=1.0)))
    loop, lines = make(root, evals=(), recipe=recipe)
    assert loop.run() == 1
    assert any("changes nothing" in line for line in lines)


def test_the_env_file_reaches_only_the_diagnose_child_and_is_never_logged(root):
    env = root / "secrets.env"
    env.write_text("NEBIUS_API_KEY=sk-test-SECRET123\n")
    runner = FakeRunner()
    loop, lines = make(root, runner, env_file=env)
    loop.run()
    assert runner.envs[0] is not None and runner.envs[0]["NEBIUS_API_KEY"] == "sk-test-SECRET123"
    assert all(e is None for e in runner.envs[1:])
    folder = root / "data" / "loops" / "loop1"
    blob = "\n".join(lines) + (folder / "loop.json").read_text() + (folder / "report.md").read_text()
    assert "SECRET123" not in blob


def test_cli_dry_run(root, capsys):
    from scripts import sant_loop

    ev = root / "evals" / "sel.episodes.jsonl"
    write_eval(ev)
    rc = sant_loop.main(["--name", "cli1", "--root", str(root), "--data-dir", str(root / "data"), "--eval", str(ev),
                         "--tag", "human_2026*", "--input", "mouse", "--eval-seed0", "5680", "--eval-n", "40",
                         "--dry-run"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "--eval-seed0 5680" in out and "--scene-recipe" in out


def test_cli_refuses_a_spent_seed(root, capsys):
    from scripts import sant_loop

    ev = write_eval(root / "evals" / "sel.episodes.jsonl")
    rc = sant_loop.main(["--name", "cli1", "--root", str(root), "--data-dir", str(root / "data"), "--eval", str(ev),
                         "--tag", "human_2026*", "--eval-seed0", "5020", "--dry-run"])
    assert rc == 1


def test_a_one_sided_win_alone_is_not_enough(root):
    # 21/40 vs 12/40: one-sided Fisher p < 0.05, two-sided p > 0.05 -> the pre-registered two-sided rule says no
    loop, _ = make(root, FakeRunner(recipe_k=21, control_k=12))
    assert loop.run() == 0
    res = json.loads((root / "data" / "loops" / "loop1" / "loop.json").read_text())["result"]
    assert res["p_one_sided"] <= 0.05 < res["p_two_sided"] and res["decision"] == "no_difference_shown"
