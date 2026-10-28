# Math audit of the submission's numbers (2026-10-29)

Nothing is committed. Nothing was run on Isaac: every number here is recomputed from files already in the repo.

## How

`scripts/audit_numbers.py` (tests: `tests/test_audit_numbers.py`) recomputes every number from the committed raw
results, then finds each place the number is stated and compares it at the precision it is printed (rounding half up).

```
uv run python scripts/audit_numbers.py            # the claims table: claim, file:line, stated, recomputed, status
uv run python scripts/audit_numbers.py --extras   # plus the post-hoc numbers below
```

- **Raw inputs:**
  - `2026-10-23-bigtest/results/`: the final test (5400–5439), Stage A and Stage B selection, and the DAgger round-1
    rollouts;
  - `2026-10-17-r6-results/`: the request-translation rows.
- **How the analyst's numbers are rebuilt:** the same way `analyze_failures.py --results-only` builds them.
  - Each episode's scene comes from its seed (`sample_scene`), and its class from its reasons.
  - The region's support comes from `data_recipe.region_support`.
  - `data/analysis/` is not in git, so the run's cost and agreement are checked only where that folder exists (this
    Mac).
- **Older tests whose raw rows are not in the repo** (3/40 vs 17/40, raw vs SANT, Mimic, the repair A/B, the
  labeler/judge): checked arithmetically. Their Wilson intervals and p-values must follow from the counts the notes
  state.
- **Statistics:** `demo_pipeline.stats` (Wilson, two-sided Fisher, exact McNemar, Fisher power) and
  `data_recipe.fisher_greater` (one-sided Fisher). No scipy; it is not a dependency.

**Coverage:** 197 stated numbers in these files:
- README.md;
- the 10-26 Devpost draft, `docs/submission/README.md` and `description.md`;
- the 10-21 and 10-23 to 10-26 notes;
- `results.json`, `proofData.ts` and `facts.ts`;
- `flow.py`'s CITED needles and its fallbacks.

After the fixes below, all 197 match.

## Mismatches found and fixed

