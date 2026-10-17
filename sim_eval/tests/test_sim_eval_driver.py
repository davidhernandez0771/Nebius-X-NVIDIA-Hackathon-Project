"""eval_cells builds run_eval command lines; every flag it passes must exist in run_eval.py's parser.
(2026-10-16: the driver passed --headless, which Isaac Lab 3.0's launcher args don't have; run_eval exited 2.)"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).parents[1] / "scripts"


def _load_driver():
    import importlib.util

    spec = importlib.util.spec_from_file_location("eval_cells", SCRIPTS / "eval_cells.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_every_flag_the_driver_passes_is_declared_by_run_eval(tmp_path):
    cmd = _load_driver().run_eval_command(python="py", port=8765, n=20, seed0=5000, cell="raw_5",
                                          out=tmp_path / "raw_5.json", registry=tmp_path / "r.jsonl")
    declared = set(re.findall(r'add_argument\(\s*"(--[a-z0-9_-]+)"', (SCRIPTS / "run_eval.py").read_text("utf-8")))
    flags = [a for a in cmd if a.startswith("--")]
    assert flags and set(flags) <= declared, set(flags) - declared
    assert "--resume" in flags and "--cameras" in flags
    assert cmd[cmd.index("--cell") + 1] == "raw_5" and cmd[cmd.index("--n") + 1] == "20"


@pytest.mark.parametrize("rc, retry", [(2, False), (1, True), (0, True)])
def test_usage_errors_and_refusals_are_not_retried(rc, retry):
    assert _load_driver().retryable(rc) is retry


def test_a_shared_start_state_is_passed_to_every_cell(tmp_path):
    # Sprint 6 Task B: every cell starts from the same home pose (the raw cell's start state), for a fair comparison.
    cmd = _load_driver().run_eval_command(python="py", port=8765, n=20, seed0=5000, cell="raw_multiply_10",
                                          out=tmp_path / "o.json", registry=tmp_path / "r.jsonl",
                                          start_state=tmp_path / "raw_10", start_pose="dataset")
    assert cmd[cmd.index("--start-state") + 1] == str(tmp_path / "raw_10")
    assert cmd[cmd.index("--start-pose") + 1] == "dataset"
    plain = _load_driver().run_eval_command(python="py", port=8765, n=20, seed0=5000, cell="raw_5",
                                            out=tmp_path / "o.json", registry=tmp_path / "r.jsonl")
    assert "--start-state" not in plain and "--start-pose" not in plain


def test_without_a_registry_the_command_never_touches_it(tmp_path):
    # Sprint 7: 30k checkpoints have no registry row; the 10k row's eval_success must not be overwritten.
    cmd = _load_driver().run_eval_command(python="py", port=8765, n=20, seed0=5000, cell="raw_10_30k",
                                          out=tmp_path / "o.json", registry=None)
    assert "--no-registry" in cmd and "--registry" not in cmd
    assert cmd[cmd.index("--cell") + 1] == "raw_10_30k"


def test_checkpoint_specs_replace_the_registry_rows(tmp_path):
    drv = _load_driver()
    rows = [{"cell": {"name": "raw_10"}, "checkpoint": "a"}, {"cell": {"name": "raw_5"}, "checkpoint": "b"}]
    assert drv.eval_targets(rows, None, []) == [("raw_10", "a", True), ("raw_5", "b", True)]
    assert drv.eval_targets(rows, ["raw_5"], []) == [("raw_5", "b", True)]
    ck = str(tmp_path / "030000" / "pretrained_model")
    assert drv.eval_targets(rows, None, [f"raw_10_30k={ck}"]) == [("raw_10_30k", ck, False)]


@pytest.mark.parametrize("bad", ["no_equals_sign", "=path", "cell="])
def test_a_malformed_checkpoint_spec_is_rejected(bad):
    with pytest.raises(ValueError, match="CELL=PATH"):
        _load_driver().eval_targets([], None, [bad])


def _results(path, seeds, ended_by="time_limit"):
    import json

    path.write_text(json.dumps({"episodes": [{"seed": s, "ended_by": ended_by} for s in seeds]}), encoding="utf-8")
    return path


def test_a_cell_is_done_only_when_every_requested_seed_has_a_valid_episode(tmp_path):
    # Sprint 7 Task 3 extends n = 20 -> 30, ... on the same results file; the old check skipped it as "evaluated".
    drv = _load_driver()
    out = _results(tmp_path / "c.json", range(5000, 5020))
    assert drv.seeds_to_run(out, n=20, seed0=5000) == 0
    assert drv.seeds_to_run(out, n=30, seed0=5000) == 10
    assert drv.seeds_to_run(tmp_path / "missing.json", n=20, seed0=5000) == 20
    bad = _results(tmp_path / "bad.json", range(5000, 5020), ended_by="sim_error")
    assert drv.seeds_to_run(bad, n=20, seed0=5000) == 20
