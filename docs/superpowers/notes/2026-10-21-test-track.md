# The test track (/test-track): replays of runs Isaac already recorded

2026-10-21, T5, branch `pm/test-track` from pm/live-13 7637481, plus T1's holo commits (2bb9484, 2bd1fd9 and 96699c6), cherry-picked here as 0ae21c2, 0f44435 and f88edcc. Never pushed.

**What it is.** The lead's option A, after Pollen's Microduck simulator: a clean arena with an orbit camera, keyboard shortcuts and a boot console. It replays simulations that already ran; it never runs physics in the browser. Every joint angle, gripper state and recorded cube position comes from the run's own files, and the verdict is SANT's.

## Data: a static build script (no backend)

`scripts/build_test_track.py` reads the runs (read only) and writes compact JSON to `web/public/test-track-data`. That keeps the page static, like the Results page's `build_site_results.py`, so it works without the API.

```
uv run --no-sync python scripts/build_test_track.py            # rebuild (defaults: T3's and T6's folders below)
uv run --no-sync python scripts/build_test_track.py --check-estimate   # measure the round-0 cube estimate; writes nothing
```

| source | folder | runs | verdict on the page |
|---|---|---|---|
| Teacher · gate 2 | `C:\dev\pm-t3\data\rl\eval\v6c2_gate2` | 50 replays, seeds 5350–5399 | 50/50, SANT replay (verify.json), Wilson 93–100% |
| Teacher · replay check | `...\v6c2_replaycheck_7000` | 32 replays, seeds 7000–7031 | 32/32 |
| Distillation · round 0 | `C:\dev\pm-t6\data\distill\distill_mouse\r0` | 300 rollouts: 295 replays + 5 failures listed | 295/300 (Wilson computed: 96–99%) |
| Camera robot · eval | — | shown as "hasn't run yet", disabled | — |

- **Output:** `index.json` (93 KB: sources, summary, every run's verdict and facts) and one `runs/<source>/<seed>.json` per replay (about 12–14 KB, 4 decimals). In all that's 378 files, 5.6 MB, loaded one run at a time.
- **Shape:** each run file is the twin's episode payload (`app.routers.twin`), so the page uses `twin/replay.ts parseEpisode` as is. It adds `cube_source`, `contact_n` (the arm's contact force per step, gate and replay check only) and `facts` (success, reasons, duration, hand path, peak contact, settle time).
- **Failed rollouts:** round 0's 5 failed rollouts saved no episode (2 dropped, 3 collision, all at the time limit). They are listed with their reasons and step count, with no replay.

**The cube in round 0 is ESTIMATED, and the page says so.** T6's round-0 episodes record the arm (joint_pos, ee_pos, gripper) and the cameras, but not the cube. The lead's brief assumed cube poses were recorded; they aren't.
- The script draws round 0's cube from the gripper: it stays put until the gripper closes within 5 cm of it, then keeps its offset to the gripper, then falls straight down when the gripper opens (to z 0.035 in the bin, which is where all 82 recorded runs end, or to the table).
- Measured against the 82 gate and replay-check runs that recorded both, the estimate is off by:
  - while carried: median 13.9 mm (p95 24.5 mm);
  - where it lands: median 28.0 mm (max 61 mm), because the real cube slides in the bin.
- These numbers sit in `index.json` (`cube_estimate`), and the page shows them as an amber note on every round-0 run. The "Cube path" tag reads "estimated from the gripper" there and "recorded by Isaac" on the gate runs.
- No run recorded the cube's rotation. It keeps the scene's start orientation, as in the twin.

## The page

`web/src/site/testtrack/`:
- `model.ts`: parsing, the clock, keys and words, all pure.
- `api.ts`: static fetches, cached.
- `TestTrackPage.tsx` and `testtrack.css`.
- The route `/test-track` is in `App.tsx`. The frame is T1's `<HoloPage here="test-track">`, with "Test track" in the More nav.

- **Left (holo panel):**
  - the source picker (keys 1–3), with the summary and its Wilson interval;
  - what the source is, and the checkpoint;
  - a grid of every run by seed: teal for pass, orange for fail, a dashed border where no replay was saved.
- **Arena:** the existing robot twin (`RobotTwin`: URDF Franka, cube and bin on the cutting mat, orbit by drag and zoom by scroll or pinch). Its one new prop, `viewKey`, puts the camera back (R).
- **Holo tags over the arena (top right):**
  - SANT's verdict: "In the bin · verified" or "Failed · dropped the cube, stopped at the time limit";
  - on the gate runs, the teacher's own in-env check and whether the replay agrees;
  - then time, peak arm contact, hand path, cube settle time, the cube path's source, and the arm's contact force at the current step (gate and replay check only).
- **Transport:** play/pause, a scrubber, time, speed 0.25–4×, previous/next run, reset view. Playback loops with a 1.2 s hold on the last step.
- **Keyboard:**
  - Space: play/pause.
  - ←/→: step (Shift: 10).
  - [ ]: speed.
  - J/K: previous/next run.
  - 1–3: source.
  - R: reset the view.
  - ?: help.
  - Esc: close.
  - Keys typed into a field, Space on a button and Ctrl/Alt/Meta combinations are left alone.
