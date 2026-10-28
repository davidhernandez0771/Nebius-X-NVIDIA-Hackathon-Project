"""Math audit: recompute the submission's numbers from the committed raw results and check every place they are stated.

  uv run python scripts/audit_numbers.py            the claims table (claim, file:line, stated, recomputed, status)
  uv run python scripts/audit_numbers.py --extras   plus the post-hoc numbers for the judges (power, breakdowns)

Raw inputs (all committed):
  docs/superpowers/notes/2026-10-23-bigtest/results/   the big test's per-episode results: the final test (5400-5439),
                                                       Stage A/B checkpoint selection, the DAgger round-1 rollouts
  docs/superpowers/notes/2026-10-17-r6-results/        the R6 request-translation rows (model vs keyword parser)
Counts that have no committed raw file (older tests: 3/40 vs 17/40, the mouse raw vs SANT, Mimic, the repair A/B) are
checked arithmetically from the counts the notes state: their Wilson intervals and p-values must follow from them.

The failure analyst's numbers are recomputed the way scripts/analyze_failures.py --results-only builds them: each
episode's scene from its seed (multiply.sample_scene), its class from its reasons (failure_features.result_features),
the region's support with data_recipe.region_support. data/analysis/ is not in git, so its cost and agreement are
checked only when the folder is present.

Statistics: demo_pipeline.stats (Wilson, two-sided Fisher, exact McNemar, Fisher power) and data_recipe.fisher_greater
(one-sided Fisher); no scipy. Exit 1 if any stated number does not match.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

import numpy as np  # noqa: E402

from demo_pipeline.data_recipe import DataRecipe, fisher_greater, region_support  # noqa: E402
from demo_pipeline.failure_features import result_features  # noqa: E402
from demo_pipeline.multiply import sample_scene  # noqa: E402
from demo_pipeline.stats import fisher_exact, fisher_power, mcnemar_exact, wilson_ci  # noqa: E402

NOTES = REPO / "docs" / "superpowers" / "notes"
RESULTS = NOTES / "2026-10-23-bigtest" / "results"
ANALYSIS_DIR = REPO / "data" / "analysis" / "bigtest_final"

RAW_FILES = {
    "final_test": RESULTS / "final_test" / "bigtest_final.episodes.jsonl",
    "stageA_60k": RESULTS / "stageA_selection" / "distill_r0_s60000.episodes.jsonl",
    "stageA_120k": RESULTS / "stageA_selection" / "distill_r0_s120000.episodes.jsonl",
    "stageA_180k": RESULTS / "stageA_selection" / "distill_r0_s180000.episodes.jsonl",
    "stageB_60k": RESULTS / "stageB_selection" / "distill_r1_s60000.episodes.jsonl",
    "stageB_120k": RESULTS / "stageB_selection" / "distill_r1_s120000.episodes.jsonl",
    "stageB_180k": RESULTS / "stageB_selection" / "distill_r1_s180000.episodes.jsonl",
    "dagger_r1": RESULTS / "dagger_r1" / "rollouts.jsonl",
}
# The checkpoints the analysis never saw (its input was Stage A 180k + the final test, which is the same model).
HELD_OUT = ("stageA_60k", "stageA_120k", "stageB_60k", "stageB_120k", "stageB_180k")

# The failure analyst's region (data/analysis/bigtest_final/recipe_nemotron.json, quoted in the analyst note).
NEMOTRON_REGION = {"name": "left_cube_right_bin", "targets": ["dropped"], "cube_x": [0.4, 0.6], "cube_y": [0.067, 0.2],
                   "cube_yaw_deg": [-45.0, 45.0], "bin_x": [0.4, 0.65], "bin_y": [-0.3, -0.1], "share": 0.4,
                   "rationale": "-"}


# ------------------------------------------------------------------ raw results


def load_rows(path: Path) -> list[dict]:
    """Episode rows of an eval (.episodes.jsonl: the last row per seed wins, as run_eval --resume writes them; .json:
    its "episodes") or of DAgger rollouts (one row per line)."""
    if path.suffix == ".json":
        return json.loads(path.read_text(encoding="utf-8"))["episodes"]
    latest: dict[int, dict] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if "header" in rec:
            continue
        row = rec.get("episode", rec)
        latest[int(row["seed"])] = row
    return [latest[s] for s in sorted(latest)]


@dataclass
class Summary:
    n: int
    successes: int
    ci: tuple[float, float]
    reasons: Counter
    ended_by: Counter
    seeds: tuple[int, int]
    failed_seeds: list[int]
    errors: int = 0

    @property
    def rate(self) -> float:
        return self.successes / self.n


def summarize(rows: list[dict]) -> Summary:
    k = sum(bool(r["success"]) for r in rows)
    seeds = [int(r["seed"]) for r in rows]
    return Summary(n=len(rows), successes=k, ci=wilson_ci(k, len(rows)),
                   reasons=Counter(x for r in rows for x in (r.get("reasons") or [])),
                   ended_by=Counter(r.get("ended_by") for r in rows), seeds=(min(seeds), max(seeds)),
                   failed_seeds=[int(r["seed"]) for r in rows if not r["success"]],
                   errors=sum(r.get("error") is not None for r in rows))


def raw_summaries() -> dict[str, Summary]:
    return {name: summarize(load_rows(path)) for name, path in RAW_FILES.items()}


def fisher_two(a: int, na: int, b: int, nb: int) -> float:
    return fisher_exact(a, na, b, nb)


def fisher_one(a: int, na: int, b: int, nb: int) -> float:
    """One-sided: P(arm A's successes >= a), margins fixed (A higher than B)."""
    return fisher_greater(a, na - a, b, nb - b)


# ------------------------------------------------------------------ the failure analyst


def _features(name: str):
    return [result_features(r, sample_scene(np.random.default_rng(int(r["seed"])), "franka", int(r["seed"])))
            for r in load_rows(RAW_FILES[name])]


def _region() -> DataRecipe:
    return DataRecipe.model_validate({"summary": "-", "hypotheses": [], "mechanism": [], "fixes": [],
                                      "regions": [NEMOTRON_REGION], "uniform_share": 0.6})


def analyst_numbers() -> dict:
    """The analyst's input (Stage A 180k selection + the final test, 69 episodes) and its region's support."""
    eps = _features("stageA_180k") + _features("final_test")
    s = region_support(_region(), eps)[0]
    hits_out, n_out = s.target_failures_total - s.target_failures_inside, len(eps) - s.episodes_inside
    inside = set(s.seeds_inside)
    ok_in = sum(e.success for e in eps if e.seed in inside)
    return {"episodes": len(eps), "successes": sum(e.success for e in eps),
            "primary": dict(Counter(e.primary for e in eps if not e.success)),
            "inside": s.episodes_inside, "hits_inside": s.target_failures_inside, "hits_total": s.target_failures_total,
            "hits_outside": hits_out, "n_outside": n_out, "p_one_sided": s.p_value,
            "p_two_sided": fisher_two(s.target_failures_inside, s.episodes_inside, hits_out, n_out),
            "rate_inside": s.rate_inside, "rate_outside": hits_out / n_out, "rate_overall": s.rate_overall,
            "success_inside": (ok_in, s.episodes_inside),
            "success_outside": (sum(e.success for e in eps) - ok_in, n_out)}


def heldout_check() -> dict:
    """The region on the five checkpoints the analysis never saw: drops inside vs outside, pooled."""
    hi = ni = ho = no = holds = 0
    per = {}
    for name in HELD_OUT:
        eps = _features(name)
        s = region_support(_region(), eps)[0]
        a, n_a = s.target_failures_inside, s.episodes_inside
        b, n_b = s.target_failures_total - a, len(eps) - n_a
        per[name] = (a, n_a, b, n_b)
        holds += a / n_a > b / n_b
        hi, ni, ho, no = hi + a, ni + n_a, ho + b, no + n_b
    return {"hits_in": hi, "n_in": ni, "hits_out": ho, "n_out": no, "p_one_sided": fisher_one(hi, ni, ho, no),
            "p_two_sided": fisher_two(hi, ni, ho, no), "direction_holds": holds, "checkpoints": len(HELD_OUT),
            "per_checkpoint": per}


def r6_counts() -> tuple[int, int, int]:
    """R6 request translation: (model exact, keywords exact, n). The model got all 34, so the discordant items are
    exactly the keyword parser's misses."""
    def exact(arm: str) -> tuple[int, int]:
        d = json.loads((NOTES / "2026-10-17-r6-results" / f"{arm}.json").read_text(encoding="utf-8"))
        n = d["score"]["n"]
        return round(d["score"]["exact"]["all"] * n), n
    (m, n), (k, _) = exact("model"), exact("keywords")
    return m, k, n


def r6_cost_per_request() -> float:
    d = json.loads((NOTES / "2026-10-17-r6-results" / "model.json").read_text(encoding="utf-8"))
    return d["spend"]["cost"] / d["score"]["n"]


# ------------------------------------------------------------------ rounding


SUP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")
NUM = r"\d+(?:\.\d+)?"


def _round(value: float, places: int) -> Decimal:
    return Decimal(repr(float(value))).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def _places(s: str) -> int:
    return len(s.split(".")[1]) if "." in s else 0


def _sci(stated: str):
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(?:[×x]\s*10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)|e(-?\d+))", stated.strip())
    if not m:
        return None
    exp = int((m.group(2) or "").translate(SUP) or m.group(3))
    return m.group(1), exp


