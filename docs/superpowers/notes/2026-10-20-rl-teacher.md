# RL teacher: env, reward, demo starts, and tomorrow's GPU commands (2026-10-20, branch `pm/rl-teacher`)

From `pm/live-12` (`2d1e5ad`). **Code only tonight: no GPU, no training, Isaac never started.** Never pushed.

The plan is the research note's (`pm-t8 …/2026-10-20-research-approach.md` §2.3 option 1 and §4), as the user
decided:
- **The RL teacher is the only teacher.** It learns from a reward that mirrors `check_success`, plus demo starts from
  SANT-verified human episodes. There is no hand-written task logic in it and no scripted-expert fallback.
- **The goal is the camera policy (ACT, the student) above 60% (≥ 24/40).** The teacher's rollouts are distilled
  into it.

## What was built

| File | What |
|---|---|
| `src/demo_pipeline/rl_teacher.py` | The reward, the action space and the success signals. Pure, numpy or torch. |
| `src/demo_pipeline/rl_demo_bank.py` | Demo starts: restorable states along verified episodes, the late-to-early curriculum, and the reset plan. Pure. |
| `sim_worker/rl_env_cfg.py` | The Isaac Lab env (manager-based, as `IsaacContrib-Lift-Cube-Franka`): SANT's scene, observations, actions, reward and terminations; the episode monitor (`check_success` per episode); the batched reset. |
| `sim_worker/rl_action.py` | The arm action term: 4 numbers become an absolute tool target, driven by SANT's tracking IK (the Mimic env's term). |
| `sim_worker/rl_ppo_cfg.py`, `sim_worker/rl_register.py` | rsl_rl PPO (the lift's, with a longer horizon) and the gym tasks: `SANT-PickPlace-Franka-RL-v0` (demo starts), `-NoDemo-v0` (control arm), `-Play-v0`. |
| `scripts/rl_demo_bank.py` | Builds the demo-start bank from a store (read-only). |
| `scripts/rl_train.py` | Runs Isaac Lab's own trainer on our task, with the GPU lock, Isaac's gate and KeepAwake. |
| `scripts/rl_eval_teacher.py`, `scripts/rl_verify_teacher.py` | The teacher's eval: (1) play the checkpoint on the eval scenes and save its Trajectories; (2) replay them in SANT's eval env with `check_success`. |

### 1. The env

- **Scene:** `scene_cfg.make_scene_cfg(cameras=False)`, the scene SANT replays and evaluates in. That means the
  high-PD Franka, the 5 cm cube, the five-box bin, the table, the contact sensors and the 50 Hz control (physics
  0.01 s, decimation 2).
- **Envs:** 4,096 by default, 8 m apart (the 2 m grid of the multi-env memory note; harmless without cameras).
- **Episodes:** 12 s (a home start does the task in 6–9 s).
- **Observations** (privileged, exact):
  - joints and their velocities;
  - the tool's pose, the cube's pose, the bin's place and yaw;
  - the cube relative to the tool and in the bin's frame;
  - the last action.
- **Actions, in the student's space:** 5 numbers in [−1, 1].
  - x, y, z: an absolute tool target in the workspace box (x 0.20–0.80, y ±0.45, z 0.01–0.50);
  - the yaw (±90°) of SANT's pointing-down gripper;
  - the gripper (< 0 closes).

  The arm part goes through `SantTrackingIKAction`: Isaac Lab's absolute damped-least-squares IK on the tool centre
  plus SANT's joint-velocity feed-forward (the Mimic env's term, measured 2.1 mm mean tracking error).
- **What a teacher action is:** a SANT Trajectory step (tool target + gripper), as teleop, the repairs and replay
  use. So its rollouts replay, verify and export into ACT data through the existing path, the same way human demos
  do. ACT's own labels (joint targets) come out of that replay as always.
- **Terminations:** success (placed and settled 0.5 s, nothing fouled), the time limit, or the cube off the table.

### 2. The reward, calibrated on 196 recorded episodes

`rl_teacher.reward_terms` mirrors `check_success`'s stages: reach, centred grasp, lifted (4 cm, as Isaac Lab's
lift), carry (coarse and fine, clear of the rim or over the bin), rim clear, held low over the bin (≤ 0.18 m),
placed (in the bin, settled, open). Penalties cover:
- arm–bin/table contact over 5 N (per step);
- dropped outside the bin;
- a high release (opened over the bin above 0.18 m).

