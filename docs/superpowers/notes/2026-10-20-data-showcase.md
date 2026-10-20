# Data showcase: real demos through SANT, and SANT working live (2026-10-20)

Branch `pm/data-showcase`, from pm/live-11 (2abc94e). Page: **`/data`**. Screenshots are in `2026-10-20-data-showcase/`.

All checks ran in headless Chrome with SwiftShader only (the renderer string was confirmed); no GPU was used, because T4 was training.

## What it shows
- **Demo by demo.** You pick an experiment and a demo. Two views of it sit side by side on one clock, and each view is either:
  - **Live**: what the human did, the live recording;
  - **Replay**: the same path re-run with physics on;
  - **Repaired**: what SANT made of it, re-verified;
  - **a Variant**: cube and bin moved.

  Each view has the 3D robot twin next to the **Isaac Sim front camera** (the episode's own frames) and a **physics verdict badge**.

  Below the views:
  - **What SANT changed**: what the check found, each repair in words, and a before/after table (duration, path length, peak contact force, settle time);
  - the **variants**, each with footage and a badge. Clicking one puts it in the right view.
- **Live mode** (`?mode=live`) watches a running experiment:
  - the pipeline's stages (physics check → repair → multiply → train → evaluate) light up in order;
  - each demo's verdicts arrive;
  - every new variant pops in with its footage and badge.
- **Experiments shown.** `mouse20261020` (tonight's 10 mouse demos) and `human10c` (the 10 webcam demos) are featured. The store's other experiments (earlier attempts, the repair A/B runs) sit behind "Show all".

The numbers come from the stores, as they are:

| Experiment | Physics replay | Repaired | Variants verified | Trained policy |
|---|---|---|---|---|
| mouse20261020 | 10/10 passed | 10 (trim/smooth cleanups) | 100/100 | training was still running |
| human10c | 0/10 passed | 3 | 24/30 | 3/40 unseen scenes (`perfected_multiply_10`) |

The badges keep failed variants visible. Example: human10c demo 18:52:58 shows "6 of 10 verified", and the failed ones say why (e.g. "cube not in the bin").

## How
- **Backend** (read only), `src/app/routers/showcase.py`:
  - `GET /showcase/sets`, `/sets/{name}`: verdicts from the passports and the stage files.
  - `/sets/{name}/episodes/{id}?live=`: the twin's payload. It is shared with `/twin/episodes` via `twin.episode_payload`.
  - `/sets/{name}/footage/{id}`: frame metadata. The frames themselves come as one JPEG sprite sheet per clip, built with Pillow and cached in memory (a 404-step clip is 202 tiles, about 400 KB).
  - `/showcase/live/{name}`: server-sent events from `run.log` (parsed into pipeline events) plus new variant passports. `follow=false` sends what is there and ends.
  - A failed variant has `id: null` in the stage file, but its episode is kept under `<source>_m<seed>`, so it is shown.
- **`scripts/replay_experiment_store.py`** plays a finished experiment into a new data folder at its own pace, sped up:
  - files appear at their modification times, and `run.log` lines at their timestamps;
  - frames are **hard links** to the source (read them only; nothing writes them);
  - it refuses an existing destination.
- **Web** `web/src/site/data/`:
  - `model.ts`: views, verdict words, what changed, clock/sprite maths;
  - `liveFeed.ts`: a reducer for the live events;
  - `DataPage`, `Showcase`, `Pane`, `FootageView`, `LiveView`.

## Checked
- **Tests.** Python: 2044 passed, 15 skipped (new: `test_showcase_routes.py` 11, `test_replay_experiment_store.py` 3). Web: 1451 passed, 1 skipped (new: 18 in `site/data`). Typecheck and build pass.
- **Real stores.** Against `C:\dev\pm-t6\data` (read only): the sets list takes 0.09 s and a set's detail 0.08–0.16 s.
- **Live mode** against a replay of `mouse20261020` at 20× into `C:\dev\pm-t2\data\showcase-replay`:
  - the stages lit in order, all 100 variants popped in, and it ended on "Train running";
  - the replay runs slower than 20× because it links thousands of frames.
- **Phone and motion.** At 390×844, both modes work with no page overflow. Reduced motion doesn't autoplay (Play, 0.0 s).

## Not done / open
- **"Run SANT on this demo" (optional C):** not built. It would need the gpu.lock, a refusal while it's held, and a flag that is off by default.
- **The twin** is small and dark at this size; the sim camera reads better.
- **Live and repaired don't line up in time:** the repaired clip starts later, because it was trimmed.
- **Screenshots 06–07** were taken before the live view stopped showing the static summary line, so they show an older count ("40/40").
- **`data/showcase-replay/`** (gitignored) is left in place: its frames are hard links to pm-t6's store, so deleting it frees nothing.
- **Started by hand:** the backend needs `DATA_DIR` pointing at the data folder (e.g. `C:\dev\pm-t6\data`). The page runs on Vite at 5173 (the CORS allow-list).
