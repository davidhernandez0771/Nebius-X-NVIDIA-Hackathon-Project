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


# --- Isaac gate: no other Isaac python process, >= 8 GB GPU memory free (sprint-3 rule) ------------------------------

from sim_eval.report import MIN_FREE_MIB, isaac_gate  # noqa: E402

ISAAC_PY = r"C:\isaac\env_isaaclab\Scripts\python.exe"


def test_gate_passes_with_only_this_process_and_enough_memory():
    ok, rec = isaac_gate([(10, f"{ISAAC_PY} sim_eval/scripts/run_eval.py --n 20"), (11, r"C:\venvs\lerobot\python.exe -m"
                                                                                       r" lerobot_tools.policy_server")],
                         own_pids={10}, free_mib=12000)
    assert MIN_FREE_MIB == 8192
    assert ok is True and rec["other_isaac"] == [] and rec["free_mib"] == 12000


def test_gate_refuses_another_isaac_process():
    ok, rec = isaac_gate([(10, f"{ISAAC_PY} run_eval.py"), (5696, f"{ISAAC_PY} flexiv_trial.py --effort 200")],
                         own_pids={10}, free_mib=12000)
    assert ok is False and rec["other_isaac"][0]["pid"] == 5696 and "flexiv_trial" in rec["reason"]


def test_gate_refuses_low_memory_or_unknown_memory():
    ok, rec = isaac_gate([], own_pids={10}, free_mib=8000)
    assert ok is False and "8000" in rec["reason"]
    ok, rec = isaac_gate([], own_pids={10}, free_mib=None)
    assert ok is False and "nvidia-smi" in rec["reason"]


def test_gate_ignores_this_process_and_its_venv_launcher_parent():
    # A venv python.exe on Windows is a launcher that starts the real interpreter as its child.
    procs = [(20, f"{ISAAC_PY} run_eval.py"), (21, rf"C:\isaac\python\python.exe {ISAAC_PY} run_eval.py")]
    ok, _ = isaac_gate(procs, own_pids={20, 21}, free_mib=12000)
    assert ok is True


def test_episode_log_sits_next_to_the_results_file(tmp_path):
    from sim_eval.report import episode_log_path

    assert episode_log_path(tmp_path / "evals" / "raw_5_20261016.json") == tmp_path / "evals" / "raw_5_20261016.episodes.jsonl"
