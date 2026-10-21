# Record: the mouse click fix and "Save camera video" (2026-10-20, pm/record-aids)

Two follow-ups from the live test after #10. Nothing here has been tried in a real browser with a real mouse or
webcam yet. Tests and headless Chrome screenshots only.

## 1. Mouse mode: a click anywhere on the twin takes the mouse

**Why it didn't work.** Only the small `.rg-take` button asked for Pointer Lock, and it only showed after Start mouse.
The twin's canvas (orbit controls) took clicks anywhere else. Refusals were caught and dropped silently.

**Now:**
- In Mouse mode, a left click anywhere on the twin pane asks for Pointer Lock.
  - It's a capture-phase `pointerdown` on the pane (`RecordConsole.tsx`), so the canvas never gets the click.
  - The twin doesn't orbit in Mouse mode (`interactive={false}`).
- The first click also starts the mouse session if it isn't running yet (`useRecordSession.requestMouse`).
- The prompt is a centered overlay on the twin: "Click here to drive with the mouse · Esc to release". Before the
  session starts it adds "The first click starts the mouse and connects to the sim."
- **When the lock is refused,** `DriveSession.requestMouse` now resolves with the reason and the overlay shows it.
  - Right after an Esc: "The browser needs a second after Esc before it gives the mouse back. Click again."
  - Otherwise: "The browser refused to lock the mouse (Name: message). Click again."
  - The next click asks again.
- **While locked,** a left click is the gripper, as before. A click on the pane while locked doesn't ask for the lock
  again.
- **Keyboard:** the overlay's button works with Enter, but only before the session starts. While it runs, Enter means
  record and stop, as in Keyboard mode.
- The chip in the camera pane still says "click the twin to drive", which is now true. The legend's lead line says
  "Click the twin (or Start) to connect to the sim."

**Check live:**
1. Pick Mouse and *don't* press Start. Click the middle of the 3D twin. The cursor should vanish, the chips should go
   to "mouse · Esc releases", and moving the mouse should move the arm.
2. Press Esc, then click again at once. You should see the "needs a second after Esc" line. Wait a second, click
   again: it should lock.
3. Click on the side, top or align views (also inside the pane). They should take the mouse too.
4. Dragging on the twin shouldn't rotate it in Mouse mode. Switch to Keyboard and it should orbit again.

## 2. Save camera video (for the offline hand refine)

**What it does:**
- In Camera mode, each take's webcam is recorded with MediaRecorder as webm (vp9, else vp8), from record_start to
  record_stop. The code is in `web/src/record/cameraTake.ts`.
- Once the sim names the demo it saved, the page uploads the video and its timing:
  - The request is `PUT /demos/{id}/camera` (multipart: `video` and `timing`) to the local backend.
  - It saves `demos/<id>/camera.webm` and `demos/<id>/camera.json`, replacing any earlier pair.
  - The upload retries if the local connection drops.
- The setting is "Save camera video (stays on this machine)" in the drawer's new **camera** group, on by default. That
  group also holds the hand art and invert checkboxes, so the drawer still fits a 720 px window (checked in headless
  Chrome).
- Keyboard and Mouse takes never touch the camera.
- **What saves nothing:**
  - Stop & discard
  - a take the sim didn't save (too short, save failed)
  - a take still open when the camera stops
  - a take whose demo id never arrives within 20 s
- The camera pane's foot shows one line for each take: "camera video saved: demos/<id>/camera.webm", or why not.
- Delete last demo moves the whole folder, so the video goes to `_discarded` with its demo.

**camera.json** (`CameraTiming` in `src/demo_pipeline/store.py`, checked on upload):
- Every `*_ms` is the page's `performance.now()`, the same clock as `HandPoseMsg.t_ms`.
- `start_ms` is the recorder's start event, which is video time 0.
- `t_ms[i]` is each hand frame's t_ms during the take. `video_s[i] = (t_ms[i] − start_ms) / 1000` is where that frame
  is in camera.webm.
- `record_start_ms` and `record_stop_ms` are when the page sent the controls, for lining up with the sim's steps.
  Sim step k is at about `record_start_ms + k·20 ms` plus the relay delay. That is approximate: the sim doesn't
  record hand t_ms.
- The backend rejects timing that doesn't line up (422): mismatched lengths, t_ms going backwards, frames outside
  start..stop, or video_s off by more than 1 ms. It also rejects a file that isn't webm (by its magic bytes) and an
  empty file (422), and anything over 1 GiB (413).

**Which demo the video goes with.** This is the risky part, so it never guesses:
- While the take records, the sim's last saved id is the baseline.
- After record_stop, the first status that has moved on decides: either not recording, or recording again with
  another id.
- If that status has a new id, that's the take's demo. If not, the take saved nothing.
- A take that never saw a "recording" status of its own is dropped rather than risk landing on another demo's
  folder.

**Check live:**
1. Camera mode: record a short take and stop. The foot should say "camera video saved: demos/human_…/camera.webm".
   Play the file in Chrome or VLC.
2. Check the sync. Pick a moment where you pinch, find its `t_ms` in camera.json, and seek to its `video_s`. The
   pinch should be on screen within about a frame.
   - Expect the start to be off by up to a frame or two: `start_ms` comes from the recorder's start event, which
     isn't exactly the first encoded frame.
   - If it's off by more, the fix is a per-frame clock (`requestVideoFrameCallback`) rather than the start event.
3. Stop & discard a take: no camera.webm appears anywhere.
4. Turn the setting off, then record: no camera.webm.
5. Watch the camera fps (the foot's readout) with the setting on and off. MediaRecorder encodes alongside MediaPipe;
   if fps drops noticeably, tell me.
6. Size: about a few MB per minute at 640×480 with Chrome's default bitrate. Check a 1-minute take.

## Tests

- **Web:** 1255 passed, 1 skipped (`npx vitest run`), and `tsc -b` is clean. New tests:
  - `cameraTake.test.ts`: alignment, upload order either way, discard, unsaved, never guessing, the stale baseline,
    back-to-back takes, the camera stopping, failures.
  - `driveSession.test.ts`: lock refusals (promise rejection, `pointerlockerror`, the Esc case).
  - `RecordConsole.test.tsx`: click → requestPointerLock wiring including a rejection and a retry, the canvas not
    getting the click, orbit off, keyboard press, and the full camera take → PUT flow, discard and setting off.
  - `api.test.ts`: the multipart PUT and its retry.
- **Python:** `tests/test_demos_api.py` and `tests/test_dp_store.py` — 110 passed. That includes 17 new
  `PUT /demos/{id}/camera` tests: saving, replacing, moving with Delete, 404s, the timing rules, non-webm and
  empty files, 413.
