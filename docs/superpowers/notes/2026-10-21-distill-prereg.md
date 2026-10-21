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

T3 sends the commit, and it is added here.

The gate and everything after it apply to the teacher from `demo_v6`, or from a later run logged here. T3's final
commit is added here after the gate, as the lead will send it.
