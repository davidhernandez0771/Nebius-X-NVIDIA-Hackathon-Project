# Forest robots: the real robots in the moss, the lit Blender crack, and fireflies (2026-10-20)

Branch `pm/forest-robots`, from pm/live-12 (`af0ea91`). The screenshots are in `2026-10-20-forest-robots/`.

**Verification: headless Chrome with SwiftShader only; no GPU was used.** The renderer string was `Vulkan 1.3.0 (SwiftShader Device (Subzero))`. The fps values are the CPU rasteriser's, not measurements. The triangle and draw-call counts carry over to real hardware.

**Screenshots 01–06** hide the page's text so the robots can be seen; 07 has the text. They are:
- 01–05: the robots along the walk;
- 06: the crack's lip, from the forest;
- 07: the same view with the text;
- 08: the low tier (HUD on);
- 09: a phone at 390×844, low tier;
- 10: the stills that SwiftShader gets by default;
- 11: reduced motion (the static logo, as before);
- 12–18: the fall down the lit crack, from the lip to the reactor below;
- 19: the low tier's fall (the procedural crack, lit the same way);
- 20–24: the fireflies (landing, round the robots, an orbit, swirling over the crack, falling with the camera);
- 25: the low tier's fireflies; 26: a phone's; 27: reduced motion.

## The robots

The 7 GLBs from the lead's export, unchanged (the 20:03 re-export: sha256 checked), are in `web/public/world/models/robots/`. They are franka, fr3, so101, piper, openarm, ur5e and xarm6. Each is about 15k triangles, y up, in metres, with its base at the origin.

**Pose and placement** (`forestRobots.ts`):
- **Whole-body poses.** A GLB has no joints, so each robot is posed as a whole:
  - Franka and xArm6 lie on their side;
  - SO-101 is tipped over;
  - Piper lies on its back, its arm reaching up;
  - fr3 is half-buried;
  - OpenArm lies face down;
  - UR5e leans against a trunk. It is placed on the side of the trunk facing the walk, then slid in code until it touches the bark.
- **Scale.** All robots share one scale, 2.4× real size, so their real proportions hold. At 1.6× they were lost against the 30 m trunks.
- **Visibility.** The spots were nudged so the camera sees each robot in frame, within 12 m and with no trunk in between, for a stretch of the walk. A test holds this. Before the nudge:
  - Piper was always behind a trunk;
  - Franka was never in frame (it lay behind where the camera lands).
- **The gripper spot is now fr3's.** The half-buried Franka gripper spot can't come from a one-piece GLB.

**Material** (`Forest.tsx`, the robot shader). Each part keeps its paint from the GLB's materials (white shells, dark joints, UR5e's blue-grey), turned into per-vertex colours:
- the paint is dulled and darkened;
- black parts stay a dark grey, so they read as shapes;
- moss creeps up from where the robot is buried, in patches, and over the surfaces facing up;
- the faint teal powered seam is still there.

There are no textures.

**Two levels of detail, made in code** (`robotLod.ts`). Nothing in the project decimates a mesh, so the code snaps vertices to a grid and drops the triangles that collapse:
- every robot has a coarse level (a 2–2.5 cm grid);
- robots within 3.5 m of the camera also get a detailed level (a 1.2 cm grid);
- the two levels dissolve into each other over the last 1 m.

It is all one geometry and one draw call. The index list is rebuilt only when a robot's level changes, a handful of times along the walk.

**Per tier:**

