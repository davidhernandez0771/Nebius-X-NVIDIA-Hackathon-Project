# World core: one continuous journey (`/world`)

> **Site journey (2026-10-19):** the opening is now the `intro` station (loader, logo particles, story
> beats); the workshop steps down the spiral one cartridge at a time, with filters, a detail view and
> Ask SANT; post, the auto-tune and the HUD are in the core. What changed and why:
> `docs/superpowers/notes/2026-10-19-site-journey.md`. Measuring it: `PERF.md`.

Sprint 9. This is the shared core of the game-like site: title and story → scroll down a spiral into
the workshop → a cartridge plugs into the GPU-shaped machine, which projects a hologram → the camera
zooms into the projection, which becomes the 2D work UI (Record and the others) → adding a cartridge
opens the workbench.

The core owns the canvas, the camera rail, the station API, the handoff to 2D, quality and reduced
motion. **T6 (workshop), T7 (machine) and T1 (workbench)** each own one folder and plug in through the
API below. The workshop, the machine and the camera stops now come from the Blender export
(`docs/design/blender/export`); how that part is built and measured is in
`docs/superpowers/notes/2026-10-18-world-workshop.md`.

- **Open it:** `npm --prefix web run dev`, then `http://localhost:5173/world`.
- **URL flags:** `?quality=low|high|ultra` forces a tier, and `?static` (or `?quality=stills`) forces the stills fallback.
- **While someone holds `C:\dev\gpu.lock`:** check pages only with `?quality=low` and screenshots.

## Files

```
web/src/world/
  core/                     shared, owned by the core (ask before changing)
    types.ts                the station API: StationModule, StationFrame, CameraPose, Cartridge
    rail.ts                 scroll → camera: layout, locate, poseAt, fillFrames (pure, tested)
    store.ts                coarse state (React) + per-frame state (mutated in place)
    WorldContext.tsx        useWorld, useWorldState, useStationFrame, useWorldAnimating
    WorldRoot.tsx           the /world route: canvas, scroll track, overlays, journey rail
    WorldCanvas.tsx         the one <Canvas>, frameloop="demand"; each Scene in its own boundary
    CameraRig.tsx           damped rail camera, branch tweens, reduced-motion cuts
    handoff.ts              zoom → 2D route rule (pure, tested)
    quality.ts              tiers (pure, tested), the saved tier
    autotune.ts             drop or raise a tier from measured frames (pure, tested)
    PostFX.tsx              bloom at half res + the final pass (RGB split, grain, vignette), MSAA target
    Perf.tsx, Hud.tsx, hud.ts  the HUD (backtick), the auto-tune, pause when hidden, compile what streams in
    scroll.ts               scrollToY, glideTo (the plug-in's run into the projection)
    gpu.ts                  the quick GPU check that picks a tier or the stills (classify: pure, tested)
    layout.ts               facts two stations share: MACHINE_ANCHOR, MACHINE_VIEW, PROJECTION
    registry.ts             checkStations(): the rules below, as code
    Placeholder.tsx         <Box> with edges, and the placeholder palette
  scene/                    the Blender workshop, shared by the stations (layout.json, the baked room,
                            the lamps, the cartridges, the plug-in); see the workshop note
  stations/
    index.ts                the registry: the one file that lists every module
    intro/      core        the loader, the logo particles → roof lattice, the ring → skylight, the beats, the dust
    descent/    core        the spiral down, with the stats beat
    workshop/   T6 (+ site) room, the spiral stepped one cartridge at a time, filters, detail, Ask SANT, tour
    machine/    T7          GPU box, cartridge plugs in, projection lights
    zoom/       core        dolly into the projection, then the handoff
    workbench/  T1          branch: the cartridge editor
```

**Work only in your own folder.** You shouldn't need to touch `core/` or `stations/index.ts`. If you
do, say so in your status note.

## The station API

A station module is a folder whose `index.tsx` default-exports one `StationModule`:

```ts
const workshop: StationModule = {
  id: "workshop",           // one of: intro descent workshop machine zoom workbench
  title: "Workshop",        // journey rail label and the overlay's accessible name
  owner: "T6",
  kind: "rail",             // "rail": reached by scrolling; "branch": reached with goTo()
  anchor: [0, 0, 0],        // world position of the station's group
  travel: 0.6,              // viewport heights of scroll to fly in from the previous station
  length: 1.5,              // viewport heights of scroll spent here (the dwell)
  camera: (t) => pose,      // camera through the dwell, t 0–1, LOCAL to anchor
  rest: pose,               // optional: the one pose with reduced motion (default camera(0.5))
  Scene,                    // optional: r3f content, mounted once inside <group position={anchor}>
  Overlay,                  // optional: DOM over the canvas
  reach: 1,                 // optional: how many stations along the rail the Scene stays drawn
  still: url,               // optional: the pre-rendered still shown when there is no usable GPU
};
```