The first version paid stage *levels* each step. The calibration over every recorded episode in mouse20261020 and
human10c (170 verified, 26 failed) showed two flaws:
- **Failed episodes outscored verified ones.** Human episodes that placed the cube but brushed the bin (`collision`)
  scored up to 2,669, against a verified minimum of 1,316.
- **The levels could be farmed.** A 500-step episode hovering with the cube over the bin would out-earn the success
  bonus, so the policy would learn never to let go.

**The fix: potential-based shaping, and fouls forfeit the bonus.**
- **Progress:** each step pays the *change* of the potential Φ = Σ w·stage. Hovering earns nothing, and a demo start
  mid-task earns nothing for where it starts.
- **Placed (30) outweighs the whole held stage (~21)**, so letting go in the right place raises Φ.
- **The bonus:** a one-time +400 when the cube has been placed for 0.5 s, unless the episode had a collision, drop
  or high release (check_success fails those, so the reward does too).

Results on the same 196 episodes:
- **verified: 430** each (all 170);
- **failed: at most 28** (the median is −10);
- **the bonus was paid exactly when `check_success` passed: 196 / 196.**

Tests:
- `tests/test_dp_rl_teacher.py` checks this on 3 recorded fixture episodes (verified, placed-but-collided, dropped),
  copied read-only to `tests/data/rl_episodes/`;
- hovering 500 steps earns nothing;
- the hand-made stage cases;
- torch gives the same numbers as numpy.

**Success is never the reward.** The env records every 8th env's episode and runs the unchanged `check_success` on
it when it ends (`Metrics/check_success`). It also logs how often the bonus agreed with it
(`Metrics/bonus_agrees_with_check_success`), and the failure reasons. The teacher's real test is SANT's eval env
(step 2 below).

### 3. Demo starts (DemoStart-style)

The bank comes from `scripts/rl_demo_bank.py --store C:/dev/pm-t6/data/human_exp/mouse20261020/store --out
data/rl/bank_mouse20261020.npz`, built tonight and read-only:
- **110 episodes:** the multiplied cell's 10 `_rules_home` + 100 variants, all verified.
- **5,125 states, every 0.1 s:** 2,688 free and 2,437 held.

Only faithfully restorable states are kept (SANT's episodes record no velocities, so states restore at rest, as
`sim_worker/recovery.py` does):
- **free:** before the close, the cube untouched at its scene pose;
- **held:** closed with the fingers on the cube; the cube's orientation is the scene's turned with the hand since
  the close.

After the release the cube is settling with an unrecorded orientation, so those steps are left out.

**Each reset:**
- **With `demo_prob`** (default 0.5): a bank state at least `floor` into its episode. The floor falls from 0.75 to 0
  over the first 24,000 env steps (1,000 iterations), so starts move from late to early.
- **Otherwise:** home, in a random training-side scene (`sample_scene`).
- **The control arm** `SANT-PickPlace-Franka-RL-NoDemo-v0` (`--no-demos`) never uses a demo.
- **Logged:** `Curriculum/demo_min_progress` and `Curriculum/demo_start_share`.

## Tomorrow's GPU commands (from `C:\dev\pm-t3`, one heavy GPU job at a time)

0. **Before:**
   - Nothing else holds the GPU (`C:\dev\gpu.lock`; the wrapper takes it and waits).
   - The bank exists (`data\rl\bank_mouse20261020.npz`; rebuild with the command in §3).
   - Isaac runs headless; add `--viz` to watch.
1. **Smoke, about 5 min: 64 envs × 20 iterations.**

   ```
   uv run --no-sync python scripts\rl_train.py --smoke --run-name smoke64
   ```

   - **Pass:** it runs to the end and writes `data\rl\logs\rsl_rl\sant_rl_teacher\<time>_smoke64\model_*.pt`.
   - **Logs to read:** `Metrics/check_success`, `Stages/*` and `Curriculum/*` appear.
   - **Measure:** the per-iteration time in `data\rl\smoke64.log`.
   - **Also check** the five first-run items under "Not tested tonight" below.
2. **Throughput at full size, about 3–5 min: 4,096 envs × 10 iterations.** It confirms the 16 GB fit and gives
   seconds per iteration.

   ```
   uv run --no-sync python scripts\rl_train.py --run-name probe4096 --max-iterations 10
   ```

