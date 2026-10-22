# RL teacher gate, 2026-10-21: demo_v6 model_1499 FAILED (replay 3/50)

## The run

- **Run:** demo_v6 (the lift reward preset, v5's exploration settings, mixed starts).
- **Training:** 1500 iterations, 3,953 s.
- **Checkpoints:** `data/rl/logs/rsl_rl/sant_rl_teacher/2026-10-21_11-47-14_demo_v6/`.

## Start-type breakdown (128 episodes, not the gate's seeds)

**Settings:** deterministic actions, deadband 0.25, grace 10, the fixed bonus.

Successes are the in-env check_success:

| Checkpoint | Home | Demo free | Demo held |
|---|---|---|---|
| model_1499 | 61/67 (0.82–0.96) | 30/31 | 30/30 |
| model_1450 | 58/67 | 29/31 | 30/30 |

model_1499 was picked from these numbers and gated once.

## The gate (practice seeds 5300–5349; the pass mark is ≥ 45/50)

- **In-env:** 43/50, and 24/30 on the first 30. The failures were dropped 6 and collision 1.
- **Replay verify:** **3/50**, Wilson 95% 0.02–0.16, and 3/30 on the first 30. The successes were seeds 5303, 5308 and 5313.
- **Replay failures:** collision 44, not_in_bin 35, dropped 20, unreachable 6, not_settled 5.
- **Agreement:** the replay and the in-env verdict agree on 10/50 seeds.

## Why the replay fails: speed

The scenes are identical. The replay tracking error is 2.9 cm, the median over seeds.

Commanded tool speed (m/s):

| | median | p90 | p99 | max |
|---|---|---|---|---|
| teacher | 1.73 | 2.69 | 3.17 | 3.49 |
| verified human demos | 0.20 | 0.48 | 0.85 | 1.31 |

**How the env lets it go this fast.** Each action is at most 2 cm from the *current* TCP. So consecutive targets differ by the TCP's motion plus 2 cm.

**Why the replay can't follow.**
- The env's tracking takes its feed-forward from the previous command, and the policy learned to ride it at 2–3 m/s.
- SANT's replay takes its feed-forward toward the next target. That diverges at these speeds.
- Example, seed 5300 step 24: the replay is at z 0.021 while the command is at z 0.162.

**Proposed fix** (an action-side amendment; reward and success unchanged):
- Add a speed limit: each target moves at most v_max × 0.02 s from the previous target.
- v_max is 0.5 m/s (recommended) or 1.0 m/s.
- Then resume from model_1499 and gate a second time on fresh seeds 5350–5399.

## Gate 2 — demo_v6c2 model_2098: PASSED

**Run.** demo_v6c2 resumed from model_1499 with the speed cap (f5b6646, fix b7935c0) and the v6r settings: std reset 0.3, std_range [0.1, 0.5], curricula held.
- Iterations 1500–2098 took 1903 s.
- In total the teacher has 2099 iterations and 5856 s of training (v6 took 3953 s).
- Checkpoint: `data\rl\logs\rsl_rl\sant_rl_teacher\2026-10-21_13-39-10_demo_v6c2\model_2098.pt`.
- Export: `...\demo_v6c2\exported\policy.pt`.

**Start-type breakdown** (128 episodes, rng 7, demo_prob 0.5, deadband 0.25, grace 10; not on gate seeds). Each cell is check_success / episodes [Wilson 95%].

| start | model_2098 | model_2000 |
|---|---|---|
| home | 66/67 [0.92–1.00], 1 collision | 66/67 [0.92–1.00], 1 collision |
| demo_free | 31/31 [0.89–1.00] | 31/31 [0.89–1.00] |
| demo_held | 30/30 [0.89–1.00] | 30/30 [0.89–1.00] |

- The two checkpoints match on every start type, but only model_2098 was tested before gate 2.
  - The lead ran model_2098's breakdown at 14:31:35 (`data/rl/breakdown_v6c2_2098.lead.log`) and picked it.
  - Gate 2 started at 14:35.
- Both 15:26–15:29 runs came AFTER the gate. They were T3's own job, queued at 14:31 and waiting for the lock.
  - model_2098, 15:26:38: a repeat with identical numbers. It overwrote `breakdown/v6c2_2098/breakdown.json` with the same table.
  - model_2000, 15:28:00: the first and only look at that checkpoint. It is a post-hoc check only and did not affect the pick.
- Replayability check on non-gate seeds 7000–7031: in-env 32/32, replay 32/32, the verdicts agree 32/32.

**Gate 2** was run once, on fresh seeds 5350–5399 (Amendment 3), into `data\rl\eval\v6c2_gate2`.

| | result | Wilson 95% |
|---|---|---|
| in-env | 50/50 | |
| replay verify (the gate) | **50/50** | 0.93–1.00 |
| first 30 (5350–5379) | 30/30 | 0.89–1.00 |

- In-env and replay agree on 50/50.
- Replay durations are 2.5–3.2 s.
- The speed cap closed the gate-1 gap: the replay went from 3/50 to 50/50.

## Re-making the teacher: `--preset`

`scripts/rl_train.py` has two named presets (`PRESETS`) that hold the gated teacher's commands word for word. A test checks them against the logged commands.

```
uv run --no-sync python scripts/rl_train.py --preset teacher_v6
uv run --no-sync python scripts/rl_train.py --preset teacher_v6c2 --checkpoint <stage-1 run>\model_1499.pt
```

**teacher_v6 (stage 1):**
- lift reward, 4096 envs, 1500 iterations;
- demo_v6's overrides;
- the speed cap turned **off** (`env.actions.arm_action.v_max=0.0`, `yaw_rate_max=0.0`). demo_v6 trained before the cap existed, and the cap is now on by default.

**teacher_v6c2 (stage 2):**
1. First runs `scripts/rl_checkpoint_std.py --std 0.3`. It writes a copy into `data/rl/resume/<run-name>/`. On demo_v6's model_1499 this copy is identical to `data/rl/resume/v6_std03/model_1499.pt`, the file demo_v6c2 resumed from.
2. Then resumes from the copy with demo_v6c2's overrides: std_range [0.1, 0.5], curricula held, action_rate and joint_vel at -0.1.
3. The speed cap is at its defaults (0.5 m/s, 2.5 rad/s), for 600 iterations.

**Overrides and checks:**
- `--override` adds to a preset. On the same key it replaces the preset's value.
- `--smoke`, `--num-envs` and `--max-iterations` still apply.
- A test in the Isaac venv checks that every preset key is a real setting.

**Not tested:** a single from-scratch run with the cap on.

## A′: held-target execution (demo_v6h), 2026-10-21 evening

**Why.** Round 0's camera student scored 0/30. The cause is how the arm is driven:
- The teacher was executed with Isaac Lab's IK re-solved at every substep, plus the velocity feed-forward.
- The student is executed with one 9-joint target held for both substeps, with zero velocity target (`sim_eval.isaac_env._apply`).
- The arm is HIGH_PD (K 400, D 80), so its time constant is about 0.2 s. A held target at most 2 cm ahead of the tool moves it only about 0.1 m/s per axis (≈ 0.17 m/s diagonally).

**The change.** `SantTcpTargetActionCfg.held_target` (off by default; every earlier run is unchanged) executes the arm the student's way:
- one damped-least-squares solve per control step, from the state at the step's start (Isaac Lab's controller, λ 0.01, no joint-limit term);
- that target held for both substeps, with a zero velocity target;
- no feed-forward and no joint-limit clipping (the articulation clamps to its soft limits either way).

