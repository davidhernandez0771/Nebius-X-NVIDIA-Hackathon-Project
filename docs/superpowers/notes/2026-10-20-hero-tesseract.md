# Hero tesseract: the SANT mark as a real 4D cube (2026-10-20)

Branch `pm/hero-tesseract`, from pm/live-12 (`eb3546a`). The screenshots are in `2026-10-20-hero-tesseract/`.

**Verification: headless Chrome with SwiftShader only; no GPU was used.** The fps values are the CPU rasteriser's, not measurements.

The user chose the "open-corner tesseract" mark (docs/design/logo). The hero's glass logo is replaced by a real tesseract floating in the dark space. The hero's copy and layout are unchanged.

## What it is
- **The 4D maths** (`tesseractPlan.ts`, pure and tested):
  - The shape: 16 corners (±1 on x, y, z, w) and 32 edges. They sort into the inner cube (w = −1, teal, 12 edges), the outer cube (w = +1, chrome, 12 edges) and the 8 links between them (chrome).
  - The turn: the cube turns in the XW and ZW planes, the ZW turn at 0.618 of the XW one so the two never fall into a simple loop.
  - The projection: 4D to 3D with perspective in w (eye at w = 2.5). So the inner cube is 0.43 the outer's size, as in the flat mark. The inner and outer cubes keep turning inside out into each other (frames 02–07).
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
- **Tests.** Web 1676 passed, 1 skipped. New tests:
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
- **Typecheck and build** pass.
- **Screenshots:**
  - the hero with its copy (01);
  - six frames of the 4D turn (02–07, scroll 0.1–1.45);
  - the still pose (08);
  - low (09);
  - a phone at 390×844 with no sideways scroll (10);
  - the stills fallback (11).
- Shots came from this worktree's Vite on 127.0.0.1:5197.

## Open
- **Real-GPU look and frame time** aren't checked (SwiftShader only). The chrome reads quite white under the bloom in SwiftShader.
- **Frames 01–07 include some idle turn** (the shots wait a few seconds), so they aren't exact scroll-only poses.
- **The site header's small logo and the favicon** are separate and not touched here.
