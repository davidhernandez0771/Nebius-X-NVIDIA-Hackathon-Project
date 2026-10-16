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
| `charts/success.svg` | Policy success against the number of human demos. **All pending:** T3's cells raw_5, raw_10 and raw_13 are trained but not yet evaluated. | `C:\dev\pm-t3\data\results\registry.jsonl` |
| `charts/ablation.svg` | Rules-only against rules + Nemotron repair. **Both pending.** | the same registry (no rules_multiply / perfected_multiply cells yet) |
| `charts/yield.svg` | Multiplication yield: Franka **90%** (27/30) against MimicGen's published 38–74%. That run predates the handover fix (`f1e21d9`). The 3 failures were the fixed-time swing, so a re-run should be higher (T2, sprint 4). | `C:\dev\pm-t2\data\multiply_franka\yield.json`; MimicGen from the spec, section 5 |

**To refresh** after new runs:

```
uv run python scripts/build_results_json.py --data-dir data --input-root C:\dev\pm-t3\data --t2-data C:\dev\pm-t2\data
uv run python scripts/render_charts.py --results data/results/results.json --out docs/media/charts
```

## Diagnosis scores behind these demos

They are not drawn as a chart. T4's s1 run, 5 demos, scored with `scripts/score_pipeline_run.py
--compare` against `truth.json`:
- **Rules:** found every injected pause, jitter and idle (P = R = 1.00 on those types). Like every
  rules run, it named no `slow` or off-center grasp: recall over all types is 0.81.
- **The calibrated Nemotron (sprint 3):** kept all 5 demos and named no issue (recall 0).

That result is why sprint 4 builds the hybrid diagnoser.
