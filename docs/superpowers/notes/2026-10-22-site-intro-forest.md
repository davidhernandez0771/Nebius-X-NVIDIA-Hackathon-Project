# Site intro, forest, rift, workshop reveal (`pm/site-intro-forest`, 2026-10-22)

Branch `pm/site-intro-forest` in `C:\dev\pm-t2`, from pm/live-13 `8d90a8e`. Nothing pushed. No Blender, no new
dependencies.

**GPU use:**
- Real-GPU checks (RTX 5080, headless Chrome d3d11) ran until the lead took `C:\dev\gpu.lock` at 21:33:48 for Blender.
- After that every shot is SwiftShader. One exception: two short real-GPU headless runs overlapped the lock's first
  minutes. These were the loader frames (~21:33–21:36) and a 60 s warm-up probe at ~21:45. Noted here because the rule
  is one heavy renderer at a time.

Before/after screenshots: `2026-10-22-site-intro-forest/{before,after}/`. "Before" is pm/live-13 (a detached checkout,
`7637481`, whose intro and workshop code is the same as `8d90a8e`).

## 1. The loader: the tesseract written in digits

The SANT mark (the open-corner tesseract, from `logoSymbol.ts`'s own paths) is laid on a grid of monospace cells
(`asciiMark.ts`, pure and tested).
- **Cells:** each cell on a stroke holds a digit; a dot or a colon sits on the stroke's soft edges.
- **Order:** the mark writes itself in in the logo's own lighting order (the frame, the corner lines, the cube, its near
  corner) as the real load goes from 0 to 100%. The progress is the existing loader's (`progress.ts`), not a timer.
- **The head:** the cells being written scramble (a teal "head" just behind the progress).
- **Unwritten cells** show as faint dots from the first frame, so the shape is there from the start.
- **Colour:** the inner cube is teal, as in the logo, and a faint teal breath comes up behind the cube as it completes.
- **Drawing:** `DigitMark.tsx` draws it on a 2D canvas, about 30 fps while writing and only on change after that.
  - Its name isn't `AsciiMark.tsx`: names that differ only by case break Windows (`fileNames.test.ts`).
- **Unchanged:** the progressbar (role, value, text), the 12 s "Continue anyway / 2D version" offer, the 30 s stills
  fallback and the lift.
- **Reduced motion:** nothing scrambles; the cells simply light.
- **Design rule:** the digits are decorative (the canvas is one image named "SANT"). The text that carries meaning (the
  %, the step) stays plain text.

## 2. Fireflies

They were 1,000 tiny points clamped to 12 px, so they read as dust. Now (`fireflyPlan.ts`, `fireflies.ts`):
- **Each one is sized in metres** (real depth: a spark far off, a big soft glow near the camera). A firefly has:
  - a hot body, whiter than its colour;
  - a glow round it;
  - a soft halo about 0.5 m wide.
- **Flash:** a quick flash, a slower fade, and a dim ember between flashes (`blinkAt`). Some do a double flash; each has
  its own period.
- **Wander:** two slow loops plus a small quick insect jitter (`driftAt`). The shader mirrors both functions, which
  are tested.
- **Fewer and seen:**

  | ultra | high | low | phones |
  |---|---|---|---|
  | 420 | 300 | 120 | 90 |

- **The crack's fireflies,** which fall with the camera, keep their old count (180 / 120 / 36 / 24) and their old look
  through the fall.
- **Colour:** multicolour but subtle, in pale tints led by warm gold, with teal, ice and violet accents. The hue test
  still keeps every colour out of 60–110° (no green).
