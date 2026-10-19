# The site journey on the world core (2026-10-19)

The overnight build from `docs/design/site-build-brief.md`. It follows the look and behaviour of
`docs/design/prototypes/site-journey.html` and the walkthrough in
`docs/design/references/activetheory.md`, and it is built on `pm/world-core` (the r3f world, its
tiers, the baked room, the helix, the plug sequence and the rail). There is no new 3D stack.
Branch: `claude/compassionate-cannon-u7cxjg`, one commit per step.

- **Open it:**
  ```
  npm --prefix web run dev
  ```
  then go to `http://localhost:5173/world`.
- **URL flags:**
  - `?q=low|high|ultra` forces a tier (it also turns the auto-tune off);
  - `?q=static` (or `?static`) gives the stills page;
  - `?hud` opens the HUD. The backtick key toggles it any time.
- **Ask SANT with the model:** run the backend (`uv run uvicorn app.main:app --reload --app-dir src`,
  with the Nebius key in `.env`). Without it, Ask SANT uses its keyword rules.

## What was built

| Brief step | What | Where |
|---|---|---|
| 1. The opening | See "The opening" below | `web/src/world/stations/intro/` |
| 2. The spiral with an arm | See "The spiral" below | `scene/items.ts`, `scene/spiral.ts`, `scene/Helix.tsx`, `scene/Arm.tsx`, `stations/workshop/camera.ts`, `stepper.ts`, `ui/HoverTip.tsx` |
| 3. Filters | See "Filters" below | `stations/workshop/Dock.tsx`, `scene/spiral.ts` |
| 4. Click → detail → plug in | See "Detail and plug-in" below | `stations/workshop/detailStore.ts`, `Detail.tsx`, `core/store.ts` (`override`), `core/CameraRig.tsx`, `stations/machine/Scene.tsx`, `core/scroll.ts` |
| 5. Ask SANT | See "Ask SANT" below | `web/src/world/ask/`, `src/app/ai/ask.py`, `src/app/routers/ask.py`, `stations/workshop/tour.ts` |
| 6. Accessibility and fallback | See "Accessibility and fallback" below | across the above; `core/rail.ts` (`reducedPoseAt`) |
| Performance rules | See "Performance" below | `core/quality.ts`, `core/autotune.ts`, `core/PostFX.tsx`, `core/Perf.tsx`, `core/Hud.tsx`, `App.tsx` |

### The opening

- **Loader:** a cartridge drawn in `/` characters fills from the bottom, with a `//N` counter.
  - It is driven by real milestones (`progress.ts`):
    1. the 3D chunk and the WebGL context;
    2. Geist Mono;
    3. three's loading manager through drei's `useProgress` (the mark image);
    4. the particles built for the tier;
    5. `renderer.compileAsync()` over everything on screen.
  - If the 3D never gets there (20 s), the world falls back to the stills.
- **Logo:** one image (`web/public/world/mark.svg`, a placeholder) is sampled into points: 60% on
  the mark, 40% in two plumes. The iridescent ring sits round it.
  - The logo turns toward the cursor.
  - Scrolling sends the particles up in an arc and down onto a lattice dome over the ceiling: rings
    and spokes, some inside the skylight, so it shows from the room.
  - The ring settles on the ceiling's opening as the skylight's rim (radius 5.2 m, read from
    `room.glb`).
- **Story beats:** DOM over the canvas with the scramble reveal (`ui/Beats.tsx`, `ui/scramble.ts`).
  - The intro has "One human demo.", "Checked by physics." and "Multiplied.".
  - The descent has the stats.
  - The workshop has "The workshop.".
- **Numbers:** the honest numbers from the prototype only (3/40 → 17/40, p = 0.0005, 40/40).
- **Dust:** one Points object for the whole journey.
- **Shaders:** ported as they are, point-size clamps included (5 px logo, 3.5 px dust, times the
  pixel ratio). The changes are a distance factor for the larger Blender scale and the dust
  column's bounds.
- **Rail:** `story` is replaced by `intro`. The intro's camera runs from Blender's Title stop, round
  and over the logo, to the Descent stop, so the descent now has `travel: 0`.

### The spiral

- **Jobs:** the 24 jobs from the prototype's `ITEMS`, with honest numbers and "pending" marked as
  pending.
- **Slots:** they sit in the existing instanced Helix (8 draw calls), in slots 2–25. The three
  highest slots reach up through the ceiling, so the five robots take those and the two lowest; the
  SO-101 keeps slot 0 for the machine's default plug-in.
