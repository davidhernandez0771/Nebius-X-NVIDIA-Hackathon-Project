# Overnight plan (2026-10-28): finish the flow and show the metrics

Branch `susana/nemotron-failure-analyst`, **nothing committed or pushed**. David's `perfect-then-multiply` (PR #45, the 3D
site work) is merged in with `--no-commit`. The README conflict was resolved by taking David's README and re-adding the
analyst parts.

## State at the start

- Python: 2876 passed. The 6 known failures are Windows-only checks plus Apple-silicon float differences.
- Web: `npm ci` fixed the missing `urdf-loader`, and `tsc -b` is clean.
  - **On this Mac's Node 26**, 275 web tests fail on `localStorage` (Node's own web storage shadows jsdom's).
  - With `NODE_OPTIONS=--no-experimental-webstorage npx vitest run`, all 2088 pass. This is not a code problem.
- New pinned packages: `@react-three/postprocessing@2.16.3`, `postprocessing@6.36.4` (bloom/lighting for the 3D metrics).

## Work, in parallel

| Owner | What | Files |
|---|---|---|
| Agent A | `/metrics`: every pre-registered number as a lit 3D scene (bloom, area lights, soft shadows) with accessible 2D charts and a no-WebGL fallback | `web/src/site/metrics/**` |
| Agent B | The closed loop: `scripts/sant_loop.py` (eval → Nemotron recipe → recipe arm vs uniform control → eval → Fisher), `GET /flow`, and the `/flow` page | `src/demo_pipeline/loop.py`, `scripts/sant_loop.py`, `src/app/routers/flow.py`, `src/app/main.py`, `web/src/site/flow/**`, their tests |
| Agent C | Wiring and docs: routes and nav for `/metrics` and `/flow`, `/analysis` in David's page shell, the Devpost draft, the README, the runbook | `web/src/App.tsx`, `web/src/site/holo/*`, `docs/**`, `README.md` |
| Lead | Final checks: Python and web tests, `npm run build`, screenshots at desktop and phone width, the security review, and this note's results | – |

## What can't be done here

- **No training or Isaac runs:** no NVIDIA GPU on this Mac. Every GPU step is a command in the GPU runbook for David.

## Results

### Built

- **`/metrics`** (`web/src/site/metrics/`):
  - **3D results hall:** one glowing pillar per pre-registered test, with Wilson sleeves and a 60% goal plane. Lighting is procedural Lightformers (nothing downloaded), with bloom and ACES tone mapping, and it renders on demand.
  - **2D sections:** the climb, the RL teacher with vs without demos, Stage A selection, "what this does not show", and the Nemotron strip.
  - **Fallbacks:** no WebGL, phone width and reduced motion.
  - **Sources:** every number comes from `proofData`/`results.json` or the `/analysis` API.
- **`/flow`** (`web/src/site/flow/`, `GET /flow`):
  - **Stages:** the 10 stages from Record to Recipe, each with its real number, a source note and a link to the page that shows it.
  - **Loop:** the loop's live state is shown from `DATA_DIR/loops/*/loop.json`.
  - **Checked against the notes:** every cited number is tested against the exact text of its note.
- **The closed loop** (`src/demo_pipeline/loop.py`, `scripts/sant_loop.py`):
  - **Stages:** diagnose → freeze (preregistration written first) → recipe arm and uniform control → eval both on the same fresh seeds → compare.
  - **Behaviour:** resumable, `--dry-run`, and a seed guard.
  - **Decision rule (settled 10-28):** two-sided Fisher at p ≤ 0.05, with the recipe arm ahead. This matches runbook (c) and the project's other pre-registered comparisons. The one-sided p is reported as secondary.
- **Wiring:** routes and the More nav (Analyst, Metrics, Flow), with route tests. `/analysis` already used David's HoloPage shell; it got focus rings and wraps on phones.
- **Docs:**
  - our Devpost text merged into David's `docs/submission/2026-10-26-devpost-draft.md`, and the duplicate `docs/devpost.md` deleted;
  - README updated;
  - GPU runbook: the closed-loop command and the Node 26 test note.
- **Lead fixes after review:**
  - the `/metrics` and `/flow` headlines no longer say the robot was "taught from" the demos alone (it went through SANT and an RL teacher);
  - `/flow` cards align;
  - `/analysis` no longer scrolls sideways on phones.

### Checks (all run on this Mac, 2026-10-28)

