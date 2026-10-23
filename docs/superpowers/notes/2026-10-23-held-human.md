# Held human re-execution (big test, 2026-10-23)

**What:** round 0's 110 human-derived SANT episodes (`C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json`, cell
`perfected_multiply_10`; 10 mouse demos + 100 SANT variants) re-executed through the held executor, so their labels
carry the held teacher's command habit (yesterday: label lead 0.0023 rad human vs 0.038 held teacher).

**How** (`sim_eval/held_human.py`, `sim_eval/scripts/held_human_rollouts.py`):
- Each episode's commanded path (trajectory.json) drives `HumanPathTeacher`:
  - the path is slowed by one k for all episodes;
  - it is capped as the RL env caps (`rl_teacher.cap_speed`: 0.5 m/s and 2.5 rad/s from the previous target, then within DELTA_M of the tool);
  - the orientation is pointing-down turned by the capped yaw. The human quaternions are at most 1.5 deg from that.
- It runs through `sim_eval.distill.rollout(driver="teacher", teacher_execution="held")`: one DLS solve per step, held for both substeps, zero-velocity target.
- Only check_success passes are kept. They are written as round-0 teacher episodes ("after" pairing, teacher.npz) under the source's own human lineage.
  - trajectory.json holds the ACHIEVED tool path (Amendment 5).
  - distill.json holds the provenance: kind held_human, source, k and the caps.
- Every source gets a row in `rollouts.jsonl` (pass/fail, reasons).
- `held_human_done.json` and `grid.json` (cell `held_human_10`) are what T6 reads.

**k (the lead's rule, fixed before the run):** the smallest k in {1, 1.25, 1.5, 2} with the 95th percentile, over the
110 episodes, of each episode's max lag |capped target - commanded| <= 2 cm. CPU, the speed cap alone, from each
episode's first observed tool pose.

| k | median max lag | p95 | max | episodes > 2 cm | yaw lag p95 |
|---|---|---|---|---|---|
| 1 | 5.58 cm | 15.94 cm | 20.93 cm | 81 | 0.564 rad |
| 1.25 | 1.79 cm | 10.83 cm | 14.32 cm | 50 | 0.422 rad |
| 1.5 | 0.04 cm | 6.90 cm | 9.56 cm | 28 | 0.315 rad |
| **2** | **0.00 cm** | **1.59 cm** | 3.58 cm | 3 | 0.143 rad |

**k = 2.** The human paths are 5.71 s on average (max 8.38 s), so the re-executed episodes are about twice as long.

**Floor (prereg 9dcc19e):** if at least 80/110 pass, stage A uses `held_human_10`; otherwise it uses the original 110, and that is disclosed.

**Result:** (filled in after the run)
