# UI and motion research for the SANT website (sprint 8, T5 Task 1)

Written 2026-10-17, before any code, for the split look the user chose ("Combo 2, split by page"):
**Field Notes** (paper) on the story pages and **Volt** (dark) on the app pages. Both specs build on
it: [`design-system.md`](design-system.md) and [`motion.md`](motion.md).

**How it was checked:**
- **Libraries:** facts about anime.js and Lenis come from the official docs and from the **installed
  type definitions** (`web/node_modules`: anime.js **4.5.0**, Lenis **1.3.26**, React Router
  **6.30.6**). Those are the versions we ship.
- **Web pages:** some returned only their titles to the fetch tool (Material 3, Google Fonts
  specimens). Values from those pages are marked **"from memory, verify"**.
- **Fonts:** the Google Fonts URL was tested with `curl`: all three families are served.

## 1. What we already have (prefer it)

| Need | Existing dependency | Verdict |
|---|---|---|
| Timelines, staggers, springs, counters, SVG drawing, text splitting | `animejs` 4.5.0: `animate`, `createTimeline`, `stagger`, `createSpring`, `cubicBezier`, `steps`, `splitText`, `svg`, `createScope`, `onScroll` | **Enough for every motion in the brief** |
| Smooth scroll on story pages | `lenis` 1.3.26 | Enough; reduced motion is built in (§6) |
| Route transitions | the browser's View Transitions API + `react-dom`'s `flushSync` | No library needed (§3) |
| 3D / shaders (landing, hand art) | `three`, `@react-three/fiber`, `drei` | Already used by the old landing and by T7 |

