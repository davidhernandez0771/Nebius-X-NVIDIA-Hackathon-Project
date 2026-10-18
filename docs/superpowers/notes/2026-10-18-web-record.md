# The new Record page (`/record`), Volt look, fits the window

Branch `pm/web-record`, from `pm/hand-v4` (ef539f7), with `pm/web-record-hud` (T7), `pm/web-landing`
(T5) and `pm/remove-room-organizer` (T7's `/legacy` archive) merged in locally. Nothing pushed, merged
on GitHub or rebased.

## How the live test opens `/record`

From `C:\dev\pm-t6` (this branch has hand v4's `demo_pipeline`, so the sink accepts `grip`):

```
$env:PYTHONPATH="C:\dev\pm-t6\src"
C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\teleop_sink.py --viz kit
uv run uvicorn app.main:app --reload --app-dir src
npm --prefix web run dev
```

Open **http://localhost:5173/record** and click **Start camera** (title row, or the middle of the camera
tile). The chips turn teal as each part connects: `hand_track`, `relay`, `sim_link`. **Record** starts
and stops a demo. Its timer is the sim's recorded time (steps × 20 ms), and the saved demo links to
Review in the `episode` tile. **Settings** opens the drawer. `?trace` (latency trace) works here as it
does on the old page.

The old page is archived at **http://localhost:5173/legacy/pm/record**. `/pm/record` still works,
because T7's `/pm/*` redirect sends it there. Keep the old page until the user approves `/record`.

Live test #8's checklist (`2026-10-15-t4-status.md`, "What to try in live test #8") applies to `/record`
as is. Both pages run the same session code.

## Setup

- `git merge pm/web-record-hud pm/web-landing` as one octopus merge stops on any conflict, so it aborted.
  I merged the two branches one after the other instead (`eafa17e`, `353f250`). It is the same result.
- `web/src/App.tsx` conflicted both times. I kept both sides' imports and routes: `/pm/hand-art` (hand
  v4) and `SantRoot` with `/site`, `/design`, `/site/record-hud` (T5, T7).

## What was built

The table names paths from before the merge with T7's archive. Today's paths are listed under
"Merge with T7's archive" below.

| Commit | What |
|---|---|
| `548e7ef` | `pm/record/useRecordSession.ts`: the teleop session moved out of `RecordPage.tsx` unchanged, and the canvas drawing to `stageDraw.ts`. `/pm/record` renders exactly as before. `RecordPage.test.tsx` is unchanged and passes. A diff of the moved code against the original shows only two additions: an optional canvas palette (unset = the old CSS tokens) and the landmarks on the ~10 Hz pose update. Both are display only. |
| `e0d20ef` | `site/record/`: the page (`RecordConsole.tsx`), the settings drawer (`RecordSettings.tsx`), the live rack model (`liveHud.ts`), the fit-to-window CSS, and 21 tests. Also the `/record` route, and `/record` marked as a Volt page. |

- **Layout:** T5's `AppShell` (nav, then the title row), and T7's tiles in the record-console prototype's
  arrangement. The camera tile is on the left. On the right: `palm_xy` and `gripper_cmd`, then the wide
  `ee_target_z` trace, then six channels.
- **The camera view is the largest area.** There is no sim video in the browser: the sim draws in Isaac's
  own Kit window (`--viz kit`), and the relay only sends `sim_status`. So the camera tile holds the
  page's view of the hand. That is a 4:3 stage with the original hand art and the control-region drawing,
  letterboxed in the tile. A sim view would need a new stream from the sink and is not built.
- **Same teleop behavior:** simple pinch, the reset gesture with its ring and "Reset fired" toast,
  original hand art, control region, break-through, reach centering, Calibrate by hand, debug trace.
  It all comes from `useRecordSession`.
