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
