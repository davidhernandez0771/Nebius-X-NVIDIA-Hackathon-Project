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
  - T6 was asked for a `--held-human-dir` flag. **The lead's resolution: no code change is needed**, and this is the
    mechanism.
    - The chain is not running, so nothing can decide at run 1's marker.
    - At the lead's go, T6 writes `data\distill\bigtest\human_choice.json` before the chain starts. It holds:
      - the exact grid and cell the lead names: the settle rerun's `held_human_10` if that reaches ≥ 80/110,
        otherwise the original `perfected_multiply_10`;
      - the run it came from, its kept / attempted, and `decided_by`.
      - A `run_log.txt` line records it too.
    - `human_choice()` returns an existing `human_choice.json` and never re-decides (checked: `bigtest.py:118–121`).
      The preflight and the data check run on the named cell.
    - The script's wait loop (`scripts/bigtest.py:78`) still waits for run 1's marker. That is harmless once run 1 has
      ended.
    - **So the floor is applied by the lead,** from the counts logged here, not by `human_choice()`'s own rule. The
      file's numbers must match this log.
    - A `--held-human-dir` flag is optional (T6's choice) and not required for the go.