- **The rack shows what is sent.** T7's `stepHud` works the gripper out from the sim's old
  `pinch_ratio` latch (0.35 / 0.45). Hand v4 latches the pinch gap in the browser and sends that as
  `grip`. So `liveHud.ts` uses T7's `toTarget` for the target, and the session's own gripper and pinch
  gap. The knob marks hand v4's thresholds, 0.25 and 0.50.
- **Compact top row:** status chips, Start/Stop camera, Reset scene, Record with its timer, and Settings.
- **Settings drawer** (slide-over, Esc closes, focus returns to Settings):
  - control region on/off, region size, vertical position;
  - depth far/near, 3D reach, re-center reach;
  - Calibrate by hand;
  - hand art, invert axes;
  - debug trace and Reset to defaults.

  The settings rules are the same as in the old `HandControlPanel`, which now exports its slider bounds.
- **No old floating Hand control or gear:** `/record` is listed as Volt in `sant/motion/crossing.ts`, so
  `App.tsx` hides them and turns the app-wide hand cursor off. That cursor's camera would otherwise
  compete with Record's tracker.

## Fit to the window: verified

**How it was checked.** Chrome's window here can't be resized (it stays maximized at 2048×962). So
`/record` was loaded in an iframe of exactly 1280×720, 1440×900 and 1920×1080. Inside the iframe,
`innerWidth`, `innerHeight` and `100dvh` are exactly those sizes. At each size the check was:
- `document.scrollingElement.scrollHeight <= innerHeight` (and the same for width);
- that no shell, nav, title row, rack, tile, instrument, trace, drawer group or drawer panel has
  `scrollHeight > clientHeight + 1` or `scrollWidth > clientWidth + 1`.

**Results** (drawer closed and open):

| Window | scrollHeight | Overflowing panels (closed / open) | Camera tile | 4:3 stage |
|---|---|---|---|---|
| 1280×720 | 720 | 0 / 0 | 763×584 | 699×524 |
| 1440×900 | 900 | 0 / 0 | 862×764 | 840×630 |
| 1920×1080 | 1080 | 0 / 0 | 1157×944 | 1135×851 |

- **Drawer worst case at 720 px tall:** Calibrate by hand running (its longest step text), re-centering,
  and a finished trace's download line. I injected exactly that content. It fits with 14 px to spare.
- **Live-only overlays:** the "sim isn't connected" notice with the command, the framing and "Reset fired"
  captions, and the reset ring are absolutely positioned, so they can't change the fit. I injected
  their markup to check that they read well and don't overflow.

Screenshots: `2026-10-18-web-record/record-1280x720.jpg`, `record-1440x900.jpg`, `record-1920x1080.jpg`,
`record-1280x720-settings.jpg`. The larger sizes are scaled into the screenshot; their layout is at the
full size.

Below 960 px wide the rack stacks and the page scrolls. That size was not part of the rule.

## Tests

- `npm --prefix web test`: **720 passed, 0 failed** (59 files). Before this work: 698 on the merged base.
  The 22 new tests: 21 in `site/record/` and 1 in `crossing.test.ts`. No existing test was changed.
- `npm --prefix web run build`: OK. The only warning is the existing three.js chunk over 500 kB.
- `uv run pytest`: not run, because no Python changed.

## Not done / open

- **No live run with a webcam and Isaac.** I didn't start the camera or the sim (no GPU, and no camera
  prompts during automation). The session code is the tested `/pm/record` code. The new page's wiring
  is covered by tests with a fake tracker and link. The streaming-state look was checked with injected
  markup only. Live test #8 on `/record` is the real check, including the hand art's WebGL overlay in
  the new stage.
