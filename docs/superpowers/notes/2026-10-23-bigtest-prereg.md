# Pre-registration: the 10-23 big test, the "v2" recipe as one combined arm (2026-10-23)

**Frozen by this commit, before any GPU run of this experiment.** Any later change to a rule below is an amendment,
written and committed with its time and reason before the data it affects exists. The lead decides today (the user is
studying); stopping a run still needs the user's OK.

**The question:** does the v2 recipe reach **≥ 60% (≥ 24/40)** on fresh test seeds?

**The starting point (v1):** the distill final test, 15/40 (Wilson 0.242–0.530) on 5020–5059
([2026-10-21-distill-prereg.md](2026-10-21-distill-prereg.md), "RESULT"). Its failures all included `dropped`: the grasp
that doesn't hold. Those test seeds are spent, so this experiment uses new ones.

## The arm: v2, four changes together

**One combined arm, no factorial.** All four changes go in at once, so any gain over v1 can't be attributed to any one
of them. That is stated now, and the results will say it again.

1. **Gripper binarize (inference only).** The training labels are already binary (0 / 0.04), so nothing changes in
   training. At inference, the policy's gripper output goes through **`--gripper-deadband 0.25`**:
   - **Per action:** f = the mean of the student's two finger targets (joints 7 and 8, in metres).
     - f < 0.015 m → CLOSED: both fingers are set to 0.0 m.
     - f > 0.025 m → OPEN: both are set to 0.040 m.
     - 0.015 ≤ f ≤ 0.025 → the previous output state is kept.
   - **The state starts OPEN** each episode (reset per episode). The arm's 7 joints are untouched.
   - **Where 0.25 comes from:** it is the teacher's deadband on its [−1, 1] gripper output (`demo_v6h`
     `params\env.yaml`), mapped onto the student's 0–40 mm range around the 20 mm midpoint.
   - **It is used on every student action:** the DAgger r1 student (5210–5249), Stage A selection (5500–5528),
     Stage B selection (5529–5557) and the test (5400–5439).
   - **The training labels are unchanged** and already two-valued: v1's export holds only 0.0 m (151,300 frames) and
     0.040 m (185,429 frames), human and teacher alike (T6's figures).
2. **One aiming habit in the human data.** The human mouse demos are re-executed through the held executor, so
   they move the way the student's actuator moves:
   - the achieved path, with the B pairing;
   - only episodes that pass `check_success` are kept.
   - T3, on `pm/held-human` (`C:\dev\pm-t3-hh`).
   - **The pass count** (kept / attempted, and the frames) is logged when the re-execution has run.
   - The source is unchanged from v1: `mouse20261020` `perfected_multiply_10` (v1 used its 110 replay-verified
     episodes).
   - **The re-execution's k, fixed by T3's rule before the pass count is known:** the smallest k in
     {1, 1.25, 1.5, 2} for which the 95th percentile of each episode's maximum lag is ≤ 2 cm. The k the rule gives is logged with the pass count.
   - **The human floor:**
     - **≥ 80/110 pass:** Stage A (and B) use the held-human episodes.
     - **Below 80/110:** both stages use the ORIGINAL v1 human set (the 110 episodes). Change 2 is then dropped, and
       that is disclosed in the result.
3. **Train longer.** ACT, **180,000 steps** at batch 8, with checkpoints at **60k, 120k and 180k**, the three candidates.
   - **The teacher data is reused:** the 565 passing held rollouts from v1's round 0 @600 (seeds 4300–4899, teacher
     `demo_v6h` `model_2697`, 224,435 frames). No new teacher rollouts.
   - **The mix is unchanged from v1:** 1/3 human : 2/3 teacher by frame share, with fractional repeats.
   - **`MAX_STEPS` is raised to 200k** so that 180k can run. That is run-enabling, and it comes with a test.
   - **The exports are full re-exports** for Stage A and for Stage B, with no merging of an earlier export.
4. **DAgger round 1 (Stage B).** It runs on practice seeds **5210–5249** (n = 40), with T3's `cap_from_tool` on (DAgger
   labels only). Then the student is retrained from scratch on all the data, for 180k steps. T6, on `pm/bigtest`.

### Everything else is as in v1

| | Setting |
|---|---|
| Policy | LeRobot ACT defaults (chunk 100, CVAE on, ResNet-18, 128×128 front + wrist cameras), batch 8, training seed as v1 |
| Training args | none: no `--augment`, no `--dilation` (the gripper labels are already binary, 0 / 0.04) |
| Inference | the checkpoint's own `n_action_steps` (100), no ensembling; **the only change is `--gripper-deadband 0.25`** (change 1) |
| Eval | serial `eval_cells`, 30 s, front + wrist, start = `hx_mouse20261020_20261020_164411\datasets\raw_10` (`--start-pose dataset`) |
| Teacher | `demo_v6h` `model_2697`, held execution (`exported\policy.pt`, sha256 `811382a3…77aa2`) |
| Success | the unchanged `check_success` |

## The stages

### Stage A: binarize + held human data + 180k

- **Data:** the held human episodes (change 2) plus the 565 teacher rollouts. The mix is 1/3 : 2/3.
- **Training:** from scratch, 180k steps; the candidates are 60k / 120k / 180k.
- **Selection:** on the **Stage A selection seeds** (n = 29, below). The most successes wins, and **a tie goes to the
  later checkpoint** (`overnight.pick_step`, as coded). That one is **A-best**.

### Stage B: DAgger round 1, then retrain on everything

**Stage B always runs, whatever A-best scores.** T6's stop rule (≥ 90% on the DAgger seeds, < 5 points gained,
< 5,000 frames) is NOT applied.
- **The DAgger rollouts:** A-best drives on **5210–5249** (`--dagger-seed0 5210`, n = 40, beta 0). The teacher relabels
  every state, with `cap_from_tool=True`. The student drives with `--gripper-deadband 0.25` (change 1).
- **The data:** the held human episodes, the same 565 teacher rollouts, and the DAgger r1 frames.
- **The mix:** T6's defaults, human 0.25 / teacher 0.5 / DAgger 0.25 by frame share (the lead's decision).
- **Training:** from scratch, 180k steps; the candidates are 60k / 120k / 180k.
- **Selection:** on the **Stage B selection seeds** (n = 29, below), with the same rule. That one is **B-best**.

