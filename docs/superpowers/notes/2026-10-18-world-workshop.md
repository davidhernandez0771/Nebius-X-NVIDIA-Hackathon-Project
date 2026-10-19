# The workshop on the world core (`pm/world-core`, 2026-10-18)

The workshop part of `/world`, built from the Blender export in the main checkout
(`docs/design/blender/export/`, see its README) on the shared core (`docs/design/world-core.md`).

**To view it:** run `npm --prefix web run dev`, then open `http://localhost:5173/world`.

- **Force a tier:** `?quality=low|high|ultra`; `?quality=stills` (or `?static`) shows the fallback.
- **Jump to a stop:** these scroll positions are in viewport heights; the workshop intro is at 6.7,
  the shelf 8.2, the machine 9.0, Plug in 9.8 and the projection 10.6.
- **Measure:** see "How the numbers were taken" below.

## What's built

| Asked for | Where | Notes |
|---|---|---|
| Static room from `baked/*.glb`, unlit, no live lights | `scene/Baked.tsx` | The `baked_<name>` mesh of each of the 6 files, on `MeshBasicMaterial` with its atlas, no tone mapping. All six sit in the workshop Scene (`reach: 2`, so the room stays behind the machine and the zoom). |
| Spiral cartridges: `InstancedMesh` from `cartridge.glb`, slots, labels and shell colours from `layout.json`, a label atlas | `scene/Helix.tsx`, `scene/cartridge.ts`, `scene/labels.ts` | One InstancedMesh per part (8 draws for all 29). The label tile comes per instance through an `aTile` attribute. The atlas is one 2048×752 canvas with 8 tiles in the B-focus look, redrawn once Geist loads. Shells take the layout's tint (Graphite by default). |
| Library shelves from `cartridge_lod.glb` | `scene/Library.tsx` | 442 instances in 2 draws, Lambert on every tier, with repeatable tints and tiles. |
| The machine's moving parts from `machine.glb` | `stations/machine/Scene.tsx` | Fans spin. The strip, fan marks, slot and lens glow. The hologram has the beam, the wireframe arm and the Record screen, which unfolds as it lights. Everything else in the file is baked. |
| Camera stations from `layout.json` | `scene/layout.ts`, every station's `camera` | See "Camera stops". |
| Quality tiers Ultra / High / Low and stills, picked by a quick GPU check | `core/gpu.ts`, `core/quality.ts`, `WorldRoot` | See "Quality". |
| Load: starts dark, the lamps flicker on while the assets load | `scene/flicker.ts`, `scene/Lamps.tsx`, `scene/power.ts` | See "The lamps". |
| Hover lifts a cartridge; click sends it to the machine (the plug-in from the video) | `scene/Helix.tsx`, `scene/plugSequence.ts` | See "The plug-in". |

### Camera stops

Blender keys only the eye and target; the lens isn't exported, so every stop uses a 40° vertical fov.

- **Story:** Title → One demo → Proof.
- **Descent:** one turn around the spiral's axis from the Descent stop, down to y = 20. It stays above
  the 14.4 m ceiling, so the travel into the room comes in over the open front wall.
- **Workshop:** Workshop intro → Tutorial 1 (shelf).
- **Machine:** Tutorial 2 (machine) → Plug in → Projection, which is `MACHINE_VIEW`.
- **Zoom:** Projection → Zoom to UI. A test checks that this stop sits on the hologram's normal and
  that its target is the screen's centre in `machine.glb`.
- **Workbench branch:** Workbench edit.
- **"Tutorial 3 · bench" is not used.** The bench is a branch (`goTo("workbench")`), not a rail stop.

### The lamps

- **Baked materials:** the room's light is baked, so "the lamps" are one level from 0 to 1
  (`power.ts`). It scales:
  - every baked material's colour;
  - the two live lights;
  - the light strips;
  - `scene.environmentIntensity`. three r169 ignores `material.envMapIntensity` for a scene-wide
    environment, so this is the only way the reflections follow the lamps. It was found when the
    cartridges stayed lit in a dark room.