| Tier | Robots | Coarse grid | Detailed level |
|---|---|---|---|
| low (phones) | 4: franka, piper, ur5e, xarm6 (the others aren't downloaded) | 2.5 cm | none |
| high | all 7 | 2.5 cm | within 3.5 m |
| ultra | all 7 | 2 cm | within 3.5 m |

**Loading.** The robots load lazily: after the loader, with a dynamic import of `robotWrecks`. The low tier fetches only its 4 GLBs. The forest no longer loads the URDF stand-in.

## The crack: lit during the fall

The lead's second export (20,142 triangles, 1.21 MB, one mesh, sha256 checked) is at `web/public/world/models/crack.glb`.

**The fall is lit.** `storyPlan.ts` has a new `dropLight(vh)`. It is part of the drop, not a place: `PLACES` and "one place lit at a time" are unchanged.
- It comes up while the forest goes out (30–45% of the crack span) and hands over to the reactor at 80–98%.
- The forest is not drawn during the fall, only the crack (`Forest.tsx`).
- The crack's shader (`Crack.tsx`) lights the walls from below with the reactor's teal:
  - brighter with depth;
  - faces turned down catch the most light;
  - rock fades into the dark with distance, so walls, roots and boulders stream past.
- The procedural fissure now has a glowing cap at the bottom, so looking down there is light, not a black hole:
  - from the forest it glows faintly;
  - it thins out over the last 6 m above it;
  - it dissolves as the fall hands over to the reactor. The camera passes it at about 90% of the drop light, when the reactor is barely lit, so it never hides the reveal.
- **Low tier:** the procedural crack is lit the same way (screenshot 19).

**The fissure stays behind the model.** It sits at the floor's cut and closes any gap between the cut and the model's walls (see "Fit"), at 160 triangles.

**From the forest only the crack's top is drawn.** The rock below is dark until the fall. The model's triangles are ordered top first (`crackSlot.ts` `depthOrder`):
- the walk draws those reaching above −3 m (7,767 triangles);
- the fall draws all 20,142.

**Budget: the frame, crack included.** These are the worst frames along the camera's path, from `robotBudget.test.ts`, which loads the real GLBs and the crack:

| Tier | First commit (pieces + robots; crack not counted) | Now (pieces + robots + crack) | The fall alone | Budget |
|---|---|---|---|---|
| low | 57,378 | 49,354 + 8,024 + 160 = **57,538** | 160 | 60,000 |
| high | 156,873 | 126,940 + 22,832 + 160 + 7,767 = **159,630** | 20,302 | 160,000 |
| ultra | 186,687 | 151,660 + 27,926 + 160 + 7,767 = **189,444** | 20,302 | 190,000 |

To fit the crack I did the following:
- **The crack's walk cut** is −3 m (from −4).
- **The robots' detail radius** is 3.5 m (from 4).
- **Ferns:** 10 fewer on high and on ultra (170 → 160, 260 → 250), about 1.6k triangles each.

**Draw calls.** The pieces are 8 of 10, the robots 1. The crack is 2 on high and ultra (fissure and model) and 1 on low. The HUD in the fall: 16 calls, 20,316 triangles.

**Fit, measured on the new mesh against its triangle surfaces** (model frame, as in `crackSlot.ts`):
- **Slabs.** All 26 reach 0.36–1.5 m below the floor (none float) and stand up to 1.16 m above it. The largest overhang into the opening:

  | | Old export | New export |
  |---|---|---|
  | Largest | 0.98 m | 0.44 m (x −6.7…−5.1, at the crack's narrow end) |
  | Next | | 0.39 m |
  | The rest | | ≤ 0.28 m |
- **Gaps at the cut.** At 140 of 320 lens-edge points the wall's top, 5 cm below the floor, is more than 10 cm inside the cut. The old export had 167; the worst is 0.69 m in both. The fissure behind the model closes them, so no strip of sky shows. (My first report measured to vertices: decimation makes that look worse than it is.)
- **The dive.** The camera falls at x ≈ −0.05, z 0.97 → 0.13. Its closest approach to any rock surface:

  | | Closest | Where |
  |---|---|---|
  | Old export | 0.01 m | 16.5 m down |
  | New export | 0.42 m | at the lip |

  Clearance with the new export:
  - 0.42 m in the top 8 m;
  - 0.7–1.1 m from 8 to 12 m down;
  - 1.0–1.55 m from 12 to 32 m down;
  - 0.65–0.8 m from 32 to 36 m down, the cavern's ceiling.

## Fireflies

Small glowing points in many colours over the forest, as the user asked: Active Theory-style, not just the teal dust.

**The plan** (`fireflyPlan.ts`, pure, seeded):
- **Palette:** teal, ice blue, violet (cool, 60% by weight); amber, pale gold, coral (warm, 40%). A test keeps every hue out of 60–110°, so nothing near NVIDIA green.
- **Counts:** ultra 1,500, high 1,000, low 300, phones 200 (`max-width: 600px`).
- **Four kinds:**
  - most drift on slow curving paths along the walk;
  - about 10% circle the fallen robots shown on the tier (at least 6 per robot), as if the robots were waking up;
  - 12% wait over the crack, swirl into it over the last stretch of the walk, then fall with the camera as a loose shell around it, and go as the fall hands over to the reactor;
  - 4% are large, soft, out-of-focus discs near the camera's way.

**The drawing** (`fireflies.ts`):
- One `Points` draw, with all motion in the shader (`update` only writes uniforms; a test holds this).
- Each firefly blinks on its own rhythm: mostly a low glow, now and then a soft flash.
- Additive blending, so the bloom picks them up on high and ultra.
- Depth parallax comes from real 3D positions.
- **Reduced motion:** they hold still and only blink (`uStill`). The camera stays on the hero then, so they aren't seen anyway.

**Cost:** 1 draw call (the HUD's calls go from 29 to 30 in the forest) and 0 triangles. Points: 4,000 in the forest on ultra, dust and spores included.

## Checked
- **Tests.** Web 1580 passed, 1 skipped. Tests added or changed:
  - `robotLod.test.ts`: 6;
  - `robotBudget.test.ts`: 3, real GLBs and the crack, every frame along the path;
  - `forestRobots.test.ts`: 8, including GLB bounds against the files and the visibility check;
  - `robotWrecks.test.ts`: 6;
  - `crackSlot.test.ts`: plus 1, `depthOrder`;
  - `Crack.test.ts`: plus 1 (the low tier doesn't fetch), and the model now sits in front of the fissure;
  - `storyPlan.test.ts`: plus 1, `dropLight`;
  - `fireflyPlan.test.ts`: 7 (palette and hue rule, counts, kinds, robots, crack, colours and rhythms, determinism);
  - `fireflies.test.ts`: 3 (one Points draw, shader-only motion, still under reduced motion).
- **Typecheck and build** pass. The GLBs ship in `dist`.
- **Phone** (390×844, low): no sideways scroll, and the Franka is in view (screenshot 09).
- **Stills and reduced motion** render as before (screenshots 10 and 11). Reduced motion has no drop light.
- **Console:** no errors from the world.
- **Note on ports:** another worktree's Vite also listens on 5193 (127.0.0.1). The shots up to 19 came from this worktree's server (they show code only this branch has). The firefly shots came from this worktree on 127.0.0.1:5197.

## Not done / open
- **Real-GPU frame times** on the 4060/5080 aren't measured (SwiftShader only).
- **The detailed robot level is a 1.2 cm grid, not the full GLB.** The full GLB didn't fit the budget.
- **Up close, the fr3's moss and seams look a little like camouflage** (screenshot 03).
- **Firefly orbits round the robots** read as small dots in SwiftShader, with the large near ones dominating. Brightness and size may want a pass on a real GPU with bloom.
- **The lit walls are smooth** after decimation and read as soft shapes in SwiftShader. Strata and noise carry the detail. A GPU check with bloom is still to do.