3. **The real run, sized for about 30–60 min:**
   - **Iterations:** 45 min × 60 ÷ (the probe's s/iteration), at most 1,500. At the stock lift's ~0.8–1.5
     s/iteration that is ~1,500; our env is heavier (7 contact sensors, IK every substep), so expect fewer.

   ```
   uv run --no-sync python scripts\rl_train.py --run-name demo_v1 --max-iterations <N>
   ```

   - **Checkpoints:** every 50 iterations, `model_<i>.pt` in the run dir.
   - **Resume:** `--checkpoint <run dir or model_<i>.pt>`.
   - **Watch:** `tensorboard --logdir data\rl\logs\rsl_rl`.
   - **Control arm** (another night): `--run-name nodemo_v1 --no-demos`.
4. **Evaluate the teacher in SANT's eval env** on seeds 5020–5059: check_success, success/40.

   ```
   C:\isaac\env_isaaclab\Scripts\python.exe scripts\rl_eval_teacher.py --checkpoint data\rl\logs\rsl_rl\sant_rl_teacher\<run>\model_<i>.pt --out data\rl\eval\demo_v1_5020
   uv run --no-sync python scripts\rl_verify_teacher.py --runs data\rl\eval\demo_v1_5020
   ```

   - **Step 1** (Isaac Lab's Python; the script puts this checkout's code first itself and checks it): 40 envs, one
     eval scene each, home start, the policy's mean action. It writes the in-env
     `check_success` (`in_env.json`) and, per seed, the teacher's Trajectory and Scene.
   - **Step 2:** replays each Trajectory through the sim worker (the same tracking and `check_success` as every
     demo; its own `DATA_DIR`, under the GPU lock). It writes `verify.json`: successes/40, the Wilson 95% CI, the
     failure reasons, and how many seeds agree with step 1. A gap between the two is the research note's risk 2
     (the RL env vs the eval env).
   - **Selecting a checkpoint:** do it on practice seeds (`--seed0 5300 --n 50`) before reporting 5020–5059, as the
     student's pre-registrations require.

**Gate (Oct 24): the teacher at ≥ 90% in step 2** (practice seeds first, then 5020–5059). If it isn't there, the
fallbacks are RL-side only:
- **Reward shaping:** the weights in `rl_teacher.POTENTIAL` / `PENALTY` / `SUCCESS_BONUS`; read `Stages/*` for the
  stage it stalls at.
- **Curriculum:** `--override env.events.reset_scene.params.curriculum_steps=48000`, or a later
  `curriculum_start=0.9`.
- **Demo-start weighting:** `--override env.events.reset_scene.params.demo_prob=0.8`.
- **More envs or iterations:** resume with `--checkpoint`.
- **BC-initialised RL from SANT data:** not built. It would mean pretraining the actor on the 110 episodes'
  (observation, action) pairs (`rl_teacher.target_to_action` maps their tool targets into the action space), then
  PPO from there.

The Hydra override paths (`env.…`, `agent.…`) follow Isaac Lab's convention; they aren't run yet.

## T6's teacher interface (pm/distill-dagger 9e69a50): done tonight

- **`sim_worker/rl_policy.py`: `make(checkpoint=, device=)`.** It returns an object with `.name`, `reset(scene)` and
  `act(TeacherState) -> TeacherAction` (an absolute tool target, wxyz, and a gripper 0/1).
  - It loads `<run>/exported/policy.pt`, the TorchScript export that `rl_eval_teacher.py` and Isaac Lab's play both
    write.
  - It rebuilds the env's observation from T6's `TeacherState` fields (`rl_teacher.OBS_SPEC`, pinned to the env's
    terms by a test).
  - It applies the same action mapping and the same soft floor as the env.
- **For T6:** `--teacher sim_worker.rl_policy:make --teacher-checkpoint
  data\rl\logs\rsl_rl\sant_rl_teacher\<run>\exported\policy.pt`. The run directory works too.
- **The `TeacherState` mismatch:** T6's module isn't on this branch, so the adapter returns T6's `TeacherAction` when
  `sim_eval.teacher` is importable, and an identical mirror otherwise. The test mirrors T6's `TeacherState` fields.
- **Matched to T6's env:**
  - SANT's home start: `rl_teacher.HOME_JOINTS`, the first frame of all 110 episodes. Before, it was Isaac's default
    pose.
  - Absolute joint observations.
  - The soft floor on the teacher's targets (`clamp_to_soft_floor`, equal to `soft_floor.floor_z` on 300 random
    points).
