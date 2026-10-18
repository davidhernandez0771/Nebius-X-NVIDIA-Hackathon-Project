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

from sim_eval.report import MIN_FREE_MIB, episode_log_path, isaac_gate  # noqa: E402

ISAAC_PY = r"C:\isaac\env_isaaclab\Scripts\python.exe"


def test_gate_passes_with_only_this_process_and_enough_memory():
    procs = [(10, 1, f"{ISAAC_PY} sim_eval/scripts/run_eval.py --n 20"),
             (11, 1, r"C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.policy_server")]
    ok, rec = isaac_gate(procs, own_pid=10, free_mib=12000)
    assert MIN_FREE_MIB == 8192
    assert ok is True and rec["other_isaac"] == [] and rec["free_mib"] == 12000


def test_gate_refuses_another_isaac_process():
    procs = [(10, 1, f"{ISAAC_PY} run_eval.py"), (5696, 2, f"{ISAAC_PY} flexiv_trial.py --effort 200")]
    ok, rec = isaac_gate(procs, own_pid=10, free_mib=12000)
    assert ok is False and rec["other_isaac"][0]["pid"] == 5696 and "flexiv_trial" in rec["reason"]


def test_gate_refuses_low_memory_or_unknown_memory():
    ok, rec = isaac_gate([], own_pid=10, free_mib=8000)
    assert ok is False and "8000" in rec["reason"]
    ok, rec = isaac_gate([], own_pid=10, free_mib=None)
    assert ok is False and "nvidia-smi" in rec["reason"]


def test_gate_ignores_this_process_and_all_its_ancestors():
    # A venv python.exe on Windows is a launcher that starts the real interpreter as its child, and eval_cells
    # (itself Isaac python) launches run_eval: launcher 20 -> driver 21 -> launcher 22 -> run_eval 23.
    procs = [(20, 5, f"{ISAAC_PY} eval_cells.py"), (21, 20, rf"C:\isaac\python\python.exe {ISAAC_PY} eval_cells.py"),
             (22, 21, f"{ISAAC_PY} run_eval.py"), (23, 22, rf"C:\isaac\python\python.exe {ISAAC_PY} run_eval.py"),
             (30, 5, f"{ISAAC_PY} t2_server.py")]
    ok, rec = isaac_gate(procs, own_pid=23, free_mib=12000)
    assert ok is False and [o["pid"] for o in rec["other_isaac"]] == [30]
    ok, _ = isaac_gate(procs[:4], own_pid=23, free_mib=12000)
    assert ok is True


def test_gate_ignores_a_lock_wrapper_that_only_names_isaac_in_its_args():
    # 2026-10-18: T2's gpu.lock wrapper (a plain venv python) waited for the lock with an Isaac command in its
    # argv; counting it as Isaac deadlocked the lock holder's gate. Only an Isaac *executable* counts.
    wrapper = (rf"C:\dev\pm-t2\.venv\Scripts\python.exe gpu_run.py export -- {ISAAC_PY} sim_worker/scripts/x.py")
    base = rf'"C:\Users\me\AppData\Roaming\uv\python\cpython-3.14\python.exe"  gpu_run.py export -- {ISAAC_PY} x.py'
    procs = [(10, 1, f"{ISAAC_PY} run_eval.py"), (40, 2, wrapper), (41, 40, base)]
    ok, rec = isaac_gate(procs, own_pid=10, free_mib=12000)
    assert ok is True and rec["other_isaac"] == []
    procs.append((42, 41, f'"{ISAAC_PY}" sim_worker/scripts/x.py'))  # the wrapper's Isaac child, quoted
    ok, rec = isaac_gate(procs, own_pid=10, free_mib=12000)
    assert ok is False and [o["pid"] for o in rec["other_isaac"]] == [42]


def test_gate_with_gpu_pids_ignores_an_isaac_python_that_holds_no_gpu_context():
    # T3's lock wrapper runs from Isaac's own python while it waits for gpu.lock: no GPU context yet. With the GPU
    # process list, an Isaac python counts only if it or a process under it is on the GPU.
    waiting = [(50, 2, f"{ISAAC_PY} gpulock_run.py -- {ISAAC_PY} home_dataset.py"),
               (51, 50, rf"C:\isaac\python\python.exe gpulock_run.py -- {ISAAC_PY} home_dataset.py")]
    procs = [(10, 1, f"{ISAAC_PY} run_eval.py"), *waiting]
    ok, rec = isaac_gate(procs, own_pid=10, free_mib=12000, gpu_pids={999})
    assert ok is True and [o["pid"] for o in rec["idle_isaac"]] == [50, 51]
    running = procs + [(52, 51, f"{ISAAC_PY} home_dataset.py"), (53, 52, rf"C:\isaac\python\python.exe x")]
    ok, rec = isaac_gate(running, own_pid=10, free_mib=12000, gpu_pids={53})
    assert ok is False and sorted(o["pid"] for o in rec["other_isaac"]) == [50, 51, 52, 53]
    ok, _ = isaac_gate(procs, own_pid=10, free_mib=12000)  # no GPU list: the old rule, every Isaac python counts
    assert ok is False


def test_episode_log_sits_next_to_the_results_file(tmp_path):
    assert episode_log_path(tmp_path / "evals" / "raw_5_1.json") == tmp_path / "evals" / "raw_5_1.episodes.jsonl"


def test_infra_failures_counts_sim_and_policy_errors_in_a_results_file(tmp_path):
    from sim_eval.report import infra_failures

    def ep(seed, ended_by):
        ok = ended_by == "success"
        return EpisodeResult(seed=seed, success=ok, reasons=[] if ok else [ended_by if "error" in ended_by
                                                                            else "not_in_bin"],
                             ended_by=ended_by, steps=5, sim_s=0.1, wall_s=1.0)

    eps = [ep(5000, "success"), ep(5001, "time_limit"), ep(5002, "sim_error"), ep(5003, "policy_error")]
    path = write_results(tmp_path / "r.json", {"cell": "raw_5"}, eps, aggregate(eps))
    assert infra_failures(path) == 2
    clean = eps[:2]
    assert infra_failures(write_results(tmp_path / "c.json", {}, clean, aggregate(clean))) == 0
    assert infra_failures(tmp_path / "missing.json") is None
