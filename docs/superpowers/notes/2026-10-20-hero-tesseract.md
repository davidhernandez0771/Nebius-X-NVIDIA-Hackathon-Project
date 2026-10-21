# Hero tesseract: the SANT mark as a real 4D cube (2026-10-20)

Branch `pm/hero-tesseract`, from pm/live-12 (`eb3546a`). The screenshots are in `2026-10-20-hero-tesseract/`.

**Verification: headless Chrome with SwiftShader only; no GPU was used.** The fps values are the CPU rasteriser's, not measurements.

The user chose the "open-corner tesseract" mark (docs/design/logo). The hero's glass logo is replaced by a real tesseract floating in the dark space. The hero's copy and layout are unchanged.

## What it is
- **The 4D maths** (`tesseractPlan.ts`, pure and tested):
  - The shape: 16 corners (±1 on x, y, z, w) and 32 edges. They sort into the inner cube (w = −1, teal, 12 edges), the outer cube (w = +1, chrome, 12 edges) and the 8 links between them (chrome).
  - The turn: the cube turns in the XW and ZW planes, the ZW turn at 0.618 of the XW one so the two never fall into a simple loop.
  - The projection: 4D to 3D scaled by depth in w (nearer in w is larger; 3/7 for each unit further away). So the inner cube is 0.43 the outer's size, as in the flat mark. The inner and outer cubes keep turning inside out into each other (frames 02–07).
  - **Why not a true perspective in w:** at the mark's ratio, true perspective (eye at w = 2.5) blows a corner up to 2.6× the logo's size as it swings near the eye. The depth scaling turns inside out the same way and stays within `HYPER_RADIUS`, 1.38× its still size (tested), so the hero can fit it on screen.
- **The open corner.** It is one fixed outer corner, the one that sits up and to the right in the mark's isometric view:
  - its 4 edges (3 outer and the link; the flat mark leaves the link out too) stop at 62% of their length in 4D, so the gap holds through every turn;
  - each ends in a round cap, as the mark's strokes do;
  - there is no ball at the corner itself.
- **The breakout.** The inner cube is shifted toward the open corner in 4D (a shear on w = −1 only), so the outer cube stays a true cube and the teal cube leans out through the gap.
- **The drawing** (`Tesseract.ts`): 3 instanced draws, their matrices laid along the projected edges every frame (32 tubes, 19 balls).
  - Chrome tubes: the outer cube and the links.
  - Glowing teal tubes: the inner cube (emissive, so the bloom picks them up on high and ultra).
  - Joints: chrome balls at the outer corners, small teal caps at the inner ones, and the 4 round caps at the gap.

  The look follows `tesseract-3d-A.png`.

## The tesseract is the hero: the layout around it
The first placement put it in the largest clear circle around the old layout. At 1280×720 that tucked it, small, into the upper right. Now the copy makes room:
- **Desktop.** The hero beat (`intro-beat--hero` in `intro.css`) stacks the kicker, the headline and the small column on the left, the column under "ONCE.". The right half is the tesseract's.
  - The hero's headline is a little smaller: 5.4vw (from 6.6vw), at most 104 px. At 6.6vw, "SHOW A ROBOT" plus the station rail left too little room for a large tesseract at 1280×720.
- **Phone.** The tesseract is on top, large, and the copy is under it (kicker, headline, column, then the scroll hint).
- **Size and place** (`Scene.tsx` + `heroSlot.ts`):
  - It is as large as `HERO_SIZE` asks: the still pose about 56% of the screen's height.
  - Its widest 4D reach (`HYPER_RADIUS`, plus a ball) must fit the largest circle clear of the page's boxes: the headline and kicker, the column, the scroll hint, the brand, the contact button, the station rail and the quality chip. The pad is 16 px.
  - The boxes are measured on load, as the fonts and words settle, and on every resize, with the rig's fitted field of view.
- **The backdrop's soft teal glow** follows it: it sits where the camera's ray through the tesseract meets the backdrop sphere (`uGlow`).

Results, from the boxes headless Chrome measured; `heroSlot.test.ts` holds each layout clear, large and on its side:

| Screen | Reach radius | Where |
|---|---|---|
| 1280×720 | 262 px | right half, between the copy and the station rail |
| 1920×1080 | 435 px | right half |
| 390×844 | 162 px | on top, above the copy |

