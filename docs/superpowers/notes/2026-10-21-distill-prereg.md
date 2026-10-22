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

## Code log: run-enabling fixes, not amendments (appended 2026-10-21 morning)

Each was decided and committed **before any teacher passed the gate and before any distillation rollout, training or
selection ran**. None changes:
- the reward's success definition;
- the teacher gate (≥ 90%, the two checks);
- the seed ranges;
- the selection rule;
- the mixing weights;
- `check_success`;
- the test command.

**`pm/distill-dagger` (T6), from `1a47223`:**

| Commit | Fix | Why it is run-enabling |
|---|---|---|
| `185612f` | Teacher commands are executed as in T3's RL env (`sim_eval/teacher_ik.py`): IK re-solved at both substeps plus SANT's velocity feed-forward. Round 0 at a larger `--teacher-n` keeps the earlier rollouts, adds the new seeds and retrains and reselects into per-size records (grid `distill_mouse_r0_t300` / `_t600`, `r0\round_t300.json`, `r0\selection_t300.json` / `_t600`). `r0\selection.json` is always the latest selection; DAgger round 1 starts from it. | At `1a47223`, re-running round 0 with `--teacher-n 600` would have skipped grid, train and select as "done". That is the 300→600 rule as written above, now executable. The execution change makes the teacher behave as it was trained. |
| `351e737` | **Round-0 labels follow replay exactly** (the lead's decision "B"): a teacher row pairs the observation *after* step k with step k's last-substep arm target plus fingers, which is what `replay._physics_step` records. The rollout's last step is dropped. DAgger relabels stay one DLS step from the observation *before* the step, the documented approximation. Both targets are saved per step in `teacher.npz`. | It keeps teacher episodes in the same row convention as every replayed SANT episode in the mix. Its suite: 2610 passed, 28 skipped. |
| `bd01176` | `round.json`, the selection files and `rollouts_done.json` record the code they ran from (commit, branch, dirty flag). | The record this pre-registration asks for. No behaviour change. |

The lead named `351e737` as T6's final run-enabling fix; `bd01176` (provenance only) came 1 minute later. T6 will also
merge T3's final `pm/rl-teacher` commit into `pm/distill-dagger` locally so the teacher imports, so each run records
one commit.

**`pm/rl-teacher` (T3), from `8a234b7`:**

| Commit | Fix | Why it is run-enabling |
|---|---|---|
| `f0beb24` | UTF-8 for the trainer and the wrapper's echo (cp1252 crashed both in the smoke). The IK controller names the robot spec's joint-limit gain explicitly (Franka 0: unchanged). | The smoke run crashed. No behaviour change. |
| `827a5fb` | **A deviation from the action as written in T3's note, logged openly:** the teacher's action is now a bounded step from the current tool pose (≤ 2 cm and 0.1 rad per step), made absolute, as Isaac Lab's IK-Rel lift task. It was an absolute tool target in the workspace box. Eval step 1 also takes `gpu.lock` + KeepAwake. | **`demo_v1` failed and is discarded:** with absolute actions, the untrained policy threw the arm across the workspace on every first step, so the demo starts were lost and nothing was learned in 300 iterations. `make()` still hands T6 an absolute tool target, so the distillation interface is unchanged. |
| `8e85acb` | Commits the RL episode fixtures' `.npz` files (the `*.npz` ignore rule had kept them out). | Tests only: T6's trial merge failed 10 tests without them. No behaviour change. |
| `c7ee8ca` | The held-start probe (`scripts/rl_probe_demo_starts.py`) and `held_grace_steps`, off by default: after a held demo start, the gripper stays closed and the fingers are commanded closed for N steps. Also a `bank_phase` filter and start rows, for diagnostics. | The probe found why `demo_v2` failed (below). The grace is what `demo_v3` turns on. |
| `751d9bf` | The RL scripts import the env class only after Isaac Sim starts (an early import loaded the pip USD build, whose `omni.usd` has no `get_context`). All writing happens inside the app's context, because closing the app ends the process; exceptions go to `error.txt` first. | The scripts crashed or lost their outputs. No behaviour change. |

**Recorded as failed attempts** (none was gated, and no rollout or student used either):
- **`demo_v1`:** T3's first teacher training run, with absolute actions. It did not learn (see `827a5fb`).
- **`demo_v2`:** relative actions, no grace. Started 09:48 and stopped by the lead, with the user's permission: lift was
  still 0 by iteration 300. The cause, from T3's probe (`c7ee8ca`): the untrained policy's gripper exploration opened the
  gripper on about 50% of steps, so held demo starts dropped the cube. The restore itself was exact: with the gripper
  forced closed, 64/64 held starts kept the cube.

**`demo_v3`** (started 10:47, after `751d9bf`) changes RL training settings only:
- `held_grace_steps` = 10 (it was off);
- the curriculum: 24k → 48k steps;
- the initial action std: 1.0 → 0.6.

The reward, the success definition and everything in the list at the top of this section are unchanged. The lead logs
these as run-enabling. They are training settings for the teacher, and the teacher is held to the same gate (≥ 90%,
both checks) before any distillation, so they do not touch what the test measures.

**`demo_v3` failed:** started 10:47 and stopped at about 11:05 by the lead, with the user's permission. Lift and carry
stayed flat at about 1.5%, and the action std rose from 0.6 to 1.2. No rollout or student used it, and it was never gated.

## Amendment 1 (2026-10-21, approved by the lead, decided before any teacher passed the gate)

This one is an amendment, not a run-enabling fix, because it changes the teacher's training reward.

**What changes, for the run `demo_v4` (RL training only):**
- **Reward scale:** the progress, penalty and success terms are multiplied by 50. This undoes Isaac Lab's
  multiplication of every reward term by dt. The action_rate and joint_vel penalties are unchanged.
- **Entropy:** `entropy_coef` 0.006 → 0.001.
- **Gripper deadband:** 0.5 (`6008c41`). The gripper switches only past ±0.5 and otherwise keeps its state, in the
  env's gripper term and in T6's adapter, which reads it from the run's `params/env.yaml`. It is off by default in
  the code.

**Why:** in `demo_v3`, the entropy bonus outweighed a per-step reward of about 1e-4 to 1e-2. So the policy grew noisier
(std 0.6 → 1.2) instead of learning to lift.

**Unchanged:**
- the success definition and `check_success`;
- the teacher gate (≥ 90%, both checks);
- the seed ranges;
- the selection rule;
- the data mix's weights;
- the test command.

The reward's *scale* changes. What counts as success does not, and the gate and the test measure success only.

**Where it is in the code:** `demo_v4` runs the code at `6008c41`. The code's defaults are unchanged, and every value
above is a Hydra override on the trainer's command line. T3 recorded that command, the run's own `env.yaml` and
`agent.yaml`, and a table of code default vs `demo_v4` in `ce5762c` on `pm/rl-teacher`, at
`docs/superpowers/notes/2026-10-20-rl-teacher/demo_v4/`. The command
(`train.py --rl_library rsl_rl --task SANT-PickPlace-Franka-RL-v0 --num_envs 4096 --max_iterations 1500 --run_name demo_v4`)
sets:

| Override | Code default | `demo_v4` |
|---|---|---|
| `env.rewards.progress.weight` | 1.0 | 50 |
| `env.rewards.penalty.weight` | −1.0 | −50 |
| `env.rewards.success.weight` | 1.0 | 50 |
| `agent.algorithm.entropy_coef` | 0.006 | 0.001 |
| `env.actions.gripper_action.deadband` | off | 0.5 |
| `env.events.reset_scene.params.held_grace_steps` | off | 10 (from `demo_v3`) |
| `env.events.reset_scene.params.curriculum_steps` | 24000 | 48000 (from `demo_v3`) |
| `agent.actor.distribution_cfg.init_std` | 1.0 | 0.6 (from `demo_v3`) |

I checked the reward weights against `sim_worker/rl_env_cfg.py`: the defaults are 1, −1 and 1, so the change is a scale
only. `action_rate` (−1e-3) and `joint_vel` (−1e-4) are not overridden.

`ce5762c` also fixes T6's adapter so it can read Isaac Lab's `env.yaml`: `yaml.safe_load` failed on `!!python/tuple`,
which matters for reading the deadband. That is a run-enabling fix. T3 will make these values a named preset in code
after the gate, if `demo_v4` is the teacher.

**`demo_v4` failed:** started at 11:05:57, when it took `gpu.lock` (T3's report says 11:05:56). The lead stopped it at
about 11:27, with the user's permission. T3's `ce5762c` (11:12) recorded its command after the start. It converged too
early:
- the action std fell from 0.6 to 0.05;
- `check_success` fell from 0.34 to 0.19;
- the gripper was left open.

The 0.5 deadband froze the gripper's exploration once the std was low. No rollout or student used it, and it was never
gated.

**`demo_v5`** changes RL training settings only. There is no reward change beyond Amendment 1. Relative to `demo_v4`:
- `entropy_coef` 0.001 → 0.005;
- a new `std_range` of [0.3, 1.0];
- deadband 0.5 → 0.25;
- curriculum 48000 → 24000 steps;
- the demo starts are about a 50/50 mix of uniform demo-progress starts and the late-to-early curriculum.

It keeps the ×50 reward scale, a grace of 10 and an initial std of 0.6. The unchanged list under Amendment 1 still
holds. T3 will send the commit and the exact command, and they are added here.

`demo_v5`'s mixed starts are `uniform_share` = 0.5, from T3's `7e12dde` (11:28, off by default). `cb7ce10` (11:28)
is T3's note on `demo_v4`'s collapse and `demo_v5`'s settings.

**`demo_v5` failed:** started at 11:28:08 (`gpu.lock`) and stopped at about 11:40 by the lead, under the plan the user
approved. Exploration stayed alive (std 0.86), but grasp and lift stayed flat at about 1%, and `check_success` was 0.06
at iteration 300. No rollout or student used it, and it was never gated.

## Amendment 2 (2026-10-21, directed by the user, decided before any teacher passed the gate)

It changes only the teacher's training reward, and replaces Amendment 1's ×50 scale.

**The new reward:** `demo_v6` trains with the reward preset `--reward lift` on the task
`SANT-PickPlace-Franka-RL-Lift-v0`, from `d9cf2a7` (11:45) on `pm/rl-teacher`. The preset is off by default, and
the task registered in `sim_worker/rl_register.py`. It is modelled on Isaac Lab's stock lift reward, plus SANT's
terms. Weights are as the lead sent them.
- **Stock Isaac Lab lift terms:**
  - reach: tanh, std 0.1, weight 1;
  - lifted: 0.04 m, weight 15, counted only while the cube is held;
  - goal tracking: std 0.3 at weight 16, plus fine tracking std 0.05 at weight 5, with the goal over the bin centre;
  - `action_rate` and `joint_vel`: −1e-4, rising to −0.1 by curriculum.
- **SANT terms:**
  - placed: weight 38;
  - fouls: contact above 5 N (5), a drop (50) and a high release (50). Each foul forfeits the bonus;
  - a one-time bonus of 400 + 42.9 × the steps left, paid when `check_success`'s conditions are met.
- **No ×50 scale.**

**Calibration** (T3, on 196 recorded episodes):
- the bonus agrees with `check_success` on 196/196;
- the lowest return of a verified episode (11,516) is above the highest of a failed one (7,412);
- in 170/170 cases, hovering for a full episode earns less than succeeding.

**Kept from `demo_v5`:**
- grace 10;
- curriculum 24000;
- `uniform_share` 0.5;
- initial std 0.6 and `std_range` [0.3, 1.0];
- entropy 0.005;
- deadband 0.25.

**Unchanged:** the same list as Amendment 1:
- the success definition and `check_success`;
- the gate;
- the seeds;
- the selection rule;
- the data mix's weights;
- the test command.

Only the training signal changes. The gate and the test still measure `check_success` alone.

**Open item:** in `demo_v5`'s training, the monitor showed the bonus agreeing with `check_success` on only 0.85–0.91
of episodes, against 196/196 on the recorded ones. T3 is investigating. Its explanation, and any fix, is added here
before `demo_v6`'s teacher is gated. A fix to the bonus would be logged as a run-enabling fix if it only makes the
bonus match `check_success`.

**`demo_v6` started** at 11:47:06, when it took `gpu.lock` (wrapper pid 25664). Its command, as the lead gave it:
`--run-name demo_v6 --reward lift --max-iterations 1500`, plus `demo_v5`'s overrides, including `uniform_share` 0.5.
T3's `command.txt` is added here when T3 sends it. T3's own report gives the start as 11:47:05, with trainer pid 34700.

**The open item, explained: `bf56c20`** (T3, 11:50, on `pm/rl-teacher`). This is a run-enabling fix, with no rule
change.
- **The cause:** the env's bonus and success termination measured the cube's speed from the physics body velocity.
  That drops below 0.01 m/s one step before `check_success`'s speed, which comes from position change. So the bonus
  fired at 0.48 s of the 0.5 s settle, the episode was cut there, and `check_success` failed it as `not_settled`. That
  explains `demo_v5`'s agreement of 0.85–0.91. The error went one way: the bonus was paid and the check failed.
- **The fix:** the env measures speed from position change, as `check_success` does. The first step counts as moving.
  The bonus now only fires when `check_success` would pass, which is the rule set under Amendment 2.
- **`demo_v6` runs on the old code** (`d9cf2a7`; it started before `bf56c20`). So its `Metrics/check_success`
  undercounts, and `Episode_Termination/success` is read beside it. Its reward can still pay the bonus about one step
  early on a few episodes. The gate is unaffected, because it runs `check_success` itself.

**Decision A (the lead): run-enabling, no rule change.**
- **What it does:** in the eval/Play env only, success termination comes at `SETTLE_S` + 0.2 s, so the gate's replay
  is not cut at the exact edge of the settle.
- **What stays the same:** training and the reward; `check_success` and its thresholds; the gate's ≥ 90%.
- **What changes for the gate:** only where an eval episode stops.

**It is `2333c96`** (T3, 11:55, on `pm/rl-teacher`; it changes `sim_worker/rl_env_cfg.py` and its tests only).
- `done_success(extra_s)` defaults to 0, for training and the Lift task.
- The Play env sets `PLAY_SUCCESS_EXTRA_S` = 0.2 s (10 extra steps). `rl_eval_teacher` uses it, so the gate gets it.
- In the test fixture, the bonus fires at step 391, the Play episode ends at 401, and `check_success` passes on the
  402-step record.
- T6's round-0 rollouts don't depend on it: they score `check_success` on their own env every 25 steps.

**`e85b97f`** (T3, 12:02, on `pm/rl-teacher`): a run-enabling fix to the gate's eval, plus diagnostics.
- **The bug:** the monitor's `log()` empties its results every step, so `rl_eval_teacher`'s in-env verdicts held only
  the last step's episodes. The gate would have scored only those.
- **The fix:** the monitor keeps a history (`keep_history`), and the eval reads it.
- **The deadband:** `rl_eval_teacher` now applies the run's gripper deadband (0.25 for `demo_v6`, read from its
  `env.yaml`) in the Play env, whose default is none. T6's adapter already did, so the gate and the distillation
  run the teacher the same way.
- **Diagnostics only:**
  - `scripts/rl_start_breakdown.py`: success, bonus, ever-grasped and ever-lifted for each start type;
  - `rl_train.py --stock-task`: an unchanged Isaac Lab lift task, as a sanity run;
  - the monitor records each episode's start row and whether it ever grasped or lifted.

  None of these changes the reward or the training env.

**`demo_v6` continues to 1500 iterations** (the lead's decision): Isaac Lab's stock Franka lift config trains for 1500,
so judging it at 300 was too early. Its command already set `--max-iterations 1500`.

**`56a3156`** (T3, 12:13, on `pm/rl-teacher`): a BC-initialised teacher, built and not yet run on Isaac. It changes
only how the teacher is initialised: the reward, the success definition, the gate, the seeds, the selection rule and
the test are unchanged.
- **The data** (`src/demo_pipeline/rl_bc.py`): 31,536 (observation, action) pairs from the 110 SANT-verified
  `mouse20261020` training episodes, in the replay convention. These are the same episodes as the arm's demo-start
  bank.
- **The pre-training** (`scripts/rl_bc_pretrain.py`):
  - it fits the PPO actor's mean by MSE;
  - the held-out validation MSE is 1e-4 to 3e-4, against 0.015 to 0.09 for a zero action;
  - the gripper's sign is right on 99.2% of steps.
- **The obs-match check** (`scripts/rl_bc_check.py`): it checks that the BC observations match what the env produces.
- **`rl_train.py --fresh-optimizer`:** PPO starts from the BC weights with a new optimizer.
- **The planned `bc_v1` settings, if it is run:**
  - initial std about 0.12;
  - `std_range` [0.05, 1.0];
  - the `lift` reward (Amendment 2).

  Its exact command and start time are added here if it runs.
- **A finding, recorded:** a demo's steps are 2–4 mm, while the exploration noise is 6–17 mm per step. So noise at the
  earlier std swamped demo-like motion, which is why the planned initial std is low.

**`demo_v6` finished** its 1500 iterations at about 12:59 (66 min).

**The checkpoint was picked before the gate**, from T3's start-type breakdown (`scripts/rl_start_breakdown.py`) only.
- **The scenes:** 128 episodes per checkpoint, with scenes from `rng(7)`. None of them overlaps the gate's seeds
  5300–5349.
- **The settings:** deterministic actions, deadband 0.25, grace 10, and the fixed bonus code (`bf56c20`). The bonus
  agreed with the in-env `check_success` on 128/128.

| Checkpoint | Home starts | Demo starts, free | Demo starts, held | Failures |
|---|---|---|---|---|
| `model_1499` | **61/67** (Wilson 0.82–0.96) | 30/31 | 30/30 | 7 drops |
| `model_1450` | 58/67 | — | — | 7 collisions |

**The pick is `model_1499`:** it has more home-start successes and no collisions. These numbers are not the gate.

**A deviation from the wording above, logged openly.** Gate step 2 said the checkpoint "may be chosen … on those
practice seeds only". It was chosen on other scenes (`rng(7)`), and the practice seeds 5300–5349 were not used. That
is stricter than written: the gate's 50 seeds are fresh for the picked checkpoint, so the gate is not biased by the
choice. Seeds 5020–5059 were not used for the teacher.

**The gate runs once on `model_1499`.** T3's part, check (a) above, is `rl_eval_teacher` on practice seeds 5300–5349 plus
`rl_verify_teacher`, and it passes at ≥ 45/50. Both checks must pass, so T6's 50-scene in-env gate on seeds
4000–4049 (≥ 45/50) still applies before round 0. The results are added here.

### Gate attempt 1: FAILED (`model_1499`, `demo_v6`)

On practice seeds 5300–5349 (T3's note `df9dce6` on `pm/rl-teacher`):
- **The replay verify (the gate number): 3/50** (Wilson 0.02–0.16). It needed ≥ 45/50.
  - On the first 30 seeds it was 3/30 (seeds 5303, 5308, 5313).
  - The replay failures: collision 44, not_in_bin 35, dropped 20, unreachable 6, not_settled 5. An episode can fail
    for more than one reason.
- **In the env, `check_success`: 43/50.** The in-env and replay verdicts agree on only 10 of the 50 seeds.

**T6's part (b) was not run** on this checkpoint, per the lead. T6 never got its `policy.pt`, because the lead holds
the policy until part (a) passes. No distillation may start before both parts pass. Seeds 5300–5349 are now spent for
the gate.

**The cause (T3):** the teacher moves far faster than the human demos.
- **The teacher's tool targets** move at a median 1.73 m/s (p99 3.17, max 3.49).
- **The verified human demos** move at 0.20 m/s (p90 0.48).
- **Why:** the RL action bound was relative to the tool's current position only. So the policy rode the env's
  velocity feed-forward at 2–3 m/s.
- **The replay can't follow that:** SANT's replay tracker has a 2.9 cm median tracking error and overshoots 15 cm on
  seed 5300.

So the teacher succeeds in its own env, but its motions don't survive SANT's replay, and SANT's replay is what makes a
label verified.

## Amendment 3 (2026-10-21, the lead's decision, after gate attempt 1 failed)

**The gate definition is unchanged:** the replay verify stays the gate number, at ≥ 45/50, and both parts are still
required.

**What changes:**
- **A speed cap in the teacher's action space**, in training, eval and `make()`. Each target must be:
  - within 0.5 m/s × 0.02 s (1 cm) of the previous target;
  - within 2.5 rad/s × 0.02 s in yaw of the previous target (T3's addition, approved by the lead);
  - and within one step of the tool's position.

  `make()` is what T6's distillation calls. So the labels come from the same capped teacher that is gated.
- **The run `demo_v6c`** resumes from `model_1499`, with:
  - the cap;
  - the std reset to 0.3 (T3's `d292537`, `rl_checkpoint_std.py`: a resume would otherwise load the checkpoint's std);
  - `std_range` [0.1, 0.5];
  - both curricula held.
- **Gate attempt 2 runs on fresh practice seeds 5350–5399**, because 5300–5349 are spent. They overlap no other range:
  - teacher rollouts 4000–4599;
  - DAgger 5200–5279;
  - selection 5300–5329;
  - test 5020–5059.

  T6's part (b) on 4000–4049 is still required.

**Unchanged:**
- the reward (Amendment 2's `lift`);
- the success definition and `check_success`;
- the gate's threshold and both parts;
- the selection rule, the mix weights and the test command;
- the student's selection seeds 5300–5329, although they were also used in gate attempt 1. That overlap was in this
  pre-registration from the start, and the teacher never trained on them.

**The cap is `f5b6646`** (T3, 13:29, on `pm/rl-teacher`), in `rl_teacher.cap_speed`. Each new target:
- moves at most 0.5 m/s × 0.02 s (1 cm) from the previous target;
- turns at most **2.5 rad/s × 0.02 s in yaw** from the previous target. This yaw-rate cap is T3's addition, which the
  lead approved under this amendment;
- stays within one step of the tool.

**Where it applies:** in training (the env's action term, on by default for new runs), in Play/eval, and in `make()`
for T6's rollouts. `make()` reads the cap from the run's `params/env.yaml`, as it does the deadband. Runs before
`demo_v6c` have no cap in their `env.yaml` and stay uncapped.

**Why the yaw cap too:** `demo_v6` turned at a median 3.3 rad/s (p99 10.4), against the human demos' 0.01 rad/s (p99
3.8).

**`demo_v6c` started** at 13:29:22 (pid 1356). It resumes from `model_1499` for 600 more iterations, with:
- the cap;
- the std reset to 0.3;
- `std_range` [0.1, 0.5];
- both curricula held where `demo_v6` ended.

**T3's plan:**
- check-ins at +300 and +600 iterations;
- then the start-type breakdown, plus a replay check on non-gate episodes, to pick a checkpoint before the gate;
- then gate attempt 2 on 5350–5399.

**`demo_v6c` was a failed launch.** It died before iteration 1 with NaN observations.
- **The cause:** the cap's `_prev_valid` buffer shadowed the tracking IK's own feed-forward flag, which gave NaN
  joints on step 0.
  The result was a zero-quaternion feed-forward.
- **The fix:** **`b7935c0`** (T3, 13:38, on `pm/rl-teacher`) renames the buffers `_cap_prev_*` and adds a test against
  shadowing. It is a run-enabling bug fix to `f5b6646` that changes no setting.
- **The Isaac check:** 64 envs × 60 steps, with no NaN and every commanded step ≤ 1.00 cm.
- **`demo_v6c`'s logs are kept** as a failed launch. No checkpoint came from it.

**`demo_v6c2` is the speed-capped run.** It started at 13:39:01 (pid 30480) with the identical command, on code with
`b7935c0`.
The plan above applies to it.

**`demo_v6c2` finished** all 600 iterations in 1903 s. It resumed from `model_1499`, so its iterations are numbered
1500–2098. T3's session ended at about 14:14, so the lead ran T3's committed scripts from `C:\dev\pm-t3`, at
`b7935c0`, for everything below.

**Checkpoint picked before gate 2: `model_2098`**, the only checkpoint tested. No gate seed was used to pick it.
- **The start-type breakdown** (128 episodes, `rng(7)`, deterministic):
  - from home: 66/67 (Wilson 0.92–1.00);
  - demo-free: 31/31;
  - demo-held: 30/30.
- **The replayability check on non-gate seeds 7000–7031:**
  - in the env: 32/32;
  - SANT's replay verify: 32/32 (Wilson 0.89–1.00).
  - Outputs: `data\rl\eval\v6c2_replaycheck_7000` (`in_env.json`: 32 successes; `verify.json`: 32 of 32 agree with
    the in-env verdict).

**Gate attempt 2 was launched once**, on `model_2098`, seeds 5350–5399, with `rl_eval_teacher` + `rl_verify_teacher`
(part (a)). Outputs: `data\rl\eval\v6c2_gate2`.

**Gate attempt 2, part (a): PASSED.** It ran once, on `demo_v6c2` `model_2098`, seeds 5350–5399:
- **In the env, `check_success`:** 50/50.
- **SANT's replay verify (the gate number):** 50/50 (Wilson 95% 0.93–1.00). The threshold is ≥ 45/50.
- **Checked here:** `v6c2_gate2` holds 50 scenes, 5350–5399. `in_env.json` has 50/50 on `model_2098`, and
  `verify.json` has a replay summary of 50/50, with all 50 agreeing with the in-env verdict.

**T3's final code for the teacher: `b7935c0`** on `pm/rl-teacher`. It is merged into `pm/distill-dagger` as
`2168db0`, local only, which the lead approved.
- **The teacher export:** `data\rl\logs\rsl_rl\sant_rl_teacher\2026-10-21_13-39-10_demo_v6c2\exported\policy.pt`
  (in `C:\dev\pm-t3`, written 14:35).

**Part (b) is still required** before any distillation: T6's in-env gate on 4000–4049, at ≥ 45/50. T6 runs the smoke
test first, then part (b). Round 0 at 300 teacher runs starts only after that, on the lead's go.

**T6's smoke test PASSED** (code `2168db0`, 14:39:14 → 15:07:45):
- 4/4 teacher rollouts passed `check_success` in the camera env.
- The speed cap binds in Isaac: every target step is ≤ 1.00 cm.
- `label_last` and `label_first` differ by ≤ 0.007 rad.
- The replay pairing (`351e737`'s row convention) is confirmed.
- A student trained for 200 steps scored 0/2 on 5300–5301, which shows the path runs end to end.
  - This smoke student is not a candidate, and nothing is chosen from it. It is logged because 5300–5301 are
    selection seeds. The lead ruled it a disclosed note, not a deviation.

**Gate attempt 2, part (b) started** at 15:08:04 (PID 55104), on 4000–4049 (≥ 45/50).

**The round-0 mix.** With no DAgger source in round 0, the code renormalises the pre-registered weights, human
0.25 and teacher 0.5, to 1/3 : 2/3. That is the rule above ("DAgger 0.25, absent in round 0"), now written down.

**A run-enabling fix, approved by the lead: fractional repeats.**
- **What:** each source is repeated a whole number of times, plus an evenly spaced, deterministic subset of its
  episodes.
- **Why:** with whole-number repeats only, the realised human share swings between 26% and 41%. With fractional
  repeats it lands within about 0.5 points of 1/3 : 2/3.
- **Unchanged:** the weights themselves. The fix makes the pre-registered shares come out as written.
- **The commit is `1d0aaf8`** (T6, 15:22, on `pm/distill-dagger`), with tests. On the real data the shares come out
  as human 0.3332 and teacher 0.6668.

**Round 0's estimate:** about 3.5 h (3–4.3 h). The export was measured at 27.9 s per 1,000 frames.

**Gate attempt 2, part (b): PASSED, 49/50** on 4000–4049 (Wilson 95% 0.90–1.00). The threshold is ≥ 45/50.
- **The one failure:** seed 4022, which hit the time limit.
- **The run:** 14.1 min (15:08:04 → 15:22:12), on code `2168db0`, with a clean tree.
- **Checked here:** `data\distill\distill_mouse\r0\rollouts_done.json` (in `C:\dev\pm-t6`) has 49 successes in
  50 attempts on seeds 4000–4049, ended by success 49 and time limit 1. It records the teacher as `demo_v6c2`'s
  exported `policy.pt`, β 0, and the code as `2168db0` on `pm/distill-dagger`, with `dirty: false`. There are 49
  episodes, with 6,676 frames.
- These 49 episodes are round 0's first teacher episodes, as the gate's design intends: part (b) is round 0's own
  rollout step, stopped after 50 runs.

**The teacher gate is passed:** part (a) was 50/50 in replay on 5350–5399, and part (b) 49/50 in the env on
4000–4049.

**Export speed-ups were declined.** The export stays serial, because writing the images in parallel changed the bytes
of `meta/stats.json`.

**Round 0 with `--teacher-n 300` was launched** at 15:27:53 on the lead's go. It **started at 15:33:01 (PID 34584)**,
on seeds 4000–4299, with the cameras on. The revised estimate is 2.7–3.9 h. T6's notes for the smoke, part (b) and the
timings are `da19c2a` (15:27).

**A deviation, logged openly (T3): round 0's start was delayed by about 5 minutes.**
- **What happened:** after the gate, a job of T3's ran start-type breakdowns as a check only. It held `gpu.lock`
  15:26–15:29, so round 0 waited for the lock.
- **Round 0's log** (`distill_round.log`, in `C:\dev\pm-t6`) shows:
  - 15:27:53, the lock held by `rl-breakdown:v6c2_2098` (taken 15:26:38);
  - then `rl-breakdown:v6c2_2000` (taken 15:28:00), whose process had exited by the 5-minute re-check;
  - the lock taken at 15:33:01.
- **The result, per T3:** `model_2000`'s breakdown is identical to `model_2098`'s (66/67, 31/31, 30/30).
- **The timeline, per T3** (T3's note first said `model_2000` was "re-run"; T3 corrected that in `1b94bce`):
  - 14:31:35: the lead ran `model_2098`'s breakdown. Its log, `data\rl\breakdown_v6c2_2098.lead.log` (in
    `C:\dev\pm-t3`), took the lock at 14:31:35. **This was the only checkpoint tested before gate 2.**
  - 14:31: T3's own job queued breakdowns of `model_2098` and then `model_2000`, and waited for the lock.
  - 14:35: gate 2.
  - 15:26:38: T3's job ran `model_2098` again. Its table is identical to the lead's run, and it overwrote
    `breakdown\v6c2_2098\breakdown.json` with the same numbers.
  - 15:28:00: T3's job ran `model_2000`. That was the first and only look at it: after the gate, on `rng(7)` scenes
    only.
- **What it changes:** nothing in the pick or the gate. Both were done before it, and the teacher stays `demo_v6c2`
  `model_2098`. It used `rng(7)` scenes only, no gate, selection or test seeds.

**T3's gate-2 record is `1697c32`** (15:33, on `pm/rl-teacher`), corrected in **`1b94bce`**. Both are docs only:
together they add one note, `2026-10-21-rl-teacher-gate.md`, and leave the code unchanged. So **T3's final code is
still `b7935c0`**. The note matches this log, and adds that the first 30 gate seeds were 30/30 (Wilson 0.89–1.00).

**T3's named presets, `f8a3633`** (15:56, on `pm/rl-teacher`, asked for by the lead after the gate). This is for
reproducibility only.
- **What:** `scripts/rl_train.py --preset teacher_v6` and `--preset teacher_v6c2`. They are the gated teacher's logged
  commands, word for word:
  - `teacher_v6` is stage 1, with the cap explicitly off, as `demo_v6` trained;
  - `teacher_v6c2` is stage 2: the std-0.3 copy (bit-identical to the file `demo_v6c2` resumed from), then the
    resume with the caps on.
  - A test checks both presets against `demo_v6.log` and `demo_v6c2.log`, word for word.
- **What it touches:** I checked that `b7935c0..f8a3633` changes only `scripts/rl_train.py`, two test files and T3's
  gate note. The env, the action, the policy adapter and the eval code are unchanged.
- **What it changes:** nothing in the runs. Nothing was trained or evaluated with it, and the gate results and the
  teacher (`demo_v6c2` `model_2098`) are unaffected.
- **Tests (T3):** SANT 2607 passed; the Isaac venv's RL tests 71 passed, 1 skipped.
- **The teacher's code is still `b7935c0`.** `pm/rl-teacher`'s tip is now `f8a3633`, which is what merges into
  `pm/live-13` after the final test.

**Round 0's rollouts are done: 295/300 passed `check_success` (98.3%)** on 4000–4299. They took 62.1 min (15:33:01 →
16:35:10) and gave 40,830 teacher frames.
- **The 5 failures** all hit the time limit: seeds 4022, 4159, 4174, 4240 and 4279. 4022 is part (b)'s failure.
- **Only the 295 passing rollouts** become episodes.

**The grid** (16:35:11, `distill_mouse_r0_t300`, cell `distill_r0`):

| Source | Episodes | Frames | Repeat | Copies | Target share | Realised share |
|---|---|---|---|---|---|---|
| human (`mouse20261020`, `perfected_multiply_10`) | 110 | 31,536 | ×1.0 | 110 | 0.3333 | 0.3333 |
| teacher (`demo_v6c2` `model_2098`) | 295 | 40,830 | ×1.5447 | 456 | 0.6667 | 0.6667 |

- **`data_check` is clean.** The human seeds are 0–4009 and the teacher seeds 4000–4299. Nothing comes from `data\rl`,
  or from the selection (5300–5329) or test (5020–5059) seeds.
  - Both training sources include scenes 4000–4009. That is overlap between two training sources only, not with
    selection or test, so it breaks no rule. It is noted here for completeness.
- **The code** is `da19c2a` on `pm/distill-dagger`, with a clean tree. It includes the mix fix `1d0aaf8`.
- **Checked here,** in `C:\dev\pm-t6\data\distill\distill_mouse\r0`: `rollouts_done.json` (300 attempted, 295
  successes, ended by success 295 and time limit 5, 40,830 frames, `da19c2a`, `dirty: false`), and `round_t300.json`
  (the mix and `data_check` as above). `distill_round.log` has the grid at 16:35:11 and training starting then.

**Training started at 16:35:11:** ACT, 60,000 steps, after an export of about 94.6k frames.
- **The lead's estimate:** training ends about 18:05–18:20, and selection on 5300–5329 runs about 18:30–19:30.
- **The rule from here:** if the selected checkpoint is below 60% on 5300–5329 (< 18/30), round 0 extends to 600
  teacher runs, then retrains and reselects.

**Round 0's export took 71 min** (45 s per 1,000 frames), against the 27.9 s measured earlier. Windows was throttling
the processes in the background.

**A speed-only intervention, logged openly (the lead's, approved by the user): Windows' power throttling was turned
off for the running trainer.**
- **What:** the per-process power-throttling opt-out (EcoQoS): `SetProcessInformation` with `ProcessPowerThrottling`,
  `ControlMask` 5 and `StateMask` 0. That is the same call as `sim_worker.teleop_qos.high_qos`.
- **How:** the lead applied it from outside to round 0's running trainer processes. There was no restart, and no code
  or setting changed.
- **Effect:** training went from 11.6 to about 20.9 steps/s.
- **What it changes:** speed only. The data, the mix, the flags, the steps and the seeds are unchanged.

**Round 0 at 300: selection FAILED, 0/30 for both candidates** on 5300–5329. Selection ended at 20:23:13; round 0 took
4 h 50 min in all, on code `da19c2a`.

| Checkpoint | Selection seeds 5300–5329 | Collisions | Drops |
|---|---|---|---|
| 40k | 0/30 | 21 | 16 |
| 60k | 0/30 | 16 | 11 |

- **Every episode** ended on the time limit with the cube not in the bin (per the lead). An episode can count under
  more than one failure kind.
- **The pick is 60k,** since the tie goes to the later step.
- **Checked here:** `selection_t300.json` and `selection.json` (in `C:\dev\pm-t6\data\distill\distill_mouse\r0`)
  have counts 40000: 0/30 and 60000: 0/30, the chosen step 60000, seeds 5300–5329, no inference arguments, and code
  `da19c2a` with `dirty: false`. The failure kinds are from the lead's message.
- **Against the rule:** 0/30 is below 18/30, so the pre-registered next step is round 0 at 600 teacher runs.

**A lead decision, logged openly (not yet an amendment): round 0 at 600 is HELD pending a diagnosis.**
- **Why:** a teacher at 98% with a student at 0% points to a systematic mismatch between them, not to too little data.
- **The diagnostics:** practice seeds 5200–5209 only. They never use 5300–5329 or 5020–5059:
  - the open-loop fit on the training data;
  - a `--trace` on the training scenes 4000 and 4001, and on 5300 (see the open item below);
  - three inference modes: plain, `n_action_steps` 10, and a temporal ensemble at 0.01.
- **Finding so far:** the teacher's labels move about 5× faster per step than the human demos'.
- **Any change of plan** comes as Amendment 4, with its reason. Until then, the pre-registered rule stands, and only
  its next step is held.
- **Resolved: 5300 in the trace list was not deliberate (the lead).** 5300 is a selection seed, and the diagnostics
  use none. The lead's instruction to T6:
  - **If the trace has not run,** swap 5300 for practice seed 5200.
  - **If it already ran on 5300,** T6 discloses that to the lead and to this log, and limits inspection to the
    outcome line.
  - **Any later reselection on 5300–5329** either excludes 5300 or notes it.
  - **Which case applied: it had already run (T6's disclosure).** It was a diagnostic, not a selection. The same
    60k checkpoint was evaluated once more on **selection seed 5300**, with `--trace` and frames, at 20:27:52–20:29:15,
    on code `da19c2a`.
    - **Outcome:** 0/1 (not in the bin; collision). That outcome line is all that was looked at.
    - **T6 has not opened its trace or frames.** They are being moved aside unread.
    - **So any later reselection on 5300–5329 excludes 5300 or notes this.**
  - **The other diagnostics** (T6) used the 60k checkpoint on:
    - the training scenes 4000 and 4001, closed loop;
    - practice seeds 5200–5209, in the three inference modes. These seeds are also in DAgger round 1's range
      (5200–5239).
  - **No test seed (5020–5059) has been touched.**

**The diagnosis: root cause found (the lead).** It used practice and training seeds only, with the 60k checkpoint
from round 0 at 300.
- **The open-loop fit on the training data shows no bug.**
  - The chunk MAE is 0.022 on the human data and 0.030 on the teacher data, against 0.108 and 0.216 for holding
    still.
  - The gripper is right 97–99% of the time.
- **Closed loop on the training scenes 4000 and 4001: 0/2.**
  - The student's commands match the teacher's labels to within 0.035 rad.
  - But the actual joints lag about 8× more: |command − joints| is 0.10–0.11, against 0.010–0.018 for the teacher.
  - The gripper closes on time, but 8–10 cm from the cube.
- **Inference modes on 5200–5209 don't help:** plain 0/10, `n_action_steps` 10 0/10, temporal ensemble 0.01 0/10.
- **The proof: the teacher's own recorded labels for 4000–4009, replayed open loop.**
  - With the rollout's tracking execution (IK at both substeps, plus the feed-forward): 10/10.
  - With the student's execution in the eval (a held 9-joint target, zero velocity): 0/10. The tool ends 5–7 cm off,
    and the cube is never lifted.
- **Conclusion:** round 0's labels could not be executed by the student's actuator.
  - That actuator is the Franka's high-gain PD, K = 400 and D = 80.
  - With a held target and a 2 cm lead, it caps the arm at about 0.17 m/s.
  - The teacher's motions only work with the tracking execution it was rolled out with.

**The lead's plan (Amendment 4 is written when the fix is chosen; this is not yet an amendment):**
- **Unchanged:** the test env and the test command.
- **The teacher is executed, and trained, with the student's actuator:** T3's `held_target` term (A′) and T6's rollout
  option A, with one shared arithmetic.
- **Then a NEW gate on fresh seeds:**
  - part (a) on 5400–5449;
  - part (b) on fresh camera-env seeds.
- **Then a new round 0.**
- **Round 0 at 600 under the old execution is abandoned** as uninformative: more labels the student cannot execute
  would not test the plan.
- **The seed ranges in this plan were superseded** before any data existed. Amendment 4, below, has the final ones;
  for example, gate (a) moved from 5400–5449 to 5450–5499.

5300–5349 are never re-used. T3's `ba9e664` is the note logging the BC-initialised teacher (`56a3156`, above) as a
run-enabling initialisation change; it has not been used.

**T6's guard, `da4a6cc`** (13:18, on `pm/distill-dagger`): the grid refuses any training episode from `data\rl`, or
on a selection or test seed. It checks each episode's `scene.json` and records the result as `data_check`. This is a
run-enabling safeguard. It makes the existing rule enforceable in code, and changes no rule.

The gate and everything after it apply to the teacher from `demo_v6`, or from a later run logged here. **T3's final
commit, after the gate: `b7935c0`** on `pm/rl-teacher` (in `pm/distill-dagger` as `2168db0`). The teacher is
`demo_v6c2` `model_2098`.

## Amendment 4 (2026-10-21, the lead's decision, before any held-execution teacher data exists)

**Reason:** the diagnosis proved that round 0's labels could not be executed by the student's actuator: the teacher's
own labels replayed 10/10 with the tracking execution and 0/10 with the student's. The fixed test env is unchanged. It
executes the student with a held 9-joint target at zero velocity, and the teacher now has to work under that same
execution.

**Round 0 at 300 under the old execution stays reported as a failed attempt**, with its 0/30 and the diagnosis above.
Round 0 at 600 under the old execution is not run.

### A. The teacher

- **Executed with the student's actuator** in training, in the gate and in the rollouts. This is T3's `held_target`
  term, which is the same as T6's rollout option A: one shared arithmetic, with a parity test between the two.
- **The candidate:**
  - **`model_2098` zero-shot** under the held execution, if its start-type breakdown (`rng(7)` scenes, 128 episodes)
    shows **≥ 90% success from home starts**;
  - **otherwise `demo_v6h`**, fine-tuned from `model_2098` for at most 600 iterations and judged at +300 and +600.
- **The pick rule, BEFORE the gate, on the breakdown only:** the highest home-start success; ties go to fewer
  collisions, then to the later iteration.
- **Unchanged:** the speed cap 0.5 m/s, `DELTA_M` 2 cm and `EPISODE_S` 12. Any change to these is a new amendment.
- **The final teacher hash** is recorded after the gate. `b7935c0` above stays the record for gate 2's teacher.

### B. The gate (both parts required, each run once)

- **(a)** `rl_eval_teacher` + `rl_verify_teacher` on **5450–5499**, ≥ 45/50.
  - 5400–5439 stays reserved for the confirmatory eval, as other notes plan it: the SANT v2 mouse prereg, the stage-0
    inference prereg and the research notes pool it with 5020–5059 for n = 80. So the gate does not use it.
- **(b)** Camera-env teacher rollouts on **4950–4999**, ≥ 45/50.
  - These 50 episodes are **not round-0 training data**, unlike last time. 4950–4999 is outside the new round 0's
    teacher range (4300–4899), and T6's data check refuses any teacher episode outside the round's own teacher range.

### C. The new round 0

- **Teacher rollouts on fresh seeds 4300–4599** (300), with `--teacher-seed0 4300`. **The extension to 600 is
  4300–4899**, contiguous with the same `--teacher-seed0`.
  - T6's code requires this: teacher seeds must be within `TEACHER_SEEDS` = 4000–4999 (`distill_round.py:49`,
    checked at `:278`), as one contiguous range from `teacher_seed0`. The first draft's extension, 6000–6299, would
    have been refused.
- **The human cell is unchanged:** `mouse20261020` `perfected_multiply_10`, 110 episodes. They are replay-verified
  under the student's execution.
- **The mix:** 1/3 : 2/3 by frame share, with fractional repeats.
- **Training:** ACT, 60k steps, batch 8. The candidates are 40k and 60k, with plain inference flags.

### D. Selection

- **Seeds 5301–5329** (n = 29). 5300 is excluded, because of the disclosed diagnostic run on it above.
- **The bar is ≥ 18/29.**
- **The 300 → 600 rule is unchanged:** below the bar at 300, extend to 600 (4300–4899), retrain and reselect.
- **DAgger round 1 moves to 5210–5249**, with an explicit `--dagger-seed0 5210`, because the code's default for
  round 1 is 5200 (`distill_round.py:259`). 5200–5209 were seen in the diagnosis.
  - Its stop rule is unchanged, applied on those seeds. 5210–5249 is inside `PRACTICE_SEEDS` (5200–5279).
  - There is still no DAgger round 2.

### E. The test (unchanged)

- 5020–5059, run once, on the final model.
- The goal is ≥ 24/40, with Fisher's exact test against 3/40 and 0/40.

### The range check (T7, before writing this amendment)

I scanned `data\` in every worktree (seed-named files, `seed` keys, and `"seeds": [a, b]` ranges) plus the notes and
T6's `sim_eval` code:
- **Clean in data:** 4300–4999, 5450–5549, 6000–6299. In the notes, 4300–4599 appears only as round 0's old,
  unused extension block.
- **Corrected in this amendment, from the first draft:**
  - gate (a), from 5400–5449 (reserved);
  - the round-0 range and its extension, from 4700–4999 + 6000–6299 (refused by the code);
  - gate (b), from 4600–4649 (moved outside the contiguous training range);
  - the explicit DAgger start seed.

**Disclosures, with no change needed:**
- **5210–5219** were evaluated on 2026-10-18 with a different policy (`pm-t3`
  `data\evals\grasp_diag_20261018`, the `raw_multiply_10_30k` traces). They are practice seeds, never training data.
- **Selection seeds 5301–5303** also appear in `pm-t3` `data\rl\eval\check_v2_950`, a teacher check from before gate 1.
  That is in addition to gate 1 (5300–5349), the smoke (5300–5301) and round 0's selection.
- **5250–5279** was the planned selection range of the grasp-fix run 2 (the 2026-10-18 note), which never ran. No data
  exists for it.

### Amendment 4: the log

**T3's held execution is `4a22fcb`** (21:31, on `pm/rl-teacher`, on top of `f8a3633`). It is Amendment 4's teacher
execution, A′.
- **What:** `SantTcpTargetActionCfg.held_target`, off by default. When it is on, the arm is executed as the student's
  is: one IK solve per control step, held for both substeps, with a zero velocity target.
- **Where (checked):** `sim_worker/rl_action.py`, `rl_env_cfg.py` and `rl_policy.py` (`run_held_target`).
  - `scripts/rl_eval_teacher.py` and `rl_start_breakdown.py` read the setting from the run, and the breakdown also
    takes `--override`.
  - `rl_train.py` gets a `--preset teacher_v6h`.
  - There are tests, and T3's gate note records Amendment 4's ranges and pick rule.
- **The default execution is unchanged,** so `b7935c0`'s teacher and `model_2098`'s gate-2 results are unaffected.
- **Tests (T3):**
  - SANT: 2609 passed.
  - The Isaac venv's RL tests: 77 passed, 1 skipped. They include parity with T6's `teacher_ik.ik_target` to 1e-5, which
    is the "one shared arithmetic, parity-tested" the amendment asks for.

**Next: `model_2098`'s zero-shot breakdown under the held execution** (`rng(7)` scenes, 128 episodes), into
`data\rl\breakdown\v6c2_2098_held`. It is queued on `gpu.lock`. If home starts reach ≥ 90%, `model_2098` is the
candidate; otherwise `demo_v6h` is fine-tuned.

**T6's report for Amendment 4** (`pm/distill-dagger`, local and unpushed; full suite: 2675 passed, 34 skipped, 0
failed).
- **Round 0 at 300 and the diagnosis match what is logged above.** T6 adds:
  - **(1) The train-fit figures** all come from one T6 run: the 60k checkpoint, served, on 5 human and 5 teacher
    episodes, a frame every 25 steps. They are columns of one measure, the arm MAE in rad (human / teacher):
    - at chunk step 0: 0.012 / 0.023;
    - over the 100-step chunk: 0.022 / 0.030. These are the lead's figures above.
    - The hold-still baseline, over the same chunk: 0.108 / 0.216.
    - The gripper is right 97–99% of the time. So there is no fit or loading bug.
    - (An earlier wording of this entry, in `d41df19`, called these two people's measures; T6 corrected it.)
  - **(2)–(4)** The images, the proprioception, the start pose and the plain inference flags all match between
    training and eval.
  - **The root cause, in T6's words:** the labels were generated with an execution the student's actuator cannot
    reproduce at 0.5 m/s.
- **`0a1d9c5`** (21:23): every process of a distill round, of selection and of eval opts out of Windows power
  throttling (`full_speed`, in `sim_worker/teleop_qos.py`).
  - It is run-enabling and changes speed only. It makes the lead's external opt-out, logged above, part of the code.
- **`45a5293`** (21:33): **option A, `--teacher-execution held`.**
  - **A teacher step** is one held 9-joint target: one DLS step from the state before the step. It is executed by the
    eval's own student step (`env.step`, zero velocity).
  - **The label** is that target. The replay pairing is unchanged.
  - **Recorded** in `rollouts`, `distill.json` and `round.json`, with one execution per folder.
  - It also adds `--select-seed0`.
  - T3's A′ term (`4a22fcb`) is parity-tested against this same arithmetic.
- **Checked here:** both commits are on `pm/distill-dagger`, on top of `da19c2a`, with the files as described.

**Amendment 4's commands (T6), all with `--teacher-execution held`:**

| Step | Command flags | Seeds | Bar |
|---|---|---|---|
| gate (b) | `--run-id distill_mouse_held_gate --teacher-seed0 4950 --teacher-n 50 --stop-after rollouts` | 4950–4999 | ≥ 45/50 |
| round 0 | `--run-id distill_mouse_held --teacher-seed0 4300 --teacher-n 300 --select-seed0 5301 --select-n 29` | teacher 4300–4599; selection 5301–5329 | ≥ 18/29 |
| extension | the same, with `--teacher-n 600` | teacher 4300–4899 | ≥ 18/29 |
| DAgger r1 | `--dagger-seed0 5210` | 5210–5249 | the stop rule |

- **Gate (b) has its own run id,** so its episodes are never training data. The data check would also refuse them,
  because they fall outside round 0's teacher range.
- **No test seed has been touched.**

**`model_2098` zero-shot under the held execution: home starts below 90%, so the rule selects the `demo_v6h`
fine-tune** (Amendment 4 A, applied as written). The breakdown used `rng(7)` scenes, 128 episodes, deterministic,
`held_target` on.

| Start | Success | Wilson 95% | Failures |
|---|---|---|---|
| home | **46/67** | 0.57–0.79 | dropped 19, collision 1, gripper_closed 1, not_settled 1 |
| demo-free | 29/31 | 0.79–0.98 | dropped 2 |
| demo-held | 24/30 | 0.63–0.91 | collision 6 |

- **Checked here:** `data\rl\breakdown\v6c2_2098_held\breakdown.json` (in `C:\dev\pm-t3`, written 21:32:39). It has
  `model_2098`, n = 128, `held_target: true` (override `env.actions.arm_action.held_target=True`), deadband 0.25, grace
  10, and the counts above.
- **`demo_v6h` started:** it fine-tunes from `model_2098` with `held_target`, for at most 600 iterations, judged at
  +300 and +600.
  - It took `gpu.lock` at 21:33:07 (the lock reads `rl-teacher:demo_v6h`, PID 54376). Its run folder is
    `2026-10-21_21-33-14_demo_v6h`.
- **The pick happens BEFORE gate (a), on the breakdown only:** the highest home-start success, then fewer collisions,
  then the later iteration.