- **Labels:** the label atlas grew to 32 tiles of 384 px, one per job.
- **Scroll:** one cartridge per step. In the workshop a wheel notch, a swipe or an arrow / PageDown
  moves exactly one step; a drag or a flick snaps when it stops.
- **Camera:** it walks round the spiral to face each cartridge (`camera.ts`). See "Decisions" for why
  the spiral itself doesn't turn.
- **The front cartridge** stands out of its slot.
- **Hover:** it lifts a cartridge further, and the tip by the cursor scrambles the title in.
- **The arm:** it sits on a mast in the middle. It turns toward the pointed-at cartridge (or the
  front one) and rises to its height.

### Filters

- **The dock:** bottom left, "What are you looking for?" with these tags:
  - record a demo;
  - perfect it;
  - multiply;
  - train;
  - bring your robot;
  - results.
- **A tag:**
  - slides its cartridges along the helix to the top slots;
  - dims the rest;
  - goes back to the first step;
  - limits the steps to the matches.
- **Clearing:** a second press, or Escape.
- **The keyboard path to the 3D:** the robots' buttons and "+ Add a cartridge" (the bench) stay in
  the dock.

### Detail and plug-in

- **Opening:** a click (or Enter on the front cartridge) brings the cartridge right out. The camera
  closes in on a held shot (`store.setOverride`, tweened by the rig like a branch), with the
  cartridge right of centre.
- **The info block** sits bottom left:
  - the title, scrambled in;
  - `2026 / robot / tag`;
  - the sentence;
  - Plug in;
  - Close.
- **Closing:** "Scroll to close" at the top. A wheel, a swipe or Escape closes it.
- **PLUG IN** runs the existing plug sequence from the slot the job is in now. The machine dresses
  its flying copy from whatever is in that slot. Then it glides the scroll through the machine's
  dwell and the zoom into the projection, and the existing handoff opens the real Record page,
  releasing the canvas. Back returns to the machine.

### Ask SANT

- **One registry on the client** (`ask/registry.ts`) with four tools:
  - `go_to_section(top|story|workshop|machine|bench)`;
  - `show_cartridges_with_tag(tag)`;
  - `open_cartridge(id)`;
  - `start_tutorial()`.
- **`POST /api/ask`:** Nemotron (nano) only picks one of the tools the client sent, plus a one-line
  reply.
  - The backend checks the call against that list; the client checks it again and is the only thing
    that runs it.
  - The prompt tells the model not to state numbers.
- **The dock's pill** shows `› tool("arg")` in teal, then the reply, like the prototype.
- **If the backend is down** (or picks nothing usable), the prototype's keyword rules pick the tool,
  and the line says `· rules`.
- **`start_tutorial`** tours Blender's three tutorial stops with captions; scroll or Escape ends it.

### Accessibility and fallback

- **Reduced motion:**
  - instant moves (the spiral jumps step to step: `follow: true`);
  - no scramble;
  - no RGB split;
  - no glides;
  - no drift;
  - the logo already gathered.
- **Keyboard:**
  - arrows, PageDown/PageUp and Space step;
  - Enter opens;
  - Escape closes the detail, the tour, the bench, then the filter.
- **No WebGL, a failed canvas, or `?q=static`:** the stills page (the Blender renders per station)
  with every overlay. There the cartridges are a list of buttons and the page scrolls normally.

### Performance

The tiers extend T5's `quality.ts` with the brief's numbers:

| Tier | DPR cap | Logo | Dust | Post | MSAA |
|---|---|---|---|---|---|
| Low | 1 | 18k | 4k | none | none |
| High | 1.5 | 70k | 14k | bloom at half resolution + one final pass (RGB split on scroll speed, grain, vignette) | 4× on the post target |
| Ultra | 2 | 140k | 28k | same as High | same as High |

- **Post:** the scene target is flagged as an XR target, so three tone-maps per material into it as
  on screen. The baked room (`toneMapped: false`) keeps its look. The bloom's input is clipped at 1,
  as the screen would clip it, so the additive hologram glows instead of blowing out.
- **Auto-tune:** after the intro it averages 120 back-to-back frames. Above 22 ms it drops a tier;
  below 9 ms on high it goes to ultra. The choice is saved (`localStorage world.tier`), and `?q=`
  overrides it.
