# Site audit, overnight 2026-10-20

Branch `overnight/site-audit`, from `perfect-then-multiply` at `4fd9c46`. Scope: the whole site except
the 3D intro and the transition (the lead's rewrite tonight) and the files on the don't-touch list.

## How it was measured

`web/scripts/site-audit.mjs` measures a production build served by `vite preview`. Re-run it on
any branch for another column:

```
cd web && npm run build && npx vite preview --port 4181 &
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/site-audit.mjs http://localhost:4181 \
  --out /tmp/audit --shots /tmp/audit/shots      # optional: --only bundle,load,frames,memory,walk --viewports desktop,laptop,phone
```

It prints JSON and a markdown table, and writes `site-audit.json` and `site-audit.md` to `--out`.
playwright-core isn't a dependency of the web app: the script imports it from `PLAYWRIGHT_CORE`, and
Chromium from `CHROME`, which defaults to `/opt/pw-browsers/chromium`.

- **Bundle:** read from `dist/`. It gives every chunk's raw and gzip size. "JS on the first request"
  is the entry plus its static imports.
- **First load of `/`:** resource timing on the page's own clock. A request counts as "before the
  loader" if it started before the loader reached 100 (`aria-valuenow`). From that point the loader
  only holds a beat, then lets go, and the workshop's models start streaming. Sizes are bytes on the
  wire from `vite preview`, which gzips. The Google Fonts are cross-origin and are counted apart.
  `?q=high` forces the 3D, as on a GPU. Plain `/` is what headless Chromium gets: it detects
  SwiftShader and shows the stills.
- **Frame interval:** SwiftShader is a software renderer, so these numbers are only good for comparing
  with each other. Each sample runs about 5 s with the pointer circling, because the canvas renders on
  demand. Other agents were running browsers on the same machine tonight, so the numbers are noisy.
  "rendered" counts only the frames that made WebGL draw calls.
- **Memory:** the heap is read with CDP after forced GC. The run goes `/?q=high` → `/site/results` →
  `/review2` → `/` four times, with in-app navigation (pushState + popstate, no reload) so the heap
  carries over. Live WebGL contexts are counted through weak references.
- **Walk:** every route at 1920×1080, 1280×720 and 390×844 (`isMobile`, `hasTouch`). It records
  console errors, failed requests, a blank root and sideways overflow. On `/` it does: the intro → the
  hub → the shelf, the machine and the bench (each closed with Escape) → "↑ Story".

The raw reports are `site-audit.before.json` and `site-audit.after.json` in this folder. The
"before" run used an earlier revision of the script (`16f21fc`). Its walk didn't yet wait for the hub
to settle and still counted hidden elements, so its walk findings are noisier. The bundle, load,
frame and memory sections measure the same way in both.

The backend wasn't running. Every page that calls it logs two refused requests to `:8000`. The
script reports those apart as "expected", and the pages show their sample or offline states.

## Before / after (1280×720 unless noted)

| | before (`4fd9c46`) | after (`overnight/site-audit`) |
|---|---:|---:|
| index chunk (the first request) | 477.5 KB / **153.5 KB gzip** | 187.8 KB / **62.6 KB gzip** |
| CSS on the first request | 74.2 / 14.8 KB gzip | 47.1 / 9.7 KB gzip |
| WorldRoot chunk | 149.9 / 50.4 KB gzip | 103.0 / 32.9 KB gzip |
| `/?q=high`: transferred before the loader is done | **498.2 KB** (20 requests) | **342.6 KB** (16 requests) |
| of it, JS (gzip on the wire / decoded) | 475.7 / 1590.8 KB | 325.5 / 1118.9 KB |
| `/?q=high`: loader at 100 (ms, SwiftShader) | 4872 | 3611 |
| `/` (stills): transferred before ready | 683.1 KB | 527.4 KB |
| Fetched before the first frame but not needed for it | urdf-loader, Gltf/three-stdlib, the workshop + machine 3D, MediaPipe¹ | none found |
| Heap growth per `/` round trip | −0.18 MB (noise) | 0.19 MB (noise) |
| WebGL contexts alive after leaving `/` | 0 | 0 |
| Page errors seen | `isReady` crash (intermittent, in a trial run), `/favicon.ico` 404 | none |
| Layout overflow | `/review2` at 390 px (+15 px) | none |

¹ Before, MediaPipe (≈130 KB) sat in the index chunk on every page.

What was fetched before the loader was done, at `/?q=high` (KB on the wire):

| before | KB | after | KB |
|---|---:|---|---:|
| three.module | 176.7 | three.module | 176.7 |
| index | 157.5 | index | 64.4 |
| WorldRoot | 51.9 | events (r3f) | 42.9 |
| events (r3f) | 42.9 | WorldRoot | 34.0 |
| Gltf (three-stdlib) | 22.1 | index.css | 10.2 |
| URDFLoader | 16.9 | WorldCanvas | 5.4 |
| index.css | 15.4 | WorldRoot.css | 5.2 |
| WorldCanvas, WorldRoot.css, BloomPass, loadTwinRobot, replay, BufferGeometryUtils, … | 21.3 | r3f, BloomPass, RoomEnvironment, Progress, Button, … | 4.0 |

The first after-run caught `Gltf` and `Helix` still loading before the frame: the cartridge tip
imported Helix when it mounted. That was fixed in `72dbcad`, and the after column comes from the
re-run.

### Baseline (before), full

#### Bundle

| | raw KB | gzip KB |
|---|---:|---:|
| all JS (47 chunks) | 2131.7 | 649.3 |
| all CSS | 191.1 | 43.4 |
| JS on the first request (entry + its static imports: 1 file) | 477.5 | 153.5 |
| CSS on the first request | 74.2 | 14.8 |

| chunk | raw KB | gzip KB |
|---|---:|---:|
| three.module | 668.0 | 172.2 |
| index | 477.5 | 153.5 |
| WorldRoot | 149.9 | 50.4 |
| RecordHudPreview | 130.9 | 32.7 |
| events (r3f) | 126.3 | 41.6 |
| SetupPage | 84.5 | 22.5 |
| index.css | 74.2 | 14.8 |
| Gltf | 71.4 | 21.3 |
| ReviewPage2 | 57.8 | 21.7 |
| URDFLoader | 55.6 | 16.2 |

The index chunk held react-dom (134 KB raw), **@mediapipe/tasks-vision (133 KB)**, **animejs (133 KB)**,
the router, the legacy pm pages (Record 27, Review 20, Results 10, Dataset 7), the hand cursor
(useHandPointer 18, gestureProcessor 15, CalibrationPanel 11, overlay 8, wizard 7), the record session
code (useRecordSession 12, teleop 20), and the legacy dashboard pages.

#### First load of `/`

| viewport | query | mode | FCP ms | ready ms | requests | KB transferred | of it JS KB | JS KB decoded | fonts KB (external) | KB in the 15 s after |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| desktop | `/?q=high` | 3d | 708 | 6454 | 21 | 498.5 | 475.7 | 1590.8 | 53.3 | 3440.3 |
| desktop | `/` | stills | 1000 | 913 | 22 | 683.1 | 464.4 | 1560.6 | 53.3 | 0.0 |
| laptop | `/?q=high` | 3d | 784 | 4872 | 20 | 498.2 | 475.7 | 1590.8 | 53.3 | 3440.3 |
| laptop | `/` | stills | 776 | 702 | 22 | 683.1 | 464.4 | 1560.6 | 53.3 | 0.0 |
| phone | `/?q=high` | 3d | 872 | 4146 | 20 | 498.2 | 475.7 | 1590.8 | 53.3 | 3440.3 |
| phone | `/` | stills | 824 | 696 | 22 | 683.1 | 464.4 | 1560.6 | 53.3 | 0.0 |

The "15 s after" column is the workshop's GLBs (3.3 MB: machine.glb 1.16 MB, room.glb 644 KB,
machine_body 398, bench 392, shelves 314, desk 179, pedestal 165, cartridge 127), then the twin's
URDF, STLs and demo episode (≈130 KB).

