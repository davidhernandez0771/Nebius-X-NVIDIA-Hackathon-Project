# Agent 2 handoff — gesture

## What was built

`web/src/hand/gesture/gestureProcessor.ts` — `createGestureProcessor(): GestureProcessor`,
implementing the contract in `../contracts.ts`:

- **Mirroring** applied exactly once, on `INDEX_TIP`: `mirroredX = 1 - x`, scaled by
  `window.innerWidth`/`innerHeight` read fresh every `update()` call. `y` is never flipped.
- **Smoothing**: exponential moving average with a fixed time constant
  (`SMOOTHING_TAU_MS = 80`), `alpha = 1 - exp(-dt/tau)` using the real inter-frame `dt`
  from `HandFrame.timestamp` — so smoothing amount adapts correctly to actual frame
  rate instead of assuming a fixed one. First sample after idle/reset/reacquisition
  snaps instead of smoothing from a stale/absent position.
- **Pinch detection**: `distance(THUMB_TIP, INDEX_TIP) / distance(WRIST, INDEX_MCP)`,
  2D only (x/y, landmark `z` ignored — depth scale is noisier and unnecessary once
  normalized by hand size). Hysteresis: enter at ratio `<= 0.4`, exit at ratio `>= 0.65`.
- **Events**: `pinchstart` (captures the point as `pinchStartPoint`), `pinchmove`,
  `pinchend`, `cancel` — emitted synchronously to `onPinchEvent` subscribers.
- **Tracking-loss cancellation**: a frame with `landmarks === null` while pinching emits
  `cancel` (not `pinchend`).
- **Release-before-rearm**: a `requireOpenBeforeArm` flag blocks `pinchstart` until a
  subsequent frame observes the hand open (ratio `>= PINCH_EXIT_RATIO`).

## Deviation from the contract (and why)

The contract's re-acquisition rule is worded for the mid-pinch case ("if tracking is
lost mid-pinch ... a new pinchstart may only fire once the hand is observed OPEN").
I applied `requireOpenBeforeArm = true` on **every** hand-absent frame, not only ones
where `isPinching` was true — i.e. it's also set on ordinary `no-hand` frames, on the
first frame ever (before any hand is observed), and after `reset()`. Rationale: the
underlying risk the rule guards against — a hand reappearing already pinched causing a
spurious click-through — exists identically whether the loss happened mid-pinch or not.
Scoping the guard narrower would have meant a hand that blinks out of frame for one
frame while *not* pinching, then reappears already pinched, could auto-arm a pinch with
no visible "open" transition. This is a superset of the minimum the contract asks for;
it does not change behavior for the case the contract explicitly specifies. Flagging
per plan's "deviation from the contract (and why)" instruction — happy to narrow it back
to the mid-pinch-only case if Agent 4 wants literal contract-only behavior.

## Known issues / not done

- No real hand data was used to tune `PINCH_ENTER_RATIO` (0.4) / `PINCH_EXIT_RATIO`
  (0.65) or `SMOOTHING_TAU_MS` (80) — chosen from landmark-geometry reasoning, not
  measured against a live camera feed. These are the first things to tune once Agent 1's
  tracking module is wired up and this can be exercised interactively with a webcam.
- `GestureProcessor.update()` only receives a `HandFrame`, not `TrackingStatus`, so it
  cannot itself detect the "stale frames stop arriving entirely" → `error` status case
  (`STALE_FRAME_MS` watchdog) — that status transition never calls `update()` at all.
  Whoever drives this processor (Agent 4's integration layer, which does see
  `TrackingStatus` via `TrackingAdapter.onStatus`) should call `reset()` when status
  becomes `"error"`, so a mid-pinch stall doesn't leave `isPinching` stuck true with no
  further frames to ever cancel it. This isn't yet wired anywhere — noting it here since
  it crosses into `useHandPointer.ts`, which I don't own.

## Verification (Revision 2)

- `cd web && npm run build` (`tsc -b && vite build`) — clean, no new errors, against the
  full existing app.
- Not yet exercised against real camera input (no `TrackingAdapter` implementation
  landed yet at the time of this handoff) — only reasoned about / type-checked.

---