def fmt_like(stated: str, value) -> str:
    """value written with the stated string's precision and form."""
    if isinstance(value, str):
        return value
    if stated.strip().startswith("$"):
        return "$" + fmt_like(stated.strip()[1:], value)
    s = stated.strip().lstrip("p= ")
    if isinstance(value, tuple):
        pct = s.endswith("%")
        parts = re.findall(NUM, s)
        if len(parts) != 2:
            return f"{value[0]:.3f}–{value[1]:.3f}"
        lo, hi = ((v * 100 if pct else v) for v in value)
        return f"{_round(lo, _places(parts[0]))}–{_round(hi, _places(parts[1]))}" + ("%" if pct else "")
    if s.startswith("<"):
        return f"{value:.2g}"
    sci = _sci(s)
    if sci:
        mant, exp = sci
        return f"{_round(value / 10 ** exp, _places(mant))}e{exp}"
    pct = s.endswith("%")
    num = re.search(NUM, s)
    if not num:
        return repr(value)
    return f"{_round(value * 100 if pct else value, _places(num.group(0)))}" + ("%" if pct else "")


def matches(stated: str, value) -> bool:
    """Does the stated text equal the recomputed value at the stated precision (round half up)?"""
    if isinstance(value, str):
        return stated == value
    s = stated.strip().lstrip("$p= ")
    if s.startswith("<"):
        return value < float(re.search(NUM, s).group(0))
    if isinstance(value, tuple):
        parts = re.findall(NUM, s)
        return len(parts) == 2 and fmt_like(stated, value) == f"{parts[0]}–{parts[1]}" + ("%" if s.endswith("%") else "")
    sci = _sci(s)
    if sci:
        mant, exp = sci
        return _round(value / 10 ** exp, _places(mant)) == Decimal(mant)
    num = re.search(NUM, s)
    if not num:
        return False
    return _round(value * 100 if s.endswith("%") else value, _places(num.group(0))) == Decimal(num.group(0))


# ------------------------------------------------------------------ claims


@dataclass
class Claim:
    label: str
    where: str
    stated: str
    recomputed: str
    status: str  # OK, MISMATCH, MISSING (the text was not found), UNVERIFIABLE

    @property
    def ok(self) -> bool:
        return self.status in ("OK", "UNVERIFIABLE")


@dataclass
class Auditor:
    claims: list[Claim] = field(default_factory=list)
    _cache: dict = field(default_factory=dict)

    def _lines(self, rel: str) -> list[str]:
        if rel not in self._cache:
            self._cache[rel] = (REPO / rel).read_text(encoding="utf-8").splitlines()
        return self._cache[rel]

    def check(self, label: str, rel: str, pattern: str, value, *, flags=0) -> None:
        """Find pattern (its first group is the stated value) in the file; compare it with value. Every line that
        matches is a claim of its own."""
        found = False
        for i, line in enumerate(self._lines(rel), 1):
            for m in re.finditer(pattern, line, flags):
                found = True
                stated = m.group(1)
                ok = matches(stated, value)
                self.claims.append(Claim(label, f"{rel}:{i}", stated, fmt_like(stated, value),
                                         "OK" if ok else "MISMATCH"))
        if not found:
            self.claims.append(Claim(label, f"{rel}:?", "(not found)", f"{value:.3g}" if not isinstance(
                value, (str, tuple)) else str(value), "MISSING"))

    def note(self, label: str, where: str, stated: str, why: str) -> None:
        self.claims.append(Claim(label, where, stated, why, "UNVERIFIABLE"))