- **Action space and rate now:** an absolute tool target plus a gripper at 50 Hz, with SANT's high-PD gains.
  - The IK is re-solved at both physics substeps with SANT's feed-forward, where T6's `ik_label` takes one DLS step
    per 20 ms, held.
  - So the teacher's success in T6's env can differ. T6's 50-scene gate and our step 2 agreement count measure it.
  - If they differ, the next step is to switch the env's arm term to one IK step per control step without
    feed-forward.

## Tomorrow's first steps

1. Run the full suite on this branch:
   - `uv run --no-sync pytest -q`;
   - the Isaac-side command in the Tests section, last run 67 passed with the one reset test fixed after.
2. Smoke, then probe, then the real run (the GPU commands above).
3. Eval steps 1 and 2. Step 1 exports `exported/policy.pt` for T6.

## Not tested tonight (needs Isaac; the smoke test is the first check)

Every test ran without Isaac: the configs, the registration, the reward, the monitor and the reset on stand-in
tensors. Unverified until the smoke test:
1. **The arm action term** in a live action manager (4 dims reported, the 7-number pose filled underneath).
2. **The contact sensors** at 4,096 envs, and the throughput and memory.
3. **Held demo starts:** a cube restored in the closed fingers at rest might jump if the restored finger width
   penetrates it. Watch `Curriculum/*`, and `cube_fell` terminations early in training.
4. **Whether the RL env and SANT's eval env agree**, which step 2's agreement count measures.
5. **The Hydra overrides.**

## Tests

| Venv | Command | Result |
|---|---|---|
| SANT | `uv run --no-sync pytest tests/test_dp_rl_teacher.py tests/test_dp_rl_demo_bank.py tests/test_rl_verify_teacher.py tests/test_rl_env.py` | 17 passed, 2 skipped (torch, Isaac Lab) |
| Isaac Lab's Python, CPU, no app | `set PYTHONPATH=.;src` then `C:\isaac\env_isaaclab\Scripts\python.exe -m pytest --noconftest -p no:cacheprovider tests\test_rl_env.py tests\test_dp_rl_teacher.py tests\test_dp_rl_demo_bank.py tests\test_rl_verify_teacher.py tests\test_mimic_env.py tests\test_mimic_tracking.py` | **60 passed** (the Mimic env's tests too: its helpers are shared) |

The `test_rl_env.py` checks:
- the env's monitor reproduces the pure reward exactly;
- its own `check_success` matches SANT's recorded verdict on all 3 fixtures;
- the config loads no USD before Isaac Sim starts (a clean subprocess, as the Mimic test).

The full SANT suite is in the commit message.

## Training day, 2026-10-21

### The runs so far

| Run | What | Result |
|---|---|---|
| smoke64 | 64 envs × 20 iterations | It runs; ~1 s/iteration. Needed utf-8 fixes (`f0beb24`). |
| probe4096 | 4,096 envs × 10 iterations | ~1.2 s/iteration with short early episodes; ~1.5–2.5 s/iteration at full length. |
| demo_v1 | absolute actions | **Failed.** Nothing learned (grasp/lift 0 at 300 iterations): random absolute targets threw the arm across the workspace, so demo starts were lost. 1,500 iterations, 50 min. |
| demo_v2 | relative actions (`827a5fb`) | **Failed.** Lift 0 at 300. Stopped at ~950. |
| probe_held | held starts, gripper closed | **The restore is fine:** 64/64 held at steps 1, 5 and 10; finger widths exact. So the cause is the policy's gripper (std 1, ~50% opens per step). |
| demo_v3 | + grace 10, curriculum 48000, init std 0.6 | **Failed.** Stages flat at 300, and the action std rose 0.6 → 1.2: the entropy bonus outweighed the reward (Isaac scales rewards by dt 0.02). Stopped at ~300. |
| demo_v4 | + **Amendment 1** (reward ×50), entropy 0.001, deadband 0.5 | running |

### demo_v4's exact configuration

Recorded in `2026-10-20-rl-teacher/demo_v4/`:
- `command.txt`: the trainer's command line;
- `env.yaml` and `agent.yaml`: the run's own params dump.

Code `6008c41` plus these Hydra overrides (the code defaults are unchanged):