#### Frame interval (SwiftShader, relative only)

| viewport | tier | point | rAF median ms | rAF p95 ms | rendered/s | draws/frame |
|---|---|---|---:|---:|---:|---:|
| desktop | high | intro | 2699.9 | 3266.5 | 0.6 | 17 |
| desktop | high | hub | 2133.2 | 2433.3 | 0.6 | 55 |
| desktop | high | machine | 1200 | 1633.3 | 1.2 | 91 |
| desktop | low | intro | 116.6 | 200 | 8.9 | 3 |
| desktop | low | hub | 566.6 | 699.9 | 2.1 | 41 |
| desktop | low | machine | 350 | 433.4 | 3.2 | 77 |
| laptop | high | intro | 1383.3 | 3049.9 | 1 | 17 |
| laptop | high | hub | 1550 | 1800 | 0.8 | 55 |
| laptop | high | machine | 1666.6 | 2533.2 | 0.8 | 92 |
| laptop | low | intro | 66.7 | 150 | 13.7 | 3 |
| laptop | low | hub | 516.7 | 883.3 | 2.4 | 41 |
| laptop | low | machine | 333.4 | 700 | 2.9 | 77 |
| phone | high | intro | 1916.6 | 3933.2 | 0.7 | 17 |
| phone | high | hub | 3016.6 | 3016.6 | 0.5 | 48 |
| phone | high | machine | 566.6 | 916.6 | 2.1 | 79 |
| phone | low | intro | 16.7 | 49.9 | 39.6 | 3 |
| phone | low | hub | 83.3 | 150 | 12.5 | 34 |
| phone | low | machine | 83.4 | 166.6 | 11.5 | 65 |