- **Boot console:** shows while the index or a run loads; `?boot=1` keeps it up. URL state is `?source=&run=`.
- **Reduced motion:** the replay starts paused. Phones (under 760 px): one column, with the arena first and the tags under it.

## Checks

- pytest `tests/test_build_test_track.py`: 8 pass (tiny fake runs: twin shape, recorded vs estimated cube, failed rollouts listed without a file, estimate geometry, Wilson, main skipping a missing source).
- vitest `src/site/testtrack`: 21 pass (model 13, page 8); twin, holo and App: 105 pass.
- Full suites:
  - web vitest: 1821 passed, 2 skipped (201 files);
  - pytest without tests/test_launch_health.py: 2591 passed, 30 skipped;
  - tsc and vite build pass. The page's chunk is 19 KB JS + 14 KB CSS, and dist carries test-track-data (5.6 MB).
- **Headless Chrome on SwiftShader** (17:35+, no GPU), with the dev server on 127.0.0.1:5193 and screenshots in `2026-10-21-test-track/`:
  - **Desktop 1280x720, reduced motion** (so the replay starts paused and Shift+→ steps land on a known step):
    - `01` gate seed 5350, carrying at step 71;
    - `02` the keyboard help (?);
    - `03` round 0 seed 4000 with the estimated cube and its note;
    - `04` round 0 seed 4022: failed, no replay;
    - `05` the replay check with `?boot=1`.
  - **Phone 390x844:**
    - `06` the arena, then the controls, then the tags;
    - `07` the run grid;
    - `08` round 0's tags and estimate note.
  - **In-page audit:**
    - no contrast failures and no unnamed controls on desktop or phone;
    - the only text under 12 px is T1's holo tags and nav and the twin's caption;
    - no horizontal scroll at 390 px;
    - no console errors (only React Router's future-flag warnings).
  - **Playback without reduced motion:** seed 5360 went from step 37 to 114 in 1.5 s (real time at 50 Hz), K moved to seed 5361 from the start, and 3 switched to round 0.
- **Fixes found in the browser:**
  - `.sant button` (sant.css) resets every button's font and padding and outranks one class, so the page's buttons are scoped under `.tt`. The Keys button in the top strip is scoped under `.holo-top`.
  - styles.css halves every disabled button's opacity, which put the "Camera robot · eval" entry at 2.65:1, so that entry keeps full opacity.
  - The data folder was first `public/test-track`, the route's own path, which a static host could serve as a folder instead of the page. It is now `public/test-track-data`.

## Polish pass (the lead, 18:00): light, framing, paths

The lead found shot 01 too dark: the robot read almost black, and the camera was too close (the operator's view from behind the arm). Three fixes:

1. **Light and paint:** a "studio" look on the twin. There's no shared lighting rig: the robots page (ShelfScene) and the setup preview each light their own scene.
   - The robot gets the Franka's own paint: white links, a dark wrist flange and dark fingers (`twin/looks.ts studioTone`, per link, since the twin draws one mesh per link).
   - Lights: a warm key over the camera's shoulder, a cool fill, a teal rim from behind the arm, and a brighter hemisphere.
   - The scene: the sim's red cube and blue bin, a lighter table, edges down to a whisper.
   - The gripper still turns orange while closed.
   - It's opt-in: `<RobotTwin look="studio">`. /record and /data keep the hologram look, which is the default.
2. **Framing:** `framePoints` gives a wide camera (`looks.ts frameScene`).
   - It frames the robot (base and height), the bin, the cube's path and the hand's path.
   - It looks from the robot's front left, raised, so the arm doesn't stand between the camera and the cube or the bin.
   - It steps back for narrow panes (phones).
   - The frame is computed once per run, so playback never moves the camera. R puts it back.
3. **Paths:** `trails` draws each path faintly in full and brightly up to the current step.
   - The hand path (teal) is the tool point Isaac recorded (steps.npz `ee_pos`, now `hand_pos` in each run file, 3 decimals; the data went from 5.6 to 7.0 MB).
   - The cube path (red-orange) is dashed where it's estimated (round 0).
   - The Paths button or T shows or hides them.

"Follow the cube" was optional and isn't built. Perf: the trails are 4 lines per run; frameloop stays "demand", and only the bright line's draw range changes per step.

Checks after the pass:
- web vitest 1828 passed, 2 skipped (looks.ts +5 tests; the page +2: studio, frame and trails, T, and dashed for estimated);
- `test_build_test_track.py` 8 pass (hand_pos checked);
- tsc and vite build pass;
- shots 01–08 retaken under the same names (SwiftShader): no contrast failures, no unnamed controls, no horizontal scroll at 390.

One race came up under full-suite load: the round-0 estimate note waited for the run file, while its tag came from the index. Both now come from the index.

## Not done

- No Isaac camera footage: the round-0 front and wrist frames are about 1 GB, too big for a static page. /data shows footage through the API.
- No contact glow on the arm: the runs record the force but not which link, and the twin only glows a named link.
- The camera robot's eval: add it to the script once the final test has run (same `facts` shape).