| Setting | Code default | demo_v4 |
|---|---|---|
| `env.rewards.progress.weight` / `penalty` / `success` | 1 / −1 / 1 | **50 / −50 / 50** (Amendment 1: scale only. On the 3 fixtures the bonus still agrees with `check_success`; returns 430.6 / 28.0 / −10.0) |
| `agent.algorithm.entropy_coef` | 0.006 | **0.001** |
| `agent.actor.distribution_cfg.init_std` | 1.0 | **0.6** |
| `env.actions.gripper_action.deadband` | 0.0 | **0.5** |
| `env.events.reset_scene.params.held_grace_steps` | 0 | **10** |
| `env.events.reset_scene.params.curriculum_steps` | 24000 | **48000** |

If demo_v4 becomes the teacher, these become a named preset in code after the gate, so T5's pipeline recipe reproduces it.

**T6's adapter reads the run's deadband** from `params/env.yaml`. Isaac Lab dumps tuples as `!!python/tuple`, which `yaml.safe_load` refuses, so the adapter uses a safe loader that also reads those (tested on demo_v4's real file).

### demo_v4 → demo_v5

**demo_v4 failed: premature convergence.**
- **Numbers at 300 iterations:** the action std fell 0.6 → 0.05 and `check_success` fell 0.34 → 0.19.
- **Why it collapsed:** with entropy 0.001, the policy settled on the easy late-start win (open over the bin) and stopped exploring grasps.
- **An interaction I introduced:** deadband 0.5 with std 0.05 froze the gripper, since noise could never cross the band.

**demo_v5** (11:28, `7e12dde`) keeps exploration alive and mixes the starts:

| Setting | Value |
|---|---|
| entropy | 0.005 |
| std floor | `std_range=[0.3,1.0]` (rsl_rl clamps the sampling std) |
| deadband | 0.25 (crossable at std ≥ 0.3) |
| curriculum | back to 24,000 |
| start mix | `uniform_share=0.5`: half the demo starts sample the whole episode from iteration 1 (the lead's addition) |
| unchanged | Amendment 1 (×50), grace 10, init std 0.6 |

### If demo_v5 also stalls: BC-initialised RL (a plan, not built)

1. **Data:** the 110 verified episodes the bank comes from. For each step it needs rl_teacher's observation and action.
   - **The observation** is rebuilt from the episode files:
     - joints from `steps.npz`, with velocities by finite difference;
     - the tool pose (`ee_pos`, `ee_quat`) and the cube's position (`signals.npz`);
     - the cube's orientation as the bank computes it (the scene's while free, turned with the hand while held);
     - the bin from `scene.json`, the derived terms, and the previous action.
   - **The action** is `rt.target_to_action` from the reached tool pose to the next commanded target (the demo's
     Trajectory): the step clipped to one action, the gripper ±1 (always past the deadband).
   - About 40k pairs. Steps after the release are kept, because the teacher has to learn to let go and back off.
2. **BC:** fit rsl_rl's actor (MLP [512, 256, 128] with its observation normaliser) to those actions by MSE: about
   50 epochs, minutes on the GPU.
   - Save it as an rsl_rl checkpoint: the actor's weights and normaliser, with a fresh critic.
   - The checkpoint format has to be read from rsl_rl 5.5's `OnPolicyRunner.save`/`load`.
3. **PPO from it:** `rl_train.py --checkpoint <bc.pt>` with `--no-resume_optimizer_state`, init/std floor about 0.2,
   entropy 0.005, the same reward and starts.
   - **Optional:** a BC term to keep it near the demos early (not built into rsl_rl).
   - **Risk:** fine-tuning a Gaussian actor from BC can collapse (DPPO). Watch std and `check_success` at 150/300 as
     today.
4. **Effort:** about 2–3 h of code and tests, then one GPU run. The human demos then seed the policy, not only its
   starts, which is still "learned from the reward with SANT-verified demos" and no hand-written logic.

### demo_v6: the "lift" reward preset (built, not run)

The user's call (via the lead, 2026-10-21): a reward modelled on Isaac Lab's stock Lift-Cube-Franka, built in
parallel with v5, launched only if v5 isn't clearly grasping at its 300 check-in.

**Off by default.** `rl_train.py --reward lift` picks the task `SANT-PickPlace-Franka-RL-Lift-v0`
(`SantPickPlaceRLLiftEnvCfg`: the same env, demo starts and success, other rewards). `--reward potential` (the
default) is unchanged.

**Level rewards, copied from the stock config** (`isaaclab_tasks/contrib/lift/lift_env_cfg.py`):

| Term | Stock line | Ours |
|---|---|---|
| reaching_object, tanh std 0.1, w 1 | 138 | `reach`, the same |
| lifting_object, height 0.04, w 15 | 140 | `lifted`: also needs the cube held (closed + finger contact) |
| object_goal_tracking, std 0.3, w 16 | 142-146 | `goal`: the goal is over the bin's centre, the cube's bottom 2.5 cm over the rim |
| fine-grained, std 0.05, w 5 | 148-152 | `goal_fine`, the same goal |
| action_rate -1e-4, joint_vel -1e-4 | 155, 157-160 | the same |
| curriculum: both to -0.1 over 10,000 steps | 180, 184 | the same |

**Our parts on top:**
- `placed` (w 38): the cube in the bin, released. It pays more than holding at the goal (36).
- **Fouls:** 5 N arm contact (5), a drop (50) and a high release (50). Each forfeits the bonus.
- **The success bonus,** paid once, exactly when check_success's conditions hold (placed for 0.5 s with no foul;
  the episode ends there): 400 + 42.9 × the steps left.
  - 42.9 is 1.1 × the most any step can pay (39).
  - So from any state, placing now beats hovering for the rest of the episode.
