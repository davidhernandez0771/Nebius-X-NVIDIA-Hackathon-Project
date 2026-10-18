# SANT motion system

Sprint 8, T5 Task 2. The tokens live in `web/src/sant/tokens.css` (CSS) and
`web/src/sant/motion/tokens.ts` (anime.js); `tokens.test.ts` checks that the two agree. The
research is in [`ui-motion-research.md`](ui-motion-research.md).

**Rule:** motion shows what changed, or draws attention once. Each page has **one** orchestrated
moment. Everything else is feedback to the user's own action.

## 1. Tokens

### Durations

| Token | ms | Use |
|---|---|---|
| `--sant-dur-0` | 0 | effects off / reduced motion (every token below collapses to this) |
| `--sant-dur-1` | 80 | press feedback |
| `--sant-dur-2` | 140 | hover, colour and state changes, toggles |
| `--sant-dur-3` | 200 | route cross-fade, popovers, a badge appearing |
| `--sant-dur-4` | 320 | toasts, panels, the step rail lighting a unit |
| `--sant-dur-story` | 600 | a story reveal (headline words, chart frame) |
| `--sant-dur-count` | 1100 | Stat counters, bar growth |
| `--sant-dur-power` | 1400 | the whole power-on, dust included |

Exits use the next shorter step: a toast enters in 320 ms and leaves in 200 ms.

### Easings

