# GPU runbook for the last runs (2026-10-26, for David's machine)

Written on a Mac without a GPU, from the committed notes and the code on `susana/nemotron-failure-analyst`. Every flag
below was checked against the script's argparse. Paths are the ones the notes record. **Check that each path exists
before running** (the `Test-Path` lines). Nothing here has been run yet.

Priority order, with times taken from the notes:

| # | What | GPU | Time | Why |
|---|---|---|---|---|
| a | Zip and share the big test's traces | none | minutes | The Nemotron analyst needs them to say *why* the cube drops |
| b | Ablation: split the two changes behind 30/40 | yes | ~1.5–2.5 h | The big test had one combined arm, so nobody knows which change worked |
| d | Held-human k = 5 pilot (already queued) | yes | ~0.5 h (pilot) | A measurement only, queued in `2026-10-23-held-human.md` |
| c | Nemotron recipe vs uniform scenes A/B (by hand, or one command: `scripts/sant_loop.py`) | yes | several hours | Tests the analyst's recipe end to end. Its region is a weak lead (see below) |

## The GPU lock

`C:\dev\gpu.lock` holds one line, `"<terminal> <PID> <task> <time>"` (`sim_worker/gpulock.py`). Before any Isaac or
training run, read it. If the PID in it is alive, wait.

- `held_human_rollouts.py` and `run_human_demo_experiment.py` take the lock themselves. Don't hold it by hand for them.
- **`eval_cells.py` does not take it** (checked: it has no `GpuLock`). For (b), hold it by hand with this wrapper.
  It deletes the lock even when the eval fails:

```powershell
$lock = 'C:\dev\gpu.lock'
if (Test-Path $lock) { Get-Content $lock; throw 'gpu.lock is held: wait for that run, or check whether its PID is alive' }
"T6 $PID ablation-20261026 $(Get-Date -Format s)" | Set-Content -NoNewline $lock
try {
    # ... the eval commands from (b) go here ...
} finally {
    Remove-Item $lock -ErrorAction SilentlyContinue
}
```

## Fresh seeds

`sim_eval/distill_round.py` `EVAL_ONLY_SEEDS` covers 5020–5059, 5300–5399, 5400–5439 and 5500–5557.
Other ranges are already used too:
- 5200–5249: practice traces, and DAgger r1 on 5210–5249;
- 5450–5499: the SANT replay-verify gate, `2026-10-22-pr-live-13.md`.

The big test's seed scan covered 5200–5599 only (`2026-10-23-bigtest-prereg.md`, "The range check"). No note uses
5600+, so this runbook uses:
- **(b) ablation: 5600–5639**
- **(c) recipe A/B: 5640–5679**

Check that no data folder has touched them before (an empty result means they are fresh):

```powershell
Get-ChildItem C:\dev\pm-*\data -Recurse -Include *.json,*.jsonl -ErrorAction SilentlyContinue |
  Select-String -Pattern '"seed": 56[0-7][0-9]\b' -List | Select-Object -First 20 Path
Get-ChildItem C:\dev\pm-*\data -Recurse -Filter 'seed_56*' -ErrorAction SilentlyContinue | Select-Object -First 20 FullName
```

## (a) Zip and share the traces (no GPU, minutes)

Where the final test wrote its results:
- The test ran `eval_cells.py --run-id bigtest_test --checkpoint bigtest_final=...` from `C:\dev\pm-t6-big`
  (`2026-10-23-bigtest/results/run_log.txt`, line 114).
- `eval_cells` writes to `DATA_DIR\evals\<run_id>\<cell>.json`, and the note says the trace folder is
  `bigtest_final_traces`. So the expected path is `C:\dev\pm-t6-big\data\evals\bigtest_test\`.

**The selection evals were not traced.** `sim_eval/bigtest.py` passes `--trace` only to the test (line 73: "per-step
traces on the test"). So there is no `distill_r0_s180000_traces` folder to send. The v1 final test was traced too
(`2026-10-20-distill-dagger.md` §8, run id `distill_mouse_final`), and its 25 failures are useful as a second set.

```powershell
Test-Path C:\dev\pm-t6-big\data\evals\bigtest_test\bigtest_final_traces
Test-Path C:\dev\pm-t6\data\evals\distill_mouse_final\distill_final_traces    # v1; expected, not confirmed
New-Item -ItemType Directory -Force C:\dev\share | Out-Null
Compress-Archive -Force -DestinationPath C:\dev\share\bigtest_test_traces.zip -Path `
  C:\dev\pm-t6-big\data\evals\bigtest_test\bigtest_final.json, `
  C:\dev\pm-t6-big\data\evals\bigtest_test\bigtest_final.episodes.jsonl, `
  C:\dev\pm-t6-big\data\evals\bigtest_test\bigtest_final_traces
Compress-Archive -Force -DestinationPath C:\dev\share\distill_final_traces.zip -Path `
  C:\dev\pm-t6\data\evals\distill_mouse_final\distill_final.json, `
  C:\dev\pm-t6\data\evals\distill_mouse_final\distill_final_traces
```

