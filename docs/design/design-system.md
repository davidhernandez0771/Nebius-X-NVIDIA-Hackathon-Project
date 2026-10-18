# SANT design system

Sprint 8, T5 Task 2. Written 2026-10-17, before the code in `web/src/sant/`. Motion has its own
spec, [`motion.md`](motion.md). The research behind both is [`ui-motion-research.md`](ui-motion-research.md).

**SANT:** Simulate · Augment · Neaten · Train. Tagline: *Perfect, then multiply*.

## 1. Brief (what the user already decided)

- **Split by page:**
  - **Field Notes** (paper) for the story pages: landing/Home, Results, About.
  - **Volt** (dark) for the app pages: Record, Review, Dataset.
  - Crossing from story to app is a designed "power on".
- **Shared:**
  - **Type:** Instrument Serif (display), Geist (UI and body), Geist Mono (numbers and data).
  - **Accents:** teal for brand and live state; amber for issues and repairs.
- **Palettes:**
  - **Volt:** `#07090C` / `#E6EDF3` / `#8B95A1`, teal `#19F5C2`, amber `#FFB000`, violet `#A78BFA`.
  - **Paper:** `#F4F1EA` / `#111111` / `#6B6760`, a deep teal of about `#0B7A63`, and a dark amber.
- **Never:**
  - cream + serif + terracotta together;
  - NVIDIA's `#76B900`, its eye or swirl motif, or "NV" letterforms. NVIDIA is credited in plain
    text only.
- **Logo:** the user designs it. Until then, a text S·A·N·T placeholder that lights up in sequence.
- **Accessibility:**
  - 4.5:1 for text, 3:1 for UI;
  - reduced motion gives static end states;
  - a visible "Effects off" toggle;
  - no dithered or ASCII-rendered text that carries meaning.

## 2. Design plan, and the check against the brief

**Subject:** a tool that turns one noisy webcam robot demo into hundreds of physics-checked ones,
and the evidence that it works (3/40 → 17/40).
**Audience:** hackathon judges, robotics people, and the team itself.
**Primary job:**
- the story pages make the evidence legible and believable;
- the app pages make recording and reviewing demos precise.

**Principles:**
1. **Every number wears its source.**
   - **On paper:** a figure is never alone. Its n, CI and source sit beside it in a **margin note**,
     the way a lab notebook or a paper annotates a result. This is the story pages' one memorable
     structural idea: the margin column.
2. **The instrument is lit by state, not by decoration.**
   - **On Volt:** colour appears only when something is live (teal), wrong or being repaired
     (amber), or a second data series (violet).
   - **The signature:** the **S·A·N·T step rail**, four units that light as the demo moves through
     the pipeline.
3. **One orchestrated moment per page.** The power-on between the modes, one counter or chart
   reveal on a story page, and the step rail on app pages. Nothing else moves by itself.
4. **Quiet chrome:**
   - no all-caps eyebrows;
   - no arrows appended to buttons;
   - no gradient washes or glow halos;
   - sentence case everywhere.
   - Geist Mono is used for numerals, units and code only, never for ordinary labels.

**Layout concepts:**

```
STORY (paper), wide screens                     APP (volt)
┌──────────────────────────────────────────┐    ┌──────────────────────────────────────────┐
│ S·A·N·T   How it works  Results  About  [Open the app] │ S·A·N·T  [S][A][N][T] step rail   ● live │
├──────────────────────────────────────────┤    ├──────────┬───────────────────────┬───────┤
│                                          │    │ demos    │                       │inspect│
│  Display serif headline, left-aligned    │    │ list     │   stage (video/sim,   │ panel │
│  ─────────────────────────┐  margin      │    │          │   timeline, charts)   │       │
│  Body column, ≤ 66ch      │  note:       │    │          │                       │       │
│  left-aligned, ragged     │  n, CI,      │    │          │                       │       │
│                           │  source      │    ├──────────┴───────────────────────┴───────┤
│  [ figure spans body+margin ]            │    │ status line: sim, policy, spend, effects  │
└──────────────────────────────────────────┘    └──────────────────────────────────────────┘
Narrow screens: margin notes drop under their      Narrow screens: one column; the step rail
paragraph as an indented note.                     shrinks to four dots with letters.
```

