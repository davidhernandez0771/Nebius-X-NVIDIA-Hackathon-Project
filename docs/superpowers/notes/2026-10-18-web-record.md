# The new Record page (`/record`): the hologram design, fits the window

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

Open **http://localhost:5173/record**, or the old URL **http://localhost:5173/pm/record**, which now
redirects to `/record` (keeping `?trace`). Click **Start camera** in the middle of the camera pane.
The chips in the top bar turn teal as each part connects: `hand`, `relay`, `sim`. **record** starts
and stops a demo. Its timer is the sim's recorded time (steps × 20 ms), and the saved demo links to
Review in the `episode` cell. **Reset scene** and **Stop camera** sit in the camera pane's header while
the camera is on. The gear opens the settings drawer. `?trace` (latency trace) works as on the old page.

The old page is archived at **http://localhost:5173/legacy/pm/record**. Every other `/pm/*` path still
goes to `/legacy`.

Live test #8's checklist (`2026-10-15-t4-status.md`, "What to try in live test #8") applies to `/record`
as is. Both pages run the same session code.

## Setup

- `git merge pm/web-record-hud pm/web-landing` as one octopus merge stops on any conflict, so it aborted.
  I merged the two branches one after the other instead (`eafa17e`, `353f250`). It is the same result.
- `web/src/App.tsx` conflicted both times. I kept both sides' imports and routes: `/pm/hand-art` (hand
  v4) and `SantRoot` with `/site`, `/design`, `/site/record-hud` (T5, T7).

## The hologram rebuild (`5dd544f`, `80c97e0`)

The user approved `docs/design/prototypes/record-hologram.html` (in the main checkout, untracked there).
`/record` was rebuilt to match it. The earlier Volt rack version is described further down, as history.

| Commit | What |
|---|---|
| `5dd544f` | The page. `site/record/RecordConsole.tsx` runs the session hook, then `RecordView` lays it out. `instruments.tsx` has the twin, dial, gauge and trace, as SVGs drawn at their pane's pixel size. `twin.ts` holds the pure geometry and the twin's histories. `record-hologram.css` replaces `record-console.css`, and the drawer is restyled. |
| `80c97e0` | `/pm/record` → `/record`, an exact route ahead of T7's `/pm/*` → `/legacy` splat. T7's redirect test now uses `/pm/review?id=abc#top`. A new test covers `/pm/record?trace#top` → `/record?trace#top`. |

**What is on the page, and where its data comes from** (all from `useRecordSession`):
- **Cutting-mat grid and plug-in boot.** The panes draw in and one scanline sweeps, for 1.6 s. Skipped when
  motion is reduced (the OS setting, or SANT's effects off, through `useMotion`); the CSS turns it off too.
- **Top bar:**
  - **eject** (`⏏ workshop`) links to `/robots`, the robot shelf (T6's `pm/web-robots`). That route isn't on
    this branch, so until it merges the link falls through to `/site`.
  - **cartridge:** `FRANKA Franka Panda`. The live sink only takes `--robot franka` (Isaac Lab's Franka
    Panda), and the shelf uses the same code and name. The prototype's "FR3" was a placeholder.
  - **S/A/N/T rail:** S · show is the current step (`aria-current="step"`). The others are labels, not links.
  - **chips** `hand`, `relay`, `sim`. Details such as "not connected" are in the tooltip and read by screen
    readers.
  - **record** with its timer, and the gear.
- **Camera pane:**
  - corner brackets, and the 4:3 frame letterboxed as before;
  - the session's own stage drawing (dashed control region, hand bones, the orange hand dot) in hologram
    colours, plus the original hand-art overlay;
  - on top: captions (framing hints, hand lost, Reset fired), the reset ring, and the "sim isn't connected"
    notice with the sink command;
  - the footer shows the sim's last result and the camera's fps.
- **Robot twin:**
  - top view, seen from behind the robot like the operator: forward is up and the robot's left (+y) is on
    the left. So the dot moves the way the hand moves in the mirrored camera. It shows the workspace
    (dashed), the bin, the cube, the last 8 s of the target's path, and the target dot (orange while the
    gripper is closed);
  - side view: the target's height over the table, with a plumb line.

  The cube and bin are the sink's fixed scene (`teleop_sink.py` `base_scene`: cube at 0.50, 0; bin at 0.50,
  0.30; sizes from `scene_cfg.py`). The sim doesn't stream the cube's pose, so the twin shows where the
  cube starts, not where it is after you move it.
