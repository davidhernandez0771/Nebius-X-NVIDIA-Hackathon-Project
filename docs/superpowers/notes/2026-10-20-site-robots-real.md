# The robot wall with real robots (`pm/site-robots-real`, 2026-10-20)

**The task:** the user wants realistic robots on the wall, not low-poly stand-ins. The lead built 7 GLBs in
Blender from the robot-assets manifest and downloads (`docs/design/blender/robots.blend`, exported at 20:03 with
fixed colours). This branch puts them on the wall, makes the parts shelves real, and updates the catalog copy.

**Branch:** from `pm/live-12` (81fbfa2, which includes af0ea91). No GPU: SwiftShader screenshots only. Nothing
pushed, merged or rebased.

Screenshots are in [2026-10-20-site-robots-real/](2026-10-20-site-robots-real/). They are 1280×720, except
`12-phone-robots.jpg` (390×844 at 2×).

## What changed

| Piece | File | Tests |
|---|---|---|
| The 7 GLBs, copied as exported | `web/public/world/models/robots/{franka,fr3,ur5e,xarm6,so101,piper,openarm}.glb` (3.2 MB) | `robotModels.test.ts` parses the real files |
| A model → one vertex-coloured geometry; its real pieces | `web/src/world/scene/robotModels.ts` (new) | `robotModels.test.ts` (4) |
| What stands where | `scene/wallPlan.ts` | `wallPlan.test.ts` (8) |
| The wall's meshes | `scene/wallParts.ts` | `wallParts.test.ts` (7) |
| Lazy load, tiers | `scene/RobotWall.tsx` | (screenshots) |
| Catalog and panel copy | `stations/robots/catalog.ts`, `Panel.tsx`, `robots.css` | `catalog.test.ts`, `Panel.test.tsx` |

### The robots

**The catalog's five, on the left wall's middle shelf as before:**
- The Franka, OpenArm, SO-101 and PiPER are now their GLBs.
- **The Flexiv stays a stand-in.** No Flexiv GLB was exported, and its meshes aren't among the downloads
  (SOURCES.md). The panel says so in its entry.

**The three arms SANT hasn't run (FR3, UR5e, xArm 6)** stand on the right wall's middle shelf, opposite. They:
- don't light up and have no badge, because they're not in the catalog;
- are listed in the panel under **Also on the wall**, with DoF and reach from their URDFs (`specs.json`) and their
  repo and licence, and no status.

**One scale for all (`ROBOT_SCALE` 2.55):**
- Their real sizes compare: the UR5e stands 2.07 m on the shelf and the SO-101 0.53 m.
- The scale is the largest at which every model fits the robot footprint (tested).
- Each arm reaches along the wall, turned 20° out toward the room.

**Colours:**
- Each primitive's colour goes into the vertex colours; there are no textures.
- Nothing is darker than graphite, because the PiPER is pure black, and black shows no shape under the picture
  lights. No channel goes over 0.78, because white under a picture light plus the bloom would burn out.

### The parts shelves: pieces of the same meshes