def _reasons_text(c: Counter, order: list[str], sep=", ", space=" ") -> str:
    return sep.join(f"{k}{space}{c[k]}" for k in order)


def _py_literals(rel: str, names: set[str]) -> dict:
    tree = ast.parse((REPO / rel).read_text(encoding="utf-8"))
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id in names:
                out[node.targets[0].id] = ast.literal_eval(node.value)
    return out


def claims() -> list[Claim]:
    raw = raw_summaries()
    an = analyst_numbers()
    ho = heldout_check()
    A = Auditor()
    W = wilson_ci
    F = fisher_two
    ft = raw["final_test"]
    wil30 = ft.ci

    PRE = "docs/superpowers/notes/2026-10-23-bigtest-prereg.md"
    DIS = "docs/superpowers/notes/2026-10-21-distill-prereg.md"
    ANL = "docs/superpowers/notes/2026-10-25-failure-analyst.md"
    RUN = "docs/superpowers/notes/2026-10-26-gpu-runbook.md"
    PR = "docs/superpowers/notes/2026-10-26-pr-live-13.md"
    TT = "docs/superpowers/notes/2026-10-26-test-track-final.md"
    BUGS = "docs/superpowers/notes/2026-10-26-site-bugs.md"
    RD = "README.md"
    DEV = "docs/submission/2026-10-26-devpost-draft.md"
    SUB = "docs/submission/README.md"
    DESC = "docs/submission/description.md"

    # --- the big test, from its raw episodes
    A.check("v2 30/40 Wilson 95%", PRE, r"30/40 \(75%\), Wilson 95% CI (" + NUM + "–" + NUM + ")", wil30)
    A.check("v2 30/40 Wilson 95%", PR, r"30/40, Wilson (" + NUM + "–" + NUM + ")", wil30)
    A.check("v2 30/40 Wilson 95%", PR, r"30/40 \(75%, Wilson (" + NUM + "–" + NUM + "%)", wil30)
    A.check("v2 30/40 Wilson 95%", TT, r"30/40, Wilson 95% (" + NUM + "–" + NUM + ")", wil30)
    A.check("v2 30/40 Wilson 95%", BUGS, r"30/40 v2 with Wilson (" + NUM + "–" + NUM + "%)", wil30)
    A.check("v2 30/40 Wilson 95%", ANL, r"\*\*30/40\*\* \(Wilson (" + NUM + "–" + NUM + ")", wil30)
    A.check("v2 30/40 Wilson 95%", RD, r"\*\*30 / 40 \(75%\)\*\* \| \*\*(" + NUM + "–" + NUM + "%)", wil30)
    A.check("v2 30/40 Wilson 95%", DEV, r"30/40 \(75%\), Wilson (" + NUM + "–" + NUM + ")", wil30)
    A.check("v2 30/40 rate", PRE, r"30/40 \((75%)\), Wilson", ft.rate)
    A.check("v2 test seeds", PRE, r"Run once on (5400–5439)", f"{ft.seeds[0]}–{ft.seeds[1]}")
    A.check("v2 failures, all at the time limit", PRE, r"\*\*Failures:\*\* (\d+), all at the time limit",
            str(ft.ended_by["time_limit"]))
    A.check("v2 failure reasons", PRE, r"Reasons: (dropped \d+, not_in_bin \d+, collision \d+, gripper_closed \d+)",
            _reasons_text(ft.reasons, ["dropped", "not_in_bin", "collision", "gripper_closed"]))
    A.check("v2 failure reasons", PR, r"Reasons: (dropped \d+, not in bin \d+, collision \d+, gripper closed)",
            f"dropped {ft.reasons['dropped']}, not in bin {ft.reasons['not_in_bin']}, collision "
            f"{ft.reasons['collision']}, gripper closed")
    A.check("v2 failed seeds", PRE, r"Failed seeds: ([\d, ]+)\.", ", ".join(map(str, ft.failed_seeds)))
    A.check("v2 drops in its failures", DEV, r"dropped in (\d+) of v2's 10 test failures", str(ft.reasons["dropped"]))
    A.check("v2 vs v1 15/40, two-sided Fisher", PRE, r"vs v1 15/40 \(two-sided Fisher, descriptive: different seeds\) \| p = (" + NUM + ")", F(30, 40, 15, 40))
    A.check("v2 vs SANT 3/40, two-sided Fisher", PRE, r"vs mouse SANT 3/40 \(descriptive\) \| p = ([\d.]+ × 10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)", F(30, 40, 3, 40))
    A.check("v2 vs raw 0/40, two-sided Fisher", PRE, r"vs mouse raw 0/40 \(descriptive\) \| p = ([\d.]+ × 10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)", F(30, 40, 0, 40))
    A.check("v2 vs scripted 17/40, two-sided Fisher", PRE, r"vs scripted multiply 17/40 \(reference only\) \| p = (" + NUM + ")", F(30, 40, 17, 40))
    A.check("v2 vs v1, two-sided Fisher", PR, r"v1 15/40, p = (" + NUM + ")", F(30, 40, 15, 40))
    A.check("v2 vs SANT, two-sided Fisher", PR, r"SANT 3/40, p = (\d×10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)", F(30, 40, 3, 40))
    A.check("v2 vs raw, two-sided Fisher", PR, r"raw 0/40, p = (\d×10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)", F(30, 40, 0, 40))
    A.check("v2 vs v1, two-sided Fisher", DEV, r"v1 15/40 p = (" + NUM + ")", F(30, 40, 15, 40))
    A.check("v2 vs SANT, two-sided Fisher", DEV, r"SANT 3/40 p = (\de-\d+)", F(30, 40, 3, 40))
    A.check("v2 vs raw, two-sided Fisher", DEV, r"raw 0/40 p = (\de-\d+)", F(30, 40, 0, 40))
    A.check("v2 vs v1, two-sided Fisher (CITED)", "src/app/routers/flow.py", r'"(p = 0\.0014)"', F(30, 40, 15, 40))

    # --- selection, DAgger, Stage B, from their raw episodes
    for stage, rel_rows in (("stageA", ["60k", "120k", "180k"]), ("stageB", ["60k", "120k", "180k"])):
        for ck in rel_rows:
            s = raw[f"{stage}_{ck}"]
            # the note orders reasons its own way; compare as a multiset
            pat = (r"\| \**%s\** \| \**(\d+/29)\** \| [a-z_ \d,]+ \|" % ck)
            lines = A._lines(PRE)
            hits = [(i, m) for i, l in enumerate(lines, 1) for m in [re.search(pat, l)] if m]
            want_seeds = (5500, 5528) if stage == "stageA" else (5529, 5557)
            for i, m in hits:
                near = next(l for l in reversed(lines[: i - 1]) if "5500–5528" in l or "5529–5557" in l)
                if ("5500–5528" in near) != (stage == "stageA"):
                    continue
                rs = re.search(r"\| ([a-z_ \d,]+) \|\s*$", lines[i - 1]).group(1)
                stated_c = Counter({k: int(v) for k, v in re.findall(r"([a-z_]+) (\d+)", rs)})
                A.claims.append(Claim(f"{stage} {ck} selection count", f"{PRE}:{i}", m.group(1),
                                      f"{s.successes}/{s.n}", "OK" if m.group(1) == f"{s.successes}/{s.n}" else "MISMATCH"))
                A.claims.append(Claim(f"{stage} {ck} failure reasons", f"{PRE}:{i}", rs.strip(),
                                      _reasons_text(s.reasons, [k for k, _ in re.findall(r"([a-z_]+) (\d+)", rs)]),
                                      "OK" if stated_c == s.reasons else "MISMATCH"))
            assert s.seeds == want_seeds, (stage, ck, s.seeds)
    d = raw["dagger_r1"]
    A.check("DAgger r1 student success", PRE, r"Student success: (\d+/\d+ \(\d+%\))", f"{d.successes}/{d.n} ({round(100 * d.rate)}%)")
    A.check("DAgger r1 time limits", PRE, r"; (\d+) hit the time limit", str(d.ended_by["time_limit"]))
    A.check("DAgger r1 failure reasons", PRE, r"\*\*Failure reasons:\*\* (not_in_bin \d+, dropped \d+, collision \d+, gripper_closed \d+)",
            _reasons_text(d.reasons, ["not_in_bin", "dropped", "collision", "gripper_closed"]))
    frames = json.loads((RESULTS / "dagger_r1" / "rollouts_done.json").read_text())["frames"]
    A.check("DAgger r1 frames", PRE, r"\*\*Frames:\*\* ([\d,]+) labelled", f"{frames:,}")
    A.check("DAgger r1 frames (rows)", PRE, r"\*\*Frames:\*\* ([\d,]+) labelled",
            f"{sum(int(r['frames']) for r in load_rows(RAW_FILES['dagger_r1'])):,}")
    a180 = raw["stageA_180k"]
    A.check("selection vs test", PRE, r"(\d+/29 \(\d+%\)) on selection vs 30/40",
            f"{a180.successes}/{a180.n} ({round(100 * a180.rate)}%)")

    # --- the failure analyst (raw rows + sample_scene)
    A.check("analyst: episodes", ANL, r"\*\*Input:\*\* (\d+) episodes", str(an["episodes"]))
    A.check("analyst: successes", ANL, r"(\d+) succeeded\. The 18 failures", str(an["successes"]))
    A.check("analyst: failures by class", ANL, r"The \d+ failures are (\d+ dropped and \d+ collision)",
            f"{an['primary'].get('dropped', 0)} dropped and {an['primary'].get('collision', 0)} collision")
    A.check("analyst: drops inside the region", ANL, r"It holds (\d+ of the \d+) drops",
            f"{an['hits_inside']} of the {an['hits_total']}")
    A.check("analyst: rate inside", ANL, r"a rate of (" + NUM + ") inside", an["rate_inside"])
    A.check("analyst: rate outside", ANL, r"inside vs (" + NUM + ") outside", an["rate_outside"])
    for rel in (ANL, RD, DEV, RUN, "src/app/routers/flow.py"):
        A.check("analyst: region p (one-sided Fisher)", rel, r"p = (0\.092)\b", an["p_one_sided"])
    A.check("analyst: region p, two-sided", ANL, r"two-sided (" + NUM + r")\), just under", an["p_two_sided"])
    A.check("held-out: p, two-sided", ANL, r"one-sided p = 0\.11 \(two-sided (" + NUM + r")\)", ho["p_two_sided"])
    A.check("held-out: one-sided p (table row)", DEV, r"on 5 unseen checkpoints p = (" + NUM + r") \(both one-sided\)", ho["p_one_sided"])
    A.check("held-out: direction holds", RD, r"it held in (\d+ of the \d+) checkpoints",
            f"{ho['direction_holds']} of the {ho['checkpoints']}")
    A.check("analyst: rules box holds", ANL, r"rules baseline's box holds (\d+) of 69", "56")
    A.check("held-out: drops inside", ANL, r"drop rate was (\d+/\d+ \(" + NUM + r"\))",
            f"{ho['hits_in']}/{ho['n_in']} ({_round(ho['hits_in'] / ho['n_in'], 2)})")
    A.check("held-out: drops outside", ANL, r"outside (\d+/\d+ \(" + NUM + r"\))",
            f"{ho['hits_out']}/{ho['n_out']} ({_round(ho['hits_out'] / ho['n_out'], 2)})")
    A.check("held-out: direction holds", ANL, r"^\s*(\d+ of \d+) checkpoints", f"{ho['direction_holds']} of {ho['checkpoints']}")
    for rel in (ANL, RD, DEV, RUN):
        A.check("held-out: p is one-sided Fisher", rel, r"one-sided p = (0\.11)\b", ho["p_one_sided"])
    for rel in (RD, DEV):
        A.check("held-out: drop rates", rel, r"\((" + NUM + r" vs " + NUM + r") drop rate",
                f"{_round(ho['hits_in'] / ho['n_in'], 2)} vs {_round(ho['hits_out'] / ho['n_out'], 2)}")
    A.check("analyst: 17 of 18 failures were drops", RD, r"(\d+ of \d+) failures were drops",
            f"{an['primary']['dropped']} of {sum(an['primary'].values())}")
    A.check("analyst: 69 real episodes", DEV, r"on v2's (\d+) real episodes", str(an["episodes"]))

    analysis = ANALYSIS_DIR / "analysis.json"
    if analysis.is_file():
        aj = json.loads(analysis.read_text(encoding="utf-8"))
        A.check("analyst: cost", ANL, r"5 calls, (\$" + NUM + ")", aj["cost_usd"])
        A.check("analyst: agreement", ANL, r"agreement (" + NUM + r")\)", aj["agreement"])
        A.check("analyst: cost (CITED)", "src/app/routers/flow.py", r'"(\$' + NUM + r'), agreement', aj["cost_usd"])
        A.check("analyst: region p in analysis.json", ANL, r"p = (0\.092)\b", aj["support"][0]["p_value"])
    else:
        A.note("analyst: cost and agreement", f"{ANL}:75", "$0.042, agreement 0.83",
               "data/analysis/bigtest_final/analysis.json is not in git")

    # --- the climb and the other rows, from the counts the notes state
    for rel, pat, k, n in [
        (RD, r"\| Imitating the 10 raw mouse demos \| 0 / 40 \| (" + NUM + "–" + NUM + "%)", 0, 40),
        (RD, r"\| Imitating the SANT-verified, multiplied demos \| 3 / 40 \| (" + NUM + "–" + NUM + "%)", 3, 40),
        (RD, r"\| v1: the RL teacher distilled into the camera policy \| 15 / 40 \| (" + NUM + "–" + NUM + "%)", 15, 40),
        (PR, r"raw mouse demos \| 0/40 \| (" + NUM + "–" + NUM + "%)", 0, 40),
        (PR, r"SANT-verified demos \| 3/40 \| (" + NUM + "–" + NUM + "%)", 3, 40),
        (PR, r"\(PR #43\) \| 15/40 \| (" + NUM + "–" + NUM + "%)", 15, 40),
        (RD, r"\*\*3 / 40 \(7\.5%\)\*\* \| (" + NUM + "–" + NUM + "%)", 3, 40),
        (RD, r"\*\*17 / 40 \(42\.5%\)\*\* \| (" + NUM + "–" + NUM + "%)", 17, 40),
        (RD, r"\*\*0 / 40\*\* \(95% CI (" + NUM + "–" + NUM + "%)", 0, 40),
        (RD, r"\*\*3 / 40\*\* \((" + NUM + "–" + NUM + "%)", 3, 40),
        (DEV, r"\*\*15/40\*\* \(Wilson (" + NUM + "–" + NUM + ")", 15, 40),
        (DEV, r"\(Wilson (" + NUM + "–" + NUM + r") vs 0–0\.03\)", 113, 128),
        (DEV, r"vs (0–" + NUM + r")\)", 0, 128),
        (SUB, r"\*\*3/40\*\* \(7\.5%, (" + NUM + "–" + NUM + "%)", 3, 40),
        (SUB, r"\*\*17/40\*\* \(42\.5%, (" + NUM + "–" + NUM + "%)", 17, 40),
        (SUB, r"\*\*16/40\*\* \(40\.0%, (" + NUM + "–" + NUM + "%)", 16, 40),
        (SUB, r"\*\*20/40\*\* \(50\.0%, (" + NUM + "–" + NUM + "%)", 20, 40),
        (SUB, r"Nemotron edits \*\*5/10\*\* \((" + NUM + "–" + NUM + "%)", 5, 10),
        (SUB, r"rules \*\*3/10\*\* \((" + NUM + "–" + NUM + "%)", 3, 10),
        (SUB, r"Nemotron edits \*\*2/10\*\* \((" + NUM + "–" + NUM + "%)", 2, 10),
        (SUB, r"Raw \*\*0/40\*\* \(Wilson 95% (" + NUM + "–" + NUM + "%)", 0, 40),
        (SUB, r"SANT \*\*3/40\*\* \((" + NUM + "–" + NUM + "%)", 3, 40),
        (SUB, r"\*\*40/40\*\* \((" + NUM + "–" + NUM + "%)", 40, 40),
        (SUB, r"\*\*59/60\*\* \((" + NUM + "–" + NUM + "%)", 59, 60),
        (SUB, r"SANT verified 91/111 \(82\.0%, Wilson 95% (" + NUM + "–" + NUM + "%)", 91, 111),
        (SUB, r"\(7\.5%, Wilson 95% \*\*(" + NUM + "–" + NUM + "%)", 3, 40),
        (PRE, r"15/40 \(Wilson (" + NUM + "–" + NUM + r")\)", 15, 40),
        (DIS, r"\*\*15/40 \(37\.5%\), Wilson 95% CI (" + NUM + "–" + NUM + ")", 15, 40),
        (DIS, r"\*\*113/128 \(88\.3%\)\*\* \| (" + NUM + "–" + NUM + ")", 113, 128),
        (DIS, r"\*\*0/128 \(0%\)\*\* \| (" + NUM + "–" + NUM + ")", 0, 128),
        (DIS, r"\b10/128 \((" + NUM + "–" + NUM + ")", 10, 128),
        (DIS, r"\b99/128 \((" + NUM + "–" + NUM + ")", 99, 128),
        (DIS, r"\b109/128 \((" + NUM + "–" + NUM + ")", 109, 128),
        (DIS, r"\*\*The replay verify \(the gate number\): 3/50\*\* \(Wilson (" + NUM + "–" + NUM + ")", 3, 50),
        (DIS, r"50/50 \(Wilson 95% (" + NUM + "–" + NUM + ")", 50, 50),
    ]:
        A.check(f"Wilson {k}/{n}", rel, pat, W(k, n))

    for rel, pat, val, label in [
        (RD, r"\*\*Fisher exact p = (" + NUM + r")\.\*\*", F(17, 40, 3, 40), "3/40 vs 17/40"),
        (DEV, r"\*\*3/40 vs 17/40\*\*, Fisher \*\*p = (" + NUM + ")", F(17, 40, 3, 40), "3/40 vs 17/40"),
        (DEV, r"3/40 → 17/40 \(p = (" + NUM + ")", F(17, 40, 3, 40), "3/40 vs 17/40"),
        (SUB, r"\*\*17/40\*\* \(42\.5%, [\d.–%]+\), \*\*p = (" + NUM + ")", F(17, 40, 3, 40), "3/40 vs 17/40"),
        (DESC, r"\(Fisher \*\*p = (" + NUM + r")\*\*\)", F(17, 40, 3, 40), "3/40 vs 17/40"),
        (DESC, r"3/40 vs 17/40 \(p = (" + NUM + ")", F(17, 40, 3, 40), "3/40 vs 17/40"),
        ("web/src/site/results/facts.ts", r"Fisher p (< " + NUM + ")", F(17, 40, 3, 40), "3/40 vs 17/40"),
        ("src/app/routers/flow.py", r'"(0\.00055)"', F(17, 40, 3, 40), "3/40 vs 17/40 (CITED)"),
        (SUB, r"vs raw 3/40 \*\*p = (" + NUM + ")", F(16, 40, 3, 40), "16/40 vs 3/40"),
        (DESC, r"p = (" + NUM + r") vs 3/40", F(16, 40, 3, 40), "16/40 vs 3/40"),
        ("web/src/site/results/facts.ts", r"same 3/40 \(p = (" + NUM + ")", F(16, 40, 3, 40), "16/40 vs 3/40"),
        (SUB, r"vs 10×10 17/40 p = (" + NUM + ")", F(16, 40, 17, 40), "16/40 vs 17/40"),
        (SUB, r"vs 17/40, \*\*p = (" + NUM + ")", F(20, 40, 17, 40), "20/40 vs 17/40"),
        (DESC, r"20/40 vs 17/40, p = (" + NUM + ")", F(20, 40, 17, 40), "20/40 vs 17/40"),
        (RD, r"Fisher p = (" + NUM + r"): not significant", F(3, 40, 0, 40), "0/40 vs 3/40"),
        (RD, r"0/40 vs 3/40, p = (" + NUM + ")", F(3, 40, 0, 40), "0/40 vs 3/40"),
        (DEV, r"\*\*0/40 vs 3/40\*\*, p = (" + NUM + ")", F(3, 40, 0, 40), "0/40 vs 3/40"),
        (SUB, r"Fisher \*\*p = (" + NUM + r")\*\*\. SANT", F(3, 40, 0, 40), "0/40 vs 3/40"),
        (SUB, r"\*\*Fisher p = (" + NUM + r"), not significant", F(3, 40, 0, 40), "0/40 vs 3/40"),
        (DESC, r"Fisher \*\*p = (" + NUM + r"): not significant", F(3, 40, 0, 40), "0/40 vs 3/40"),
        (DIS, r"\| \*\*vs the mouse SANT arm\*\* \(same data, no teacher\) \| 3/40 \| \*\*(" + NUM + r")\*\*", F(15, 40, 3, 40), "v1 15/40 vs 3/40"),
        (DIS, r"\| \*\*vs the mouse raw arm\*\* \| 0/40 \| \*\*([\d.]+ × 10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)\*\*", F(15, 40, 0, 40), "v1 15/40 vs 0/40"),
        (DIS, r"\| 17/40 \| (" + NUM + r") \| no detectable", F(15, 40, 17, 40), "v1 15/40 vs 17/40"),
        (RD, r"82% vs 80%, p = (" + NUM + ")", F(91, 111, 24, 30), "Mimic 91/111 vs 24/30"),
        (DEV, r"82% vs 80% \(p = (" + NUM + ")", F(91, 111, 24, 30), "Mimic 91/111 vs 24/30"),
        (SUB, r"82% vs 80%, p = (" + NUM + ")", F(91, 111, 24, 30), "Mimic 91/111 vs 24/30"),
        (RD, r"\*\*McNemar p = (" + NUM + ")", mcnemar_exact(0, 2), "repair A/B 5/10 vs 3/10, paired"),
        (RD, r"rules' 3/10 \(McNemar p = (" + NUM + ")", mcnemar_exact(0, 2), "repair A/B 5/10 vs 3/10, paired"),
        (RD, r"^\s*\(McNemar p = (" + NUM + r")\)\. Neither is significant", mcnemar_exact(2, 1), "repair re-run 2/10 vs 3/10, paired"),
        (RD, r"5/10 vs rules 3/10 \(McNemar p = (" + NUM + ")", mcnemar_exact(0, 2), "repair A/B, paired"),
        (RD, r"re-run 2/10 vs 3/10 \(McNemar p = (" + NUM + ")", mcnemar_exact(2, 1), "repair re-run, paired"),
        (DEV, r"5/10 vs 3/10 \(McNemar p = (" + NUM + ")", mcnemar_exact(0, 2), "repair A/B, paired"),
        (DEV, r"\*\*2/10 vs 3/10\*\* in the re-run \(McNemar p = (" + NUM + ")", mcnemar_exact(2, 1), "repair re-run, paired"),
        (SUB, r"\*\*Exact McNemar p = (" + NUM + "), not significant", mcnemar_exact(0, 2), "repair A/B, paired"),
        (SUB, r"\*\*Exact McNemar p = (" + NUM + r")\.\*\*", mcnemar_exact(2, 1), "repair re-run, paired"),
        (RD, r"not significant \(p = (" + NUM + r")\), and one person", mcnemar_exact(*_r6_discordant()), "R6 34/34 vs 31/34, paired"),
        (RD, r"and (\$" + NUM + r") per repair request", r6_cost_per_request(), "R6 cost per request"),
    ]:
        A.check(label, rel, pat, val)
    m, k, n = r6_counts()
    A.check("R6 model exact", RD, r"Nemotron turned (\d+/\d+) into the right repair", f"{m}/{n}")
    A.check("R6 keywords exact", RD, r"against (\d+/\d+) for a keyword parser", f"{k}/{n}")

    # --- web data modules
    _check_results_json(A)
    _check_proof_data(A, raw)
    A.check("17/40 Wilson as %", "web/src/site/results/facts.ts", r"17/40 \(43%, 95% CI (" + NUM + "–" + NUM + "%)", W(17, 40))
    A.check("3/40 Wilson as %", "web/src/site/results/facts.ts", r"vs 3/40 \(8%, (" + NUM + "–" + NUM + "%)", W(3, 40))
    A.check("power at n = 40, 42% vs 60%", "web/src/site/results/results.json", r"a gap like (42% to 60%) would usually go undetected",
            "42% to 60%" if fisher_power(0.425, 0.6, 40) < 0.5 else "(power >= 0.5)")

    # --- the backend's cited fallbacks
    lit = _py_literals("src/app/routers/flow.py", {"MULTIPLY", "FINAL_TEST", "ANALYSE"})
    FL = "src/app/routers/flow.py"
    A.claims.append(_lit_claim("FINAL_TEST", FL, lit["FINAL_TEST"], {"k": ft.successes, "n": ft.n, "ci": [
        float(_round(c, 3)) for c in wil30]}))
    A.claims.append(_lit_claim("MULTIPLY before", FL, lit["MULTIPLY"]["before"], {"k": 3, "n": 40, "ci": [float(_round(c, 3)) for c in W(3, 40)]}))
    A.claims.append(_lit_claim("MULTIPLY after", FL, lit["MULTIPLY"]["after"], {"k": 17, "n": 40, "ci": [float(_round(c, 3)) for c in W(17, 40)]}))
    A.claims.append(_lit_claim("MULTIPLY p", FL, lit["MULTIPLY"]["p"], float(_round(F(17, 40, 3, 40), 5))))
    want = {"episodes": an["episodes"], "failures": an["episodes"] - an["successes"], "dropped": an["primary"]["dropped"],
            "p_value": float(_round(an["p_one_sided"], 3)), "regions": 1}
    A.claims.append(_lit_claim("ANALYSE (counts, p)", FL, {k: lit["ANALYSE"][k] for k in want}, want))
    if analysis.is_file():
        aj = json.loads(analysis.read_text(encoding="utf-8"))
        want2 = {"k": aj["k"], "calls": aj["calls"], "cost_usd": float(_round(aj["cost_usd"], 3)),
                 "agreement": float(_round(aj["agreement"], 2))}
        A.claims.append(_lit_claim("ANALYSE (run)", FL, {k: lit["ANALYSE"][k] for k in want2}, want2))
    return A.claims