- **Story alignment:** left-aligned, ragged right. Figures may span the body and the margin. No
  centered paragraphs.
- **App alignment:** a dense grid; numbers right-aligned in tables.

**Check against generic defaults (what I changed, and why):**
- **Cream + high-contrast serif:** the brief pins paper `#F4F1EA` and Instrument Serif. **Changed:**
  - the accent is teal, never warm clay;
  - instead of a broadsheet (hairline rules, zero radius, dense columns), paper gets **one** reading
    column plus a margin column, with soft radii.
  - The margin note is specific to this project, which cites a source for every number.
- **Near-black + one acid accent:** the brief pins Volt. **Changed:**
  - colour is **semantic** (teal live, amber issue, violet series 2), not decorative;
  - there are no neon glows; only the live dot pulses, and only when effects are on;
  - the memorable element is the step rail, not the accent colour.
- **SaaS card kit:** **changed** to radius by hierarchy (badges are pills, controls 6 px, cards 10 px,
  sheets 16 px), no grey drop shadows on paper, and Volt depth from surface steps instead of
  shadows.
- **Numbered 01 / 02 / 03 markers:** first draft used them on section headers. **Removed:** numbering
  appears only where the content really is a sequence. That means the S·A·N·T rail and the
  landing's stepwise beats.
- **Mono for small labels:** the brief asks for Geist Mono for numbers. **Restricted** to numerals,
  units, seeds and code. Captions and labels stay in Geist.
- **Middle-dot meta strings:** used only for the brand expansion "Simulate · Augment · Neaten ·
  Train", which the user chose. Nowhere else.

## 3. Colour tokens

They are defined once in `web/src/sant/tokens.css`, under `[data-mode="paper"]` and
`[data-mode="volt"]`. Every name is prefixed `--sant-`, so nothing collides with the old room
organizer's `web/src/tokens.css`. `web/src/sant/tokens.test.ts` re-checks every pair below from the
CSS file itself.

| Token | Role | Paper | Volt |
|---|---|---|---|
| `--sant-bg` | page ground | `#F4F1EA` | `#07090C` |
| `--sant-surface` | cards, panels | `#FBF9F4` | `#0E1217` |
| `--sant-surface-2` | raised / inset areas | `#ECE7DC` | `#151A21` |
| `--sant-text` | body text | `#111111` | `#E6EDF3` |
| `--sant-muted` | secondary text | `#6B6760` | `#8B95A1` |
| `--sant-line` | decorative rules, dividers | `#CFC8BA` | `#2A323C` |
| `--sant-control` | borders that identify a control | `#857E72` | `#5E6A77` |
| `--sant-accent` | brand, live state, focus ring | `#0B7A63` | `#19F5C2` |
| `--sant-accent-ink` | accent text on the soft accent tint | `#0A6E59` | `#19F5C2` |
| `--sant-accent-soft` | live badge ground | `#DCEFE9` | `#0C2A24` |
| `--sant-on-accent` | text on an accent fill | `#FFFFFF` | `#07090C` |
| `--sant-issue` | issues and repairs | `#8A5A00` | `#FFB000` |
| `--sant-issue-soft` | issue badge ground | `#F6E7C8` | `#2A1F05` |
| `--sant-violet` | second data series, info | `#5B3FD1` | `#A78BFA` |
| `--sant-violet-soft` | info badge ground | `#E9E4F8` | `#1C1730` |
| `--sant-danger` | errors only | `#B42318` | `#FF6B6B` |

**Contrast** (WCAG 2.x relative luminance; computed 2026-10-17 and enforced by the test):

