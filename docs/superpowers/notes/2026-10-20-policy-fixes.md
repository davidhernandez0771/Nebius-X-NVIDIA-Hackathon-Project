# Policy fixes: inference and training options, checkpoint selection (`pm/policy-fixes`, 2026-10-20, code only)

From the research note ([2026-10-20-research-cube-in-bin.md](2026-10-20-research-cube-in-bin.md), Part 3 (c)). Built
tests-first, on `pm/live-12` `7ca3a24`. No GPU was used, nothing was installed, and nothing has been evaluated or
trained with these options yet. **Every option is off by default, so a pre-registered eval or training run's commands
and behaviour are unchanged.**

## 1. Inference options (sim_eval run_eval / eval_cells, the policy server)

The shared module is `lerobot_tools/inference.py`, stdlib + numpy, imported by both the Isaac venv and the LeRobot venv.

| Flag | Applied by | What it does |
|---|---|---|
| `--binarize-gripper` | `run_eval` (wraps the policy) | both finger targets 40 mm if their mean is over 20 mm (the labels' midpoint), else 0; the arm is untouched |
| `--n-action-steps N` | the policy server | re-plan every N steps instead of the checkpoint's 100; refused above its `chunk_size` |
| `--temporal-ensemble COEF` | the policy server | ACT temporal ensembling (e.g. 0.01); sets `n_action_steps` 1 (re-query every step); refused for non-ACT policies |

- **The server** (`lerobot_tools.policy_server`) sets these on the loaded config *before* the policy is built, which
  is where LeRobot reads them. They are execution settings, not weights.
  - `/health` reports `inference: {overrides, chunk_size, n_action_steps, temporal_ensemble_coeff}`.
- **`run_eval`** refuses (exit 2) a server whose overrides differ from its own flags. That covers a tuned server
  under a plain eval, a plain server under a tuned eval, and an older server that can't say.
  - It records the options under `run.inference`, along with what the server reported.
  - The episode-log header gets `inference` (None for a default eval), and `inference` is now a resume key, so a
    resume can't mix settings. Old logs resume as default evals.
  - The registry row's `eval.inference` records them too.
- **`eval_cells`** passes the server-side options to the server and all of them to `run_eval`. It also checks the
  server's `/health` before evaluating.

## 2. Training options (lerobot_tools.experiments / train)

- **`--augment shift`** turns on LeRobot's image transforms: `RandomAffine` (translate 5%, ±5°) plus brightness and
  contrast (0.8–1.2), at most 2 per frame.
  - There is no hue, saturation or sharpness.
  - It is passed as `--dataset.image_transforms.tfs=<json>`, because draccus can't override one entry of that dict.
    I checked that LeRobot 0.6.1 parses it and builds a `RandomSubsetApply` over those 3.
- **`--dilation`** passes `--policy.replace_final_stride_with_dilation=true`, which gives 8×8 image tokens at 128 px.
  The field is typed `int`; draccus parses `true` as 1, checked.
  - A render-resolution flag would mean re-running every sim stage at 224 px, so dilation is the cheaper path. It's
    unmeasured.
- **The budget:** `lerobot_tools.train.MAX_STEPS` goes from 60k to **100k**, so 80k fits.
- **Recorded:** every registry row now has `train_options` (`{"augment": "off", "dilation": false}` by default). The
  command is `experiments.train_command`.

## 3. Checkpoint selection on practice seeds (eval_cells --select-steps)

`eval_cells.py --run-id R --select-steps 40000 60000 80000 [--practice-seed0 5300 --practice-n 30]`, for registry rows:
1. Each listed step's saved checkpoint is evaluated on the practice seeds, into
   `DATA_DIR/evals/R/practice/<cell>@<step>.json`, registry untouched. The start state is the row's dataset, unless
   `--start-state` is given.
2. The most practice successes wins; a tie goes to the later step. A step with no saved checkpoint is refused, with
   the saved steps listed.
3. The choice goes to `practice/<cell>.selection.json`: every candidate's k/n, the rule, and the inference options.
4. The chosen checkpoint is evaluated on the final seeds (`--seed0`, `--n`). That result goes into the cell's own row,
   matched by its last checkpoint (`run_eval --row-checkpoint`). The row's `eval` records `evaluated_checkpoint` and
   `selection`.

Practice seeds that overlap the final ones are refused. `--select-steps` can't be combined with `--checkpoint` specs.
The per-eval loop moved out of `main` into `evaluate_one`, and `evaluate_with_selection` calls it for each candidate,
then for the chosen checkpoint. Behaviour without `--select-steps` is the same.

## 4. The Stage-0 driver and its pre-registration draft (full, and a quick S4-a-priori alternative: --quick)

`scripts/stage0_inference.py` and [2026-10-20-stage0-inference-prereg.md](2026-10-20-stage0-inference-prereg.md),
with the plan [2026-10-20-stage0-inference-plan.json](2026-10-20-stage0-inference-plan.json). **Not run.**

## Checks

Tests first; each new test failed before its code existed.
- **New:**
  - `lerobot_tools/tests/test_inference.py`: 10.
  - `sim_eval/tests/test_sim_eval_inference.py`: 10.
  - `tests/test_stage0_inference.py`: 7.
  - Added to `test_policy_server.py` (3), `test_experiments.py` (6) and `test_train.py` (1).
  - `test_own_code.py` now covers `scripts/stage0_inference.py`.
- **A real load, CPU only (`CUDA_VISIBLE_DEVICES=""`, LeRobot venv):** the mouse20261020 `perfected_multiply_10`
  checkpoint.
  - With `--n-action-steps 20` its config says 20.
  - With `--temporal-ensemble 0.01` it says 1, the policy has a temporal ensembler, and three `act` calls return
    finite 9-vectors.
- **Not tested:** a real Isaac eval with any of the flags (no GPU), and a training run with `--augment shift` or
  `--dilation`.
