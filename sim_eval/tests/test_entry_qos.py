"""Every process of a distill round, the selection and the final test opts out of Windows power throttling (EcoQoS):
in the background Windows throttles them (round 0's rollouts slowed from ~10 s to ~18 s each, 2026-10-21), and the
opt-out is per process (a child does not inherit it), so each entry point's main() calls full_speed() (high_qos,
logged) itself."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
ENTRIES = [
    "sim_eval/scripts/distill_round.py",  # the round's wrapper
    "sim_eval/scripts/distill_rollouts.py",  # Isaac: teacher / DAgger rollouts
    "sim_eval/scripts/eval_cells.py",  # selection and the final test
    "sim_eval/scripts/run_eval.py",  # Isaac: the evaluation episodes
    "lerobot_tools/policy_server.py",  # the student's inference
    "lerobot_tools/experiments.py",  # the dataset export
    "lerobot_tools/train.py",  # the training subprocess
]


def _calls_in_main(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    (main,) = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main"]
    return {n.func.id for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}


@pytest.mark.parametrize("entry", ENTRIES)
def test_each_entry_point_opts_out_of_power_throttling(entry):
    assert "full_speed" in _calls_in_main(REPO / entry), f"{entry}: main() must call full_speed()"
