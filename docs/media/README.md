# Media for the README and the video

These files were made on 2026-10-16 from recorded simulator episodes (Isaac Lab, Franka, front camera, 50 Hz),
with `scripts/make_media.py`, and from the measured results, with `scripts/build_results_json.py` and
`scripts/render_charts.py`. Each file is at most 2 MB; `tests/test_dp_media.py` enforces that.

**The GIFs:**
- **Timing and size:** 10 frames per second, real time, with the 128 px sim frames shown at 256 px.
- **Palette:** all frames share one 64-colour palette. It reserves exact entries for the timeline and
  label colours and for the scene's saturated colours (red cube, blue bin); the rest of the palette
  is fitted to the frames. That made them about 4× smaller than per-frame 256-colour palettes
  (s1_0002 side by side: 4.6 MB → 0.96 MB) with the same frames.
- **Settings:** `make_media.py --colors 64` is the default; `--colors 0` restores per-frame palettes.

All the human demos here are **synthetic**. They are the scripted expert, degraded with
`demo_pipeline.degrade`: hand tremor, pauses, slowness, idle time and off-center grasps, each with
ground truth. No real webcam demo has been recorded yet.

## Before and after perfecting

| file | what it shows | source |
|---|---|---|
| `s1_0002_raw_vs_perfected.gif` | The same demo before (left) and after (right) the rules perfected it, on one clock. The raw demo (13.8 s) has tremor, two pauses, slowness and 0.6 s of idle at the start. The perfected one is trimmed, pause-free and smoothed (9.3 s) and is marked "done" when it ends. Both replays succeeded. The strip under the left panel shows the rules' diagnosis: segments (approach blue, carry green, retreat grey) and issues (jitter purple, pauses amber, idle grey). | T4's s1 run: `C:\dev\pm-t2\data\episodes\s1_0002_raw` and `s1_0002_rules_v1` (the verified replay of the repaired trajectory); diagnosis from `C:\dev\pm-t4\data\demos\s1_0002_rules\diagnosis.json` |
| `s1_0003_raw_vs_perfected.gif` | The same comparison for a demo with idle time at both ends (10.6 s → 7.8 s). | `s1_0003_raw`, `s1_0003_rules_v1`; `s1_0003_rules\diagnosis.json` |
| `s1_0002_raw_sheet.png` | 6 frames of the raw s1_0002 demo, each captioned with its time and the segment and issues the rules found there. | as above |

## A diagnosis timeline

| file | what it shows | source |
|---|---|---|
| `degraded_0004_rules_timeline.gif` | A degraded demo (14.1 s: 2 mm tremor, two pauses, slowness ×1.27, 1.2 s of idle at each end and an 11.8 mm off-center grasp) with the rules detector's diagnosis under the frames. The rules name the timing issues, not the off-center grasp; that one is the hybrid diagnoser's job (T4, sprint 4). | T2's rendered demo `C:\dev\pm-t2\data\episodes\degraded_0004`; diagnosis from `make_media.py --rules`, run locally on the recorded steps |
| `degraded_0004_sheet.png` | 6 captioned frames of the same demo. | as above |

## Charts (`charts/`)

They are built from `results.json` (`"sample": false`). A value nobody has measured yet is drawn as
**pending**, never as 0.

