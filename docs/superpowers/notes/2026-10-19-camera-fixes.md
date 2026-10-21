# Record: camera fixes after live test #10 (2026-10-19, pm/record-aids)

Part 2 of the request. Part 1 (keyboard and mouse) is the commit before this one; see 2026-10-19-keyboard-mode.md.
The camera path now builds its message in one place, `web/src/record/teleop/handControl.ts`. The page sends exactly
the message it shows.

## A. Depth no longer jumps when pinching

- **Signal.** Depth was the pixel knuckle span |lm5 − lm17|. A pinch curls the index and narrows the knuckles, so
  the hand read as farther away.
  - Depth now comes from `depthSignal.stableSize`: the median of wrist→index MCP, wrist→middle MCP and wrist→pinky
    MCP (0-5, 0-9, 0-17), along the rigid metacarpals.
  - It is in palm-width units, so the depth range, auto-centring and Calibrate work as before. A saved hand-set
    range may need a Re-center reach once.
- **Anchor.** `DepthAnchor` keeps depth continuous across every gripper close or open, from a pinch or the spacebar.
  - While the thumb travels, depth holds the median level of the last 0.3 s.
  - After the toggle it holds 0.2 s more, then continues from that level.
  - Both levels are medians. Re-anchoring on single frames locked in each frame's landmark noise, and depth
    random-walked by 3 cm over 4 pinches.
- **Proof.** It runs on the debug-trace frame format (`handControl.test.ts`).
  - No live trace of the jump was saved, so the fixture (`__fixtures__/pinchTrace.ts`) models the reported symptom:
    a still hand pinching 4×, with the knuckles narrowing ~13% while pinched, plus seeded MediaPipe-like jitter.
  - On it, the old palm-width depth moves by more than 4 cm. The new chain keeps every open and pinched depth
    level within 1 cm of the start, and within 0.5 cm anywhere with the jitter off.
  - With realistic jitter, a still hand alone wobbles about ±0.5 cm frame to frame; that is the existing depth noise,
    not the pinch.
  - **On a real trace:** `PM_TRACE=C:\...\pm-hand-trace-….json npx vitest run src/record/teleop/handControl.test.ts`
    prints the depth level of each open and closed stretch and fails if one is over 1 cm from the first.
  - The debug trace is now version 5: `reach.stable` (the pinch-stable size), `reach.used` (it, anchored) and
    `clutch`.
- **Spacebar gripper (camera mode).** Settings → mapping → Gripper: pinch (default) | spacebar (toggle).

## B. "Mirrored" control

The robot-frame mapping was already "your right = the robot's right" for an unmirrored webcam (the sim mirrors the
raw image's u). Live test #4's swapped MediaPipe handedness labels agree that the webcam is unmirrored.

What looked mirrored was the view: the sink never aimed the Kit window, and Isaac Lab's default viewer at (4, −4, 3)
looks at the robot from the front. From there its right shows on the left of the screen.
- Part 1 aims the Kit window from behind (`--kit-camera behind`), like the twin.
- The setting **"Robot's view (behind the robot)"** is ON by default and keeps that mapping. OFF is a true mirror
  (the robot faces you: your right is its left).
- In the mirror mode the twin's main view (from the front, tag "facing the robot"), the top view, the alignment
  grid and the left/right gauge all turn round, so your right stays on the right of the screen.
- Axis tests cover both modes (left/right, forward/back, up/down): `axisMapping.test.ts`.

## C. Arm fatigue

- **Sensitivity** slider in the camera pane's header (0.5–3×, saved locally). The gain is about the middle of the
  control region; moving the slider never moves the arm (it re-anchors).
- **Clutch:** hold Shift (Settings → Clutch key: Shift | Control | Alt) and the arm's target freezes.
  - Moving the hand does nothing; the gripper holds too.
  - On release the arm carries on from the hand's new position, with no jump.
  - A quiet caption shows: "clutch: the arm holds still; let go to carry on from here".

## D. Still working

The hand lock, the recording aids (3 views, grid, gauge), Stop & discard, Delete last demo and keyboard/mouse mode.
- The keyboard flow was re-run after these changes: a saved demo, max window jerk 3.1 m/s³.

## Verified

- `npm --prefix web test`: 1227 passed, 1 skipped (the PM_TRACE check). tsc clean, build OK.
- Python: no Python change in this part. The full suite passed at the Part 1 commit (1854 passed).
- Headless Chrome with Chrome's fake camera, production build, at 1280×720 and 1440×900:
  - the Sensitivity slider is in the console;
  - Shift shows the clutch caption, and releasing it clears it;
  - unticking Robot's view turns the twin to "facing the robot";
  - the settings drawer fits 720 px with no scroll;
  - no header overflow or horizontal scroll.
- The fake camera has no hand, so pinch, clutch motion and sensitivity on a real hand are covered by the unit and
  page tests only. **Not tried with Isaac or a real hand.**

## What to check in the next live test (camera mode)

1. **Pinch 4× while still.** Hold your hand still in the region and pinch and release 4 times. The arm's depth (the
   ee_x tile, the twin) should stay put, about 1 cm at most. If not, take a Debug trace (Settings → Debug trace,
   10 s) while doing it and run the PM_TRACE check above on the file.
2. **Move right: the robot goes right.** In the Kit window (now from behind the robot) and the twin, moving your hand
   to your right moves the arm to its right. Toward the camera reaches forward, and up is up. If it is mirrored,
   untick "Robot's view" and report it: that would mean this webcam delivers mirrored frames.
3. **Clutch and re-centre.** Reach far right, hold Shift, bring your hand back to the middle, let go. The arm should
   stay where it was, then follow from there. Do it a few times to "walk" across the table without stretching.
4. **Sensitivity.** Try 1.5–2× in the header: smaller hand motions, same reach. Moving the slider must not move the arm.
5. **Spacebar gripper.** Settings → Gripper: spacebar. Space closes and opens, and a pinch does nothing. The arm's depth
   must not move on Space.
6. The hand lock, the aids, Stop & discard and Delete last demo should behave as before.