Every sampled frame rendered (the circling pointer keeps the canvas drawing), so the "rendered"
intervals equal the rAF ones and are left out here.

#### Memory

| point | JS heap MB | DOM nodes | listeners | WebGL live (detached) / created |
|---|---:|---:|---:|---|
| start / | 8.83 | 361 | 609 | 1 (0) / 1 |
| c1 /site/results | 9.42 | 1225 | 603 | 0 (0) / 1 |
| c1 /review2 | 9.74 | 865 | 741 | 0 (0) / 1 |
| cycle 1 / | 11.92 | 849 | 744 | 1 (0) / 2 |
| cycle 2 / | 10.95 | 849 | 744 | 1 (0) / 3 |
| cycle 3 / | 11.26 | 849 | 744 | 1 (0) / 4 |
| cycle 4 / | 11.38 | 850 | 744 | 1 (0) / 5 |
| end /site/results | 11.22 | 1703 | 736 | 0 (0) / 5 |

No leak. The heap, the DOM nodes and the listeners are flat after the first round trip, and every
WebGL context is released on leaving `/`.

#### Walk (only rows with findings)

| viewport | route | step | finding |
|---|---|---|---|
| all three | / | bench | `Element is outside of the viewport`. On desktop and laptop this was the harness: it clicked while the camera was still gliding back from the machine (the hub turns "on" before the tags stop moving). On the phone it is real: see "Broken" 3. |
| phone | /review2 | | `overflow-x`: page 405 px wide at 390 px; `nav.sant-pill` 15 px off the right edge |
| phone | / | story | `em` 3 px off the right edge: the cartridge tip, hidden at the time (harness false positive, now filtered; the tip flips anyway) |
| all | /review2, /pm/review, /pm/results, /pm/dataset, /robots/setup | | 2 requests refused by the offline backend (expected) |
| (a trial load, not this run) | /?q=high | | `pageerror: Cannot read properties of undefined (reading 'isReady')` |
| (load) | every page | | `404 /favicon.ico` |

### After, full

#### Bundle

| | raw KB | gzip KB |
|---|---:|---:|
| all JS (89 chunks) | 2154.5 | 670.7 |
| all CSS | 191.4 | 45.5 |
| JS on the first request (entry + its static imports: 1 file) | 187.8 | 62.6 |
| CSS on the first request | 47.1 | 9.7 |

| chunk | raw KB | gzip KB |
|---|---:|---:|
| three.module | 668.0 | 172.2 |
| index | 187.8 | 62.6 |
| vision_bundle (MediaPipe, on hand-control start only) | 135.8 | 40.7 |
| RecordHudPreview | 131.0 | 32.8 |
| events (r3f) | 126.3 | 41.6 |
| WorldRoot | 103.0 | 32.9 |
| SetupPage | 84.5 | 22.5 |
| Gltf (after the loader) | 70.5 | 20.8 |
| ReviewPage2 | 57.9 | 21.7 |
| URDFLoader (when the twin loads) | 55.6 | 16.2 |

