"""app.pipeline.runs: the site's pipeline runs, one at a time in a queue, wrapping the experiment runner; cancel at a
stage boundary, resume, export at the end. The runner process is faked."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.pipeline.recipe import Recipe
from app.pipeline.runs import RunManager


class FakeProc:
    def __init__(self, pid: int):
        self.pid, self.returncode = pid, None

    def poll(self):
        return self.returncode


class FakeLaunch:
    def __init__(self):
        self.calls: list[dict] = []
        self.procs: list[FakeProc] = []

    def __call__(self, cmd, log_path, env):
        p = FakeProc(1000 + len(self.procs))
        self.calls.append({"cmd": cmd, "log": log_path, "env": env})
        self.procs.append(p)
        return p


def _log(data: Path, run_id: str, *lines: str) -> None:
    path = data / "human_exp" / run_id / "run.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for line in lines:
            f.write(f"[human-exp 21:00:00] {line}\n")


@pytest.fixture
def env(tmp_path):
    launch = FakeLaunch()
    exported = []

    def export(run, data, out):
        exported.append(run["id"])
        (out / "report.md").parent.mkdir(parents=True, exist_ok=True)
        (out / "report.md").write_text("r", encoding="utf-8")
        return [{"name": "report.md", "kind": "report", "bytes": 1, "sha256": "x", "url": f"/pipeline/runs/{run['id']}/artifacts/report.md"}]

    clock = {"t": 1000.0}
    alive: set[int] = set()
    m = RunManager(tmp_path, launch=launch, export=export, now=lambda: clock["t"], count_demos=lambda r: 3,
                   pid_alive=lambda pid: pid in alive, lock_text=lambda: None)
    return m, launch, exported, clock, alive, tmp_path


def test_runs_queue_and_only_one_runs_at_a_time(env):
    m, launch, _, _, _, data = env
    a = m.create(Recipe(tag="human_*"), name="first")
    b = m.create(Recipe(ids=["human_x"]))
    assert a["status"] == b["status"] == "queued" and a["n_demos"] == 3
    assert (data / "pipeline" / "runs" / a["id"] / "run.json").is_file()
    m.tick()
    assert len(launch.calls) == 1 and m.get(a["id"])["status"] == "running"
    cmd = launch.calls[0]["cmd"]
    assert cmd[1].endswith("run_human_demo_experiment.py") and cmd[cmd.index("--name") + 1] == a["id"]
    assert cmd[cmd.index("--tag") + 1] == "human_*" and launch.calls[0]["env"]["DATA_DIR"] == str(data)
    assert m.position(b["id"]) == 1 and m.position(a["id"]) is None
    m.tick()
    assert len(launch.calls) == 1  # still one


def test_a_finished_run_is_exported_and_the_next_one_starts(env):
    m, launch, exported, clock, _, data = env
    a = m.create(Recipe(tag="human_*"))
    b = m.create(Recipe(tag="human_*"))
    m.tick()
    _log(data, a["id"], "results: ...", "done through 'results'")
    launch.procs[0].returncode = 0
    clock["t"] = 5000.0
    m.tick()
    run = m.get(a["id"])
    assert run["status"] == "done" and exported == [a["id"]] and run["finished_at"] == 5000.0
    assert run["export"]["status"] == "done" and run["export"]["artifacts"][0]["name"] == "report.md"
    assert m.get(b["id"])["status"] == "running" and len(launch.calls) == 2
    snap = m.snapshot(a["id"])
    assert snap["status"] == "done" and snap["artifacts"][0]["name"] == "report.md"


def test_a_dry_run_selects_and_stops_with_its_plan_no_export(env):
    m, launch, exported, _, _, data = env
    a = m.create(Recipe(tag="human_*", dry_run=True))
    m.tick()
    assert launch.calls[0]["cmd"][launch.calls[0]["cmd"].index("--until") + 1] == "select"
    _log(data, a["id"], "select: 3 demos: a, b, c", "done through 'select'")
    launch.procs[0].returncode = 0
    m.tick()
    run = m.get(a["id"])
    assert run["status"] == "done" and exported == [] and run["detail"].startswith("dry run: 3 demos")


def test_cancel_a_queued_run_or_a_running_one_at_its_next_stage_then_resume(env):
    m, launch, _, _, _, data = env
    a = m.create(Recipe(tag="human_*"))
    b = m.create(Recipe(tag="human_*"))
    assert m.cancel(b["id"])["status"] == "cancelled"  # never started
    m.tick()
    m.cancel(a["id"])
    assert m.get(a["id"])["status"] == "cancelling"
    stop = data / "human_exp" / a["id"] / "STOP"
    assert stop.is_file()
    _log(data, a["id"], "stop requested: stopping before train", "STOPPED: stop requested before train; ...")
    launch.procs[0].returncode = 2
    m.tick()
    run = m.get(a["id"])
    assert run["status"] == "cancelled" and run["resumable"] is True and len(launch.calls) == 1  # b stays cancelled
    m.resume(a["id"])
    assert not stop.exists() and m.get(a["id"])["status"] == "queued"
    m.tick()
    assert len(launch.calls) == 2 and launch.calls[1]["cmd"] == launch.calls[0]["cmd"]  # same args: resumes


def test_refused_and_stopped_runs_say_why(env):
    m, launch, _, _, _, data = env
    a = m.create(Recipe(tag="nothing*"))
    m.tick()
    _log(data, a["id"], "REFUSED: no human demo in C:\\data matches 'nothing*'")
    launch.procs[0].returncode = 1
    m.tick()
    run = m.get(a["id"])
    assert run["status"] == "refused" and "no human demo" in run["detail"] and run["resumable"] is False
    b = m.create(Recipe(tag="human_*"))
    m.tick()
    _log(data, b["id"], "STOPPED: multiply: the sim worker failed (unavailable); re-run to resume")
    launch.procs[1].returncode = 2
    m.tick()
    run = m.get(b["id"])
    assert run["status"] == "failed" and run["resumable"] is True and "sim worker failed" in run["detail"]


def test_a_backend_restart_keeps_a_live_runner_and_marks_a_dead_one_interrupted(env):
    m, launch, _, clock, alive, data = env
    a = m.create(Recipe(tag="human_*"))
    m.tick()
    alive.add(launch.procs[0].pid)
    again = RunManager(data, launch=launch, export=lambda r, d, o: [], now=lambda: clock["t"], count_demos=lambda r: 3,
                       pid_alive=lambda pid: pid in alive, lock_text=lambda: None)
    assert again.get(a["id"])["status"] == "running"  # adopted: never a second runner for it
    again.tick()
    assert len(launch.calls) == 1
    alive.clear()
    again.tick()  # it died with no result line: interrupted, resumable
    run = again.get(a["id"])
    assert run["status"] == "interrupted" and run["resumable"] is True


def test_stage_times_are_recorded_as_stages_start_and_finish(env):
    m, launch, _, clock, _, data = env
    a = m.create(Recipe(tag="human_*"))
    m.tick()
    root = data / "human_exp" / a["id"]
    (root / "store").mkdir(parents=True)
    (root / "config.json").write_text(json.dumps({"ids": ["h1", "h2", "h3"], "variants": 10}), encoding="utf-8")
    clock["t"] = 1010.0
    m.tick()
    assert m.get(a["id"])["stage_times"]["check"][0] == 1010.0
    (root / "stages" / "physics").mkdir(parents=True)
    for i in (1, 2, 3):
        (root / "stages" / "physics" / f"h{i}.json").write_text("{}", encoding="utf-8")
    clock["t"] = 1080.0
    m.tick()
    times = m.get(a["id"])["stage_times"]
    assert times["check"] == [1010.0, 1080.0] and times["repair"][0] == 1080.0


def test_a_selection_that_matches_nothing_is_refused_before_it_queues(tmp_path):
    def none(r):
        raise ValueError("no human demo matches 'x*'")

    m = RunManager(tmp_path, launch=FakeLaunch(), export=lambda r, d, o: [], count_demos=none, lock_text=lambda: None)
    with pytest.raises(ValueError, match="no human demo"):
        m.create(Recipe(tag="x*"))
    assert m.list() == []
