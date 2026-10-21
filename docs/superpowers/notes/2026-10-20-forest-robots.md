# Forest robots: the real robots in the moss, and the Blender crack (2026-10-20)

Branch `pm/forest-robots`, from pm/live-12 (`af0ea91`). The screenshots are in `2026-10-20-forest-robots/`.

**Verification: headless Chrome with SwiftShader only; no GPU was used.** The renderer string was `Vulkan 1.3.0 (SwiftShader Device (Subzero))`. The fps values are the CPU rasteriser's, not measurements. The triangle and draw-call counts carry over to real hardware.

**Screenshots 01–06** hide the page's text so the robots can be seen; 07 has the text. They are:
- 01–05: the robots along the walk;
- 06: the crack's lip;
- 07: the same view with the text;
- 08: the low tier (HUD on);
- 09: a phone at 390×844, low tier;
- 10: the stills that SwiftShader gets by default;
- 11: reduced motion (the static logo, as before).

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
- robots within 4 m of the camera also get a detailed level (a 1.2 cm grid);
- the two levels dissolve into each other over the last 1.2 m.

It is all one geometry and one draw call. The index list is rebuilt only when a robot's level changes, a handful of times along the walk.

**Per tier:**

| Tier | Robots | Coarse grid | Detailed level |
|---|---|---|---|
| low (phones) | 4: franka, piper, ur5e, xarm6 (the others aren't downloaded) | 2.5 cm | none |
| high | all 7 | 2.5 cm | within 4 m |
| ultra | all 7 | 2 cm | within 4 m |

**Budget: forest pieces + robots, at the worst point of the camera's path.** These are the counts from `robotBudget.test.ts`, which loads the real GLBs and walks the path:

| Tier | Before (pieces + stand-in Franka ×7) | After (pieces + real robots) | Budget |
|---|---|---|---|
| low | 49,354 + 14,784 = **64,138** (over budget) | 49,354 + 8,024 = **57,378** | 60,000 |
| high | 128,540 + 14,784 = 143,324 | 128,540 + 28,333 = **156,873** | 160,000 |
| ultra | 153,260 + 14,784 = 168,044 | 153,260 + 33,427 = **186,687** | 190,000 |

The robots are 1 draw call both before and after; the pieces are 8 of 10.

**Loading.** The robots load lazily: after the loader, with a dynamic import of `robotWrecks`. The low tier fetches only its 4 GLBs. The forest no longer loads the URDF stand-in.

## The Blender crack (`crack.glb`)

The lead's export (26,856 triangles, 1.33 MB, one mesh) is copied to `web/public/world/models/crack.glb`. It shows in the crack slot on high and ultra (screenshot 06).

**Cost.** It is 1 draw call and 26,856 triangles, where the procedural fissure was 160.
- **Low tier and phones:** the procedural crack stays (a new `makeCrack(..., model)` flag). With it, low's frame is 58,546 triangles; with the GLB it was 85,242.
- **High and ultra:** the forest budget above doesn't count the crack (it never did). With it, high would be about 183.7k and ultra about 213.5k.

**Fit, measured on the mesh** (model frame, as in `crackSlot.ts`):
- **No floating slabs.** All 26 lip slabs reach 0.36–1.5 m below the floor and stand up to 1.16 m above it.
- **Slabs overhang the opening.** Several reach 0.3–1.0 m inside the cut, e.g. x −6.75…−5.06 (by 0.98 m), x −2.54…−0.79 on +z (0.82 m) and x 1.09…2.37 on −z (0.63 m).
- **Gaps between the cut and the walls, all on the +z side.** At 33 of 320 points along the lens edge there is no wall within 35 cm of the cut, in the top 1.2 m:
  - x −1.0…+1.4, z ≈ 1.6–2.1: up to 0.60 m;
  - x 5.3…6.3, z ≈ 1.0–0.4: up to 0.66 m;
  - x −4.2, z 1.25: 0.40 m.

  The fix is to move those walls out to the lens, or let the lip slabs cover the gap.
- **The dive.** The camera doesn't fall down the crack's centre line:

  | depth y | x | z |
  |---|---|---|
  | +1 | −0.08 | 0.97 |
  | −7 | −0.06 | 0.76 |
  | −15 | −0.05 | 0.55 |
  | −23 | −0.03 | 0.34 |
  | −31 | −0.01 | 0.13 |

  Its closest approach to the crack's geometry is **0.15 m, at y −16.2**: a ledge or root vertex at (−0.17, −16.22, 0.60). Clearance is 0.45–0.5 m in the top 4 m, about 1.1 m from −7 to −15, then 0.55–1.6 m below.
- **The fall is dark.** The forest, the crack included, fades out between 30% and 45% of the crack span (`storyPlan.ts`), about 1–3 m below the floor. So the ledges, boulders and roots further down are never seen today, the 0.15 m pass included. **14,276 of the 26,856 triangles lie entirely below −3 m.** Two ways forward:
  - trim the export to the top ~3–4 m (about 12.6k triangles), or
  - keep the crack lit during the fall (a story change).

## Checked
- **Tests.** Web 1568 passed, 1 skipped. New tests:
  - `robotLod.test.ts`: 6;
  - `robotBudget.test.ts`: 3, using the real GLBs;
  - `forestRobots.test.ts`: rewritten, 8 tests, including GLB bounds against the files and the visibility check;
  - `robotWrecks.test.ts`: rewritten, 6;
  - `Crack.test.ts`: plus 1, the low tier doesn't fetch.
- **Typecheck and build** pass. The 7 GLBs ship in `dist`.
- **Phone** (390×844, low): no sideways scroll, and the Franka is in view (screenshot 09).
- **Stills and reduced motion** render as before (screenshots 10 and 11).
- **Console:** no errors or warnings from the world, only React Router's future-flag warnings.

## Not done / open
- **Real-GPU frame times** on the 4060/5080 aren't measured (SwiftShader only).
- **The detailed level is a 1.2 cm grid, not the full GLB.** The full GLB (15k triangles each) didn't fit the budget with up to 3 robots within 4 m.
- **Up close, the fr3's moss and seams look a little like camouflage** (screenshot 03).
- **The crack items above** are for the lead's Blender pass: the +z gaps, the overhanging slabs, the 0.15 m ledge, and the dark fall.