- **Sequence:** the lamps play from halfway down the descent.
  - While files are still arriving, they sputter: short dim flashes, more often as more arrives.
  - When all 9 are in, they run the power-on: two false starts and a dip, full by 1.1 s.
  - With reduced motion, the room stays dark, then fades up in 0.4 s.
- **On a 4 Mbit/s throttled network:** the room shows as a silhouette with the spiral dark too, and
  the lamps come on when the last file (`room.glb`) lands. The frames are in
  `web/scripts/world-perf.mjs` `MODE=load`.

### The plug-in

- **The sequence follows `W-anim-insert-plug-v1-0600-0960.mp4`:**
  1. The cartridge tilts out of its slot, top first.
  2. It flies to above the port, turning edge-on.
  3. It drops in.
  4. The slot flashes.
  5. The projector comes up.
- **One deliberate change from the video:** the flight goes round the spiral rather than through it.
  - Climbing flights rise first; flights coming down from high slots move out first.
  - A test checks all 29 flights, using oriented boxes, against:
    - the desk;
    - the machine's body;
    - the port;
    - every other cartridge.
- **Click or robot button:** sends that slot. The sequence runs in 3.6 s, and the journey scrolls to
  the machine to watch it.
- **No click:** the machine's own dwell plugs in the SO-101 from the lowest slot by the "Plug in"
  stop, and lights the projection before the "Projection" stop.
- **Reduced motion:** it lands plugged in.
- **Hits:** they go to a 12-triangle box per cartridge, not the 2,000-triangle shells.
- **Hover:** only works while the workshop or the machine is the current station.

### Quality

| Tier | DPR | AA | Idle loops | Materials | Extras |
|---|---|---|---|---|---|
| low | 0.75–1 | off | none (an idle world draws nothing) | Lambert | none |
| high | 1–1.5 | on | fans, the hologram | standard + a small RoomEnvironment | none |
| ultra | 1–2 | on | fans, the hologram, dust | clearcoat (physical) | haze shafts under the lamps and down the ceiling opening, 760 dust motes, denser fog |
| stills | no canvas | | | | one 1280 px WebP per station from `docs/design/blender/*.png`, behind the same overlays and controls |

**How the GPU check picks** (`core/gpu.ts`):

- It runs once per session (`sessionStorage` `world.gpu`).
- It opens a WebGL2 context and reads the unmasked renderer's name.
- It times one fragment workload: 8 passes, 512², 48 steps.
- These go to the stills:
  - no WebGL2;
  - a software renderer (SwiftShader, llvmpipe, Basic Render);
  - the performance caveat.
- The name suggests a class:
  - discrete → ultra;
  - old integrated or phone → low;
  - anything else → high.
- The timing can only lower that class: above 3 ms, ultra drops to high; above 24 ms, it drops to
  low; above 400 ms, stills.
- Phones, data saver and machines with ≤2 cores get low. Ultra also needs 8+ cores and 8+ GB.
- **Here:** RTX 5080, timing 0.2–0.9 ms, so ultra.

## The numbers

**Machine:** RTX 5080 and i9-14900KF, Chrome headless with `--use-angle=d3d11` (the real GPU, not
SwiftShader; GPU timer queries available).

**Screen:** emulated as a mid laptop's, 1280×800 CSS px at 1.5× (canvas 1897×1200 on high and
ultra, 1265×800 on low). The display rate is 120 Hz, so 8.3 ms is a full-rate frame.

