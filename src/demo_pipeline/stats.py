"""Small-sample statistics for success rates, pure stdlib (no scipy in the SANT deps).

  wilson_ci(k, n)               Wilson score interval for k successes in n episodes
  fisher_exact(a, na, b, nb)    two-sided Fisher exact p for a/na vs b/nb
  n_per_arm(p1, p2)             episodes per arm to tell p1 from p2 (normal approximation, Fleiss)
  fisher_power(p1, p2, n)       exact power of fisher_exact with n episodes per arm
  mcnemar_exact(b, c)           two-sided exact McNemar p for paired outcomes (b, c = the two discordant counts)

Fisher works on integer hypergeometric weights (math.comb), so ties between tables compare exactly instead of
through a floating-point tolerance.
"""

from __future__ import annotations

import math
from statistics import NormalDist


def _check_counts(k: int, n: int) -> None:
    if n <= 0 or k < 0 or k > n:
        raise ValueError(f"need 0 <= successes <= n and n > 0, got {k}/{n}")


def _z(q: float) -> float:
    return NormalDist().inv_cdf(q)


def wilson_ci(successes: int, n: int, confidence: float = 0.95) -> tuple[float, float]:
    """Wilson score interval; stays inside [0, 1] and is honest at 0/n and n/n."""
    _check_counts(successes, n)
    z = _z(1 - (1 - confidence) / 2)
    p = successes / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    lo = 0.0 if successes == 0 else max(0.0, center - half)
    hi = 1.0 if successes == n else min(1.0, center + half)
    return lo, hi


def _rejection_sets(n_a: int, n_b: int, alpha: float) -> dict[int, set[int]]:
    """For each total number of successes m, the values of a (successes in arm A) whose Fisher p <= alpha."""
    out = {}
    for m in range(n_a + n_b + 1):
        weights = _weights(n_a, n_b, m)
        total = sum(weights.values())
        out[m] = {a for a in weights if _p_from_weights(weights, total, a) <= alpha}
    return out


def _weights(n_a: int, n_b: int, m: int) -> dict[int, int]:
    """Hypergeometric weights C(n_a, a) * C(n_b, m - a) over the a that fit the margins."""
    return {a: math.comb(n_a, a) * math.comb(n_b, m - a) for a in range(max(0, m - n_b), min(n_a, m) + 1)}


def _p_from_weights(weights: dict[int, int], total: int, a: int) -> float:
    observed = weights[a]
    return min(1.0, sum(w for w in weights.values() if w <= observed) / total)


def fisher_exact(a_successes: int, a_n: int, b_successes: int, b_n: int) -> float:
    """Two-sided Fisher exact p: the probability of every table, given the margins, no likelier than this one."""
    _check_counts(a_successes, a_n)
    _check_counts(b_successes, b_n)
    weights = _weights(a_n, b_n, a_successes + b_successes)
    return _p_from_weights(weights, sum(weights.values()), a_successes)


def _check_rate(p: float) -> None:
    if not 0.0 <= p <= 1.0:
        raise ValueError(f"a rate must be in [0, 1], got {p}")


def n_per_arm(p1: float, p2: float, alpha: float = 0.05, power: float = 0.8,
              continuity_correction: bool = True) -> int:
    """Episodes per arm for a two-sided test of p1 vs p2 (Fleiss 1981; corrected = Fleiss, Tytun & Ury 1980).

    The corrected value is the closer guide when the analysis is Fisher's exact test, which is conservative.
    """
    _check_rate(p1)
    _check_rate(p2)
    if p1 == p2:
        raise ValueError("p1 == p2: no sample size detects a zero difference")
    d = abs(p1 - p2)
    p_bar = (p1 + p2) / 2
    root = (_z(1 - alpha / 2) * math.sqrt(2 * p_bar * (1 - p_bar))
            + _z(power) * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)))
    n = root * root / (d * d)
    if continuity_correction:
        n = n / 4 * (1 + math.sqrt(1 + 4 / (n * d))) ** 2
    return math.ceil(n)


def _binom_pmf(n: int, p: float) -> list[float]:
    return [math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range(n + 1)]


def fisher_power(p1: float, p2: float, n: int, alpha: float = 0.05) -> float:
    """Exact probability that fisher_exact rejects at alpha, with n episodes per arm and true rates p1, p2."""
    _check_rate(p1)
    _check_rate(p2)
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    pa, pb = _binom_pmf(n, p1), _binom_pmf(n, p2)
    reject = _rejection_sets(n, n, alpha)
    return sum(pa[a] * pb[m - a] for m, rejected in reject.items() for a in rejected)


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact McNemar p: the same items under two conditions, b passing only under the first, c only under
    the second. Under the null each discordant item is a fair coin: 2 * P(Binomial(b + c, 1/2) <= min(b, c)), capped
    at 1; 1.0 with no discordant item."""
    if b < 0 or c < 0:
        raise ValueError(f"need non-negative counts, got b={b}, c={c}")
    n = b + c
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(math.comb(n, k) for k in range(min(b, c) + 1)) / 2 ** n)
