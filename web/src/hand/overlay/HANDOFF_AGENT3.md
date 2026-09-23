# Agent 3 handoff — hand-cursor overlay

## What was built

- `HandCursorOverlay.tsx` — `<HandCursorOverlay api={api} />`, `api: HandPointerApi`
  (from `contracts.ts`). Purely presentational; no tracking/gesture/hit-testing
  logic, no state beyond a couple of refs for animation bookkeeping.
- `handCursorOverlay.css` — imported directly by the component (`import
  "./handCursorOverlay.css"`), same pattern as `ScanViewer.tsx` /
  `scanviewer.css`. **No CSS wiring needed in `App.tsx`** — mounting the
  component is enough.

Renders three layers, all `pointer-events: none` (container and every child,
enforced via `.hand-cursor-overlay *` in the CSS):

- `.hand-cursor-dot` — the fingertip cursor. Position (`translate3d`) is
  written directly in a `useEffect` keyed on `cursor`, every time it changes
  — no CSS transition on transform, no per-frame Anime.js tween, so it never
  lags the hand. Anime.js only handles the discrete show/hide (opacity+scale)
  when `enabled && cursor !== null` flips.
- `.hand-cursor-ring` — highlight box around `hoverTarget.getBoundingClientRect()`.
  Geometry (`left/top/width/height`) is also written directly every `cursor`
  tick (piggybacks on the same tracked-frame cadence rather than a second
  rAF loop). A CSS transition on those four properties smooths gliding
  between two adjacent hover targets; Anime.js only drives opacity/scale on
  the null↔non-null edges (enter/exit), so the two never fight over the same
  property.