| file | what it shows today | source |
|---|---|---|
| `charts/success.svg` | Policy success against the number of demos, for **the home-start experiment only** (T3's sprint 6 Task B runs `sprint6_home_a_20261016_205725` and `sprint6_home_b_20261016_213851`: one home pose for every demo and eval, ACT, 10,000 steps each, 20 unseen scenes, seeds 5000–5019). **At 10 demos: raw 10% (2/20), raw + multiply (10 sources + 100 variants) 15% (3/20)**, the project's first unseen-scene successes. **The difference is not significant** (two-sided Fisher exact p = 1.0, T3): a tie at n = 20. Each point has its Wilson 95% CI as an error bar and its k/n label: **2.8–30.1%** and **5.2–36.0%**, which overlap almost entirely. At n = 20 the test had only 24% power to detect even 10% → 30% (`docs/superpowers/notes/2026-10-17-power.md`). **At 5 demos: raw 5% (1/20, CI 0.9–23.6%), raw + multiply (5 sources + 50 variants, 10k steps) 25% (5/20, CI 11.2–46.9%)** (T3 sprint 7, grid B finished). That is the biggest gap so far, but it is **not significant either** (Fisher p = 0.18). The multiplied 5-demo policy scoring above the multiplied 10-demo one (25% vs 15%) is within the same noise. Pending: perfected + multiply. The sprint 3 cells (start above their own cube, all 0/20) are left out with `--run-id`. | `C:\dev\pm-t3\data\results\registry.jsonl` lines 4–6 (each line names its eval file, e.g. `evals\sprint6_home_a_20261016_205725\raw_multiply_10.json`) |
| `charts/comparison.svg` | Head-to-head pairs with each arm's k/n, Wilson 95% CI and the two-sided Fisher exact p. Today: **raw_5 1/20 vs raw_multiply_5 5/20, p = 0.18** and **raw_10 2/20 vs raw_multiply_10 3/20, p = 1**: neither is significant at n = 20. Only written when the build is given `--compare`. | the same registry lines (`comparisons[i].<cell>` in `results.json`) |
| `charts/ablation.svg` | Rules-only against rules + Nemotron repair. **Both pending.** | the same registry (no rules_multiply / perfected_multiply cells yet) |
| `charts/yield.svg` | Multiplication yield: Franka **100%** (100/100). That is the home-start dataset T3 Task B trains on: 10 verified sources × 10 variants (T2, sprint 6). It replaces the pre-fix 90% (27/30). The post-fix clean-expert run (30/30) is listed under `others` in `results.json`. MimicGen's published 38–74% is shown beside it. | `C:\dev\pm-t2\data\episodes\home_v1_manifest.json`; MimicGen from the spec, section 5 |

**To refresh** after new runs:

```
uv run python scripts/build_results_json.py --data-dir data --input-root C:\dev\pm-t3\data --input-root C:\dev\pm-t4\data --t2-data C:\dev\pm-t2\data --demos 5,10 --run-id sprint6_home_a_20261016_205725 --run-id sprint6_home_b_20261016_213851 --compare raw_5:raw_multiply_5 --compare raw_10:raw_multiply_10
uv run python scripts/render_charts.py --results data/results/results.json --out docs/media/charts
```

## Diagnosis scores behind these demos

They are not drawn as a chart. T4's s1 run, 5 demos, scored with `scripts/score_pipeline_run.py
--compare` against `truth.json`:
- **Rules:** found every injected pause, jitter and idle (P = R = 1.00 on those types). Like every
  rules run, it named no `slow` or off-center grasp: recall over all types is 0.81.
- **The calibrated Nemotron (sprint 3):** kept all 5 demos and named no issue (recall 0).

That result is why sprint 4 builds the hybrid diagnoser.

**The fair, pre-registered test (sprint 6):** T4 ran every arm on T1's frozen set v2: 32 rendered demos
(manifest SHA-256 `21d82eac…`), 8 off-center grasps, 8 centered-grasp negatives, 6 drops, 6 bad releases and
4 clean demos. All five arms scored all 32 demos. F1 over all types:

| arm | F1, all types | grasp R1 bar | model calls / cost |
|---|---|---|---|
| `rules` | 0.81 | fail | 0 / $0 |
| `rules_grasp_metric` | 0.84 | pass | 0 / $0 |
| `code_all` (code only) | **0.90** | pass | 0 / $0 |
| `hybrid` (rules + Nemotron) | 0.86 | pass | 35 / $0.054 |
| `hybrid_blind` (Nemotron without the measured offset) | 0.80 | fail (8/8 centered grasps called off-center) | 33 / $0.050 |

- **Code only matches or beats both model arms on every issue type.**
  - drop: 1.00 against 0.00;
  - bad_release: 1.00 against 0.71 and 0.67.
- **Hybrid's grasp calls are the code metric's.** The full table, the negatives' false-positive rates and the
  one deviation (a hash-definition bug in T4's integrity check, fixed before any scored call) are in T4's
  status note.
- Source: `C:\dev\pm-t4\data\ablation\v2_20261016_run2\scores.json` and `table.md`. `results.json` carries it
  as `diagnosis_ablation`.
