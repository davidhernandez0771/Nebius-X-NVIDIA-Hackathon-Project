# Agent 1 handoff — tracking

## What was built

- `camera.ts` — `startCamera()`: requests the front-facing camera via
  `getUserMedia`, plays a detached (off-screen, not `display:none`)
  `<video>` element, resolves once `loadedmetadata` fires with real
  dimensions. Returns `{ video, stream, stop() }`; `stop()` stops all
  tracks, pauses, clears `srcObject`, removes the element. Idempotent.
- `mediapipeTracker.ts` — `createMediapipeTracker(): TrackingAdapter`.
  Loads `FilesetResolver.forVisionTasks("/mediapipe/wasm")` and
  `HandLandmarker.createFromOptions` pointed at
  `/models/hand_landmarker.task` (local, no CDN), `runningMode: "VIDEO"`,
  `numHands: 1`, `delegate: "GPU"`. Runs a `requestAnimationFrame` loop
  calling `detectForVideo`, converts the first hand's
  `NormalizedLandmark[]` to the contract's `HandLandmark[]` (raw,
  unmirrored — no flip applied here), maps `handedness[0][0].categoryName`
  to `"Left" | "Right" | null`. A separate `setInterval` watchdog
  (100ms tick) independently checks `performance.now() - lastFrameAt >=
  STALE_FRAME_MS` and forces status `"error"` if frames stop arriving —
  decoupled from the RAF loop per the contract's stale-frame rule.
- `index.ts` — re-exports `createMediapipeTracker` and `startCamera`.

## Lifecycle semantics (my interpretation, flag if wrong)

- `start()`: idempotent while already running; throws if called after
  `cleanup()`. Acquires camera + loads model lazily (first call only),
  status `loading` → `tracking`/`no-hand` on first frame, `error` on
  failure.
- `stop()`: cancels the RAF loop + watchdog, status → `idle`. Deliberately
  does **not** release the camera stream or dispose the model — `start()`
  after `stop()` resumes without a new permission prompt or model reload.
- `cleanup()`: stops the loop, stops the camera's `MediaStream` tracks,
  calls `landmarker.close()`, clears all listeners, marks the adapter
  unusable. This is the one that must actually turn off the camera light
  — matches HAND_INTERACTION_PLAN.md point 10.

If Agent 4's integration layer expects `stop()` to also kill the camera
(e.g. wants the light off on every `disable()` without a full teardown),
say so and I'll adjust — easy change, just call `cleanup()` from
`disable()` instead of `stop()`.

## Deviations from contract