def _r6_discordant() -> tuple[int, int]:
    m, k, n = r6_counts()
    assert m == n, "the discordant split is only known from the margins when one arm is perfect"
    return 0, m - k


def _lit_claim(label: str, rel: str, got, want) -> Claim:
    line = next((i for i, l in enumerate((REPO / rel).read_text(encoding="utf-8").splitlines(), 1)
                 if l.startswith(label.split()[0] + " =")), "?")
    return Claim(label, f"{rel}:{line}", json.dumps(got), json.dumps(want), "OK" if got == want else "MISMATCH")


def _line_of(rel: str, needle: str) -> str:
    for i, line in enumerate((REPO / rel).read_text(encoding="utf-8").splitlines(), 1):
        if needle in line:
            return f"{rel}:{i}"
    return f"{rel}:?"


def _check_results_json(A: Auditor) -> None:
    rel = "web/src/site/results/results.json"
    data = json.loads((REPO / rel).read_text(encoding="utf-8"))
    for exp in data["experiments"]:
        for g in exp["groups"]:
            arms = {a["key"]: a for a in g["arms"]}
            for a in g["arms"]:
                if a.get("k") is None:
                    continue
                where = _line_of(rel, f'"key": "{a["key"]}"')
                if a.get("ci"):
                    stated = "–".join(f"{c:.3f}" for c in a["ci"])
                    ok = all(abs(c - w) < 0.0005 + 1e-12 for c, w in zip(a["ci"], wilson_ci(a["k"], a["n"])))
                    A.claims.append(Claim(f"results.json {exp['id']}.{a['key']} Wilson", where, stated,
                                          "–".join(f"{w:.3f}" for w in wilson_ci(a["k"], a["n"])), "OK" if ok else "MISMATCH"))
                if a.get("outcomes"):
                    ones = a["outcomes"].count("1")
                    A.claims.append(Claim(f"results.json {exp['id']}.{a['key']} outcomes", where, f"{a['k']}/{a['n']}",
                                          f"{ones}/{len(a['outcomes'])}",
                                          "OK" if (ones, len(a["outcomes"])) == (a["k"], a["n"]) else "MISMATCH"))
            for c in g.get("comparisons", []):
                if c.get("p") is None:
                    continue
                a, b = arms[c["a"]], arms[c["b"]]
                if "McNemar" in exp["test"]:
                    if max(a["k"], b["k"]) != a["n"]:
                        A.note(f"results.json {c['a']} vs {c['b']}", _line_of(rel, f'"a": "{c["a"]}"'), str(c["p"]),
                               "paired: needs the per-item outcomes")
                        continue
                    p = mcnemar_exact(0, abs(a["k"] - b["k"]))
                else:
                    p = fisher_two(a["k"], a["n"], b["k"], b["n"])
                stated = f"{c['p']}" if c["p"] != 1 else "1.0"
                A.claims.append(Claim(f"results.json {c['a']} vs {c['b']} p", _line_of(rel, f'"a": "{c["a"]}", "b": "{c["b"]}"'),
                                      stated, fmt_like(stated, p), "OK" if matches(stated, p) else "MISMATCH"))


