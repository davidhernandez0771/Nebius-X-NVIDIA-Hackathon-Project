# Pre-registration DRAFT: Stage 0, inference-only variants on existing checkpoints (not run)

**Status: draft, not run, not frozen.** Nothing here has touched the GPU. Freeze it by committing this note and the plan file
unchanged *before* the first command runs; any later change is an amendment with its time and reason.

From the research note ([2026-10-20-research-cube-in-bin.md](2026-10-20-research-cube-in-bin.md), Part 3 (c), Stage 0
and "Order of work" 1). This is the cheapest test there: no new data, no training. It asks whether *how the policy
is run* is a bottleneck.
- The 100-step chunks run open loop, so the grasp is planned 2 s ahead.
- The finger targets are half-closed on 48% of steps.

## Question

On the existing checkpoints, does an inference-only change raise success on unseen scenes? The changes are binarizing
the gripper, re-planning every 20 steps, or ACT's temporal ensembling.

## Checkpoints (the plan's targets)

The frozen list is [2026-10-20-stage0-inference-plan.json](2026-10-20-stage0-inference-plan.json).

| Target | Checkpoint | Start state | Existing result on seeds 5020–5059 (the baseline) |
|---|---|---|---|
| **`mouse_pm10` (primary)** | `C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\train\perfected_multiply_10\checkpoints\030000\pretrained_model`: the mouse20261020 SANT cell, 110 episodes from the user's 10 mouse demos | that run's `datasets\raw_10` (`--start-pose dataset`, as in its eval) | **3/40** (Wilson 2.6–19.9%), [mouse20261020-results](2026-10-20-mouse20261020-results.md) section 4 |
| `scripted_rm10` (secondary) | `C:\dev\pm-t3\data\experiments\sprint6_home_a_20261016_205725\train\raw_multiply_10\checkpoints\030000\pretrained_model`: the scripted 10×10 cell | that run's `datasets\raw_10` (`--start-pose dataset`; that eval chose the dataset mean) | **17/40** on 5020–5059 (sprint 7's confirmatory run, `C:\dev\pm-t3\data\evals\sprint7_30k\raw_multiply_10_30k.json`) |

## Variants (inference only; the code is `lerobot_tools/inference.py`, all off by default)

| Variant | Flags | What it changes |
|---|---|---|
| `S0_baseline` | none | the reference: as both checkpoints were evaluated (`n_action_steps` 100, continuous fingers) |
| `S1_binarize` | `--binarize-gripper` | finger targets fully open (40 mm) when their mean is over 20 mm, else closed (0); applied in `run_eval` |
| `S2_replan20` | `--n-action-steps 20` | re-plan every 20 steps (0.4 s) instead of 100 (2 s); applied by the policy server |
| `S3_ensemble` | `--temporal-ensemble 0.01` | ACT temporal ensembling, coefficient 0.01, re-querying every step (`n_action_steps` 1); server |
| `S4_binarize_replan20` | `--binarize-gripper --n-action-steps 20` | S1 + S2 |

The policy server reports its settings in `/health`, and `run_eval` refuses a server whose settings differ from the
flags it was given. Every results file, episode-log header and registry row records them. These runs use
`--checkpoint LABEL=PATH`, so the registry is never touched.

## Procedure (one command)

From `C:\dev\pm-t8` (`pm/live-12` with `pm/policy-fixes` merged), with Isaac's Python:

```powershell
$env:DATA_DIR = "C:\dev\pm-t6\data"
C:\isaac\env_isaaclab\Scripts\python.exe scripts\stage0_inference.py --plan docs\superpowers\notes\2026-10-20-stage0-inference-plan.json
```

`scripts/stage0_inference.py` holds `C:\dev\gpu.lock` and keeps Windows awake for the whole run. It runs the targets in
plan order, the primary first:
1. **Practice:** all 5 variants on practice seeds **5300–5329** (n = 30 each). These seeds are never used for anything
   else here, and practice results are never reported as results.
2. **Choice:** the variant among S1–S4 with the most practice successes; a tie goes to the earlier one
   (S1 < S2 < S3 < S4). S0 is the reference and is never chosen. This is `choose_variant`, unit-tested.
3. **Final:** the chosen variant on seeds **5020–5059** (n = 40).