Upload the zips to the shared Google Drive. The traces hold simulator state only: no images, keys or personal data.

Or run the analyst on that machine instead of sending the files (from a checkout of this branch):

```powershell
uv run python scripts/analyze_failures.py --protect none --out data\analysis\bigtest_traced `
  --eval C:\dev\pm-t6-big\data\evals\bigtest_test\bigtest_final.episodes.jsonl
#   add --no-model to skip Nemotron. With Nemotron, load the Token Factory key the usual way
#   (uv run --env-file <your .env> ...). The 30/40 stands as run. This is a post-hoc diagnosis.
```

## (b) Ablation: which change made 30/40? (~1.5–2.5 h of GPU)

The big test changed two things against v1 that survived (`2026-10-23-bigtest-prereg.md`, "What it shows"):
- training 180k steps instead of 60k;
- the gripper deadband at inference (`--gripper-deadband 0.25`).

It had one combined arm, so it can't say which one mattered. This eval splits them **on the same fresh seeds**,
for all four cells.

**Pre-registration (commit this section, with its time, before the first eval):**

- **The question:** on fresh seeds, how much of the gain is the deadband, and how much is the training length?
- **Cells, each on seeds 5600–5639 (n = 40), each once:**

  | Cell | Checkpoint | Inference |
  |---|---|---|
  | `A180_on` | Stage A 180k (the final model) | `--gripper-deadband 0.25` |
  | `A180_off` | Stage A 180k | none |
  | `v1_60_on` | v1's final model (60k) | `--gripper-deadband 0.25` |
  | `v1_60_off` | v1's final model (60k) | none |

- **Settings:** everything else as the big test's command (`run_log.txt` line 114): `--start-state ...raw_10
  --start-pose dataset`, `--trace`, the same 30 s limit and cameras (the defaults). The code is `pm/bigtest`
  `c6bae0a`, the code the test ran on.
- **Primary contrast:** `A180_on` vs `A180_off`, two-sided Fisher exact, α = 0.05. It answers: does the deadband
  matter for the final model?
- **Secondary, descriptive only:**
  - `A180_off` vs `v1_60_off` (training length, deadband off);
  - `v1_60_on` vs `v1_60_off` (the deadband on the v1 model).
- **Honest limits:**
  - n = 40 per cell detects only large differences. A 15-point gap is likely to come out "not significant".
  - v1 and Stage A are separate training runs, so their difference is training length plus run-to-run noise.
  - `A180_on` on 5600–5639 is a re-measure of the final model on new seeds. It does not replace the 30/40.

**Commands** (cwd `C:\dev\pm-t6-big` at `c6bae0a`; Isaac venv). `eval_cells` applies one set of inference flags to
every `--checkpoint` in a call, so on and off are separate calls with the same `--run-id`:

```powershell
cd C:\dev\pm-t6-big
$PY = 'C:\isaac\env_isaaclab\Scripts\python.exe'
$A180 = 'C:\dev\pm-t6-big\data\experiments\bigtest_r0_t600_20261023_161418\train\distill_r0\checkpoints\180000\pretrained_model'
$V1 = 'C:\dev\pm-t6\data\experiments\distill_mouse_held_r0_t600_20261022_135818\train\distill_r0\checkpoints\060000\pretrained_model'
$RAW = 'C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10'
Test-Path $A180, $V1, $RAW     # all three must be True; the v1 folder is from 2026-10-21-distill-prereg.md (T6, pm-t6)