The total JS grows by 21 KB gzip: more chunks, each with its own preload glue, and parts of the
legacy pages that the index used to share are now copied into several chunks. None of that is on
`/`.

#### First load of `/`

| viewport | query | mode | FCP ms | ready ms | requests | KB transferred | of it JS KB | JS KB decoded | fonts KB (external) | KB in the 15 s after |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| desktop | `/?q=high` | 3d | 812 | 4957 | 16 | 342.6 | 325.5 | 1118.9 | 53.3 | 3505.8 |
| desktop | `/` | stills | 700 | 643 | 18 | 527.4 | 314.1 | 1088.6 | 53.3 | 0.0 |
| laptop | `/?q=high` | 3d | 648 | 3611 | 16 | 342.6 | 325.5 | 1118.9 | 53.3 | 3505.8 |
| laptop | `/` | stills | 636 | 598 | 18 | 527.4 | 314.1 | 1088.6 | 53.3 | 0.0 |
| phone | `/?q=high` | 3d | 588 | 3240 | 16 | 342.6 | 325.5 | 1118.9 | 53.3 | 3505.8 |
| phone | `/` | stills | 632 | 545 | 18 | 527.4 | 314.1 | 1088.6 | 53.3 | 0.0 |

#### Frame interval (SwiftShader, relative only)

| viewport | tier | point | rAF median ms | rAF p95 ms | rendered/s | draws/frame |
|---|---|---|---:|---:|---:|---:|
| desktop | high | intro | 2316.6 | 3099.9 | 0.8 | 17 |
| desktop | high | hub | 1849.9 | 2016.6 | 0.7 | 55 |
| desktop | high | machine | 1166.6 | 1499.9 | 1.1 | 91 |
| desktop | low | intro | 66.7 | 116.7 | 14.5 | 3 |
| desktop | low | hub | 250 | 450 | 4.2 | 41 |
| desktop | low | machine | 166.7 | 266.7 | 5.9 | 77 |
| laptop | high | intro | 466.7 | 2633.3 | 1.6 | 17 |
| laptop | high | hub | 966.7 | 1033.2 | 1.2 | 55 |
| laptop | high | machine | 616.6 | 1116.7 | 1.8 | 91 |
| laptop | low | intro | 50 | 83.3 | 22.3 | 3 |
| laptop | low | hub | 166.6 | 266.7 | 6.4 | 41 |
| laptop | low | machine | 116.7 | 183.3 | 8.5 | 77 |
| phone | high | intro | 449.9 | 2749.9 | 1.7 | 17 |
| phone | high | hub | 1050 | 1083.2 | 1.1 | 48 |
| phone | high | machine | 483.3 | 550.1 | 2.3 | 79 |
| phone | low | intro | 33.3 | 49.9 | 37.5 | 3 |
| phone | low | hub | 83.3 | 150 | 12.4 | 34 |
| phone | low | machine | 50 | 83.4 | 18.8 | 65 |

Nothing tonight changed what is drawn: the draw calls per frame are identical. The lower intervals
come from a quieter machine during this run, not from the changes, so don't read them as a speed-up.
On a software renderer, the high tier's per-frame cost (bloom plus MSAA at full resolution) dwarfs
everything else. The hub at high takes 55 draw calls, within the brief's 60.

#### Memory

| point | JS heap MB | DOM nodes | listeners | WebGL live (detached) / created |
|---|---:|---:|---:|---|
| start / | 9.95 | 854 | 611 | 1 (0) / 1 |
| c1 /site/results | 9.37 | 1718 | 606 | 0 (0) / 1 |
| c1 /review2 | 9.78 | 1360 | 744 | 0 (0) / 1 |
| cycle 1 / | 10.58 | 1133 | 777 | 1 (0) / 2 |
| cycle 2 / | 10.81 | 1134 | 777 | 1 (0) / 3 |
| cycle 3 / | 11.09 | 1134 | 777 | 1 (0) / 4 |
| cycle 4 / | 11.16 | 1134 | 777 | 1 (0) / 5 |
| end /site/results | 11 | 1988 | 769 | 0 (0) / 5 |