- **No ×50.** The level rewards are already the stock lift's magnitudes (at most 0.78 per step after dt), which
  stock trains at entropy 0.006.

**Calibration on the 196 recorded episodes** (rescored without Isaac):
- The bonus agrees with check_success on 196/196.
- Verified episodes score min 11,516 (median 18,381). Failed ones score max 7,412 (median 40).
- Hovering at the best held state for the whole 600 steps scores less than the episode's own success in 170/170
  (smallest margin 1,558).

**Risk:** the bonus is one large step (up to ~480 after dt). The value function has to learn it; watch the value
loss.

**Launch command** (v5's exploration settings and mixed starts, no ×50):

    uv run --no-sync python scripts\rl_train.py --run-name demo_v6 --reward lift --max-iterations 1500 --override env.events.reset_scene.params.held_grace_steps=10 --override env.events.reset_scene.params.curriculum_steps=24000 --override env.events.reset_scene.params.uniform_share=0.5 --override agent.actor.distribution_cfg.init_std=0.6 --override "agent.actor.distribution_cfg.std_range=[0.3,1.0]" --override agent.algorithm.entropy_coef=0.005 --override env.actions.gripper_action.deadband=0.25

**Tests:**
- SANT venv: full suite, 2594 passed, 35 skipped.
- Isaac venv, CPU, no app: 86 passed, 1 skipped.

### The bonus came one step early (found in v5, fixed in bf56c20 and 2333c96)

**The symptom.** v5's `Metrics/bonus_agrees_with_check_success` was 0.91 at iteration 150 and 0.85 at 300.
- The direction was "bonus paid, check_success fails". At 150, check_success was 0.00, so every disagreement was a bonus paid on a failed episode.
- The episodes failed as `not_settled`. `Failures/not_settled` rose 0.03 → 0.09 → 0.17.
- `Episode_Termination/success` was about 0.20 while check_success was 0.00 to 0.06.

**The cause.**
- The monitor read the cube's body velocity from physics. check_success measures speed by the change in position between steps.
- The physics velocity drops below 0.01 m/s one step before the position change does. So the bonus, and the env's success termination, came at 0.48 s of check_success's settle time.
- That hit every episode that ended on the bonus, whatever its start. It was not tied to held starts, and not to truncation at the time limit.
- The offline calibration missed it because recorded episodes run on past the bonus.
- It taught nothing wrong: the cube had been placed. But check_success undercounted.

**Fix 1, `bf56c20`.**
- The monitor measures the cube's speed from the change in position since the last step. An episode's first step counts as moving.
- The bonus now fires exactly when check_success on the cut episode passes. The test makes physics report zero speed throughout:
  - fixed, the bonus lands at step 391;
  - unfixed, it landed at step 387.
- This is a run-enabling fix: the bonus now matches its spec.
- demo_v6 was launched before this fix, so its check_success undercounts. Read `Episode_Termination/success` beside it.

**Fix 2, `2333c96`: the lead's decision A.**
- Play episodes end 0.2 s after the bonus (`PLAY_SUCCESS_EXTRA_S`). Training is unchanged.
- **Why:** the gate re-simulates each trajectory. A trajectory that ended exactly at 0.50 s of settle could fail there by one step. With the margin, a teacher that bumps the bin after placing also fails.
- T6's round-0 rollouts are unaffected. They run check_success every 25 steps on their own env's records, until it passes or time runs out.