- `.hand-cursor-pulse` — one-shot activation burst. Fires when `phase` goes
  `"armed"` → anything except `"armed"`/`"dragging"` (i.e. a completed click,
  per the contract's phase semantics). Drag-end (`"dragging"` → `"pointing"`)
  intentionally gets no pulse.

`data-phase={phase}` on the dot and ring drives steady-state color (accent →
warm on armed/dragging) via plain CSS, no JS.

Reduced motion: every `animate()` call passes `duration: 0` under
`prefersReducedMotion()` (reused from `three/capability.ts`) instead of being
skipped outright, so the element still lands in its correct end state; the
position writes (the actual tracking) are never gated on this, per
requirement 9.

Also added, not explicitly assigned to anyone in the ownership table: a small
`.hand-cursor-status` pill (top-center, `pointer-events: none`) shown only
when `enabled && status is "loading" | "error"` — pure debug/demo aid, easy
to delete if redundant with something Agent 4 builds elsewhere.

## Deviations / open items for Agent 4

1. **No enable/disable toggle control in this component.** Requirement 1
   ("`pointer-events: none` on the container and every element inside it")
   is enforced literally, which means nothing in `HandCursorOverlay` can be
   clicked — so the opt-in toggle the spec requires ("a visible way to
   disable it again") has to live in real app chrome (a normal button
   somewhere in `App.tsx`/nav) calling `api.enable()` / `api.disable()`, not
   inside this overlay. Flagging since the ownership table doesn't assign it
   explicitly.
2. Built and type-checked against the `HandPointerApi` type directly (no real
   `useHandPointer` exists yet) — `npx tsc -b` and `npm run build` both pass
   clean as of this handoff. Not runtime-verified against a live hook/camera
   yet, since that doesn't exist in this branch.
3. Ring position tracking is piggybacked on `cursor` updates (fires whenever
   a tracked frame arrives), not a separate rAF/resize/scroll listener. Fine
   while hand tracking is active; if `hoverTarget` can change out from under
   the ring with tracking paused (unlikely given the state machine), the ring
   would stale until the next tracked frame. Not expected to matter in
   practice — call out only if you see it drift in testing.

## How to wire it in

```tsx
// App.tsx, outside <Routes>
const api = useHandPointer(); // Agent 4's hook
<HandCursorOverlay api={api} />
```

## How this was verified

`cd web && npx tsc -b` and `npm run build` — both clean. No live-camera /
visual verification possible without the real tracking + integration layers;
flagging per the plan's instruction not to claim what wasn't tested.

---

## Revision 3 — two-hand zoom visuals, calibration UI, polish

By the time this landed, `contracts.ts`, `gestureProcessor.ts`,
`useHandPointer.ts`, and `ScanViewer.tsx` had all already landed Revision 3
on this branch, so this was built and verified against the real integration
layer (not just the type), including a full `npm run build` and
`npx vitest run` pass at the end.

### 1. Two-hand zoom visuals (`HandCursorOverlay.tsx`)

Added, driven by the new `twoHandZoom` field (non-null only during
`phase === "zooming"`):

- `.hand-zoom-marker` × 2 — one ring per hand at `primaryPoint`/`secondaryPoint`.
- `.hand-zoom-line` — a dashed SVG line between them (`x1/y1/x2/y2` written
  directly, not a CSS property, so no transform conflict is even possible here).
- `.hand-zoom-badge` — signed percentage (`ratio` vs. 1) at the midpoint, with
  a CSS-drawn chevron that flips per `ratio >= 1` ("in", accent) vs. `< 1`
  ("out", warm color). No emoji, matches the existing token palette.

All four positions are written directly every `twoHandZoom` tick (same rule
as the cursor dot). Entering/leaving `"zooming"` fades all four in/out via a
single `animate()` call over an array of targets — **opacity only**, never
`scale`/`transform`, specifically because these elements' *position* is also
written to `left`/`top` every frame; touching `transform` from both places on
the same element would have them stomp each other (see bug fix below).

The standalone cursor dot and hover ring are hidden while `zooming` (their
own `showCursor`/`showRing` booleans now also require `!zooming`) — during a
two-hand gesture the primary hand's zoom marker already marks that same
point, and one-hand hover/click has no meaning while zoom is active per
contracts.ts, so keeping both on screen was just visual noise.

**Bug fix while doing this, applies to Revision 2 code too:** the cursor dot
used to write its position via `transform: translate3d(...)` directly *and*
have Anime.js animate `scale` (also a `transform` write) on the same element
for show/hide. Both target the same CSS property, so whichever fired last on
a given frame won — during the ~180ms show/hide window the dot could
visibly jump back to a stale position. Fixed by moving position to
`left`/`top` (the dot's centering `margin` already assumed this) and leaving
`transform` entirely to Anime.js. Applied the same left/top-only convention
to the new zoom markers/badge up front so they never had the bug.

**Second polish fix:** the hover ring's `left/top/width/height` CSS
transition (added for smooth glide between two adjacent hover targets) was
also playing on the ring's *first* appearance, i.e. it would visibly slide in
from wherever it was last parked instead of snapping straight to the new
target while fading in. Now suppressed (`transitionProperty = "none"`,
forced reflow, then restored) specifically on the null→target edge; glide
between two already-visible targets is unaffected.

### 2. Calibration UI (`CalibrationPanel.tsx` + `calibrationPanel.css`, new files)

`<CalibrationPanel api={api} open={open} onClose={onClose} />` — a real,
normally-interactive popover (NOT part of the pointer-events:none layer),
docked bottom-right, stacked directly above `HandToggle` (same corner,
z-index 10050 vs. its 10000). Takes `open`/`onClose` as asked so Agent 4's
trigger button controls it from outside; builds no trigger of its own.

- **Region size** — one range input driving both `width` and `height`
  together (`setControlRegion({ width: v, height: v })`), 20%–90%, default
  55%.
- **Vertical position** — one range input on `centerY`, 0.3–0.75 range so it
  can't be pushed degenerately off-frame; labeled "Raised/Centered/Lowered"
  rather than a raw number.
- **Reset** — calls `resetControlRegion()` directly.
- **Preview** — collapsible (`<details>`), draws the region rectangle to
  scale over a placeholder 16:9 frame using plain CSS percentages from
  `controlRegion`. **This is schematic, not a live camera feed** — the
  `TrackingAdapter` contract doesn't expose the video element, and per your
  instructions I didn't reach into Agent 1's tracking module to add one.
  Labeled clearly in the UI ("Schematic preview, not a live camera feed") so
  it isn't mistaken for the real thing. Flagging per your note in case a live
  feed is wanted enough to justify a contract change.
- Doesn't touch `localStorage` — only calls the three `HandPointerApi`
  methods, as specified.
- Keyboard: native `<input type="range">` (arrow-key adjustable for free),
  Escape closes, focus moves into the panel on open. No outside-click-to-close
  — deliberately, since a hand-driven `.click()` landing elsewhere in the app
  while this is open shouldn't have a surprising side effect on it; the
  visible × button and Escape are the only ways out.

### 3. General polish (GOAL 3)

Covered above (transform-conflict fix, ring first-appearance snap) plus the
zoom visuals themselves. Didn't touch the existing pinch-ring/activation-pulse
behavior beyond that — they were already solid from Revision 2 and the plan
says prioritize clarity over cleverness, not rewrite what already works.

### Verification

- `npx tsc -b` — clean, whole project (all four modules, including this one,
  landed and compiling together by the time this was done).
- `npm run build` (`tsc -b && vite build`) — clean.
- `npx vitest run` — passing (no new tests added here; Agent 3 wasn't asked
  to add any in the Revision 3 ownership table, unlike Agents 1/2).
- **No camera on this machine** — could not visually exercise the actual
  two-hand zoom gesture or the real hover/click loop end to end. Reasoned
  through the code paths (transform-conflict fix in particular was caught by
  re-reading the code, not by seeing it glitch) rather than observed live;
  flagging explicitly rather than claiming a visual check that didn't happen.
- Did not mount `CalibrationPanel` into a running `App.tsx` to eyeball it,
  since `App.tsx` is your file and I didn't want a concurrent edit there,
  even temporarily, colliding with your own work on it. Layout/CSS is
  reasoned about (matches `tokens.css` conventions, checked against
  `HandToggle`'s existing bottom-right dock) but not eyeballed in a browser.

---

## Revision 4 — dwell activation, interaction color, select rename

Done while Agent 2 (select/pinch gesture rewrite) and you (dwell timer,
select rewiring, color persistence, `IconTile.tsx`) were still in progress —
`npx tsc -b` currently shows pre-existing errors in
`gesture/gestureProcessor.test.ts` and `integration/useHandPointer.test.ts`
(old `PinchEvent`/`isPinching` API) and one failing suite in
`npx vitest run` (same cause) that are **not** in any file I touched;
confirmed by grepping the error output for `overlay`/`calibration` — zero
hits. Re-verify once those land.

### Anime.js API check (GOAL 4, done before writing any new animation code)

Fetched `https://animejs.com/documentation/animation` directly (not
remembered/assumed) and confirmed for the installed `animejs@4.5.0`:

```js
import { animate } from 'animejs';
const animation = animate(targets, parameters); // returns a JSAnimation
```

`JSAnimation` exposes `play()/pause()/reverse()/seek()/reset()/revert()` —
matches the `animate()` + `.revert()` pattern already used throughout this
file since Revision 2/3, so no changes were needed to the existing calls.
Also fetched the SVG-attributes animatable-properties page to confirm SVG
attributes are animatable via the same `animate(el, { attr: value })` form
(confirmed, general case) — not used here, though: per the plan's own GOAL 4
recommendation, `dwellProgress` is written directly as a raw
`stroke-dashoffset` style write every tracked frame (see below), the same
convention as `cursor`/`hoverTarget`/`twoHandZoom` already established;
Anime.js is reserved for the dwell border's enter/exit only.

### 1. Dwell activation visual (`HandCursorOverlay.tsx`)

New `<svg className="hand-dwell-svg"><rect className="hand-dwell-ring" .../></svg>`,
geometry + progress written every tracked frame (piggybacked on the existing
per-frame effect, alongside the hover ring):

- `x/y/width/height` from `dwellTarget.getBoundingClientRect()`.
- `rx`/`ry` from `getComputedStyle(dwellTarget).borderTopLeftRadius`, read
  from the real target rather than hard-coding `--radius-tile`'s 20px, so it
  can't drift out of sync with `tokens.css` if that ever changes.
- **Progress, without rounded-rect perimeter math**: the `<rect>` has
  `pathLength={1}` (set once in JSX) and `stroke-dasharray="1"`, which
  redefines the rect's total stroke length as exactly 1 unit *regardless of
  its actual geometric perimeter* (SVG2, standard in evergreen browsers) —
  so drawing `dwellProgress` fraction of the perimeter is just
  `stroke-dashoffset = 1 - dwellProgress`, no per-corner arc-length
  computation needed at all.

Enter/exit (`showDwell = enabled && dwellTarget !== null`) fades the border
via Anime.js, same pattern as the hover ring. The confirmation flourish on
`dwellactivate` reuses the exact same pulse element as select-activation
(pulled the shared logic into a small `firePulse(point)` used by both), just
positioned at the dwelled target's rect center instead of the cursor.
Subscribes to `onDwellEvent` directly (not inferred from `dwellProgress`
reaching 1) specifically because the contract says the on-screen animation
completing must never itself be what fires the action.

### 2. Interaction color settings (`CalibrationPanel.tsx` + `calibrationPanel.css`)

New section: 5 preset swatches (`DEFAULT_INTERACTION_COLOR` first, then 4
hues spread across the wheel for a decent chance one contrasts against
whatever's actually behind the cursor) + a native `<input type="color">` for
custom + a dedicated "Reset color to default" button (separate from the
existing region-reset button, since `resetControlRegion()`/
`resetInteractionColor()` are independent contract methods — renamed the
region button to "Reset region to default" once there were two, so neither
reads as resetting everything). All three just call
`setInteractionColor`/`resetInteractionColor` — no `localStorage` touched
here, per the contract. The native color input is visually hidden
(`opacity: 0`) so the wrapping label's own background can preview the
current color as one of the round swatches, with an explicit
`:focus-within` outline on the wrapper so keyboard focus doesn't become
invisible along with it.

Also added a short instructions paragraph ("bring index and middle fingers
together to select... pinch thumb and index on both hands... to zoom") —
the plan asked to "update any on-screen instruction text" distinguishing the
two gestures, and there wasn't any before this revision anywhere in the
overlay, so I added a minimal one in the calibration panel (the closest
thing this app has to a "how it works" surface) rather than cluttering the
pointer-events:none overlay with persistent copy. Flagging as a judgment
call, easy to move/cut if you'd rather it live elsewhere.

### 3. Applying `INTERACTION_COLOR_CSS_VAR` + select rename (`handCursorOverlay.css`, code comments)

Added one `:root` block deriving `--hic`/`--hic-soft`/`--hic-line`/`--hic-glow`
from `var(--hand-interaction-color, #ff9a2e)` via `color-mix()` (replaces
what used to be separate baked-in `--warm-soft`/`--warm-line` tokens; the
fallback matches `DEFAULT_INTERACTION_COLOR` exactly so this works even
before your JS sets the variable). Every one-hand-interaction visual reads
it now: cursor dot (all phases), hover/select ring (all phases), the new
dwell border, and the activation pulse.

**Scope decision, worth double-checking against your intent**: contracts.ts
names four things — "select-engaged cursor/ring, hand-hover highlights,
dwell-progress borders, and activation confirmation" — as separate items,
which I read as *all* states of the cursor/ring (not just armed/dragging)
sharing one color now, matching "keep shape/size/progress as independent
state signals so color is never the only cue" (that requirement only makes
sense if color stops being one of the signals). So the ring/dot no longer
change color between hover and engaged — only size (box-shadow spread on the
dot, border-width on the ring) does. **Two-hand zoom markers/line/badge were
deliberately left out of this** — they still use the fixed `--accent`/`--warm`
two-tone direction cue, since (a) contracts.ts's Revision 4 color section
doesn't mention zoom at all, (b) zoom is explicitly called out elsewhere as
"a separate gesture family this revision doesn't touch", and (c) recoloring
just the "out" half to a user color while "in" stays fixed accent would read
as a broken/inconsistent two-tone cue rather than a clean one. If this
reading's wrong, it's a small, contained fix (delete the zoom exclusion, add
a couple more `var(--hic)` swaps) — said so in case you disagree.

**Contrast backing** (new, both dot/ring and dwell border): a dark+light
double outline (`box-shadow` layers on the dot/ring, two `drop-shadow()`
filters on the SVG dwell stroke, since SVG strokes can't stack box-shadows)
underneath the actual interaction color — a map-pin-halo trick, since one
fixed color can't guarantee contrast against arbitrary real camera/3D
content on its own, but a dark ring + a light ring together very likely has
at least one edge that shows up regardless of what's behind it.

**Select rename**: grepped this directory for "pinch" after finishing —
only remaining hits are in the two-hand-zoom CSS section, which is correct
(that gesture is still literally thumb/index pinch, unchanged this
revision) and now has a comment explicitly saying so to head off the same
question later. Code comments describing the one-hand gesture ("pinch-down",
etc.) were updated to "select-down" etc.

### Verification

- `npx tsc -b` — zero errors attributable to any file in this directory
  (checked by grepping the output for `overlay`/`calibration`); remaining
  errors are Agent 2/4's in-progress Revision 4 modules, expected mid-flight.
- `npx vite build` (bypasses the `tsc -b` gate, since the whole project
  isn't clean yet) — succeeds, confirms my JSX/CSS/SVG is all syntactically
  sound and bundles.
- `npx vitest run` — the one failing suite is `gestureProcessor.test.ts`
  (Agent 2's, pre-existing, not mine); no new tests added on my side this
  round either (not asked to — visual work, and the plan says so explicitly).
- **No camera on this machine, still** — dwell timing/activation and the
  select-vs-pinch priority rule could not be exercised live; reasoned
  through against contracts.ts instead. Flagging again rather than letting
  the Revision 3 "no camera" caveat go stale/implicit.
- Did not mount either component into a running `App.tsx`, same reasoning
  as Revision 3 (your file, avoided a concurrent edit there).

---

## Revision 5 — swatch/cursor bugs, cursor shape, accelerated dwell (rendering side)

This round landed against the REAL `useHandPointer.ts`/`gestureProcessor.ts`
(already on disk with `isSelecting`/`cursorShape` wired through) rather than
just the type, and it shows: `npx tsc -b` is fully clean project-wide and
`npx vitest run` is 67/67 across all three suites, both checked after my
changes with nothing else in flight.

### Anime.js re-confirmation (GOAL 5)

Installed version unchanged: `animejs@4.5.0` (checked `web/package.json`
and `node_modules/animejs/package.json` directly, not assumed). Re-fetched
both requested sources:

- `https://animejs.com/documentation/` — core API unchanged from my
  Revision 4 check: functional `animate(target, properties)`, `JSAnimation`
  return value with `play/pause/reverse/reset/seek/revert`, SVG attributes
  animatable.
- `https://github.com/juliangarnier/anime` (new source this round) — its
  own README usage example is `import { animate, stagger } from 'animejs';
  animate('.square', {...})`, matching the same v4 pattern; no breaking
  changes since 4.5.0 mentioned.

Net: nothing changed, and I ended up not writing any *new* `animate()`
calls this round anyway (see below) — the "new animation surface" the plan
flagged (shape/state transitions, picker selection transitions) turned out
to fit the existing CSS-`transition` convention already used for short,
steady-state property changes throughout this file (the armed/dragging
color swap in Revisions 3-4 was always CSS-transition-based too, never
Anime — Anime here has consistently meant "something appearing/
disappearing," not "a property nudging between two values"). I did fix two
transitions that were declared but inert (see "Selection-transition
polish" below) rather than reach for Anime.js as a replacement.

### Bug 1 — oval swatches (`calibrationPanel.css`)

Applied your fix exactly: `min-width: 28px; min-height: 28px;` added to
`.calibration-swatch`, with a comment explaining *why* min-height overrides
a plain `height` regardless of selector specificity (a min/max constraint
always wins over the unconstrained property, this was never actually a
specificity problem despite how it reads at first glance). Also, per the
user's request to check spacing/selected-indicator/keyboard-focus/labels
while in there:

- **Selected indicator**: was `border-color` — visually disappears when the
  swatch's own color is close to the app's default border tint (e.g. the
  amber preset against the default indicator color). Switched to an
  *outside* `outline` instead, which sits against the panel's own
  background regardless of the swatch's fill.
- **Focus**: added an explicit `:focus-visible` outline (accent teal, to
  stay visually distinct from the white "selected" outline) — wasn't styled
  at all before, relying on the browser default, which is inconsistent
  across browsers and easy to lose track of against a `border-radius: 50%`
  button.
- **Labels**: preset `aria-label` now includes the hex value alongside the
  name (`"Amber (default), #ff9a2e"`), and the custom swatch's label/input
  now states the live current hex too, not just "Custom color" — a screen
  reader user previously had no way to hear what the custom color actually
  *is*.
- **The custom-color swatch had no "selected" indicator at all** even when
  it's genuinely the active color (i.e. current color doesn't match any
  preset) — added one (`data-active`, computed by comparing `interactionColor`
  against every preset), reusing the same outline treatment.

### Bug 2 — cursor didn't reflect select-engaged state (`HandCursorOverlay.tsx` + `handCursorOverlay.css`)

Exactly the fix specified: the dot (and, for consistency, the hover ring)
now key their engaged look off `isSelecting` from `HandPointerApi`, read
straight through — no independent finger-together detection added in the
overlay, per the explicit instruction. Did not just swap the attribute
name; restructured the dot into two nested elements to do it correctly
alongside GOAL 1 (see next section) without reintroducing a transform
conflict:

- `.hand-cursor-dot` (outer, unchanged position/anchor semantics — this is
  still "the same centered element" contracts.ts requires): owns `left`/`top`
  (written every frame, as before) and the contrast-backing halo. Gains one
  new box-shadow layer, a crisp opaque ring, when `data-selecting="true"` —
  this is the "distinct ring" GOAL 2 asks for, layered onto the existing
  soft halo rather than replacing it.
- `.hand-cursor-dot-fill` (new, nested, `position: absolute; inset: 0` — so
  it has NO coordinates of its own, it just fills the parent's box):
  outlined/transparent when neutral, filled with `--hic` when
  `data-selecting="true"`. This is what "Neutral: outlined, unfilled.
  Engaged: filled" means concretely.

Also checked the "no lingering transition makes it look stuck" ask
specifically: the fill's `background` transition is 150ms, and on tracking
loss the WHOLE dot fades out via the existing ~180ms opacity/scale Anime.js
transition at the same time — the short background transition is fully
masked by that concurrent fade, so there's nothing to see "stuck." Didn't
change that transition; it's what makes ordinary engage/disengage feel
smooth rather than jarring, and it isn't the bug.

**Ring**: `.hand-cursor-ring`'s engaged look was also `data-phase`-keyed
before. Switched it to `data-selecting` too, even though it wasn't
literally broken (the ring's only ever visible when `hoverTarget` is
non-null, which — pre-Revision-5 — always implied a captured target, so
`phase` and `isSelecting` never actually disagreed for this specific
element). Did it anyway for consistency: same underlying signal, no reason
to leave one element on the old, indirect one now that a more direct
signal exists.

### GOAL 1 — cursor shape (`HandCursorOverlay.tsx`, `CalibrationPanel.tsx`, both CSS files)

The nested-fill split above is what makes this safe: shape (`clip-path`/
`border-radius` on `.hand-cursor-dot-fill`, keyed off `data-shape` on the
parent) never touches the outer element's position or its halo box-shadow.
This matters concretely for **diamond**: `clip-path` crops an element's own
box-shadow away along with its content, so if shape and halo lived on the
same element, the diamond cursor would have had no contrast backing at all.
Square/rounded-square/circle only ever needed `border-radius` (which does
*not* clip box-shadow), so this split was only strictly required for one of
the four shapes — applied it to all four anyway rather than special-case
just diamond, for one consistent code path.

Calibration panel gets a fourth section (after region, after color):
four labeled preview buttons (`CURSOR_SHAPES` from contracts.ts, so this
can't drift out of sync if a shape is ever added/removed there), each a
small `<span>` styled with the *same four CSS rules*, duplicated into
`calibrationPanel.css` rather than shared — these are two independent
components/stylesheets by design (this panel doesn't import the overlay's
CSS at all), and it's four short rules, not worth coupling them over.
`resetCursorShape()` gets its own reset button, same pattern as region/color.

Confirmed color swatches are unaffected by shape (they're `.calibration-swatch`,
a completely separate class from `.calibration-shape-preview`, always
`border-radius: 50%` regardless of `cursorShape` — nothing in either
component reads `cursorShape` anywhere near the color section).

### GOAL 3 — accelerated dwell

No logic changes needed on my side, as the plan predicted — `dwellProgress`
was already rendered generically (`stroke-dashoffset = 1 - dwellProgress`,
written every tracked frame) with no assumption anywhere about a fixed
rate or a fixed duration constant. Manually re-read the dwell-rendering
effect specifically looking for a hidden fixed-rate assumption before
calling this done — didn't find one. The one behavior change I did verify
matters: dwell-eligible targets now also show the engaged cursor
(`isSelecting` true) while accelerating, since that's the same signal Bug
2 just wired up correctly — no special-casing needed, it falls out of the
Bug 2 fix automatically once dwell targets stopped being excluded from
`isSelecting`'s normal meaning.

### GOAL 4 — cancellation/priority

Nothing owned by this directory changes here (it's all `useHandPointer.ts`
state-machine logic on your side) — re-read the updated DWELL doc in
contracts.ts per the plan's ask and didn't find anything that implied a
rendering-side change; flagging that I read it, not silently skipping it.

### Selection-transition polish (part of GOAL 5's "new animation surface")

Found and fixed two transitions that were declared but inert: the color
swatches' and shape options' "selected" indicators (`outline`/`border-color`)
had a `transition` property listed, but the base rule never set a starting
value for that property, so the browser had nothing to interpolate from and
the indicator just popped in instantly instead of fading in. Fixed by
giving both a transparent base value (`outline: 2px solid transparent` /
already had `border: 2px solid transparent`) so the existing transitions
now actually animate. Plain CSS, not Anime.js — consistent with how every
other steady-state property change in this codebase has been handled (see
the Anime.js section above for why).

### Verification

- `npx tsc -b` — clean, whole project, nothing in flight elsewhere this
  time (confirmed by running it standalone with no other errors present).
- `npx vite build` — clean.
- `npx vitest run` — 67/67 across `handFrameBuilder.test.ts` (5),
  `gestureProcessor.test.ts` (26), `useHandPointer.test.ts` (36). No new
  tests added on my side (visual work, not asked to this round either).
- **Still no camera on this machine** — could not visually confirm the
  filled/outlined cursor distinction, the four shapes rendering correctly
  on a moving cursor, or the accelerated-dwell feel in practice. Reasoned
  through the code and cross-checked against contracts.ts instead of
  observing it. Flagging again, explicitly, rather than letting this go
  unsaid because it's the third time.
- Did not mount either component into a running `App.tsx`; same reasoning
  as every prior round.
