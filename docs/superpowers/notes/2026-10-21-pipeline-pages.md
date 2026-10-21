# Pipeline pages: every SANT stage after Record, followed live (2026-10-21, paused)

Branch `pm/pipeline-pages`, from pm/live-12 (`2d1e5ad`). Paused for the night at the lead's request. Nothing pushed. The screenshots are in `2026-10-21-pipeline-pages/` (SwiftShader).

## Done
- **The model** (`web/src/site/pipeline/model.ts`): runs, their snapshot and live events (SSE patches), the pipeline bar (current stage, time spent and left, "Waiting for the GPU (Nth in line; it's busy: …)"), durations in words, the eval score, the loss curve path. It includes T5's deltas: run `detail`/`resumable`; a stage's `items`, `elapsed_s` and `eta_basis`; eval `cell`; train `cell`; artifact `sha256`/`note`; `log` lines.
- **The example run** (`stub.ts`): a scripted run played through an EventSource look-alike, used until the API is on the server. Its numbers are shaped on tonight's mouse experiment, and the page labels it as an example, not live.
- **The API client** (`api.ts`) and **the live hook** (`hooks.ts`): runs, a run, events, start / estimate / cancel / resume, a run's footage (the /showcase body).
- **The pages**, at `/pipeline`, `/pipeline/:run` and `/pipeline/:run/:stage`:
  - the run list;
  - the start form: demos from Record or a tag, preset, variants, repairer, stop after, dry run, the server's estimate; a 403 shows the server's reason;
  - the sticky pipeline bar on every stage;
  - **Check**: verdicts, with /data's badges.
  - **Repair**: Neaten's edits in words, and /data's before/after table.
  - **Multiply**: variants as they arrive, with their Isaac footage and badges.
  - **Train**: step of steps, time left, the loss curve (log scale), checkpoints.
  - **Evaluate**: seed by seed, k of n (planned).
  - **Export**: downloads with their sizes and notes.
- **The way in**: Record's header now has a "Run SANT on N demos →" link (`/pipeline?demos=…`, the demos saved this visit), and /data's nav has a Pipeline link.
- **Tests**: `model.test.ts` 10, `stub.test.ts` 3, `PipelinePage.test.tsx` 12, and a new test in `RecordConsole.test.tsx`; all pass. Typecheck is clean. The full suite was not re-run after the last changes (the pipeline, record and data suites pass).

## Half done / known issues
- **Not yet run against T5's real API.** It landed as **pm/pipeline-api 78aa8f4** (C:\dev\pm-t5; note `docs/superpowers/notes/2026-10-20-pipeline-api.md`; shapes in `tests/test_pipeline_progress.py` and `tests/test_pipeline_routes.py`). The frontend was built to the agreed shape plus T5's deltas, but never against the server.
- **New fields not shown yet:** T5's snapshot `plan_s` (dry runs) and `GET /pipeline/config` (presets and timings for the form).
- **Cancel and resume** are in `api.ts`, but have no buttons yet.
- **`?speed=` (the example's playback speed) is lost** when a bar link is clicked. The example then restarts at 30×, which is why screenshot 07 says "30×". Fix: keep the query string in the bar's links, or drop `speed` from `useRun`'s effect deps.
- **The Train page** shows the stage detail ("step 20000/30000") and the summary line together; drop one.
- **Not done yet:** a phone check (390×844) and the full web suite.

## Next step (tomorrow)
1. Merge or check out pm/pipeline-api 78aa8f4 alongside this branch.
2. Run `uv run uvicorn app.main:app --app-dir src` with `SANT_PIPELINE=1` and `DATA_DIR` set.
3. Do a dry run from the start form (`{"tag":"human_2026102*","dry_run":true}`, no GPU). Check the bar, the stage ETAs and `plan_s`, and fix any parsing differences against T5's tests.
4. Then add the cancel/resume buttons and the config-driven presets, fix the `?speed=` and Train duplicates, take the phone screenshot, run the full web suite and build, commit, and tell T7.
