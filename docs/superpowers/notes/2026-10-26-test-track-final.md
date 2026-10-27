# The final test on the test track (`pm/test-track-final`, 2026-10-26)

Branched from `pm/site-nav-fix` at `97804dd` in a new worktree (`C:\dev\pm-site-tt`). Nothing pushed, no other branch
or worktree touched, no new dependencies (`npm ci` from the existing lockfile, since the worktree had no node_modules).

**What a judge sees now.** `/test-track` opens on **The final test · 30/40**: the camera policy that passed the
pre-registered test, on 40 scenes it had never seen (seeds 5400–5439), run once. Every one of the 40 runs plays back
from its own Isaac trace, 50 Hz. The 10 failures are marked in the grid (orange, tinted, a cross in the corner, their
reasons in the label and tooltip), listed under "Why runs failed" with their reasons, and spelled out in the verdict tag.
An All / Verified / Failed filter sits over the grid (`?show=failed` opens on it; J/K stay inside it). The three
earlier sources (teacher gate 2, replay check, distillation round 0) are still there, as keys 2–4.

## The data

| | |
|---|---|
| Episode log (the verdicts) | `C:\dev\pm-t6-big\data\evals\bigtest_test\bigtest_final.episodes.jsonl` (header + 40 episodes) |
| Traces | `...\bigtest_final_traces\seed_<seed>.npz` + `.json`, 27,175 steps in all |
| Eval summary (cross-check) | `...\bigtest_final.json`: 30/40 |
| Checkpoint (path only) | `C:\dev\pm-t6-big\data\experiments\bigtest_r0_t600_20261023_161418\train\distill_r0\checkpoints\180000\pretrained_model` (from the log's header) |

- **Result, exactly as logged:** 30/40, Wilson 95% 0.5981–0.8581 (the page rounds it to 60%–86%), judged by SANT's `check_success` during each run.
- **The 10 failures:** all ended at the time limit (1,500 steps).

| Seed | Reasons |
|---|---|
| 5400 | not_in_bin, dropped |
| 5402 | not_in_bin, gripper_closed, dropped |
| 5408 | not_in_bin, collision, dropped |
| 5409 | not_in_bin, gripper_closed, dropped |
| 5413 | not_in_bin, collision, dropped |
| 5421 | not_in_bin, collision, dropped |
| 5427 | not_in_bin, collision, dropped |
| 5433 | collision, dropped |
| 5437 | not_in_bin, dropped |
| 5439 | not_in_bin, dropped |

- **Each trace agrees with its verdict:** the seed, the step count (json, npz arrays, log) and the last cube position all match. The builder refuses to write anything if one doesn't.

### How the bins were placed

The traces record the arm, the hand, the cube (position and rotation), the gripper and the contacts, but not the scene.
Every earlier source read its bin from a per-episode `scene.json`. The final test has none, so the bin is re-made the
way the eval made it:

- `sim_eval/scripts/run_eval.py` takes its scenes from `sim_eval.scenes.scene_plan`. Its unseen scenes are `eval_scenes(n, seed0)`, which is `demo_pipeline.multiply.sample_scene(np.random.default_rng(seed), "franka", seed)` per seed. The run's `bigtest_final.json` lists all 40 seeds under `groups.unseen`.
- This worktree's `sim_eval/scenes.py` and `src/demo_pipeline/multiply.py` are byte-identical to `pm-t6-big`'s (the checkout that ran the test, at `c6bae0a`, clean).
- `build_test_track.final_scene(seed)` calls `eval_scenes(1, seed)`.

Three checks that this gives the eval's own scenes:

1. **The cube's start:** each trace's first cube position lies within 0.7 mm of the sampled cube (the cube settling on the table).
2. **The verdicts:** each trace is judged again with `check_success` against the re-made bin, through the eval's own scoring (`sim_eval.eval_policy._score`, with `BIN_INNER`). All 40 give the same success and the same reasons as the log, and the builder stops on any mismatch.
3. **The sampler itself:** run on the gate's seeds 5350–5399, it gives the gate's recorded `scene.json` cube and bin for 50 of 50.

### What each run file holds (`runs/final-test-v2/<seed>.json`)

The same twin payload as the other sources, at 4 decimals:

- `joint_pos`, `gripper`, `cube_pos`, `bin`, `base`;
- `hand_pos` (the recorded TCP, 3 decimals);
- `contact_n` (the max contact force per step);
- `facts`.

It adds two fields:

- `cube_quat_path`: the cube's recorded rotation each step, 3 decimals, so a dropped cube tumbles as it did;
- `contacts`: `{gripper_cube, arm_bin, arm_table}` as `[first, last + 1)` step ranges from Isaac's contact sensors. The page shows them as a "Touching now" tag.

Where each fact comes from:

- **From the log:** success, reasons, `ended_by`, steps and time (`sim_s`).
- **From the same re-judging:** path length, peak contact and settle time. The traces are used for display and this cross-check only.

**Not downsampled:** the existing sources aren't either, and every step is kept at 50 Hz.

**Size:**

- added data: 3.7 MB, 40 files of 40–200 KB, about 0.73 MB gzipped. The longest are the 1,500-step failures;
- `index.json`: 94 KB → 105 KB;
- `test-track-data` in all: 7.0 → about 10.7 MB (`du`: 11 MB). The page loads one run at a time.

## The page (`web/src/site/testtrack/`)

- **Default source:** sources come in the index's order, and the builder puts the final test first. The page opens on the first *verified* replay that the filter shows (seed 5401), so a viewer sees it work first. Before, it opened on the first replay; for the other sources that's the same run.
- **The placeholder is gone:** "Camera robot · eval: its final test hasn't run yet" was a disabled entry in the picker. It has run: it is this source.
- **Failed runs are marked in three places:**
  - the grid cell: orange, tinted, with a cross, and the reasons in its accessible name and tooltip;
  - a "Why runs failed" list: each failed seed (a button) with its reasons in words;
  - the verdict tag, as before: "Failed · the cube missed the bin, …, stopped at the time limit".
- **Filter:** All 40 / Verified 30 / Failed 10.
  - It only shows when a source has a failure, and it lives in the URL (`?show=ok|failed`).
  - A new filter keeps the run on screen if it's in it; otherwise it opens on the filter's first run.
  - Picking a source clears the filter.
- **Cube rotation:** taken from `cube_quat_path` when the run has one.
- **Touching now:** gripper on the cube, arm on the bin, arm on the table, or "nothing".
- **The source's note:** where the bin comes from, shown under the runs with the checkpoint.
- **Shortcuts:** the help says "1–4" for the sources.
- **Left alone:** no navigation code was touched (the HoloPage frame, nav and back link are as `pm/site-nav-fix` left them). The one holo style override is scoped to `.tt-runs`, so the long runs heading wraps.

## Checks

- **pytest** `tests/test_build_test_track.py`: 13 pass. That's the 8 earlier tests plus 5 new ones:
  - fake final-test data: shape, contacts, facts, checkpoint, Wilson;
  - a refusal on a disagreeing verdict and on a step-count mismatch;
  - the final test first in `build`;
  - `final_scene` equals `eval_scenes`;
  - the real data, skipped off this machine: 40 runs, 30 verified, CI 0.598–0.858, every failure with reasons.
  - The first cold run takes about 145 s on this machine (imports); a warm run takes 0.7 s.
- **vitest** `src/site/testtrack`: 33 pass (model 19, page 14). They test:
  - the final test as the default source, 40 runs and 30 verified;
  - each failure's reasons (in the grid, the list and the verdict);
  - the filter and J/K inside it, and `?show=failed`;
  - the cube rotation and "Touching now";
  - the **built** `public/test-track-data/index.json` itself: first source `final-test-v2`, "The final test · 30/40", 40 runs, 30 verified, every failure with reasons and time_limit, the earlier sources after it.
- **Full web suite:** `npx vitest run --maxWorkers=2 --minWorkers=1` gives 224 files, 1987 passed, 1 skipped.
- **Types and build:**
  - `npx tsc -b` passes;
  - `npm run build` passes: the page chunk is 18.5 KB JS + 7.3 KB CSS, and dist carries test-track-data (11 MB).

## Screenshots (headless Chrome, SwiftShader, reduced motion, vite dev on 127.0.0.1:5197)

In `2026-10-26-test-track-final/`; `shots.json` has each shot's caption, the audits and the console.

**Desktop 1280×800:**

| Shot | What it shows |
|---|---|
| `01-desktop-final-test-opens` | The default view: the final test, seed 5401, step 1 |
| `02-desktop-success-5401-mid-grasp` | Seed 5401 at step 250 of 475: carrying the cube toward the bin; "Touching now: gripper on the cube" |
| `03-desktop-failed-5408-collision` | Seed 5408 at step 639 of 1500, with the Failed filter on: the cube left on the table, the arm pushing into the bin (43.9 N now, 113.3 N peak). The verdict reads "Failed · the cube missed the bin, pushed into the bin or the table, dropped the cube, stopped at the time limit". |
| `04-desktop-failed-5433-dropped` | Seed 5433 at step 699: see the note below the table |

On `04`: the cube sits in the bin there, but the run failed with collision and dropped. It shows that SANT judges more than where the cube ended up.

**Phone 390×844:**

| Shot | What it shows |
|---|---|
| `05-phone-success-5401-mid-grasp` | Seed 5401 mid-grasp |
| `06-phone-success-tags` | Its tags |
| `07-phone-failed-5408` | Seed 5408 |
| `08-phone-failed-5408-verdict` | Seed 5408's verdict and tags, then the source panel |
| `09-phone-filter-and-why-failed` | The filter, the 10 failed cells and the "Why runs failed" list |

**In-page audit:**

- no horizontal scroll at 1280 or 390;
- no unnamed buttons, links or inputs;
- no console errors, only React Router's future-flag warnings, as before.

## Unverified / not done

- **The replay is the recorded trace, not a physics replay** (the gate's runs were re-run with physics; these weren't). That's what the data is. The page says "recorded by Isaac", and the verdicts are the eval's own.
- **Camera footage:** the eval ran with cameras, but no frames were saved in the traces, so there's no camera view.
- **Gripper:** the twin draws the gripper from the commanded 0/1 `gripper` and the finger joints in `joint_pos`, as for the other sources.

## Questions for the user

1. Open on the first verified run (5401, what ships) or on the first run by seed (5400, a failure)? I chose the success first; the failures are one click away and marked.
2. Should the final test's title carry the count ("The final test · 30/40", as asked)? The picker then drops its separate count for that entry, so 30/40 isn't shown twice.
3. Is 3.7 MB more of static data fine for the host, or should the long failed runs be thinned to 25 Hz (about 1.9 MB)?
