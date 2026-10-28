# The Results page's proof band: the pre-registered results as charts (2026-10-26, `pm/site-results-proof`)

Branch `pm/site-results-proof` in `C:\dev\pm-site-results`, cut from `pm/site-trial` at `86a32fe`. Nothing was pushed.

## What it adds

`/site/results` (the Field Notes page; nav: the holo pages' **More → Results** and the story footer) gets a dark
**proof band** right after the headline: "The proof: pre-registered, each run once". It has four parts:

| Part | What it shows |
|---|---|
| **01 The climb: from 0/40 to 30/40** | Success on the 40-scene one-shot test as bars with Wilson 95% whiskers: raw mouse demos 0/40 (0.0–8.8%), SANT-perfected + multiplied 3/40 (2.6–19.9%), v1 RL teacher distilled 15/40 (24.2–53.0%), **v2 30/40 (59.8–85.8%)**. A dashed goal line at 60% (24/40). The seed footnote, word for word. |
| **02 Did the human demos matter? The teacher side** | Home-start success out of 128 by RL iteration (300 → 1499): with human demo starts 0, 10, 99, 109, 113; without, 0 throughout. Final Wilson intervals 113/128 (81.6–92.8%) vs 0/128 (0.0–2.9%) as whiskers at 1499 and in a ledger. Caption: "Same code, budget and seed; one run per arm." Hover or focus on a checkpoint reads it out. |
| **03 Why the 10 v2 test failures failed** | The 40 test seeds as a strip (30 in the bin, 10 failed, from the note's failed-seed list), then the reasons: dropped 10, not in the bin 9, collision 5, gripper closed 2 (one failure can have several), and "All 10 ran out the 30 s time limit." |
| **04 What didn't work** | Three amber panels: the held-human replay (0/110), the DAgger round (7–8/29 after the restart, cause unknown, lost the pick), the first teacher (1.7 m/s, caught by the replay at 3/50; a 0.5 m/s cap gave 50/50). |

## Where the numbers come from

All of them are in one typed module, `web/src/site/results/proofData.ts`. Each is cited to its note and lines (both
notes are on `pm/live-13`; line numbers as of `2b34b1b`):

- `docs/superpowers/notes/2026-10-23-bigtest-prereg.md`: v2 30/40 and the goal (744–745), its failures and seeds
  (751–752), the 30 s limit (61), the seed footnote (765), the held-human 0/110 (349–350, 759), DAgger (716–727).
- `docs/superpowers/notes/2026-10-21-distill-prereg.md`: v1 15/40 (1386), the mouse SANT and raw arms (1390–1391),
  the teacher's 3/50 and 1.73 m/s (440, 451), the cap and 50/50 (495, 551), Amendment 6's curve (1653–1657), finals
  (1621–1622) and setup (1500–1503).

The links use the page's `REPO_BLOB` (branch `perfect-then-multiply`), so they 404 until both notes are merged there,
as with the page's other note links. "Where the numbers come from" now lists the two notes and names `proofData.ts`.

## How it looks and behaves

- **The holo look, set into the paper page:** the void and its cutting-mat grid, `HoloPanel` (corner ticks) for each
  figure, `HoloTag` for labels, Instrument Serif headings, IBM Plex Mono numbers. Teal only marks v2 and the
  with-demos teacher; the context steps are grey; amber only marks failures. Text is always ink, never a series
  colour. No NVIDIA green and no eye motif.
- **Charts:** HTML and inline SVG (`ProofSection.tsx`, `proof.css`). No new dependency.
- **Accessibility:** each chart is a `<figure>` named by its title (`aria-labelledby`) and described by a visible
  summary sentence (`aria-describedby`). The drawing is `aria-hidden`, and a visually hidden data table carries the
  numbers. The curve's checkpoints are buttons with full-text labels, and the readout follows hover and focus.
- **Motion:** the climb's bars grow once when first seen (transform only, staggered); the whiskers fade in after.
  With reduced motion (the OS or the site's Effects toggle), there's no transition, and the bars are drawn at once.
- **Phone:** at 390 px, `scrollWidth` = 390, with no element past the edge.

## Checks

| Check | Result |
|---|---|
| New tests first: `proofData.test.ts` (13) and 9 new tests in `ResultsPage.test.tsx` | The page tests failed before `ProofSection` existed, and all pass now |
| Full web suite `npx vitest run --maxWorkers=2 --minWorkers=1` | 222 files, 1960 passed, 1 skipped |
| `npx tsc -b` | exit 0 |
| `npm run build` | OK (only the usual three.js chunk-size warning) |
| Headless Chrome, SwiftShader (`--use-angle=swiftshader`), `vite preview`, stopped after | No console errors or warnings. Desktop 1280: scrollWidth 1280. Phone 390 (DPR 2): scrollWidth 390. Hover on iteration 900 reads "Iteration 900 · 99/128 · 0/128" at both sizes. A reduced-motion pass looked the same, with the bars drawn at once |

The data tests check the sums (30/40, 40 − 30 = 10 failures, 10 failed seeds inside 5400–5439, the curve ending on
113/128 and 0/128), and that every printed Wilson bound is within 0.001 of `stats.ts`'s `wilson()`.

## Screenshots (`2026-10-26-site-results-proof/`)

- **Desktop 1280×800:** `desktop-0-band`, `desktop-1-climb`, `desktop-2-teacher`, `desktop-3-failures`,
  `desktop-4-setbacks`, and `desktop-hover-900` (the readout on iteration 900).
- **Phone 390×844 @2x:** `phone-0-band`, `phone-1-climb(-b)`, `phone-2-teacher(-b)`, `phone-3-failures(-b)`,
  `phone-4-setbacks(-b)`, and `phone-hover-900`.
- **`report.json`:** console errors and widths per viewport.

The script that took them was a scratch CDP script (Node's WebSocket, no dependencies, like `web/scripts/world-perf.mjs`
but with SwiftShader). It wasn't added to the repo.

## Judgment calls

- **A dark holo band inside the paper page.** I didn't restyle the whole page. The band marks the newest,
  pre-registered results as their own instrument readout, and the rest of the page is unchanged.
- **The band sits after the headline.** The h1 (the scripted 17/40 result) is unchanged. The band follows it,
  before "What it doesn't show yet".
- **CIs are shown as percentages** ("59.8–85.8%"), as the rest of the page shows them. `proofData.ts` keeps the
  notes' fractions exactly (0.598, 0.858).
- **Additions from the same note lines:** the 40-seed strip in part 3 (the note's failed-seed list, line 752), the
  teacher setup line "PPO, 4096 environments, 1500 iterations" (1501), and, on the held-human item, "So v2 kept v1's
  original human set" (759).
- **No floating tooltip on the bar charts.** Every bar is labelled with its count and CI, so a tooltip would only
  repeat them. The curve has the hover/focus readout.
- **The palette validator** (dataviz skill) flags the grey as low-chroma and the lightness band. That is by design:
  this isn't a categorical palette. It is the site's teal for the highlight, a neutral grey for context, and amber for
  failures. The teal/grey pair passes CVD separation (ΔE 16.5) and contrast against the void.

## Not verified

- Real devices and real GPU rendering: only headless Chrome on SwiftShader.
- Screen readers: only the accessible names, descriptions and tables were checked, in the DOM and by tests.
- The note links resolve only after both notes reach `perfect-then-multiply`.