## Revision 3 — comfortable control region, two-hand identity, pinch-to-zoom

`gestureProcessor.ts` was substantially rewritten against the Revision 3 `contracts.ts`
(`HandFrame.hands: TrackedHand[]` replacing the single-hand shape). Summary of what
changed, against `GestureProcessor`'s JSDoc:

- **Control-region mapping** (`cursor`/`secondaryCursor` only): `mapRegion()` implements
  the exact 4-step pipeline (remap region→[0,1] → clamp → mirror-x-once → viewport-scale)
  on the primary/secondary hand's `INDEX_TIP`. `region.width`/`height` are guarded against
  0 (`|| Number.EPSILON`) since a calibration slider could plausibly hit it. Pinch
  detection and two-hand separation both stay on raw landmark geometry, untouched by the
  region, per contract.
- **`setControlRegion()` queuing**: a region set while `gestureInProgress()` (primary
  pinching, or zoom active) is queued in `pendingRegion` and only applied at the *top* of
  a later `update()` call once that check is false — using the gesture state as of the
  *end of the previous frame*, so the swap lands on the first fully-safe frame after
  release, never mid-gesture. Covered by a dedicated test
  ("queues a region change made mid-pinch...").
- **Primary/secondary selection**: kept by `handedness` identity (`Map<Handedness, ...>`
  for pinch state), never by array index — `assignRoles()` only reassigns primary when the
  current primary's identity is absent from the frame *and* another identified hand is
  present; otherwise it's sticky. A hand with `handedness === null` never participates
  (filtered out before role assignment even sees it).