- **No sim video tile** (see above). It needs a new stream from the sink if wanted.
- **Changes in other tracks' files (all additive):**
  - T7: `GripKnob` got `thresholds`, `HeightTraceTile` got `capacity` (defaults unchanged, T7's tests pass).
  - T5: one route regex in `crossing.ts`.
- **The page switch is the user's call.** Retire `/pm/record` and point the old nav at `/record` only
  after the user approves it.

## Merge with T7's archive (`a32d5c3`)

`git merge pm/remove-room-organizer`. T7 had moved the old pages into `web/src/legacy/`, including
`pm/record/RecordPage` and `HandControlPanel`, which `/record` shares code with. T7's branch starts from
`pm/web-landing`, so its copy of those files was the version from before hand v4.

**One copy of the live code, in `web/src/record/`.** Both `/record` and `/legacy/pm/record` import from it:

| Now | Was |
|---|---|
| `record/useRecordSession.ts`, `stageDraw.ts`, `framing.ts`, `recordLink.ts`, `artCue.ts`, `breakthroughCue.ts`, `ResetGestureRing.tsx` (+ tests) | `pm/record/` |
| `record/handArt/` (overlay, preview page, renderer, tests) | `pm/handArt/` |
| `record/teleop/` (pinch, reset gesture, V sign, control region, reach3d, debug trace, message, client, fixtures) | `web/src/teleop/` |
| `record/controlSettings.ts` (slider ranges, Calibrate-by-hand prompts) | constants in `HandControlPanel.tsx` |

- **Moves:** all are `git mv` renames, and import paths were rewritten by a script that resolves each
  import from the file's old place. The hand-art files are byte-identical (same folder depth).
- **The archived files:** `legacy/pm/record/{RecordPage,RecordPage.test,HandControlPanel}` are hand v4's
  versions from this branch. They carry T7's `/legacy` prefixes: `renderAt("/legacy/pm/record", …)`,
  and the Review link plus its expected `href`. Everything else changed is an import path; the diff
  was checked against this branch's versions.
- **`App.tsx`:**
  - T7's `/legacy` routes, the `/pm/*` → `/legacy/pm/*` redirect, and the hand controls shown only on
    `/legacy`;
  - plus `/record`, `/site/record-hud`, and hand v4's `/pm/hand-art` preview. That preview is an exact
    route, so React Router picks it ahead of the `/pm/*` redirect.
- **`/record`'s links:** Review and Dataset now go straight to `/legacy/pm/...`.
- **Python:** `tests/test_dp_teleop.py` reads the `HandPoseMsg` fixture from
  `web/src/record/teleop/__fixtures__/`, and the test passes. Path comments were updated in `teleop.py`,
  the record-hud fixture script and its `about` string.

**Checks after the merge:**
- `npm --prefix web test`: **738 passed, 0 failed** (60 files; T7's 18 route tests included).
- `npm --prefix web run build`: OK.
- `uv run pytest -q`: **1534 passed, 18 skipped, 0 failed**.
- In Chrome (dev server):
  - `/record` loads and still fits at 1280×720, 1440×900 and 1920×1080 (scrollHeight = innerHeight,
    0 panels overflowing).
  - `/legacy/pm/record` loads the old page, with its Hand control.
  - `/pm/record` and `/pm/review?id=abc` redirect to `/legacy/...`, keeping the query.
  - `/site/record-hud` and `/pm/hand-art` load.

**For the lead (merging other branches):**
- **Paths that no longer exist:** branches that import `pm/record/framing`, `pm/record/recordLink`,
  `pm/handArt` or `web/src/teleop/...` need the new `record/...` paths. T7's note expected the sprint 9
  pages' `pm/record/framing` import to keep working; it moved here. `pm/live-8` (T4) edits
  `web/src/teleop/` and `pm/record/`, and those edits now belong in `web/src/record/`.
- **Left behind on disk:** an empty `web/src/teleop/__fixtures__/` folder (git ignores it). A dev server
  I started held it open. I wasn't allowed to stop those processes, and stopping their shells didn't
  end them. Leftover node/esbuild processes from this worktree: Vite on port 5180 (PIDs 51148, 44864,
  51704) and on 5181 (PIDs 12308, 44340, 49336). Stop them, then delete the folder.