A `CameraPose` is `{ position: [x,y,z], target: [x,y,z], fov }`, with the fov vertical and in degrees.
`still(pose)` from `core/layout.ts` holds a single shot; `through(a, b, c…)` from `core/rail.ts` passes
through several stops in equal shares of the dwell, settling at each. The stops themselves are
Blender's: `stop(name)` and `stopFrom(anchor, name)` in `scene/layout.ts` read `layout.json`.

### The rail

The rail runs intro → descent → workshop → machine → zoom, top to bottom. Each station has two parts:

- **Travel:** the camera moves from the previous station's `camera(1)` to this one's `camera(0)`, with
  smootherstep easing.
- **Dwell:** the station's own `camera(t)`.

Travel is a straight line, so keep the two ends in clear air. A station with `travel: 0` must start
exactly where the previous one ended. The zoom does this: it starts on `MACHINE_VIEW`.

The workbench is a **branch**. It isn't on the scroll. `goTo("workbench")` flies there in 1.1 s and
locks the page scroll; Back (`back()`) or Escape returns to the rail where the scroll is.

### Rules (enforced by `checkStations`, run in `stations.test.ts` and as a dev console warning)

- Every id is registered once. Rail stations have `kind: "rail"`, `length > 0` and `travel >= 0`.
- `camera()` returns finite numbers at t = 0, 0.5 and 1.
- With `travel: 0`, `camera(0)` equals the previous station's `camera(1)`.
- `stations.test.ts` also walks the whole rail in 2 px steps and fails on any camera jump.

### Per-frame state: `StationFrame`, never React state

The core mutates one `StationFrame` per station in place, every rendered frame:

| Field | Meaning |
|---|---|
| `t` | 0–1 through the dwell (0 before it, 1 after it) |
| `arrive` | 0–1 through the travel in (1 once arrived) |
| `current` | the station the journey is at (a travel counts as the previous station until halfway) |
| `near` | current or a rail neighbour; groups that aren't near are hidden (`visible = false`) |

- **In a Scene:** it arrives as the `frame` prop. Read it inside `useFrame` and write to refs, e.g.
  `cart.current.position.y = 2.9 - smoother(frame.t / 0.45) * 1.25` (`machine/index.tsx`).
  - The camera rig runs at `useFrame` priority −1, so your callback always sees this frame's values.
  - Don't use a positive priority: it turns off r3f's automatic render.
- **In an Overlay:** use `useStationFrame(id, (f) => el.style.opacity = …)`, which writes to the DOM
  directly (`zoom/index.tsx`).
- **Never** `setState` per frame.

### Coarse state and actions: `useWorld()`, `useWorldState(select)`

These work in Scenes and Overlays alike, since r3f bridges context into the canvas.

| | |
|---|---|
| `useWorldState((c) => c.cartridge)` | the chosen `Cartridge` (or null); also `c.current`, `c.branch`. Re-renders only when the slice changes |
| `goTo(id)` | scrolls to a rail station's dwell, or opens a branch |
| `back()` | closes the open branch |
| `selectCartridge(c)` | what the machine projects and the zoom opens |
| `handoff()` | leaves for the chosen cartridge's 2D route now |
| `quality`, `reduced` | the tier and the reduced-motion flag |
| `mode`, `fail()` | `"3d"` or `"stills"`; `fail()` switches to the stills (a dead canvas, a stalled loader) |
| `store.setOverride(pose)` | a held camera shot over the rail (the detail view, the tour); the page scroll is held while it is set |
| `useWorldState((c) => c.ready)` | the loader is done; until then only the first rail station's Scene is mounted |

`Cartridge = { id, label, route, slot? }`: one robot on the spiral (`scene/robots.ts`), `slot` its place in
`layout.json`. Every robot opens Record for now. With no choice made, the zoom opens
`DEFAULT_CARTRIDGE`, the SO-101 in the lowest slot, which the machine plugs in by itself as the scroll
passes.

### Shared world facts (`core/layout.ts`)

World coordinates are Blender's (Y-up metres, the floor at y = -0.6).