| Check | Result |
|---|---|
| `uv run pytest -q` | 2930 passed, 73 skipped, 6 failed (the 6 known: `test_launch_health` ×2, `test_set_v2_is_frozen`, `test_sim_homeset` ×3) |
| `npx tsc -b` (web) | clean |
| `NODE_OPTIONS=--no-experimental-webstorage npx vitest run` | 241 files, 2131 passed, 1 skipped |
| `npm run build` | builds (only the existing chunk-size warning) |
| Headless Chrome, `/flow`, `/analysis`, `/metrics` at 1400 px and 390 px, real backend | renders, no console errors, no sideways scroll |
| Security review of the new code (subprocess, routers, React, the pinned packages) | no findings at confidence ≥ 7 |

### Not done

- **The loop has never run on Isaac.** No GPU here. David starts with `--dry-run`, then `--smoke` (runbook, "the closed loop").
- **The traces of the big test's failures** (`bigtest_final_traces`) are still only on David's machine.
- **The 3D hall has no per-GPU quality tiers:** it is either on, or replaced by the 2D charts.

## 2026-10-29: submission pass (no David needed)

- **Math:** `scripts/audit_numbers.py` recomputes every stated number from the raw result files (0 mismatches now).
  - It found and fixed 6 labeling or rounding slips, e.g. one-sided p-values not labelled, McNemar named as Fisher, $0.043 vs $0.042, and 3 of 5 checkpoints, not 4.
  - No pre-registered result changed. Details: `2026-10-29-math-audit.md`.
- **Security:** no secret was ever committed (full history scanned), so nothing needs rotating.
  - New origin guard: browser writes from other sites get 403, on both the API and the sim worker.
  - `nosniff` header on every response; `.gitignore` hardened.
  - `npm audit`: 2 moderate issues in react-router, neither reachable.
  - Personal Windows paths in notes are redacted. Some committed Blender renders and the `.blend` file still carry a Windows path in their metadata, and git history keeps the old text either way.
  - Details: `2026-10-29-security.md`.
- **Caching:**
  - All 5 analysis sources have a Nemotron run (new spend $0.096). The runs are committed as snapshots under `2026-10-23-bigtest/results/analysis/`, so a fresh deploy shows them with no paid call.
  - The GET endpoints send ETags and answer 304 when nothing changed.
  - The web client keeps each analysis load for the session.
- **Cleanup:**
  - Ruff fixes in our modules.
  - Removed duplicated helpers: the Wilson CI and the episode-log reader each live in one place now.
  - The 3D hall stays lazy-loaded; the only chunk over 500 kB is three.js itself.
- **Checks:**
  - Python: 2951 passed, 73 skipped, plus the 6 known environment failures.
  - Web: `tsc` clean, 2134 passed, the build works.
  - Real browser: `/flow`, `/analysis` and `/metrics` at 1400 and 390 px, no errors, no sideways scroll; a cross-origin POST gets 403.

## 2026-10-29: Results and home page polish

- **Results page (`/site/results`)** now wears the work pages' holo look (dark void, teal grid), so it no longer drops from the 3D home into a beige document. `StoryShell` takes `mode="volt"`; other story pages stay paper.
- **New lead picture:** the big test itself, one cell per scene (seeds 5400–5439), lit with the simulated seconds it took or marked "drop". Data: `web/src/site/results/scenes.json`, written by `scripts/build_scene_grid.py` from the committed raw episode log. Tests check it matches the log and the page's 30/40 and failed seeds.
- **New number:** the 30 successes took a median 8.2 s of simulated time (7.0–9.5 s; the sim records the finish in 0.5 s steps).
- **Home hero:** the "See the result" link now carries a 40-cell strip of the same test, lit in order.
- Checks: web 243 files, 2139 tests pass; `tsc` clean; build OK; Python grid tests pass; both pages render at 1400 and 390 px with no errors and no sideways scroll.

## 2026-10-29: W&B results report, submission check

- **`scripts/wandb_report.py`**: logs the committed results to one W&B run: the final test per scene, Stage A/B checkpoint selection, every pre-registered comparison with Wilson CI and p, the RL teacher's curve, and a summary. Dry run by default; `--upload` needs `uv run --with wandb` and a `wandb login`.
  - Every number is recomputed from the raw logs or the counts the notes state (cited lines checked); `tests/test_wandb_report.py`.
  - By default W&B would upload the hostname, home-folder paths and the git commit. All of it is turned off, and an offline run was checked to carry none of it.
- **Submission check:**
  - **Blocker:** `origin/main` (the repo's default branch) is still at 2026-10-17 (PR #32). Judges see that unless this branch and `perfect-then-multiply` are merged into `main` before the deadline.
  - Still open: the video (required), the Devpost TODO (USER) fields, and the Token Factory billing check.
  - The README gaps the draft listed (Token Factory acceleration, Nebius tools used, the NVIDIA stack, the model list) are fixed.