**Tests.**
- One solve per step, an identical target on both substeps, and zero velocity targets.
- Off still means a re-solve on every substep plus the feed-forward.
- **Parity with T6's `sim_eval.teacher_ik.ik_target`** (the student's label and execution): 16 random states with the root rotated and the TCP offset applied agree to 1e-5.

**Wiring.**
- `run_held_target(path)` reads the setting from a run's env.yaml. `rl_eval_teacher.py` and `rl_start_breakdown.py` play a run the way it trained.
- The breakdown takes `--override env.…=…` on top of the run's own settings.

**Plan (Amendment 4, T7).**
1. **Zero-shot check:** `rl_start_breakdown.py --checkpoint <demo_v6c2>\model_2098.pt --out data\rl\breakdown\v6c2_2098_held --override env.actions.arm_action.held_target=True`.
2. **If home-start success is ≥ 90%,** model_2098 is the candidate.
3. **Otherwise,** run `--preset teacher_v6h --checkpoint <demo_v6c2>\model_2098.pt`: std reset to 0.3, then v6c2's settings plus held_target, at most 600 iterations, judged at +300 and +600.
4. **Pick rule,** applied before the gate on the rng(7) breakdown only: highest home-start success, then fewer collisions, then the later iteration.
5. **Gate (a)** on fresh seeds 5450–5499.

