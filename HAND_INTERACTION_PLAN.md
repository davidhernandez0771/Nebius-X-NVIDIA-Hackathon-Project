# Hand-controlled cursor — plan

**Revision 2** (scope correction from the original plan): this is an
**independent hand-controlled cursor layered over the existing SANT app**,
not a standalone demo screen with mock draggable cards. The physical mouse
pointer never moves. The hand cursor is a second, visible pointer that can
hover, click and — where the app already supports it — drag real controls.
If you read Revision 1 of this file, discard the "prototype screen" /
"HandSort" section entirely; it no longer applies.

Coordinates Agents 1-3 building this. Agent 4 (this file's author) owns
setup, dependencies, assets, integration with the existing app's controls,
input coordination, and final verification.

## Branch and framework

- **Branch:** `computer-vision` (already checked out, working tree clean at
  setup time, identical history to `main` — no divergent work to preserve).
  Do not create a new branch. Do not commit, stash, reset, or push.
- **Framework:** React 18 + TypeScript + Vite, React Router. Animation uses
  **Anime.js (`animejs@^4.5.0`, already installed)** — reuse it.
- **Hand tracking:** MediaPipe Tasks Vision `HandLandmarker`
  (`@mediapipe/tasks-vision@0.10.17`, pinned as a direct dependency in
  `web/package.json` — was already resolved transitively via
  `@react-three/drei`).

## Assets (done, owned by Agent 4)

To avoid a runtime CDN dependency during the demo, WASM and model assets are
copied to disk instead of fetched from `cdn.jsdelivr.net` /
`storage.googleapis.com` at runtime:

- `web/public/mediapipe/wasm/` — copied verbatim from
  `web/node_modules/@mediapipe/tasks-vision/wasm/` (matches the pinned
  package version exactly).
- `web/public/models/hand_landmarker.task` — the pinned model,
  `float16/1` (not `latest`), from
  `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.

Both are gitignored (`.gitignore`: `web/public/mediapipe/`,
`web/public/models/*.task`) — large binaries, not committed. Agent 1: point
`FilesetResolver.forVisionTasks("/mediapipe/wasm")` and
`baseOptions.modelAssetPath: "/models/hand_landmarker.task"` at these local
paths (served by Vite from `public/`), not at a CDN.

## What the app actually has today (checked, not assumed)

- **No drag-and-drop anywhere in the app currently** (`grep` for
  `draggable|onDragStart|dnd-kit|sortable` across `web/src` — no hits).
  Sorting in `Review.tsx` uses `ThreeWaySwitch`, a button-based
  `role="radiogroup"` — three real `<button>`s, not a drag target.
- **Every existing interactive control is a plain, semantic element with a
  React `onClick`**: `ThreeWaySwitch` (`web/src/components/ThreeWaySwitch.tsx`,
  radio-group of `<button role="radio">`), `Toggle`
  (`web/src/components/Toggle.tsx`, `<button role="switch">`), `IconTile` nav
  links (`<Link>`/`<a>`), and ordinary buttons elsewhere. None rely on
  pointer-position state beyond click — good, because it means the safe,
  general activation adapter is calling the real DOM `element.click()` on
  the resolved control (not dispatching a synthetic `MouseEvent`): React's
  `onClick` fires normally from `.click()`, and it exercises the actual
  handler instead of assuming a fabricated event matches what the browser
  would have produced.
- **No modal/dialog component exists** (`grep` for `modal|dialog` — no
  hits). The hit-testing rule below still respects an open
  `dialog[open]`/`[role="dialog"]` defensively, but there is nothing to
  verify it against yet — call this out, don't claim it's tested.
- **One real drag surface exists**: `ScanViewer.tsx` uses drei's
  `OrbitControls` (three.js) on the GLB viewer canvas, which drags to orbit
  the camera. This is the only control `.click()` can't drive — it listens
  for native pointer events on the canvas. It is the designated drag-adapter
  target for this version, driven by dispatching real `PointerEvent`s
  (`pointerdown`/`pointermove`/`pointerup`, correct `pointerId`,
  `clientX`/`clientY`, `bubbles: true`) at the canvas element. Flagged as
  higher-risk/best-effort — verify it interactively before relying on it;
  everything else in this plan (hover/click) does not depend on it working.

## Revised ownership (non-overlapping paths)

| Agent | Responsibility | Owns |
|---|---|---|
| **Agent 1** | Camera lifecycle and hand tracking | `web/src/hand/tracking/camera.ts`, `web/src/hand/tracking/mediapipeTracker.ts`, `web/src/hand/tracking/index.ts` |
| **Agent 2** | Cursor coordinates (mirroring + viewport mapping), smoothing, pinch lifecycle, tracking-loss cancellation, release-before-rearm | `web/src/hand/gesture/gestureProcessor.ts`, `web/src/hand/gesture/index.ts` |
| **Agent 3** | App-wide hand-cursor overlay, hand-hover styling, animated hover/pinch/activation feedback | `web/src/hand/overlay/HandCursorOverlay.tsx`, `web/src/hand/overlay/handCursorOverlay.css` |
| **Agent 4** (me) | Shared setup, integration with existing app controls (hit-testing, activation, drag adapters), input coordination, final verification | `web/src/hand/contracts.ts`, `web/src/hand/integration/useHandPointer.ts`, `web/package.json`, `web/package-lock.json`, `web/public/mediapipe/`, `web/public/models/`, `.gitignore`, `web/src/App.tsx`, this file, and necessary fixes into the above once each agent is idle |

Only Agent 4 touches manifests, lockfiles, `.gitignore`, or other shared
config. Agent 3's overlay imports types/the hook from
`web/src/hand/integration/useHandPointer.ts` (Agent 4's file) but does not
edit it.

## Handoff files (write when your module is done)

- Agent 1 → `web/src/hand/tracking/HANDOFF_AGENT1.md`
- Agent 2 → `web/src/hand/gesture/HANDOFF_AGENT2.md`
- Agent 3 → `web/src/hand/overlay/HANDOFF_AGENT3.md`

Each handoff: what you built, any deviation from the contract (and why),
known issues, and how you verified it in isolation.

## Shared contracts

Defined in `web/src/hand/contracts.ts` — **read the file, the JSDoc on each
type is the actual spec**:

- `HandFrame` — monotonic `performance.now()` timestamp, 21 raw unmirrored
  landmarks or `null`, handedness or `null`.
- `TrackingAdapter` — `start/stop/cleanup/onFrame/onStatus`.
- `TrackingStatus` — `idle | loading | tracking | no-hand | error`.
- `STALE_FRAME_MS` (500ms) — watchdog threshold for frames that silently
  stop arriving (independent timer, not just "hand left the frame" — see
  contracts.ts for the full rule).
- `ViewportPoint` — CSS pixels from the viewport's top-left, matching
  `getBoundingClientRect()`/`clientX,clientY` directly.
- `GestureProcessor` — `update/reset`, `cursor` (viewport px, mirrored
  exactly once — `mirroredX = 1 - x` then scaled by `window.innerWidth`,
  re-read live every `update()` so resizing needs no extra listener),
  `isPinching`, `onPinchEvent` (`pinchstart/pinchmove/pinchend/cancel`), and
  the re-acquisition rule (lost-while-pinching → `cancel`; a new
  `pinchstart` requires the hand to be seen open again first).
- `DRAG_THRESHOLD_PX` (12px) — movement past this from the pinchstart point
  turns a held pinch into a drag instead of a click.
- `HandPointerPhase` / `HandPointerState` / `HandPointerApi` — the
  integration layer's state machine (`idle → pointing → armed → dragging`)
  and the `enable()/disable()` opt-in surface Agent 3's overlay consumes.

## Implementation requirements (binding on all agents)

1. **Overlay mounts app-wide** (in `App.tsx`, outside `<Routes>`, so it
   survives navigation) with `position: fixed; inset: 0; pointer-events: none`
   on the container and every element inside it — it must never intercept a
   real click or block the physical mouse.
2. **Mirroring applied exactly once**, in `GestureProcessor` (see contract
   above). Viewport mapping re-reads `window.innerWidth/innerHeight` live
   each frame — correct across resizes with no dedicated resize listener.
3. **Hit-testing** (Agent 4, `useHandPointer.ts`): `document.elementsFromPoint(x, y)`
   at the cursor position, then `.closest('button, a[href], [role="button"],
   [role="radio"], [role="switch"], input:not([type=hidden]), select,
   textarea, [tabindex]:not([tabindex="-1"])')` to resolve nested icons/text
   to the real control. Reject `[disabled]`, `[aria-disabled="true"]`, and
   anything with `offsetParent === null` (hidden/display:none). If
   `dialog[open], [role="dialog"]` exists in the document, restrict
   hit-testing to inside it (untested — no modal exists in the app today,
   see above).
4. **Explicit hand-hover state**: an app-drawn cursor does not trigger real
   `:hover` or pointer events on the target, so `hoverTarget` is tracked
   explicitly in `HandPointerState` and Agent 3's overlay draws its own
   highlight (e.g. an animated ring positioned at
   `hoverTarget.getBoundingClientRect()`) — it does not rely on the target's
   own `:hover` CSS firing, and does not need to mutate the target's classes
   or attributes.
5. **Activation adapters**: default adapter is `target.click()` (real DOM
   method, exercises the actual React `onClick`, not a fabricated
   `MouseEvent`) — covers every current control (buttons, `ThreeWaySwitch`,
   `Toggle`, nav links). `ScanViewer`'s `OrbitControls` needs the dedicated
   `PointerEvent`-dispatch adapter described above; nothing else in the app
   currently needs one.
6. **Pinch → activation**: capture `hoverTarget` at `pinchstart` (phase →
   `armed`). On `pinchend`, activate the captured target only if the phase
   never became `dragging` (i.e. movement stayed under `DRAG_THRESHOLD_PX`)
   and the target is still in the document and still enabled/visible —
   never re-resolve to whatever happens to be under the cursor at release.
   Never activate on `pinchmove`. On `cancel` (tracking lost) or if the
   captured target is removed from the DOM mid-gesture, abandon silently —
   no activation, no drag continuation.
7. **Drag**: only `ScanViewer`'s canvas gets drag treatment in this version
   (see above); nothing else is made draggable. No interference with page
   scrolling (the overlay is `pointer-events: none` and hand input never
   touches wheel/touch scroll handling).
8. **Mouse/hand independence**: hand input never calls
   `element.dispatchEvent` for real mouse events and never moves the OS
   pointer — only `.click()` / the dedicated `PointerEvent` adapter on the
   captured target. Real mouse hover (`:hover`) and hand-hover
   (`hoverTarget`) are tracked completely separately, so a user mousing over
   one button while hand-pointing at another can't cause a duplicate or
   conflicting activation — each input's activation path only ever acts on
   its own captured target.
9. **Feedback animation** (Agent 3, Anime.js): animate cursor appearance,
   hover-ring transitions, and a short activation pulse. Update the cursor's
   raw position every frame via direct style/transform writes (not a new
   Anime.js tween started per frame — that would stack/leak); use Anime.js
   for the discrete state-change animations (hover enter/exit, activation
   pulse, cursor show/hide) instead. Respect
   `prefers-reduced-motion` (shorten/skip the animated transitions; the
   cursor itself should still track, since it's the core function, not
   decoration).
10. **Cleanup**: camera + model resources are released on `disable()` and on
    unmount — `TrackingAdapter.cleanup()` must actually stop the
    `MediaStream` tracks, not just hide the UI.

## First-version scope

**In:** pointing, hover (visual highlight only, no real `:hover`), click
(via `.click()` on the resolved real control), and drag limited to
`ScanViewer`'s `OrbitControls` (best-effort, needs interactive
verification). Opt-in only — camera is off until the user explicitly
enables hand control, with a visible way to disable it again.

**Out (this version):** scrolling, text selection, native browser
menus/OS-level control, and drag on any control other than `ScanViewer`
(there are no other drag targets in the app today).

## Verification commands

- `cd web && npm run build` — `tsc -b && vite build`; type-checks all new
  code (ran clean against `contracts.ts` alone at setup time; must be
  re-run clean after every agent's module lands).
- `cd web && npm run dev`, then exercise the running app — manual check,
  requires a physical webcam for the tracking path.
- Backend is untouched by this work; `uv run pytest -q` is unaffected and
  not expected to need re-running.

## Revision 3 — comfortable movement, two-hand zoom, visual polish

Shipped and verified (via Camo on a real iPhone, by the user): one-hand
pointing, hover, click, and the ScanViewer drag adapter, all from Revision
2 above. This revision adds three goals on top of that working base.
**Everything in Revision 2 above still applies except where this section
explicitly changes it** (HandFrame and GestureProcessor's shapes changed —
see `contracts.ts`, now the single source of truth for both).

### GOAL 1 — comfortable control region

A small rectangle in the RAW camera frame (default centered, 55% of camera
width/height — a tunable starting point) maps to the full viewport, so
small hand movements near a relaxed arm position reach every screen edge.
Full mapping pipeline (remap → clamp → mirror-once → viewport-scale) is
specified on `GestureProcessor` in `contracts.ts` — read it there, not
here. Region is user-adjustable (size + vertical position, not horizontal)
via a calibration UI, with a reset-to-default action, persisted in
`localStorage` by Agent 4 (`web/src/hand/integration/useHandPointer.ts`).
Pinch/raw-geometry detection is explicitly UNAFFECTED by the region — see
contracts.ts — so calibrating never distorts what counts as a pinch.

### GOAL 2 — two-hand pinch-to-zoom in the room/scan viewer

Pinch with both hands, move them apart to zoom in, together to zoom out,
while over `ScanViewer` (`web/src/three/ScanViewer.tsx`). Drives the real
OrbitControls camera-distance dolly via a new imperative
`ScanViewerHandle` (`getDistance/setDistance/minDistance/maxDistance/setOrbitEnabled`,
defined in `ScanViewer.tsx`) — never a CSS transform. Reached from the
app-root integration layer via a tiny registry,
`web/src/hand/integration/activeScanViewer.ts` (Agent 4), since there is at
most one `ScanViewer` mounted at a time (`RoomView.tsx`).

Two-hand tracking (`HandFrame.hands[]`, keyed by `handedness` as stable
identity — detector array order is NOT stable, see contracts.ts),
primary-hand stability, and the two-hand-pinch kinematic state machine
(`zoomstart/zoomchange/zoomend/zoomcancel`) are fully specified on
`GestureProcessor` in `contracts.ts`. GestureProcessor is deliberately
DOM/context-free — it emits zoom events whenever both identified hands are
pinching, regardless of what's on screen. Agent 4's integration layer is
what gates this to "only when the room viewer is the active context"
(primary hand's captured target is the `<canvas>` at the moment
`zoomstart` arrives) and suppresses one-hand click/drag/orbit while zoom
is active, requiring a full release before one-hand actions can rearm.

### GOAL 3 — visual polish

Anime.js throughout (already integrated, reuse it — same rules as before:
write continuous per-frame position directly, never a new tween per
frame; respect reduced motion). Design direction is Agent 3's call within
the existing dark/glass aesthetic (`tokens.css`); ideas to draw from:
refined pinch ring, hover highlight + activation pulse, two-hand markers
with a connecting line during zoom, a tasteful zoom-direction/amount
indicator, an attractive region outline in the optional calibration camera
preview. Never obscure the scan, shift interactive targets, or block mouse
input.

### Revised ownership for this revision

| Agent | Responsibility | Owns |
|---|---|---|
| **Agent 1** | Two-hand output (`hands[]`), stable per-hand identity via `handedness`, `frameWidth`/`frameHeight`, lifecycle unchanged | `web/src/hand/tracking/*` (unchanged file list) |
| **Agent 2** | Control-region mapping, primary/secondary hand selection, two-hand zoom kinematics | `web/src/hand/gesture/*` (unchanged file list) |
| **Agent 3** | Calibration UI (region controls + optional camera preview with region outline — presentational, reads/writes via `HandPointerApi`, does not touch `localStorage` itself), two-hand zoom visual feedback, all Goal 3 polish | `web/src/hand/overlay/*` (unchanged file list) + a new calibration component under the same directory |
| **Agent 4** (me) | `contracts.ts` (done, Revision 3), `ScanViewer.tsx` zoom handle (done), `activeScanViewer.ts` (done), `useHandPointer.ts` rewrite (region persistence, zoom context-gating, one-hand suppression, arbitration), tests, verification | as before, plus `web/src/three/ScanViewer.tsx` and `web/src/hand/integration/activeScanViewer.ts` |

Same non-overlap rule as Revision 2: only Agent 4 touches manifests,
lockfiles, `App.tsx`, or files outside your own directory. `contracts.ts`
is final for this round — implement against it; flag, don't silently
change it.

### Testing (new)

No frontend test runner existed before this revision; Agent 4 is adding
Vitest (`web/package.json`, `web/vitest.config.ts`) since this is exactly
the kind of pure-logic-with-edge-cases work unit tests are good at. Each
worker adds focused tests for their own module's new logic alongside their
implementation (colocated `*.test.ts`), covering at minimum:
- Agent 2: control-region center/edges/clamping/mirroring/resize,
  two-hand identity continuity across an array-order swap, zoom
  start/relative-scaling/dead-zone/limits/release/tracking-loss.
- Agent 1: whatever of the identity-assignment/frame-shape logic can be
  isolated from the real MediaPipe/camera APIs (that part is inherently
  hard to unit test — don't force it; note in your handoff what's
  reasoned-about vs. test-covered).
Agent 4 covers integration-level behavior (zoom context-gating, one-hand
suppression during/after zoom, release-before-rearm) and runs the full
suite at the end. `npx vitest run` alongside `npx tsc -b` are both part of
"the build" from this revision on.

## Status

**Revision 3 integrated and verified (automated).** Branch: `computer-vision`,
still not merged, pushed, or deployed. All four modules landed, wired
together in `App.tsx` (HandToggle, the new calibration trigger + panel, and
the overlay all mounted), and re-verified as a whole:

- `npx tsc -b` — clean.
- `npm run build` — clean.
- `npx vitest run` — 34/34 passing across three suites
  (`handFrameBuilder.test.ts`, `gestureProcessor.test.ts`,
  `useHandPointer.test.ts`).
- Manual browser check (Chrome automation, mouse input, no camera): the
  calibration panel opens/closes (button + Escape), both sliders update
  their live schematic preview and persist to `localStorage`
  (`sant.hand.controlRegion`), reset-to-default works, HandToggle
  enable/disable round-trips correctly including from an error state, and
  no console errors were produced by any hand/ module across the session.

**Not verified by anyone yet, needs the user's physical camera on return**
(see the real-camera checklist Agent 4 gives the user directly): two-hand
detection with `numHands: 2`, the comfortable control-region mapping feeling
right on a real hand, the two-hand pinch-to-zoom gesture end to end
(including its interaction with a real `ScanViewer` orbit/zoom), and all
Goal 3 visual polish in motion.

## Revision 4 — index/middle selection, dwell activation, customizable color

**Confirmed working on the user's real iPhone/Camo camera: the adjustable
control region and two-hand zoom (Revision 3).** This revision replaces the
one-hand click gesture, adds a new activation method, and adds a color
setting. **`contracts.ts` changed significantly again -- re-read it in full,
the JSDoc is the spec.**

### GOAL 1 — index/middle "select" replaces thumb/index for one-hand clicking

Thumb/index pinch is no longer the one-hand click/drag gesture. It is now
reserved exclusively for two-hand zoom's precursor (unchanged mechanism,
just no longer exposed as a public per-hand event). The new one-hand
gesture, **select**, is INDEX_TIP/MIDDLE_TIP proximity: bring them together
to engage, apart to release. Full spec (hysteresis, stability window, fist
pose-rejection, and — the key new piece — the **select/pinch priority
rule**, where pinching the primary hand always preempts an in-progress or
about-to-start select on that same hand) is the `SelectEvent`/
`GestureProcessor` JSDoc in `contracts.ts`. Target capture, click-vs-drag-
via-`DRAG_THRESHOLD_PX`, release-before-rearm, and the `ScanViewer`
canvas-drag adapter all carry over unchanged in spirit, just re-keyed onto
`onSelectEvent` instead of the old `onPinchEvent`.

### GOAL 2 — two-second dwell (hover) activation on sidebar nav icons

New capability: holding the hand cursor over an eligible left-sidebar nav
icon for `DWELL_DURATION_MS` (2000ms default) activates it, with a
perimeter-tracing border animation (empty → complete, matching the icon's
shape/corner-radius) as progress feedback. Full spec — one logical timer
as the source of truth, the target-change jitter-tolerance mechanism, every
cancel trigger (leave/lost-tracking/DOM-gone/disabled/modal/tab-hidden/
another-gesture), and why the phase-gate alone prevents a double activation
against manual select — is the `DWELL_*` JSDoc block in `contracts.ts`.
Eligibility is the explicit `DWELL_ELIGIBLE_ATTR` (`data-hand-dwell`)
opt-in marker, applied ONLY to `IconTile`'s nav-`Link` branch (its only
real usage in the app — checked, not assumed) by Agent 4, never globally.

### GOAL 3 — customizable interaction color

One setting (presets + custom picker + reset-to-default-orange, persisted
locally), applied through exactly one CSS custom property,
`INTERACTION_COLOR_CSS_VAR` (`--hand-interaction-color`), that every
"engaged" visual (select-engaged cursor/ring, hover highlight, dwell
border, activation confirmation) reads instead of the old hard-coded
`--warm`. `DEFAULT_INTERACTION_COLOR` matches `--warm`'s existing orange
exactly. Lives in the existing calibration panel (`CalibrationPanel.tsx`),
alongside the control-region controls.

### GOAL 4 — Anime.js, version-checked

Installed version: `animejs@4.5.0` (already a direct dependency). Confirmed
current v4 API via the official docs before writing this plan: functional
`animate(target, properties, options)` (not v3's `anime({...})` object
form — already how the existing code is written), SVG attributes including
stroke-dash* are animatable, `animation.seek(ms)` exists for driving
progress externally, `animation.revert()` for cleanup. Whoever implements
new animation code this round (Agent 3) must independently confirm current
API against https://animejs.com/documentation/ before writing it, not copy
old-version examples — say so in the handoff. Recommendation, not a
mandate: keep the established convention from Revisions 2-3 — write
continuously-updating values (dwell progress fraction) directly as a style
property every frame, and reserve Anime.js for discrete state transitions
(engage/disengage, dwell complete, cancel) — avoids a second timing system
fighting the one logical dwell timer.

### GOAL 5 — detection quality and performance (verification, not new work)

No new model, no duplicate camera processing — everything reuses the
existing single `detectForVideo` call per RAF tick. This round's audit
items: the dwell timer must live inside the existing per-frame update path
(no new setInterval/rAF loop — see DWELL doc), new listeners
(`visibilitychange` for dwell-cancel) must be cleaned up in `disable()`/
unmount alongside everything else, and dwell/select state must reset
correctly on `status === "error"` (STALE_FRAME_MS) the same way the old
pinch-based gesture state already did. **Performance numbers**: this
environment has no camera, so Agent 4 cannot produce real inference-timing/
frame-rate measurements and will not fabricate any — the final report gives
the user instructions for measuring it themselves (e.g. DevTools
Performance tab, or timing `detectForVideo` directly) rather than invented
numbers.

### Ownership for this revision

| Agent | Task | Owns |
|---|---|---|
| **Agent 1** | Verification-only: confirm the existing RAF loop has no overlapping/queued `detectForVideo` calls and no per-frame allocation growth; no code changes expected unless something's actually wrong | `web/src/hand/tracking/*` (unchanged unless a real bug is found) |
| **Agent 2** | Rewrite select/pinch logic in `gestureProcessor.ts`: index/middle select (hysteresis, stability window, fist rejection), the select/pinch priority rule, keep zoom kinematics as-is | `web/src/hand/gesture/*` |
| **Agent 3** | Dwell perimeter-tracing animation + calibration-panel color controls + rename pinch→select in overlay visuals/instructions + apply `INTERACTION_COLOR_CSS_VAR` throughout | `web/src/hand/overlay/*` |
| **Agent 4** (me) | `contracts.ts` (done), the dwell timer + select-event handling + color persistence/CSS-var application in `useHandPointer.ts`, the `DWELL_ELIGIBLE_ATTR` marker on `IconTile`, zoom context-gating fix (now keyed off live hover, not a select capture — select and pinch are independent gestures now), tests, verification | as before, plus `web/src/components/IconTile.tsx` |

Same non-overlap rule as before. `contracts.ts` is final for this round.

### Status

**Revision 4 integrated and verified (automated).** All four modules
landed, reviewed line-by-line by Agent 4 (not just trusted), and wired
together. `npx tsc -b`, `npm run build`, and `npx vitest run` (57/57
across three suites) all clean. Manual browser check (Chrome automation,
mouse input, no camera): calibration panel's new color presets/custom
picker/reset all apply immediately and persist; select/zoom instruction
text present and correctly distinguishes the two gestures; all 9 sidebar
nav links (and nothing else) carry `data-hand-dwell`; no new console
errors. Two real bugs were found and fixed by Agent 4 during this pass:
(1) the dwell target-switch debounce also delayed the very first
null→target commit, making dwell start ~150ms late every time; (2) the
per-frame dwell-eligibility check used a simplified local phase guess
that ignored armed/dragging/zooming, so dwell could keep progressing
during an active select gesture -- fixed with a live `phaseRef`/`cursorRef`
kept in lockstep with every phase-setting call site. Both are covered by
regression tests now.

**Not verified by anyone yet, needs the user's physical camera on
return**: the index/middle select gesture's feel and thresholds, the
select/pinch priority rule under real ambiguous hand poses, dwell timing
and jitter tolerance against real tracking noise, and all Goal 4 animation
polish in motion. See the real-camera checklist in Agent 4's final report
to the user.

## Revision 5 — swatch/cursor bug fixes, accelerated dwell, cursor shape

**Confirmed working on the user's real iPhone/Camo camera: control region
and two-hand zoom (unchanged again this round).** `contracts.ts` changed
again -- re-read it, especially the rewritten DWELL doc (the algorithm
changed from a single elapsed/duration division to per-frame rate
integration) and the new `isSelecting` field on `HandPointerState`.

### Bug 1 — color swatches render as ovals (root cause found, not guessed)

`web/src/styles.css` has a global `button { min-height: 44px; padding: 0
var(--space-4); }` reset (a deliberate tap-target-size rule for ordinary
buttons). `.calibration-swatch` (`calibrationPanel.css`) sets
`width/height: 28px` but never overrides `min-height` (or `min-width`) --
since `.calibration-swatch`'s class selector has higher specificity than
the bare `button` element selector, adding `min-width: 28px; min-height:
28px;` to `.calibration-swatch` fixes it outright (confirmed by reading
both files side by side, not by guessing). Agent 3: apply this, then
double-check spacing/selected-indicator/keyboard-focus per the user's
request while in there.

### Bug 2 — cursor doesn't visually change between fingers-apart and select-engaged

Root cause: `HandCursorOverlay.tsx` keys the "engaged" look off
`data-phase="armed"|"dragging"`, and `phase` only becomes `"armed"` once a
target has actually been captured at `selectstart` (see
`useHandPointer.ts`). Bring your fingers together over empty space or a
non-interactive area and `phase` never leaves `"pointing"` -- so nothing
changes visually even though the gesture is genuinely happening. Fix: a
new `isSelecting: boolean` on `HandPointerState` (Agent 4, passes
`GestureProcessor.isSelecting` straight through every frame) is the
correct signal for cursor rendering -- switch the dot's neutral/engaged
styling to key off `isSelecting`, not `phase`. Per the user's explicit
instruction, do NOT compute finger-together-ness independently in the
overlay (no second detector) -- this field IS the already-confirmed state,
just finally wired through.

### GOAL 1 — cursor shape setting + swatch fix

New `CursorShape` (`"square" | "circle" | "rounded-square" | "diamond"`),
`cursorShape`/`setCursorShape`/`resetCursorShape` on `HandPointerApi`
(Agent 4 handles persistence, same pattern as color/region). Agent 3:
render the four shapes (labeled previews in the calibration panel, applied
to the actual cursor dot via CSS only -- clip-path/border-radius variants
on the SAME centered element, never a different anchor point) and fix Bug
1. Color swatches stay square regardless of cursor shape -- unrelated
settings, don't let them interact.

### GOAL 2 — cursor state feedback (Bug 2 above)

Neutral (fingers apart): outlined, unfilled. Engaged (`isSelecting`):
filled with the interaction color plus a distinct ring -- keep it
distinguishable by shape/fill, not color alone, since the color itself is
user-customizable. Activation: the existing brief pulse, unchanged.
Tracking lost/cancelled: `isSelecting` (and dwell) already clear
immediately in that case (Agent 4's side) -- just make sure the visual
has no lingering transition that makes it look like it's still engaged.

### GOAL 3 — accelerated dwell (supersedes Revision 4's dwell/select interaction)

Full algorithm is the DWELL doc in `contracts.ts` -- read it, this
paragraph is a summary, not the spec. Current normal duration is
`DWELL_DURATION_MS = 2000` (confirmed from the existing code, not
assumed); new `DWELL_FAST_DURATION_MS = 800` (~40%, per the user's
example). Progress is now a single accumulator integrated every frame at
whichever rate applies THIS frame (`dt / DWELL_DURATION_MS` normally,
`dt / DWELL_FAST_DURATION_MS` while `isSelecting`) -- not two separate
timers, not a restart on rate change. For dwell-eligible targets
specifically, a select gesture no longer goes through the ordinary
capture/click pipeline at all (Agent 4, in `useHandPointer.ts`'s
`selectstart` handling) -- it's entirely absorbed by dwell's acceleration,
which is what makes "release after dwell activation must not click again"
and "a quick close/release must not bypass progress via the release-to-click
handler" true by construction rather than by extra bookkeeping. Both
duration constants are kept as named, documented constants (matching how
`DWELL_JITTER_TOLERANCE_MS` already works) -- read as "configurable in the
existing settings" in the code sense, not as a request for new UI sliders;
flag it if that reading is wrong. Agent 3's existing dwell-border rendering
needs no logic changes -- it already just renders whatever `dwellProgress`
says, and that stays true regardless of how the rate now varies.

### GOAL 4 — cancellation/priority

Mostly already correct from Revision 4 (jitter tolerance, nested-element
resolution, tab-visibility/modal/disabled/removed-target cancellation,
zoom-suppresses-dwell) -- re-verify it still holds now that dwell also
reads `isSelecting`, and add regression coverage for the
navigation-spillover case described in the DWELL doc's "bypassed" section.

### GOAL 5 — Anime.js, re-confirm each round

Same instruction as every revision: confirm current v4 API against
https://animejs.com/documentation/ (and now also
https://github.com/juliangarnier/anime per the user's added source) before
writing new animation code, and check the installed version
(`animejs@4.5.0` as of Revision 4) hasn't changed. State what was checked
in the handoff, even if the answer is "confirmed unchanged from last
round." New animation surface this round: cursor shape/state transitions,
and settings-panel/shape/color selection transitions.

### Ownership for this revision

| Agent | Task | Owns |
|---|---|---|
| **Agent 1** | No changes expected (nothing this round touches tracking/frame shape) -- FYI only | `web/src/hand/tracking/*` |
| **Agent 2** | No changes expected (`GestureProcessor.isSelecting` already exists and is correct; nothing here touches gesture math) -- FYI only, flag if a re-read of the new dwell doc surfaces something | `web/src/hand/gesture/*` |
| **Agent 3** | Both bug fixes, cursor-shape rendering + picker UI, dwell/select visual updates, Anime.js re-confirmation | `web/src/hand/overlay/*` |
| **Agent 4** (me) | `contracts.ts` (done), `isSelecting` wiring, cursor-shape persistence, the rate-based dwell rewrite + dwell-target select-pipeline carve-out in `useHandPointer.ts`, tests, verification | as before |

### Status

**Revision 5 integrated and verified (automated).** `npx tsc -b`, `npm run
build`, `npx vitest run` (67/67 across three suites) all clean. Manual
browser check (Chrome automation, mouse input, no camera): color swatches
confirmed rendering as uniform circles (root-cause fix verified visually,
not just by reading the CSS), the new cursor-shape picker renders and
persists correctly (tested switching to "diamond", confirmed in
localStorage), no new console errors. Both root-caused bugs (oval
swatches, cursor not showing select-engaged state) fixed exactly as
diagnosed. Rate-based accelerated dwell implemented with dedicated tests
for: normal-rate progress, accelerated-rate progress, switching rates
mid-dwell with no reset/jump, and early activation under the fast
duration. The dwell-eligible-target select-pipeline bypass (the mechanism
that makes "release after dwell activation must not click again" true by
construction) has dedicated regression coverage too.

**Not verified by anyone yet, needs the user's physical camera on
return**: the accelerated-dwell feel and the two duration defaults, the
cursor shape/state visuals in motion, and whether the fist-adjacent
finger poses during real hand movement trigger the priority rule more
than expected (a known, documented tradeoff, not new this round). See the
real-camera checklist in Agent 4's final report to the user.