**New dependencies proposed: none.** Possible later options, **not installed** (the lead decides):
- `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, `@fontsource/instrument-serif`:
  self-hosted font files instead of Google Fonts. **Why:** no third-party request, the build works
  offline, and the full Geist glyph set and OpenType features are included (Vercel says the Google
  Fonts build lacks some of them: [vercel/geist-font](https://github.com/vercel/geist-font)).
  **Cost:** about 3 packages and some woff2 in the bundle. For a hackathon demo, Google Fonts with
  `display=swap` and system fallbacks is fine.
- Nothing else. Motion One, GSAP or Framer Motion would duplicate anime.js.

## 2. Micro-interactions: enter, hover, press

**Findings:**
- **Ease-out for anything that answers the user.** A slow start is felt as lag at the moment the
  user is watching. Common practitioner guidance:
  - keep UI feedback under ~300 ms;
  - press feedback 100–160 ms;
  - small popovers 125–200 ms;
  - drawers and modals 200–500 ms;
  - press scale about 0.97;
  - animate only `transform` and `opacity`.

  This is secondhand (skill files that summarise Emil Kowalski's
  [animations.dev](https://animations.dev/) course, e.g.
  [skills.sh/…/emilkowal-animations](https://skills.sh/mrmps/smry/emilkowal-animations)), but it
  matches the platform guides below.
- **Exits are shorter than entrances,** with a plainer curve. Atlassian suggests cutting 50–100 ms
  from the entrance ([Atlassian, applying motion](https://atlassian.design/foundations/motion/applying-motion)).
- **Material 3** names its tokens `md.sys.motion.easing.*` and `md.sys.motion.duration.*`
  ([M3 easing and duration](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs);
  token names confirmed in Flutter's generator,
  [motion_template.dart](https://flutter.googlesource.com/mirrors/flutter/+/HEAD/dev/tools/gen_defaults/lib/motion_template.dart)).
  Values, **from memory, verify:**
  - standard `cubic-bezier(0.2, 0, 0, 1)`;
  - emphasized decelerate `(0.05, 0.7, 0.1, 1)`;
  - emphasized accelerate `(0.3, 0, 0.8, 0.15)`;
  - durations from 50 ms (short1) to about 600 ms (long4).
- **Very frequent or keyboard-driven actions get no animation.** Examples: toggling the effects
  switch, or arrow-keying through demos on Review.

**For SANT:**
- Hover and press are **CSS transitions on tokens**, not anime.js: cheap, and they stop
  automatically when effects are off.
- anime.js is kept for the orchestrated moments: the power-on, the counters, the S·A·N·T sequence
  and scroll scenes.
- Following the frontend-design brief, there is **no fade-up on every section** and no hover lift on
  every card. Each page gets one orchestrated moment.

## 3. Page and route transitions (View Transitions API + fallback)

**Findings:**
- **The API:** same-document transitions use `document.startViewTransition(update)`. The browser
  snapshots the old view, runs `update`, then animates `::view-transition-old(name)` to
  `::view-transition-new(name)`. Elements with the same `view-transition-name` morph between views
  ([MDN, View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)).
- **Support:** same-document view transitions became **Baseline "newly available" in October
  2025**, when Firefox 144 shipped them
  ([web.dev](https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available),
  [caniuse](https://caniuse.com/view-transitions),
  [Chrome, view transitions in 2025](https://developer.chrome.com/blog/view-transitions-in-2025)).
  Older browsers need the fallback: call `update()` directly.
- **React Router 6.30.6 has a `viewTransition` prop on `<Link>`, but it is wired to data routers**
  (`RouterProvider`). The installed `useViewTransitionState` throws outside a `RouterProvider`. This
  app uses `<BrowserRouter>` (`web/src/main.tsx`), so the prop would do nothing here.
  - **Decision:** our own helper wraps `navigate()` in `document.startViewTransition(() =>
    flushSync(() => navigate(to)))`. `flushSync` makes React commit the new route inside the
    callback, so the "new" snapshot is the new page.
  - Moving to a data router is a bigger change to `main.tsx`, for the page round to decide.
- **Back and forward buttons don't trigger** a view transition in this setup (a known limitation of
  wrapping `navigate`). That is acceptable: they just cut instantly.
- **Reduced motion:** turn the pseudo-element animations off under
  `prefers-reduced-motion: reduce` and when effects are off. Our helper also skips
  `startViewTransition` entirely in that case.

**For SANT:**
- Story ↔ story and app ↔ app: a short cross-fade, 200 ms.
- Persistent elements (the wordmark, the step rail) get a `view-transition-name`, so they stay put
  while the content changes.
- Story → app is the special one (§4).

## 4. The story → app "power on"

**What it must say:** you are leaving the paper (the story, the evidence) and entering the
instrument (the live robot). The user asked for a designed moment.

**Options considered:**

| Option | Verdict |
|---|---|
| CRT power-on (a white line opening into a picture) | Rejected: a stock retro cliché, unrelated to robots or data |
| A full-screen glitch or noise burst | Rejected: loud, risky for vestibular and photosensitive users, and it looks like an error |
| **The S·A·N·T mark lights unit by unit while the Volt ground grows from the clicked button** | **Chosen**: it is the brand mark doing the work. The four units are the four stages of the pipeline, so the transition literally "starts" the pipeline |

**Mechanics (no new dependency):**
- A fixed overlay grows from the trigger's rectangle with `clip-path: circle()`, animated by
  anime.js. Inside it, the four letter units light in sequence; this is
  the logo placeholder's own sequence (§ logo in the design system).
- The route changes **while the overlay covers the screen**, so the paper page never flashes inside
  the Volt shell.
- The overlay then fades and reveals the app shell, whose step rail is already lit.
- Total about 900 ms. The click is never blocked for longer, and a second click skips to the end.
- The overlay is `aria-hidden`. Focus moves to the app page's `<h1>`, and a polite live region
  announces the page name.

**Reduced motion or effects off:** no overlay. Navigate instantly, and the app shell renders with
the mark already lit: the static end state the brief requires.

**Performance:**
- Only `clip-path` and `opacity` animate, on one composited layer.
- The landing's WebGL canvas unmounts with the story route, so its shaders stop. The app pages never
  start them.
- anime.js's engine pauses when the document is hidden: `engine.pauseOnDocumentHidden` in
  `engine.d.ts`.

## 5. Scroll storytelling (anime.js v4 `onScroll`, Lenis)

**anime.js v4 Scroll Observer** (installed `events/scroll.d.ts`, `types/index.d.ts`;
[docs](https://animejs.com/documentation/events/onscroll),
[thresholds](https://animejs.com/documentation/events/onscroll/scrollobserver-thresholds),
[sync modes](https://animejs.com/documentation/events/onscroll/scrollobserver-synchronisation-modes)):
- **Usage:** `animate(targets, { …, autoplay: onScroll({ target, container, enter, leave, sync,
  repeat, axis, debug }) })`.
- **`enter` / `leave`** take "`<container edge> <target edge>`" strings, e.g. `enter: "50% start"`,
  `leave: "end end"`. The old landing already uses exactly that (`web/src/three/Reveal.tsx`).
- **`sync`:**
  - `true` scrubs the animation with scroll;
  - a number between 0 and 1 smooths the scrub;
  - an easing name eases it;
  - a string of method names (`"play pause"`, or four for the directional variants
    `"play pause reverse reset"`) triggers playback instead of scrubbing.
- **Callbacks:** `onEnter`, `onLeave`, `onEnterForward`, `onLeaveBackward`, `onUpdate` and
  `onSyncComplete`.
- **`createScope({ root, mediaQueries: { reduceMotion: "(prefers-reduced-motion)" } })`:**
  - exposes `scope.matches.reduceMotion`;
  - re-runs its constructors when a match changes;
  - reverts every animation created inside it on `scope.revert()`. That fits React's effect
    cleanup.

  Sources: [scope](https://animejs.com/documentation/scope),
  [mediaQueries](https://animejs.com/documentation/scope/scope-parameters/mediaqueries), and the
  installed `scope.d.ts`.

**Lenis 1.3.26** (installed `lenis.d.ts`; [repo](https://github.com/darkroomengineering/lenis)):
- **`respectReducedMotion` defaults to `true`.** Under reduced motion, `lerp` is forced to 1 (the
  scroll tracks the wheel 1:1) and programmatic scrolls jump instantly. "Effects off" must do the
  same, so SANT doesn't create Lenis at all when effects are off.
- **Other options:** `autoRaf` (Lenis runs its own rAF loop), `anchors` (it handles in-page links),
  `stopInertiaOnNavigate`. `lerp` and `duration` set the feel. The old landing uses
  `lerp: 0.085`.
- **Story pages only.** App pages must keep native scrolling: Review has scrollable lists and
  timelines, and smooth-scroll inertia there fights precise input.

**Rules for SANT:**
- **Scrubbed (`sync: true`) only where the animation explains something.** Example: the 10 demos
  multiplying into 300 copies as you scroll past the yield beat.
- **Triggered once (`sync: "play"`, `repeat: false`) for reveals.** Example: a chart drawing in.
- **Meaning never depends on scroll position.** With motion off, every beat shows its end state.

## 6. Counters and animated charts for 7.5% → 42.5%

**Counter:**
- anime.js animates a plain object (`{ v: 0 }`) to the value, and `onUpdate` writes formatted text.
- **Tabular figures** (`font-variant-numeric: tabular-nums`) keep the digits from jittering while
  they change ([MDN font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)).
  Geist Mono is monospaced anyway.
- **Format with `Intl.NumberFormat`,** with a fixed number of decimals (7.5 and 42.5 both have 1),
  so the width doesn't jump between "7" and "7.5"
  ([MDN Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)).
- **Accessibility:** the moving digits are `aria-hidden`, and the element carries the **final**
  value as its accessible name, so a screen reader never reads "12.3%".
- **It counts once,** when it first enters the viewport. Effects off or reduced motion shows the
  final value immediately.

**Charts:**
- Bars grow with `scaleX` or `scaleY` from their baseline, and lines draw with
  `svg.createDrawable` / `stroke-dashoffset`.
- The confidence-interval whisker appears **after** the bar, because the CI is the honest part.
  It must never be hidden in the end state.
- The p-value and n are text, not animation.

**Honesty rules for this result:**
- **No easing overshoot on a bar.** A spring past 42.5% would show a number we didn't measure. Use
  `out` easing, never `outBack` or springs.
- **Both arms animate at the same speed**, so the bigger bar isn't made more dramatic.
- **The source and caveat stay visible in the chart frame.** They come from the README: 40 fresh
  scenes, one task, scripted-expert demos.

## 7. Easing and duration scales

See [`motion.md`](motion.md) for the tokens. In short:
- **Durations:** a short scale for UI (80 / 140 / 200 / 320 ms), a long one for story (600 / 900 ms).
- **Easing curves:** one deceleration curve for entering and answering, a plainer acceleration for
  leaving, and a symmetric one for moving between states.
- **Staggers:** 30 ms for UI lists, 70 ms for story text, and 140 ms for the S·A·N·T sequence (slow
  enough to read as four separate steps).

## 8. Reduced motion and "Effects off"

**Standards:**
- **WCAG 2.3.3 Animation from Interactions** (AAA): motion triggered by interaction can be
  disabled, unless it is essential
  ([Understanding 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)).
- **Sufficient techniques:**
  - CSS `prefers-reduced-motion` ([C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html));
  - the same media query read in JavaScript;
  - a user setting that turns animation off: **our "Effects off" toggle**.

  Deque adds that the OS sets the preference, and that scrolling itself is essential and exempt
  ([Deque](https://dequeuniversity.com/resources/wcag2.1/2.3.3-animations-from-interactions)).
- **Contrast:** 4.5:1 for text ([1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)),
  3:1 for UI components, focus rings and the meaningful parts of charts
  ([1.4.11](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast)).

**Rules for SANT:**
1. **One source of truth.** Motion is reduced when the OS asks
   ([`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion))
   **or** the user turns effects off. The effects toggle is stored per browser.