### demo_v6h results and Amendment 5 (a definition change, disclosed)

**Zero-shot (model_2098 with held execution).**

| start | success |
|---|---|
| home | 46/67 [0.57–0.79] (19 dropped) |
| demo_free | 29/31 |
| demo_held | 24/30 |

Home was below 90%, so demo_v6h ran.

**demo_v6h** (`--preset teacher_v6h`, code 4a22fcb):
- Started 21:33:05. Iterations 2098→2697, 1415 s.
- Run dir: `data/rl/logs/rsl_rl/sant_rl_teacher/2026-10-21_21-33-14_demo_v6h`.

**Breakdowns** (rng 7, held execution):

| start | model_2400 | model_2697 |
|---|---|---|
| home | 63/67 | 64/67 |
| demo_free | 31/31 | 31/31 |
| demo_held | 29/30 | 26/30 |
| collisions | 0 | 5 |

The pick, by the rule's first criterion (home), is **model_2697**. It was made before the replay check.

**Replay check on 7000–7031 (commanded-target trajectories, as for every earlier teacher).**
- in-env 30/32; SANT replay **22/32** [0.51–0.82] (not_in_bin 7, dropped 4, collision 4); agreement 24/32.
- Gate (a) was NOT started, so seeds 5450–5499 are unused.
- Cause: held execution lags its commands by design (≈ 0.2 s; targets up to 2 cm ahead). So the commanded path, replayed with SANT's tracking, is a different motion from the one that happened.

**Amendment 5** (the lead's decision, logged by T7). It was made AFTER the 7000–7031 replay check above showed the commanded-vs-achieved mismatch (22/32).
- For a held-executed teacher, `rl_eval_teacher.py` records the **achieved** tool pose after each step as the Trajectory. That is SANT's human-demo standard: replay checks what the arm really did.
- The gripper column stays the commanded gripper.
- An episode's ending step is dropped: the env has already reset it.
- Tracking teachers are recorded unchanged (commands).
- `in_env.json` says which (`"trajectory": "achieved" | "commanded"`).
- The gate is unchanged: `rl_verify_teacher.py` replay ≥ 45/50 on 5450–5499.
- Next (morning, GPU): replay check 7000–7031 under the new recording, then gate (a) once.

### Gate (a) for the held teacher: PASSED (2026-10-22 morning)

This followed Amendment 5's order (prereg 986fff0). All runs used model_2697 with held execution and achieved-path recording (code 6101243).

| step | seeds | in-env | SANT replay | agree |
|---|---|---|---|---|
| 1, diagnostic | 7000–7031 | 30/32 | 29/32 [0.76–0.97] | 31/32 |
| 2, decision (≥ 29/32) | fresh 7100–7131 | 29/32 | 30/32 [0.80–0.98] | 31/32 |
| **gate (a), once** | **5450–5499** | 49/50 | **48/50 [0.865–0.989]** | 49/50 |

For comparison, step 1's seeds under the commanded recording gave replay 22/32 with agreement 24/32.

**Gate (a) details:**
- Replay failures: 5454 collision; 5463 not_in_bin + dropped.
- First 30 (5450–5479): 28/30 [0.787–0.982].
- Replay durations 6.9–12.0 s (median 7.7).
- Directories: `data/rl/eval/v6h_replaycheck_7000_achieved`, `v6h_check_7100_achieved`, `v6h_gate_a`.

**The teacher:**
- `data/rl/logs/rsl_rl/sant_rl_teacher/2026-10-21_21-33-14_demo_v6h/exported/policy.pt`, re-exported from model_2697 at 08:09:47.
- `make()` reports `execution="held"`.
- Training: 2698 iterations, 7271 s (v6 3953 + v6c2 1903 + v6h 1415).
- With T6's gate (b) at 48/50 (4950–4999, held execution), both parts are passed.
