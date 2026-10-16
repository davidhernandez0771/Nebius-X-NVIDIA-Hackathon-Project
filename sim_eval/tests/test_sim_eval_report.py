"""Pure CLI helpers: preflight against the policy server's /health, and the results file."""

from __future__ import annotations

import json

import pytest

from sim_eval.report import default_results_path, preflight, write_results
from sim_eval.results import EpisodeResult, aggregate

HEALTH = {"ok": True, "state_dim": 9, "cameras": {"front": [128, 128], "wrist": [128, 128]},
          "checkpoint": "C:/x/pretrained_model", "device": "cuda", "policy_type": "act"}


def test_matching_server_passes():
    assert preflight(HEALTH, cameras=True, image_size=128) == []


def test_camera_policy_without_cameras_flag_is_refused():
    problems = preflight(HEALTH, cameras=False, image_size=128)
    assert len(problems) == 1 and "--cameras" in problems[0]


def test_state_only_policy_runs_without_cameras():
    assert preflight({**HEALTH, "cameras": {}}, cameras=False, image_size=128) == []


@pytest.mark.parametrize("health, word", [
    ({**HEALTH, "state_dim": 7}, "state"),
    ({**HEALTH, "cameras": {"front": [96, 96], "wrist": [128, 128]}}, "96x96"),
    ({**HEALTH, "cameras": {"front": [128, 128], "top": [128, 128]}}, "top"),
])
def test_mismatches_are_reported(health, word):
    problems = preflight(health, cameras=True, image_size=128)
    assert problems and any(word in p for p in problems)


def test_results_file_has_the_run_the_summary_and_every_episode(tmp_path):
    eps = [EpisodeResult(seed=5000, success=False, reasons=["not_in_bin"], ended_by="time_limit", steps=1500,
                         sim_s=29.98, wall_s=40.0)]
    path = tmp_path / "evals" / "x.json"
    write_results(path, {"cell": "raw_5", "seed0": 5000}, eps, aggregate(eps))
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["run"] == {"cell": "raw_5", "seed0": 5000}
    assert data["summary"]["n"] == 1 and data["summary"]["reasons"] == {"not_in_bin": 1}
    assert data["episodes"][0]["seed"] == 5000


def test_default_results_path_names_the_cell(tmp_path):
    p = default_results_path(tmp_path, "raw_multiply_10")
    assert p.parent == tmp_path / "evals" and p.name.startswith("raw_multiply_10_") and p.suffix == ".json"
    assert default_results_path(tmp_path, None).name.startswith("adhoc_")
