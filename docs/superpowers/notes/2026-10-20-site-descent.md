# The intro as a descent (`pm/site-descent`, 2026-10-20)

From `pm/live-11` (`91b3ef8`, after T7's merge of the cloud's overnight site). The intro's slideshow is
now a story you fall through, like Active Theory's forest → reactor → lab. Not pushed or merged.

## What it is

Scrolling moves the camera **straight down** through places stacked above the room. Its height never
rises as the scroll goes on (tested), so every drop is scroll-scrubbed and plays backwards on the way
up. **One place is lit at a time**, with a stretch of full dark between them (tested), so one never
shows through another.

| vh | Stage | What you see |
|---|---|---|
| 0–1.2 | Hero | The glass SANT logo in the dark, "SHOW A ROBOT ONCE." (unchanged) |
| 1.2–2.7 | Drop 1 | The camera sinks below the logo; dark; the forest comes up out of the mist |
| 2.7–4.6 | Forest | A misty forest floor at night: instanced trunks, light shafts and pools, drifting dust, and the Franka's own URDF meshes half buried in the moss (pale, faint teal seams). "ROBOTS NEED DEMOS." |
| 4.6–6.1 | Drop 2 | The camera looks into a crack with a cold glow far down, and falls through the fissure in the rock |
| 6.1–10.6 | Reactor | A cavern round a vertical core. It **powers up** with the scroll: the rings spin up, the 14 cables light one after another with pulses running into the core, and the particles speed up round it (`// core power · NN%`). Beats: S·A·N·T, then the proof, then "NEMOTRON PROPOSES. PHYSICS VERIFIES." |
| 10.6–11.7 | The ring | At full power the core's top ring lifts off and widens into **THE RING** (the logo ring's chrome); the camera moves over it, looking down |
| descent 0–0.28 | Drop 3 | The camera dives down through THE RING; it bursts into the generator's particles as the reactor goes dark |
| descent, workshop | Build | The existing transition, unchanged: the particles fall and build the workshop, it materializes, the lamps flicker on, the hub is live |

**Numbers on the page** (all from the notes): 3/40 → 17/40 (p = 0.0005); 10 webcam demos: 0/10 passed
physics → 3 repaired → 24 verified variants; Nemotron labels 40/40. New: the forest's "human demos are
sloppy" line says 9 of the 10 webcam demos pressed the gripper into the bin, up to 927 N against a 5 N
limit (2026-10-19-live-test-10-results.md).

## Where

All in `web/src/world/stations/intro/` and `stations/descent/`:
- **Plans** (pure, tested):
  - `storyPlan.ts`: the stages, the beats, each place's light, the power and the ring's lift;
  - `path.ts`: the intro's camera;
  - `forestPlan.ts`: the crack's lens, trunks, parts and shafts, all clear of the camera's way;
  - `reactorPlan.ts`: the rings, the cables, the lighting order and the speeds;
  - `descent/path.ts`: the dive;
  - `descent/generatorPlan.ts` `burstPoints`: the particles start on THE RING.
- **Scenes:**
  - `Forest.tsx` and `Reactor.tsx` (procedural three.js; the robot parts are the Franka collision STLs
    already in `public/robots`);
  - `placeShaders.ts` (one noise, fog and light chunk; no textures, no lights);
  - `Places.tsx`, lazy-loaded after the loader, with its shaders compiled on mount.
- **Kept:** Generator, dissolve, Materialize, the lamps, the hub. `Generator.tsx` only changed where
  its particles start.
- **One edit outside the two folders:** `stations/stations.test.ts`. The hero is now Blender's Title
  framing raised by `HERO_LIFT` (144 m), so the places fit between it and the room; the test says that
  instead of "equals the Title stop".

## Checks

- `tsc -b` clean. `npm --prefix web test`: 151 files, 1339 passed, 1 skipped (as before), 0 failed.
  The build passes (only the existing >500 kB `three` chunk notice).
- Tests: new `path`, `forestPlan` and `reactorPlan` tests; `storyPlan` and the descent's `path` tests rewritten; 2 added for `burstPoints`. The intro and descent folders have 63 tests in all.
- **Headless Chrome on the real GPU** (d3d11, `vite preview` of the build), no console errors or
  exceptions on any run:
  - high tier at 1280×720: the shots below;
  - low tier at 1280×720;
  - a phone at 390×844 (it gets low);
  - reduced motion: the camera holds the hero and the beats still change;
  - `?static`.
- Blender was open but idle during the runs (no CPU, no GPU engine use).

| Shots (`2026-10-20-site-descent/`) | |
|---|---|
| Places | `01-place-hero`, `05-place-forest`, `09/10/11-place-reactor-*` (power 14 / 48 / 82 %), `12-the-ring` |
| Drop 1 (sink) | `02-drop1-start`, `03-drop1-middle` (dark, by design), `04-drop1-end` |
| Drop 2 (crack) | `06-drop2-start`, `07-drop2-middle` (dark, by design), `08-drop2-end` |
| Drop 3 (dive) | `13-drop3-start`, `14-drop3-middle`, `15-drop3-end` |
| After | `16-build`, `17-materialize`, `18-hub-live` |

## Not done / to look at

- **Not seen in a normal browser window or on the RTX 4060 laptop**; fps in the shots is headless
  and means nothing. The forest is 7 draws and the reactor 7, and only one place is drawn at a
  time.
- **The 2D fallback's descent still** (`STILLS.descent`) is still the old burst in front of a
  vertical ring. It needs a re-render from the new scene.
- **The robot parts read as machine parts only up close.** The collision meshes are coarse hulls; the
  visual meshes would read better, but they aren't in `public/` (adding them is a download).
- **The reactor is seen from above** (the camera must stay above THE RING to dive into it), so the
  cavern walls are mostly felt, not seen.