| Pair | Paper | Volt | Needs |
|---|---|---|---|
| text / bg | 16.74 | 16.87 | 4.5 |
| text / surface-2 | 15.31 | 14.79 | 4.5 |
| muted / bg | 4.99 | 6.56 | 4.5 |
| muted / surface-2 | 4.56 | 5.75 | 4.5 |
| accent / bg (text and focus) | **4.68** | 14.13 | 4.5 |
| accent / surface | 5.02 | 13.32 | 4.5 |
| accent-ink / accent-soft | 5.19 | 10.84 | 4.5 |
| on-accent / accent (button) | 5.28 | 14.13 | 4.5 |
| issue / bg | 5.25 | 10.88 | 4.5 |
| issue / issue-soft | 4.85 | 8.84 | 4.5 |
| violet / bg | 6.05 | 7.33 | 4.5 |
| violet / violet-soft | 5.50 | 6.35 | 4.5 |
| danger / bg | 5.83 | 7.18 | 4.5 |
| control / bg | 3.56 | 3.61 | 3.0 (UI) |
| control / surface-2 | — | 3.17 | 3.0 (UI) |

- **The paper teal sits near the limit.** `#0B7A63` on the paper ground is 4.68:1. It passes, but on
  a tint use `--sant-accent-ink` (`#0A6E59`).
- **Amber is never the only signal.** An issue always has a text label or an icon too, so
  colour-blind users don't lose it.
- **`--sant-line`** is decorative only (1.5:1). Anything a user must find to operate it uses
  `--sant-control`.

## 4. Type

Families, from Google Fonts in `web/index.html` with `display=swap`:

| Token | Family | Fallbacks | Used for |
|---|---|---|---|
| `--sant-font-display` | Instrument Serif (400, 400 italic) | Georgia, "Times New Roman", serif | display, h1, h2 on paper; page titles on Volt |
| `--sant-font-ui` | Geist (300–700) | system-ui, -apple-system, "Segoe UI", sans-serif | body, UI, h3 and below |
| `--sant-font-data` | Geist Mono (400–600) | ui-monospace, "Cascadia Mono", Consolas, monospace | numbers, units, seeds, code |

**Scale:**
- A major third (×1.25) from 16 px, rounded to whole pixels, with a larger display step for the
  story hero.
- Instrument Serif has a single weight, so hierarchy in serif comes from size and space only, never
  from fake bold.

| Token | Size | Line height | Family / weight | Use |
|---|---|---|---|---|
| `--sant-fs-display` | `clamp(3rem, 1.6rem + 5.6vw, 6.5rem)` | 0.95 | serif 400, tracking −0.01em | story hero only |
| `--sant-fs-1` | 3.0625rem (49 px) | 1.02 | serif 400 | story h1 |
| `--sant-fs-2` | 2.4375rem (39 px) | 1.08 | serif 400 | story h2, Volt page title |
| `--sant-fs-3` | 1.9375rem (31 px) | 1.15 | serif 400 | sub-heads on paper |
| `--sant-fs-4` | 1.5625rem (25 px) | 1.25 | Geist 600 | card titles |
| `--sant-fs-5` | 1.25rem (20 px) | 1.35 | Geist 600 | h3, panel titles |
| `--sant-fs-body-paper` | 1.125rem (18 px) | 1.6 | Geist 400 | story body, ≤ 66ch |
| `--sant-fs-body` | 1rem (16 px) | 1.5 | Geist 400 | app body |
| `--sant-fs-small` | 0.875rem (14 px) | 1.45 | Geist 400/500 | UI controls, table cells |
| `--sant-fs-caption` | 0.8125rem (13 px) | 1.4 | Geist 400 | captions, margin notes |
| `--sant-fs-stat` | `clamp(2.5rem, 1.8rem + 3vw, 4.25rem)` | 1 | Geist Mono 500, tabular | Stat numbers |

