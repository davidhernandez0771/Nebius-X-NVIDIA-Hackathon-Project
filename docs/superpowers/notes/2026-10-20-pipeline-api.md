# The pipeline API: the whole SANT pipeline from the site (`pm/pipeline-api`, 2026-10-20)

**The task:** the user wants the site to run the whole pipeline, not just Record. The site should show each stage's
progress with real time estimates, and let them download their data at the end. This branch is the backend; T2
builds the pages on it, in the shape T2 proposed and I confirmed (deltas below).

**Branch:** from `pm/live-12` 2d1e5ad. No GPU run: unit tests with stubs, plus one real dry run through the real
backend and runner. Nothing pushed, merged or rebased.

## What a run is

A site run wraps `scripts/run_human_demo_experiment.py`, the runner T4 and T3 already use:
- it runs as one subprocess, with the recipe turned into its arguments;
- it is named `pl_<UTC time>_<4 hex>`;
- its experiment folder is `DATA_DIR/human_exp/<id>/`, so the showcase reads it too;
- the run's own record lives in `DATA_DIR/pipeline/runs/<id>/` (`run.json`, `runner.log`, `artifacts/`).

**The runner's stages:** select, sim (physics, repair, align, multiply), grid, Nemotron, train, eval, results.
After them, the API exports the downloads. The runner already resumes from its stage markers, holds the GPU lock
before each GPU stage, and waits while anyone else holds it.

**The one change to the runner: cancel.**
- `<experiment>/STOP` stops it before the next stage, or before the sim's next step (exit 2; what finished is kept).
- Delete the file and re-run, and it resumes.
- Test: `test_a_stop_file_stops_the_run_before_the_next_stage_and_a_resume_carries_on`. The runner's 40 tests pass.

## The pieces (`src/app/pipeline/`, `src/app/routers/pipeline.py`)

| Piece | What | Tests |
|---|---|---|
| `recipe.py` | The request: `demos`/`ids` or `tag` (+ `input`); repairer, variants, preset (smoke 2k / standard 30k / long 60k steps), `eval_n`, `stop_after` (`grid` = data only), `multiplied_only`, `nemotron` (billed, off by default), `dry_run`. Becomes the runner's arguments | `test_pipeline_recipe.py` (4) |
| `timings.py` | Per-item times learned from every `DATA_DIR/human_exp/*/run.log` (median), defaults otherwise; re-learned after each finished run (written to `DATA_DIR/pipeline/timings.json`) | `test_pipeline_timings.py` (3) |
| `progress.py` | The run's state in T2's shape, from its files: 6 stages, per-item progress, elapsed, ETA (learned per item, or the run's own pace after 2 items), GPU state, check/repair/variant rows (the showcase's `_demo_row`), train step/loss/checkpoints, eval seeds | `test_pipeline_progress.py` (7) |
| `runs.py` | The runs: FIFO queue, one active, cancel/resume, the outcome read from `run.log`, the export at the end, adopting a live runner after a backend restart | `test_pipeline_runs.py` (8) |
| `export.py` | The downloads, sized and hashed, with an index | `test_pipeline_export.py` (9) |
| `routers/pipeline.py` | The routes and the SSE patches; off unless `SANT_PIPELINE=1` | `test_pipeline_routes.py` (5) |

## Time estimates, learned from the real runs

From `C:\dev\pm-t6\data`, the shared data folder (68 physics replays, 30 repairs, 13 multiplied demos, 2 trainings,
2 evals):