| Where | Was | Now | Why |
|---|---|---|---|
| `2026-10-25-failure-analyst.md` §1b, held-out check | "The direction holds in 4 of 5 checkpoints" | "Pooled, the direction holds … Per checkpoint it holds in 3 of 5" | A 60k (5/12 = 0.42 inside vs 11/17 = 0.65 outside) and B 60k (5/14 = 0.36 vs 7/15 = 0.47) go the other way. The pooled 41/66 vs 40/79 matches exactly, so the region and scenes are the same as the scratch script's |
| analyst note §1b, `flow.py` CITED `analyse` + `ANALYSE.cost_usd` | $0.043 | $0.042 | `analysis.json` says `cost_usd` 0.042488, which rounds to $0.042 (report.md's "$0.0425" was rounded a second time). `/metrics` already printed $0.042, and `/flow` printed $0.042 with the cache and $0.043 without it |
| `web/src/site/results/facts.ts` HEADLINE (T3's sentence) | 17/40 "95% CI 28–58%" | "29–58%" | Wilson 0.28509 → 29%. The same slip is still in the historical `2026-10-15-t3-status.md:1172` and in `docs/design/content-spec*.md`, which are left as records |
| README, Devpost, analyst note, runbook: the held-out "p = 0.11" | "p = 0.11" | "one-sided p = 0.11" (the note also gives two-sided 0.18) | The value is the one-sided Fisher. But the submission says its comparisons are two-sided Fisher, and two-sided gives 0.18 |
| README, Devpost, analyst note: the region "p = 0.092" | "p = 0.092" | "one-sided p = 0.092" (the note also gives two-sided 0.16) | Same reason. One-sided is the check's own pre-set test (p ≤ 0.1), so the value is right; only the label was missing |
| README (2 places), Devpost results table: blind repair A/B | "(p = 0.50)", "(p = 1.0)" | "(McNemar p = 0.50)", "(McNemar p = 1.0)" | These are paired exact McNemar tests (discordant 0 vs 2 and 2 vs 1). The Devpost's methods line said "two-sided Fisher", which would give 0.65 for 5/10 vs 3/10. That line now adds "(paired arms with an exact McNemar test)" |

Nothing in David's pre-registered results changed. Every count, interval and p in
`2026-10-23-bigtest-prereg.md` and `2026-10-21-distill-prereg.md` recomputes exactly from the raw files or from its
counts.

**Not fixed: not one of my files.** `web/src/site/flow/model.ts:179` still says "$0.043" in its static fallback. It
should be "$0.042", to match the API.

## Checked and correct (highlights)

- **v2:** 30/40.
  - Wilson 0.59806–0.85813, which is 0.598–0.858, 0.60–0.86, 59.8–85.8% and 0.5981–0.8581 wherever printed.
  - Seeds 5400–5439, no errors. All 10 failures hit the time limit.
  - Reasons: dropped 10, not_in_bin 9, collision 5, gripper_closed 2. The failed seeds match.
- **Descriptive two-sided Fisher, v2 vs:**
  - v1 15/40: 0.0014;
  - SANT 3/40: 5.4 × 10⁻¹⁰;
  - raw 0/40: 1.9 × 10⁻¹³;
  - scripted 17/40: 0.006.
- **Selection:**
  - Stage A: 13 / 17 / 21 of 29 on 5500–5528.
  - Stage B: 16 / 7 / 8 of 29 on 5529–5557.
  - DAgger: 28/40 on 5210–5249, with reasons not_in_bin 11, dropped 11, collision 6, gripper_closed 2, and 29,600
    frames (the per-row frames sum to the same).
  - Every failure-reason tally in the prereg matches.
- **Analyst:**
  - 69 episodes, 51 successes, 17 dropped and 1 collision.
  - The region: 29 episodes inside, 10 of the 17 drops, 0.34 vs 0.18, one-sided p = 0.0918.
  - Held out: 41/66 vs 40/79, one-sided p = 0.111.
  - The rules box holds 56 of 69.
- **v1 and the teacher:**
  - v1 15/40 is 0.242–0.530, with p = 0.0025 vs 3/40 and 1.2 × 10⁻⁵ vs 0/40.
  - The teacher: 113/128 is 0.816–0.928 and 0/128 is 0.000–0.029, and the 10, 99 and 109 of 128 points match too.
  - The gate: 3/50 is 0.02–0.16, and 50/50 is 0.93–1.00.
- **Older rows:**
  - 3/40 vs 17/40: p = 0.000549 (printed 0.0005, 0.00055 and < 0.001, all correct);
  - 16/40: 0.0012 vs 3/40, and 1.0 vs 17/40;
  - 20/40 vs 17/40: 0.65;
  - 0/40 vs 3/40: 0.24;
  - Mimic 91/111 vs 24/30: 0.79;
  - R6 34/34 vs 31/34: McNemar 0.25, at $0.0002 per request.
  - Every Wilson interval in `results.json` and `proofData.ts`, and the outcome strings' counts.
- **Power:** `results.json` says "a gap like 42% to 60% would usually go undetected". Fisher power at n = 40 is 0.29,
  so that holds.

## Not verifiable here (flagged, not changed)

- **The analyst's $0.042 and agreement 0.83:** they come from `data/analysis/bigtest_final/analysis.json`, which is
  git-ignored. They match it on this Mac.
- **The older tests' per-episode rows:** 3/40 vs 17/40, raw vs SANT, Mimic, the repair A/B and the labeler/judge.
  Their counts are not in the repo, so only the arithmetic from the stated counts is checked.
- **The labeler/judge sign tests (p = 1.0):** they follow from the margins only because one arm in each is perfect
  (40/40, 60/60).
- **The Devpost's "2,783 Python tests pass, 35 skipped" and "1,938 web tests"** are already marked TODO (USER). The
  overnight run on this Mac counted 2930 passed and 2131 passed.
- **The Devpost's "It survived three stops and resumes over two days":** the chain ran from 10-23 16:14 to 10-25 18:21.
  That is about 50 hours, but three calendar days. This is a wording choice.

## Extra numbers for the judges (post-hoc; none of this is pre-registered)

- **v2's 10 test failures:**
  - Every one dropped the cube and every one ran out the 30 s limit.
  - As reason sets:
    - not_in_bin + collision + dropped: 4;
    - not_in_bin + dropped: 3;
    - not_in_bin + gripper_closed + dropped: 2;
    - collision + dropped: 1 (5433, which ended in the bin but failed on contact).
  - Classified by the analyst's rules, all 10 are "dropped". The 69-episode set adds 7 drops and 1 collision from
    selection.
- **Selection vs test:** 21/29 (72%) vs 30/40 (75%), two-sided Fisher p = 1.0. Selection did not overstate this time.
- **Stage A's climb with training length:** 13 → 17 → 21 of 29. 60k vs 180k: p = 0.061.
- **Stage B's drop after the resume:**
  - 60k 16/29 vs 120k 7/29: p = 0.031.
  - 60k vs 180k 8/29: p = 0.061.
  - 60k vs the two post-resume checkpoints pooled (15/58): p = 0.0095.
  - Post-hoc and on the same seeds, so this is descriptive only.
- **Success per scene region (the analyst's region):**
  - inside 19/29 (66%) vs outside 32/40 (80%), two-sided p = 0.27;
  - for drops, the region's two-sided p is 0.16.
  - Not meaningful as a finding.
- **The cost of a Nemotron analysis:**
  - $0.042 for 5 calls (k = 3 samples), so about $0.0085 per call;
  - about $0.0024 per failed episode read (18).
  - Across the 5 cached analyses in `data/analysis/` (bigtest_final, stage_a_60k/120k, stage_b_60k/180k, 3 samples
    each, written 10-29, git-ignored): $0.019–$0.042 each, $0.139 in all, mean $0.028, with 3–6 calls each.
- **Power at n = 40 per arm** (exact, two-sided Fisher, α = 0.05, 80% power; assumption: the true rates are the
  observed ones):
  - **The planned ablation** (longer training vs deadband, each arm against v2's 75%): it detects a true rate of
    ≤ 42.5% (or ≥ 97.5%) with 80% power. Power to tell 75% from 90% is 0.33, and from 50% it is 0.56. A one-change
    arm that keeps most of the gain will likely read "no detectable difference".
  - **The recipe A/B** (`--multiplied-only` imitation on the mouse demos): if the uniform arm sits near SANT's 3/40
    (7.5%), the recipe arm must truly reach about 34% to be detected with 80% power (7.5% vs 25%: power 0.48). If the
    uniform arm were near 75%, see the ablation line.
  - For comparison, from 37.5% (v1) it detects ≥ 70.5% or ≤ 9.5%, and from 50% it detects ≥ 81.5% or ≤ 18.5%.

## Checks

- `uv run pytest -q tests/test_audit_numbers.py tests/test_flow_router.py`: 19 passed.
- `cd web && NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/site/results src/site/metrics src/site/flow`:
  9 files, 121 passed.
- `uv run python scripts/audit_numbers.py`: 197 OK or unverifiable, 0 mismatched or missing.
- Full `uv run pytest -q` (after the cleanup agent finished): 2950 passed, 73 skipped, 6 failed. These are the 6 known
  failures: `test_launch_health` ×2, `test_set_v2_is_frozen` and `test_sim_homeset` ×3.
  - An earlier full run, during the cleanup agent's edits, also failed 7 script tests in `test_failure_analyst.py`.
  - They pass now.
