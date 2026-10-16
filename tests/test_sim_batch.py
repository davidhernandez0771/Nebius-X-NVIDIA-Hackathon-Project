"""sim_worker.batch: pure helpers for the batch runner (no sim)."""

from __future__ import annotations

import math

import pytest

from demo_pipeline.multiply import BIN_X, BIN_Y, CUBE_X, CUBE_Y, MIN_EDGE_GAP, _edge_gap, _yaw
from sim_worker.batch import corner_scenes, summarize


def test_corner_scenes_hit_every_corner_of_both_ranges():
    scenes = corner_scenes("franka")
    cube_xy = {s.cube_pose.pos[:2] for label, s in scenes if label.startswith("cube")}
    bin_xy = {s.bin_pose.pos[:2] for label, s in scenes if label.startswith("bin")}
    assert cube_xy == {(x, y) for x in CUBE_X for y in CUBE_Y}
    assert bin_xy == {(x, y) for x in BIN_X for y in BIN_Y}


def test_corner_scenes_keep_the_minimum_cube_bin_gap():
    for label, s in corner_scenes("franka"):
        gap = _edge_gap(s.cube_pose.pos[:2], _yaw(s.cube_pose.quat_wxyz), s.bin_pose.pos[:2])
        assert gap >= MIN_EDGE_GAP - 1e-9, label


def test_corner_scenes_carry_the_robot_and_unique_labels():
    scenes = corner_scenes("openarm")
    assert len({label for label, _ in scenes}) == len(scenes) == 8
    assert all(s.robot == "openarm" for _, s in scenes)


def test_summarize_counts_successes_and_reasons():
    rows = [
        {"success": True, "reasons": []},
        {"success": False, "reasons": ["unreachable", "not_in_bin"]},
        {"success": False, "reasons": ["not_in_bin"]},
        {"success": True, "reasons": []},
    ]
    s = summarize(rows, wall_s=20.0)
    assert s["n"] == 4 and s["successes"] == 2
    assert s["success_rate"] == pytest.approx(0.5)
    assert s["reasons"] == {"not_in_bin": 2, "unreachable": 1}
    assert s["wall_time_s"] == pytest.approx(20.0)
    assert s["wall_per_episode_s"] == pytest.approx(5.0)


def test_summarize_empty_batch():
    s = summarize([], wall_s=1.0)
    assert s["n"] == 0 and s["success_rate"] == 0.0 and s["reasons"] == {}
    assert not math.isnan(s["wall_per_episode_s"])


def test_yield_report_names_attempts_successes_and_yield():
    from sim_worker.batch import yield_report

    rows = [{"success": s, "reasons": [] if s else ["not_in_bin"]} for s in (True, True, False)]
    r = yield_report(rows, wall_s=6.0)
    assert (r["attempts"], r["successes"]) == (3, 2)
    assert r["yield"] == pytest.approx(2 / 3)
    assert r["reasons"] == {"not_in_bin": 1}