Mid-turn frames with the copy showing stay clear. Screenshots: 01, 01b and 10 (the hero), 08 (the still pose), 11 (the fallback).

## The steel
The chrome was too white under the bloom. It is now polished steel:
- albedo #8a9197;
- studio reflections 0.9 (from 1.4);
- roughness 0.2;
- clearcoat 0.25.

The teal is the only glow.

## How it moves (`Scene.tsx`, `hyperPose`)
- **Scroll.** The 4D turn follows the scroll from the top of the hero to the end of the sink, 1.5π in all. It is scrubbable (the same scroll gives the same pose) and played back in reverse when scrolling up.
- **The 3D turn** is gentle, a third of the old logo's, with the old tilt and the pointer's parallax.
- **The descent** continues as before. The camera sinks below the tesseract as it turns inside out, and the hero goes out into the dark.
- **Idle.** A slow 4D turn of its own (0.25 rad/s) and a slow 3D turn. Both start only once it has grown in, so the hero opens on the mark's pose. On the low tier there are no idle loops (as before), so it turns only with the scroll.
- **Reduced motion.** The flat mark's still pose: isometric, no turn, the open corner at the upper right (screenshot 08). A test checks this geometrically:
  - the outer corners form a regular hexagon;
  - the open corner sits at 20–40°;
  - the teal cube is pushed toward it.

## Cost per tier (the tesseract alone)

| Tier | Draws | Triangles | Tubes |
|---|---|---|---|
| low (phones) | 3 | 3,172 | radius 0.024, 8 sides |
| high | 3 | 10,904 | radius 0.034, 16 sides |
| ultra | 3 | 14,960 | radius 0.034, 20 sides |

The hero frame on ultra (HUD): 19 calls, 17,182 triangles, post-processing included.

## The fallback still
`web/public/world/stills/story.webp` was a render of the old glass logo. It is replaced by the tesseract's still pose (canvas only, 1280×720), so the stills fallback shows the new mark (screenshot 11).

## Removed (git rm; nothing else used them)
- `web/src/world/stations/intro/logo3d.ts`
- `logo3d.test.ts`
- `mark.ts`
- `web/public/world/mark.svg`

The SVG path to the logo is gone: the mark is now the tesseract in code.

## Checked
- **Tests.** Web 1683 passed, 1 skipped. One full run had a timing failure in `DataPage.test.tsx` (the data page, untouched here). It passed 3 times alone, and the full rerun was green. New tests:
  - `tesseractPlan.test.ts`: 10. It covers:
    - the vertices, edges and their kinds;
    - rotation keeps lengths, and a full turn comes back;
    - the XW half turn;
    - the perspective ratio;
    - the open corner stays open at every angle;
    - the still pose matches the mark;
    - reduced motion;
    - the scroll is scrubbable and holds past the sink.
  - `Tesseract.test.ts`: 3. It covers three draws with the right counts, tubes laid along their edges, and thinner tubes with fewer sides on low.
  - `heroSlot.test.ts`: 6. It covers the three layouts (clear, inside, large), the right half on desktop and above the copy on phones, the size cap and centring, and determinism.
  - In `tesseractPlan.test.ts`, the perspective test is now the depth-scaling ratio test, and there is a new test for the reach (`HYPER_RADIUS`).
- **Typecheck and build** pass.
- **Screenshots:**
  - the hero with its copy (01; 01b at 1920×1080);
  - six frames of the 4D turn (02–07, scroll 0.1–1.45);
  - the still pose (08);
  - low (09);
  - a phone at 390×844 with no sideways scroll (10);
  - the stills fallback (11).
- Shots came from this worktree's Vite on 127.0.0.1:5197.
- **Overlap.** Mid-turn frames at 1280×720 with the copy showing (scroll 0.5 and 1.0) stay clear of the type. `heroSlot.test.ts` checks the slot against all the boxes at 1280×720, 1920×1080 and 390×844; `tesseractPlan.test.ts` checks the reach.

## Open
- **Real-GPU look and frame time** aren't checked (SwiftShader only).
- **Frames 01–07 include some idle turn** (the shots wait a few seconds), so they aren't exact scroll-only poses.
- **The site header's small logo and the favicon** are separate and not touched here.
