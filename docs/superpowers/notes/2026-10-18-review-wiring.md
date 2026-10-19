# Review wiring: real data in the verdict card (`pm/review-wiring`)

Branched from `origin/perfect-then-multiply` at `e94d817`. Not pushed, merged to GitHub or rebased.

## What the card shows now

| Line | Where it comes from | Live demo | Recorded example (`s1_0002` → `s1_0002_rules`) |
|---|---|---|---|
| **Physics** verified / failed + reasons | the passport's verification (store, then episode); without one, `check_success` on the episode's signals. Reasons in words ("dropped the cube"). `unknown` says why | `GET /demos/{id}/review` | `s1_0002_rules/passport.json` (already in `example.json`) |
| **Nemotron label** | `ReviewVerdict.label` (`docs/design/nemotron-judge.md` on `pm/nemotron-judge`, read, not edited) | `review_verdict.json` next to `passport.json`; nothing writes it yet, so live demos say "Not labelled by Nemotron yet." and show the diagnosis's label with its author | real labeler reply for `s1_0002`'s recording: "The robot picks up a red cube and places it into a blue bin." |
| **Matches** yes / no + reason | `ReviewVerdict.match` and `conflict`, by the contract's table: failed checks in its words, reason verbatim, `unavailable` never shown as no, conflict in amber | same file; none yet → "Not checked yet." | real judge reply, **yes**, for `s1_0002_rules_m102000`, a copy multiplied from `s1_0002_rules`. `s1_0002_rules` itself was never judged, so the card says "Judged on s1_0002_rules_m102000, a copy multiplied from this demo." |
| **Fixed** + the fixes Neaten applied | `passport.repairs_applied` in order, each with its span in demo seconds, plus the repaired demo in the lineage and its `created_at` | same route | trim 0.82–13.76 s, remove_pause 4.50–6.52 s, remove_pause 8.98–10.58 s, smooth 0.00–13.76 s (strength med); applied to `s1_0002_rules` on 2026-10-16 20:17 UTC |

**Every number is from a file:**
- the passports in `C:\dev\pm-t4\data\demos`;
- the 2026-10-18 test's `outcomes.jsonl` (`pm/nemotron-judge@47cc4cd`). Its sha256 is recorded in `example/verdict.json`.
  - It is the same as `C:\dev\pm-t3\data\intent_eval\test\{labels,judgements}.jsonl`, checked.
- The export checks that each eval clip's trajectory (`C:\dev\pm-t2\data\episodes`) is the store demo's, step for step.

**Fixtures:**
- The `no`, `unavailable`, `not_checked` and conflict states exist only in tests (`model.test.ts`, `ReviewPage2.test.tsx`, `tests/test_review_api.py`), labelled as fixtures.
- No fixture is shipped on the page.

## Commits

| Task | Commit | Tests |
|---|---|---|
| Merge `pm/web-review` (T1). `content-spec.md` add/add conflict: kept both whole, the sprint 9 rewrite as `content-spec.md` and the sprint 8 version (PR #37) as `content-spec-sprint8.md` | `9636dab` | pytest 1490 / 0 failed; web 479 / 0 failed |
| `GET /demos/{id}/review` (`src/app/routers/review.py`), `DemoStore.{save,get}_review_verdict` | `521a939` | pytest 1506 / 0 failed (16 new) |
| `scripts/export_review_verdict.py` → `web/src/site/review/example/verdict.json` | `6cd2d54` | pytest 1513 / 0 failed (7 new) |
| Web: `pmApi.getReview`, `ReviewVerdict`/`DemoReview` types, card rows, tests | `7879434` | web 492 / 0 failed; `npm run build` OK |

- **Browser check:** Chrome, backend on port 8010 with `DATA_DIR=C:\dev\pm-t4\data` (GET only), Vite on 5173.
  - `/review2?id=example` and `/review2?id=s1_0002_rules` render all four lines.
  - The raw/perfected table now fills for live demos too.
  - No console errors.
  - Both servers are stopped.

## Not done / for others

- **T3 (`pm/nemotron-judge`):**
  - The route reads `<demo dir>/review_verdict.json`, which is the place your status note named. Write it with `DemoStore.save_review_verdict(id, review_verdict(...).model_dump(mode="json"))`.
  - Until your branch merges, `review.py` checks the shape against a small mirror of the contract.
  - `export_review_verdict.compose()` mirrors `review_verdict()`. After the merge, both can import yours.
- **T1 (content spec):**
  - §1 L3 ("not built, not measured") and §7 ("Matches … Never yes") are now out of date for the example: the card shows a measured yes, with its source named.
  - Beat 2 on the Landing still says "coming next".
  - I didn't edit the spec. Please update L1–L3 from `docs/superpowers/notes/2026-10-18-nemotron-judge.md` once it merges.
  - Cite nothing stronger than that note's "What the numbers support".
- **Not built:** the label's four steps as bands on the timeline (the contract suggests it). The example's model steps are odd (grasp 100–100, release 584–584), so they would need care.
- **Overlap seen (T5):** the floating "Hand control" button covers the bottom right of the verdict card on a 1568 px screen.
