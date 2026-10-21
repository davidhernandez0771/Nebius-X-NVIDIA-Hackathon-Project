# Pipeline pages: every SANT stage after Record, followed live (2026-10-21)

Branch `pm/pipeline-pages`, from pm/live-12 (`2d1e5ad`). Nothing pushed. The screenshots are in `2026-10-21-pipeline-pages/`, all taken in headless Chrome with SwiftShader (training day: no GPU work).

## Done
- **The model** (`web/src/site/pipeline/model.ts`) covers:
  - runs: their snapshot and live events (SSE patches);
  - the pipeline bar: the current stage, time spent and left, and "Waiting for the GPU (Nth in line; it's busy: …)";
  - durations in words, the eval score per cell, and the loss curve path.
- **The example run** (`stub.ts`): a scripted run played through an EventSource look-alike, offered when the API isn't on the server. The page labels it as an example, not live.
- **The API client** (`api.ts`) and **the live hook** (`hooks.ts`): runs, a run, events, start / estimate / cancel / resume, config, the artifact list, and a run's footage.
- **The pages**, at `/pipeline`, `/pipeline/:run` and `/pipeline/:run/:stage`:
  - the run list;
  - the start form (demos from Record or a tag, the server's presets, variants, repairer, stop after, dry run, the server's estimate);
  - the sticky pipeline bar (not sticky on phones);
  - Cancel (asks first) and Resume;
  - one page per stage: Check, Repair, Multiply, Train, Evaluate, Export;
  - "Your data is ready" on every stage once a run is done.
- **The way in**: Record's header links to `/pipeline?demos=…`, and /data's nav has a Pipeline link.

## Run against T5's real API (today)
T5 sent **pm/pipeline-api c96c76b** this morning. It is 29fb66c plus fixes to match these pages: a `run` patch every 5 s and on every change, train `loss` as a number plus `loss_points`, ids for failed variants, `log` in the snapshot, and `detail` on `end`.

**Setup:** I ran T5's checkout as-is, read-only: `uv run --no-sync uvicorn app.main:app --app-dir src --port 8187`, with `SANT_PIPELINE=1`. `DATA_DIR` was a scratch copy of 3 mouse demos (`demo.json` + `episode/steps.npz`, `episode.json`). Vite ran on 127.0.0.1:5197 with `VITE_API_BASE_URL`. The backend allows CORS only from :5173, so the scratch Chrome ran with `--disable-web-security`; methods and headers are `*`, so origin is the only difference. **Only dry runs; no real run, no GPU.** Both servers are stopped.

**What was checked, against the real server:**
- **Config:** the server's three presets fill the picker.
- **Estimate:** 3 demos, about 2 h 43 min for a standard run.
- **A dry run started from the form:** it ended `done` with every stage "skipped", each with its planned time. The bar reads "dry run: about 2 h 43 min", and the run's detail reads "…about 2.7 h". (10, 11)
- **Cancel and resume:**
  - The cancel button posted (200). The dry run had already finished (about 2 s), and the page showed the final state.
  - Resume from the page: a dry run cancelled while queued (by curl) showed "cancelled before it started" and a Resume button. Clicking it took the run through queued to done. (12, 13)
  - Cancelling a run while it is *running*, through to its stop, is covered by the jsdom tests only. No dry run lives long enough to do it for real.
- **The downloads at the end:** a dry run makes no files, so I hand-seeded a finished export on one scratch run's record. It is named "SEEDED: fake finished run", with three placeholder files. The real `GET …/artifacts` list and the download route (`content-disposition: attachment`) served them. The page showed "Your data is ready" and listed them with sizes. (14)
- **Phones (390×844):** no horizontal scroll on the form, a dry run, the downloads, or the example's Train page. (15–18)

## Differences found and fixed
- **Train loss:**
  - `loss` can arrive as a number, as a list of points, or with `loss_points`. All three are read.
  - A new cell (raw → multiplied) starts its own curve and checkpoints.
