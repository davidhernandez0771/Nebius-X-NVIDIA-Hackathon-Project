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
| `--sant-dur-power` | 860 | the whole story ↔ app crossing, dust included (1400 before sprint 9) |

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
| `--sant-stagger-sant` | 140 | the S·A·N·T units (logo, step rail) |
| `--sant-stagger-cross` | 50 | the logo symbol's parts lighting in the crossing |

## 2. Choreography

| Moment | What moves | Tokens | With motion off |
|---|---|---|---|
| Hover (button, link, row) | background / colour tint | dur-2, ease-out (CSS) | instant tint |
| Press | `scale(0.97)` on press, back on release | dur-1 / dur-2, ease-out (CSS) | no scale |
| Focus | outline appears; never animated | — | same |
| Badge "live" dot | opacity pulse 1 → 0.35, 1.6 s loop | CSS keyframes | steady dot |
| Toast in / out | `translateY(12px)` + opacity in; opacity out | dur-4 ease-out / dur-3 ease-in | appears and disappears |
| Route, same mode | view-transition cross-fade of `main`; nav and rail stay (named) | dur-3, ease-out | instant |
| Story ↔ app, either way | **the crossing** (§4), on every link, back/forward and `navigate()` | dur-power | a quick cross-fade (160 ms) |
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

## 4. The crossing, "power on" (story ↔ app)

Sprint 9 feedback: going from the light story pages to the dark app pages (and back) was too abrupt.
Every navigation that crosses between the two now plays one designed transition, in either
direction, in `--sant-dur-power` (860 ms). The phases come from a pure function,
`powerOnPlan(reduced)` in `web/src/sant/motion/powerOn.ts`; which pages are which, which clicks
cross and how full each cover cell is come from `web/src/sant/motion/crossing.ts`. Both are
unit-tested. `PowerOn.tsx` plays it.

| t (ms) | Phase | What happens |
|---|---|---|
| 0 | cover | The page dissolves into a dot matrix (18 px square cells) of the **other** mode's ground, in a wave from the clicked link (each cell grows over 160 ms, ease-out, with a little jitter) |
| 80 | gather | Dust in the other mode's text colour starts to gather into the logo symbol (`logoSymbol.ts`). Step u's dust lands at 340 + u × 50 ms |
| 340 | navigate | The cover is solid; the route changes under it and the page scrolls to the top |
| 340–490 | light | Each part of the symbol lights as its dust lands (stagger-cross); the original in the accent |
| 560 | reveal | The cover powers off: it breaks into the same dot matrix and the dots shrink away over the new page, 300 ms. With the View Transitions API this is a CSS mask on the old snapshot (`:root[data-crossing="reveal"]`); without it the canvas shrinks its own cells in a wave from the centre |
| 860 | done | The overlay is gone; focus moves to the new page's `<h1>` |

- **Which pages:** paper = `/site`, `/site/results`, `/design`; volt = `/robots`, `/review2`,
  `/site/record-hud`, `/design/app` (`siteModeOf`). Other routes are left alone.
- **Links need nothing special.** `PowerOnProvider` (in `SantRoot`) catches, in the capture phase, any
  plain left click on a same-origin, same-tab link whose target is on the other side. React Router's
  `<Link>` skips a click that was already handled.
- **Crossings it didn't start** (back/forward, or code calling `navigate()`) get the second half: a
  layout effect puts the full cover up before the new page paints, then reveals it.
- **`usePowerOn().start(to, from)`** still works for buttons. A target outside the new site (e.g.
  `/pm/record`) unmounts the provider, so the route changes at `done`, behind the full cover.
- **The dust** (`dust.ts`): targets are sampled from the symbol's paths with `Path2D`, at most 900
  specks.
- **No 2D canvas:** `data-dust="off"`; a plain cover grows from the click with `clip-path`, then fades.
- **Repeated clicks:** a second click, a click on the overlay, or Escape jumps to the end.
- **Reduced motion or Effects off:** a 160 ms cross-fade, as a view transition where supported
  (`:root[data-crossing="fade"]`, deliberately overriding the reduced-motion rule that turns view
  transitions off), else a fade from the new page's ground (`.sant-crossfade`).
- **Cost:** one 2D canvas (pixel ratio capped at 1.5), about 3,000 `fillRect`s a frame, for 0.86 s;
  the view-transition mask is composited. No WebGL context.

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
