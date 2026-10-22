"""app.pipeline.progress: a run's state in the shape the pipeline pages read (T2's), from the run's own files."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.pipeline.progress import STAGES, snapshot
from app.pipeline.timings import Timings

IDS = [f"human_{i:02d}" for i in range(10)]
T = Timings({"physics_s": [20.0], "repair_s": [40.0], "align_s": [20.0], "multiply_s": [15.0], "sim_start_s": [20.0],
             "train_s_per_10k": [600.0], "eval_s": [70.0]})


def _w(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")


def _run(**kw) -> dict:
    base = {"id": "pl_x", "name": "my run", "created": "2026-10-20T21:00:00+00:00", "status": "running", "detail": None,
            "resumable": False, "recipe": {"tag": "human_*", "variants": 10, "preset": "standard", "steps": 30000,
                                           "eval_n": 40, "stop_after": "results", "multiplied_only": False,
                                           "nemotron": False, "dry_run": False},
            "n_demos": 10, "started_at": 1000.0, "finished_at": None, "stage_times": {}, "export": None}
    base.update(kw)
    return base


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    return tmp_path


def _config(data: Path, **kw) -> Path:
    root = data / "human_exp" / "pl_x"
    _w(root / "config.json", {"ids": IDS, "n_human": 10, "variants": 10, "steps": 30000, "eval_n": 40,
                              "eval_seed0": 5020, **kw})
    _w(root / "stages" / "select.json", {"ids": IDS})
    (root / "store").mkdir()  # the runner makes the experiment's store at select
    return root


def test_a_queued_run_shows_every_stage_pending_with_its_estimate(data):
    s = snapshot(_run(status="queued", started_at=None), data=data, timings=T, now=1000.0, lock=None, position=2)
    assert s["status"] == "queued" and s["gpu"] == {"state": "queued", "position": 2, "holder": None}
    assert [st["id"] for st in s["stages"]] == list(STAGES) == ["check", "repair", "multiply", "train", "evaluate", "export"]
    est = {st["id"]: st["eta_s"] for st in s["stages"]}
    assert est["check"] == pytest.approx(20 + 10 * 20)  # the worker's start, then 10 replays
    assert est["repair"] == pytest.approx(10 * (40 + 20))  # repair and align each demo
    assert est["multiply"] == pytest.approx(10 * 10 * 15)
    assert est["train"] == pytest.approx(5 + 2 * 3 * 600)  # the grid, then 2 cells x 30k steps
    assert est["evaluate"] == pytest.approx(2 * 40 * 70 + 2)
    assert s["remaining_s"] == pytest.approx(sum(est.values()))
    assert all(st["status"] == "pending" and st["progress"] == 0 for st in s["stages"])
    assert s["stages"][0]["eta_basis"].startswith("physics 20 s/demo")


def test_physics_in_progress_with_the_gpu_ours_or_someone_elses(data):
    root = _config(data)
    for i in range(3):
        _w(root / "stages" / "physics" / f"{IDS[i]}.json", {"id": IDS[i], "success": i != 1, "reasons": [] if i != 1 else ["collision"]})
    run = _run(stage_times={"check": [1000.0, None]})
    ours = snapshot(run, data=data, timings=T, now=1100.0, lock="T4 99 human-exp:pl_x:sim 2026-10-20T21:00:00", position=None)
    check = ours["stages"][0]
    assert check["status"] == "running" and check["progress"] == pytest.approx(0.3)
    assert check["detail"] == "physics 3/10" and check["items"] == {"done": 3, "total": 10, "unit": "demo"}
    assert check["elapsed_s"] == pytest.approx(100.0) and check["started"] == 1000.0
    # this run's own pace (100 s for 3) counts once it has two items
    assert check["eta_s"] == pytest.approx(7 * 100 / 3)
    assert ours["gpu"]["state"] == "running" and ours["elapsed_s"] == pytest.approx(100.0)
    other = snapshot(run, data=data, timings=T, now=1100.0, lock="T6 7 eval-trace 2026-10-20T20:00:00", position=None)
    assert other["gpu"] == {"state": "queued", "position": None, "holder": "T6 7 eval-trace 2026-10-20T20:00:00"}
    assert [r["demo"] for r in ours["check"]] == IDS[:3] and ours["check"][1]["success"] is False
    assert ours["check"][1]["reasons"] == ["collision"]


def test_training_progress_loss_and_checkpoints_come_from_its_log(data):
    root = _config(data)
    _w(root / "stages" / "sim.json", {"demos": {}})
    _w(root / "stages" / "grid.json", {"cells": {}})
    exp = data / "experiments" / "hx_pl_x_20261020_220000"
    _w(exp / "logs" / "raw_10.log", "step:30K smpl:1 ep:1 epch:1 loss:0.050\n")
    _w(exp / "logs" / "perfected_multiply_10.log",
       "noise\nstep:10K smpl:1 ep:1 epch:1 loss:0.300\nstep:18K smpl:1 ep:1 epch:1 loss:0.120\n")
    (exp / "train" / "perfected_multiply_10" / "checkpoints" / "010000").mkdir(parents=True)
    s = snapshot(_run(stage_times={"train": [5000.0, None]}), data=data, timings=T, now=6000.0, lock=None, position=None)
    train = next(st for st in s["stages"] if st["id"] == "train")
    assert train["status"] == "running" and train["detail"] == "perfected_multiply_10: step 18000/30000"
    assert train["items"] == {"done": 48000, "total": 60000, "unit": "step"}
    assert s["train"]["step"] == 18000 and s["train"]["steps"] == 30000 and s["train"]["cell"] == "perfected_multiply_10"
    assert s["train"]["loss"] == [[10000, 0.3], [18000, 0.12]]
    assert s["train"]["checkpoints"] == [{"step": 10000, "name": "010000"}]
    assert [st["status"] for st in s["stages"][:3]] == ["done", "done", "done"]


def test_eval_progress_comes_from_the_episodes_as_they_finish(data):
    root = _config(data)
    for m in ("sim", "grid"):
        _w(root / "stages" / f"{m}.json", {})
    _w(root / "stages" / "train.json", {"ok": True, "run_id": "hx_pl_x_1", "cells": {}})
    ev = data / "evals" / "hx_pl_x_1"
    _w(ev / "raw_10.episodes.jsonl", "".join(json.dumps({"seed": 5020 + i, "success": i == 2, "reasons": []}) + "\n" for i in range(4)))
    s = snapshot(_run(), data=data, timings=T, now=1000.0, lock=None, position=None)
    evaluate = next(st for st in s["stages"] if st["id"] == "evaluate")
    assert evaluate["detail"] == "seed 4/80" and evaluate["progress"] == pytest.approx(4 / 80)
    assert s["evaluate"]["planned"] == 80 and len(s["evaluate"]["seeds"]) == 4
    assert s["evaluate"]["seeds"][2] == {"seed": 5022, "success": True, "reasons": [], "cell": "raw_10"}


def test_a_finished_run_is_all_done_with_its_artifacts(data):
    root = _config(data)
    for m in ("sim", "grid", "eval"):
        _w(root / "stages" / f"{m}.json", {})
    _w(root / "stages" / "train.json", {"ok": True, "run_id": "hx_pl_x_1", "cells": {}})
    _w(root / "results.json", {"sample": False})
    arts = [{"name": "report.md", "kind": "report", "bytes": 10, "sha256": "x", "url": "/pipeline/runs/pl_x/artifacts/report.md"}]
    s = snapshot(_run(status="done", finished_at=9000.0, export={"status": "done", "artifacts": arts}), data=data,
                 timings=T, now=9999.0, lock=None, position=None)
    assert s["status"] == "done" and all(st["status"] == "done" for st in s["stages"])
    assert s["remaining_s"] == 0 and s["elapsed_s"] == pytest.approx(8000.0) and s["artifacts"] == arts
    assert s["gpu"]["state"] == "idle"


def test_a_dry_run_is_a_plan_and_a_data_only_run_skips_training(data):
    _config(data)
    dry = snapshot(_run(status="done", finished_at=1001.0, recipe={**_run()["recipe"], "dry_run": True}), data=data,
                   timings=T, now=1002.0, lock=None, position=None)
    assert all(st["status"] == "skipped" for st in dry["stages"])
    assert all(st["eta_s"] and st["eta_s"] > 0 for st in dry["stages"])  # the plan's estimate stays readable
    assert dry["plan_s"] == pytest.approx(sum(st["eta_s"] for st in dry["stages"]))
    data_only = snapshot(_run(recipe={**_run()["recipe"], "stop_after": "grid"}), data=data, timings=T, now=1000.0,
                         lock=None, position=None)
    status = {st["id"]: st["status"] for st in data_only["stages"]}
    assert status["evaluate"] == "skipped" and status["export"] == "pending"
    assert next(st for st in data_only["stages"] if st["id"] == "train")["detail"] == "grid only (no training)"


def test_a_failed_or_cancelled_run_marks_where_it_stopped(data):
    root = _config(data)
    _w(root / "stages" / "physics" / f"{IDS[0]}.json", {"id": IDS[0], "success": True, "reasons": []})
    failed = snapshot(_run(status="failed", detail="the sim worker exited"), data=data, timings=T, now=2000.0, lock=None,
                      position=None)
    assert failed["status"] == "failed" and failed["stages"][0]["status"] == "failed"
    assert failed["stages"][0]["detail"] == "physics 1/10" and failed["detail"] == "the sim worker exited"
    cancelled = snapshot(_run(status="cancelled", resumable=True), data=data, timings=T, now=2000.0, lock=None,
                         position=None)
    assert cancelled["status"] == "cancelled" and cancelled["resumable"] is True
    assert cancelled["stages"][0]["status"] == "pending"
