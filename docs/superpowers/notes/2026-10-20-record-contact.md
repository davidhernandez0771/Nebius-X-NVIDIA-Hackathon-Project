# Record: the contact glow and the soft floor (2026-10-20, pm/record-contact)

The branch comes from pm/live-11 (0cc6e9d). It's code only and Isaac was never started: the sim side is tested with
fake drivers, and the page with Vitest. Everything below the line "Check tonight" has never been run against Isaac.

**Why.** 9 of 10 webcam demos pressed into the bin at 75–927 N, and the person never felt it.

## What changed

### 1. Contact glow

- **Driver.** `IsaacTeleopDriver.read_contact()` (`sim_worker/teleop_isaac.py`) reads the success check's own contact
  sensors (`ARM_CONTACT_SENSORS`: table + 5 bin parts, filtered by the arm bodies). It returns the hardest push over
  the last control step (both physics substeps), which body pushed and what it pushed against. The pure picker is
  `teleop_session.peak_contact`.
- **Twin message.** `sim_twin` now carries `"contact": {"force_n", "body", "against"}` and `"floor": bool`. It is
  sampled every twin frame (≤ 25 Hz while a page watches), so roughly every second control step.
- **Status message.** `sim_status` now carries `contact_peak_n`: the take's largest arm force over every recorded
  step, from `read_state`, in whole newtons. It resets at record_start and holds after stop.
- **Page.**
  - The link that pushes glows amber from 0.5 N and red over 5 N (the success check's `COLLISION_FORCE_N`), brighter
    the harder it pushes. The mapping is in `web/src/twin/contact.ts`.
  - A quiet force bar sits at the top right of the twin pane, live only. It is log scale from 0.5 to 1000 N, with a
    5 N mark, and shows "312 N · hand on the bin", "peak N N" for the take, and "soft floor holding".

### 2. Soft floor

- **The rule.** `demo_pipeline/soft_floor.py`. The target can't go lower than:
  - **Inside the bin:** 1 cm under the rim (rim = bin z + `BIN_RIM_HEIGHT` = 0.09, so 0.08 on the table). "Inside"
    means the bin's outside footprint plus a 2 cm margin, so fingers straddling a wall stop too.
  - **Everywhere else:** the table top, `scene_geometry.TABLE_TOP_Z` = 0. `scene_cfg.TABLE_CENTER` is now derived
    from it; the value is the same, −0.025.
- **Where it applies.** All heights come from `scene_geometry` and the scene's bin pose, including a rotated bin.
  The clamp runs in `TeleopSession.step()`, both on the hand target and on the smoothed command, for camera,
  keyboard and mouse alike, whether recording or not. That way lining up feels the same as recording.
- **The setting.** It is on by default. It's the "soft floor" box in the twin pane's header (`DriveSettings.softFloor`,
  saved locally). The page sends `{"type":"control","action":"set_assist","soft_floor":bool}` when the sim
  connects, before each record_start and on every toggle. The relay validates it, and `soft_floor` must be a real
  bool.
- **The label.** Each teleop demo gets `"assist": {"soft_floor": true|false, "soft_floor_steps": N}` (on for any
  recorded step; N = recorded steps it held the target up). Older demos have no `assist` key, so their demo.json
  bytes are unchanged.
- **Commanded targets.** `Demo.commanded` records the clamped target, which is what the arm was really told.

## Check tonight (in this order)

**0. Restart everything from this branch, relay included.** An old relay rejects the new `sim_status` fields; the
page would show "relay rejected a message" and no status. An old page against the new sim is harmless.

1. **Which link glows.** This is the one real unknown. The body name assumes the contact sensor's filter columns
   come in the order `scene_cfg.ARM_BODIES` lists them.
   - Lower the open gripper onto the table and touch it lightly. The fingers (or the hand) should glow amber, and
     the bar should read e.g. "1.2 N · left finger on the table".
   - Then push one forearm link against a bin wall. That link, not another, should glow.
   - If the wrong link glows, the column order differs. The fix is in `read_contact` (resolve the names from the
     sensor's contact view), and the force numbers are still right.
2. **The colours.** A light touch should be amber, and pushing harder should turn red past 5 N. The bar's 5 N tick
   should sit about 30% along.
3. **The soft floor in the bin.** Soft floor on, keyboard or mouse: drive over the bin and hold F / wheel down. The
   arm should stop with ee_target_z ≈ 0.08 and "soft floor holding" should show. The peak should stay small; it
   shouldn't touch the bin floor at all.
4. **Placing still works.** Pick the cube, carry it over the bin, lower until the floor holds, release. The cube
   should drop ~4–5 cm onto the bin floor (cube bottom ~0.055, floor top 0.01).
   - Run the verifier on the saved demo: it should not fail with `high_release` (cube centre ~0.08 < 0.18).
   - Open demo.json: `"assist": {"soft_floor": true, "soft_floor_steps": >0}`.
5. **Camera mode.** Push the hand down over the bin. Same stop at the rim.
6. **Off.** Untick "soft floor", then lower into the bin. The arm should reach down and the bar should go red if it
   presses. The saved demo should have `"assist": {"soft_floor": false, "soft_floor_steps": 0}`.
7. **The table.** With the default calibration the target never goes below 0.02, so the table floor shouldn't
   engage. Pressing a link on the table should still glow and count in the peak.
8. **Cost.** `read_contact` is one more small GPU→CPU copy per twin frame. With the latency trace on, watch the
   sink's new `contact` section: it should be well under 1 ms. If teleop feels slower with the Record page open,
   tell me.
9. **Peak.** After a take, the bar's "peak N N" should match the largest force you saw. A demo pressed like the
   earlier ones should read hundreds of N; one placed with the floor on should be small.

## Tests

- **Python:** `tests/test_soft_floor.py` covers:
  - the clamp: rim, table, margin, a rotated and moved bin;
  - every input clamped;
  - set_assist on and off, and its validation;
  - the assist label, including demos without one serializing as before;
  - the peak in the status and the contact in the twin;
  - `peak_contact` picking the body and using both substeps.
- **Relay:** `set_assist` forwarding and rejects; the new status and twin fields; older sims' messages unchanged.
- **Web:** `twin/contact.test.ts` (force → colour and intensity, bar scale, labels); twin message parsing;
  `chooseTwin` (live only); RecordConsole (default on, sent on connect, record_start and toggle, saved, force bar and
  peak, no bar on the replay, the header box not taking the mouse).
