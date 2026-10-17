# SANT logo brief

- **For:** the user, who designs the logo (sprint 8 plan, "Decisions already made").
- **Owner of this brief:** T1. Written 2026-10-17, at `8572b6e`.
- **Until the logo exists:** the site uses T5's text placeholder: "S·A·N·T" lighting up in sequence, in
  `web/src/sant/`.
- **The swap:** the page round replaces the placeholder with the SVG files in [§6](#6-deliverables).

**Sources:**
- the sprint 8 plan's decisions ("plan8");
- the moodboard (https://claude.ai/artifact/PHknUKVS8W9E5f9VvPtuNP, the owner's private link): its
  "Logo" panel and direction F, "Volt";
- the contrast ratios in §2, which T1 computed with the WCAG 2.x relative-luminance formula.

## 1. What is fixed

| Constraint | Detail | From |
|---|---|---|
| Name | **SANT**, standing for **Simulate · Augment · Neaten · Train** | plan8 |
| Tagline | **"Perfect, then multiply"** | plan8 |
| Structure | **Four units, S·A·N·T,** on a strict grid, one per letter, so the mark can **light up in sequence**. The intro animation is built into the mark, not added on top | plan8; moodboard "Logo" |
| Two modes | It must work on **Paper** (story pages) and **Volt** (app pages), and in the "power on" crossing between them | plan8 |
| Small size | Readable at **16 px** (favicon) | moodboard "Logo" |
| Effects off | A **solid version**: all four units lit, no glow, no motion. It is the reduced-motion and "Effects off" state, and the print / README version | plan8 (accessibility); moodboard "Logo" |
| Type | If the mark uses letterforms, they sit with Instrument Serif (display), Geist (UI) and Geist Mono (data) without clashing. Outline the letters in the SVG; don't depend on a webfont | plan8 |

**Never:**
- NVIDIA's green **#76B900**, its **eye or swirl** motif, or **"NV" letterforms** (plan8);
- the **circle-and-gradient swirl** many AI companies share (moodboard "Logo");
- **cream + serif + terracotta/vermilion together**. It reads as a generic AI-generated look; the paper mode
  carries teal instead (plan8). On paper, the mark is ink or deep teal, never terracotta.

## 2. Colours

These come from the plan's palettes. The ratios were computed for this brief (WCAG 2.x). Text needs
≥ 4.5:1, and graphics and UI need ≥ 3:1 (plan8).

| Use | Colour | On | Ratio | OK for |
|---|---|---|---|---|
| Volt, lit unit / accent | `#19F5C2` (teal) | `#07090C` | 14.13:1 | text and graphics |
| Volt, mark in text colour | `#E6EDF3` | `#07090C` | 16.87:1 | text and graphics |
| Volt, secondary | `#A78BFA` (violet) | `#07090C` | 7.33:1 | text and graphics |
| Paper, mark in ink | `#111111` | `#F4F1EA` | 16.74:1 | text and graphics |
| Paper, accent | `#0B7A63` (deep teal) | `#F4F1EA` | 4.68:1 | text (just) and graphics |
| **Volt teal on paper** | `#19F5C2` | `#F4F1EA` | **1.25:1** | **nothing: never put the bright teal on paper** |
| **Unlit unit** (the moodboard's placeholder) | `#2B3138` | `#07090C` | **1.52:1** | **decoration only** |

**What this means for the mark:**
- **The mark must never *rest* unlit.**
  - An unlit unit is only 1.52:1, below the 3:1 graphics minimum. Unlit is a moment in the animation,
    not a state.
  - Every sequence ends with all four units lit, and the static version is fully lit.
- **On paper, "lit" is deep teal `#0B7A63` (or ink), not `#19F5C2`.** The two modes share the shape. They
  do not share the lit colour.
- **Amber** (`#FFB000` on Volt) means issues and repairs in the product (plan8). Keep it out of the logo, so
  the mark never reads as a warning.

## 3. Three concept directions

All three come from the moodboard's "Logo" ideas. Each is a direction to sketch, not a finished design.

### Direction 1: four cells (letters as indicator lights)

- **Idea:** four square cells side by side, each holding one letter. A cell is both a letter and an
  indicator light, like a status panel.
- **Lighting in sequence:** cells switch on S → A → N → T. On Volt, a lit cell fills teal with dark
  letters, or shows teal letters on a dark cell. On paper, a lit cell takes ink or deep teal.
- **At 16 px:** drop the letters and keep **four cells in a row**. The favicon is just the four lit squares,
  which stay recognisable as "the four stages".
- **Strengths:**
  - the closest to the plan's "4-unit mark that lights up in sequence";
  - the easiest to animate, and the clearest at small sizes;
  - it echoes the S·A·N·T step rail on the landing page.
- **Risks:**
  - the moodboard's direction E ("Instrument", four modules with LEDs) was marked "derivative of TE"
    (teenage.engineering). Avoid the hardware look: no screws, LED dots or module numbers ("01 S").
  - Keep it flat and typographic.

### Direction 2: the hand path (an S that becomes a joint chain)

- **Idea:** the S is drawn as a single smooth stroke, like a hand's path through the air. The stroke is
  broken into segments, which read as an arm's joint chain. A, N and T continue as linked segments, so the
  mark is one gesture.
- **Lighting in sequence:** current runs along the chain, S → A → N → T, one segment group per letter.
  This is the moodboard's Volt "current" line, applied to the mark itself.
- **At 16 px:** just the S-stroke, or the S-chain with its joints, in one solid colour.
- **Strengths:**
  - it tells the product story: a hand becomes a robot motion;
  - it is distinctive, and it links to T7's morphing hand overlay.
- **Risks:**
  - it is the hardest to keep readable as "SANT";
  - a chain of four can read as a generic "connected nodes" icon;
  - the S-curve must not drift toward a swirl (§1, "Never").

### Direction 3: the hidden multiply (× inside the A or N)

- **Idea:** a typographic wordmark in four equal cells. The **A's crossbar or the N's diagonal** forms a
  **×**, the multiply in "Perfect, then multiply".
- **Lighting in sequence:** as directions 1 and 2. The × cell can light a beat later, or brighter, as the
  payoff of the sequence.
- **At 16 px:** the × alone, in a square: a strong favicon on its own.
- **Strengths:**
  - it carries the tagline;
  - the × favicon is simple and ownable.
- **Risks:**
  - a lone × also means "close" or "delete" in UI. Never use it as a button icon, and never put it next
    to a close button;
  - the joke must survive without an explanation.

**A suggestion, not a decision:** directions 1 and 3 combine well. Use four cells, and draw the A or N
cell's crossing as a ×.

## 4. Sizes and lockups

| Lockup | Contents | Where | Minimum |
|---|---|---|---|
| **Mark** | the four units only | favicon, app icon, the PowerOn transition, loading | 16 px tall |
| **Horizontal** | mark + "SANT" wordmark | story nav (paper), app nav (volt) | 20 px tall mark |
| **Horizontal + tagline** | mark + SANT + "Perfect, then multiply" | landing hero, README header, video title card | 32 px tall mark |
| **Stacked** | mark above SANT, with "Simulate · Augment · Neaten · Train" under it | About page, social image, end card | 48 px tall mark |
| **Wordmark only** | "SANT" with the · separators lit in sequence | wherever a mark doesn't fit | Geist 600 at body size or larger |

**Every lockup comes in four colour versions:**
1. Volt, lit (teal on `#07090C`);
2. Paper, lit (ink or deep teal on `#F4F1EA`);
3. one-colour black;
4. one-colour white.

Versions 3 and 4 are the effects-off, print and README versions.

**Icon sizes:**
- favicon: 16 and 32 px;
- Apple touch icon: 180 px;
- PWA icons: 192 and 512 px;
- social image: 1200 × 630 px, which uses the stacked lockup.

**Clear space:** at least one unit's width on every side. Nothing (NVIDIA credit, nav links) enters it.

**The tagline is set in Instrument Serif,** with the comma, as the user wrote it: "Perfect, then multiply".

## 5. NVIDIA and Nebius: do's and don'ts

This is design guidance, not legal advice. Check the hackathon's official rules (logged in) and NVIDIA's
legal and trademark page (https://www.nvidia.com/en-us/about-nvidia/legal-info.html, linked from the
moodboard) before submitting.

**Do:**
- **Credit in plain text,** in the footer and on About:
  - "Built with NVIDIA Isaac Lab, NVIDIA Nemotron and Nebius Token Factory."
  - In the README, "Built with NVIDIA Isaac Lab and Nemotron" (moodboard wording) is fine.
- **Use product names exactly:** NVIDIA Isaac Lab, NVIDIA Isaac Sim, NVIDIA Nemotron (model:
  `nvidia/Nemotron-3.5-Super-VL`), Nebius Token Factory.
  - Sources: the content spec's facts A4 and N8; `docs/superpowers/notes/2026-10-15-t2-status.md:4`;
    `docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md:8`.
- **Name the event as written:** "Nebius x NVIDIA Global AI Hackathon, Physical AI track" (README.md:10-11).
- Keep the SANT mark visibly **ours**: our colours, our grid, our name first.

**Don't:**
- **Don't use NVIDIA's or Nebius's logos** anywhere in the mark, the nav or a lockup, unless the
  hackathon rules explicitly allow a sponsor-logo strip (unverified: check the rules).
- **Don't use NVIDIA's look:**
  - **#76B900**, and greens near its hue;
  - the **eye** or **swirl** shapes;
  - **"NV"** letterforms.
  - The Volt teal was chosen to sit away from NVIDIA's green (moodboard header note).
- **Don't imply endorsement, partnership or certification:** no "NVIDIA SANT", "powered by NVIDIA" badges
  styled like NVIDIA's, "official", or "certified".
- **Don't combine marks:** no "SANT × NVIDIA" lockup, and no SANT mark inside an NVIDIA shape.
- **Don't use a product name as a design element:** "Isaac", "Nemotron" or "RTX" are not part of the logo
  or the tagline.

## 6. Deliverables

So that the swap is mechanical:
1. **`sant-mark.svg`:**
   - a square `viewBox`;
   - **one `<g>` per unit, with `id="unit-s"`, `"unit-a"`, `"unit-n"` and `"unit-t"`**, so T5's
     component can light each one;
   - fills in `currentColor`, or as CSS custom properties, not hard-coded colours, so the mode tokens
     colour it.
2. **`sant-lockup-horizontal.svg`** and **`sant-lockup-stacked.svg`:**
   - the same unit ids;
   - the wordmark and tagline **outlined**, with no `<text>` elements.
3. **`favicon.svg`**, plus 16 / 32 / 180 / 192 / 512 px PNGs.
4. **`og-image.png`**, 1200 × 630 px, in both modes. Pick one for the meta tag.
5. A short note with the chosen direction, and the lit / unlit colour for each mode (from §2).

**Animation, for T5:**
- **Order:** S → A → N → T.
- **End state:** all four lit.
- **Reduced motion and "Effects off":** the end state only.
- **Timing:** from T5's motion tokens (`docs/design/motion.md`), not set here.

## 7. Review checklist

- [ ] Reads as "SANT" in the horizontal lockup at 20 px.
- [ ] The mark alone is recognisable at 16 px.
- [ ] Every resting state is fully lit, and every lit colour meets §2's contrast on its mode's background.
- [ ] The one-colour black and white versions work, with no glow.
- [ ] No NVIDIA green, eye, swirl or "NV". No AI swirl. No cream + serif + terracotta.
- [ ] The SVG has unit ids `unit-s` … `unit-t`, `currentColor` fills, and outlined text.
- [ ] A × (direction 3), if used, is never also used as a close icon.
