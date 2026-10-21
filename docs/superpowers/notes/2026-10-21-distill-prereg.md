# Pre-registration: SANT data + the RL teacher, distilled into the ACT camera student (2026-10-21)

**Frozen by this commit, before any teacher training, rollout or distillation has run.** On 2026-10-21 morning there
was no `C:\dev\gpu.lock`, no RL log and no `data\distill\` in pm-t3 or pm-t6. Any later change to a rule below is an
amendment, written and committed with its time and reason before the step it affects runs.

This is the plan of the approach research note ([2026-10-20-research-approach.md](2026-10-20-research-approach.md))
as the user decided it:
- **Few human demos:** the 10 mouse demos.
- **SANT multiply.**
- **An RL teacher** learned from a reward that mirrors `check_success`, with SANT-verified human demo starts. There is
  no hand-written teacher: the scripted expert and `recovery.py` are not teachers, and a test guards that.
- **Distillation** into the camera policy, with DAgger only if needed.

The details are in T3's [rl-teacher](2026-10-20-rl-teacher.md) note (in `C:\dev\pm-t3`) and T6's
[distill-dagger](2026-10-20-distill-dagger.md) note (in `C:\dev\pm-t6`).

## Code, at freezing

| Branch | Commit | What it supplies |
|---|---|---|
| `pm/rl-teacher` (T3, `C:\dev\pm-t3`) | **`8a234b7`** | the RL env (`SANT-PickPlace-Franka-RL-v0`), reward, demo-start bank, PPO config, `rl_train.py`, the teacher eval and verify, `sim_worker.rl_policy:make` |
| `pm/distill-dagger` (T6, `C:\dev\pm-t6`) | **`1a47223`** | `IsaacDistillEnv` (`teacher_state`, `ik_label`), `distill_round.py` (rollouts, mix, grid, train, select, DAgger, stop rule) |
| `pm/live-13` (this note) | the commit that adds this file | `eval_cells.py`, `check_success`, the test command |

- **Both branches are expected to change today**, for smoke-test fixes and the teacher's run directory. The commits
  each step actually ran from are recorded in the results note (each `round.json` and the RL run directory name them).
- **Fixes that need no amendment:** fixes needed to make the planned steps run as described.
- **Changes that are amendments:**
  - the reward's success definition;
  - the teacher gate;
  - seed ranges;
  - the selection rule;
  - mixing weights;
  - `check_success`;
  - the test command.

## The arm

**`distill_mouse`**: SANT's data plus the RL teacher, distilled into ACT.

1. **The teacher.** T3's `SANT-PickPlace-Franka-RL-v0`.
   - PPO (rsl_rl).
   - Demo starts from `data\rl\bank_mouse20261020.npz`: 110 verified episodes of mouse20261020's
     `perfected_multiply_10` cell, 5,125 restorable states, `demo_prob` 0.5, late-to-early curriculum.
   - Its size (number of envs, iterations) is set from the smoke and probe runs, as T3's note says. That is a resource
     choice, not a result-dependent one.
2. **The teacher gate, before any distillation.** Both checks must reach **≥ 90%**:
   - **(a) SANT's replay check:** T3's `rl_eval_teacher.py` + `rl_verify_teacher.py` (step 2, the unchanged
     `check_success`) on **practice seeds 5300–5349** (n = 50), so ≥ 45/50.
   - **(b) T6's in-env gate:** `distill_round.py --round 0 --teacher-n 50 --stop-after rollouts` on teacher seeds
     4000–4049 (`rollouts_done.json`), so ≥ 45/50. This is the env the labels come from.
   - **The teacher checkpoint** may be chosen among T3's saved checkpoints on those practice seeds only. Seeds
     5020–5059 are never used for the teacher.
   - **If the gate fails:** no distillation runs. The fallbacks are T3's RL-side ones (reward weights, curriculum,
     demo-start weighting, more iterations). Re-checking the gate after a fallback is allowed. Nothing changes the
     ≥ 90% bar.
3. **Round 0, with 300 teacher runs.** `distill_round.py --round 0 --teacher-n 300` (teacher seeds 4000–4299):
   - only passing teacher rollouts become episodes;
   - the mix uses T6's default weights: human (the SANT cell) 0.25, teacher 0.5 (DAgger 0.25, absent in round 0);
   - ACT trains from scratch, then the checkpoint is selected.
4. **The student and selection.** The flags are fixed below.
   - **Candidates:** the 40k and 60k checkpoints.
   - **Selection seeds:** **5300–5329** (n = 30).
   - **The rule:** the most successes wins; a tie goes to the later step (T6's `select`, `overnight.pick_step`).

### Training and inference flags (fixed now)

| | Setting |
|---|---|
| Policy | LeRobot ACT, defaults (chunk 100, the CVAE on, ResNet-18, 128×128 front + wrist cameras), batch 8 |
| Steps | **60,000**, a checkpoint every 10,000; candidates **40,000 and 60,000** (`distill_round` defaults) |
| `--train-args` | **none**: no `--augment`, no `--dilation` |
| `--inference-args` | **none**: the checkpoint's own `n_action_steps` (100), continuous finger targets, no ensembling |
| Mix (`--weight`) | defaults: human 0.25, teacher 0.5, dagger 0.25 |
| Eval | serial `eval_cells`, 30 s, front + wrist, start = `hx_mouse20261020_20261020_164411\datasets\raw_10` (`--start-pose dataset`), as both baselines |

**Why plain:**
- The Stage-0 inference test has not run, and the training options (`--augment shift`, `--dilation`) have never run on
  this GPU. Adding untested options on top of a teacher pipeline that runs for the first time today would confound the
  result and risk the day.
- Plain flags also keep the student comparable with both baselines (3/40 and 0/40), which were evaluated the same way.
- The same flags hold for every selection, every DAgger student and the test.

## The rule for 300 vs 600 (decided on selection seeds 5300–5329 only)

"60% on selection" means **≥ 18/30**.

1. **Round 0 at 300.** If its selected checkpoint scores **≥ 18/30**, it is **the final model**.
2. **Otherwise, round 0 at 600.** Teacher seeds 4000–4599: the 300 kept, 300 more added. Retrain from scratch on the
   larger mix and reselect (40k / 60k, 5300–5329). If its selected checkpoint scores ≥ 18/30, it is the final model.
3. **Otherwise, DAgger round 1.**
   - The round-0-at-600 student drives on **practice seeds 5200–5239**, and the teacher relabels every state.
   - Then T6's stop rule. Round 1 stops (no grid, no training) if:
     - the student already succeeds on ≥ 90% of those seeds; or
     - it gained < 5 points over the round before; or
     - the round produced < 5,000 labelled frames.
   - If round 1 does not stop, it aggregates (human + teacher + DAgger r1), retrains from scratch and reselects.
   - **The final model** is the trained candidate with the most selection successes: round 0 at 600's selected
     checkpoint or round 1's. A tie goes to round 1. If round 1 stopped, the final model is round 0 at 600's.
4. **No DAgger round 2** in this pre-registration. Running it would be an amendment.

At each step the decision uses only selection-seed counts (and T6's stop-rule numbers on 5200–5239). It never uses
5020–5059.

## The test (once, on the final model)

- **Seeds 5020–5059** (n = 40). Never touched by the teacher, any rollout, DAgger or selection.
- **The command, run once:**

  ```text
  C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\eval_cells.py --run-id distill_mouse_final ^
    --checkpoint distill_final=<the final model's checkpoint, from its round's selection.json> --seed0 5020 --n 40 ^
    --start-state <DATA_DIR>\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 --start-pose dataset --trace
  ```

  It runs with no inference flags (as fixed above) and the unchanged `check_success`. `eval_cells` re-runs only seeds
  that ended in `sim_error` / `policy_error`. Those say nothing about the policy and are not "running the test
  twice".
- **Reported:**
  - **Primary:** success/40 with a **Wilson 95% CI**.
  - **The goal: ≥ 24/40 (60%)**, met or not met. That is the user's bar, not a significance test.
  - **Two-sided Fisher exact vs the mouse SANT arm, 3/40** (same data, no teacher; [mouse20261020
    results](2026-10-20-mouse20261020-results.md)). α = 0.05. Significant needs **≥ 11/40** (p = 0.037).
  - **Two-sided Fisher exact vs the mouse raw arm, 0/40.** Significant needs **≥ 6/40**.
  - **Reference only, no test:** the scripted multiply policy's **17/40** (sprint 7). It was trained on
    scripted-expert data, a different source.
- **Caveats, stated now:**
  - The baselines are earlier evals, not concurrent controls. PhysX is not deterministic.
  - Two Fisher tests are reported; both are named here in advance.
  - One training run (seed 1000) per model.
- **Descriptive** (no claims):
  - the teacher gate's numbers (a) and (b);
  - each round's mix shares (`round.json`) and sources (`manifest.json["sources"]`: human / teacher / dagger frames);
  - the selection tables;
  - the stop-rule record;
  - the final model's failure reasons and traces.

## Secondary arm, if time allows

**`distill_mouse_nodemo`**: the same pipeline with T3's **`SANT-PickPlace-Franka-RL-NoDemo-v0`** teacher (no demo
starts; `rl_train.py --no-demos`). Its purpose is to measure what the human demos add to the teacher.
- **Same rules:** the same gate, the same round-0 rule (300, then 600 on selection < 18/30, then DAgger round 1), the
  same flags and selection seeds.
- **The student's mix still includes the SANT human cell,** so the only difference is the teacher's demo starts.
- **If its teacher fails the gate,** that is the finding: "without demo starts, the teacher did not reach 90%
  (x/50)". No student is built.
- **Its final model,** if any, is tested once on 5020–5059 with the same command (`--run-id
  distill_mouse_nodemo_final`).
- **The comparison is descriptive:**
  - demo vs no-demo teacher success on practice seeds 5300–5349;
  - the students' 5020–5059 counts, with two-sided Fisher reported but not a pre-registered claim;
  - the RL iterations each teacher needed to reach the gate.

## Time (T6's and T3's estimates on the RTX 5080)

| Step | Estimate |
|---|---|
| Teacher: smoke, probe, the real run, eval and verify on 5300–5349 | ≈ 1.5–2 h |
| ik_label smoke (`--teacher-n 4`) + the 50-scene gate (b) | ≈ 0.5 + 0.35 h |
| Round 0 at 300: rollouts, export, 60k training, selection | ≈ 4–5 h |
| If needed, round 0 at 600: +300 rollouts, a bigger export, retrain, reselect | ≈ +4 h |
| If needed, DAgger round 1 | ≈ 4–4.5 h |
| The test | ≈ 45 min |

If round 0 at 300 passes selection, the test can run tonight. The longest path (600 and then round 1) runs into
2026-10-22.