`modelPieces()` cuts a model into its real pieces:
- every link shell (a connected part of the mesh, at least 3% of the largest's bounding volume, 40+ triangles);
- plus the small parts whose centre sits inside its box (screws, rings, caps).

Vertices count as connected only if they share a place *and* a colour. Without the colour condition the UR5e's
joint rings fused with the bodies into half-arm pieces.

**How the pieces are shown:**
- Each piece stands upright along its main axis (PCA), enlarged (×1.8 the robots' scale, or as far as its
  footprint allows), on a dark foot and a thin rod.
- Pieces are dealt rank by rank across the robots, so neighbours come from different arms.
- A piece over 3,000 triangles stays off the shelf (the xArm's fused base is 8,789). The low tier's limit is 1,000.

The old procedural grippers, wrists, links, motors and bases, and the Franka's URDF collision-mesh specimens, are
gone. The wall no longer loads urdf-loader at all.

### Loading, tiers, budget

**Lazy loading:**
- The GLBs are fetched after the room's own models have counted in (`loadProgress() >= 1`), or after 15 s, so they
  never hold up the first view.
- Until they arrive, the shelves show their plinths and cards (and the Flexiv's stand-in).
- A model that fails to load leaves its plinth empty; the others still stand.

**Low tier:** fewer robots. It fetches only the four catalog GLBs (1.7 MB) and leaves the extras off (their shelf
fills with parts). It uses the lighter pieces, and the panel drops "Also on the wall".

**Draw calls: unchanged.** Everything still merges into one geometry, plus the light-pool mesh: 2 meshes, the
same as before.

| Measured in the page (SwiftShader) | High | Low |
|---|---|---|
| Hub draw calls | 55 (the hub's count recorded on 10-20) | 40 |
| Wall meshes | 2 | 2 |
| Wall triangles | 169,809 | 110,739 |
| Robot GLBs fetched | 7 | 4 (`franka`, `piper`, `so101`, `openarm`) |

**Triangles:** the old wall's count wasn't recorded, so there's no before number. The budgets are tested (180k
high, 120k low, the measured counts plus headroom). All of it is one draw call with a Lambert material on low.

### Catalog copy

**Each catalog entry has an "On the wall" line:**
- `Its maker's published meshes: <repo>@<commit>, <licence>.`, taken from `specs.json`.
- PiPER: `MIT (its package.xml says BSD)`, per SOURCES.md.
- The Flexiv: `A simple stand-in: its meshes aren't among the downloaded descriptions … so the shape only suggests
  the arm.`

**The panel's note now says:**
- the arms are their makers' published CAD meshes, from each description repo (licence in each entry);
- they were reduced to about 15,000 triangles and posed in Blender;
- they stand at one scale;
- the parts are pieces of the same meshes, enlarged;
- the Flexiv is a stand-in.

**Layout:** the list, the extras and the note now scroll together, with the title and lede fixed. Long repo paths
wrap: the first shots had them squeezing the list to nothing, and then widening the column.

## Screenshots (SwiftShader, headless Chrome, no GPU)

| File | What |
|---|---|
| `01-hub.jpg` | The room from the hub: both walls with the real pieces on the shelves |
| `02-robots-view.jpg` | The robots view: Franka, the Flexiv stand-in, OpenArm, SO-101 and PiPER at one scale |
| `03-robots-hover.jpg` | Hovering the Flexiv: it lights up teal, with its badge and its panel entry |
| `04-robots-pick.jpg` | The PiPER clicked: its entry takes the focus |
| `05-panel-also-and-note.jpg` | The panel scrolled down: Also on the wall, and the note |
| `06-right-wall-extras.jpg` | Close-up of the right wall: xArm 6, UR5e, FR3 |
| `07-franka-flexiv-close.jpg` | Close-up: the Franka model next to the Flexiv stand-in |
| `08-openarm-so101-piper-close.jpg` | Close-up: OpenArm, SO-101, PiPER (graphite, not black) |
| `09-parts-top-shelf.jpg` | Close-up of the top shelf's real pieces on their rods |
| `10-low-hub.jpg`, `11-low-robots.jpg` | `?q=low`: four robots, no extras, lighter pieces, no "Also on the wall" |
| `12-phone-robots.jpg` | 390×844, low: the robots' row above the bottom sheet, no sideways overflow |

**How the close-ups (06–09) were taken:** the frame loop was stopped (`setFrameloop("never")`) and one frame was
rendered from a set camera, so they have no bloom or grain pass. The others are the site as it renders.

**A stale file, left uncommitted:** `08-so101-piper-close.jpg` is an earlier take with the panel over it, renamed
since. Under the no-`rm` rule it is just left out of the commit; delete it by hand if you like.

## Checks

- **Web tests:** 1,562 passed, 1 skipped (177 files).
- **Typecheck and build:** pass.
- **No new dependencies.** GLTFLoader is three.js's, already used by `Crack.tsx`.

## Open

- **FR3:** its model is busy with small black parts (543 separate pieces in one primitive), so it looks speckled
  up close. That's in the GLB itself; a cleaner export would fix it.
- **The Flexiv's real meshes** would need its description repo downloaded (with the user's OK) and a Blender
  export like the others.
- **Not tried by a person,** and not on a real GPU: SwiftShader only. The high tier's frame rate with the new wall
  is unmeasured.