- **Gripper dial:** the orange needle is the pinch gap (what hand v4's latch reads), with marks where the
  latch closes (below 0.25) and opens (above 0.50). The big word is the gripper actually sent (open or closed).
- **Height gauge:** the target's z on a 10-step scale of the workspace's z range (0.02–0.40 m), with the
  value in large type underneath.
- **Bottom strip:**
  - trace: height in teal and reach in ink over the last 8 s, with orange ticks while the gripper is closed;
  - `ee_x` and `ee_y`;
  - `recorded`: demos saved during this visit (distinct `demo_id`s in `sim_status`). The timer shows the
    recorded time;
  - `episode`: camera off, starting, tracking, no hand, recording or paused, plus the Review link.
- **Drawer:** the same groups and rules as before (control region, reach, Calibrate by hand, display, debug
  trace, Reset to defaults). It is titled "Hand control" and is 400 px wide; its slide-in is skipped when
  motion is reduced.

**Hand control is unchanged.**
- Nothing changed in `web/src/record/teleop/`, `framing`, `recordLink`, the hand art or `web/src/hand/`.
  The tracking module wasn't touched: T4 has it, for the hand-lock change.
- The one change in shared code: `useRecordSession` adds an optional, display-only `fps` to its ~10 Hz pose
  update.
- All tests in `record/` and `legacy/pm/record/` are unchanged and pass.

**Other files touched:**
- `web/index.html`: IBM Plex Mono added to the Google Fonts link (the prototype's typeface).
- The page now sits outside `AppShell`, because the prototype has no nav. Inside `.rg`, the old app's global
  `button` rule (44 px pills, press scale) is reset.

### Fit to the window: verified

Same method as before: `/record` in an iframe of exactly 1280×720, 1440×900 and 1920×1080 (the Chrome
window here can't be resized). At each size:
- `document.scrollingElement.scrollHeight <= innerHeight` (and the same for width);
- none of these elements has `scrollHeight > clientHeight + 1` or `scrollWidth > clientWidth + 1`: the top
  bar and its groups, the stage, panes, side column, bottom strip and cells, the pane headers, the camera
  footer, the notice, and the drawer panel and its groups.

**Results**, checked after the 1.6 s boot. "Real" is the real page with the camera off; "stand-in" is a
temporary page fed synthetic poses while recording:

| Window | scrollHeight | Overflowing (real / stand-in) | Camera pane | 4:3 frame |
|---|---|---|---|---|
| 1280×720 | 720 | 0 / 0 | 788×549 | 647×486 |
| 1440×900 | 900 | 0 / 0 | 890×729 | 864×648 |
| 1920×1080 | 1080 | 0 / 0 | 1195×909 | 1127×846 |

- **Drawer worst case at 720 px tall:** 0 overflowing, about 26 px to spare. I checked it on the stand-in,
  with this content:
  - Calibrate by hand running its longest step;
  - re-centering;
  - a finished trace's download line;
  - the "Reset fired (not sent…)" caption and the sim notice behind the drawer.
- **The stand-in** was a temporary local page: `RecordView` with a fake session object, drawing a moving
  synthetic hand through the real `drawStage`. It was deleted and not committed. It has no WebGL hand art,
  so its screenshots show the bones fallback.
- **In Chrome:**
  - `/pm/record?trace` lands on `/record?trace`;
  - `/legacy/pm/record` still loads the old page, with its Hand control;
  - the console shows no errors on `/record`.

Screenshots (`2026-10-18-web-record/`):
- `hologram-1280x720-camera-off.png`: the real page;
- `hologram-1280x720.png`, `hologram-1440x900.png`, `hologram-1920x1080.png`: the stand-in, recording;
- `hologram-1280x720-settings-no-sim.png`: the drawer's worst case, over the "sim isn't connected" state.

The previous version's `record-*.jpg` screenshots were removed (they are in git history).

### Tests

- `npm --prefix web test`: **750 passed, 0 failed** (61 files).
  - **New:**
    - `twin.test.ts`, 7 tests: view orientation, fitBox, trace anchoring, the twin's histories;
    - 4 in `RecordConsole.test.tsx`: eject, cartridge and rail; the boot runs, then is gone; the boot is
      skipped with effects off; the instruments are empty until a hand is tracked;
    - 1 in `App.test.tsx`: `/pm/record` → `/record`.
  - **Changed (page tests only):**
    - `RecordConsole.test.tsx` follows the new labels: the `sim` chip, `ee_x`, open/closed, the twin instead
      of the palm pad, the drawer's "Hand control". The `recorded` cell now counts demos, so the recording
      test checks the episode cell instead.
    - `App.test.tsx`'s `/pm/*` redirect test uses `/pm/review`.
  - No hand-control test changed.
- `npm --prefix web run build`: OK (only the existing three.js chunk-size warning).
- `uv run pytest`: not rerun, because no Python changed since `a32d5c3` (1534 passed, 18 skipped, 0 failed).

### Open

- **No live run with a webcam and Isaac** (no GPU, and no camera prompts during automation). Live test #8
  on `/record` (or `/pm/record`) is the real check, including the WebGL hand art inside the new frame.
- **Eject** goes to `/site` until `pm/web-robots`'s `/robots` route is merged.
- **Live cube position** would need the sink to add the cube's pose to `sim_status`.
- **No sim video** (unchanged: the sim draws in Isaac's Kit window).
- **`pm/hand-lock`** (T4) branched from `4d3f3b4`, before this rebuild. It edits only the tracking module,
  which this work doesn't touch, so the two should merge cleanly.

## Earlier version: the Volt rack (replaced by the hologram)

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

### Fit to the window (Volt rack version)

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

Screenshots (removed with the rebuild, still in git history before `5dd544f`):
`2026-10-18-web-record/record-1280x720.jpg`, `record-1440x900.jpg`, `record-1920x1080.jpg`,
`record-1280x720-settings.jpg`.

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