Heap growth is 0.19 MB per cycle. DOM nodes and listeners are flat, and every WebGL context is
released. The DOM-node plateau is higher than before (about 1134 against 849). I didn't investigate
why. It doesn't grow across cycles, so it isn't a leak.

#### Walk

Every step of `/` (intro, hub, shelf, machine, bench, "↑ Story") and every route passes at all three
viewports. No console errors, no page errors, no blank roots, no sideways overflow. The only console
lines are the two requests per backend page refused by the offline backend. On the phone, the walk
opens the machine and the bench through the new hub-bar buttons.

Screenshots of each non-world route at 1280×720 are in this folder: `1280x720-*.png`. Also here:
`phone-world-hub.jpg` (the hub bar's new buttons) and `phone-review2.jpg` (the pill nav now scrolls
inside itself).

## Broken: found and fixed

1. **`three` compileAsync crash** (`7a27a82`). The page error was `Cannot read properties of
   undefined (reading 'isReady')`, seen on `/?q=high` after the loader. three r169's `compileAsync`
   polls each material's program from a `setTimeout`. A material disposed while it waits has no
   program left, so the poll throws an uncaught error and the promise never settles. As a result,
   `WarmUp` in `web/src/world/core/Perf.tsx` never uploaded the streamed textures. The fix is the new
   `web/src/three/compileSafe.ts`: it polls the same way, drops a material that lost its program, and
   gives up after 10 s. WarmUp and the /robots shelf (`site/robots/ShelfScene.tsx`) use it. Tests:
   `three/compileSafe.test.ts`.
2. **`/favicon.ico` 404 on every page** (`4294856`). `web/index.html` now has
   `<link rel="icon" href="data:,">`. The mark is still a placeholder, so there is no real favicon yet.
3. **Phone: the machine and the bench couldn't be opened from the hub** (`da07a7c`). Held upright, a
   phone's room view frames only the shelf. The machine's and the bench's 3D tags sit off the sides,
   and the rail hides its labels below 720 px. Below 700 px the hub bar now shows **Shelf · Machine ·
   Bench** buttons in place of its hint, and "↑ Story" no longer wraps. The new files are
   `stations/workshop/HubBar.tsx` (moved out of `index.tsx`) and `stations/workshop/hubItems.ts` (what
   each item opens, shared with `HubTags.tsx`). Tests: `HubBar.test.tsx`.
4. **`/review2` overflowed a 390 px phone by 15 px** (`6d40f9b`): the AppNav's pages pill. In
   `web/src/sant/sant.css`, below 800 px the joins and links are tighter, and the pill scrolls
   sideways inside itself (`max-width: 100%; overflow-x: auto`).
5. **The cartridge tip could run off the right edge** (`947539d`). It now flips to the left of the
   cursor there. File: `world/ui/HoverTip.tsx`.

## Optimized

- **`5cb4c81`: every page in `App.tsx` is lazy.** That covers the legacy dashboard and its pages, the
  legacy pm pages behind `/pm/*`, and the `WorkShell`. The archive's hand cursor moved into
  `legacy/LegacyHand.tsx`, which is mounted and loaded only on `/legacy/...`. Leaving the archive
  unmounts it, which releases the camera through `useHandPointer`'s unmount cleanup, as the old
  effect did. `App.archive.test.tsx` now checks this by navigating in-app.
  `hand/tracking/mediapipeTracker.ts` imports `@mediapipe/tasks-vision` on `start()`, so `/pm/*`
  no longer downloads MediaPipe unless hand control is switched on. `world/scene/HoloTwin.tsx`
  imports the twin loader (urdf-loader + STLLoader) when it loads the robot.
- **`8e0261e` and `72dbcad`: the workshop's and the machine's Scenes are lazy**
  (`stations/workshop/index.tsx` and `stations/machine/index.tsx`). `WorldCanvas` mounts them only
  after the loader anyway, and `StationGroup` already wraps each Scene in Suspense. The cartridge tip
  loads its labels from `Helix` on the first hover. As a result, `Gltf` (three-stdlib), Helix, the
  spiral, the room's baked pieces and the hologram all load after the first frame.
- `web/src/firstLoad.test.ts` walks the static import graph from the source. It fails if any of
  these come back into the first load: the archive, the work pages, the hand cursor, three, MediaPipe,
  urdf-loader, or the workshop and machine 3D.

## Left alone (with where and how)