None. `HandFrame.timestamp` is `performance.now()` captured once per tick
and reused for both the `detectForVideo` argument and the emitted frame
(the call is synchronous, so "received from the model" and "sent to
detectForVideo" are the same tick) — strictly increasing since it's a
single monotonic clock read per RAF callback.

## Known issues / untested

- Not verified against a physical webcam yet (no camera available in this
  environment) — logic reviewed against the MediaPipe Tasks Vision
  `vision.d.ts` API surface and the contract's JSDoc, but the actual
  camera → detection → frame pipeline needs a manual `npm run dev` check
  with a real hand.
- `numHands: 1` is hardcoded — matches the contract's single-hand-cursor
  scope; flag if multi-hand is ever wanted.
- GPU delegate (`delegate: "GPU"`) is untested on this machine; if it
  throws in a given browser, the fallback is switching to `"CPU"` in
  `mediapipeTracker.ts`'s `baseOptions`.

## How verified

- `npx tsc -b` (full project) — clean, no errors, including against
  Agent 2's already-landed `gesture/gestureProcessor.ts` and Agent 4's
  `contracts.ts`.
- Manual line-by-line check of `mediapipeTracker.ts` against
  `node_modules/@mediapipe/tasks-vision/vision.d.ts` for `HandLandmarker`,
  `FilesetResolver`, `HandLandmarkerOptions`, `NormalizedLandmark`,
  `Category`, `WasmFileset` signatures.

---

## Revision 3 update — two hands, `hands[]`, `frameWidth`/`frameHeight`

### What changed

- `numHands: 1` → `numHands: 2` in `HandLandmarker.createFromOptions`.
- New file `handFrameBuilder.ts`: pure function
  `buildTrackedHands(landmarksPerHand, handednessPerHand): TrackedHand[]`,
  extracted out of `mediapipeTracker.ts` so the landmark/handedness → shape
  conversion is testable without a real MediaPipe instance or camera.
  Takes structurally-typed `{x,y,z}[][]` / `{categoryName}[][]` — MediaPipe's
  actual `NormalizedLandmark[][]`/`Category[][]` satisfy these structurally,
  so `mediapipeTracker.ts` passes `result.landmarks`/`result.handedness`
  straight through with no adapter layer.
- `detectTick()` now emits `{ timestamp, hands, frameWidth, frameHeight }`
  instead of the old `{ timestamp, landmarks, handedness }` — replaces the
  single-hand-or-null shape entirely, per the rewritten `HandFrame`.
  `frameWidth`/`frameHeight` are read from `camera.video.videoWidth`/
  `videoHeight` each tick (cheap property reads, not a new API call).
  Status is now `hands.length > 0 ? "tracking" : "no-hand"`.
- **Identity/ordering**: `buildTrackedHands` does not sort or reorder —
  `landmarksPerHand.map(...)` preserves whatever order
  `result.landmarks`/`result.handedness` came back in from MediaPipe.
  Per-hand identity is `handedness`, assigned by `toHandedness` per hand
  (index-paired with its own landmarks, not cross-referenced against the
  other hand) — this module makes no attempt to track identity across
  frames; that's explicitly Agent 2's job in `GestureProcessor`, per the
  IDENTITY note on `TrackedHand` in `contracts.ts`.
- Lifecycle (`start`/`stop`/`cleanup`, the watchdog, the cleanup-mid-await
  race fix from the previous round) is **unchanged** — none of it depended
  on the frame shape or hand count.
- `index.ts` now also re-exports `buildTrackedHands`.

### Deviations from contract

None.

### Testing

Added `handFrameBuilder.test.ts` (Vitest) covering `buildTrackedHands`:
empty input → `[]`, single-hand mapping (landmarks + handedness pass
through), two-hand array order preserved without sorting, unrecognized/
missing handedness category → `null`, and that extra fields on the raw
landmark input (e.g. MediaPipe's `visibility`) are dropped rather than
leaking into the output shape.

This is genuinely the only piece of this revision's tracking logic that's
isolable from the MediaPipe SDK/camera — everything else in
`mediapipeTracker.ts` (the RAF loop, the watchdog, the `cleanedUp` race
guards, `HandLandmarker.createFromOptions` itself) requires a real
`HTMLVideoElement` backed by a live camera stream and the actual WASM
model to exercise meaningfully; a mocked `HandLandmarker` would mostly be
testing the mock. Not forcing a test there — flagging it here instead, per
the plan's own guidance for Agent 1.

**Not run yet**: Vitest isn't installed as of this update (`npx tsc -b`
fails only on `handFrameBuilder.test.ts`'s `import { ... } from "vitest"`
— "Cannot find module 'vitest'" — everything else in `tracking/` compiles
clean). Agent 4 said Vitest is landing shortly; once it's in
`package.json` this test should be re-run for real, not just read.

### Known issues / untested (carried over + new)

- Still not verified against a physical webcam/two real hands — this
  environment has no camera. The user verified one-hand tracking via Camo
  on a real iPhone previously; two-hand detection with `numHands: 2` has
  **not** been verified interactively by anyone yet as of this handoff.
  Needs a manual `npm run dev` check with two hands in frame before
  Agent 2's two-hand zoom kinematics can be trusted end-to-end.
- `delegate: "GPU"` still untested on real hardware in this environment
  (carried over from Revision 2).

---

## Revision 4 — GOAL 5 audit (verification-only, no code changes)

`contracts.ts`'s `HandFrame` shape is unchanged this round, so no rebuild
was needed. Audited `mediapipeTracker.ts` and `handFrameBuilder.ts`
against this round's three verification items; nothing needed fixing.

1. **No overlapping/queued `detectForVideo` calls.** `detectTick()` only
   calls `rafId = requestAnimationFrame(detectTick)` as its last
   statement, after `detectForVideo` (synchronous per
   `vision.d.ts` — returns `HandLandmarkerResult` directly, not a
   `Promise`) and the subsequent `emitFrame`/`setStatus` calls have all
   completed. The browser guarantees at most one `requestAnimationFrame`
   callback fires per animation frame, and since the next one is only
   scheduled after the current tick's synchronous work finishes, there is
   no path for a second `detectForVideo` call to start before the first
   has returned — including if the tab is backgrounded/throttled, which
   just spaces ticks further apart rather than queuing them. `start()`
   also guards re-entrant loop creation (`if (starting || rafId !== null)
   return`), so two `detectTick` loops can never run concurrently either.
2. **No growing per-frame state.** `frameListeners`/`statusListeners` are
   `Set`s that only grow with subscriber count (via `onFrame`/`onStatus`),
   not per tick, and are cleared in `cleanup()`. `lastFrameAt` is a single
   reassigned number. `buildTrackedHands` allocates a new `hands` array
   each call, but it's returned and handed to listeners, not appended to
   any persisted collection — nothing in this module accumulates
   unbounded state across the life of a session.
3. **Timestamps stay real `performance.now()` reads**, not frame-count- or
   assumed-frame-rate-derived: `detectTick` reads `performance.now()`
   once per tick for both the `detectForVideo` argument and the emitted
   `HandFrame.timestamp`; the watchdog separately reads
   `performance.now() - lastFrameAt` on its own `setInterval` clock. No
   change made or needed here — noting for Agent 4's dwell timer that this
   side of the pipeline was already consistent with "real elapsed time,"
   not something assumed from a fixed frame rate.

Re-ran `npx tsc -b` (no errors under `src/hand/tracking/`) and
`npx vitest run src/hand/tracking` (5/5 passing, unchanged) as part of
this audit — both clean.