| Tier | Where | Frames drawn/s | Frame p95 / p99 (ms) | Main thread per frame, CPU 1× / 4× throttled (ms) | GPU timeline p50 / p95 (ms) | Draw calls | Triangles |
|---|---|---|---|---|---|---|---|
| low | idle at any stop | **0** | 8.5 / 8.5–16.6 | none drawn | none | none | none |
| low | scrolling the rail | 120 | 8.5 / 8.5 | 1.6 / 2.9 | 2.6 / 3.9 | 38 (max 75) | 130k |
| high | idle at the 5 stops | 120 | 8.4–8.5 / 8.5–8.6 | 1.0–2.0 / 2.8–3.6 | 2.5 / 4.0 | 23–67 | 122–128k |
| high | scrolling the rail | 120 | 8.5 / 8.5 | 1.5 / 3.5 | 2.6 / 3.9 | 38 (max 75) | 130k |
| ultra | idle at the 5 stops | 120 | 8.4–8.5 / 8.5–8.7 | 1.4–1.9 / 3.0–4.6 | 2.5–2.6 / 4.1 | 27–71 | 122–129k |
| ultra | scrolling the rail | 120 | 8.5 / 8.6–8.8 | 2.1 / 4.0 | 2.5–2.7 / 4.1–4.7 | 42 (max 79) | 130k |

- **No dropped frames.** No run dropped below the full 120 Hz at p99. The worst single frame was
  33 ms, once, on ultra at 4× CPU throttle.
- **The GPU timeline isn't shading load.** An empty scene measures 0.0 ms. Rendering the full scene
  at 14.6× the pixels (7274×4560) moves it only from 2.66 to 2.90 ms on high, and not at all on
  ultra (2.87 → 2.87).
  - So the ~2.6 ms is draw submission through ANGLE, not fill.
  - Fill and shading cost about **0.02 ms per 1920×1200 frame** on this GPU.
  - Hiding any single part (spiral, library, ribbon, a baked piece, the machine) changes the timeline
    by at most ~0.4 ms.
- **Memory and download:**
  - JS heap: 25–37 MB.
  - Models: 4.0 MB, uncompressed glTF. `room.glb` (1.37 MB) and `machine.glb` (1.13 MB) are most of
    it; the stills are 0.2 MB.

### "60 fps on a mid laptop at High": what is measured and what is estimated

- **Measured, CPU side:** on high, the main thread spends at most 3.6 ms per frame at 4× CPU
  throttle. That is 22% of a 60 fps frame (16.7 ms). A mid laptop CPU is roughly 2–3× slower than
  this one single-threaded, so 4× is a conservative stand-in.
- **Estimated, GPU side (not measured on a laptop):**
  - **Fill:** 0.02 ms here × ~25 (Iris Xe or Radeon 680M class against an RTX 5080 in shader
    throughput) ≈ 0.5 ms.
  - **Geometry:** 130k triangles in ≤75 draws, small for any GPU from the last five years.
  - **Total:** a few ms of a 16.7 ms frame. Very likely within budget, but **not verified on real
    hardware**.
- **To verify:** on the laptop, run the dev server and `node web/scripts/world-perf.mjs
  http://localhost:5173 perf.json`. Or open `/world?quality=high` with the DevTools Performance
  panel and check the GPU track. The same run also calibrates `BENCH_MS` in `core/gpu.ts`, whose
  laptop thresholds are estimates too.
- **Continuous drawing:** high and ultra draw every frame while the machine is in view (the fans),
  at the display's rate: 120 frames/s on a 120 Hz screen. Low draws only when something moves.

### How the numbers were taken

- **The harness:** `web/scripts/world-perf.mjs`, with no dependencies (Node's WebSocket and the
  DevTools protocol).
  - It drives a separate headless Chrome. The visible Chrome tab was throttled to ~2 frames/s,
    because Windows reported it as covered, so it couldn't be used for timing.
  - In the page, it wraps the renderer with `EXT_disjoint_timer_query_webgl2` and counts
    `renderer.info`.
  - Main-thread time is Chrome's `TaskDuration` over each window, divided by the frames drawn.
- **Each tier:**
  - 4 s idle at each of the 5 stops;
  - a 12 s steady scroll from the descent to most of the way into the zoom;
  - the same again at 4× CPU throttle.
- **Raw results:** in the session scratchpad (`perf-cpu1.json`, `perf-cpu4.json`, `parts-*.json`);
  re-run the script to regenerate them.
- **GPU use:** only Chrome (the browser preview). No Blender, no Isaac.

## Decisions and deviations