# inside the gpu.lock wrapper above:
& $PY sim_eval\scripts\eval_cells.py --run-id ablation_20261026 --checkpoint "A180_on=$A180" --checkpoint "v1_60_on=$V1" `
    --seed0 5600 --n 40 --start-state $RAW --start-pose dataset --port 8766 --gripper-deadband 0.25 --trace
& $PY sim_eval\scripts\eval_cells.py --run-id ablation_20261026 --checkpoint "A180_off=$A180" --checkpoint "v1_60_off=$V1" `
    --seed0 5600 --n 40 --start-state $RAW --start-pose dataset --port 8766 --trace
```

- **Time:** the big test's 40 traced episodes took 23 min (17:58:18 → 18:21:16, `run_log.txt`). v1's took 35.9 min
  (`2026-10-20-distill-dagger.md` §8). Four cells come to about 1.5–2.5 h.
- **Results:** `C:\dev\pm-t6-big\data\evals\ablation_20261026\<cell>.json`. A re-run resumes.
- **Afterwards (no GPU):** the analyst on all four cells' traces shows how the drops change with each setting:

```powershell
# from a checkout of susana/nemotron-failure-analyst (pm-t6-big doesn't have the analyst)
uv run python scripts/analyze_failures.py --no-model --out data\analysis\ablation_A180_off `
  --eval C:\dev\pm-t6-big\data\evals\ablation_20261026\A180_off.json
```

## (d) Held-human k = 5 pilot (already queued, ~0.5 h)

From `2026-10-23-held-human.md`, "Queued": a k = 5 pilot on `511d9a5`, **as a measurement only**. Nothing from it
becomes training data. The first-order model in that note predicts the tool within 4.7–4.9 mm of the human's grasp
point at k = 5 (median / p90). This checks that prediction.

```powershell
cd C:\dev\pm-t3-hh      # at pm/held-human ac6a8c1 (it contains 511d9a5)
C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\held_human_rollouts.py --k 5 --grip-settle-m 0.005 `
  --grip-settle-max-s 1.0 --pilot 22 --pilot-min 16 --grid C:\dev\pm-t6\data\human_exp\mouse20261020\grid.json `
  --cell perfected_multiply_10 `
  --start-state C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 `
  --out data\held_human\mouse20261020_k5
```

- **The flags are the Amendment 1 pilot's** (`2026-10-23-bigtest-prereg.md`), with `--k 5` and a new `--out`.
- **The script takes the GPU lock itself.**
- **Time** (my estimate): the k = 2 pilot of 22 took 687 s. k = 5 paths are 2.5× slower, so about 30 min. All 110
  would take about 1.9 h (run 1 at k = 2 took 44.5 min).
- **Before it counts as training data:** `sim_eval/scripts/check_label_execution.py` can replay the kept episodes'
  labels under the eval's executor.

## (c) Nemotron's recipe vs uniform scenes (several hours)

**What it tests:** whether the analyst's data recipe trains a better policy than the same number of uniform scenes.

