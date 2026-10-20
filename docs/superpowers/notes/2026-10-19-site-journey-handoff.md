# Site journey: handoff

> **Superseded in part (2026-10-20):** the intro's breaks, the skylight well and the dive are gone.
> The intro is now a dark space round a glass logo, and the way into the workshop is a particle
> transition. See [2026-10-20-overnight-site.md](2026-10-20-overnight-site.md); the journey table and
> "How the transitions work" below are updated, the rest of this note still holds.

The state of the website at the end of the cloud session that built it, for whoever takes over the
next changes to the site and the Blender scene. The full build record is
[2026-10-19-site-journey.md](2026-10-19-site-journey.md), and the real-PC measurement checklist is
[PERF.md](../../../PERF.md).

- **Branch:** `claude/compassionate-cannon-u7cxjg`, branched from `pm/world-core`.
  [PR #39](https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project/pull/39).
- **Rules:** never touch `main` or `perfect-then-multiply`, and never commit `.env`.
- **Look rules** (docs/design/site-build-brief.md): no NVIDIA green `#76B900`, no eye motif, no
  "NV" letterforms; the logo stays swappable; honest numbers only.

## Run it

```
npm --prefix web ci
npm --prefix web run dev -- --port 5186
```

- `/` is the journey. Add `?hud` (or press backtick) for the performance HUD.
- `?q=low|high|ultra` forces a tier; `?static` shows the stills fallback.
- The backend (`uv run …`, port 8000) is only needed for Ask SANT and the work pages' live data.
  Without it, they show their sample data and say so.
- Checks: `npm --prefix web test` (vitest), and in `web/`, `npx tsc --noEmit -p .`. At handoff:
  62 files, 550 tests, 0 failed.

**Windows:** the site used to load a blank page on Windows. `Detail.tsx` sat next to `detail.ts`, and
`Hud.tsx` next to `hud.ts`. Vite resolves `./Detail` by trying `.ts` before `.tsx`, and a
case-insensitive disk then matches `detail.ts`. They are now `detailStore.ts` and `hudStore.ts`, and
`web/src/fileNames.test.ts` fails if two modules in one folder ever differ only by letter case again.

## What the site is

| Route | What |
|---|---|
| `/` (also `/world`) | The 3D journey (`web/src/world`); every unknown path redirects here |
| `/pm/record`, `/pm/review`, `/pm/dataset`, `/pm/results` | The work pages a cartridge opens, in the journey's look (`web/src/work/WorkShell.tsx`, `work.css`) |
| `/design`, `/design/app` | Internal design-system reference pages, not linked |

The journey, top to bottom. Positions are scroll heights in viewport heights (vh); jump straight to
one with `scrollTo(0, innerHeight * VH)` in the console.

| vh | Stop | Files (under `web/src/world`) |
|---|---|---|
| 0 | Loader, then the glass logo grows in | `stations/intro/*` |
| 0–7.2 | The hero and four beats beside the turning glass logo: the problem (1.2), S·A·N·T (2.7), the proof (4.2), Nemotron (5.7) | `stations/intro/{Scene,Story}.tsx`, `storyPlan.ts`, `logo3d.ts` |
| 7.2–8.2 | The logo becomes the ring | `stations/intro/Scene.tsx` |
| 8.2–11.2 | The descent: the ring bursts into particles that build the room | `stations/descent/{Generator.tsx,generatorPlan.ts,path.ts}` |
| 11.2–12.6 | The room materializes over the particles, then the lamps flicker on | `scene/{dissolve.ts,Materialize.tsx,Lamps.tsx}` |
| 12.6 (end) | The hub: the scroll ends; click the shelf (the spiral, the filters, the detail view), the machine, the bench | `stations/workshop/*`, `scene/Helix.tsx`, `scene/spiral.ts` |
| (branch) | The machine: plug in, the hologram | `stations/machine/Scene.tsx`, `scene/plugSequence.ts`, `scene/HoloTwin.tsx` |
| (branch) | The projection, then the zoom that opens Record | `stations/zoom/index.tsx`, `core/handoff.ts` |
| (branch) | The workbench | `stations/workbench/index.tsx` |

The core is `core/`:
- `rail.ts` and `store.ts`: stations on one scroll rail;
- `CameraRig.tsx`: the one camera;
- `quality.ts`, `autotune.ts`, `resolution.ts`, `Perf.tsx`: tiers and the frame-rate housekeeping;
- `iris.ts`: the rail's jump;
- `Hud.tsx`.

The station API is in `core/types.ts`, and `docs/design/world-core.md` explains it.

## How the transitions work (Active Theory's way: masked, never a fly-over)

- **Into the workshop** (2026-10-20): over the descent the intro's ring bursts into particles
  (`descent/Generator.tsx`: one Points draw, 24k/110k/150k by tier) that stream onto points sampled from
  the baked GLBs and the cartridges. Over the workshop's travel the real room materializes through a
  noise edge with a thin teal glow (`scene/dissolve.ts`, applied to every built-in material under
  `<Materialize>`); each particle fades as its surface appears. The lamps start at `LAMPS_AT`.
- **The journey rail's jump** (`core/iris.ts`, `WorldRoot.tsx` `jump`): clicking a station on the
  right-hand list closes a DOM iris, calls `store.jump(y)` (the scroll and the camera cut, with no
  glide), and opens on the station. Reduced motion uses the old veil cut instead. The branch
  (workbench) keeps its camera tween.

## Blender touchpoints

- **Source:** `docs/design/blender/sant-cartridge.blend`, scene `W_World`. The exports are described
  in `docs/design/blender/export/README.md`, and the files used live in `web/public/world/models/`.
- **Baked pieces:** `room`, `shelves`, `pedestal`, `bench`, `desk`, `machine_body`.
  - Each GLB carries one mesh named `baked_<name>` with one atlas, drawn unlit
    (`scene/Baked.tsx`); the lamps scale its colour.
  - A re-bake only needs the same mesh name.
  - Each also carries a stray copy of the bench parts (`bx_B_*`); it is ignored, and could be dropped
    from the export.
- **Live models:** `cartridge.glb` (parts are separate meshes), `cartridge_lod.glb`, `machine.glb`.
- **Camera stops:** the `camera_stations` in `web/src/world/scene/layout.json` (Blender Z-up,
  converted on load). They are read by name with `stop("Workshop intro")` and the like, so renaming a
  stop in Blender breaks the site. `layout.json` also holds the helix and library slots.
- **The ring ("the circle")** is not from Blender yet. It is a `TorusGeometry` in
  `stations/intro/Scene.tsx` (`RING` in `stations/intro/layout.ts`: radius 4.2, tube 0.3), and it
  scales down onto the skylight at the end of the intro. To swap in a Blender ring:
  1. Export it as `ring.glb` and load it there in place of the torus.
  2. Keep its end pose on `SKYLIGHT` (centre `[0, 14.32, 0]`, radius 5.2): the well, the dive and the
     ceiling opening are all sized from it.
  3. If the opening moves, change `SKYLIGHT`, and `ROOF.y` in the same file.
- **The ceiling** is still in `room.glb`, but it is only ever seen from inside now. Its opening (radius
  5.2 at y ≈ 14.32) has to line up with `SKYLIGHT`.
- **Budgets** (site-build-brief.md): ≤ 60 draw calls in the workshop (47 on high at handoff), no
  real-time shadows, and a first load under 3 MB before the first frame (1.66 MB at handoff; the GLBs
  stream after it, 4.1 MB).

## Verified, and not

- **Verified:** typecheck clean; all 550 web tests passing. Screenshots of the journey, the dive, the
  well, the rail jump and the work pages, rendered in a software-rendering browser (SwiftShader). They
  are in [2026-10-19-site-journey/](2026-10-19-site-journey/); 12–17 are the latest.
- **Not verified:**
  - Frame rates on a real GPU: the cloud had none, and PERF.md is the checklist for the real PC.
  - The rail's iris mid-wipe: the software renderer is too slow to catch it on screen. Its timing
    has unit tests.
  - On the user's RTX 4060 laptop, fps was mostly 60 with sudden drops. The fixes so far:
    - the auto-tune waits for streaming and uses medians over two windows;
    - the saved-tier key moved to `world.tier.v2`;
    - the resolution scale has hysteresis;
    - textures are uploaded during the loader.

    If drops persist, the HUD's `gpu` line (it flags `(integrated)`) and the `dpr … (scale …)` line
    at the moment of the drop are the first things to read.
- **Python:** 3 tests fail on `pm/world-core` already (`tests/test_launch_health.py` ×2,
  `tests/test_make_measurement_set_v2.py`); they are unrelated to the site.

## Open items

- The user will model the ring and the descent in Blender (see "The ring" above).
- PERF.md's tables are still empty: they need the real-PC numbers.