| Token | Curve | Use |
|---|---|---|
| `--sant-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | anything entering or answering the user (hover, press release, toasts in, counters, bars) |
| `--sant-ease-in` | `cubic-bezier(0.3, 0, 1, 1)` | leaving (toasts out, overlays out) |
| `--sant-ease-move` | `cubic-bezier(0.4, 0, 0.2, 1)` | moving between two on-screen states (rail unit, tab indicator) |
| `--sant-ease-emph` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | the story's big moments (headline words, the power-on cover) |

**No overshoot** (no back or elastic easing, no springs) on anything that shows a measured value.

### Stagger

| Token | ms | Use |
|---|---|---|
| `--sant-stagger-list` | 30 | list rows, badges |
| `--sant-stagger-text` | 70 | story headline words |
| `--sant-stagger-sant` | 140 | the S·A·N·T units (logo, step rail, power-on) |

## 2. Choreography

| Moment | What moves | Tokens | With motion off |
|---|---|---|---|
| Hover (button, link, row) | background / colour tint | dur-2, ease-out (CSS) | instant tint |
| Press | `scale(0.97)` on press, back on release | dur-1 / dur-2, ease-out (CSS) | no scale |
| Focus | outline appears; never animated | — | same |
| Badge "live" dot | opacity pulse 1 → 0.35, 1.6 s loop | CSS keyframes | steady dot |
| Toast in / out | `translateY(12px)` + opacity in; opacity out | dur-4 ease-out / dur-3 ease-in | appears and disappears |
| Route, same mode | view-transition cross-fade of `main`; nav and rail stay (named) | dur-3, ease-out | instant |
| Story → app | **power-on** (§4) | dur-power | instant route change, the rail already lit |
| App → story | a plain cross-fade (leaving the instrument is not an event) | dur-3 | instant |
| Story hero headline | words rise from a mask, once on load | dur-story, ease-emph, stagger-text | static |
| Stat counter | 0 → value, once, on first view | dur-count, ease-out | final value |
| Result bars | bars grow from 0 at the same speed; CI whiskers fade in after | dur-count ease-out; whiskers dur-3 after +150 ms | full bars and whiskers |
| Step rail | the active unit lights; done units stay lit, dimmer | dur-4, ease-move, stagger-sant on mount | lit state only |
| Logo | units light in sequence once | dur-4, stagger-sant | all lit |
| Scroll scenes (story) | anime.js `onScroll`: scrub (`sync: true`) only where it explains (copies multiplying); otherwise trigger once | per scene | the end state |

## 3. Effects on/off

- **When motion is reduced:** `reduced = prefersReducedMotion || effects === "off"`. This is
  `resolveMotion()` in `web/src/sant/motion/effects.ts`. It is pure and tested.
- **Where the choice is stored:** `localStorage["sant.effects"] = "on" | "off"`.
  - It is read in try/catch.
  - The default is `"on"`; the OS setting still wins when it says reduce.
- **What the provider does:** `MotionProvider` sets `data-effects="on|off"` and `data-motion="full|reduced"`
  on `<html>`. In CSS, `[data-motion="reduced"]` sets every `--sant-dur-*` to 0 ms and stops
  keyframe loops.
- **Hooks:** components read `useMotion()`, and anime.js code calls `if (reduced) { setEndState();
  return; }` before animating.
- **Lenis** is created only when `!reduced`, and is destroyed when that flips. Lenis's own
  `respectReducedMotion` (default `true`) is a second guard.
- **View transitions** are skipped when reduced. The CSS also disables
  `::view-transition-*` animations under `[data-motion="reduced"]` and
  `prefers-reduced-motion: reduce`.

## 4. The power-on (story → app)

Total `--sant-dur-power` (1400 ms; it was 900 ms before the dust). The phases come from a pure
function, `powerOnPlan(reduced)` in `web/src/sant/motion/powerOn.ts`, which is unit-tested.

| t (ms) | Phase | What happens |
|---|---|---|
| 0 | cover | A Volt overlay grows from the clicked button: `clip-path: circle(0 at x y)` → `circle(150% at x y)`, ease-emph, 420 ms |
| 100 | gather | Dust scattered over the screen starts to gather into the S·A·N·T mark. Unit u's dust lands at 700 + u × 140 ms (ease-emph, so no speck overshoots its target) |
| 420 | navigate | The overlay now covers the screen; the route changes to the app page |
| 700, 840, 980, 1120 | light | Each unit lights the moment its dust lands (stagger-sant 140 ms); the dust then fades over 200 ms |
| 1220 | reveal | The overlay fades out over 180 ms, ease-in; the app shell's own rail is already lit |
| 1400 | done | The overlay is removed; focus moves to the app page's `<h1>` |

- **The dust** (`web/src/sant/motion/dust.ts`, pure and unit-tested; drawn by `PowerOn.tsx`):
  - targets are sampled from each unit's letter, drawn off-screen in its own font at its own place;
  - at most 900 specks, on a canvas 2D with the pixel ratio capped at 1.5;
  - each speck drifts, then curls in along a slight arc, and turns teal as it settles.
- **No 2D canvas:** the overlay says `data-dust="off"` and the units light on the same timeline
  without dust.
- **Repeated clicks:** a second click, a click on the overlay, or Escape jumps to `navigate` and
  `done`.
- **Reduced motion or Effects off:** the plan is `[{ phase: "navigate", at: 0 }, { phase: "done",
  at: 0 }]`, with no overlay and no dust.
- **Cost:** `clip-path` and `opacity` on the overlay, plus one canvas for 1.4 s. Nothing else on
  the page animates during it.

## 5. Implementation notes

- **Presets** live in `web/src/sant/motion/presets.ts`:
  - `countUp(el, to, opts)`;
  - `growBars(bars, whiskers)`;
  - `lightSequence(units)`;
  - `revealWords(el)`.

  Each one:
  - returns a cleanup function;
  - takes `reduced`, and sets the end state synchronously when it is true;
  - uses the anime.js easings built from the same numbers as the CSS tokens (`cubicBezier(...)`).
- **Route helper:** `navigateWithTransition(navigate, to, { reduced })` in
  `web/src/sant/motion/viewTransition.ts`. It runs `document.startViewTransition(() =>
  flushSync(() => navigate(to)))` when supported and not reduced, and plain `navigate(to)`
  otherwise.
- **Frame time:** the design page shows a live frame-time readout, a rAF delta averaged over 60
  frames, so effects can be judged on this machine next to Isaac Sim.
