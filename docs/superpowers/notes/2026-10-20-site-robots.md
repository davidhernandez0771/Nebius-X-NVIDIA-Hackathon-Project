# The robot wall, the robots catalog, and the accessibility pass (`pm/site-robots`, 2026-10-20)

Branched from `pm/live-11` (fast-forwarded to `91b3ef8` after T7's merge). Nothing pushed, merged or rebased.
Screenshots, all 1280×720 unless named phone: [2026-10-20-site-robots/](2026-10-20-site-robots/).

## 1. The robot wall

The side walls' shelves held 442 cartridge spines (`scene/Library.tsx`, now deleted). They now hold robots and
robot parts, lit like a museum wall.

- **What stands where** (`scene/wallPlan.ts`, pure, tested):
  - the five catalog robots on the left wall's middle shelf, in catalog order left to right;
  - parts on every other shelf: grippers (parallel, adaptive, single jaw), wrists, arm links, motors, bases, and
    the Franka's own links.
  - Shelf boards measured from `shelves.glb`: tops at y 1.46 / 4.66 / 7.86, 1.6 m deep, z −15 to 7.
- **How it's built** (`scene/wallParts.ts`):
  - the **Franka** is posed in Isaac Lab's start pose from its URDF's **collision meshes** (the 140 KB of STLs
    the twin already serves), and its links 1–7 and hand stand on rods as specimens;
  - the other four robots and all parts are **procedural stand-ins**: primitives in each arm's rough profile,
    not its real shape or size (the panel says so);
  - each item has a plinth and a museum card.
- **Cost:**
  - one merged mesh for both walls plus one additive mesh for the light pools: **2 draw calls**, as the library
    had;
  - hub on high: **54 draw calls** before and after;
  - 53,682 vertices / 28,478 triangles for the wall;
  - urdf-loader still loads only on use (`firstLoad.test.ts` passes).
- **Light** (`scene/RobotWall.tsx`):
  - a picture light under the board above each item: a cone computed in the shader from a per-vertex `aSpot`,
    following the lamps;
  - a warm glow on the wall behind each item;
  - the room's live lights.

## 2. Click the wall → the robots catalog

- **Opening it:** a click on either side wall in the room view, the new **"04 The wall"** tag, or the hub bar's
  **Robots** opens a new branch station, `robots` (`stations/robots/`). The camera turns to the left wall.
- **The panel** (`Panel.tsx`):
  - it lists each robot's maker, arm (DoF, reach), gripper, what it does in SANT today, the Isaac result, and its
    status: **Tested in Isaac** or **Planned**;
  - every robot has a Sources list.
- **Highlight** (`hot.ts`):
  - hovering a robot on the wall, or hovering or focusing its entry, lights the robot teal, its number badge and
    the entry;
  - clicking a robot on the wall scrolls its entry into view and focuses it.
- **Leaving:** Esc and "← Room" go back.
- **Layout:**
  - on a landscape screen the panel sits on the left, clear of the journey rail;
  - on a phone held upright it is a bottom sheet, with a portrait camera pose that lifts the robots' row above
    it.
- **Ask SANT:** `go_to_section` takes `robots` ("which robots does SANT support?"). The backend checks calls
  against the values the client sends, so Python is unchanged.

### The facts and where they come from (`stations/robots/catalog.ts`)

| Robot | Maker | Arm | Status | In Isaac | Sources |
|---|---|---|---|---|---|
| Franka Panda | Franka Emika | 7 DoF, reach ≈ 0.85 m | Tested in Isaac | multiply 30/30 (seeds 100–129, 2026-10-18); a policy on SANT's copies 17/40 vs 3/40 raw | franka_description package.xml + URDF; robots.py; T2 status; BYOR note; T3 status |
| Flexiv Rizon 4s | Flexiv | 7 DoF, reach 0.78 m | Tested in Isaac | multiply 9/30, scripted 5/30 (2026-10-16); grip slip/drag; not re-run since the handover fix | robots.py, scene_cfg.py; T2 status Task 3 |
| OpenArm | Enactic | 7 DoF, 0.44 m shoulder→wrist + 0.19 m | Tested in Isaac | 0/30 (2026-10-16), 0/30 through BYOR (2026-10-18): the ±45° wrist | robots.py, scene_cfg.py; T2 status Task 5; BYOR note; catalog note (maker) |
| SO-101 | TheRobotStudio | 5 DoF + jaw | Planned | none | catalog note; BYOR note (URDF not on disk) |
| PiPER | AgileX Robotics | 6 DoF | Planned | none | catalog note |

**Left out:**
- **No payload for any robot:** no source in the repo has one.
- **No reach for SO-101 or PiPER:** no source has one either.

## 3. The accessibility pass (everything but Record, and not the intro, descent, spiral drag or bench files)

| | Before | After |
|---|---|---|
| Text under 12 px (world: intro, hub, shelf, detail, robots, machine) | 8–23 per view | 0 |
| Text under 12 px (`/pm/review`, `/pm/results`, `/pm/dataset`, `/robots`, `/review2`) | 13 / 24 / 14 / 15 / 3 | 0 |
| Contrast under AA | `--w-dim` 4.36–4.45:1 everywhere; work nav numbers 1.69:1; `/robots` 1.96–3.03:1; `/review2` 2.80:1; skip links 1.19 and 3.58:1 | 0, except disabled buttons (WCAG exempts them: `/pm/dataset` Export, `/site/results` Replay) |
| Controls with no accessible name | 0 | 0 |
| Hub Tab order | not measured before the move; the tags sat beside the canvas, outside the workshop's section, and a hidden tag (opacity 0 only) stayed tabbable | skip link → shelf → machine → bench → wall → hub bar → Ask → rail; hidden tags leave the Tab order |
| Focus rings | hub tags 2–4 had none (border only) | every Tab stop shows a ring (Tab walk checked) |
| Skip the intro | none in the world | first Tab stop; cuts to the room view and focuses it |

**What changed:**
- **Global tokens:**
  - `--w-dim` is now `#6f8c85` (5.4:1) in `ui/ui.css` and `work/work.css`;
  - the work pages' `--fs-xs` is now 12 px;
  - the `/robots` page's `--rb-ink-3/4` are AA.
- **Sizes:** every sub-12 px size in the world UI, work, `/robots`, review2, the setup report and the shared
  `sant.css` is now 12 px.
- **Text over the 3D:** the dock, the detail block, the journey rail (desktop) and the quality chip now have dark
  glass backings, so their text stays AA over a lit wall. The brand and the one-line hints get a dark halo.
- **Skip link and focus:**
  - `.sant .sant-skip` keeps its on-accent colour (it lost to `.sant a { color: inherit }`);
  - the new world skip link is `.world-skip`;
  - the hub tags now have a focus ring.
- **Reduced motion:**
  - the site's own "effects off" (`data-motion="reduced"`) now reaches the work pages and `/robots`, which aren't
    under `.sant` (`styles.css`); the OS setting was already global;
  - the new code eases nothing under reduced motion (the highlight and panel are instant; checked: transitions
    0 s).
- **Quality chip:** it had lost its padding and border to `.sant button`; that is fixed.

**How it was measured:** an in-page audit in headless Chrome (real GPU, CDP, no installs).
- It reads every visible text node's computed size and its colour over the blended background.
- Over the canvas it assumes the world's ground, `#07090C`, which is why text over the 3D now has backings.
- It also flags focusables with no name, and a Tab walk records each focused element and whether it shows a ring.

## Checks

| Check | Result |
|---|---|
| `npx tsc -b` | clean |
| `npm --prefix web test` | 154 files, 1340 passed, 1 skipped, 0 failed (1304 at the base) |
| `npm --prefix web run build` | OK (only the existing >500 kB chunk notice) |
| Production build (`vite preview`) | hub → wall → click OpenArm (its entry gets focus) → Esc → machine → Esc: no console errors or exceptions |
| `fileNames.test.ts` | passes (`wallPlan.ts` / `RobotWall.tsx`, no case twins) |

**New tests:**
- `catalog.test.ts`: statuses, no invented fields, sources for numbers;
- `wallPlan.test.ts`: on the boards, no overlaps, in the shelf depth, repeatable;
- `wallParts.test.ts`: footprints, the Franka from the real URDF + STLs, one merged geometry, highlight numbers;
- `hot.test.ts`;
- `view.test.ts`: the robots framed between the panel and the rail at 16:9, and above the phone sheet at 390×844;
- `Panel.test.tsx`;
- WorldRoot: the robots branch round trip and the skip link;
- HubBar: Robots and the order of the four things;
- Ask SANT's rules.

## Screenshots

| File | What |
|---|---|
| `01-skip-intro-link.jpg` | the first Tab stop on the intro |
| `02-hub-wall-tag-focused.jpg` | the room view after the skip, Tab ×4: "04 The wall" focused, with its ring |
| `03-robots-view.jpg` | the robots view: the panel, the wall, the number badges |
| `04-robots-hover-flexiv.jpg` | hovering the Flexiv stand-in: teal on the wall, the badge, the entry |
| `05-robots-pick-piper.jpg` | after clicking PiPER on the wall: its entry scrolled in and focused |
| `06-robots-keyboard-focus.jpg` | Shift-Tab back to SO-101's entry: the robot lights from the keyboard |
| `07-shelf-dock-12px.jpg` | the shelf with the dock on its new backing, 12 px |
| `08-detail-12px.jpg` | a cartridge's detail on its backing |
| `10-phone-hub.jpg` | phone 390×844, low: the hub bar with Robots |
| `11-phone-robots.jpg` | phone: the robots above the bottom sheet |
| `12-reduced-motion-robots.jpg` | reduced motion: an instant highlight, transitions 0 s |
| `13-stills-fallback-robots.jpg` | `?static`: the catalog over the room's still |
| `14-low-tier-robots.jpg` | low tier: 18 draw calls in the robots view (32 on high) |

There is no 09: the numbers were kept stable across re-shoots so each run overwrote the same files. No stale
files are in the folder.

## Not done, or for others

- **Not tried by a person**, only headless Chrome on the real GPU, with one idle Blender open (no Isaac).
  - No touch device; the 390×844 phone view was emulated.
  - Frame rates weren't measured; headless numbers mean nothing.
- **Files owned by other terminals** (left alone):
  - `stations/workbench/bench.css`: three 10 px sizes (lines 185, 214, 279), and line 97 sets text in
    `--w-mute` (1.7:1). The bench now reads the new `--w-dim`, so its other dim text passes.
  - `stations/intro/intro.css`: 11 px at lines 43, 173 and 11.5 px at 215. The audit found no small text in the
    intro views it reached, so they may be overridden or unused there; unchecked.
- **The 2D stills are old renders.** The room's still (also used for the robots view) still shows the cartridge
  library, and a new render needs Blender (on hold).
- **The transition's particles** (`stations/descent/Generator.tsx`, not mine) still sample the library's book
  boxes, so they materialize into the robot wall from slightly different shapes.
- **Naming mismatch:**
  - the spiral's robot cartridges (`scene/robots.ts`, used by the bench) say "Franka FR3" and "Rizon 4";
  - the sim, the twin and this catalog use the **Franka Panda** and the **Rizon 4s**.
  - I didn't change `robots.ts` (the bench owns it).
- **Phone framing:** the narrow portrait view shows about four robots; the ends need the panel's list.
- **`cartridge_lod.glb`** is no longer loaded by anything. It is still in `web/public/world/models/`.
- **The catalog maker for OpenArm** (Enactic) comes from the robot catalog note's upstream repo
  (github.com/enactic/openarm_description), not from a file in this repo.