**Read this first:**
- The current recipe (`data/analysis/bigtest_final/recipe_nemotron.json`, on Susana's Mac; `data/` is not in git)
  was fitted post-hoc on the big test's result rows.
- Its one region (cube on the left, bin on the right) had p = 0.092 on those rows and one-sided p = 0.11 on five other
  checkpoints (`2026-10-25-failure-analyst.md` §1b). That is a weak lead.
- A better recipe should come from the traced run in (a). Run this A/B only with time to spare, and send Susana's
  file as is: `config.json` records its sha256.

**Pre-registration:**
- **Arms:**
  - uniform (the command without `--scene-recipe`);
  - recipe (the same command with `--scene-recipe`).
- Same mouse demos, same settings, `--multiplied-only` (the raw arm is the same in both and isn't needed).
- **Eval:** 5640–5679, n = 40, each arm once.
- **Primary:** recipe vs uniform, two-sided Fisher exact, α = 0.05.
- **Never use `--eval-seed0` at its default.** It is 5020, a spent test set.

The base command is live test #11's (`2026-10-20-live-test-11.md`, line 160), with the seeds changed:

```powershell
cd <a checkout of susana/nemotron-failure-analyst>
uv run python scripts/run_human_demo_experiment.py --name mouse_uniform_20261026 --data-dir C:\dev\pm-t6\data `
  --tag "human_2026102[01]*" --input mouse --min-demos 5 --repairer rules --variants 10 --steps 30000 `
  --eval-n 40 --eval-seed0 5640 --no-nemotron --multiplied-only
uv run python scripts/run_human_demo_experiment.py --name mouse_recipe_20261026 --data-dir C:\dev\pm-t6\data `
  --tag "human_2026102[01]*" --input mouse --min-demos 5 --repairer rules --variants 10 --steps 30000 `
  --eval-n 40 --eval-seed0 5640 --no-nemotron --multiplied-only --scene-recipe C:\dev\share\recipe_nemotron.json
```

- **Time:** not measured for this exact pipeline in the notes I read. ACT 180k took 3.9–4.4 h on the 10-22 rates
  (`2026-10-23-bigtest.md`), so 30k is about 0.7 h per arm. Add the sim stage (replay, repair, multiply 100) and an
  eval of about 0.4–0.6 h per arm.
- **Unverified:** whether `--multiplied-only` and `--scene-recipe` have been run together. Both are unit-tested
  separately. Try `--smoke` first (2,000 steps, 5 eval seeds, marked sample).

## (c, one command) The closed loop: `scripts/sant_loop.py` (added 2026-10-28)

The same A/B as (c), as one resumable command: eval → diagnosis → frozen recipe → recipe arm and uniform control →
both evaluated on the same fresh seeds → compare. The stages are in `src/demo_pipeline/loop.py`. **Use it instead of
(c)'s two commands, not as well:** both use the seeds 5640–5679.

What the script does. This comes from its `--help`, its docstring, and two `--dry-run`s on the Mac (one with `--eval`,
one with `--recipe`):
- **Stages, in order:** `diagnose` (runs `analyze_failures.py`), `freeze` (checks the recipe, copies it and writes
  `preregistration.md` before any training), `train_recipe`, `train_control`, `eval_recipe`, `eval_control`
  (each runs `run_human_demo_experiment.py ... --multiplied-only`, the recipe arm with `--scene-recipe`), then
  `compare`.
- **Compare:** two-sided Fisher exact, as (c) above, and Wilson 95% intervals, into `compare.json` and `report.md`.
  The recipe wins only if p ≤ 0.05 and its arm is ahead. The one-sided p is reported as secondary. (Settled 10-28:
  the loop first used one-sided; it now matches (c) and the project's other pre-registered comparisons.)
- **State:** `DATA_DIR\loops\<name>\loop.json`. Re-run the same command to resume. Finished stages whose inputs are
  unchanged are skipped.
- **Exit codes:** 0 done, 1 refused (nothing run), 2 a stage failed (re-run to resume).
- **Refusals seen:** `--no-model` needs `--recipe-source rules`. Every path must be under `--root` (default: the repo).
- **`--eval-seed0` has no default**, on purpose.

First, print every stage's exact command. `--dry-run` runs nothing and writes nothing:

```powershell
cd <a checkout with scripts\sant_loop.py>
uv run python scripts/sant_loop.py --name recipe_loop_20261028 --root C:\dev --data-dir C:\dev\pm-t6\data `
  --recipe C:\dev\share\recipe_nemotron.json `
  --tag "human_2026102[01]*" --input mouse --min-demos 5 --eval-seed0 5640 --eval-n 40 --dry-run
```

- **With the traces from (a)**, diagnose them instead of passing `--recipe`. Use
  `--eval <...>\bigtest_final.episodes.jsonl --post-hoc --env-file <your .env>`; the traces folder sits next to it.
  Without traces, add `--results-only`.
- **Then the smoke test:** the same command with `--smoke` in place of `--dry-run`, and another `--name`. It uses
  2,000 ACT steps per arm and marks the results as a sample. It proves the stages run and measures nothing.
- **Then the real run:** the same command without `--dry-run` or `--smoke`. To run a single stage, use
  `--stage <stage>`; its earlier stages must be done.
- `run_human_demo_experiment.py` takes the GPU lock itself, so don't hold it by hand.
- **Time:** as (c), two training arms and two evals. Not measured for this script.

## Web tests on Node 26 (any machine, added 2026-10-28)

On Node 26, Node's own experimental web storage shadows jsdom's `localStorage`. On the Mac that made 275 web tests
fail; none of them is a code problem (`2026-10-28-overnight-plan.md`, "State at the start"). Turn it off for the run:

```powershell
cd web
$env:NODE_OPTIONS = '--no-experimental-webstorage'; npx vitest run; Remove-Item Env:NODE_OPTIONS
```

On macOS or Linux: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run`. Older Node versions don't need it, and may reject the flag.