def _check_proof_data(A: Auditor, raw: dict[str, Summary]) -> None:
    rel = "web/src/site/results/proofData.ts"
    lines = (REPO / rel).read_text(encoding="utf-8").splitlines()
    text = "\n".join(lines)
    for m in re.finditer(r"k: (\d+),\s*n: (\d+),\s*ci: \[(" + NUM + r"), (" + NUM + r")\]", text):
        k, n = int(m.group(1)), int(m.group(2))
        line = text[: m.start()].count("\n") + 1
        lo_s, hi_s = m.group(3), m.group(4)
        lo, hi = wilson_ci(k, n)
        # bounds are printed to 2 or 3 places ("0.53" is 0.530)
        ok = abs(float(lo_s) - lo) <= 0.5 * 10 ** -max(_places(lo_s), 2) + 1e-12 and \
            abs(float(hi_s) - hi) <= 0.5 * 10 ** -max(_places(hi_s), 2) + 1e-12
        A.claims.append(Claim(f"proofData {k}/{n} Wilson", f"{rel}:{line}", f"{lo_s}–{hi_s}", f"{lo:.3f}–{hi:.3f}",
                              "OK" if ok else "MISMATCH"))
    ft = raw["final_test"]
    for key in ("dropped", "not_in_bin", "collision", "gripper_closed"):
        m = re.search(r'key: "%s", label: "[^"]+", count: (\d+)' % key, text)
        line = text[: m.start()].count("\n") + 1
        A.claims.append(Claim(f"proofData v2 reason {key}", f"{rel}:{line}", m.group(1), str(ft.reasons[key]),
                              "OK" if int(m.group(1)) == ft.reasons[key] else "MISMATCH"))
    m = re.search(r"failedSeeds: \[([\d, ]+)\]", text)
    stated = [int(x) for x in m.group(1).split(",")]
    A.claims.append(Claim("proofData v2 failed seeds", f"{rel}:{text[: m.start()].count(chr(10)) + 1}", str(stated),
                          str(ft.failed_seeds), "OK" if stated == ft.failed_seeds else "MISMATCH"))
    for key, want in (("total", ft.n - ft.successes), ("timedOut", ft.ended_by["time_limit"])):
        m = re.search(r"\b%s: (\d+)," % key, text)
        A.claims.append(Claim(f"proofData v2 failures {key}", f"{rel}:{text[: m.start()].count(chr(10)) + 1}", m.group(1),
                              str(want), "OK" if int(m.group(1)) == want else "MISMATCH"))
    b = raw["stageB_120k"], raw["stageB_180k"]
    m = re.search(r'figure: "(\d+–\d+/29)"', text)
    A.claims.append(Claim("proofData Stage B drop", f"{rel}:{text[: m.start()].count(chr(10)) + 1}", m.group(1),
                          f"{b[0].successes}–{b[1].successes}/29", "OK" if m.group(1) == f"{b[0].successes}–{b[1].successes}/29" else "MISMATCH"))


