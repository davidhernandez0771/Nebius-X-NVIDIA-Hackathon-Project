"""demo_pipeline.stats: Wilson CI, Fisher's exact test and sample size for two success rates.

Reference values are textbook / published ones, not numbers from this module:
  Wilson 2/20 = [0.0279, 0.3010] (Newcombe 1998 style tables);
  Fisher on Wikipedia's example [[1, 9], [11, 3]] = 0.002759, the tea-tasting table [[3, 1], [1, 3]] = 0.4857;
  Fleiss n per arm for 10% vs 20% (alpha 0.05 two-sided, power 0.8) = 199 uncorrected, 219 corrected.
"""
from __future__ import annotations

import pytest

from demo_pipeline.stats import fisher_exact, fisher_power, n_per_arm, wilson_ci


# --- Wilson ---------------------------------------------------------------------------------------------

def test_wilson_matches_the_published_interval_for_2_of_20():
    lo, hi = wilson_ci(2, 20)
    assert lo == pytest.approx(0.0279, abs=5e-4)
    assert hi == pytest.approx(0.3010, abs=5e-4)


def test_wilson_for_3_of_20():
    lo, hi = wilson_ci(3, 20)
    assert lo == pytest.approx(0.0524, abs=5e-4)
    assert hi == pytest.approx(0.3604, abs=5e-4)


def test_wilson_zero_successes_has_lower_bound_zero_and_a_real_upper_bound():
    lo, hi = wilson_ci(0, 20)
    assert lo == 0.0
    assert hi == pytest.approx(0.1611, abs=5e-4)


def test_wilson_all_successes_has_upper_bound_one():
    lo, hi = wilson_ci(20, 20)
    assert hi == 1.0
    assert lo == pytest.approx(0.8389, abs=5e-4)


def test_wilson_narrows_with_more_episodes():
    lo20, hi20 = wilson_ci(2, 20)
    lo200, hi200 = wilson_ci(20, 200)
    assert hi200 - lo200 < hi20 - lo20


def test_wilson_99_percent_is_wider_than_95():
    lo95, hi95 = wilson_ci(2, 20)
    lo99, hi99 = wilson_ci(2, 20, confidence=0.99)
    assert lo99 < lo95 and hi99 > hi95


@pytest.mark.parametrize("k, n", [(0, 0), (-1, 10), (11, 10), (1, -1)])
def test_wilson_rejects_impossible_counts(k, n):
    with pytest.raises(ValueError):
        wilson_ci(k, n)


# --- Fisher ---------------------------------------------------------------------------------------------

def test_fisher_matches_wikipedias_example():
    # [[1, 9], [11, 3]]: 1/10 vs 11/14
    assert fisher_exact(1, 10, 11, 14) == pytest.approx(0.002759, abs=1e-6)


def test_fisher_matches_the_tea_tasting_table():
    assert fisher_exact(3, 4, 1, 4) == pytest.approx(0.4857, abs=1e-4)


def test_fisher_says_2_of_20_vs_3_of_20_is_nowhere_near_significant():
    assert fisher_exact(2, 20, 3, 20) == pytest.approx(1.0)


def test_fisher_is_symmetric_in_the_two_arms():
    assert fisher_exact(2, 20, 9, 20) == pytest.approx(fisher_exact(9, 20, 2, 20))


def test_fisher_identical_arms_give_p_one():
    assert fisher_exact(5, 20, 5, 20) == pytest.approx(1.0)


def test_fisher_extreme_split_is_significant():
    # 0/20 vs 10/20: p = 2 * C(20,10) / C(40,10) = 2 * 184756 / 847660528 ~ 0.000436
    assert fisher_exact(0, 20, 10, 20) == pytest.approx(0.000436, abs=2e-6)


def test_fisher_p_is_never_above_one():
    for a in range(0, 11):
        for b in range(0, 11):
            assert 0.0 < fisher_exact(a, 10, b, 10) <= 1.0


@pytest.mark.parametrize("args", [(3, 2, 1, 4), (1, 4, -1, 4), (0, 0, 1, 4)])
def test_fisher_rejects_impossible_counts(args):
    with pytest.raises(ValueError):
        fisher_exact(*args)


# --- sample size ----------------------------------------------------------------------------------------

def test_n_per_arm_10_vs_20_uncorrected_is_the_fleiss_value():
    assert n_per_arm(0.10, 0.20, continuity_correction=False) == 199


def test_n_per_arm_10_vs_20_corrected_is_the_fleiss_value():
    assert n_per_arm(0.10, 0.20) == 219


def test_n_per_arm_shrinks_as_the_gap_grows():
    assert n_per_arm(0.10, 0.20) > n_per_arm(0.10, 0.30) > n_per_arm(0.10, 0.40)


def test_n_per_arm_is_symmetric():
    assert n_per_arm(0.30, 0.10) == n_per_arm(0.10, 0.30)


def test_n_per_arm_more_power_needs_more_episodes():
    assert n_per_arm(0.10, 0.30, power=0.9) > n_per_arm(0.10, 0.30, power=0.8)


@pytest.mark.parametrize("p1, p2", [(0.1, 0.1), (-0.1, 0.2), (0.1, 1.2)])
def test_n_per_arm_rejects_bad_rates(p1, p2):
    with pytest.raises(ValueError):
        n_per_arm(p1, p2)


# --- exact power of Fisher's test -----------------------------------------------------------------------

def test_fisher_power_at_n_20_for_10_vs_20_is_tiny():
    assert fisher_power(0.10, 0.20, 20) < 0.15


def test_fisher_power_under_the_null_stays_below_alpha():
    # Fisher is conservative: its type I error never exceeds alpha
    assert fisher_power(0.15, 0.15, 30) <= 0.05


def test_fisher_power_reaches_about_80_percent_at_the_corrected_n():
    n = n_per_arm(0.10, 0.40)
    assert fisher_power(0.10, 0.40, n) == pytest.approx(0.8, abs=0.06)


def test_fisher_power_grows_with_n():
    assert fisher_power(0.10, 0.30, 60) > fisher_power(0.10, 0.30, 20)