- **Lanterns:** 8 of them really light the forest. Their places and brightness go to every forest surface's `place()`
  (moss, bark, robots, the rift's lip) as small soft pools. The lights go out with the forest, so the fall is unlit by
  them.
- **Cost:** one Points draw, as before. The lanterns add 8 small lights to the forest's surface shaders and no
  triangles.

## 3. The robots looked glitched: why, and the fix

**Three causes, all in the code (`robotLod.ts`, `Forest.tsx`), plus the exports themselves:**
1. **The levels of detail were made by snapping vertices to a 2–2.5 cm grid** in model space, which is about 6 cm in
   the world at 2.4× scale, and averaging their normals. That left the SO-101 with 599 of its 15,000 triangles and the
   others with 1.5–2.5k, all with mushy averaged normals: the blobby, shattered shapes.
2. **The two levels cross-faded with a per-pixel screen-door dither,** which read as speckle up close.
3. **Fake "panel seams" were stripes keyed to the model's height,** so they ran diagonally across every fallen robot,
   along with camouflage-like moss patches.
4. **Two GLBs are bad exports:**
   - `fr3.glb` is a triangle soup: 69% of its edges are open after welding, so it is cracked everywhere. It reads as
     speckled shards even untouched.
   - `openarm.glb` has 27% open edges.

**Fixes:**
- **A real decimator** (`robotSimplify.ts`, tested): quadric-error edge collapse (Garland–Heckbert) to a triangle budget.
  - Collapses are manifold-safe (link condition and flip guard), and part colours never blend.
  - Normals are rebuilt: hard over 55°, smooth across curves.
  - It runs in a Web Worker (`robotLevels.worker.ts`; `robotLevelsClient.ts` falls back to idle-time work), because each
    level takes 50–110 ms.
- **No dither:** the levels switch outright.
- **No stripes,** and a little sky and moss fill light so the side away from the moon keeps its form.
- **Only robots in view are drawn** (frustum and distance), so the near ones can have more detail.
- **Per tier, in triangles per robot:**

  | Tier | Far level | Near level | Near within | Not drawn beyond | Robots |
  |---|---|---|---|---|---|
  | low | 1,600 | none | – | 24 m | 4 |
  | high | 2,200 | 5,000 | 4.5 m | 26 m | 6 |
  | ultra | 2,800 | 7,000 | 5 m | 30 m | 6 |

- **Soup exports** (open-edge share over 15%) get one level, no coarser than 6,000 triangles (`SOUP_FLOOR`). The OpenArm
  holds up at that.
- **`fr3` is left out of the forest** (`FOREST_SKIP`) until it is re-exported clean (the Blender list below). Its spot is
  kept, so the other spots don't move.

Close-ups (SwiftShader; the same camera before and after): `closeup-{franka,piper,openarm,ur5e}.jpg`.

## 4. Trees (shader and procedural; the Blender models come next, see below)

- **Bark relief** by bump from a height field, fading with distance so far trunks don't shimmer:
  - deep furrows between raised plates;
  - the plates cracked across;
  - knots;
  - pale lichen on the plates, more on the moon's side;
  - moss at the foot (kept).
- **Each trunk its own shape** (vertex shader, no extra triangles): it wanders off its line as it rises, with a fluted,
  uneven section and its own taper. `trunkBend` mirrors this in TS and is tested.
- **The canopy:** branch cards on the near and mid trunks, from about 9 m up (2 triangles each, an upright and a flat
  card per branch; ~1.5k triangles on high).
  - Alpha-tested, so no sorting.
  - Cut into a rising limb, twigs and leaf clumps.
  - Dark against the fog.
- **Depth:** a backdrop ring beyond the last far trunks, with three rows of trunk silhouettes, each deeper in the fog,
  under a ragged canopy band. It is one draw and about 100 triangles, with its own fog.
- **Budget:** ferns were trimmed to fit (high 160 → 150, ultra 250 → 236, low 70 → 68).

## 5. The rift (the crack, seen from the forest)

- The lip's edge is caught by the light from below, broken where the rock has crumbled.
- Hairline fractures run off it into the ground, lit from inside.
- 120 stones lie on the lip (high and ultra), lit by the rift on their crack-facing faces.
- Embers drift up out of it.
- A soft curtain of light rises off its outline, strongest where it is seen edge-on.
  - Two crossed quads first drew white dashes edge-on, so the curtain follows the outline instead.

All of it shows only while the forest is lit. **The fall and its hand-over to the reactor are untouched:**
- dropLight, the crack's walls and cap, and the reactor are unchanged;
- the falling fireflies keep their count and look;
- `desktop-06-fall-unchanged.jpg` before and after match.

## 6. The workshop reveal: "boom, there it is"

**Before:** the room dissolved in piece by piece over 1.4 viewport heights of scroll, after the descent's counter had
already read 100% (`before/desktop-08…10`).

**Now** (`scene/dissolve.ts`, `stations/workshop/Scene.tsx`):
- **The trigger:** the descent's counter reads 100% (descent t ≥ 0.95, where the particles have converged) and the
  room's files are in (or 4 s after, if a file never comes).
- **The play:** the whole room plays in through the same glowing noise edge in **1.1 s** (`REVEAL_S`), whatever the
  scroll does. A long frame never pops it (each frame step is capped at 50 ms).
- **After:** the lamps flicker on; the counter then reads "// the workshop · online".
- **Scrolling back up** above that point plays it back out into the particles.
- **Kept:** reduced motion is unchanged (the room is simply there behind the veil).
- **The push-in travel** after the room is shorter: 1.4 → 0.8 vh.
- **Clicks and lamps** follow `roomWhole()`, not the scroll.
- **Teammates:**
  - T5 (pm/site-workshop-interact) agreed the split. I own `dissolve.ts`, the `Reveal` component, the `active` gate,
    `Lamps.tsx`'s start, and the workshop travel.
  - Their meshes sit inside `<Materialize>` and follow the shared uniform.

## Also: NaN guard (T1's report)

GLSL `pow` with a negative base is NaN on D3D, which the bloom smears into flickering dashes (T1 fixed the workshop's
shafts in e7b3d24).
- **Fixed here:** every GLSL `pow` in the intro and the descent now guards its base. That covers the forest's light
  shafts, every rim, the reactor's pulses, the fireflies and the descent's twinkle.
- **One exception:** the reactor's Gaussian head squares a value that goes negative by design, so it gets `abs()` there.
- **Test:** `shaderPow.test.ts` holds the rule over the sources.

## Checks

- **Tests first** for each piece:
  - `robotSimplify` (9), `asciiMark` (7), `riftDetail` (4);
  - fireflies: plan 12, drawn 4;
  - forest geometry: canopy and backdrop;
  - `dissolve` (5, the timed reveal), `shaderPow` (1);
  - updated: robot tiers, wrecks, LOD and the budget test. The budget test now counts only the robots in the camera's
    view along the path (16:9, plus a portrait phone on low) and the rift's triangles.
- **Full web suite** (`--minWorkers=1`): **205 files, 1,863 passed, 1 skipped.** That run was before the NaN commit; the
  intro tests passed again after it.
- **`tsc -b` and `npm run build`:** pass. The worker is bundled (`robotLevels.worker-*.js`).
- **Triangle budget**, worst frame along the camera's path (`robotBudget.test.ts`):

  | Tier | Worst frame | Budget | Draws |
  |---|---|---|---|
  | low | 59,966 | 60,000 | 10 pieces + robots + crack |
  | high | 159,725 | 160,000 | 10 pieces + robots + 2 crack |
  | ultra | 189,956 | 190,000 | 10 pieces + robots + 2 crack |

  All three tiers are now full. The tree GLBs must fit inside them (I sent the lead the per-layer numbers).

### Real GPU: frame times (RTX 5080, headless d3d11, 1280×800 at 1.5×, `world-perf.mjs MODE=hold`, 4 s per position)

| Position | high before | high after | ultra before | ultra after |
|---|---|---|---|---|
| hero | 8.3 / 8.5 ms | 8.3 / 8.4 | 8.3 / 8.6 | 8.3 / 8.6 |
| forest 3.0 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.6 | 8.3 / 8.7 |
| forest 3.4 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 |
| forest 3.8 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 |
| rift lip 4.5 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 |
| fall 5.3 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.4 | 8.3 / 8.5 |
| workshop 16.2 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 | 8.3 / 8.5 |

- **Reading the table:** each cell is the frame time p50 / p95. Every position holds the 120 Hz cap (8.3 ms, about
  120 fps) before and after. The GPU timer reads ~0 ms here, so the frame times are the honest number. A 4060-class GPU
  is still unmeasured.
- **Draw calls in the forest:** 23 → 28 (canopy, backdrop, rift stones, glow, embers).

**The opening** (`MODE=reveal`, 3 fresh loads per tier, the 6 s after the loader lets go):

| Server | Loader lets go | Long tasks | Stall | Worst frame |
|---|---|---|---|---|
| Before (fresh) | 2.0–2.8 s | 0–2 per load, ≤ 57 ms | 0–408 ms | ≤ 67 ms |
| After (warm) | 2.0–2.4 s | 0–1 per load, ≤ 54 ms | 0–309 ms | ≤ 50 ms |

- One load in three has a short stall on both builds.
- Right after a dev-server restart the "after" runs showed 13–22 long tasks. A CPU profile with the same settings put
  them all under the loader, before it lets go. That was Vite transforming modules cold, and a warm rerun was clean.
- The robots' simplification runs in the worker: the page loads `robotLevels.worker.ts?worker_file`, and no long task
  after the reveal comes from it.

### Screenshots (`before/` and `after/`)

**Desktop, 1280×720, real GPU:**
- 01: the loader at 60% (after also has 01b at 100%);
- 02–04: the forest walk;
- 05: the rift's lip;
- 06: the fall (unchanged);
- 07: the descent;
- 08–09 after: the room at 0.65 s and 2.5 s after the counter hit 100%, scroll unchanged;
- 08–10 before: the old piece-by-piece materialize over the scroll.

**Phone, 390×844 at 3×, low tier, SwiftShader:**
- 01: the loader;
- 02: the forest;
- 03: the rift;
- 04: the workshop, whole, "online".

**Close-ups, SwiftShader:** the Franka, Piper, OpenArm and UR5e, the same camera before and after.

## Blender list (for later; nothing here was made in Blender)

1. **Re-export `fr3.glb` as a clean, welded mesh** (today it is a triangle soup, 69% open edges), with an LOD near
   2.5k triangles. It then goes back into `ROBOT_TIERS`.
2. **Re-export `openarm.glb` welded** (27% open edges), so it can take the normal 2.2–2.8k far level.
3. **Trees:** the lead is modelling them now (3 trunk variants with LODs, baked bark, leaf cards).
   - I sent the per-layer counts and the triangle budget they must fit: high's trunks and roots cost about 84k today.
   - I'll swap in uniform per-tree scale and the baked bark, and drop the procedural roots, branch cards and
     `trunkBend` where the models replace them.
4. **Optional:** a few rift-lip rock clusters with a cleaner broken edge, to replace the procedural stones.

## What the user should check

1. **The loader:** the digit tesseract writing itself in (desktop and phone), then the lift.
2. **The fireflies' brightness, size and number,** and whether the lantern pools on the moss are too subtle or too much
   (`fireflies.ts` halo 0.5 m; `placeShaders.ts` glow 0.03).
3. **The robots:** clean shapes now. Does the forest feel right with 6 robots until fr3 is re-exported?
4. **The trees** (bark, bends, canopy, backdrop). They are a stopgap until the Blender trees land.
5. **The rift's lip:** glow strength, fractures, stones, embers. And confirm the fall into the reactor still feels the
   same.
6. **The workshop:** the room should appear whole in about a second when the counter hits 100%. Is 1.1 s right
   (`REVEAL_S`)? Does the shorter push-in after it (0.8 vh) feel right?

## Open

- The fall's fireflies use the new, paler palette. Their count, motion and old sprite are kept through the fall.
- The canopy cards are subtle from the walk (the camera rarely looks up). The Blender trees will replace them.
- A 4060-class GPU has not been measured.