# ------------------------------------------------------------------ extras (post-hoc, for the judges)


def min_detectable(p_base: float, n: int = 40, power: float = 0.8, step: float = 0.005, up: bool = True) -> float | None:
    """The smallest true rate (above p_base if up, else below) that two-sided Fisher at alpha 0.05 detects with the
    given power, n per arm."""
    p = p_base
    while 0.0 <= p <= 1.0:
        p = round(p + (step if up else -step), 6)
        if not 0.0 <= p <= 1.0:
            return None
        if fisher_power(p_base, p, n) >= power:
            return p
    return None


def extras() -> dict:
    raw = raw_summaries()
    an = analyst_numbers()
    ho = heldout_check()
    a180, ft = raw["stageA_180k"], raw["final_test"]
    out = {
        "selection_vs_test": {"selection": (a180.successes, a180.n), "test": (ft.successes, ft.n),
                              "p_two_sided": fisher_two(a180.successes, a180.n, ft.successes, ft.n)},
        "stageA_trend": [(k, raw[k].successes, raw[k].n, raw[k].ci) for k in ("stageA_60k", "stageA_120k", "stageA_180k")],
        "stageA_60k_vs_180k_p": fisher_two(21, 29, 13, 29),
        "stageB_drop": {"60k_vs_120k_p": fisher_two(16, 29, 7, 29), "60k_vs_180k_p": fisher_two(16, 29, 8, 29),
                        "60k_vs_120k_180k_pooled_p": fisher_two(16, 29, 15, 58)},
        "dagger_r1": (raw["dagger_r1"].successes, raw["dagger_r1"].n, raw["dagger_r1"].ci),
        "v2_failures": {"n": ft.n - ft.successes, "reasons": dict(ft.reasons), "ended_by": dict(ft.ended_by)},
        "analyst_success_by_region": {"inside": an["success_inside"], "outside": an["success_outside"],
                                      "p_two_sided": fisher_two(*an["success_inside"], *an["success_outside"])},
        "analyst_region_p_two_sided": an["p_two_sided"],
        "heldout": ho,
        "power_n40": {f"{b:.3f}": {"up": min_detectable(b), "down": min_detectable(b, up=False)}
                      for b in (0.075, 0.375, 0.5, 0.75)},
        "power_examples": {"0.75 vs 0.90": fisher_power(0.75, 0.90, 40), "0.75 vs 0.50": fisher_power(0.75, 0.50, 40),
                           "0.075 vs 0.25": fisher_power(0.075, 0.25, 40), "0.425 vs 0.60": fisher_power(0.425, 0.60, 40)},
    }
    if (ANALYSIS_DIR / "analysis.json").is_file():
        aj = json.loads((ANALYSIS_DIR / "analysis.json").read_text(encoding="utf-8"))
        out["analyst_cost"] = {"total_usd": aj["cost_usd"], "calls": aj["calls"], "per_call_usd": aj["cost_usd"] / aj["calls"],
                               "per_failure_read_usd": aj["cost_usd"] / (an["episodes"] - an["successes"])}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--extras", action="store_true", help="also print the post-hoc extra numbers")
    ap.add_argument("--only-bad", action="store_true", help="print only mismatches and missing texts")
    args = ap.parse_args(argv)
    raw = raw_summaries()
    print("RAW RESULTS")
    print(f"{'file':14} {'k/n':>7} {'rate':>6} {'Wilson 95%':>13}  seeds        errors  reasons")
    for name, s in raw.items():
        print(f"{name:14} {s.successes:>3}/{s.n:<3} {s.rate:6.3f} {s.ci[0]:.3f}–{s.ci[1]:.3f}  {s.seeds[0]}–{s.seeds[1]}  "
              f"{s.errors:>6}  {dict(s.reasons)}")
    cs = claims()
    print(f"\nCLAIMS ({len(cs)})")
    print(f"{'status':12} {'claim':48} {'stated':>22} {'recomputed':>22}  where")
    for c in cs:
        if args.only_bad and c.ok:
            continue
        print(f"{c.status:12} {c.label[:48]:48} {c.stated[:22]:>22} {c.recomputed[:22]:>22}  {c.where}")
    bad = [c for c in cs if not c.ok]
    print(f"\n{len(cs) - len(bad)} OK or unverifiable, {len(bad)} mismatched or missing")
    if args.extras:
        print("\nEXTRAS (post-hoc)")
        for k, v in extras().items():
            print(f"  {k}: {v}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