### The final model

- **The final model is whichever of A-best and B-best has the higher selection score. A tie goes to B-best.**
- **Disclosed now:** the two scores come from **different seed sets** (A on Stage A's seeds, B on Stage B's), so
  comparing them is not a like-for-like comparison. The rule is fixed anyway, so the pick can't follow the test.

## Seeds

| Use | Seeds | n |
|---|---|---|
| Stage A selection | **5500–5528** (the lead's draft had 5330–5358; moved after the range check) | 29 |
| Stage B selection | **5529–5557** (the lead's draft had 5359–5387; moved after the range check) | 29 |
| DAgger r1 | 5210–5249 | 40 |
| **Test, once** | **5400–5439** | 40 |
| Teacher (reused, training data) | 4300–4899 (565 passing) | — |
| Human (training data) | the `mouse20261020` scene seeds, 0–4009, as v1's data check | — |

### The range check (T7, before writing this)

`seed_scan_bigtest.py` scanned `data\` in every `C:\dev\pm-*` worktree and the main checkout, for seeds 5200–5599. It
looked at seed-named files and folders, `seed` / `scene_seed` / `eval_seed` keys, and `"seeds": [a, b]` ranges. I also
checked the notes and T6's `sim_eval` code.

| Seeds | Use found |
|---|---|
| 5200–5209 | `pm-t3` `grasp_diag_20261018`; `pm-t6` `distill_diag_modes_r0_t300` and the v1 practice trace |
| 5210–5219 | `pm-t3` `data\evals\grasp_diag_20261018` (2026-10-18, `raw_multiply_10_30k`, a different policy) |
| 5220–5299 | none |
| 5300–5329 | v1 selection, gate 1, the smoke and `check_v2_950` |
| **5330–5349** | **teacher gate attempt 1** (`pm-t3` `data\rl\eval\v6_gate`, 5300–5349) |
| **5350–5399** | **teacher gate 2** (`pm-t3` `data\rl\eval\v6c2_gate2`, `model_2098`) |
| 5400–5449 | none |
| 5450–5499 | teacher gate (a) (`pm-t3` `data\rl\eval\v6h_gate_a`, `model_2697`) |
| 5500–5599 | none; and no mention in any note or in `sim_eval` / `scripts` code |

- **The lead's draft selection ranges clash.** 5330–5358 and 5359–5387 were scenes of the teacher gates. The final
  teacher, `model_2697`, is a fine-tune of `model_2098`, which was gated on 5350–5399, and the student imitates the
  teacher. So they are not fresh. The nearest clean 58 contiguous seeds are **5500–5557**, which the lead approved
  before this commit.
- **DAgger 5210–5249:** the same disclosure as Amendment 4. 5210–5219 were evaluated on 2026-10-18 with a different
  policy. These are training-data seeds, never scored for a claim. The two 2026-10-22 diagnostic attempts on 5210–5214
  were stopped in startup and ran no episode (no episodes file).
- **The test 5400–5439 is clean in data.** Earlier notes **reserved** it for a confirmatory eval: Amendment 4, the
  SANT v2 mouse prereg and the stage-0 inference prereg. None of those ran. This prereg uses it, once.
- **No seed set overlaps another** in the table above.

### Code guards required on `pm/bigtest` (the lead's requirement; run-enabling)

The code as it stands (`pm/distill-dagger` `9d8621e`):
- `sim_eval/distill_round.py:50` has `SELECT_SEEDS = range(5300, 5400)`. `_within()` would refuse 5500–5557, and it
  would accept the clashing 5330–5387.
- `sim_eval/overnight.py:36` has `TEST_SEEDS = range(5020, 5060)`, so the data check (`distill_round.py:369`) doesn't
  guard 5400–5439.

**Required before any Stage A run:**
- selection accepts 5500–5557;
- the data check refuses any training episode on 5400–5439, on either selection block (5500–5528, 5529–5557) or on
  5020–5059;
- tests for all of the above.

T6 also keeps refusing 5300–5399 (v1 selection and the teacher gate scenes) for training. Selection accepts exactly
5500–5557.

T6's commit and test counts are logged here when they arrive, before Stage A runs.

## The test (once, on the final model)

- **Seeds 5400–5439** (n = 40). No teacher, rollout, DAgger, selection or diagnostic run touches them before this.
- **The command, run once:**

  ```text
  C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\eval_cells.py --run-id bigtest_v2_final ^
    --checkpoint v2_final=<the final model's checkpoint> --seed0 5400 --n 40 ^
    --start-state <DATA_DIR>\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 --start-pose dataset --trace ^
    --gripper-deadband 0.25
  ```

  `eval_cells` re-runs only seeds that ended in `sim_error` / `policy_error`. Those say nothing about the policy and
  are not "running the test twice".
- **It runs whatever the selection scores are.**
- **Only the test count estimates the success rate.** The selection counts are inflated by the best-of-3 pick (in v1,
  21/29 on selection against 15/40 on test), so they are never reported as the recipe's rate.
- **Primary:** success/40 with a **Wilson 95% CI**. **The goal is ≥ 24/40**, met or not met. That is the user's bar,
  not a significance test.
- **Secondary, descriptive only** (different seeds, earlier evals, not concurrent controls). Two-sided Fisher exact is
  reported, but no claim is made:
  - vs v1, 15/40 (on 5020–5059);
  - vs the mouse SANT arm, 3/40 (on 5020–5059).
- **Failure reasons are tallied as before** (dropped, not_in_bin, gripper_closed, collision; a failure can carry
  several), with the traces.
- **Descriptive:**
  - every selection table;
  - the DAgger r1 rollouts (successes / 40, frames);
  - each mix's shares and sources;
  - the selection-vs-test gap, as v1 reported it.

## Guards

- **No diagnostics on selection or test seeds.** Diagnostics may use spent practice seeds (5200–5209) or other
  non-reserved seeds, and are logged here before they run.
- **A code bug found mid-run** is logged here as an amendment BEFORE the affected data is produced or used.
- **Stopping a run needs the user's OK.**
- **One training run per model** (one training seed), as in v1.
- **The run log:** each stage appends its start, end and wall time to `C:\dev\pm-t6-big\data\distill\bigtest\run_log.txt`
  (untracked). These notes copy them and are committed between stages.

## Expected GPU time (T6's estimate, serial, full re-exports, 10-22's measured rates, QoS on)

| Stage | Time |
|---|---|
| Held human re-execution (T3, 110 episodes) | 0.5–0.6 h |
| Stage A export (~337k frames) | ~1.8 h |
| Stage A training (180k) | 3.9–4.4 h |
| Stage A selection (3 × 29) | 1.0–1.3 h |
| DAgger r1 rollouts (40) | 0.6–0.85 h |
| Stage B export (~450k frames) | 2.3–2.5 h |
| Stage B training (180k) | 4.2–4.8 h |
| Stage B selection (3 × 29) | 1.0–1.3 h |
| The test (40) | ~0.6 h |
| **Total** | **~16–18 h**, plus ~0.5 h of start-ups and lock gates |

## Also recorded (filled in as the numbers arrive; the ⟨…⟩ cells are results, not design)

| Item | Value |
|---|---|
| Human re-execution pass count (T3) | ⟨kept / attempted; frames⟩ |
| Binarize threshold | `--gripper-deadband 0.25`: closed < 15 mm, open > 25 mm, else hold; start open, reset per episode (inference only) |
| Re-execution k (T3's rule) | ⟨k⟩ |
| Human floor outcome | ⟨held-human used (≥ 80/110), or the original set (< 80, change 2 dropped)⟩ |
| `pm/rl-teacher` source of `cap_from_tool` | `681e8dd` (hook `c75d3da`); teacher code `6101243` |
| Time per stage | ⟨from `run_log.txt`: held human re-exec; Stage A export, train, select; DAgger r1; Stage B export, train, select; test⟩ |

**The code commits (the lead's rule, fixed with this prereg):** each stage's code commit is recorded in `run_log.txt`
at the stage's start. Any code change between stages is listed here, with its diff summary, before that stage runs.
- The code is `pm/held-human` (T3, `C:\dev\pm-t3-hh`) for the re-execution and `pm/bigtest` (T6, `C:\dev\pm-t6-big`)
  for everything after it. Both were still being built when this was frozen:
  - `pm/held-human` was at `a17f231`, with uncommitted files (`sim_eval/held_human.py` and its test);
  - `pm/bigtest` had one commit on `a17f231`, `5cf556c`: the DAgger rollouts load the teacher with
    `cap_from_tool=True`, and round 0 refuses it.
  - `C:\dev\gpu.lock` was absent, and neither worktree had a `data\` output for this experiment.
- **This prereg is committed before either branch's code exists**, because the design, seeds, rules and gripper spec
  are what must come before the data. The code guards above are requirements on `pm/bigtest`. They are checked and
  logged here before Stage A runs.

## Log

### The held human re-execution: code and k (before its GPU run)

**The code: `pm/held-human` `c799064`** (T3, `C:\dev\pm-t3-hh`). It is one commit on `a17f231`, made at 15:07:25, after
this prereg (`9dcc19e`, 15:01:09). The full pytest run: 2758 passed, 35 skipped (T3).
- **Checked here:** 4 files, +635 lines and no deletions:
  - `sim_eval/held_human.py` (`HumanPathTeacher`, `choose_k`, `K_CHOICES = (1.0, 1.25, 1.5, 2.0)`);
  - `sim_eval/scripts/held_human_rollouts.py`;
  - its test;
  - T3's note `2026-10-23-held-human.md`.
- **What it does:**
  - **The source:** the 110 episodes of `mouse20261020` `perfected_multiply_10`, the 10 mouse demos plus 100 SANT
    variants.
  - **The path:** each episode's commanded path is slowed by one k for all episodes. It is capped as the RL env caps
    (`rl_teacher.cap_speed`: 0.5 m/s and 2.5 rad/s from the previous target, then within `DELTA_M` of the tool).
  - **The orientation:** pointing down, turned by the capped yaw. The human quaternions are at most 1.5° off that.
  - **The executor:** the held one, through `sim_eval.distill.rollout(teacher_execution="held")`.
  - **What is kept:** only `check_success` passes, with the "after" (B) pairing. Their `trajectory.json` is the
    achieved path.
  - **The episode's time limit:** the slowed path's length plus `SETTLE_S` (`held_human.max_seconds`).
- **Its seeds** are the human scenes' own (0–4009). No selection, test or DAgger seed is involved.

**k = 2, by the rule fixed above.** The rule is computed on the CPU before any GPU run, from the speed cap alone. The
lag is |capped target − commanded|, taking each episode's maximum, over the 110 episodes:

| k | Median | p95 | Max | Episodes over 2 cm | Yaw-lag p95 |
|---|---|---|---|---|---|
| 1 | 5.58 cm | 15.94 cm | 20.93 cm | 81 | 0.564 rad |
| 1.25 | 1.79 cm | 10.83 cm | 14.32 cm | 50 | 0.422 rad |
| 1.5 | 0.04 cm | 6.90 cm | 9.56 cm | 28 | 0.315 rad |
| **2** | **0.00 cm** | **1.59 cm** | 3.58 cm | 3 | 0.143 rad |

- **k = 2 is the smallest k with p95 ≤ 2 cm** (1.5 gives 6.90 cm). It applies to all 110 episodes.
- **Disclosed:** yaw is capped (at 2.5 rad/s) but is not part of the rule. Its p95 lag at k = 2 is 0.143 rad.
- **The cost:** the human paths average 5.71 s (max 8.38 s), so the re-executed episodes take about twice as long.
- **The GPU run starts now** (T3). Its start line, with the commit, goes in `run_log.txt`. When I checked at 15:08, there
  was no `run_log.txt` and no `gpu.lock` yet. The pass count and the floor decision are logged when it ends.

### `pm/bigtest` (T6): the code for Stage A onwards, checked before any of it runs

**`pm/bigtest` `34f02f7`** (T6, `C:\dev\pm-t6-big`, local only). It is four commits on `a17f231`, touching 21 files, with
+1343 / −61 lines.

| Commit | What |
|---|---|
| `5cf556c` | DAgger rollouts load the teacher with `cap_from_tool=True` (T3's `681e8dd` hook) through `load_teacher_for`; round 0 refuses it |
| `779e0fa` | `--gripper-deadband 0.25` (eval side, `wrap_gripper`, in `run_eval` and `distill_rollouts`); `MAX_STEPS` 200k |
| `24227da` | the seed guards; `--no-stop-rule`; an `nvidia-smi` log every 10 min during export + training; `experiments --resume-run` |
| `34f02f7` | the chain, `sim_eval/bigtest.py` + `sim_eval/scripts/bigtest.py`, and T6's note `2026-10-23-bigtest.md` |

- **Tests (T6):**
  - The full suite: 2779 passed, 0 failed, 35 skipped. The first pass had one failure: `run_human_demo_experiment`'s
    cap test still expected 100k. T6 fixed the test to 200,001 and re-ran it, and it passed (5/5).
  - The torch tests under Isaac's Python (the teacher speed cap, including the real `RLTeacher` DAgger rollout; distill;
    bigtest; inference): 57 passed.
- **Checked here, against this prereg:**
  - `distill_round.py:53`: `SELECT_SEEDS = range(5500, 5558)`.
  - `:54–58`: `RETIRED_SELECT_SEEDS = range(5300, 5400)` and `BIGTEST_TEST_SEEDS = range(5400, 5440)`.
    `EVAL_ONLY_SEEDS` is both test sets plus both of those; the data check (`:379`) refuses any training episode on them.
  - `lerobot_tools/inference.py` `GripperHysteresis`:
    - the thresholds are 0.02 ± 0.25 × 0.04 / 2, so 15 and 25 mm;
    - the mean of the two finger targets is compared, and the last state is held in between;
    - `reset()` sets it open, and only the finger targets are written.
  - `lerobot_tools/train.py:27`: `MAX_STEPS` is 200,000.
  - `bigtest.py`: `INFERENCE_ARGS = ("--gripper-deadband", "0.25")`, `HELD_FLOOR = 80`, steps 180,000, candidates
    60k / 120k / 180k.
- **The chain:** one restartable command, `C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\bigtest.py` (cwd
  `C:\dev\pm-t6-big`). A re-run skips the stages already finished.
  1. **human + teacher:**
     - it waits for T3's `held_human_done.json`;
     - it takes `gpu.lock` for the whole chain;
     - it checks the teacher's sha256 (`811382a3…77aa2`);
     - it writes `human_choice.json` once, by the floor;
     - it reuses the 565 @600 episodes.
  2. **A:** as fixed above.
  3. **B:** as fixed above.
  4. **The test:**
     - `final_choice.json` (A-best vs B-best, a tie to B);
     - `eval_cells` on 5400–5439 with `--gripper-deadband 0.25 --trace`, run id `bigtest_test`, cell `bigtest_final`
       (the test command above used placeholder names; these are T6's);
     - `guard_final` lets it run once;
     - it writes `test_result.json` with the Wilson 95% CI.
- **Already done, on the CPU only (15:12–15:18):** `--prepare` matched the teacher's sha256, and copied and verified the 565
  teacher episodes (451,695 files, 4.65 GB) into `data\distill\bigtest\r0`. `round.json` names their rollouts code,
  `95663cb`. No GPU was used.
- **A blocker, found here before the chain's go:** `bigtest.py:60` hard-codes `held_human_dir` to run 1's folder
  (`...\held_human\mouse20261020`), and the script has no flag to change it.
  - If Amendment 1 applies, the floor is judged on the rerun's folder instead.
  - But `human_choice()` decides once, as soon as run 1's done marker appears, so it would never read the rerun.
  - **Fixed in code: `pm/bigtest` `c6bae0a`** (T6, on `34f02f7`; 4 files, +126 / −28: `sim_eval/bigtest.py`,
    `sim_eval/scripts/bigtest.py`, `sim_eval/tests/test_bigtest.py` and T6's note). It replaces the hand-written-file
    mechanism logged first (`2e35198`).
    - **No default human folder:** `BigTest.held_human_dir` defaults to `None` (checked: `bigtest.py:61`). With no
      human flag, the CLI refuses ("no human set", `scripts/bigtest.py:59`) and `human_choice()` raises
      (`bigtest.py:170`). Only `--prepare` and `--dry-run` work without one.
    - **`--human-grid <grid.json> --human-cell <cell>`:** the set the lead's go names, taken as given. The cell must
      exist, and kept / attempted are recorded from that folder's `held_human_done.json`, if there is one.
    - **`--held-human-dir <T3 run folder>`:** it waits for that folder's done marker and judges the 80/110 floor on it.
    - The two forms together are refused, and so is `--human-grid` without `--human-cell`.
    - **`human_choice.json`** records the grid, cell, `held`, `decided_by`, `held_human_dir` and the counts. Once it
      is decided, a later different choice is refused ("already decided", `bigtest.py:138`/`:142`). A restart with the
      same flags, or with none, reuses it.
    - **Tests:** 4 new in `test_bigtest.py`:
      - never implicit;
      - a held dir is judged and recorded;
      - an explicit set wins and is recorded, and an unknown cell is refused;
      - a recorded choice refuses a different one.
      - `sim_eval` + `lerobot_tools`: 312 passed, 12 skipped. The full suite on `c6bae0a`: 2783 passed, 0 failed, 35 skipped (T6), which is 34f02f7's 2779 plus the 4 new tests.
    - **`run_log.txt`** (15:26:10) records `c6bae0ae1505` as the chain code, superseding `34f02f7c5c64`, with the reason.
      The chain had never started, so nothing had been decided.
    - **The command at the go:**
      `C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\bigtest.py --human-grid <grid> --human-cell <cell>`,
      with exactly the grid and cell the lead names: the settle rerun's `held_human_10` if it reaches ≥ 80/110,
      otherwise the original `perfected_multiply_10`.
    - **The floor is the lead's call,** from the counts logged here. `human_choice.json`'s counts must match this log.

## Amendment 1 (2026-10-23, the lead's decision, before the rerun): a grasp-wait time-warp in the held re-execution

**Reason:** the first held-human run, run 1 (`c799064`, k = 2, `C:\dev\pm-t3-hh\data\held_human\mouse20261020`), ran
to its end at 15:52:55 (started 15:08:25; wall 2667 s) with **0/110 passing, below the floor of 80/110**. No frames were kept, so no `grid.json` was written.
- **All 110 ended at the time limit with `not_in_bin`.** 22 of them also dropped the cube, and 52 collided.
- **Per human** (11 episodes each; checked here from `rollouts.jsonl` and `held_human_done.json`):

  | Human | Outcome |
  |---|---|
  | `00ab` | 11 dropped |
  | `da08` | 7 not in bin only; 4 collision |
  | `be76` | 6 not in bin only; 5 collision |
  | `dc3e` | 6 not in bin only; 5 collision |
  | `ee42` | 2 dropped; 9 collision + dropped |
  | `3cd0` | 11 not in bin only |
  | `b27d` | 1 not in bin only; 10 collision |
  | `68ce` | 6 not in bin only; 5 collision |
  | `848e` | 7 not in bin only; 4 collision |
  | `4c66` | 1 not in bin only; 10 collision |

- **`gpu.lock` was released,** and `run_log.txt` has the end line (15:52:55).
- **It was not stopped.** The prereg says a stop needs the user's OK, so run 1 ran all 110 episodes.
- **T3's diagnosis** (CPU, from the first 40 `teacher_r0_*` held RL-teacher episodes of `distill_mouse_held` r0): under
  the held execution, the tool after a step is not at that step's target.
  - The per-episode p95 of |tool after step k − step k's target| has a median of 31 mm.
  - At the gripper-close step it is a median of 24 mm, with the target 18 mm BELOW the tool.
  - The teacher's target speed just before the close has a median of 0.135 m/s (p90 0.214). So the RL teacher learned
    to aim through the cube.
- **Why that drops the cube:** the human path closes the gripper as soon as it arrives, so under the lag the gripper
  closes about 2 cm high, and the grasp is shallow. k = 2 only fixes the speed-cap lag, not the executor's.

**The change (option B):**
- **A grasp-wait time-warp** (a flag, off by default, so `c799064`'s behaviour is unchanged):
  - at each change of the human's gripper command, the path clock pauses, holding the previous capped target and the
    previous gripper;
  - the pause lasts until |tool − capped target| ≤ 5 mm, or for at most 1.0 s;
  - then the human's gripper command executes and the path resumes.
  - The rollout's time limit grows by 1.0 s per gripper change.
  - Each row's provenance records the wait lengths for every change.
- **Everything else is unchanged:**
  - k = 2;
  - the speed cap, the orientation, the held executor and the "after" pairing;
  - only `check_success` passes are kept, and the achieved path is recorded;
  - the floor (≥ 80/110 → the held-human set; otherwise the original 110, with change 2 dropped and disclosed).
- **The rerun** goes into a NEW out dir, `C:\dev\pm-t3-hh\data\held_human\mouse20261020_settle`. Its `run_log.txt`
  start line carries its commit.
  - **Its behaviour is `pm/held-human` `46963d6`** (parent `c799064`; 3 files, +101 / −22):
    - `HumanPathTeacher` gains `grip_settle_m` (default off) and `grip_settle_max_s`;
    - the rollout script gains `--grip-settle-m 0.005 --grip-settle-max-s 1.0`;
    - `test_held_human.py` goes from 9 to 13 tests;
    - T3's full pytest: 2762 passed, 35 skipped.
  - **The rerun's code is T3's diagnostics-only commit on top of `46963d6`**, with tests. Each row records:
    - the first collision step and its kind (arm–bin or arm–table);
    - the steps with gripper–cube contact;
    - the cube's highest z and the tool's lowest z;
    - the gripper waits.
  - That commit may not change any behaviour. Its hash, its diff summary and a test that behaviour is unchanged are
    logged here BEFORE the rerun starts.
- **THE PILOT RULE** (the lead's, fixed here before the rerun):
  1. **The pilot:** the rerun first runs only the first 22 episodes in the run's order, humans #1 and #2 (`00ab`,
     `da08`).
     - It is launched as a run of those 22 sources only. Continuing is a resume of the same out dir over the other 88.
     - So nothing is stopped mid-run: the pilot is a planned end point, fixed in advance.
  2. **Pilot ≥ 16/22 kept** (the floor's rate, 80/110 ≈ 73%): the rerun continues to all 110, and the floor is judged on
     the full 110 as written.
  3. **Pilot < 16/22:** the rerun ends at the pilot, and **the floor counts as failed**. Both stages use the ORIGINAL
     set, `perfected_multiply_10` (110 episodes). Change 2 is dropped, and that is disclosed.
  - **The pilot's count decides only this.** Its episodes become training data only if the full 110 then reaches the
    floor.
- **The floor is judged on the rerun's count only.** Run 1's rows are kept, untouched, in
  `C:\dev\pm-t3-hh\data\held_human\mouse20261020`, and reported. They never become training data.
- **If the full rerun is below 80/110,** both stages use the original 110 (the prereg's floor), and change 2 is dropped
  and disclosed.
- **Why a pilot (the lead):**
  - B fixes the grasp timing, not the 52 collisions, so going from 0/110 to ≥ 80 is unlikely;
  - every idle GPU hour pushes the test later.

**Disclosed:**
- **This change was decided after seeing run 1's failures,** on the training-data side only. No selection,
  test or DAgger seed has been touched, and no student has been trained. Selection (5500–5557) and the test
  (5400–5439) are unaffected.
- **The rerun is a second attempt at the floor.** The floor's purpose is to keep a broken re-execution out of training.
  Selection still guards the result, since Stage A's pick and the final pick use only selection seeds.
- **The pilot's first 22 aren't a random sample.** They are humans #1 and #2. In run 1, human #1 failed by dropping
  (the failure B targets), and human #2 by not_in_bin, with 4 collisions.
- **The time-warp makes the held-human episodes longer** than k = 2 alone, by at most 1.0 s per gripper change.
- **A second failure mode that this change doesn't target:** 52 of the 110 collided. Option B addresses the grasp, not the
  collisions. Failed rollouts store no trace, so run 1 can't show where the collisions happen. The rerun's diagnostics
  are for that.
- **The cause is T3's hypothesis.** It rests on the held RL teacher's episodes, not on run 1's own failures, which have
  no traces.
- **Run 1's 0/110 is reported as a result of change 2 as first specified:** re-executing the human paths at k = 2
  through the held executor kept nothing.

**Unchanged:** the arm, the seeds, every decision rule and the test.

### Amendment 1: the rerun's code, logged before its launch

**The rerun's code is `pm/held-human` `8071e15`** (T3; parent `46963d6`, whose parent is `c799064`). It changes 3
files, +124 / −18 (checked here).
- **`sim_eval/held_human.py`:**
  - **`rollout_diagnostics(r)`** reads a finished `Rollout` only. Per row, it records:
    - the first step and the count of arm–bin contacts, of arm–table contacts and of gripper–cube contacts;
    - the cube's z at the start and at its highest;
    - the tool's lowest z;
    - at each commanded gripper change, the tool after that step against its target (in mm, and in z).
  - **`pilot_decision(successes, pilot_min)`** returns `None` until every pilot episode has run. Then it returns
    "continue" if at least `pilot_min` passed, else "stop".
- **`sim_eval/scripts/held_human_rollouts.py`:**
  - each row gains `diag`;
  - it gets `--pilot N --pilot-min M`;
  - the pilot line goes to the log and to `run_log.txt`;
  - `held_human_done.json` gains `passed`, `stopped_after_pilot`, `pilot`, `pilot_min` and `pilot_decision`.
  - **On "stop"**, `kept` is 0 and no `grid.json` is written, so nothing from the rerun can be trained on (checked:
    `finish()`).
- **Tests (T3):**
  - `test_held_human` 16/16. `test_the_diagnostics_only_read_a_finished_rollout` shows identical `teacher_ee`,
    executed and label arrays with and without the diagnostics, and across two rollouts.
  - The pilot test covers `None`, continue (16/22) and stop (15/22).
  - The full pytest: 2765 passed, 35 skipped.

**How the pilot rule runs (a clarification of the mechanism; the rule is unchanged):** ONE invocation, and the code
applies the rule. No one stops the run.
- The script runs sources 1–22 in run order (`00ab` × 11, then `da08` × 11). After the 22nd row, `pilot_decision`
  applies "≥ 16/22".
  - **Below 16:** it writes `held_human_done.json` with `stopped_after_pilot: true` and `kept` 0, and exits normally
    without starting sources 23–110.
  - **16 or more:** the same process continues over the other 88. The floor is judged on 110.
- **Re-running the same command** resumes from `rollouts.jsonl` and re-applies the rule from the existing rows.
- **This replaces the wording above** ("launched as a run of those 22 sources only; continuing is a resume"). The end
  point is still fixed in advance, and it is now applied by code instead of by a relaunch.
- **The source order** is the grid's, read by the same code as run 1, so the first 22 are the same sources as run 1's
  first 22 (checked: run 1's rows 1–22 are `00ab` × 11 and `da08` × 11).

**The command** (cwd `C:\dev\pm-t3-hh`; it takes its own `gpu.lock`, with `KeepAwake` and `full_speed`):

```text
C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\held_human_rollouts.py --k 2 --grip-settle-m 0.005 ^
  --grip-settle-max-s 1.0 --pilot 22 --pilot-min 16 --grid C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json ^
  --cell perfected_multiply_10 ^
  --start-state C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 ^
  --out data\held_human\mouse20261020_settle --run-log C:\dev\pm-t6-big\data\distill\bigtest\run_log.txt
```

### Amendment 1's pilot: the floor FAILS, so both stages use the original human set

**The pilot on `8071e15` can no longer reach 16/22.** At 16:10 it stood at **0/14** (`00ab` 0/11, `da08` 0/3), so
at most 8 of the remaining 8 rows could pass, and 8 < 16. By its own rule (Amendment 1) it ends at row 22 with "stop".
Its final line is logged below when it lands. It started at 16:02:27 (`gpu.lock` `T3 38564 held_human`).
- **The rows so far** (checked here, from `mouse20261020_settle\rollouts.jsonl`):
  - `00ab`: 11 of 11 `not_in_bin` + `dropped`, with 44–46 steps of gripper–cube contact each.
  - `da08`: 3 of 3 `not_in_bin`, with **no gripper–cube contact at all**.
  - No arm–bin or arm–table contact on any row.
  - The cube's highest z is 0.025–0.0257 m against a start of 0.025 m, so it is never lifted.
  - The grip waits are 9–14 steps at the close.
- **T3's figure:** the tool's lowest point is z ≈ 0.058 m, against the human's grasp height of 0.0395 m. So the fingers
  close about 19 mm above the grasp point.

**The pilot's final line (16:13:47): kept 0/22 → "stop"**, as the rule says. It started at 16:02:19, with a wall time
of 687 s; `gpu.lock` was released afterwards.
- **`held_human_done.json`:**
  - kept 0, attempted 22, passed 0;
  - `stopped_after_pilot: true`, `pilot_decision: "stop"`;
  - frames 0, no `grid.json`;
  - failures: not_in_bin 22, dropped 11, collision 2;
  - code `8071e15`, clean.
- **The rows:**
  - `00ab`: 11/11 not_in_bin + dropped, all with gripper–cube contact.
  - `da08`: 11/11 not_in_bin, **none with gripper–cube contact**. 2 of them collided with the bin, first at steps 521
    and 528 (93 and 4 contact steps), after the missed grasp. No arm–table contact on any row.
  - The cube's highest z over all 22 rows is 0.0257 m (it starts at 0.025 m).
- **Sources 23–110 never ran**, so the floor fails by the pilot rule.
- **Correction to the 16:10 entry above:** "no arm–bin or arm–table contact" held for the first 14 rows. The 2 bin
  collisions came later, both in `da08`.

**T3's pilot diagnostics** (written up in T3's `2026-10-23-held-human.md`, `pm/held-human` `ac6a8c1`; the branch is
`c799064` → `46963d6` → `8071e15` → `511d9a5` → `ac6a8c1`, not pushed):
- **`00ab`:** the tool's lowest z is 0.058 m, against the human's grasp height of 0.0395 m. About 45 steps of
  gripper–cube contact. Grip waits 9–12 and 9–14 steps.
- **`da08`:** the tool's lowest z is 0.075 m. No gripper–cube contact. Grip waits 12, then 0–3 steps.
- **At each close,** the tool was 13.4–14.1 mm from its target.
- **T3's model k table** (median / p90 close error; the share of waits hitting the 1.0 s limit). It is a rough model:
  it gives waits of 14 steps against the real 11–12, and a lowest z of 0.041 m against the real 0.058 m.

  | k | Close error | Waits at the limit |
  |---|---|---|
  | 2 | 76 / 108 mm | 73% |
  | 3 | 12 / 50 mm | 34% |
  | 4 | 4.7 / 5.1 mm | 10% |
  | 5 | 4.7 / 4.9 mm | 0% |

- **The post-test k = 5 pilot** runs on `511d9a5`. It is a measurement only (the lead's call), and nothing from it
  enters this experiment.

**The lead's decision, applying the prereg and Amendment 1 as written (no new amendment):**
- **The floor FAILS.** Stage A AND Stage B use the ORIGINAL human set, `perfected_multiply_10` (the 110 episodes from
  `C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json`).
- **Change 2 is dropped, and that is disclosed here.** The arm that runs is v2 without change 2: the gripper deadband,
  180k steps, and Stage B's DAgger r1 with the retrain.
- **Nothing from either held-human run is trained on.** Run 1 kept 0, and the pilot's "stop" writes `kept` 0 and no
  `grid.json`.

**Disclosed: why change 2 failed.**
- **A bug in the pilot's code (T3's):** `8071e15`'s grasp wait held the PREVIOUS capped target. On a descent that
  target lags the human's point, so the wait ended with the tool about 19 mm above the grasp point.
  - The fix is `511d9a5` on `pm/held-human`: the wait commands the human's point at the change, capped as always, until
    the tool is within the distance. It is committed as a candidate only. **It was NOT used, and nothing ran on it.**
- **The root cause (T3's finding):** the held executor closes only about 9% of the tool-to-target gap per step. T3
  measured that over about 59k steps of T6's held teacher episodes. So the tool tops out at about 0.1–0.15 m/s.
  - k = 2 is too fast for that. The prereg's k rule measured only the speed-cap lag (capped target vs commanded), not
    the executor's lag (tool vs target). **The rule measured the wrong limit.** That is T3's error and the reason change 2
    failed.
  - T3's model sweep puts a workable k at about 5.
- **A k = 5 pilot is queued as a post-test diagnostic only.** It has no effect on this experiment: it runs after the
  test, and its data is never part of this arm.

**Next:** the lead gives T6 the go with `--human-grid C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json --human-cell
perfected_multiply_10`. The go line is logged here when T6 writes it.

### The go: the chain started at 16:14:10 with the original human set

From `run_log.txt` (`C:\dev\pm-t6-big\data\distill\bigtest`), checked here:
- **16:14:09, T6's go line:**
  - the human set is the ORIGINAL, `--human-grid C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json --human-cell
    perfected_multiply_10`;
  - `decided_by`: the lead's go (the held-human floor failed: run 1 0/110, the Amendment 1 pilot below 16/22);
  - change 2 is dropped.
- **16:14:10:** the chain starts, on `pm/bigtest` `c6bae0a` (`c6bae0ae1505…`), clean.
- **16:14:17:** it takes `gpu.lock` (`T6 45256 bigtest`).
- **`human_choice.json`** (16:14:17): `held: false`, the grid and cell above, floor 80, `decided_by` "--human-grid /
  --human-cell (the lead's go)".
- **Teacher:** 565 episodes, 451,695 files, 4,647,066,907 bytes, reused from
  `C:\dev\pm-t6\data\distill\distill_mouse_held\r0`, with teacher sha256 `811382A3…AA2`, as on 10-22.
- **Stage A's mix** (`distill_r0`): human 31,536 frames ×3.5584 (33%) and teacher 224,435 frames ×1.0 (67%).
- **Training started at 16:14:18:** ACT, 180,000 steps. Selection follows on 5500–5528 (60k / 120k / 180k).

**Disclosed: with change 2 dropped, Stage A trains on exactly v1's data.** It is the same 110 human episodes and the
same 565 teacher episodes, with the same repeats (v1's `round_t600.json`: ×3.5584 and ×1.0). So Stage A differs from
v1 only in:
- the training length (180k against 60k, with candidates 60k / 120k / 180k);
- the gripper deadband at inference;
- new selection seeds.

Stage B adds DAgger r1.

### The stop: the chain was stopped at 22:06:07 in Stage A's selection, by the user's request, to resume 10-24

**The user asked for the stop** (in chat, relayed by the lead to T6). That is the prereg's guard ("a stop needs the
user's OK"), met. T6's `run_log.txt` line (22:07:35) reads: "stopped at 22:06:07 in stage A select (60k 13/29 and
120k 17/29 done; 180k partial: seeds 5500-5505 finished, 4/6) by the user's request (chat), to resume 10-24".
Checked here, from `C:\dev\pm-t6-big\data\distill\bigtest` and `C:\dev\pm-t6-big\data\evals\bigtest_r0_t600`:
- **`bigtest_status.json`:** started 16:14:10, stopped 22:06:07, stage "A select", "stopped by the user (chat), to
  resume 10-24".
- **The process tree** of launcher 39496 was killed (`taskkill /T`). `C:\dev\gpu.lock` is gone. It was moved aside, not
  deleted, to `data\distill\bigtest\gpu.lock.stopped-20261023_220720` (it holds `T6 45256 bigtest 2026-10-23T16:14:17`).
- **Code:** `pm/bigtest` HEAD is still `c6bae0a` (`c6bae0ae1505…`), clean. No code changed. Nothing was deleted.

**Stage A so far:**

| Step | Time | What |
|---|---|---|
| Export | 16:14:18 → ~18:06:47 (~1.9 h) | `distill_r0`: 956 episodes, 336,729 frames; human 112,294 (×3.5584, 33%) + teacher 224,435 (67%) |
| Train | ~18:06:47 → 21:15:19 (3.14 h) | ACT, 180,000 steps, batch 8, checkpoints every 10k; `train_time_s` 11,311.5, final loss 0.071; exit 0 |
| Select 60k | 21:15:19 → 21:40:15 | 13/29 on 5500–5528 |
| Select 120k | 21:40:15 → 22:01:01 | 17/29 on 5500–5528 |
| Select 180k | 22:01:01 → stopped 22:06:07 | partial: 6/29 episodes, 4 successes |

The training start is derived: 21:15:19 minus `train_time_s`. `train.log` has no line of its own for the end of the export.

**The selection episodes** (`*.episodes.jsonl`, all with `gripper_deadband` 0.25, no errors):
- **60k:** 13/29, seeds 5500–5528, each once. Failure reasons (one episode can have several): dropped 16, not_in_bin 15,
  collision 13, gripper_closed 2.
- **120k:** 17/29, seeds 5500–5528, each once. Failure reasons: dropped 12, not_in_bin 10, collision 5, gripper_closed 3.
- **180k, partial:** seeds 5500–5505. 5500, 5501, 5503 and 5505 succeeded. 5502 failed (not_in_bin, gripper_closed,
  dropped) and 5504 failed (not_in_bin, dropped). The eval log ends at episode 6/29. Seed 5506 was running when the
  process was killed and has no record.

**No step has been chosen, and no decision has been made.** Stage A's pick needs the full 180k count. By the prereg's
rule, ties go to the later checkpoint.

**The resume, as T6 states it and as checked in the code:**
- It is the same chain command, on the same code. The export, the training and the 60k/120k counts are reused.
- 180k's selection runs with `run_eval --resume`: it keeps 5500–5505 and runs 5506–5528 with the same checkpoint and
  settings.
- `EpisodeLog.open` (`sim_eval/progress.py`) refuses to resume if the header differs in any of `checkpoint`, `seed0`,
  `max_seconds`, `cameras`, `reset_pose` or `inference` (the deadband is part of `inference`).
- Only episodes that ended in `sim_error` or `policy_error` are rerun. Neither occurs in the 6 finished ones.
- Then Stage B and the test run as preregistered.

**Disclosed:**
- **s180000's 29 selection episodes span two sessions:** 6 on 10-23 (5500–5505) and 23 on 10-24 (5506–5528). They use
  the same checkpoint, settings and code. The Isaac and policy-server processes are restarted between the two parts.
- **The partial 180k result (4/6) is known before the rest runs.** Nothing can be changed because of it: the checkpoint,
  the settings and the pick rule are all fixed, and the resume refuses any change to them.
- **The selection counts are selection-only.** They are inflated by the best-of-3 pick (v1's was 21/29 on selection
  against 15/40 on the test). Only the test on 5400–5439 estimates the rate.
- **The test seeds 5400–5439 have not been touched.**

### 10-24: the resume, Stage A's pick and DAgger round 1 (the lead; T6/T7 sessions were not running)

**The resume (16:04:53, on the user's go in chat).** The same chain command was run on the same code, `pm/bigtest`
`c6bae0a`, clean. The lead ran it in a terminal tab; GPU idle, no `gpu.lock`, CARLA closed. The chain took
`gpu.lock` at 16:05:04 and reused the export, the training and the 60k/120k counts. 180k's selection resumed at seed 5506.

**Stage A, complete (selection on 5500–5528, `gripper_deadband` 0.25):**

| Checkpoint | Successes | Failure reasons (an episode can have several) |
|---|---|---|
| 60k | 13/29 | dropped 16, not_in_bin 15, collision 13, gripper_closed 2 |
| 120k | 17/29 | dropped 12, not_in_bin 10, collision 5, gripper_closed 3 |
| **180k** | **21/29** | not_in_bin 8, dropped 7, collision 4, gripper_closed 2 |

- **The pick:** by the rule (most successes), the A-best is **180k** (`stageA_pick.json`). It finished at 16:19:12.
- **180k's 29 episodes span two sessions:** 6 on 10-23 and 23 on 10-24, as disclosed above.
- **These counts are selection only and inflated by the best-of-3 pick.** v1 also scored 21/29 on selection, and 15/40 on
  its test.

**DAgger round 1 (16:19:13 → 16:47:48):**
- **Student:** the A-best (180k) drove 40 episodes on 5210–5249 (beta 0), with the held teacher relabelling every step
  (`cap_from_tool`).
- **Student success: 28/40 (70%)**; 12 hit the time limit.
- **Failure reasons:** not_in_bin 11, dropped 11, collision 6, gripper_closed 2.
- **Frames:** 29,600 labelled.
- **The stop rule:** off, as pre-registered. Its verdict, "continue", is recorded in `decision.json`.
- **A caveat on the 28/40:** these seeds were not used for any pick, but it is not a test. The seeds are practice
  seeds, and 5210–5219 were seen on 10-18 by a different policy (disclosed in the seed section).
- **Stage B mix:** human 31,536 ×3.5584 (25%), teacher 224,435 ×1.0 (50%), DAgger 29,600 ×3.7911 (25%).
- **Stage B export:** 16:47:49 → ~19:18.
- **Stage B training:** started ~19:18.

**The second stop (21:24:48, by the user's request in chat).**
- The user was asked first, after the lead had pointed out that training was half done. They chose "Stop now,
  resume tomorrow".
- The stop came during Stage B's training. The last checkpoint was 090000 of 180,000.
- `taskkill /T` was run on chain PID 39540, which included the training process.
- The stale `gpu.lock` was moved aside to `data\distill\bigtest\gpu.lock.stopped-20261024_212443`. Nothing was deleted.

**The second resume (10-25 11:25:41, on the user's go).**
- Same command, same code `c6bae0a`, clean.
- The chain skipped human+teacher, A, DAgger and the grid. Its training resumed the unfinished run
  `bigtest_r1_20261024_164749` via `find_unfinished_run` → `lerobot_tools.experiments --resume-run`.
- The training log shows the remaining 90,000 steps counting from 0/90000 at ~16 steps/s, i.e. a resume from
  checkpoint 090000, not a restart.
- **Disclosed:** Stage B's training spans two sessions, 0–90k on 10-24 and 90k–180k on 10-25. This was the first real
  use of the resume path (until now it was only unit-tested). Selection of 60k/120k/180k and the test follow as
  pre-registered.

**The raw results** are copied into `2026-10-23-bigtest/results/`:
- the Stage A selection episodes and summaries, plus the pick;
- the DAgger rollouts, `rollouts_done.json` and `decision.json`;
- `run_log.txt`;
- `human_choice.json`.

The test seeds 5400–5439 have still not been touched.