- **`MACHINE_ANCHOR`:** machine.glb's pivot (`layout.json` `stations.machine`). The zoom uses it too.
- **`MACHINE_VIEW`:** Blender's "Projection" stop: the machine's dwell ends here and the zoom starts here.
- **`PROJECTION`:** `{ center, width: 4.8, height: 2.256, normal }`, local to the machine: machine.glb's
  `mx_M_HoloScreen`, turned with the machine (28°), so it faces `normal`, not +z. `inFront(d)` is a point
  on that normal.
  - The hologram is drawn in this rectangle, because the zoom flies into it (to Blender's "Zoom to UI").
  - Changing it moves the zoom with it, and the tests check that the zoom still ends close enough to
    fill the view.

### Overlays

- **Layout:** each Overlay renders inside a fixed, full-viewport `<section>`. It is visible and
  focusable only while its station is current (240 ms opacity fade; 160 ms with reduced motion).
  The layer is `pointer-events: none`, so wrap controls in `.world-panel`: its controls (buttons, links,
  inputs) take the pointer again, and the empty space around the copy lets clicks through to the 3D.
- **Keyboard path:** anything clickable in 3D needs a DOM control in the overlay too. The workshop's
  cartridges are buttons as well as boxes.
- **Headings:** the intro has the page's `<h1>` (visually hidden), and stations use `<h2>`.
- **Buttons:** use the SANT `Button` (`web/src/sant/components/Button`).

### Models

Load each model inside your own Scene with `useGLTF` from drei. Every Scene is wrapped in its own
`Suspense` and error boundary, so a slow or broken model blanks only that station, and the error
names it in the console.

## Rendering and quality

- **Render on demand:** the canvas uses `frameloop="demand"`. A frame is drawn only when:
  - a scroll event arrives;
  - the damped camera is still settling (it asks for frames until it is within 0.5 px of the scroll);
  - a branch tween or a reduced-motion cut is running;
  - a module asks for one.

  An idle world draws nothing.
- **Idle loops:** loops such as a hologram flicker go through `useWorldAnimating(on)`, inside the
  canvas. It runs on the **high** and **ultra** tiers; on low the world never animates by itself.
  Otherwise, call `invalidate()` from `useThree` once when your Scene changes something outside the
  scroll.
- **Tiers** (`quality.ts`, picked by the GPU check in `gpu.ts`, then the auto-tune; `?q=` or
  `?quality=low|high|ultra|stills|static` wins, and a tier saved by the auto-tune or the quality chip
  comes next):

  | Tier | Pixel ratio | Logo / dust points | Post | MSAA | Idle loops | Extras | Chosen when |
  |---|---|---|---|---|---|---|---|
  | low | 0.75–1 | 18k / 4k | none | none | no | none | an old integrated or phone GPU, a slow timing, phone width, data saver |
  | high | 1–1.5 | 70k / 14k | bloom ½ + final pass | 4× on the post target | yes | reflections | the default for a working GPU |
  | ultra | 1–2 | 140k / 28k | same as high | same | yes | clearcoat, haze | a discrete GPU by name and a fast timing, 8+ cores |
  | stills | no canvas | | | | | one still per station | no WebGL2, a software renderer, the performance caveat, a failed canvas |

  The canvas itself never multisamples (antialias off): high and ultra multisample the post target.

  The check runs once per session (`sessionStorage` `world.gpu`): a WebGL2 context, the renderer's
  name, and one timed fragment workload; the timing can only lower what the name suggests. Shadows are
  off on every tier: the room's light is baked.
- **Cost of a station:** keep it to plain meshes. Use instancing for repeats, merge parts that move
  together, and avoid real-time reflections; the core's post is the only post. Budget: 60 draw calls
  in the workshop, post included (the HUD shows them). The heavy model budget is the Blender pass's call, not
  this core's.

## Reduced motion (OS setting, or Effects off)

- **Camera:** it never travels. It cuts between each station's `rest` pose behind a 320 ms fade of
  the ground colour (the veil), and the cut lands while the veil is opaque. A station with
  `follow: true` (the workshop's spiral) shows its own camera in its dwell instead, so it jumps from
  step to step.
- **Branches:** they cut the same way.
- **Overlays:** they still cross-fade, in 160 ms.
- **Zoom:** the camera holds its rest pose, and the handoff screen fades up as the scroll reaches the
  end.
- **Scenes:** changes driven by `frame.t` follow the user's own scroll, so they stay. Anything
  driven by time (a tween, a loop) should read `reduced` and show its end state instead.

**No usable GPU, or `?static`:** there is no canvas. Each station's pre-rendered still (`still` on the
module) fades in behind the overlays; the journey rail, cartridge choice, the workbench and the
handoff all still work.

## The handoff to 2D (`core/handoff.ts`)

1. **The screen comes up.** From zoom t = 0.78, a DOM screen in the app's ground fades up over the
   projection. It is opaque at t = 0.995.
2. **The route changes.** At t ≥ 0.995 the route changes to the cartridge's route, under a view
   transition when available.
   - The check uses the camera's damped position, not the raw scroll, so the screen is always
     opaque when the route changes.
   - The zoom's "Open Record" button does the same thing at any time.
3. **The canvas is released.** The world unmounts and r3f disposes the WebGL context. App pages such
   as Record share the GPU with Isaac Sim and MediaPipe, so the 3D context must not stay alive behind
   them.
4. **Back returns to the machine.** It lands just before the zoom, with the projection lit. A
   session key (`world.return`) remembers where to land.
   - The browser's own scroll restoration is turned off for that one return; otherwise it would put
     you back at the end of the rail.
5. **It fires only on the way down.** Arriving at the end of the rail (a reload there, or Back
   without the key) doesn't send you out again until you scroll back above zoom t = 0.9.

**Persistence across stations:** the canvas stays mounted for the whole journey, workbench branch
included. It isn't kept alive under 2D routes (see step 3).

## What's not done

- **The crossing:** `/world` isn't in the crossing's paper/volt map (`sant/motion/crossing.ts`, T5's
  file). Links from `/site` into the world don't play the power-on yet. The hand-control button is
  hidden on `/world` (`App.tsx`).
- **Adaptive quality:** done (`autotune.ts`), but on a 60 Hz display it can't tell high from ultra
  (see `PERF.md`).
