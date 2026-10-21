# SANT data fixes: yaw wrap, grasp retime, centred approach (2026-10-20, branch `pm/sant-data-fixes`)

From `pm/live-12` (`d5c2ca5`). This is step 2 of the research plan (`pm-t8` note `2026-10-20-research-cube-in-bin.md`,
findings 4 and 5, plan (b) 3–5). No GPU. Never pushed. Every fix is **off by default**, so earlier runs and their
pre-registrations reproduce. The experiment script turns them on: `--yaw-wrap --grasp-retime --approach-offset 0.04`.
Each is frozen into config.json only when set, and stated in the pre-registration.

## What changed

1. **Yaw wrap.** `multiply.transform_trajectory(..., wrap_yaw=True)` turns the hand with the cube only to its
   nearest face (`nearest_face_yaw`: ±45°, the scripted expert's wrap).
   - Regression: a turn of 45° or less, yaw-0 scenes included, gives exactly the old output.
2. **Grasp retime**, a new Neaten op `retime_grasp` (`demo_pipeline/grasp_retime.py`).
   - **The rule** (`detect_rules(retime_grasp=True)`) fires on a swoop: closing faster than 5 cm/s over the last
     0.1 s, or fewer than 10 frames within 3 cm of the grasp point. It raises an issue `swoop_grasp` and emits the op.
   - **The rewrite:** the person's approach eases into a hover 10 cm over their own grasp point, holds 0.3 s, comes
     straight down with the last 4 cm at ≤ 5 cm/s, stops, closes, holds closed and still 0.4 s, lifts 10 cm
     straight up, then eases back into the person's own carry.
   - **Its checks:** every step stays within the 5 cm repair budget of the original at its source time. Over the
     steps it made or eased, no 0.5 s window goes over the jitter rule's 20 m/s³. If these fail it tries longer
     eases, then 8 and 6 cm heights.
   - **A retime that doesn't fit is reported, not emitted.** The rule checks the op on the demo as the earlier ops
     (trim, remove_pause, recenter, smooth) leave it. The first dry run found a demo (da08) that fitted raw but not
     after smoothing; a failed op makes `perfect_demo` discard the whole demo.
   - **Nemotron's prompts are unchanged.** The new op and issue are rules-only (`RULES_ONLY_OPS/ISSUES`), and golden
     SHA-256 hashes of both diagnose prompts are pinned.
   - **The web site** got a tag, a repair label and the issue↔fix pairing for it.
3. **Centred approach for human variants.** `homeset.center_from_hover`: at a retimed grasp's hover, the variant
   - arrives offset (a disc of radius `approach_misalignment(seed, offset_max=0.04)`, up from the grasp-fix's 3 cm)
     and turned up to ±35°;
   - holds;
   - centres and aligns slowly (as in the 10-18 grasp-fix);
   - then descends.

   A human demo's step k is only its start, so the hover is the right place for this. A variant whose source wasn't
   retimed has no hover and keeps its own approach (`centred: false` in the multiply marker). The scripted default
   (3 cm) is pinned unchanged.

## CPU dry run on the 10 mouse demos (read-only, `scripts/sant_data_fixes_dryrun.py`; `…/dryrun.json`)

It mirrors round 1 of `perfect_stored_demo` (the stored raw replay's signals and verdict) through repair, align and
10 variants per demo, made both as today and with all fixes.

| demo | swoop | frames in last 3 cm | close speed (m/s) | close → lifted (frames) | budget used | whole-window worst jerk |
|---|---|---|---|---|---|---|
| 00ab, be76, ee42 | no | 14 / 16 / 21 (unchanged) | 0.03 / 0.02 / 0.04 | unchanged | – | unchanged |
| 7 swoops | yes | 5–12 → **49** | 0.07–0.28 → **0.0006** | 13–17 → 33–35 | 0.8–2.0 cm | da08 25.8→24.4; 68ce +0.4; the rest equal or lower |

- **Retime heights:** hover/lift 10 cm (dc3e: 8 cm). Each retimed demo is 3–4.2 s longer; median variant length
  goes from 5.6 to 9.2 s, the research note's 7–9 s target.
- **Variants** (100): all are in the workspace, and every wrist turn at the close is within 45° of the cube's
  nearest face. Today, 60 of 100 turn more than 45°. 70 of the 100 are centred.
- **Look-alike conflicts:** cubes that look the same (yaw mod 90 within 5°) but have wrist turns more than 45° apart.
  **267 / 558 pairs today → 6 / 558.** The 6 are all at the ±45° face flip (cube yaws ±46–48°), which the scripted
  expert has too.
- **Pre-existing, not from these fixes:** the person's fast carry gives single steps of up to 26 mm (1.3 m/s) and
  jerk windows up to about 60 in the variants, the same today. Isaac's tracking will meet them.
- **Not checked here:** reach, collisions and success. That needs the GPU run, with a pre-registration.

## Tests

New or extended:
- `test_dp_grasp_retime.py` (13), `test_dp_multiply.py` (+15), `test_sim_homeset.py` (+8), `test_sim_human_exp.py` (+1);
- `test_run_human_demo_experiment.py` (+5);
- `test_diagnose*.py` (rules-only issues), and web `review/model`, `data/model`.

Results:
- full Python suite: **2405 passed, 29 skipped** (`uv run --no-sync pytest -q`);
- web: **1563 passed, 1 skipped**; tsc is clean.

**Left in the worktree, untracked:** `p.out` (a profiler dump of mine in the repo root; not committed).