- **Folders:** `stations/workshop/` (T6) and `stations/machine/` (T7) no longer hold placeholders.
  This pass replaced both, and the workbench (T1) lost its placeholder boxes, because the baked bench
  is in the room. Its live parts can come from `workbench.glb`, which isn't used yet.
- **Shared Blender world:** it lives in `web/src/world/scene/`, not in one station's folder:
  - the layout;
  - the baked pieces;
  - the lamps;
  - the cartridges;
  - the plug-in;
  - the haze.
- **Core changes:**
  - **`types.ts`:** `reach`, `still` and `Cartridge.slot`.
  - **`rail.ts`:** `through()` and `reach` in `fillFrames`.
  - **`layout.ts`:** Blender coordinates, `PROJECTION.normal`, `inFront()`, and the SO-101 as the
    default.
  - **`quality.ts`, `gpu.ts`:** the tiers and the GPU check.
  - **`WorldRoot`:** the stills.
  - **`WorldCanvas`:**
    - no lights of its own;
    - fog by tier;
    - a dev-only `window.__world3d`.
  - **`world.css`:**
    - the stills;
    - the panel backdrop;
    - `.world-panel` only lets its controls take the pointer. Its empty box was blocking the
      cartridges behind it.
- **Which `machine.glb` parts are live:** decided by count. `baked/machine_body.glb` has 73 objects
  and 4,368 triangles, which matches everything except:
  - the fans;
  - the fan marks;
  - one of the slot glow or the strip;
  - the lens;
  - the beam, screen and arm.

  Those are drawn live; the rest is never drawn twice.
- **Robots:** the label codes are read as SO-101, Franka FR3, AgileX PiPER, Flexiv Rizon 4 (RZ4 is my
  reading, to check) and OpenArm.
  - Each label prints a short spec line.
  - Every robot opens `/pm/record`; Record has no robot parameter yet.
  - The zoom's button says "Open SO-101" and similar.
- **Added because the export doesn't have them:**
  - the spiral's band with its teal edge (`scene/Ribbon.tsx`, a curve through the cartridges' bottom
    edges);
  - the two pendant lamp fittings (`scene/Pendants.tsx`). Their pools of light are in the bake; the
    positions are by eye against W-baked-preview.
- **Shell tints:** they follow the layout's RGB. Smoke and Signal (translucent) aren't supported per
  instance, and the layout uses neither.
- **Overlay copy:** the three steps of the W-hero-intro render (pick a robot, plug it in, add a
  cartridge) and one button per robot, the keyboard path for the 3D click.

## For the Blender pass

- **The stray bench copy:** every `baked/*.glb` also contains a full copy of the bench's parts
  (`bx_B_*`, 23 nodes, ~106 KB per file). The web ignores them; dropping them would save ~0.6 MB.
- **The lens:** exporting the camera's lens per stop in `layout.json` would let the fov match the
  renders. Every stop uses 40° now.
- **The fittings:** the pendant fittings and the spiral band are worth exporting so they match the
  renders exactly.
- **The textures:** the atlases are JPEG inside the GLB. KTX2 or meshopt would cut the 4 MB, but that
  needs a tool install, which wasn't done here.

## Not done

- **A laptop measurement:** see above.
- **Adaptive quality:** the tier is still chosen once.
- **Stills:** four of the six are 640 px tiles from the contact sheets, upscaled. A full-size render
  per station would be sharper.
- **`docs/design/blender/`:** it is untracked in the main checkout. The assets used here are copied
  into `web/public/world/` and committed.
- **Not checked:** the crossing from `/site` into `/world`, and phone-width layout of the workshop
  panel (the panel is wide on a phone).

## Tests

**Web:** 570 passed, 0 failed; `tsc -b` OK. New tests:

- the layout conversion and stops;
- robots;
- labels;
- the band;
- the flicker curves;
- the lamp switch;
- the plug-in, including all 29 flights' clearance;
- the haze;
- the GPU classification;
- the tiers;
- the stills fallback;
- the rail's `through()` and `reach`;
- the zoom on the projection's normal.
