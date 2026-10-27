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

## Results: below the floor, so stage A uses the original 110 (disclosed)

**Run 1** (c799064, k = 2; out `data\held_human\mouse20261020`; 15:08:25–15:52:55, 44.5 min): **0/110 kept**. Every one
failed not_in_bin; 22 also dropped and 52 also collided. Per human (11 each):

| human | outcome |
|---|---|
| 00ab | 11 dropped |
| da08 | 7 + 4 collision |
| be76 | 6 + 5 collision |
| dc3e | 6 + 5 collision |
| ee42 | 2 dropped + 9 collision/dropped |
| 3cd0 | 11 |
| b27 | 1 + 10 collision |
| 68c | 6 + 5 collision |
| 848 | 7 + 4 collision |
| 4c66 | 1 + 10 collision |

**Amendment 1 (prereg 4de98da, code logged 069d136): option B, the grasp wait, plus the pilot rule.**
- Run on 8071e15: k = 2, `--grip-settle-m 0.005 --grip-settle-max-s 1.0 --pilot 22 --pilot-min 16`, out `data\held_human\mouse20261020_settle`.
- Ran 16:02:17–16:13:47 (687 s). **Pilot 0/22, which is below 16, so it stopped by rule.** No grid was written.
- Failures: 00ab, 11 × not_in_bin + dropped; da08, 9 × not_in_bin and 2 × not_in_bin + collision.
- Diagnostics:
  - 00ab:
    - grip waits of 9–12 steps;
    - tool lowest z 0.058 m against the human's grasp height of 0.0395 m;
    - about 45 steps of gripper-cube contact; the cube was never lifted (max z 0.0257).
  - da08:
    - tool lowest z 0.075 m;
    - no gripper-cube contact at all;
    - 97 arm-contact steps in 2 episodes.
  - Tool against target at the close step: 13.4–14.1 mm.
- Neither run 1 nor the pilot left any episode, so nothing from either can be trained on.

**Two findings (the lead: written down and disclosed; not fixed under this test):**

1. **A bug in my option B (8071e15).** The wait held the PREVIOUS CAPPED target, which still lags the human's point on a
   descent. The tool therefore settled 5 mm from a point about 19 mm above the grasp, and the fingers closed over the cube.
   - Fixed in **511d9a5**: the wait keeps commanding the human's point at the change (capped as always) until the tool is within 5 mm of it.
   - 16/16 tests pass. Not run on the GPU.
2. **k has to be measured against the held executor, not the cap.**
   - In T6's held teacher episodes (`distill_mouse_held` r0, about 59k steps), a held step closes only about **9% of the tool-to-target gap** (median 0.07–0.09 at every gap size from 0 to 40 mm).
   - With the cap's ±2 cm per-axis clamp from the tool, that caps the tool at about **0.1–0.15 m/s**. The held RL teacher lives inside that limit: its target sits at the clamp, 18.1 mm from the tool, the whole time.
   - The lead's k rule (and my proposal) measured only the cap lag, so k = 2 left the human paths (peaks 0.38 m/s at k = 2) far ahead of the tool.
   - A first-order model (tool += 0.09 × (target − tool), with 511d9a5's teacher, on the 110 paths, a 5 mm wait and at most 1 s):

| k | tool to the human's grasp point at close, median / p90 | waits at the 1 s limit |
|---|---|---|
| 2 | 76 / 108 mm | 73% |
| 3 | 12 / 50 mm | 34% |
| 4 | 4.7 / 5.1 mm | 10% |
| 5 | 4.7 / 4.9 mm | 0% |
| 6 | 4.8 / 4.9 mm | 0% |

   - The model is rough. Against the pilot's real rows (old code) it gives waits of 14 steps vs 11–12 real, but a lowest tool z of 0.041 vs 0.058 real.

**Queued (the lead, post-test only):** a k = 5 pilot on 511d9a5, as a measurement only, after the final test frees the GPU.

**Files:**
- `data\held_human\mouse20261020\` and `data\held_human\mouse20261020_settle\`: `rollouts.jsonl` (one row per source) and `held_human_done.json`.
- `k_table.json` (per-episode cap lag).
- Run logs are in `data\held_human\*.log`; run_log lines are in `C:\dev\pm-t6-big\data\distill\bigtest\run_log.txt`.
