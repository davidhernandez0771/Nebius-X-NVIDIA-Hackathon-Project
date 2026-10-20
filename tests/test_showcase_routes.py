"""/showcase: the data showcase's read-only view of a human-demo experiment (src/app/routers/showcase.py).

A set is DATA_DIR/human_exp/<name>/ (config.json, run.log, stages/, store/); its demos' live recordings sit in the
main store, DATA_DIR/demos/.
"""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.routers import showcase
from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode, save_signals
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import Demo, Passport, Pose, Scene, SimSignals, Trajectory, VerificationResult
from demo_pipeline.store import DemoStore

DOWN = (0.0, 1.0, 0.0, 0.0)
N = 6
REST = [0.0, -0.569, 0.0, -2.810, 0.0, 3.037, 0.741, 0.04, 0.04]
T0 = datetime(2026, 10, 20, 18, 0, 0, tzinfo=timezone.utc)


def _vr(ok=True, reasons=(), force=0.0, duration=2.0, path=0.5, settle=1.0):
    return VerificationResult(success=ok, reasons=list(reasons), duration=duration, path_length=path,
                              max_contact_force=force, settle_time=settle)


def _demo(store: DemoStore, demo_id: str, *, verified: VerificationResult | None = None, frames: int = 0,
          lineage=None, seed=None):
    traj = Trajectory(t=[i * 0.02 for i in range(N)], ee_pos=[(0.5, 0.0, 0.3)] * N, ee_quat=[DOWN] * N,
                      gripper=[0, 0, 1, 1, 1, 0])
    scene = Scene(cube_pose=Pose(pos=(0.5, -0.05, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                  bin_pose=Pose(pos=(0.53, 0.27, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=0)
    store.save_demo(Demo(id=demo_id, source="human", parent_id=None, trajectory=traj, scene=scene, created_at=T0,
                         human_seconds=5.0))
    if verified is not None:
        store.save_passport(demo_id, Passport(demo_id=demo_id, lineage=lineage or [demo_id], diagnosis_source="none",
                                              robot="franka", verification=verified, variant_seed=seed,
                                              pipeline_version="test"))
    ep = store.episode_dir(demo_id)
    q = np.tile(np.asarray(REST, dtype=np.float32), (N, 1))
    save_episode(ep, EpisodeMeta(demo_id=demo_id, robot="franka", task_text=TASK_TEXT, fps=50, n_steps=N,
                                 cameras=["front"] if frames else []), {
        "joint_pos": q, "action": q, "ee_pos": np.zeros((N, 3)), "ee_quat": np.tile(DOWN, (N, 1)),
        "gripper": np.asarray(traj.gripper, dtype=np.int8)})
    save_signals(ep, SimSignals(cube_pos=np.tile([0.5, -0.05, 0.025], (N, 1)),
                                contact_gripper_cube=np.zeros(N, dtype=bool), contact_arm_bin=np.zeros(N, dtype=bool),
                                contact_arm_table=np.zeros(N, dtype=bool), max_contact_force=np.zeros(N)))
    for k in range(frames):
        p = image_path(ep, "front", k)
        p.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (8, 8), (k * 40, 0, 0)).save(p)


def _write(path: Path, body) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if isinstance(body, str) else json.dumps(body), encoding="utf-8")


LOG = """[human-exp 15:04:31] select: 2 demos: h1, h2 (replaying the achieved path)
[human-exp 15:04:40] [gpu.lock] acquired: T4 1 human-exp:s1:sim 2026-10-20T15:04:40
[human-exp 15:05:23] physics h1: verified
[human-exp 15:05:36] physics h2: failed collision,dropped
[human-exp 15:07:14] repair h1: perfected (2 repairs, 1 verification(s))
[human-exp 15:07:25] repair h2: discarded (0 repairs, 2 verification(s))
[human-exp 15:09:10] align h1: raw True, repaired True
[human-exp 15:15:31] multiply h1: 1/2 variants verified
[human-exp 15:37:05] train: C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.experiments --grid g.json
[human-exp 15:50:19] train: run hx_s1: perfected_multiply_10 loss 0.065
[human-exp 16:37:18] eval: perfected_multiply_10 3/40
[human-exp 16:37:18] done through 'results'
"""


@pytest.fixture
def root(api, monkeypatch, tmp_path):
    data = tmp_path / "data"
    monkeypatch.setenv("DATA_DIR", str(data))
    live = DemoStore(data)
    _demo(live, "h1", frames=3)
    _demo(live, "h2")
    exp = data / "human_exp" / "s1"
    _write(exp / "config.json", {"name": "s1", "ids": ["h1", "h2"], "input": "mouse", "repair": "rules", "variants": 2})
    _write(exp / "run.log", LOG)
    _write(exp / "stages" / "physics" / "h1.json", {"id": "h1", "success": True, "reasons": [], "steps": N})
    _write(exp / "stages" / "physics" / "h2.json", {"id": "h2", "success": False, "reasons": ["collision", "dropped"]})
    before = _vr(True, duration=8.34, path=1.0109, settle=1.4).model_dump()
    after = _vr(True, duration=6.92, path=1.0094, settle=0.74).model_dump()
    _write(exp / "stages" / "repair" / "h1.json", {
        "demo_id": "h1", "status": "perfected", "decision": "repair", "output_demo_id": "h1_rules",
        "diagnosis_source": "rules", "repairs": [{"t0": 0.76, "t1": 7.68, "op": "trim"},
                                                 {"t0": 4.0, "t1": 4.5, "op": "smooth", "strength": "med"}],
        "issues": [{"type": "jitter", "evidence": "jerk_rms above 20 m/s^3 over [4.00, 4.50] s", "t0": 4.0, "t1": 4.5}],
        "verification": after, "raw_verification": before})
    _write(exp / "stages" / "repair" / "h2.json", {
        "demo_id": "h2", "status": "discarded", "decision": "discard", "output_demo_id": None, "repairs": [],
        "issues": [], "verification": None,
        "raw_verification": _vr(False, ["collision", "dropped"], force=311.9).model_dump()})
    _write(exp / "stages" / "multiply" / "h1.json", {"source": "h1_rules_home", "attempts": [
        {"seed": 3100, "id": "h1_rules_home_m3100", "success": True, "reasons": []},
        {"seed": 3101, "id": None, "success": False, "reasons": ["dropped"]},
        {"seed": 3102, "id": None, "success": False, "reasons": ["not_in_bin"]}]})
    store = DemoStore(exp / "store")
    _demo(store, "h1", verified=_vr(True, duration=8.34), frames=2)
    _demo(store, "h2", verified=_vr(False, ["collision", "dropped"], force=311.9))
    _demo(store, "h1_rules", verified=_vr(True, duration=6.92), lineage=["h1", "h1_rules"])
    _demo(store, "h1_rules_home_m3100", verified=_vr(True), lineage=["h1", "h1_rules", "h1_rules_home", "h1_rules_home_m3100"], seed=3100, frames=4)
    _demo(store, "h1_rules_home_m3101", verified=_vr(False, ["dropped"]), lineage=["h1", "h1_rules", "h1_rules_home", "h1_rules_home_m3101"], seed=3101)
    _write(data / "human_exp" / "not_a_set" / "notes.txt", "no config")
    return data


def test_lists_the_sets_with_their_counts(api, root):
    sets = api.get("/showcase/sets").json()
    assert [s["name"] for s in sets] == ["s1"]
    s = sets[0]
    assert s["input"] == "mouse" and s["n_demos"] == 2
    assert s["replay_verified"] == 1 and s["repaired"] == 1
    assert s["variants_verified"] == 1 and s["variants_total"] == 3
    assert s["evals"] == [{"cell": "perfected_multiply_10", "k": 3, "n": 40}]


def test_a_set_has_every_demo_with_its_verdicts_and_what_the_repair_changed(api, root):
    body = api.get("/showcase/sets/s1").json()
    assert body["name"] == "s1" and body["input"] == "mouse"
    h1, h2 = body["demos"]
    assert h1["id"] == "h1" and h1["live"] is True and h1["live_frames"] == 3
    assert h1["replay"]["success"] is True and h1["replay"]["frames"] == 2
    assert h1["repair"]["status"] == "perfected" and h1["repair"]["output_id"] == "h1_rules"
    assert [r["op"] for r in h1["repair"]["repairs"]] == ["trim", "smooth"]
    assert h1["repair"]["before"]["duration"] == 8.34 and h1["repair"]["after"]["duration"] == 6.92
    assert h1["repair"]["issues"][0]["type"] == "jitter"
    assert h1["repaired"] == {"id": "h1_rules", "success": True, "frames": 0}
    # A failed attempt has no id in the stage file; its folder (<source>_m<seed>) is still in the store when kept.
    assert [(v["id"], v["seed"], v["success"]) for v in h1["variants"]] == [
        ("h1_rules_home_m3100", 3100, True), ("h1_rules_home_m3101", 3101, False), (None, 3102, False)]
    assert h1["variants"][0]["frames"] == 4 and h1["variants"][1]["reasons"] == ["dropped"]
    assert h2["replay"]["success"] is False and h2["replay"]["reasons"] == ["collision", "dropped"]
    assert h2["replay"]["max_contact_force"] == 311.9
    assert h2["repair"]["status"] == "discarded" and h2["repaired"] is None and h2["variants"] == []


def test_episodes_come_from_the_live_store_or_the_experiment_store(api, root):
    live = api.get("/showcase/sets/s1/episodes/h1?live=true").json()
    assert live["demo_id"] == "h1" and live["n_steps"] == N and live["verified"] is None
    rep = api.get("/showcase/sets/s1/episodes/h1").json()
    assert rep["verified"] is True and len(rep["joint_pos"]) == N
    var = api.get("/showcase/sets/s1/episodes/h1_rules_home_m3101").json()
    assert var["verified"] is False
    assert api.get("/showcase/sets/s1/episodes/nope").status_code == 404


def test_footage_is_one_sprite_sheet_per_camera(api, root):
    meta = api.get("/showcase/sets/s1/footage/h1_rules_home_m3100?camera=front").json()
    assert meta["frames"] == 4 and meta["stride"] == 1 and meta["tile"] == [8, 8] and meta["fps"] == 50
    assert meta["cols"] >= 1 and meta["url"].endswith("/sprite.jpg?camera=front&live=false")
    res = api.get(meta["url"].replace("/showcase", "/showcase", 1))
    assert res.status_code == 200 and res.headers["content-type"] == "image/jpeg"
    img = Image.open(io.BytesIO(res.content))
    assert img.size == (8 * meta["cols"], 8 * -(-meta["frames"] // meta["cols"]))
    live = api.get("/showcase/sets/s1/footage/h1?camera=front&live=true").json()
    assert live["frames"] == 3
    assert api.get("/showcase/sets/s1/footage/h2?camera=front").status_code == 404  # no frames recorded
    assert api.get("/showcase/sets/s1/footage/h1?camera=../x").status_code == 422


def test_long_footage_is_strided_to_stay_small(tmp_path):
    assert showcase.footage_stride(404) == 2 and showcase.footage_stride(100) == 1 and showcase.footage_stride(1200) == 5


def test_names_cannot_leave_the_data_dir(api, root):
    assert api.get("/showcase/sets/..").status_code in (404, 422)
    assert api.get("/showcase/sets/s1/episodes/..%2F..%2Fdemos%2Fh1").status_code in (404, 422)
    assert api.get("/showcase/sets/not_a_set").status_code == 404


def test_the_log_reads_as_pipeline_events():
    ev = [showcase.parse_log_line(line) for line in LOG.splitlines()]
    assert ev[0] == {"type": "stage", "stage": "select", "at": "15:04:31", "text": "2 demos"}
    assert ev[1] is None  # the lock line says nothing about the pipeline
    assert ev[2] == {"type": "physics", "at": "15:05:23", "id": "h1", "success": True, "reasons": []}
    assert ev[3] == {"type": "physics", "at": "15:05:36", "id": "h2", "success": False, "reasons": ["collision", "dropped"]}
    assert ev[4] == {"type": "repair", "at": "15:07:14", "id": "h1", "status": "perfected", "repairs": 2}
    assert ev[5]["status"] == "discarded"
    assert ev[6] == {"type": "align", "at": "15:09:10", "id": "h1"}
    assert ev[7] == {"type": "multiply", "at": "15:15:31", "id": "h1", "k": 1, "n": 2}
    assert ev[8] == {"type": "stage", "stage": "train", "at": "15:37:05", "text": "started"}
    assert ev[9] == {"type": "train", "at": "15:50:19", "run": "hx_s1", "cells": [{"cell": "perfected_multiply_10", "loss": 0.065}]}
    assert ev[10] == {"type": "eval", "at": "16:37:18", "cells": [{"cell": "perfected_multiply_10", "k": 3, "n": 40}]}
    assert ev[11] == {"type": "done", "at": "16:37:18", "through": "results"}


def test_two_cells_train_and_evaluate_on_one_line():
    t = showcase.parse_log_line("[human-exp 01:02:03] train: run r1: raw_10 loss 0.1, perfected_multiply_10 loss 0.07")
    assert t["cells"] == [{"cell": "raw_10", "loss": 0.1}, {"cell": "perfected_multiply_10", "loss": 0.07}]
    e = showcase.parse_log_line("[human-exp 01:02:03] eval: raw_10 3/40, perfected_multiply_10 17/40")
    assert e["cells"] == [{"cell": "raw_10", "k": 3, "n": 40}, {"cell": "perfected_multiply_10", "k": 17, "n": 40}]
    assert showcase.parse_log_line("[human-exp 01:02:03] eval: done earlier") == {
        "type": "stage", "stage": "eval", "at": "01:02:03", "text": "done earlier"}
    assert showcase.parse_log_line("[mp4 @ 0001] Starting second pass") is None


def test_new_variant_folders_are_events_once(root):
    store = root / "human_exp" / "s1" / "store"
    seen: set[str] = set()
    first = showcase.scan_variants(store, seen)
    assert [(e["id"], e["source"], e["seed"], e["success"]) for e in first] == [
        ("h1_rules_home_m3100", "h1", 3100, True), ("h1_rules_home_m3101", "h1", 3101, False)]
    assert showcase.scan_variants(store, seen) == []


def test_the_live_stream_sends_the_log_and_the_variants_then_closes_when_not_following(api, root):
    with api.stream("GET", "/showcase/live/s1?follow=false") as res:
        assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
        text = "".join(res.iter_text())
    events = [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]
    types = [e["type"] for e in events]
    assert types[0] == "hello" and events[0]["ids"] == ["h1", "h2"]
    assert "physics" in types and "eval" in types and types.count("variant") == 2
    assert types[-1] == "end"