Results: `C:\dev\pm-t6\data\evals\stage0_inference_v1\<target>__<variant>__<phase>.json` (+ `.episodes.jsonl`,
`.eval.log`, `.server.log`), the log `stage0.log`, and the summary `stage0_summary.json`. A re-run resumes: finished
evals are skipped, and unfinished seeds are re-run (the eval_cells rules).

The exact eval_cells commands it runs (`--dry-run` prints them; shown for `mouse_pm10`, then the same five for
`scripted_rm10` with its checkpoint and start state):

```text
...\python.exe sim_eval\scripts\eval_cells.py --run-id stage0_inference_v1 --checkpoint mouse_pm10__S0_baseline__practice=<ckpt> --n 30 --seed0 5300 --start-state <raw_10> --start-pose dataset
... --checkpoint mouse_pm10__S1_binarize__practice=<ckpt> ... --binarize-gripper
... --checkpoint mouse_pm10__S2_replan20__practice=<ckpt> ... --n-action-steps 20
... --checkpoint mouse_pm10__S3_ensemble__practice=<ckpt> ... --temporal-ensemble 0.01
... --checkpoint mouse_pm10__S4_binarize_replan20__practice=<ckpt> ... --binarize-gripper --n-action-steps 20
... --checkpoint mouse_pm10__<chosen>__final=<ckpt> --n 40 --seed0 5020 --start-state <raw_10> --start-pose dataset <the chosen variant's flags>
```

## Analysis (pre-registered)

- **Primary:** `mouse_pm10`, the chosen variant on 5020–5059 vs its existing **3/40**.
  - Two-sided Fisher exact, α = 0.05, with Wilson 95% CIs.
  - Significant needs **≥ 11/40** (p = 0.037; 10/40 gives p = 0.066).
- **Secondary:** `scripted_rm10`, the chosen variant vs its existing **17/40**, the same test. A rise needs
  **≥ 27/40**.
- **Descriptive only:**
  - the full practice table (5 variants × 2 targets, n = 30);
  - failure reasons per variant;
  - for traced re-runs, if any are made later: the half-closed-finger fraction and the first-close height.
- **No other comparison is a claim.** That includes practice-seed differences between variants, and S0 on practice
  against the final baselines.

## Caveats, stated in advance

- **The baselines are existing results, not concurrent controls.** Both come from earlier evals of the same
  checkpoints on the same seeds: mouse on 10-20 from pm-t7, scripted on 10-17 from pm-t3. PhysX is not deterministic:
  replays reproduce outcomes only 2–4 times in 10 for marginal grasps. So a small difference may be noise from the
  sim, not the variant.
  - If budget allows, re-run S0 on 5020–5059 for the primary target as a concurrent control. That is descriptive and
    does not replace the pre-registered test.
- **The choice is made on 30 practice seeds**, so the chosen variant may be lucky there. The final seeds are the guard.
- **Stage 0 cannot tell us *why*** a variant helps. The research note's traces suggest stale plans and half-closed
  fingers; a win is consistent with that, not proof of it.
- **No GPU smoke test of the new flags has run.** The code is unit-tested, and a CPU load of the mouse checkpoint with
  the overrides gave finite actions. Check the first episode of `S2_replan20` and `S3_ensemble` in the `.eval.log`
  before leaving the run alone.

## Time estimate

Measured wall time per episode:
- `mouse_pm10` about 68 s (its mouse20261020 eval: 66–69 s);
- `scripted_rm10` about 53 s (sprint 7: 52.7 s).

Successes end early, so these are upper-ish.

| Part | Episodes | Estimate |
|---|---|---|
| `mouse_pm10` practice, 5 × 30 | 150 | ≈ 2.8 h |
| `mouse_pm10` final, 40 | 40 | ≈ 0.75 h |
| `scripted_rm10` practice, 5 × 30 | 150 | ≈ 2.2 h |
| `scripted_rm10` final, 40 | 40 | ≈ 0.6 h |
| `S3_ensemble`: the policy is queried every step, not every 100 (≈ +15–30 s per episode, unmeasured) | 60 | ≈ +0.4 h |
| 12 evals × (60 s free-GPU window + server start + Isaac start) | — | ≈ +0.5 h |
| **Total** | **380** | **≈ 7 h**; the primary result arrives after ≈ 4 h |

Run it overnight with sleep disabled; the script keeps the PC awake. One heavy GPU job at a time: the script waits
for `gpu.lock`.
