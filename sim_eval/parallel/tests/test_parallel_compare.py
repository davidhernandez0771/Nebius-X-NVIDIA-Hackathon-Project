"""Serial vs parallel on the same seeds: outcome agreement and wall-time speedup."""

from __future__ import annotations

import json

import pytest

from sim_eval.parallel.compare import compare_runs, load_episodes
from sim_eval.results import EpisodeResult, aggregate


def ep(seed, success, steps=100, wall=60.0, ended_by=None, reasons=None):
    ended_by = ended_by or ("success" if success else "time_limit")
    return EpisodeResult(seed=seed, success=success, reasons=reasons if reasons is not None else
                         ([] if success else ["not_in_bin"]), ended_by=ended_by, steps=steps,
                         sim_s=(steps - 1) / 50, wall_s=wall)


def test_agreement_and_speedup_over_the_parallel_runs_seeds():
    serial = [ep(5000, True, 400, 30.0), ep(5001, False, 1500, 80.0), ep(5002, False, 1500, 80.0),
              ep(5003, True, 600, 40.0)]
    parallel = [ep(5000, True, 410), ep(5001, False, 1500), ep(5002, True, 900)]
    c = compare_runs(serial, parallel, parallel_wall_s=95.0)
    assert c["seeds"] == [5000, 5001, 5002]  # only what both ran
    assert (c["serial_successes"], c["parallel_successes"], c["n"]) == (1, 2, 3)
    assert c["outcome_agree"] == 2 and c["disagree_seeds"] == [5002]
    assert c["serial_wall_s"] == pytest.approx(190.0)  # serial episodes run back to back: their walls add up
    assert c["speedup"] == pytest.approx(190.0 / 95.0)
    row = c["rows"][0]
    assert row == {"seed": 5000, "serial": "success", "parallel": "success", "serial_steps": 400,
                   "parallel_steps": 410, "serial_reasons": [], "parallel_reasons": []}


def test_a_parallel_seed_the_serial_run_never_ran_is_an_error():
    with pytest.raises(ValueError, match="5009"):
        compare_runs([ep(5000, True)], [ep(5000, True), ep(5009, False)], parallel_wall_s=10.0)


def test_without_a_parallel_wall_time_there_is_no_speedup():
    c = compare_runs([ep(5000, True)], [ep(5000, True)])
    assert c["speedup"] is None and c["parallel_wall_s"] is None


def test_load_episodes_reads_a_sim_eval_results_file(tmp_path):
    eps = [ep(5000, True), ep(5001, False)]
    from sim_eval.report import write_results

    path = write_results(tmp_path / "r.json", {"cell": "raw_10"}, eps, aggregate(eps))
    assert load_episodes(path) == eps
    (tmp_path / "bad.json").write_text(json.dumps({"run": {}}), encoding="utf-8")
    with pytest.raises(ValueError, match="episodes"):
        load_episodes(tmp_path / "bad.json")
