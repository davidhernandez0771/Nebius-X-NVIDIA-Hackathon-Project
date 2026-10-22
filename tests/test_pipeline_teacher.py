"""The "teacher" recipe in the pipeline API: its recipe and runner arguments, the run manager (its runner, folder, cancel
and result), its snapshot (five stages, per-item progress, the student's curve, the gate's verdicts), its downloads,
the routes, and the times it learns. The runner's children are faked (tests/test_pipeline_teacher_runner.py)."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.pipeline.export import build_teacher_artifacts
from app.pipeline.recipe import Recipe, TeacherRecipe, parse_recipe, teacher_args
from app.pipeline.runs import TEACHER_RUNNER, RunManager
from app.pipeline.teacher_progress import teacher_snapshot
from app.pipeline.teacher_runner import TeacherConfig, TeacherDeps, TeacherRun
from app.pipeline.timings import DEFAULTS, Timings, learn
from app.routers import pipeline

from test_pipeline_teacher_runner import FakeChildren, _human, _repo, _w


class Proc:
    def __init__(self):
        self.pid, self.returncode = 4343, None

    def poll(self):
        return self.returncode


def _manager(tmp: Path, monkeypatch, launched: list) -> RunManager:
    _human(tmp)
    repo = _repo(tmp)
    monkeypatch.setenv("SANT_TEACHER_REPO", str(repo))

    def launch(cmd, log, env):
        launched.append(cmd)
        return Proc()

    def export(run, data, out):
        out.mkdir(parents=True, exist_ok=True)
        return []

    return RunManager(tmp, launch=launch, export=export, count_demos=lambda r: 3, lock_text=lambda: None,
                      pid_alive=lambda pid: False)


def _finished(tmp: Path, run_id: str, **kw) -> TeacherRun:
    """A teacher run carried out by the fake children, as the runner would leave it."""
    repo = _repo(tmp)
    _human(tmp)
    cfg = TeacherConfig(name=run_id, data=tmp, repo=repo, human_run="mouse20261020", rl_iterations=150, **kw)
    t = TeacherRun(cfg, TeacherDeps(run=FakeChildren(repo), gpu_lock=lambda task: _null(), log=lambda m: None))
    t.run()
    return t


class _null:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_the_teacher_recipe_and_its_runner_arguments():
    r = parse_recipe({"kind": "teacher", "human_run": "mouse20261020", "teacher_n": 600, "dagger": True, "preset": "smoke"})
    assert isinstance(r, TeacherRecipe) and r.iterations == 20 and r.smoke
    args = teacher_args(r, "pl_x")
    assert args[:4] == ["--name", "pl_x", "--human-run", "mouse20261020"]
    assert args[args.index("--teacher-n") + 1] == "600" and "--dagger" in args and "--smoke" in args
    assert args[args.index("--until") + 1] == "results"
    full = parse_recipe({"kind": "teacher", "human_run": "m1", "dry_run": True})
    assert full.iterations == 1500 and full.teacher_n == 300 and teacher_args(full, "x")[-2:] == ["--until", "plan"]
    assert isinstance(parse_recipe({"demos": ["a"]}), Recipe)  # no kind: the demos recipe, as before
    for bad in ({"kind": "teacher", "human_run": "m1", "teacher_n": 450}, {"kind": "teacher", "human_run": "../x"},
                {"kind": "teacher", "human_run": "m1", "variants": 3}, {"kind": "teacher"}):
        with pytest.raises(ValidationError):
            parse_recipe(bad)


def test_the_manager_runs_the_teacher_runner_in_its_own_folder(tmp_path, monkeypatch):
    launched: list = []
    m = _manager(tmp_path, monkeypatch, launched)
    with pytest.raises(ValueError, match="no human run 'nope'"):
        m.create(TeacherRecipe(kind="teacher", human_run="nope"))
    run = m.create(TeacherRecipe(kind="teacher", human_run="mouse20261020", teacher_n=600))
    assert run["kind"] == "teacher" and run["recipe"]["rl_iterations"] == 1500
    m.tick()
    assert Path(launched[0][1]) == TEACHER_RUNNER and "--teacher-n" in launched[0]
    root = tmp_path / "teacher" / run["id"]
    assert m.exp_root(run["id"]) == root
    m.cancel(run["id"])
    assert (root / "STOP").is_file()  # the teacher runner's own STOP file
    _w(root / "run.log", "[teacher 09:00:00] STOPPED: stop requested before gate_eval; delete ...\n")
    m._procs[run["id"]].returncode = 2
    m.tick()
    assert m.get(run["id"])["status"] == "cancelled" and m.get(run["id"])["resumable"]
    m.resume(run["id"])
    assert not (root / "STOP").exists()
    m.tick()
    with (root / "run.log").open("a", encoding="utf-8") as f:
        f.write("[teacher 11:00:00] done through 'results'\n")
    m._procs[run["id"]].returncode = 0
    m.tick()
    assert m.get(run["id"])["status"] == "done"


def test_a_refused_gate_is_a_refused_run(tmp_path, monkeypatch):
    launched: list = []
    m = _manager(tmp_path, monkeypatch, launched)
    run = m.create(TeacherRecipe(kind="teacher", human_run="mouse20261020"))
    m.tick()
    _w(tmp_path / "teacher" / run["id"] / "run.log",
       "[teacher 09:00:00] REFUSED: the teacher gate: 40/50 (80%) in SANT's eval env, under 90%; ...\n")
    m._procs[run["id"]].returncode = 1
    m.tick()
    got = m.get(run["id"])
    assert got["status"] == "refused" and "40/50" in got["detail"] and not got["resumable"]


def _run_record(run_id: str, status: str = "running", **recipe) -> dict:
    return {"id": run_id, "kind": "teacher", "name": run_id, "created": "2026-10-21T09:00:00+00:00", "status": status,
            "recipe": {"kind": "teacher", "human_run": "mouse20261020", "teacher_n": 300, "dagger": False,
                       "rl_iterations": 150, "smoke": False, **recipe},
            "started_at": 1000.0, "finished_at": None, "stage_times": {}, "n_demos": 0}


def test_the_snapshot_of_a_run_in_training(tmp_path, monkeypatch):
    repo = _repo(tmp_path)
    monkeypatch.setenv("SANT_TEACHER_REPO", str(repo))
    root = tmp_path / "teacher" / "pl_t"
    _w(root / "logs" / "teacher.log", "\x1b[1m Learning iteration 48/150 \x1b[0m\n...\n Learning iteration 49/150 \n")
    snap = teacher_snapshot(_run_record("pl_t"), data=tmp_path, timings=Timings(), now=1100.0, lock=None, position=None)
    assert [s["id"] for s in snap["stages"]] == ["teacher", "gate", "distill", "dagger", "export"]
    st = {s["id"]: s for s in snap["stages"]}
    assert st["teacher"]["status"] == "running" and st["teacher"]["items"] == {"done": 50, "total": 150, "unit": "iteration"}
    assert st["teacher"]["eta_s"] == pytest.approx(100 * 2.0)  # DEFAULTS rl_iter_s until it has its own pace
    assert st["dagger"]["status"] == "skipped" and st["gate"]["status"] == "pending"
    assert snap["kind"] == "teacher" and snap["teacher"]["iteration"] == 50 and snap["gpu"]["state"] == "running"
    for key in ("check", "repair", "variants", "train", "evaluate", "artifacts", "log", "remaining_s"):
        assert key in snap
    # someone else holds gpu.lock: queued on their lock
    other = teacher_snapshot(_run_record("pl_t"), data=tmp_path, timings=Timings(), now=1100.0,
                             lock="T6 999 distill:distill_mouse:r0 2026-10-21T09:00:00", position=None)
    assert other["gpu"] == {"state": "queued", "position": None, "holder": "T6 999 distill:distill_mouse:r0 2026-10-21T09:00:00"}


def test_the_snapshot_of_a_finished_run(tmp_path, monkeypatch):
    t = _finished(tmp_path, "pl_done")
    monkeypatch.setenv("SANT_TEACHER_REPO", str(t.cfg.repo))
    run = _run_record("pl_done", status="done") | {"export": {"status": "done", "artifacts": [], "done": 0, "total": 0}}
    snap = teacher_snapshot(run, data=tmp_path, timings=Timings(), now=2000.0, lock=None, position=None)
    st = {s["id"]: s for s in snap["stages"]}
    assert all(st[s]["status"] == "done" for s in ("teacher", "gate", "distill", "export"))
    assert st["gate"]["detail"] == "49/50 (gate 90%)"
    assert snap["teacher"]["gate"]["passed"] is True and snap["teacher"]["rounds"][0]["selection"]["chosen_step"] == 60000
    assert len(snap["evaluate"]["seeds"]) == 50 and snap["evaluate"]["seeds"][0]["cell"] == "teacher_gate"
    assert sum(s["success"] for s in snap["evaluate"]["seeds"]) == 49
    assert snap["train"]["cell"] == "distill_r0" and snap["train"]["loss"] == [[200, 0.512]]
    assert snap["train"]["checkpoints"] == [{"step": 60000, "name": "060000"}]
    assert snap["remaining_s"] == 0.0 and "done through 'results'" in snap["log"][-1]


def test_the_distill_round_reports_its_phase(tmp_path, monkeypatch):
    repo = _repo(tmp_path)
    monkeypatch.setenv("SANT_TEACHER_REPO", str(repo))
    root = tmp_path / "teacher" / "pl_r"
    for st in ("teacher", "gate_eval"):
        _w(root / "stages" / f"{st}.json", {"seconds": 10, "items": 1})
    _w(root / "stages" / "gate_verify.json", {"seconds": 10, "items": 50, "successes": 48, "n": 50})
    rdir = repo / "data" / "distill" / "pl_r" / "r0"
    _w(rdir / "rollouts.jsonl", "".join(json.dumps({"seed": 4000 + i, "success": i % 3 > 0, "wall_s": 25}) + "\n"
                                        for i in range(30)))
    snap = teacher_snapshot(_run_record("pl_r"), data=tmp_path, timings=Timings(), now=1100.0, lock=None, position=None)
    d = next(s for s in snap["stages"] if s["id"] == "distill")
    assert d["status"] == "running" and d["items"] == {"done": 30, "total": 300, "unit": "rollout"}
    assert d["detail"] == "teacher rollouts 30/300" and 0 < d["progress"] < 0.2
    assert snap["teacher"]["rounds"][0]["rollouts"] == {"done": 30, "total": 300, "successes": 20}
    left = 270 * DEFAULTS["rollout_s"]
    assert d["eta_s"] > left  # the rollouts left, then the grid, ACT and the selection


def test_the_teacher_downloads(tmp_path):
    t = _finished(tmp_path, "pl_exp")
    model = t.latest_model()[0]
    _w(model.parent / "params" / "agent.yaml", "seed: 1\n")
    out = tmp_path / "pipeline" / "runs" / "pl_exp" / "artifacts"
    arts = build_teacher_artifacts(_run_record("pl_exp", status="done") | {"args": ["--name", "pl_exp"]}, data=tmp_path,
                                   out=out, commit="abc1234")
    assert [(a["name"], a["kind"]) for a in arts] == [
        ("dataset_distill_r0.zip", "dataset"), ("student_checkpoint.zip", "checkpoint"),
        ("teacher_checkpoint.zip", "checkpoint"), ("results.json", "other"), ("report.md", "report"),
        ("report.html", "report"), ("provenance.json", "other")]
    with zipfile.ZipFile(out / "teacher_checkpoint.zip") as z:
        assert sorted(z.namelist()) == ["teacher/exported/policy.pt", "teacher/model_149.pt", "teacher/params/agent.yaml"]
    with zipfile.ZipFile(out / "student_checkpoint.zip") as z:
        assert z.namelist() == ["pretrained_model/model.safetensors"]
    with zipfile.ZipFile(out / "dataset_distill_r0.zip") as z:
        assert z.namelist() == ["distill_r0/meta/info.json"]
    prov = json.loads((out / "provenance.json").read_text(encoding="utf-8"))
    assert prov["kind"] == "teacher" and prov["git_commit"] == "abc1234" and prov["teacher_gate"]["successes"] == 49
    assert prov["human_grid_sha256"] and {a["name"] for a in prov["artifacts"]} >= {"teacher_checkpoint.zip"}
    report = (out / "report.md").read_text(encoding="utf-8")
    assert "teacher gate: 49/50" in report and "chose step 60000" in report
    assert json.loads((out / "artifacts.json").read_text(encoding="utf-8")) == arts


def test_the_routes_take_a_teacher_recipe(tmp_path, monkeypatch):
    launched: list = []
    m = _manager(tmp_path, monkeypatch, launched)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SANT_PIPELINE", "1")
    app = FastAPI()
    app.include_router(pipeline.router)
    app.dependency_overrides[pipeline.get_manager] = lambda: m
    client = TestClient(app)
    cfg = client.get("/pipeline/config").json()
    assert cfg["recipes"]["teacher"]["teacher_n"] == [300, 600]
    assert cfg["recipes"]["teacher"]["stages"] == ["teacher", "gate", "distill", "dagger", "export"]
    assert client.get("/pipeline/human-runs").json() == {"runs": [
        {"name": "mouse20261020", "cell": "perfected_multiply_10", "start_state": "raw_10"}]}
    est = client.post("/pipeline/estimate", json={"kind": "teacher", "human_run": "mouse20261020", "teacher_n": 600}).json()
    assert [s["id"] for s in est["stages"]] == ["teacher", "gate", "distill", "dagger", "export"]
    assert est["remaining_s"] > 1500 * DEFAULTS["rl_iter_s"]
    assert client.post("/pipeline/estimate", json={"kind": "teacher", "human_run": "nope"}).status_code == 422
    r = client.post("/pipeline/runs", json={"kind": "teacher", "human_run": "mouse20261020", "name": "teacher 300"})
    assert r.status_code == 201
    runs = client.get("/pipeline/runs").json()["runs"]
    assert runs[0]["kind"] == "teacher" and runs[0]["demos"] == 0
    snap = client.get(f"/pipeline/runs/{r.json()['id']}").json()
    assert snap["kind"] == "teacher" and snap["gpu"]["position"] == 1
    assert client.post("/pipeline/runs", json={"kind": "teacher", "human_run": "mouse20261020",
                                               "teacher_n": 450}).status_code == 422


def test_the_teacher_times_are_learned_from_the_markers_and_t6s_rows(tmp_path):
    t = _finished(tmp_path, "pl_learn")
    root = tmp_path / "teacher" / "pl_learn" / "stages"
    _w(root / "teacher.json", {"seconds": 300.0, "items": 150})
    _w(root / "gate_eval.json", {"seconds": 1000.0, "items": 50})
    rows = t.round_dir(0) / "rollouts.jsonl"
    rows.write_text("".join(json.dumps({"seed": s, "wall_s": w, "frames": 400}) + "\n" for s, w in ((1, 20), (2, 30), (3, 22))),
                    encoding="utf-8")
    got = learn(tmp_path)
    assert got.per("rl_iter_s") == pytest.approx(2.0) and got.source("rl_iter_s") == "measured: median of 1"
    assert got.per("gate_eval_s") == pytest.approx(20.0)
    assert got.per("rollout_s") == pytest.approx(22.0) and got.per("frames_per_rollout") == 400
    assert got.per("dagger_rollout_s") == DEFAULTS["dagger_rollout_s"]