- **Two-hand zoom kinematics**: `updateZoom()` is a self-contained state machine keyed on
  `bothPinching` (both identified hands' own independent hysteresis states, tracked the
  same way primary's always was). Baseline separation uses the THUMB_TIP/INDEX_TIP
  midpoint of each hand, aspect-corrected via `frameWidth/frameHeight` exactly as
  specified. Dead zone → rate limit → EMA smoothing is applied in that order (matches the
  contract's stated order), all guarded against non-finite/non-positive results.
- **Cursor smoothing across a role/identity change**: `CursorSmoother.reset()` is called
  whenever `primaryHandedness`/`secondaryHandedness` changes value between frames (a role
  reassignment is a different physical hand — snap, don't interpolate across the jump) —
  same treatment the underlying hand simply going untracked already got in Revision 2.

### Deviation from the contract (and why) — Revision 3

None beyond the one already noted for Revision 2 (still in effect, extended naturally:
`requireOpenBeforeArm` is now tracked **per hand identity** rather than for a single
hand, but the same "any absence, not just mid-pinch absence, arms the guard" rule
applies to each identity independently). No new deviations — Revision 3's contract was
specific enough (including the exact dead-zone → rate-limit → smooth ordering) that I
implemented it as written rather than making a judgment call.

### Known issues / not done

- Same as Revision 2: zoom tuning constants (`ZOOM_DEAD_ZONE = 0.02`,
  `ZOOM_MAX_RATIO_DELTA_PER_FRAME = 0.15`, `ZOOM_SMOOTHING_TAU_MS = 100`,
  `ZOOM_BASELINE_EPSILON = 0.01`) are reasoned from geometry, not tuned against a real
  two-hand pinch on a webcam. Once Agent 1's two-hand tracking + Agent 4's `ScanViewer`
  wiring are both live, these are the first things worth adjusting by feel.
- `setControlRegion`'s queuing decision reads gesture state *as of the previous frame's
  end*, so a region change requested and a pinch release happening in the exact same
  `update()` call will still defer the swap by one more frame (verified as intentional
  behavior, not a bug, in the handoff test — but flagging since it's a one-frame-later
  outcome than "immediately on release" might suggest).

### Testing

Added `gestureProcessor.test.ts` (Vitest, colocated), 17 tests, all passing:
`npx vitest run src/hand/gesture`. Covers (pure input→output, no DOM/camera
dependency other than reading `window.innerWidth`/`innerHeight`, mocked via
`Object.defineProperty` in tests):

- Control-region mapping: center, mirroring at both edges, y never flipped, clamping
  past both edges, live viewport re-read on resize, and the mid-pinch region-queuing
  behavior end-to-end.
- Primary/secondary identity continuity across a detector array-order swap (the
  specific scenario requested: same physical hands, `hands[0]`/`hands[1]` swapped
  between calls, same hand stays primary) and immediate promotion when primary's
  identity goes missing; also that a second hand never moves `cursor` or reaches the
  primary `onPinchEvent` stream.
- Primary pinch lifecycle: tracking-loss → `cancel` (not `pinchend`), and
  release-before-rearm blocking a spurious `pinchstart` on an already-pinched
  reappearance.
- Two-hand zoom: `zoomstart` at ratio 1 without disturbing the primary's own pinch
  stream, refusal to start from a degenerate (near-zero) baseline, rate-limited +
  smoothed scaling on a large separation jump, the dead zone suppressing sub-2% jitter,
  normal `zoomend` on release, and `zoomcancel` (distinct from `zoomend`) when one hand
  goes untracked mid-zoom — including confirming the still-tracked primary's own stream
  does *not* see a spurious cancel in that case.
- `reset()`: clears role/pinch/zoom state with no zoom event emitted (implicit cancel,
  per contract), and a fresh hand after reset re-establishes primary from scratch rather
  than being stuck pointing at the old identity.

Full-suite `npx vitest run` at handoff time: 32/33 passing repo-wide; the one failure
(`useHandPointer.test.ts`) is in Agent 4's in-progress integration rewrite, unrelated to
this module. `npx tsc -b`: the only error present is also in `useHandPointer.ts`
(missing `HandPointerApi` fields Agent 4 is actively adding) — nothing in
`web/src/hand/gesture/` reported.

---

## Revision 4 — index/middle SELECT replaces pinch as the public one-hand gesture

`gestureProcessor.ts` rewritten again against the Revision 4 `contracts.ts`. Summary:

- **Renames** (mechanical, per the new contract): `PinchEvent`→`SelectEvent`,
  `PinchEventType`→`SelectEventType` (`pinchstart/pinchmove/pinchend`→
  `selectstart/selectmove/selectend`, `cancel` unchanged), `onPinchEvent`→
  `onSelectEvent`, `isPinching`→`isSelecting`.
- **Thumb/index pinch is now fully internal.** `PinchIdentityState`/
  `updatePinchHysteresis` are unchanged in mechanism (same 0.4/0.65 ratios, same
  per-identity `requireOpenBeforeArm`), just no longer have a public event or getter —
  they feed only the priority rule and `updateZoom` now.
- **New SELECT gesture** (index/middle), primary-only, in `updateSelectGesture()`:
  - Ratio: `distance(INDEX_TIP, MIDDLE_TIP) / handSize` (same `handSize` reference as
    pinch, factored into a shared `handSize()` helper). Chose
    `SELECT_CLOSE_RATIO = 0.22` / `SELECT_RELEASE_RATIO = 0.38` — deliberately smaller
    than pinch's 0.4/0.65 per the plan's own reasoning (adjacent fingers sit closer at
    rest than thumb/index), same enter/exit hysteresis shape, same rough
    exit:enter ratio (~1.7x) as pinch's for consistency. Unmeasured against a real
    hand — flagging per the established pattern from Revisions 2-3.
  - Stability window: `SELECT_STABILITY_MS = 60`, applied identically to both the
    close→select and select→release transitions (a `selectCloseStreakStart`/
    `selectOpenStreakStart` pair, each null unless a streak is actively accumulating,
    reset to null the instant the streak breaks). This is genuinely what satisfies "a
    hand reappearing already-closed can't immediately select" — no separate
    require-open-first flag was needed for SELECT (unlike pinch), because the
    contract's own JSDoc attributes that protection entirely to the stability window,
    and a reappearing hand starts a brand-new streak regardless of how it looked the
    instant before it vanished.
  - Fist rejection: `fingersExtended()` requires
    `distance(INDEX_TIP, INDEX_MCP)/handSize >= 0.5` AND the same for
    `MIDDLE_TIP`/`MIDDLE_MCP`. Chosen as "at least half a hand-size length still
    extended" — a deliberately generous margin above 0 so ordinary finger curl during a
    normal select isn't mistaken for a fist, while an actual fist (fingertip pulled back
    close to its own knuckle) reads far below it. Checked every frame the close
    condition is otherwise true, not just once at commit time — a fist held motionless
    simply never accumulates a streak, since the pose-check failure resets it every
    single frame, identically to the ratio-based break case.
- **Priority rule** (`updatePrimary()`): primary's own pinch hysteresis is updated
  *before* select is evaluated, in the same frame. If `pinching && selecting`, select is
  cancelled immediately (`emitSelect("cancel", ...)`) — this can only ever fire on the
  exact frame pinch newly reads true while select was already active, since once
  cancelled `selecting` is false and the "while pinching" branch below prevents it from
  re-arming. If pinching (regardless of whether this is the frame it started), select's
  close-streak is force-cleared and `updateSelectGesture` is skipped entirely that
  frame — satisfies "the countdown does not even begin" literally, not just
  approximately.
- **`gestureInProgress()`** (region-change queuing) now checks `selecting ||
  primaryPinching || zoomActive`, per the updated contract wording.
- **Zoom kinematics**: `updateZoom`/`handSeparation`/dead-zone/rate-limit/smoothing are
  byte-for-byte unchanged from Revision 3, per the plan's explicit instruction not to
  touch them.

### Deviation from the contract (and why) — Revision 4

None. Revision 4's contract JSDoc was specific enough (including which mechanism
satisfies the reacquisition requirement for SELECT vs. PINCH) that everything above was
implemented as written, not as a judgment call.

### Known issues / not done

- `SELECT_CLOSE_RATIO`/`SELECT_RELEASE_RATIO`/`SELECT_STABILITY_MS`/
  `MIN_FINGER_EXTENSION_RATIO` are all reasoned from landmark geometry, not tuned
  against a real hand performing the gesture — same caveat as every tunable constant in
  this file so far. These (plus a possible discovery that 60ms feels too snappy/too
  laggy in practice) are the first things worth adjusting once this is exercised on a
  real camera.
- I did not attempt to tune `SELECT_STABILITY_MS` differently for the close vs. release
  transition — the contract says "documented default... apply the same debounce
  symmetrically," which I read as literally the same duration for both, not just
  "symmetric in spirit." Flagging only because it's a reading, not because I think it's
  wrong.

### Testing

Rewrote `gestureProcessor.test.ts` for the rename and added new coverage — 26 tests,
all passing (`npx vitest run src/hand/gesture`), up from 17. New/changed test
infrastructure: hand-landmark builders are now parameterized as offsets *from* the
given cursor position (`baseGeometry()`) rather than fixed at the origin, so every
gesture helper (`openHandAt`, `pinchedHandAt`, `selectClosedAt`,
`pinchingWithSelectPoseAt`, `fistHandAt`) works at an arbitrary on-screen position
without the old approach's risk of extension/pinch/select ratios accidentally
depending on where the synthetic hand happened to be positioned for a given test.

Coverage added this round: index/middle close/release hysteresis, the stability window
(explicit small-timestamp tests distinct from the `BIG_DT` convergence pattern used
elsewhere — a genuine noisy-frame-under-threshold case, a streak-interruption case, and
the same treatment applied to release), fist rejection (held indefinitely, never
selects), reacquisition (hand reappearing already-closed still needs the full window
from the reappearance frame, not instant), tracking-loss cancel, and a dedicated
`describe("select/pinch priority", ...)` block: the countdown never starting while
pinching (even against a pose specifically engineered to otherwise satisfy select's
close+extended conditions), an already-active select being cancelled the instant pinch
engages, and zoom kinematics being provably unaffected by an attempted/preempted select
on the primary hand. Existing region/identity/zoom/reset tests carried over with the
rename applied and pass unchanged in spirit.

Full-suite `npx vitest run` at handoff time: **57/57 passing** across all three suites
(`handFrameBuilder.test.ts`, `gestureProcessor.test.ts`, `useHandPointer.test.ts`) —
Agent 4's integration rewrite had already landed by the time I finished, so this is a
clean full-repo pass, not just my own module. `npx tsc -b`: clean, no errors anywhere.
