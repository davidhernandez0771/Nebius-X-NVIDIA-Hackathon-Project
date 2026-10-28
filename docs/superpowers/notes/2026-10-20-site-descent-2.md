# Site descent 2: forest and reactor detail (2026-10-20)

Branch `pm/site-descent-2`, from pm/live-11 (2abc94e). It is website only, in `web/src/world/stations/intro`. Screenshots are in `2026-10-20-site-descent-2/`.

**Verification: headless Chrome with SwiftShader only, no GPU** (training held the GPU). The renderer string was `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`. The fps in the shots (1–5) is the CPU rasteriser, not a measurement. Only the draw-call and triangle counts carry over. **120 fps on the 4060 is not checked yet.**

## Forest (same dark teal mood, more depth)
- **Trunks.** Three layers (`forestPlan.ts`): near (<9 m from the walk), mid (<22 m) and far (a ring outside the forest).
  - Each layer is one instanced draw with its own LOD lathe (16/10/6 sides).
  - Each trunk has a per-tree tint, buttress lobes, and bark ridges in the shader. Moss sits on the foot and on the moon side.
- **Floor detail.** Roots spread from the near/mid trunks. Fallen logs have broken ends and moss on top. Ferns and moss mounds are instanced. All of it keeps clear of the walk and the crack (tested).
- **Hanging mist** (`mistBands.ts`) is computed along each view ray in `place()`, not drawn as sheets. A band is a Gaussian in height, so its density along a ray has a closed form.
  - There is no mist geometry, no overdraw, and no hard line where a sheet meets a trunk.
  - The first version used sheets. They cut hard lines across the trunks and washed the forest out.
  - The bands sit below and above the walking eye (2.3–2.4 m), and a test checks this. Before, a band at 1.7 m put the camera inside the mist.
- **Light.** Up to 12 shafts of moonlight, plus dust and spores.
- **Robots in the moss.**
  - `forestRobots.ts` is the plan of placeholder spots for Franka, SO-101, PiPER, OpenArm, UR5e and xArm: position, yaw, pose and scale.
  - Until the GLBs exist, every spot is drawn with the Franka from its URDF STLs, posed as a whole robot (lying on its side, reaching up, slumped, a gripper half-buried). It is lazy-loaded and merged into one draw (`robotWrecks.ts`).
- **The crack is one swappable slot.**
  - `Crack.tsx` + `crackSlot.ts`. Drop a model at `web/public/world/models/crack.glb` (origin: the crack's centre at floor level, +x along the crack, +z across) and it replaces the procedural fissure.
  - A 404, or the dev server's HTML fallback, keeps the procedural fissure (tested).

Forest geometry per tier (pieces only, tested budgets): low 9 draws / ~48k triangles, high 9 / ~123k, ultra 9 / ~148k. Whole frame in the forest: low 14 calls / 65k triangles, high 28 / 145k, ultra 28 / 169k.

## Reactor (what the user loved, more of it)
- There are 28 cables from 7 junction boxes on the wall. The boxes have lids, bolts, conduit stubs and a lamp that lights with their cables. The cables sag and have 4 clamps each (112, instanced).
- **Charge front.**
  - Each cable fills with energy from its box to the core as the power climbs, with a bright head at the front.
  - Pulses run along the lit part. Their phase integrates `pulseSpeed(power)`, so they speed up without jumping.
  - It scrubs both ways with the scroll (`cableFront`, tested).
- **Core.**
  - 24 clad panels in two tiers. Their vents breathe with the power.
  - The spinning rings carry 16 bolts and a flange each, in the ring mesh, so they spin with it.
- **Sparks** (600, or 160 on low) arc off the rings and THE RING only near full power (`sparkRate`).

Whole frame in the reactor: low 10–11 calls / 43k triangles, high 24–25 / 81k, ultra 24 / 101k.

## Checked
- Web tests: 1481 pass (1 skipped). Typecheck and build pass.
- Low tier, phone (390x844, low), and the 2D stills fallback (SwiftShader gets stills by default) render.
- Reduced motion keeps the static logo with no errors.
- Scrubbing from full reactor power back to the forest relights only the forest (the draw count returns to the forest's 28).
- No console errors.

## Open
- The 120 fps headroom on a real GPU is unmeasured.
- The real robot GLBs and `crack.glb` come later (Blender).
- At close range, near-trunk feet and logs still read a little angular.