| Item | Learned | Default (the lead's numbers) |
|---|---|---|
| sim worker start | 15 s | 20 s |
| physics | 23 s / demo | 20 s |
| repair | 40 s / demo | 45 s |
| align | 23.5 s / demo | 20 s |
| multiply | 14.8 s / variant | 15 s |
| train | 608 s per 10k steps per cell (10.1 min) | 550 s |
| eval | 70.2 s / episode | 70 s |
| grid, Nemotron, results, export | no history yet | 5 s, 20 s/demo, 2 s, 120 s |

**How they're measured:** each `run.log` line is timestamped, and a stage's per-item time is the gap between its
lines.
- Training starts from the lock being acquired, not from the wait for it.
- A clock past midnight wraps.
- A gap that is negative or over 2 h (a resumed run) is dropped.

**Training per episode count:** the 4 measured trainings ran 1,371–1,824 s for 30k steps with 10 to 110 episodes,
with no clear trend. So the estimate is per step per cell; the registry keeps the episode counts for a later fit.

**The running stage's ETA:** once it has done 2 items, it uses this run's own pace.

## GPU safety

- **One run at a time:** only one site run is active, so the site never starts a second Isaac process; the others
  wait in our queue (`gpu.state = "queued"`, `position`).
- **Waiting for the lock:** the active run's runner takes `C:\dev\gpu.lock` before each GPU stage and waits while
  anyone holds it. The state shows `gpu: {state: "queued", holder: "<the lock's line>"}` until the lock names this
  run.
- **Off by default:** starting, cancelling and resuming answer 403 unless `SANT_PIPELINE=1`, so a public deployment
  can't start jobs. Reading and downloading are always allowed.
- **Lock owner:** the runner writes "T4" as the lock's owner for every run, the site's included. The task names the
  run (`human-exp:<id>:sim`).

## Exports (`DATA_DIR/pipeline/runs/<id>/artifacts/`)

- **`dataset_<cell>.zip`:** each trained cell's LeRobot dataset, the one training used. For a run that stops at the
  grid, the datasets are assembled first in the LeRobot venv (the exporter needs `lerobot`). That path is
  **stubbed in tests, not run for real**.
- **`robota_embed.zip`:** the Robota-Embed export of the multiplied cell.
  - **Instruction phrasings:** Nemotron's phrasings are on T3's `pm/robota-instructions`, which isn't in
    `live-12`. Until it merges, the export uses the task text and says so in the artifact's note and the report.
    Once it's merged, the same code uses `make_instruction_set`: Nemotron's phrasings when the recipe's `nemotron`
    is on, templates otherwise.
- **`results.json`:** the Results page's shape.
- **`report.md`, `report.html`:** readable; plain HTML, no scripts.
- **`provenance.json`:**
  - the frozen config, the recipe and the runner's arguments;
  - the demos' SHA-256, the pre-registration's SHA-256;
  - the git commit, the pipeline version, the training run;
  - every other artifact's SHA-256.
- **Index:** `artifacts.json`, with name, kind, bytes, sha256, url and note.
- **Downloads:** `GET /pipeline/runs/{id}/artifacts/{name}`. Only listed plain names are served, as attachments
  with Content-Length. Nothing is sent anywhere but the browser that asks.
- **A failing part** (Robota with no verified episode, say) is noted in the report, and the rest still exports.

## The API, as confirmed with T2

T2's shape, with these deltas (sent to T2):
- **Run fields:** each run also has `detail` and `resumable`.
- **Stages and rows:**
  - stages add `items {done, total, unit}`, `elapsed_s` and `eta_basis`;
  - check rows add `frames`; variant rows add `source`;
  - eval seeds have `cell`;
  - `train.loss` in a patch is the new points only;
  - artifacts add `sha256` and an optional `note`.
- **Status mapping:**
  - "refused" (bad selection or settings) and "interrupted" (the runner died, or the backend restarted without it)
    show as `failed`, with a detail;
  - `cancelling` shows as `running`.
- **Extra routes:**
  - `POST /pipeline/estimate`: the plan with nothing started;
  - `GET /pipeline/config`: enabled, presets and timings;
  - cancel, resume, and the artifacts list;
  - footage: the run's store through the showcase's sprite code.
- **SSE:** `snapshot`, then the patches (`stage`, `gpu`, `check`, `repair`, `variant`, `train`, `checkpoint`,
  `evaluate`, `artifact`), plus `log` (each `run.log` line), then `end {status}`; keepalive every 15 s.

## Checked for real: a dry run through the real backend and the real runner

- **Setup:** a temporary `DATA_DIR` holding copies of three of tonight's mouse demos (`demo.json` and the live
  `steps.npz` only), uvicorn on a free port, `SANT_PIPELINE=1`.
- **The estimate:** `POST /pipeline/estimate {"tag": "human_2026102*"}` gave 3 demos and 2.71 h for a standard run.
  It used the defaults: that folder has no history.
- **The dry run:** `POST /pipeline/runs {"tag": "human_2026102*", "dry_run": true}`.
  - The runner selected and froze 3 demos (achieved path, 30k steps, 40 seeds, Nemotron off).
  - It wrote the pre-registration.
  - The run ended `done`: "dry run: 3 demos selected; the full run would take about 2.7 h". Every stage was
    `skipped`, with its planned time.
  - The SSE stream sent the snapshot, the log lines and `end`.
- **A first attempt didn't reach my backend:**
  - My uvicorn failed to bind port 8099, which was taken. Some other process answered the requests in this API's
    shape, and has since exited; its run folder isn't on disk.
  - I redid the check on a port confirmed free. I've asked T2 whether they had a server on 8099.

## Checks

- **New tests:** 36 pipeline tests and 1 runner test, all pass.
- **The full suites:** `tests` (without `test_launch_health.py`): 2,320 passed, 19 skipped; `lerobot_tools` and
  `sim_eval` tests: 242 passed, 11 skipped.
- **pyflakes:** clean on the new and changed files. The runner's `import PIL` (a deliberate check, with its
  `noqa`) is the one finding left.

## Not done, or not known yet

- **No GPU stage ran through the API.** **Next step:** the first real run, with the smoke preset, needs the user's
  go and a free GPU (no `C:\dev\gpu.lock`).
  1. Start the backend with `SANT_PIPELINE=1` and `DATA_DIR` set.
  2. `POST /pipeline/runs {"tag": "<about 3 demos>", "preset": "smoke"}`.
  3. Watch `/pipeline/runs/{id}/events`.
  4. Check the downloads.
- **Untested with real files:** assembling the LeRobot datasets for a data-only run (the LeRobot venv subprocess),
  and the Robota export inside a real run.
- **`nemotron: true`** needs Pillow in the backend's venv, as the runner does. Without it the runner refuses, and
  the run fails with the runner's message.
- **No auth:** the server is meant to run on the machine itself, as the rest of the backend does (CORS: the Vite dev
  server only).
