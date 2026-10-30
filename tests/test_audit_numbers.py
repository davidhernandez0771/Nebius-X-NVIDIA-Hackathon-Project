"""The headline numbers recompute exactly from the committed raw results (scripts/audit_numbers.py).

A future edit to a raw file, a stats helper or a stated number in the docs that breaks one of these fails here."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "audit_numbers.py"


@pytest.fixture(scope="module")
def audit():
    spec = importlib.util.spec_from_file_location("audit_numbers", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses look their module up while the class is built
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def raw(audit):
    return audit.raw_summaries()


def test_the_big_test_is_30_of_40_with_its_wilson_interval(raw):
    s = raw["final_test"]
    assert (s.successes, s.n) == (30, 40)
    assert s.seeds == (5400, 5439)
    assert (round(s.ci[0], 3), round(s.ci[1], 3)) == (0.598, 0.858)
    assert (round(s.ci[0], 2), round(s.ci[1], 2)) == (0.60, 0.86)


def test_the_big_tests_ten_failures(raw):
    s = raw["final_test"]
    assert dict(s.reasons) == {"dropped": 10, "not_in_bin": 9, "collision": 5, "gripper_closed": 2}
    assert dict(s.ended_by) == {"success": 30, "time_limit": 10}
    assert s.failed_seeds == [5400, 5402, 5408, 5409, 5413, 5421, 5427, 5433, 5437, 5439]


def test_the_selection_counts(raw):
    got = {k: (raw[k].successes, raw[k].n) for k in ("stageA_60k", "stageA_120k", "stageA_180k",
                                                      "stageB_60k", "stageB_120k", "stageB_180k", "dagger_r1")}
    assert got == {"stageA_60k": (13, 29), "stageA_120k": (17, 29), "stageA_180k": (21, 29),
                   "stageB_60k": (16, 29), "stageB_120k": (7, 29), "stageB_180k": (8, 29), "dagger_r1": (28, 40)}
    assert raw["stageA_180k"].seeds == (5500, 5528) and raw["stageB_60k"].seeds == (5529, 5557)
    assert raw["dagger_r1"].seeds == (5210, 5249)
    assert dict(raw["dagger_r1"].reasons) == {"not_in_bin": 11, "dropped": 11, "collision": 6, "gripper_closed": 2}


def test_the_descriptive_fisher_p_values(audit):
    assert f"{audit.fisher_two(30, 40, 15, 40):.2g}" == "0.0014"
    assert f"{audit.fisher_two(30, 40, 3, 40):.2g}" == "5.4e-10"
    assert f"{audit.fisher_two(30, 40, 0, 40):.2g}" == "1.9e-13"
    assert f"{audit.fisher_two(30, 40, 17, 40):.1g}" == "0.006"
    assert f"{audit.fisher_two(17, 40, 3, 40):.2g}" == "0.00055"
    assert f"{audit.fisher_two(3, 40, 0, 40):.2g}" == "0.24"


def test_the_failure_analysts_region(audit):
    a = audit.analyst_numbers()
    assert (a["episodes"], a["successes"]) == (69, 51)
    assert a["primary"] == {"dropped": 17, "collision": 1}
    assert (a["inside"], a["hits_inside"], a["hits_total"]) == (29, 10, 17)
    assert round(a["p_one_sided"], 3) == 0.092
    assert (a["hits_outside"], a["n_outside"]) == (7, 40)
    assert audit.matches("0.34", a["rate_inside"]) and audit.matches("0.18", a["rate_outside"])  # 0.175 rounds half up


def test_the_held_out_check_is_one_sided(audit):
    h = audit.heldout_check()
    assert (h["hits_in"], h["n_in"], h["hits_out"], h["n_out"]) == (41, 66, 40, 79)
    assert round(h["p_one_sided"], 2) == 0.11
    assert round(h["p_two_sided"], 2) == 0.18
    assert h["direction_holds"] == 3 and h["checkpoints"] == 5  # the analyst note said 4 of 5 until 2026-10-29


def test_rounding_matches_the_stated_precision(audit):
    assert audit.matches("0.598–0.858", (0.59806, 0.85813))
    assert audit.matches("60–86%", (0.59806, 0.85813))
    assert not audit.matches("28–58%", (0.28509, 0.57805))
    assert audit.matches("29–58%", (0.28509, 0.57805))
    assert audit.matches("5.4 × 10⁻¹⁰", 5.392e-10)
    assert audit.matches("5×10⁻¹⁰", 5.392e-10)
    assert audit.matches("2e-13", 1.911e-13)
    assert audit.matches("< 0.001", 0.000549)
    assert audit.matches("1.0", 1.0)
    assert not audit.matches("0.043", 0.042488)


def test_every_stated_number_in_the_docs_matches(audit):
    bad = [c for c in audit.claims() if not c.ok]
    assert not bad, "\n".join(f"{c.where}: {c.label}: stated {c.stated!r}, recomputed {c.recomputed!r}" for c in bad)
