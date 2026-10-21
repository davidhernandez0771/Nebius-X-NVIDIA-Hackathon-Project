# Pre-registration DRAFT: SANT v2 on the existing 10 mouse demos, raw vs SANT (not run)

**Status: draft, written 2026-10-20 evening, not run, not frozen.** Nothing has touched the GPU. It runs tomorrow
(2026-10-21), **after** the quick Stage-0 test ([stage0 prereg](2026-10-20-stage0-inference-prereg.md), alternative
A). It is frozen when the command below runs: `select` writes `config.json` (with every demo's sha256) and the
script's own `preregistration.md` before anything else happens.

This repeats [mouse20261020](2026-10-20-mouse20261020-results.md) (raw 0/40 vs SANT 3/40, p = 0.24) with everything the
research note ([2026-10-20-research-cube-in-bin.md](2026-10-20-research-cube-in-bin.md)) says to fix *without
re-recording*: the data (Neaten/Multiply) and the training recipe. It uses the same 10 demos, the same eval seeds and
the same test.

## Question

On the same 10 mouse demos, does a policy trained on SANT v2's output beat one trained on the demos as recorded, when
both are trained the improved way and evaluated the same way?

## Demos

The 10 mouse demos of live test #11, by id (the same list as mouse20261020):
`human_20261020183738_00ab`, `…183801_da08`, `…184043_be76`, `…184117_dc3e`, `…184146_ee42`, `…184211_3cd0`, `…184230_b27d`,
`…184247_68ce`, `…184302_848e`, `…184318_4c66`. `--min-demos 10` refuses anything less. As before, each one's
soft-floor record is frozen and reported, not filtered.

## Arms

| Arm | Data | Training | Eval |
|---|---|---|---|
| **`raw_10`** | the 10 demos as recorded (achieved-path replay, start-aligned at home; every demo, `--raw-arm all`) | ACT, **80k steps**, batch 8, **`--augment shift`**, **`--dilation`**, checkpoints every 10k | checkpoint chosen on practice seeds, then 5020–5059 |
| **`perfected_multiply_10`** (SANT v2) | rules repair **with `--grasp-retime`**, start-aligned, then ×10 verified variants **with `--yaw-wrap`** and **`--approach-offset 0.04`** (10 repaired + up to 100 variants) | identical | identical |

- **The data fixes** (T3, `pm/sant-data-fixes`; the script's pre-registration states each one):
  - **grasp retime:** swoop grasps become hover, a slow last 4 cm, stop, close, 0.4 s closed, straight lift;
  - **yaw wrap:** the multiplied wrist turns only to the cube's nearest face, at most ±45°;
  - **centred approach:** at a retimed grasp's hover, each variant arrives off by up to 4 cm and 35°, then centres.
- **The training recipe** (`pm/policy-fixes`):
  - shift augmentation: affine translate 5% and ±5°, plus brightness/contrast, at most 2 per frame;
  - ResNet final-stride dilation: 8×8 image tokens instead of 4×4;
  - 80k steps.
  - It is the same for both arms, with one training run each (seed 1000).
- **Checkpoint selection, per arm:**
  - The 40k, 60k and 80k checkpoints are each evaluated on practice seeds **5300–5329** (n = 30).
  - The most successes wins; a tie goes to the later step.
  - The choice is written to `evals/<run>/practice/<cell>.selection.json`, and only that checkpoint is evaluated on
    the final seeds. Practice results are never reported as results.

## Inference: the rule, fixed now

- **If the quick Stage-0 test's primary result is significant**, both arms are evaluated with S4
  (`--binarize-gripper --n-action-steps 20`), for practice and final alike. "Significant" means mouse_pm10 with S4 on
  5020–5059 vs its 3/40, two-sided Fisher p < 0.05, i.e. ≥ 11/40.
- **Otherwise**, both arms use plain inference: the checkpoint's own settings, no flags. That includes a quick test
  that didn't finish.
- **Nothing else decides it.** That covers the concurrent control, the secondary scripted target, and the size of a
  non-significant rise.
- Which command was run (with or without the S4 flags), and the quick test's summary file, are stated in the results
  note.

## Endpoint and test

- **Primary:** success on seeds **5020–5059** (n = 40 per arm), serial `eval_cells`, 30 s, front + wrist, both arms
  from the raw dataset's start state (`--start-pose dataset`).
  - **Two-sided Fisher exact, SANT vs raw, α = 0.05**, with Wilson 95% CIs.
  - Thresholds at n = 40 (exact Fisher): against raw 0/40, SANT needs ≥ 6/40; against 3/40, ≥ 11/40.
- **Descriptive, not tested:**
  - the practice table;
  - failure reasons per arm (collision, dropped, gripper closed, not in bin);
  - how many demos the grasp retime rewrote;
  - variant yield;
  - training losses;
  - the comparison with mouse20261020's 0/40 vs 3/40. That is a different recipe, so it's no test.
- **Optional, if time allows (descriptive):** the same two chosen checkpoints on fresh seeds **5400–5439**. It guards
  against the inference choice having looked at 5020–5059 (Stage 0 evaluated other checkpoints there).

## The raw arm's limitation, stated in advance

**All 10 demos were recorded in one scene:** cube (0.50, 0.00, yaw 0), bin (0.50, 0.30). The teleop sink used
`base_scene()`, and every episode's `scene.json` is identical. The eval samples 40 random scenes. So:
- `raw_10` is trained on one scene and tested on 40 others. It measures one-scene → many-scene generalisation, not
  the value of "raw human data" in general. Its 0/40 last time says little about the demos themselves.
- SANT's multiplier supplies the scene diversity, around one human grasp style.
- **A SANT win here is "SANT turns 10 one-scene demos into data that generalises", not "SANT beats equally diverse raw
  data".** The fair version needs demos recorded in many scenes: the research note's 12-scene protocol, and Record's
  new scene picker (`pm/record-scenes`). That is the next pre-registration, not this one.

## Other caveats

- **Both training changes and three data changes land at once.** A win can't say which one mattered.
- **One training run per arm,** so training variance is not measured.
- **Two of the recipe's pieces are untried on this GPU:** `--dilation` and 80k steps. Their training time and memory
  are estimates (below). If training fails on memory, that is a stop, not an amendment. Changing the recipe means a
  new pre-registration.
- **The grasp retime and the centred approach were dry-run on the CPU only** (`scripts/sant_data_fixes_dryrun.py`,
  T3). Their physics verification happens in this run's sim stage, and failures are reported as failures.
- **PhysX is not deterministic.** The thresholds above are for the test as run.

## Command (one, from `C:\dev\pm-t8` on `pm/live-12`)

The `select` step of exactly this command, plain-inference version, was checked on a scratch copy of the 10 demos
(2026-10-20 21:56, no GPU). It selected the 10 and froze `steps` 80000, `save_freq` 10000, `select_steps` [40000,
60000, 80000], practice 5300 / 30, `augment` shift, `dilation`, `yaw_wrap`, `grasp_retime` and `approach_offset_m`
0.04. The S4 version also froze `inference`. The script's own `preregistration.md` lists all of it.

**Plain inference** (if the quick Stage-0 primary was not significant):

```powershell
cd C:\dev\pm-t8
$env:PYTHONPATH = "C:\dev\pm-t8\src"; $env:UV_PROJECT_ENVIRONMENT = "C:\dev\pm-t7\.venv"
uv run --no-sync python scripts\run_human_demo_experiment.py --name mouse20261021_v2 --data-dir C:\dev\pm-t6\data `
  --ids human_20261020183738_00ab,human_20261020183801_da08,human_20261020184043_be76,human_20261020184117_dc3e,human_20261020184146_ee42,human_20261020184211_3cd0,human_20261020184230_b27d,human_20261020184247_68ce,human_20261020184302_848e,human_20261020184318_4c66 `
  --input mouse --min-demos 10 --repairer rules --variants 10 --no-nemotron `
  --yaw-wrap --grasp-retime --approach-offset 0.04 `
  --augment shift --dilation --steps 80000 --save-freq 10000 `
  --select-steps 40000 60000 80000 --practice-seed0 5300 --practice-n 30 `
  --eval-n 40 --eval-seed0 5020
```

**S4 inference** (if it was significant): the same command with `--binarize-gripper --n-action-steps 20` at the end.

- **Environment.** `PYTHONPATH` makes pm-t8's code win over pm-t7's editable install. The script's children (the
  LeRobot trainer, Isaac, `eval_cells`) put their own checkout first anyway (the import guard).
- **Resuming.** The script takes `gpu.lock` for each GPU stage and keeps the PC awake. A re-run of the same command
  resumes from the last finished stage.

## Time estimate

| Stage | Basis | Estimate |
|---|---|---|
| sim: physics, repair, align, multiply ×10 | mouse20261020's took 32 min; the retime and centring add a little | ≈ 0.6–0.75 h |
| train, 2 arms × 80k | 30k took 23–27 min per arm. 80k ≈ 2.7×; dilation and augmentation add an unmeasured ~1.3–2× | ≈ 2.5–4.5 h |
| practice: 3 checkpoints × 30 seeds × 2 arms | 180 episodes at ≈ 65 s | ≈ 3.3 h |
| final: 40 seeds × 2 arms | 80 episodes at ≈ 65 s | ≈ 1.5 h |
| per-eval start-up (8 evals: gate, server, Isaac) | ≈ 2–3 min each | ≈ 0.3 h |
| **Total** | | **≈ 8–10.5 h** |

- Started after the quick Stage-0 test (≈ 1.5–2.3 h), it finishes late on 2026-10-21.
- **A shorter variant, only by an amendment written before the start:** select on 2 checkpoints (60k, 80k) instead
  of 3. That saves ≈ 1.1 h.
- Training is the least certain line: nothing here has trained with `--dilation` yet.