2. **Static end states, not "no content".**
   - The counters show final values.
   - The charts show their bars and CIs.
   - The S·A·N·T mark shows all four units lit.
   - The power-on is an instant route change.
3. **No smooth scroll.** Lenis isn't created, and CSS `scroll-behavior` stays `auto`.
4. **CSS transitions collapse to 0 ms** through the duration tokens.
5. **Never dither, ASCII-render or scramble text that carries meaning** (the brief).
   `scrambleText` is allowed only on decorative glyphs, if at all.
6. **No flashing:** nothing flashes more than 3 times a second.

## 9. Performance on app pages (Record runs MediaPipe next to Isaac Sim on one GPU)

- **No smooth scroll and no WebGL on app shells,** except T7's hand-art overlay, which is behind a
  toggle and owned by T7/T4.
- **One low-resolution overlay pass at most;** the brief.
- **Cap the device pixel ratio** of any canvas at 1.5 (`Math.min(devicePixelRatio, 1.5)`).
- **Measure frame time** with `performance.now()` deltas in a rAF loop before shipping an effect.
  The design page shows a live frame-time readout, so effects can be judged on this machine.
- **Prefer CSS transitions** (compositor-friendly) over JavaScript ticks for hover and press.
- **anime.js pauses with the tab** (`pauseOnDocumentHidden`), and every scoped animation is reverted
  on unmount.

