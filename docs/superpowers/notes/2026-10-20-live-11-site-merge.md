# pm/live-11: record-aids + the cloud's overnight site, 2026-10-20

The one branch the website terminals start from. On `pm/live-11` (`cef4033`: live-start, achieved-path,
robota-export, site-bench), in `C:\dev\pm-t7`. Nothing was pushed.

1. `pm/record-aids` (`b113bfe`, T6) → merge `ce2f954`.
2. `origin/claude/compassionate-cannon-u7cxjg` (`8923e6a`, the cloud's overnight site, based on PR #40 `4fd9c46`) →
   the merge commit after it.

Nothing from either side was dropped: every conflict below kept both sides.

## 1. pm/record-aids

Twin front/side/top views, alignment grid, L/R gauge; Stop & discard, Delete last demo; Keyboard|Mouse|Camera with
`Demo.input`; the camera fixes.

| File | Kind | Resolution |
|---|---|---|
| `sim_worker/teleop_session.py` | content | The saved `Demo` keeps achieved-path's `trajectory=achieved, commanded=commanded` **and** record-aids' `input=self.input`. |
| `sim_worker/human_exp.py` | content (import line) | `from demo_pipeline.schemas import INPUT_MODES, Demo, Scene, Trajectory` (record-aids needs `INPUT_MODES`, achieved-path's `achieved_demo` needs `Demo`). |
| `tests/test_dp_schemas.py` | content | Both tests kept (the `commanded` test and the `input` test). |
| `tests/test_run_human_demo_experiment.py` | content | Both sides' tests kept (achieved path, lookahead, `--sim-until`, empty cell; `--input` filter and old-config resume). |
| `scripts/run_human_demo_experiment.py` | clean | Checked by diff: achieved-path's replay path, `replay_lookahead`, `--sim-until` and empty-cell refusal **plus** record-aids' `select(..., input=)`, `--input` and the frozen `config["input"]`. Achieved-path's Neaten ops (`release_above_bin`, rules-emitted `recenter_grasp` in `repair.py`, `rules.py`, `diagnose.py`) are untouched by record-aids. |
| `src/demo_pipeline/schemas.py` | **silent** | Each branch added a `@model_serializer` to `Demo` (drop `input` when None / drop `commanded` when None). Pydantic keeps only the last one, so a demo without `input` dumped `"input": null` and changed its hash (`test_a_demo_without_input_serializes_as_before_the_field_existed` failed). Folded into one `_omit_absent_fields` that drops both. |

## 2. The cloud's overnight site

Dark-space intro round a glass SANT logo, ring → particles → materialize transition, the flicker fixes (spine-out
library, MSAA on low, soft rings), every page lazy (first load 498 → 343 KB), MediaPipe and the twin loaded on use,
phone hub bar, site-audit script.

**No textual conflict.** Two files were changed on both sides and auto-merged; both checked by hand:

- `web/src/hand/tracking/mediapipeTracker.ts`: the cloud's lazy `await import("@mediapipe/tasks-vision")` sits before
  achieved-path/live-start's `checkHandAssets` and `loadFailureMessage` catch; both run.
- `web/src/world/scene/cartridge.ts`: the cloud's `CARTRIDGE_HALF` / `libraryMatrix` (spine-out) next to site-bench's
  `subscribeSaved` redraw of the saved cartridges' label tiles.

**One silent conflict:** `web/src/world/stations/workbench/Editor.test.tsx` (T1's bench editor) imported `INTRO_VH`
from `../intro/storyline`, which the new intro deleted (tsc: TS2307). The same constant now lives in
`../intro/storyPlan`; the import was repointed. The test's scroll offset (`INTRO_VH + 3.8`) still reaches the hub
and opens the bench; it passes.

## Checks (on the final merge)

| Check | Result |
|---|---|
| `npx tsc -b` (web) | clean |
| `npm --prefix web test` | 148 files, 1304 passed, 1 skipped, 0 failed |
| `npm --prefix web run build` | OK (only the existing >500 kB `three` chunk notice) |
| `uv run pytest -q` | 1925 passed, 15 skipped, 0 failed |

Headless Chrome (real GPU, d3d11, CDP, no installs) against `vite preview` of the production build, 1440×900 and
390×844 @3x. No console errors or exceptions on any page (`report-world-record.json`, `report-routes.json`).
No Isaac or Blender was running.

| Shot (`2026-10-20-live-11-site-merge/`) | What it shows |
|---|---|
| `01-intro-hero.jpg`, `02-intro-beat.jpg` | the cloud's glass-logo intro and its S·A·N·T beat |
| `03-intro-transition.jpg` | the ring closing before the particles ("Into the workshop") |
| `04-hub.jpg` | the workshop hub: the spiral, shelf / machine / bench tags, Ask SANT; hub reached in 3.1 s |
| `05-bench.jpg`, `06-bench-named.jpg` | T1's workbench editor (name, look, robot, Save to the spiral, 0/4 saved); typing "Merge check" prints on the label |
| `07-record.jpg` | `/record`, the hologram Record with record-aids: Keyboard / Mouse / Camera, behind-the-robot + side + top views, align grid, `ee_target_y` L/R gauge; replay of `s1_0004_nemotron_m104003` |
| `08-phone-intro.jpg`, `09-phone-hub.jpg` | phone layout; the hub bar carries Shelf · Machine · Bench (the side tags clip at 390 px, as the cloud designed) |
| `10_site_results.jpg`, `10_review2.jpg` | #9's Results and #8's Review |
| `10_pm_review.jpg`, `10_pm_results.jpg`, `10_pm_dataset.jpg` | the WorkShell pages (01–04 nav) |
| `10_pm_record.jpg` | `/pm/record` redirects to `/record` |

## Not checked

- Saving a cartridge to the spiral in the browser (the editor's unit tests cover it); the shelf's and machine's
  click-throughs (the cloud's audit covers those); Stop & discard / Delete last demo and live driving (they need the
  backend, relay and sim).
- `docs/superpowers/notes/2026-10-19-merge-plan-site.md` was untracked in this worktree before the merge; left as it
  was, not committed.

## 3. pm/record-aids again (`96f432f`), after `91b3ef8`

T6's last commit: a click anywhere on the twin takes the mouse; "Save camera video" with each camera take
(`web/src/record/cameraTake.ts`, `PUT /demos/{id}/camera` → `demos/<id>/camera.webm` + `camera.json`).

**No conflict.** `web/src/hand/tracking/mediapipeTracker.ts` now has three sides' changes, all kept: the cloud's lazy
`await import("@mediapipe/tasks-vision")`, live-start's `checkHandAssets` / `loadFailureMessage`, and T6's
`stream()` (the camera stream the take records). MediaPipe is still imported only there and only dynamically, so the
cloud's lazy first load holds. `useRecordSession.ts` and `RecordConsole.test.tsx` auto-merged.

| Check | Result |
|---|---|
| `npx tsc -b` (web) | clean |
| `npm --prefix web test` | 149 files, 1332 passed, 1 skipped, 0 failed |
| `npm --prefix web run build` | OK (the same `three` chunk notice) |
| `uv run pytest -q` | 1941 passed, 15 skipped, 0 failed |

Not re-shot in Chrome (only Record changed; the click-to-take-the-mouse needs Pointer Lock, which headless Chrome
refuses, and the camera video needs a webcam).
