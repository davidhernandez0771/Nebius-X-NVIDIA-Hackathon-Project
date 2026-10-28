"""scripts/wandb_report.py: what it would publish must be the committed results, recomputed, and never call W&B on a
dry run."""

import sys

from scripts.wandb_report import build_report, main


def test_the_headline_is_the_big_test_from_the_raw_log():
    s = build_report()["summary"]
    assert (s["final_test/successes"], s["final_test/n"]) == (30, 40)
    assert (s["final_test/ci95_lo"], s["final_test/ci95_hi"]) == (0.598, 0.858)
    assert s["final_test/goal_met"] is True
    assert s["final_test/median_success_sim_s"] == 8.23


def test_checkpoint_selection_matches_the_notes():
    got = {(r["stage"], r["step"]): (r["k"], r["n"]) for r in build_report()["checkpoint_selection"]}
    assert got == {("A", 60000): (13, 29), ("A", 120000): (17, 29), ("A", 180000): (21, 29),
                   ("B", 60000): (16, 29), ("B", 120000): (7, 29), ("B", 180000): (8, 29)}


def test_the_p_values_are_the_ones_the_site_states():
    p = {(c["a"].split()[-1], c["b"].split()[-1], c["experiment"]): c["p"] for c in build_report()["comparisons"]}
    assert p[("3/40", "17/40", "scripted_multiply")] == 0.00055
    assert p[("3/40", "16/40", "scripted_multiply")] == 0.0012
    assert p[("17/40", "16/40", "scripted_multiply")] == 1.0
    assert p[("0/40", "3/40", "climb")] == 0.24


def test_a_dry_run_never_imports_wandb(capsys):
    sys.modules.pop("wandb", None)
    assert main([]) == 0
    assert "wandb" not in sys.modules
    assert "nothing uploaded" in capsys.readouterr().out
