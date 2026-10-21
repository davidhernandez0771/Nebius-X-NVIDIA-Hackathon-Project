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