In files on the don't-touch list:

- **`web/src/world/stations/intro/Scene.tsx:184-185`** calls `r.compileAsync(scene, camera)`, which
  has the same `isReady` crash as fixed item 1. If it throws there, the loader's `compile` step never
  completes, and after `STALL_MS` (20 s, `Loader.tsx:12`) the world falls back to the stills. I never
  saw it fire in the intro: the intro's materials aren't swapped while it compiles. Fix: replace lines
  184–189 with `compileSafe(gl, scene, camera).then(done, done);` and import it with
  `import { compileSafe } from "../../../three/compileSafe";`.

Not on the list, but judgment calls left for the lead:

- **Phone portrait framing.** The camera's vertical FOV is fixed (40°) and nothing compensates for the
  aspect ratio (`core/CameraRig.tsx` `applyPose`). Upright phones crop the sides of every shot: the
  intro ring is wider than the screen, and the hub shows only the shelf. One option is to widen
  `fov` when `aspect < 1` (for example, keep the horizontal FOV of a 1:1 frame, capped near 70°).
  That changes the intro's look on phones, so I left it to the intro rewrite. The hub-bar buttons
  above cover the functional part.
- **Hub overlaps.** At 1280×720 the hub bar (top 20 px) overlaps the top of the "01 The shelf" tag. On
  the phone, the quality chip (`.world-q`, moved to `top: 70px` below 700 px in `world/ui/ui.css:197`)
  sits over the shelf tag's corner. Both are cosmetic. The tag's position comes from 3D
  (`HubTags.tsx`, `shelf: (0, 12.2, 0)`): lowering it about 0.6 m would clear both.
- **The stills fallback still downloads three.js.** Plain `/` on a software renderer fetches
  `three.module` (177 KB gzip) and r3f's `events` (43 KB) without drawing any 3D, because
  `WorldRoot`'s station modules import three for their layout and camera math. Splitting the camera
  data from three (or importing `WorldRoot`'s stations only in 3D mode) would save about 220 KB gzip
  for those users.
- **animejs in the index chunk (13 KB raw).** `sant/shells/PowerOn.tsx` → `sant/motion/dust.ts` →
  `ease("emph")` → animejs's `cubicBezier`. A local cubic-bezier for `dust.ts` would drop it from
  `/`. I left it: it saves about 5 KB gzip.
- **`web/src/styles.css` is global (≈7 KB gzip of the 9.7 KB first-request CSS).** It is the legacy
  dashboard's stylesheet, imported in `main.tsx`. Moving everything except its base rules into the
  legacy and work shells would trim the first CSS. It needs a careful pass because the work pages
  depend on it.
- **Google Fonts are render-blocking** (`web/index.html`): an external stylesheet with four families,
  53 KB of fonts before the loader is done. Self-hosting the two weights the loader waits for (Geist
  Mono 300/500) and preloading them would take the third-party request off the critical path. I
  didn't change it because `Loader.tsx` relies on the stylesheet's `@font-face` being present when it
  calls `document.fonts.load`.
- **GLB weight (3.3 MB after the loader).** `machine.glb` is 1.16 MB and nearly all geometry: 122
  meshes, with `Joint2.001`, `Joint3.001` and `Wrist.001` at 131 KB each and four `Torus.00x` at
  80–107 KB. `desk.glb` has an 80 KB `Torus.011`. Decimating those tori and joints in Blender, or
  meshopt compression on export (three-stdlib's `MeshoptDecoder`, no new dependency), would roughly
  halve it. `room.glb` is 644 KB, of which 627 KB is one JPEG atlas.
- **The twin loads at once.** `HoloTwin` fetches the URDF, 11 STLs and the demo episode (≈130 KB)
  right after the loader, competing with the GLBs, even though the machine is far away then. It could
  wait for the hub.

## Not measured

- Real-GPU frame rates (there is no GPU here); PERF.md remains the checklist for that.
- `/record` (don't-touch), `/legacy/*`, `/design`, `/pm/hand-art`: not in the walk.
- The `isReady` crash is timing-dependent. It appeared in 1 of about 28 loads of the 3D world before
  the fix (a trial run, not the recorded baseline), and in none of about 34 after it. I can't prove
  the fix from these numbers alone; the unit test covers the mechanism.
