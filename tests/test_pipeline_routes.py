"""The /pipeline routes (app/routers/pipeline.py) in the shape the pipeline pages read (agreed with T2): off unless
SANT_PIPELINE=1; runs, their state, the event stream, cancel/resume, the downloads. The runner process is faked."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.pipeline.runs import RunManager
from app.routers import pipeline


class Proc:
    def __init__(self):
        self.pid, self.returncode = 4242, None

    def poll(self):
        return self.returncode


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    procs: list[Proc] = []

    def launch(cmd, log, env):
        procs.append(Proc())
        return procs[-1]

    def export(run, data, out):
        out.mkdir(parents=True, exist_ok=True)
        (out / "report.md").write_text("# report\n", encoding="utf-8")
        return [{"name": "report.md", "kind": "report", "bytes": (out / "report.md").stat().st_size, "sha256": "x",
                 "url": f"/pipeline/runs/{run['id']}/artifacts/report.md"}]

    m = RunManager(tmp_path, launch=launch, export=export, count_demos=lambda r: len(r.ids or []) or 4,
                   lock_text=lambda: None, pid_alive=lambda pid: False)
    app = FastAPI()
    app.include_router(pipeline.router)
    app.dependency_overrides[pipeline.get_manager] = lambda: m
    return TestClient(app), m, procs, tmp_path, monkeypatch


def test_starting_runs_is_off_unless_the_flag_is_set(setup):
    client, m, _, _, monkeypatch = setup
    monkeypatch.delenv("SANT_PIPELINE", raising=False)
    r = client.post("/pipeline/runs", json={"demos": ["human_a"]})
    assert r.status_code == 403 and "SANT_PIPELINE" in r.json()["detail"]
    assert client.get("/pipeline/config").json()["enabled"] is False
    assert client.get("/pipeline/runs").json() == {"runs": []}  # reading is allowed


def test_a_run_from_the_pages_body_lists_and_shows_its_state(setup):
    client, m, _, _, monkeypatch = setup
    monkeypatch.setenv("SANT_PIPELINE", "1")
    r = client.post("/pipeline/runs", json={"demos": ["human_a", "human_b"], "name": "my run", "preset": "smoke"})
    assert r.status_code == 201
    run_id = r.json()["id"]
    runs = client.get("/pipeline/runs").json()["runs"]
    assert runs == [{"id": run_id, "name": "my run", "created": runs[0]["created"], "status": "queued", "stage": None,
                     "demos": 2, "detail": None, "resumable": False}]
    snap = client.get(f"/pipeline/runs/{run_id}").json()
    assert snap["status"] == "queued" and snap["gpu"]["state"] == "queued" and snap["gpu"]["position"] == 1
    assert [s["id"] for s in snap["stages"]] == ["check", "repair", "multiply", "train", "evaluate", "export"]
    for key in ("check", "repair", "variants", "train", "evaluate", "artifacts", "elapsed_s", "remaining_s"):
        assert key in snap
    assert client.get("/pipeline/runs/nope").status_code == 404
    assert client.post("/pipeline/runs", json={"demos": ["a"], "tag": "h*"}).status_code == 422
    assert client.post("/pipeline/runs", json={"tag": "../x"}).status_code == 422


def test_cancel_resume_and_the_downloads(setup):
    client, m, procs, data, monkeypatch = setup
    monkeypatch.setenv("SANT_PIPELINE", "1")
    run_id = client.post("/pipeline/runs", json={"tag": "human_*"}).json()["id"]
    m.tick()
    assert client.post(f"/pipeline/runs/{run_id}/cancel").json()["status"] == "running"  # stopping at the next stage
    log = data / "human_exp" / run_id / "run.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text("[human-exp 21:00:00] STOPPED: stop requested before train\n", encoding="utf-8")
    procs[0].returncode = 2
    m.tick()
    snap = client.get(f"/pipeline/runs/{run_id}").json()
    assert snap["status"] == "cancelled" and snap["resumable"] is True
    assert client.post(f"/pipeline/runs/{run_id}/resume").json()["status"] == "queued"
    assert client.post(f"/pipeline/runs/{run_id}/resume").status_code == 409  # only a stopped run resumes
    m.tick()
    with log.open("a", encoding="utf-8") as f:
        f.write("[human-exp 22:00:00] done through 'results'\n")
    procs[1].returncode = 0
    m.tick()
    arts = client.get(f"/pipeline/runs/{run_id}/artifacts").json()["artifacts"]
    assert [a["name"] for a in arts] == ["report.md"]
    r = client.get(arts[0]["url"])
    body = (data / "pipeline" / "runs" / run_id / "artifacts" / "report.md").read_bytes()
    assert r.status_code == 200 and r.content == body and r.headers["content-length"] == str(len(body))
    assert "attachment" in r.headers["content-disposition"]
    assert client.get(f"/pipeline/runs/{run_id}/artifacts/provenance.json").status_code == 404  # not in its index
    assert client.get(f"/pipeline/runs/{run_id}/artifacts/..%5Crun.json").status_code == 404


def test_the_event_stream_starts_with_the_snapshot_and_ends(setup):
    client, m, procs, data, monkeypatch = setup
    monkeypatch.setenv("SANT_PIPELINE", "1")
    run_id = client.post("/pipeline/runs", json={"tag": "human_*"}).json()["id"]
    m.tick()
    (data / "human_exp" / run_id).mkdir(parents=True)
    with (data / "human_exp" / run_id / "run.log").open("w", encoding="utf-8") as f:
        f.write("[human-exp 21:00:00] select: 4 demos: a, b, c, d (replaying the achieved path)\n")
        f.write("[human-exp 21:00:05] done through 'results'\n")
    procs[0].returncode = 0
    m.tick()
    with client.stream("GET", f"/pipeline/runs/{run_id}/events?follow=false") as r:
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    assert events[0]["type"] == "snapshot" and events[0]["id"] == run_id
    assert any(e["type"] == "log" and "select: 4 demos" in e["line"] for e in events)
    assert events[-1] == {"type": "end", "status": "done", "detail": None}


def test_the_patches_between_two_snapshots(setup):
    before = {"stages": [{"id": "check", "status": "running", "progress": 0.1}], "gpu": {"state": "queued", "position": None, "holder": "T4"},
              "check": [], "repair": [], "variants": [], "train": {"step": 0, "steps": 100, "loss": [], "checkpoints": [], "eta_s": 5},
              "evaluate": {"seeds": [], "planned": 4}, "artifacts": []}
    after = {"stages": [{"id": "check", "status": "running", "progress": 0.2}], "gpu": {"state": "running", "position": None, "holder": None},
             "check": [{"demo": "a", "success": True}], "repair": [], "variants": [{"id": "v1", "seed": 1, "success": True}],
             "train": {"step": 50, "steps": 100, "loss": [[50, 0.3]], "checkpoints": [{"step": 50, "name": "000050"}], "eta_s": 2},
             "evaluate": {"seeds": [{"seed": 5020, "success": False, "reasons": [], "cell": "raw_4"}], "planned": 4},
             "artifacts": [{"name": "report.md"}]}
    patches = pipeline.patches(before, after)
    kinds = [p["type"] for p in patches]
    assert kinds == ["stage", "gpu", "check", "variant", "train", "checkpoint", "evaluate", "artifact"]
    assert patches[0] == {"type": "stage", "id": "check", "stage": "check", "status": "running", "progress": 0.2}
    assert patches[4] == {"type": "train", "step": 50, "steps": 100, "cell": None, "loss": 0.3, "loss_points": [[50, 0.3]],
                          "eta_s": 2}
    assert pipeline.patches(after, after) == []


def test_the_patches_match_the_pages_reducer():
    # T2's model (web/src/site/pipeline/model.ts, pm/pipeline-pages): a train patch's `loss` is the latest loss at
    # `step` (a number) with its `cell`; a "run" patch moves elapsed/remaining/status; "end" carries the detail.
    base = {"status": "running", "detail": None, "resumable": False, "elapsed_s": 10.0, "remaining_s": 100.0,
            "stages": [], "gpu": {}, "check": [], "repair": [], "variants": [],
            "train": {"step": 0, "steps": 100, "cell": "raw_4", "loss": [], "checkpoints": [], "eta_s": 5},
            "evaluate": {"seeds": [], "planned": 0}, "artifacts": []}
    later = {**base, "elapsed_s": 16.0, "remaining_s": 90.0,
             "train": {**base["train"], "step": 100, "loss": [[50, 0.3], [100, 0.2]], "eta_s": 0}}
    p = {x["type"]: x for x in pipeline.patches(base, later)}
    assert p["train"] == {"type": "train", "step": 100, "steps": 100, "cell": "raw_4", "loss": 0.2,
                          "loss_points": [[50, 0.3], [100, 0.2]], "eta_s": 0}
    assert p["run"] == {"type": "run", "status": "running", "detail": None, "resumable": False, "elapsed_s": 16.0,
                        "remaining_s": 90.0}
    # elapsed alone moves the run patch only every 5 s
    tick = {**base, "elapsed_s": 12.0}
    assert [x["type"] for x in pipeline.patches(base, tick)] == []


def test_a_failed_variant_keeps_an_id_and_the_snapshot_has_the_log(setup):
    client, m, procs, data, monkeypatch = setup
    monkeypatch.setenv("SANT_PIPELINE", "1")
    run_id = client.post("/pipeline/runs", json={"tag": "human_*"}).json()["id"]
    root = data / "human_exp" / run_id
    (root / "store").mkdir(parents=True)
    (root / "config.json").write_text(json.dumps({"ids": ["human_a"], "variants": 2}), encoding="utf-8")
    (root / "stages" / "multiply").mkdir(parents=True)
    (root / "stages" / "multiply" / "human_a.json").write_text(json.dumps({"source": "human_a_rules_home", "attempts": [
        {"seed": 3100, "id": "human_a_rules_home_m3100", "success": True, "reasons": []},
        {"seed": 3101, "id": None, "success": False, "reasons": ["dropped"]}]}), encoding="utf-8")
    (root / "run.log").write_text("".join(f"[human-exp 21:00:{i:02d}] line {i}\n" for i in range(50)), encoding="utf-8")
    snap = client.get(f"/pipeline/runs/{run_id}").json()
    assert [v["id"] for v in snap["variants"]] == ["human_a_rules_home_m3100", "human_a_rules_home_m3101"]
    assert len(snap["log"]) == 40 and snap["log"][-1].endswith("line 49")