**Rules:**
- **Line length:** ≤ 66ch on paper body, ≤ 80ch anywhere.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere.
- **Labels:** sentence case. Letter-spacing only on the wordmark.
- **Headline treatment:** the type itself is the treatment, a big serif set tight and left-aligned.
  No single highlighted word.

## 5. Spacing, radius, elevation, layout

- **Spacing:** a 4 px base. `--sant-space-1` … `-10` = 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 px.
- **Radius, by hierarchy:**
  - `--sant-radius-xs` 4 px: chart bars, inline code;
  - `-sm` 6 px: buttons, inputs;
  - `-md` 10 px: cards;
  - `-lg` 16 px: sheets, overlays, toasts;
  - `-pill`: badges, toggles.
- **Elevation:**
  - **Paper:** none. Depth comes from the surface tint and one rule.
  - **Volt:** bg → surface → surface-2.
  - Only floating layers (toast, power-on, menus) get a shadow: `--sant-shadow-float`.
- **Story grid:** body column `minmax(0, 66ch)` + margin column `minmax(14rem, 18rem)`, with a
  `--sant-space-7` gap and centered as a block. The margin column drops below 1000 px.
- **App grid:** list `18rem`, stage `1fr`, inspector `20rem`. The inspector drops below 1200 px and
  the list below 800 px. Native scroll only.
- **Focus:** a 2 px `--sant-accent` outline, offset 2 px, on every interactive element
  (`:focus-visible`).

## 6. Components (`web/src/sant/components/`)

| Component | Props (main) | States and behaviour | Accessibility |
|---|---|---|---|
| `Button` | `variant: primary \| secondary \| ghost`, `size: md \| sm`, `as` link via `href`/`to` | hover tint, press scale 0.97 (CSS, `--sant-dur-1`), disabled | real `<button>` / `<a>`; focus ring; the label says the action |
| `Card` | `tone: plain \| live \| issue`, `title?`, `aside?` | `live` puts a 2 px teal edge on top, `issue` amber | `<section>` with heading when titled |
| `Badge` | `tone: neutral \| live \| issue \| info`, `dot?` | the live dot pulses only with effects on | text always present; colour is never the only signal |
| `Stat` | `value`, `decimals`, `suffix`, `label`, `note?` (n, CI), `source?` | counts up once on first view (anime.js), final value with motion off | accessible name = final value + label; moving digits `aria-hidden` |
| `SectionHeader` | `title`, `lede?`, `note?` | the note sits in the margin column on paper | `<h2>` by default, `level` prop |
| `StepRail` | `active: 0–3 \| null`, `done: number`, `compact?` | S·A·N·T units: idle, active (lit, teal), done (lit, dimmer); a lighting sequence on mount | `<ol>`; `aria-current="step"`; full step names as text |
| `ChartFrame` | `title`, `caption`, `source`, `children` (the figure) | a figure with caption and source line; children may animate | `<figure>` + `<figcaption>`; the source is text |
| `ResultBars` | `arms: {label, k, n, ciLow, ciHigh}[]`, `p` | bars grow from 0 once, then CI whiskers; no overshoot | data repeated in an accessible table (visually hidden) |
| `StoryNav` / `AppNav` | links, `cta?` / `status?` | story: wordmark, links, "Open the app" (power-on). App: wordmark, step rail, the pages as a `PillNav`, status slot, effects toggle | `<nav aria-label>`; `aria-current="page"` |
| `PillNav` | `items`, `label?`, `end?` | glass pill (solid without `backdrop-filter`); the joins light up to the current page because the pages are steps in order; a soft mark glides behind the current link | `<nav aria-label>`; `aria-current="page"`; joins and mark `aria-hidden` |
| `TrackingHUD` | `detections: {id, label, score?, box: [x, y, w, h] (0–1), tone?}[]`, `label`, `aspect?`, `readout?`, `children` (the webcam) | corner brackets, a label tab ("hand 0.97"), the box centre in frame coordinates; boxes glide 80 ms between frames and lock on when new; coordinate lines hide in a frame under 520 px | `<figure aria-label>`; the drawing is `aria-hidden`; a visually hidden list says what is tracked |
| `StatusGlyph` | `state: recorded \| diagnosed \| repaired \| verified \| failed \| blocked`, `busy?`, `showLabel?` | a rounded square per state, each with its own mark; a new state fills and draws in; `busy` runs a dash round the edge | `role="img"` named by the state ("Diagnosing" while busy), or visible text with `showLabel` |
| `CountUpTiles` | `from`, `to`, `decimals`, `suffix`, `label`, `note?`, `source?` | digit tiles that roll like an odometer (`motion/odometer.ts`), once on first view, ease-out; the end value at once with motion off | the group is named by the final value and label; the tiles are `aria-hidden` |
| `DottedCountdown` | `from = 3`, `running`, `onDone`, `interval = 1000` | a 5 × 7 dot-matrix digit in a 24-dot ring that empties each second; dimmed while idle; keeps time with motion off | `role="timer"` text "Recording starts in 3", announced politely |
| `Dial` | `label`, `value`, `min`, `max`, `unit`, `step`, `major`, `decimals?`, `sweep?`, `tone?` | the scale rolls under a fixed index mark; the lit arc runs to the index; numbers in the lower half turn upright; amber (`issue`) for a closed gripper | `role="meter"` with `aria-valuenow/min/max` and `aria-valuetext` ("42 mm") |
| `GlyphLoader` | `label`, `progress?` (0–1), `done?`, `detail?` | the label resolves out of loader glyphs over a band of slashes that fills with the progress; still with motion off | `role="progressbar"` with a value when progress is known, otherwise `role="status"` |
| `Toast` (+ `ToastProvider`, `useToast`) | `message`, `tone`, `action?` | slides in (ease-out 320 ms), auto-dismisses after 6 s, pauses on hover/focus | `role="status"` (polite), `role="alert"` for errors; dismiss button |
| `Logo` | `size`, `lit: "sequence" \| "all" \| "none"` | the text S·A·N·T, units lighting 140 ms apart; swappable for the user's SVG via `src` | `aria-label="SANT"` |
| `EffectsToggle` | — | on/off switch; sets `data-effects` on `<html>`; saved per browser | `role="switch"`, `aria-checked`, visible label "Effects" |