## Sources

- MDN, View Transition API: <https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>
- web.dev, same-document view transitions are Baseline: <https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available>
- caniuse, view transitions (single document): <https://caniuse.com/view-transitions>
- Chrome for Developers, view transitions in 2025: <https://developer.chrome.com/blog/view-transitions-in-2025>
- anime.js docs: onScroll <https://animejs.com/documentation/events/onscroll>, thresholds <https://animejs.com/documentation/events/onscroll/scrollobserver-thresholds>, sync modes <https://animejs.com/documentation/events/onscroll/scrollobserver-synchronisation-modes>, scope <https://animejs.com/documentation/scope>, mediaQueries <https://animejs.com/documentation/scope/scope-parameters/mediaqueries>
- Lenis: <https://github.com/darkroomengineering/lenis> (option docs in the installed `lenis.d.ts`)
- Material 3, easing and duration: <https://m3.material.io/styles/motion/easing-and-duration/tokens-specs>; Flutter's generator: <https://flutter.googlesource.com/mirrors/flutter/+/HEAD/dev/tools/gen_defaults/lib/motion_template.dart>
- Atlassian, applying motion: <https://atlassian.design/foundations/motion/applying-motion>
- Emil Kowalski, animations.dev: <https://animations.dev/> (rules quoted secondhand from <https://skills.sh/mrmps/smry/emilkowal-animations>)
- W3C, Understanding 2.3.3: <https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions>; technique C39: <https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html>; 1.4.3: <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum>; 1.4.11: <https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast>
- Deque, 2.3.3: <https://dequeuniversity.com/resources/wcag2.1/2.3.3-animations-from-interactions>
- MDN: prefers-reduced-motion <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>, font-variant-numeric <https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric>, Intl.NumberFormat <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat>
- Geist: <https://github.com/vercel/geist-font>; Google Fonts CSS2 API: <https://developers.google.com/fonts/docs/css2>
