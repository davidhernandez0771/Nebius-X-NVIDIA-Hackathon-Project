# Sprint 3b (T1, T4, T5): From Runs to the Real Chart

> Same rules as sprint 3: its Global Constraints apply, including ownership,
> 0 failed, no push/merge/rebase, and a progress entry after every task.
> Required skills: `test-driven-development`, `systematic-debugging`,
> `verification-before-completion`.

**Goal:** when T2 (sim worker) and T3 (training/eval) produce data, it should
flow automatically into:

- scored diagnoses;
- one experiment orchestration;
- a real `results.json`;
- the Results page;
- the README.

No numbers are invented. Anything not yet measured stays `null` and shows as
pending.

**Start point:** `ecf2250`, with 764 Python + 149 web tests passing.
T2 and T3 are still running sprint 3; do not edit their files.

**Results file contract.** The real chart data is the JSON shape already
parsed by `web/src/pm/results/results.ts` and shown in
`web/src/pm/mocks/results.sample.json`, with `"sample": false`.

- Its location is `DATA_DIR/results/results.json`.
- T1 writes it (Task 2), T5 serves and shows it (Tasks 1–2), T4 feeds it
  (Task 2).
- If the TS parser needs a field the builder cannot fill, the builder writes
  `null`, and T5 renders `null` as "pending".

---

## T1 (`C:\dev\pm-t1`)

**Owns:**

- `src/demo_pipeline/scoring.py`
- `scripts/score_pipeline_run.py`
- `scripts/build_results_json.py`
- `src/demo_pipeline/results.py` (new, pure)
- their tests

### 1. Score a pipeline run against ground truth

`scripts/score_pipeline_run.py --set <DATA_DIR/sets/name> --diagnoser rules|nemotron`:

- **Reads:**
  - `<set>/<id>/truth.json`;
  - the stored diagnosis for each demo id that T4's `run_pipeline_batch.py`
    produced, from `<set>/pipeline/<diagnoser>/` and the `DemoStore`. Read
    T4's script and store to find exactly where.
- **Writes:** `<set>/pipeline/<diagnoser>/scores.json` with per-issue-type
  P/R/F1, time IoU, and the counts of kept / perfected / discarded.
- **Plus** `--compare`, which prints rules vs nemotron side by side. This is
  the ablation table.
- **Tests:** fake store contents built in `tmp_path`.

### 2. Build the real results file (pure + script)

`src/demo_pipeline/results.py` has
`build_results(registry_rows, eval_files, yield_files, scores) -> dict`, in
exactly the shape `results.ts` parses, with `"sample": false`.

**Inputs it collects:**

- T3's `DATA_DIR/results/registry.jsonl` (cells with `eval_success`) and
  `DATA_DIR/evals/*.json`;
- T2's multiply `yield.json` files;
- Task 1's `scores.json` files.

**Rules:**

- A missing cell or metric becomes `null`, never 0.
- Every value records its source file.

`scripts/build_results_json.py --data-dir ... --t2-data C:\dev\pm-t2\data`
writes `DATA_DIR/results/results.json`.

**Tests:**

- round-trip against the sample's shape (load `results.sample.json`, check
  the keys and types match);
- null handling;
- provenance.

---

## T4 (`C:\dev\pm-t4`)

**Owns:**

- `src/app/ai/diagnose.py`
- `src/app/{jobs,sim_client}.py`
- `src/app/routers/demos.py`
- `src/demo_pipeline/store.py`
- `scripts/run_pipeline_batch.py`
- `scripts/run_experiment.py` (new)
- their tests

### 1. Re-diagnosis with failure reasons

When `perfect_demo` calls `diagnose_fn` again with failure reasons, include
those reasons in the prompt: "the previous repair failed verification
because: …".

- Record **every** round's repairs in `Passport.repairs_applied`, not only the
  last round's.
- Tests.

### 2. Experiment orchestration

`scripts/run_experiment.py --set <set> --n-human 5,10,20 --variants-per-demo 10 --robot franka --resume`:

- **raw:** `/replay` each human demo with cameras (raw episodes).
- **perfected:** the pipeline with rules, and with nemotron (budget flags).
- **multiply:** `/multiply` on raw and on perfected demos.
- Writes T3's grid JSON (cells: `raw`, `raw_multiply`, `perfected_multiply`,
  `rules_multiply` × n_human), listing the episode dirs for each cell, for
  T3's `lerobot_tools.experiments`.
- Resumable. Stops cleanly when the worker is down.
- Tests with `tests/fake_sim_worker.py`.

### 3. Live (only if `http://127.0.0.1:8770/health` answers ok)

T2 runs that server. While it is not up, poll every 10 minutes for up to 90
minutes. Once it is up:

1. Build a set: `scripts/make_experiment_set.py --name s1 --n 12`.
2. Run sprint 3's Task 5 (rules ×3, nemotron ×3; ≤ 10 calls, ≤ $0.05).
3. Run `run_experiment.py` on n-human = 5 with `--variants-per-demo 5` as the
   first real pass.

Record everything. If the worker never comes up, say so and stop.

---

## T5 (`C:\dev\pm-fix`)

**Owns:**

- `src/app/routers/results.py` (new)
- `tests/test_results_api.py`
- `src/app/main.py` (the router include line only)
- `web/src/pm/**`
- `README.md`
- `docs/submission/**`

### 1. Serve real results

`GET /results` returns `DATA_DIR/results/results.json`:

- 404 `{"detail": "no results yet"}` when missing;
- 422 when corrupt.

Tests.

### 2. Results page reads the API first

- It uses `/results` when available; otherwise it uses the sample file, with
  the SAMPLE DATA banner.
- `null` values render as "pending", never as 0.
- The banner disappears only when `"sample": false`.
- Vitest tests.

### 3. Refresh the docs with today's measured results

Update `README.md` and `docs/submission/*` with the merged sprint 2–3
results, cited to the notes in `docs/superpowers/notes/`:

- the IK lag fix (26.8 → 2.1 mm);
- batch 50/50;
- Franka multiplication yield 27/30;
- rules F1 under tremor 0.97–0.99;
- the Nemotron calibration (5 → 0 false positives, $0.0014/call);
- the OpenArm finding;
- the web pages.

Keep every unmeasured result marked PENDING. Remove the stale lines that call
Nemotron's false positives an open problem.

**Done when:** `uv run pytest -q`, `npm --prefix web test` and
`npm --prefix web run build` all pass.