## 7. Shells (`web/src/sant/shells/`)

- **`StoryShell`:**
  - `data-mode="paper"`;
  - `StoryNav`, a `<main>` with the story grid, and a footer;
  - the footer carries the plain-text credit line: "Built with NVIDIA Nemotron on Nebius Token
    Factory, NVIDIA Isaac Sim and Isaac Lab, and LeRobot";
  - creates Lenis (story pages only) unless motion is reduced.
- **`AppShell`:**
  - `data-mode="volt"`;
  - `AppNav` with the step rail and a status slot, then a `<main>` with the app grid;
  - native scroll, no Lenis, no WebGL;
  - the status line holds the effects toggle.
- **`PowerOn`:** story → app (see `motion.md` §4).
  - It is used by the "Open the app" button: `usePowerOn()` returns `start(to, fromRect)`.
  - It renders a fixed overlay in a portal.
- **Coexistence:** the old room-organizer routes keep `DashboardShell` and `web/src/tokens.css`.
  SANT styles only apply inside `.sant` roots, so nothing old changes until the page round migrates
  each page.

## 8. Logo placeholder

- **Now:** four units, `S` `A` `N` `T`, in Geist 600 with wide tracking. The middle dots are
  `--sant-muted`.
  - On `lit="sequence"` each unit goes from muted to `--sant-text` (and the active one to accent)
    140 ms apart.
  - With motion off, all four are lit.
- **Later:** the user's SVG is dropped in with the same API (`<Logo src={…} />`). It should keep four
  addressable groups (`#s #a #n #t`) so the sequence still works. See T1's `logo-brief.md`.
