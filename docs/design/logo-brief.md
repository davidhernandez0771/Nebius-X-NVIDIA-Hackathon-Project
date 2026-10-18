# SANT logo brief

- **For:** the user, who designs the logo (sprint 8 plan, "Decisions already made").
- **Owner of this brief:** T1. Written 2026-10-17, at `8572b6e`.
- **Updated 2026-10-17:** the logo is now a **symbol, not letters**. Think of how Claude's star works: one
  simple shape that stands for the product on its own (the user's analogy). The letters "SANT" live only
  in the wordmark, next to the symbol.
  - The first version's letter-based directions are replaced by four symbol directions
    ([§3](#3-four-symbol-directions)).
- **Until the symbol exists:** the site uses T5's text placeholder: "S·A·N·T" lighting up in sequence, in
  `web/src/sant/`.
- **The swap:** the page round replaces the placeholder with the SVG files in [§6](#6-deliverables).

**Sources:**
- the sprint 8 plan's decisions ("plan8");
- the moodboard (https://claude.ai/artifact/PHknUKVS8W9E5f9VvPtuNP, the owner's private link): its
  "Logo" panel and direction F, "Volt";
- the lead's visual references, 2026-10-17 ("refs"): the dust power-on, where dust gathers into the
  symbol, and the glass emblem with a chromatic rim;
- the contrast ratios in §2, which T1 computed with the WCAG 2.x relative-luminance formula.

## 1. What is fixed

| Constraint | Detail | From |
|---|---|---|
| Name | **SANT**, standing for **Simulate · Augment · Neaten · Train** | plan8 |
| Tagline | **"Perfect, then multiply"** | plan8 |
| A symbol | **No letterforms in the symbol.** It must stand alone at favicon size, the way a star or a mark does. "SANT" appears only in the wordmark beside it | the user (this update) |
| A build | The symbol has a **build animation that ends in its finished shape**: the hero, the loader, and the dust power-on, where dust gathers into it (refs). Where a direction has four parts, the build lights them **in sequence, S → A → N → T**, which keeps plan8's "lights up in sequence" | plan8; refs |
| Two modes | It must work on **Paper** (story pages) and **Volt** (app pages), and in the "power on" crossing between them | plan8 |
| A glass version | On Volt, at the crossing and in the hero, it can render as **glass with a chromatic rim** (refs). It is an effect on the flat shape, never a different shape | refs |
| Small size | Readable at **16 px** (favicon) | moodboard "Logo" |
| Effects off | A **solid, flat version**: finished shape, one colour, no glow, glass or motion. It is the reduced-motion and "Effects off" state, and the print / README version | plan8 (accessibility); moodboard "Logo" |
| Wordmark type | The wordmark sits with Instrument Serif (display), Geist (UI) and Geist Mono (data) without clashing. Outline it in the SVG; don't depend on a webfont | plan8 |

**Never:**
- NVIDIA's green **#76B900**, its **eye or swirl** motif, or **"NV" letterforms** (plan8);
- the **circle-and-gradient swirl** many AI companies share (moodboard "Logo");
- **a copy of Claude's star**, or any evenly spaced radial starburst / sparkle / asterisk. The analogy is
  "one simple symbol", not "a star". A burst of identical spokes from a centre reads as Anthropic's mark or
  as the generic AI sparkle;
- **cream + serif + terracotta/vermilion together**. It reads as a generic AI-generated look; the paper mode
  carries teal instead (plan8). On paper, the symbol is ink or deep teal, never terracotta.

## 2. Colours

These come from the plan's palettes. The ratios were computed for this brief (WCAG 2.x). Text needs
≥ 4.5:1, and graphics and UI need ≥ 3:1 (plan8).

| Use | Colour | On | Ratio | OK for |
|---|---|---|---|---|
| Volt, lit symbol / accent | `#19F5C2` (teal) | `#07090C` | 14.13:1 | text and graphics |
| Volt, symbol in text colour | `#E6EDF3` | `#07090C` | 16.87:1 | text and graphics |
| Volt, secondary (glass rim) | `#A78BFA` (violet) | `#07090C` | 7.33:1 | text and graphics |
| Paper, symbol in ink | `#111111` | `#F4F1EA` | 16.74:1 | text and graphics |
| Paper, accent | `#0B7A63` (deep teal) | `#F4F1EA` | 4.68:1 | text (just) and graphics |
| **Volt teal on paper** | `#19F5C2` | `#F4F1EA` | **1.25:1** | **nothing: never put the bright teal on paper** |
| **Unlit part** (the moodboard's placeholder) | `#2B3138` | `#07090C` | **1.52:1** | **decoration only** |

**What this means for the symbol:**
- **It must never *rest* unlit or half-built.**
  - An unlit part is only 1.52:1, below the 3:1 graphics minimum. Unlit is a moment in the build, not a
    state.
  - Every build ends with the whole symbol lit, and the static version is fully lit.
- **On paper, "lit" is deep teal `#0B7A63` (or ink), not `#19F5C2`.** The two modes share the shape. They
  do not share the lit colour.
- **The glass rim** uses teal and violet only. Its lit fill must still meet 3:1 against the background,
  so the shape survives without the effect.
- **Amber** (`#FFB000` on Volt) means issues, repairs and "gripper closed" in the product (plan8; refs).
  Keep it out of the symbol, so it never reads as a warning.

## 3. Four symbol directions

The user named these four. Each is a direction to sketch, not a finished design. Each lists its idea,
its build, how it survives at 16 px, what it says about SANT, and its risks.

### Direction A: one point bursting into copies

- **Idea:** a single solid point (a dot or a small rounded square) with copies of itself breaking away from
  it. The original is the perfected demo; the copies are the multiplied ones. It is the tagline as a shape.
- **Build:** the point appears alone, holds, then the copies spring out of it and settle. For the dust
  power-on, the dust gathers into the point first, then the copies split off.
- **At 16 px:** the point plus a few copies, all solid. Fewer copies than the large version, if they would
  merge.
- **Says:** "Perfect, then multiply" directly.
- **Keep it ours:**
  - **The copies go in one direction or onto a grid**, offset or stepped, like the landing page's grid of
    variants. They do **not** radiate evenly around the point. An even radial burst is Claude's star, or the
    generic AI sparkle (§1, "Never").
  - The point stays visibly different from its copies (larger, or the one that is lit first), so it reads as
    "one, then many" and not as a pattern.
- **Risks:**
  - drifting toward a sparkle or starburst (above);
  - the number of copies is decorative. It must not look like a claim: don't use 10, 100 or 300 copies to
    "mean" a result;
  - dots in a grid can read as a loading indicator or a dice face.

### Direction B: four strokes forming one shape

- **Idea:** four strokes, one per stage (S, A, N, T), that together close into a single shape, such as a
  rounded square, a diamond or a closed loop. The four stages make one product.
- **Build:** the strokes draw on one at a time, S → A → N → T, and the shape closes on the last. This is the
  direction that keeps plan8's four-part sequence most directly.
- **At 16 px:** the closed shape. The gaps between strokes can close up; the shape must still read.
- **Says:** four stages, one pipeline.
- **Keep it ours:**
  - give the strokes **different lengths or weights**, so the shape is not four identical pieces turning
    around a centre;
  - **avoid a four-fold pinwheel with hooked ends.** It reads as a swastika-like rotational symbol;
  - avoid four squares in a 2 × 2 grid (Microsoft's logo) and a plain plus or cross (medical, "add").
- **Risks:**
  - the hardest to make distinctive: a closed shape of four strokes can be generic;
  - a looping shape must not drift toward a swirl (§1, "Never").

### Direction C: an abstract pinch

- **Idea:** two curved strokes, a thumb and a finger, closing on a single point between them. The point is
  the thing being grasped. It is the one gesture the whole app is built on: "pinch to close the gripper".
- **Build:** the two strokes swing in and meet the point; the point lights as they close. This mirrors the
  app's hand-art "grab" state and the landing page's "Try a pinch" sheet.
- **At 16 px:** two strokes and a dot.
- **Says:** your hand is the controller.
- **Keep it ours:**
  - abstract, not a drawn hand or a hand emoji;
  - the two strokes are unequal (a thumb and a finger), so it doesn't read as parentheses `( · )` or a
    letter C.
- **Risks:**
  - it can read as the "pinch to zoom" gesture icon, or as a bird's beak;
  - it says the most about the input and the least about "multiply". The wordmark and tagline carry that.

### Direction D: a simplified joint chain

- **Idea:** a few straight segments joined by round joints: an arm, reduced to a line drawing. It can end
  in a small open gripper or a single point.
- **Build:** "current" runs along the chain from the base, joint by joint, and lights each segment. This is
  the moodboard's Volt "current" line applied to the symbol. With four segments, the order is S → A → N → T.
- **At 16 px:** the segments and joint dots in one solid colour. Drop the gripper detail if it blurs.
- **Says:** a robot arm, the output of the whole pipeline.
- **Keep it ours:**
  - **not a literal robot-arm clip-art**. Keep it to segments and joints;
  - the chain must not spell a letter: no **"N"** (it would echo "NV", §1, "Never"), and no "Z" or "S"
    that reads as a letter.
- **Risks:**
  - a chain of dots and lines is close to the generic "connected nodes", "share" and "network" icons;
  - an arm is common in robotics branding.

### Combinations (suggestions, not decisions)

- **B + D:** four strokes that are the four segments of the joint chain. The build lights them S → A → N →
  T, and the closed shape is the arm folded in on itself.
- **C + A:** the pinch closes on a point, and the point then bursts into copies: "grasp it, perfect it,
  multiply it" in one build. The static symbol is the pinch with its copies.

The user's pick wins. These only show which directions share a build.

## 4. Sizes and lockups

| Lockup | Contents | Where | Minimum |
|---|---|---|---|
| **Symbol** | the symbol only | favicon, app icon, the dust power-on, the glyph loader, the pill nav | 16 px tall |
| **Horizontal** | symbol + "SANT" wordmark | story nav (paper), app pill nav (volt) | 20 px tall symbol |
| **Horizontal + tagline** | symbol + SANT + "Perfect, then multiply" | landing hero, README header, video title card | 32 px tall symbol |
| **Stacked** | symbol above SANT, with "Simulate · Augment · Neaten · Train" under it | About page, social image, end card | 48 px tall symbol |
| **Wordmark only** | "SANT", with the · separators lit in sequence | wherever the symbol doesn't fit | Geist 600 at body size or larger |

**Every lockup comes in four colour versions:**
1. Volt, lit (teal on `#07090C`), with the optional glass rim;
2. Paper, lit (ink or deep teal on `#F4F1EA`);
3. one-colour black;
4. one-colour white.

Versions 3 and 4 are the effects-off, print and README versions.

**Icon sizes:**
- favicon: 16 and 32 px;
- Apple touch icon: 180 px;
- PWA icons: 192 and 512 px;
- social image: 1200 × 630 px, which uses the stacked lockup.

**Clear space:** at least half the symbol's height on every side. Nothing (NVIDIA credit, nav links)
enters it. (This replaces "one unit's width", which assumed four letter units.)

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
- Keep the SANT symbol visibly **ours**: our colours, our shape, our name first.

**Don't:**
- **Don't use NVIDIA's or Nebius's logos** anywhere in the symbol, the nav or a lockup, unless the
  hackathon rules explicitly allow a sponsor-logo strip (unverified: check the rules).
- **Don't use NVIDIA's look:**
  - **#76B900**, and greens near its hue;
  - the **eye** or **swirl** shapes;
  - **"NV"** letterforms, including an N hidden in a joint chain (direction D).
  - The Volt teal was chosen to sit away from NVIDIA's green (moodboard header note).
- **Don't borrow other AI marks:** no starburst like Claude's, no sparkle, no circle-and-gradient swirl
  (§1).
- **Don't imply endorsement, partnership or certification:** no "NVIDIA SANT", "powered by NVIDIA" badges
  styled like NVIDIA's, "official", or "certified".
- **Don't combine marks:** no "SANT × NVIDIA" lockup, and no SANT symbol inside an NVIDIA shape.
- **Don't use a product name as a design element:** "Isaac", "Nemotron" or "RTX" are not part of the logo
  or the tagline.

## 6. Deliverables

So that the swap is mechanical:
1. **`sant-symbol.svg`:**
   - a square `viewBox`;
   - **one `<g>` per part of the build**, so T5's component can light them in order:
     - a four-part direction (B, D, or B + D): `id="unit-s"`, `"unit-a"`, `"unit-n"` and `"unit-t"`, in
       build order. T5's sequence code already uses these;
     - any other direction: `id="part-1"`, `"part-2"`, … in build order (for A, `part-1` is the point);
   - fills in `currentColor`, or as CSS custom properties, not hard-coded colours, so the mode tokens
     colour it;
   - no glass, glow or gradient in the file. T5 adds the glass rim as an effect (§1).
2. **`sant-lockup-horizontal.svg`** and **`sant-lockup-stacked.svg`:**
   - the same part ids;
   - the wordmark and tagline **outlined**, with no `<text>` elements.
3. **`favicon.svg`**, plus 16 / 32 / 180 / 192 / 512 px PNGs.
4. **`og-image.png`**, 1200 × 630 px, in both modes. Pick one for the meta tag.
5. **A point set for the dust**: the symbol's outline as an SVG path the dust can gather onto (a single
   outlined path, or the symbol's own paths, is enough).
6. A short note with the chosen direction, its build order, and the lit / unlit colour for each mode
   (from §2).

**Animation, for T5:**
- **Order:** the build order above (S → A → N → T for four parts).
- **End state:** the whole symbol lit.
- **Reduced motion and "Effects off":** the end state only, flat.
- **Timing:** from T5's motion tokens (`docs/design/motion.md`), not set here.

## 7. Review checklist

- [ ] The symbol contains no letters, and reads as one shape.
- [ ] The symbol alone is recognisable at 16 px.
- [ ] The horizontal lockup reads as "SANT" at a 20 px symbol height.
- [ ] Every resting state is fully built and lit, and every lit colour meets §2's contrast on its mode's
      background, without the glass effect.
- [ ] The one-colour black and white versions work, with no glow or glass.
- [ ] Not a starburst, sparkle or asterisk; not Claude's star; no AI swirl.
- [ ] No NVIDIA green, eye, swirl, "NV" or hidden N. No cream + serif + terracotta.
- [ ] No pinwheel with hooked ends, no 2 × 2 squares, no plain plus or cross.
- [ ] The SVG has build-ordered part ids (`unit-s` … `unit-t`, or `part-1` …), `currentColor` fills, and
      outlined text.
- [ ] A ×, if any shape reads as one, is never also used as a close icon.