- **Draw calls in the workshop:** 47 on high with post, 34 on low (the budget is 60). To get there:
  - the machine's 22 fan blades and the hologram's parts are merged by material;
  - the hologram draws nothing until it projects;
  - the haze's own dust Points is gone, so the workshop has two Points objects.
- **Shadow maps:** none.
- **Compiling:** every shader on screen compiles under the loader. Each streamed batch compiles as it
  lands, before the camera gets there.
- **Rendering:** no frames while the tab is hidden. Rendering is on demand when nothing moves; the
  journey's particles keep it running on high and ultra.
- **First load:** Record is now lazy. `/world` needs **1.66 MB before the first frame**; the 4.1 MB of
  models stream after the loader.

## After the first review (same day)

- **One site:** `/` now opens the journey (`/world` still works).
  - The old room-tidying pages (rooms, room view, scan and photo, review, inventory, organize, chat,
    settings), the old landings (`/site`, `/enter`, `/landing/...`) and the dashboard shell are
    deleted. Their URLs redirect to the journey.
  - The Python backend is untouched.
- **The work pages:** Record, Review, Dataset and Results sit in a new frame (`web/src/work/`) in the
  journey's look:
  - the brand top left;
  - the four pipeline steps as the prototype's capsule nav;
  - "← Workshop" back into the spiral;
  - the hand control.

  The app's tokens are redefined inside `.work`, so every card, tag and button the pages share is
  mono, hairline and teal without changing their markup.
- **The stations' captions** (machine, zoom, bench) and the journey list are in the same mono UI.
- **Performance:**
  - Each tier has a pixel budget: low 1.3, high 2.6, ultra 3.7 megapixels.
  - A live resolution scale drops in steps (to 0.6) when 60 frames average over 19 ms, and recovers
    under 12.5 ms. The HUD shows it.
  - The ambient drift and the fans run at 30 fps after 3 s without input.
  - High asks for the high-performance GPU.
- **The preview artifact** loads the models through three's cache, because the host serves no
  `.glb` and blocks `data:` and `blob:` fetches.

## Second review: the dive and the fps drops

- **Into the workshop** (`stations/workshop/dive.ts`, `Portal.tsx`): no more fly-over of the ceiling
  slab. This follows how Active Theory moves between floors.
  1. From the descent's view down into the skylight, the camera dives at the ring and the view
     widens. The frame closes to dark from the edges, with particles streaming outward.
  2. At full dark it cuts inside the room (`StationModule.enter` / `cutAt`).
  3. The dark opens from the centre, and the lamps boot as it opens. Before that, the room below
     the skylight stays dark.
- **The fps drops:**
  - The auto-tune now judges the median of each window and needs two slow windows in a row. It
    starts only 3 s after the last file finished streaming. Before, it could read the workshop's
    upload hitches as a slow GPU and save "low" on an RTX 4060. Saved tiers now use
    `world.tier.v2`, so those stale saves are ignored.
  - The live resolution scale has hysteresis: 2 slow windows to go down, 3 fast ones to come up, and
    it skips the window after each change. Each change reallocates the render targets, so it must not
    flip back and forth.
  - Streamed models have their textures uploaded (`initTexture`) as well as their shaders compiled
    before the camera reaches them.

## Decisions to look at

- **The spiral doesn't turn; the camera walks round it.** The baked `shelves.glb` is one mesh with
  the wall shelves, so the helix can't rotate without leaving its shelf.
- **The arm is mostly hidden.** The Blender spiral is dense (cartridges 2.3 m wide at r ≈ 3 m), so the
  arm shows through gaps and over the top more than in the prototype. A sparser spiral would show it
  better; that is a Blender-pass call.
- **The jobs live in slots 2–25.** The top three slots reach through the ceiling, so the robots
  take them.
- **The zoom goes into the hologram, not a wall panel.** "The projector-to-wall zoom" uses the
  existing zoom station, into the hologram rectangle where Blender's "Zoom to UI" stop is. The wall
  panel in `W-anim-wall-projection-v1` isn't in `layout.json`; with its position, the zoom's `CLOSE`
  pose can move there.
- **Record is a route, not an iframe.** The "window" is the real Record route through the existing
  handoff, which also frees the GPU for Isaac Sim. Every cartridge opens Record, as the brief says.
  `items.ts` has a `route` per job, so mapping results → `/pm/results` etc. is a one-line change each.