- **Variants:** a variant with no id gets T5's own name for it (`<source>_m<seed>`), so failed variants no longer collapse into one row.
- **Evaluate:** both cells run the same seeds, so rows are keyed by `cell:seed`. Each cell is scored on its own ("Raw demos: k of n", "SANT (repaired + multiplied): k of n").
- **The `run` patch:** status, detail and resumable now update live, not only elapsed and remaining.
- **The run list:** a run whose `stage` is null reads "running", not "at ".
- **GPU queue:** a run waiting on someone else's lock, with no place in line, now says who holds it.
- **Dry runs:**
  - `plan_s` drives the bar.
  - Each stage reads "Skipped (a dry run): about X when it runs."
  - Stage pages say a dry run runs no stage.
  - The estimate asks for the full run's time; the dry run's own estimate is 0.
- **Estimate refusals:** a tag that matches no demo now shows the server's 422 reason instead of nothing.
- **Fixes from the screenshots:**
  - the server's longer preset label overflowed into the next field;
  - a long file name ran into its size on phones;
  - stage tiles broke durations mid-value on phones;
  - "— spent" showed for a run that never started;
  - Train said its step twice;
  - `?speed=` was lost on the example's stage links.
- **Not changed:** the shared site nav clips "Robots" at 390 px. That is AppShell, not this page.

## Checks
- **Pipeline tests:** model 12, stub 3, pages 29; all pass.
- **The full web suite:** 192 files, 1,741 passed, 1 skipped (after the teacher recipe).
- **`tsc -b` and `npm run build`:** pass.
- **Screenshot timing:** shots 12–13 were taken before the "— spent" fix, and shot 11 before the "a dry run runs no stage" line was added. Both changes are covered by tests and visible in shots 16 and 18.

## The teacher recipe (T5's pm/pipeline-api 719d278 + 8b10fa0)
The pages now also run the teacher recipe: T3's RL teacher, the teacher gate, T6's distillation, and an optional DAgger round.

**The start form** has a recipe switch, "From demos" or "Teacher". For a teacher run you pick:
- a human run, listed by `GET /pipeline/human-runs`, with a note when the server has none;
- the preset (`full` or `smoke`) and the number of teacher rollouts (300 or 600), both from `config.recipes.teacher`;
- a DAgger round, and a dry run.

It posts only the teacher fields, since the server forbids any other, and the estimate asks for the full run.

**A teacher run:**
- **The bar:** five stages (Teacher, Gate, Distill, DAgger, Export). The stage grid fits the run's stage count. A DAgger round nobody asked for reads "skipped", not "~0 s".
- **Teacher:** iterations, the human run, the rollouts to come, DAgger yes or no.
- **Gate:** "k of n replays verified (p%); the gate is 90%: passed/failed", the seed range, and the seed tiles.
- **Distill / DAgger:** the round's phase, its rollouts and successes, the student's loss curve (`distill_r0`, then `distill_r1`), and the checkpoint chosen.
- **Export:** names the student's checkpoint.
- **The run list:** shows "teacher · …", not "0 demos".
- **Live updates:** the `teacher` block updates live through T5's new `teacher` patch (8b10fa0, sent at my request).

**Against the real API** (719d278, a dry run only; CORS via `SANT_CORS_ORIGINS`, so no web-security flag this time):
- The form loaded the human runs and both presets, and estimated about 6 h 31 min.
- The dry run was **refused by T5's preflight**: T3's and T6's scripts (pm/rl-teacher, pm/distill-dagger) aren't merged into pm-t5. That is expected until they are. The page shows the refusal in full, and every stage with its planned time. (19, 20; phones 21, 22)
- The human run behind it was **hand-seeded** in my scratch data: "SEEDED_t2_fake_human_run", a `grid.json` and a `stages/train.json` that point nowhere.
- The live teacher views (Gate verdicts, round phases, the student's curve) have only been checked in the tests, against T5's snapshot shape. No teacher run has run yet.

## For T5
- Optional: allow the Vite origin from an env var, so the pages can run on another port without turning off web security.
- A cancel that reaches a dry run while it runs ends `done`, not `cancelled`. That is fine (it finished first); I'm noting it in case it matters for the teacher recipe.
- The teacher recipe is in (see above); thanks for the teacher patch.
