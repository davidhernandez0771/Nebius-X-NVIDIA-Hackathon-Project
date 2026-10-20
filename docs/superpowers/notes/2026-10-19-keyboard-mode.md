# Record: keyboard and mouse input (2026-10-19, pm/record-aids)

Clean demos without the camera, so training can use them, and camera vs keyboard can be compared later.

## What it is

- **Input switch** in the camera pane's header on /record: `Keyboard | Mouse | Camera`, saved locally
  (`pm.teleop.drive`). Keyboard is the default on /record. The legacy page (/legacy/pm/record) stays camera only.
  - Switching stops a running session; press Start again in the new mode.
  - Keyboard and mouse need no camera and no hand lock.
- **Same message, same link.** `web/src/record/drive/drive.ts` makes the camera path's `HandPoseMsg`: `tracking_ok`
  true, `control` set to the target as workspace fractions, and `grip` from the gripper. It goes out ~30 times a second
  through the same `TeleopClient` (`send`, with the same throttle).
  - The sim's `to_ee_target` is unchanged and maps it back exactly (`tests/test_drive_mapping.py` checks the TS fixture
    `web/src/record/drive/__fixtures__/drive_msgs.json` against the Python).
- **Keys, in the robot's own frame (as if standing behind it):**
  - W/S (↑/↓) forward/back; A/D (←/→) the robot's left/right; R/F up/down.
  - Space toggles the gripper; Shift held is fine mode (30 % speed); Enter starts, or stops and saves.
  - The existing buttons stay.
  - Keys are ignored while typing in a text field, and arrows are ignored on a focused slider.
  - Losing window focus forgets held keys.
- **Motion:** velocity with a 0.25 s acceleration ramp (up and down), braking ahead of the workspace edges, clamped to the
  sim's Calibration ranges. Speed slider 3–30 cm/s (default 10), saved locally.
- **Mouse** (third choice): click the twin pane to take the mouse (Pointer Lock); Esc releases it.
  - Mouse up = forward, right = the robot's right; wheel or R/F = up/down; left click or Space = gripper; Shift = fine.
  - Sensitivity slider (mm per pixel). The target follows the mouse through a bounded pursuit (a ramp, never a jump),
    with the same clamp and message path.
- **Twin:** the main view is labelled "behind the robot" (it already looked over the robot's right shoulder).
  - W moves away on screen, D moves right. The side, top and alignment views stay.
  - The left/right gauge and the grid use the same frame: the robot's left is on the left.
- **Kit window:** `teleop_sink.py` now aims its camera from behind the robot, like the twin (`--kit-camera isaac` keeps
  Isaac's default). That default, (4, −4, 3), looks at the robot from the front, which is why camera control *looked*
  mirrored. The hand mapping was already "your right = the robot's right" for an unmirrored webcam.
- **Metadata:** each demo saves `"input": "keyboard" | "mouse" | "camera"` (`Demo.input`; older demos have none).
  - While it is unset the field is left out of the JSON, so existing demo.json files and the frozen measurement set
    v2 hash exactly as before.
  - The page sends `{"type":"control","action":"set_input","input":...}` when the sim connects and before every
    `record_start`.
  - The experiment's select stage filters with `--input keyboard` (strict: older demos without the field never match).

## One sim change, and why

The goal was no sim change, but it isn't possible. The rules' jitter check measures jerk on the 50 Hz target the sim
records, and each step takes the newest of ~30 messages a second. Even a perfectly smooth glide arrives as a staircase:
its worst 0.5 s window measured 73 m/s³ (125 at 0.8× real time) against the limit of 20. Sending at 50 or 60 Hz still
gave 25–67.

So `TeleopSession` smooths **keyboard and mouse targets only** with a critically damped filter (τ = 80 ms):
- simulated max jerk 4–7 m/s³ at 0.6–1.0× real time;
- about 2.5 cm (~0.16 s) behind at 12 cm/s.

The camera path is untouched. The mapping (`to_ee_target`) is unchanged.

## Verified

- pytest: 1854 passed, 20 skipped. `npm --prefix web test`: 1180 passed. tsc clean, build OK.
- Headless Chrome with **no camera** (SwiftShader, production build) at 1440×900 and 1280×720, against the real backend
  and relay and a stand-in sim (the real `TeleopSession` + `make_store_saver` on a stub driver).
  - Steps: Start keyboard → Enter → W, D, F, Space, R, Shift+A → Enter. The target moved the right way each time.
  - Each run saved a demo with `input: "keyboard"`; 4 demos had max window jerk 3.0–4.1 m/s³. The rules' only flag was
    `idle_start_end`, from the scripted pause before Enter.
- **Mouse driving was not verified in a browser.** Headless Chrome refuses Pointer Lock. The mapping, clamp, smoothing,
  lock and release are unit-tested only.
- Not tried with Isaac.

## What to check in the next live test

1. Start the sink as usual. The Kit window should now look from **behind the robot** (over its right shoulder).
2. /record → Keyboard (the default) → **Start keyboard**. The chips should show keyboard · relay · sim.
3. **Directions** (watch the Kit window and the twin):
   - W = away from the base; S = toward it.
   - D = the robot's (and your) right; A = left.
   - R = up; F = down.
4. **Smoothness**: tap and hold keys; the arm should glide in and out, never jerk.
   - Hold Shift for fine moves near the cube.
   - Try the Speed slider (try 6–12 cm/s for grasps).
5. **Space** closes and opens the gripper. Do a full pick-and-place: approach, F down to the cube, Space, R up, move over
   the bin, Space.
6. **Enter** starts a recording, and Enter again stops and saves. Then check the saved `demo.json` has
   `"input": "keyboard"`.
7. Typing in any field (or arrows on a focused slider) must not move the arm.
8. **Mouse** (not verified anywhere yet):
   - Switch to Mouse → Start mouse → click the twin pane (cursor disappears).
   - Mouse up = forward, right = the robot's right, wheel = up/down, click = gripper. Esc releases.
   - Try the sensitivity slider. If it feels good it can become the default.
9. **Jitter**: run the rules on a few keyboard demos. Expected: no `jitter` issue.
10. **Experiment**: run `scripts/run_human_demo_experiment.py ... --tag "human_2026*" --input keyboard` and check it
    selects only the keyboard demos.