- **The auto-tune can't reach ultra on 60 Hz.** It measures time between frames, which a 60 Hz display
  caps at 16.7 ms, so "below 9 ms → ultra" only fires on a faster display. The quality chip or
  `?q=ultra` sets it by hand.
- **The canvas no longer antialiases on any tier.** High and ultra multisample the post target;
  low has no MSAA, per the brief.

## What's left

- **Measure on the real PC: `PERF.md`.** The cloud has no GPU, so every fps it saw (1–5) is
  SwiftShader's.
- **The logo mark:** the user's symbol replaces `web/public/world/mark.svg`. It should be white on
  transparent, square, with the mark about half the width.
- **Ask SANT with the real model:** not run here. The session has no Nebius key, so the backend
  tests mock Nemotron. Check the replies stay honest (the prompt forbids numbers).
- **CORS:** the backend allows only `http://localhost:5173`. A deployed site needs its origin added
  in `src/app/main.py`.
- **The workbench** is still a placeholder.
- **Results sample:** with no backend, the Results page shows its sample layout ("experiments
  pending"), not the 3/40 → 17/40 the journey shows. It needs the real results file from the
  backend.
- **Unused code left in:** `three/ScanViewer.tsx` stays only because the hand pointer
  (`hand/integration`) still references it, and much of `styles.css` is now unused CSS from the
  dashboard.
- **Mobile:** not checked on a phone. The dock has the prototype's small-screen layout, and the tier
  check puts phones on low.
- **Python tests:** 3 fail on `pm/world-core` as well, untouched by this work. Two are Isaac
  launcher checks (`tests/test_launch_health.py`) and one is the frozen v2 measurement set
  (`tests/test_make_measurement_set_v2.py`). Everything else passes, including the 7 new
  `tests/test_ask.py`.

## Tests

- **Web:** 65 files, 607 tests, 0 failed (`npm --prefix web test`). `tsc -b` is clean.
- **New web tests:**
  - scramble;
  - particles;
  - loader progress;
  - spiral contents;
  - workshop camera;
  - stepper;
  - arm reach;
  - tool registry and fallback;
  - `askBackend`;
  - auto-tune;
  - the saved tier;
  - reduced-motion follow;
  - jsdom journeys for filters, detail, Ask SANT and the stills list.
- **Python:** 1475 passed, 37 skipped, and the 3 pre-existing failures above.

## Screenshots

Software-rendered (SwiftShader, so the fps in them is meaningless), 1280×800, in
`docs/superpowers/notes/2026-10-19-site-journey/`:

| File | What |
|---|---|
| `01-loader.jpg` | the slash cartridge at //75 |
| `02-logo.jpg` | the mark and plumes in the iridescent ring, "Scroll down" |
| `03-beat-physics.jpg` | the particles arcing up, a beat |
| `04-stats-over-the-skylight.jpg` | the stats over the roof lattice and the skylight ring |
| `05-spiral-arm-dock-hover.jpg` | the spiral at step 0, the dock |
| `06-filter-results.jpg` | `-> results`: the four results cartridges at the top, the rest dimmed |
| `07-detail.jpg` | a cartridge out of the spiral, the info block, "Scroll to close" |
| `08-ask-sant-rules.jpg` | Ask SANT with the backend down: `› show_cartridges_with_tag("train") · rules` |
| `09-hud-workshop.jpg` | the HUD in the workshop |
| `10-machine-projection.jpg` | the plugged-in machine projecting (ultra, with bloom) |
| `11-static-fallback.jpg` | `?q=static`: the workshop render with the dock and the cartridge list |

## PERF.md, in short

1. Run the production build (`npm --prefix web run build && npm --prefix web run preview`), with
   nothing else on the GPU and a 1080p window.
2. Open `/world?q=low|high|ultra&hud` (backtick toggles the HUD). At each journey stop in the table,
   note fps, draw calls and points; then stress-scroll the spiral, a filter and a plug-in.
3. Clear `world.tier`, open `/world?hud`, and note what the auto-tune picks; reload and check it is
   kept.
4. Recheck draw calls: 60 or fewer in the workshop.
5. Note memory: the HUD's heap, textures and programs, Chrome's Task Manager GPU memory, and a heap
   snapshot before and after three plug-in / Back round trips.
6. Check the first load on Fast 4G: under 3 MB before the loader's //100.
7. Fill in the tables below.

## Measured on the real PC

*(pending: fill in from PERF.md)*
