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

## 2026-10-21: T2's pages connected (c96c76b)

T2's pages (`pm/pipeline-pages` ca56858) now run against this API, dry runs only. I fixed the API side to match their
reducer:
- a `run` patch;
- the train patch's `loss` is a number, with `loss_points`;
- every variant row has an id;
- the snapshot has `log`;
- `end` carries `detail`.

T2 found nothing else that needs an API change. Their notes:
- an estimate with `dry_run: true` gives `remaining_s` 0, so the form drops `dry_run` when it asks for the estimate;
- a cancel that reaches a dry run ends it `done`, because it finished first;
- CORS is 5173 only; they asked, as optional, for the origin to come from an env var. **Done:**
  `SANT_CORS_ORIGINS` (comma-separated) adds origins on top of 5173. Only `http://localhost:<port>` and
  `http://127.0.0.1:<port>` are taken; anything else is ignored (`app.config.cors_origins`).

## 2026-10-21: the "teacher" recipe (code and tests only; no GPU, no real run)

The site's Train step can now run the real approach. `POST /pipeline/runs {"kind": "teacher", "human_run":
"mouse20261020", "teacher_n": 300|600, "dagger": false, "preset": "full"|"smoke", "rl_iterations"?, "dry_run"?}` runs
`scripts/run_teacher_pipeline.py` (module `src/app/pipeline/teacher_runner.py`) in the same queue as the demos
recipe. It calls T3's and T6's scripts and never edits their branches.

| Stage (site id) | Runner stage | What it calls | gpu.lock |
| --- | --- | --- | --- |
| `teacher` | `teacher` | `scripts/rl_train.py --run-name <id> --max-iterations N` (T3) | taken by T3's script |
| `gate` | `gate_eval` | `scripts/rl_eval_teacher.py --checkpoint <last model> --seed0 5300 --n 50` (T3, Isaac python) | **taken by this runner** (+ KeepAwake + Isaac gate): the script doesn't |
| `gate` | `gate_verify` | `scripts/rl_verify_teacher.py --runs <gate dir>` (T3) | taken by T3's script |
| `distill` | `distill_r0` | `sim_eval/scripts/distill_round.py --round 0 --teacher sim_worker.rl_policy:make --teacher-checkpoint <exported/policy.pt> --human-grid/--human-cell/--start-state <from the human run> --teacher-n 300\|600` (T6) | taken by T6's script |
| `dagger` | `dagger_r1` | the same with `--round 1`, only when `dagger: true` | taken by T6's script |
| `export` | (the API) | `build_teacher_artifacts` | none |

- **The gate:** T3's step 2 (SANT's replay with `check_success`) must reach 90% on practice seeds 5300–5349, or the
  run is `refused` ("the teacher gate: k/n … under 90%"). The test seeds 5020–5059 are never touched: the final
  test stays a separate, pre-registered run.
- **Smoke preset:** T3's `--smoke` (20 iterations), a 5-seed gate with no threshold, and T6's smoke flags
  (`--teacher-n 4 --min-teacher 1 --steps 200 …`). It proves the stages run and measures nothing.
- **Resume:** each stage leaves a marker in `DATA_DIR/teacher/<id>/stages/`. Training that ended early (a crash, a
  sleep) restarts from its last `model_<i>.pt` with `target − i` more iterations: rsl_rl restarts *at* iteration
  `i`, so the last file is `model_<target−1>.pt`. T6's round resumes its own phases.
- **Cancel:** the STOP file stops the run before the next stage. It doesn't kill a running stage, so a cancel during
  RL training waits for training to end (~1 h at full size).
- **Where the scripts are:** `SANT_TEACHER_REPO`, default this checkout. Today no branch has both:
  - pm/rl-teacher has no `distill_round.py`;
  - pm/distill-dagger has no `rl_*`.

  The preflight refuses a run and names the missing file and its branch. T3's and T6's outputs land under
  `<repo>/data` (their convention).
- **Hardcoded by T3:** the demo-start bank `data/rl/bank_mouse20261020.npz`, which the preflight checks.
- **Snapshot** (`src/app/pipeline/teacher_progress.py`): the same keys as a demos run, plus `kind: "teacher"` and a
  `teacher` block {iteration, iterations, gate {successes, n, min, seeds, passed}, rounds [{round, phase, rollouts,
  selection, decision}]}.
  - The five stages are `teacher`, `gate`, `distill`, `dagger`, `export`.
  - Per item:
    - RL iterations come from rsl_rl's "Learning iteration i/N".
    - Gate episodes are the trajectories written, then the "seed N:" lines from the replay.
    - Rollouts are T6's `rollouts.jsonl` rows, then ACT steps, then candidates selected.
  - `train` is the student's curve and checkpoints; `evaluate` holds the gate verdicts, with cell `teacher_gate`.
- **Time estimates** (`timings.py`) are T3's and T6's note estimates until real runs measure them:
  - 2.0 s per RL iteration;
  - per gate episode: 30 s for the teacher, 20 s for the replay;
  - 24 s per teacher rollout and 70 s per DAgger rollout;
  - 21 s per 1,000 frames to assemble, at about 500 frames per rollout;
  - the existing ACT and eval rates.

  They are learned from the teacher markers (full-size RL only) and from T6's `wall_s` per rollout row. Plan for
  later: today's T3/T6 run times become the defaults.
- **Exports:**
  - `dataset_distill_r<k>.zip`: the final student's LeRobot dataset;
  - `student_checkpoint.zip`: `pretrained_model`;
  - `teacher_checkpoint.zip`: `model_<i>.pt`, `exported/policy.pt` and `params/`;
  - `results.json`, `report.md`, `report.html`;
  - `provenance.json`: the recipe, args, config, the git commits of both repos, the human grid's hash, the gate and
    every file's hash.
- **API:**
  - `GET /pipeline/config` gains `recipes.teacher` {presets, teacher_n, stages}.
  - New: `GET /pipeline/human-runs` lists the trained human runs a teacher run can start from.
  - `/runs` rows gain `kind`.
  - SSE: a `teacher` patch `{type: "teacher", ...the whole block}` whenever the block changes (T2's ask: gate
    results, round phases, rollouts and the selection go live; the pages replace their block with it).

### Checked, without GPU

- **Tests:** `tests/test_pipeline_teacher_runner.py` (8) and `tests/test_pipeline_teacher.py` (9) pass, alongside
  the 46 other pipeline tests (+1 for the CORS origins). The full suite (`tests` without
  `test_launch_health.py`): 2,339 passed, 19 skipped. pyflakes is clean on the new and changed files.
- **End to end through the real backend and the real runner script:**
  - **Setup:** a scratch `DATA_DIR`, port 8231. `SANT_TEACHER_REPO` pointed at a stand-in repo whose five scripts
    write what T3's and T6's would. It has a `PIPELINE_STUB_REPO` file, so the runner takes no gpu.lock; a real
    checkout never has that file.
  - **Bad input:** a missing human run and `teacher_n` 450 both got 422.
  - **Dry run:** `done`, "the scripts and inputs are there; the full run would take about 6.5 h" with today's defaults.
  - **Full stand-in run with DAgger:**
    - all five stages `done`;
    - the SSE stream showed RL iterations 0 → 116 of 120, 50 gate verdicts, and both rounds' loss curves and
      checkpoints, then `end: done`;
    - 7 downloads, each re-downloaded with matching sha256.
  - **Cancel and resume:** cancelled at iteration 22 of 300, the run stopped after training, before `gate_eval`
    (`cancelled`, resumable). Resume carried on to `done`.
  - **GPU display:** it read "queued", because the real `C:\dev\gpu.lock` was held by today's training and the
    stand-in run never takes it.

### Not done

- **No real run.** The first one needs a branch with both T3's and T6's code (or `SANT_TEACHER_REPO` pointing at
  one), the user's go, and a free GPU. Run the smoke preset first.
- **Not tested with the real scripts:** the real scripts' output formats. They are read from T3's and T6's code
  (`verify.json` verdicts, `selection.json` `chosen_step`, `round_t<n>.json`, `<run>_r<k>_t<n>_<time>` training
  runs, `wall_s`/`frames` rows), not from a real run.
- **T6's own teacher gate** ("(b)", 4000–4049, ≥ 45/50) isn't a separate stage here. Round 0's rollouts include those
  seeds, and its `rollouts.jsonl` successes show in the `teacher` block.
