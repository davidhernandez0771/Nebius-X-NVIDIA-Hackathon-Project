# The proof wall in the workshop (`pm/site-nav-fix`, 2026-10-26)

The user asked for the proof, which already plays as four beats in the story's scroll, to also be a place in the
workshop you can visit, like the machine, the bench, the shelf and the robot wall. This is on `pm/site-nav-fix` in
`C:\dev\pm-site-nav`, on top of `e9a5ed1`. Nothing was pushed and no dependencies were added.

Commits:

| Commit | What |
|---|---|
| `52d8ae7` | The four figures move into one shared module, `world/ui/proofFigures.tsx`. The story's `ProofBeats.tsx` now uses it (no visible change). |
| `6b8cc44` | A rail fix found on the way: Skip the intro and the rail's WORKSHOP showed no hub tags at 720, 900 and 1080 px tall (below). |
| `68c2035` | The proof wall. |
| `65780da` | The lead's three workshop bugs: places reachable in 2D, hub cards kept on screen on a phone, the hidden hub bar out of the Tab order. |

## Where the wall is

**On the back wall, left of the spiral, behind the bench.** Blender left two dark 12 × 6 m boards on the back wall
(in `shelves.glb`: x −17 to −5 and 5 to 17, y 3.9 to 9.9, with raised glyphs). The right one sits behind the shelf's
and the machine's tags. The proof wall hangs on the **left board**:

- **The screen:** 11.2 × 5.6 m at (−11, 6.9, −20.42), just in front of the glyphs, so the board shows as a bezel
  round it.
- **Clear of everything:** it is more than 10 m from the spiral's column (the lift rises straight up), the arm's mast,
  the bench, the machine and its bay, and the side walls' shelves (they stop at z −15). It is also behind the line a
  carried cartridge may reach (`collide.ts ROOM`). All of this is tested.
- **From the room view the spiral hides the screen's right third,** so the headline and the climb sit in the left
  60%. A test checks that they end before the spiral's cartridges begin and clear every hub tag.

## What it is

**In the room** (`scene/proofWallPlan.ts`, `scene/ProofWall.tsx`), the screen is drawn once onto a 1024 × 512
canvas:

- a dark glass screen with scan lines and a teal holo frame (hairline and corner brackets);
- the kicker "05 / The proof · pre-registered, run once";
- **0/40 → 30/40** (the 30/40 in teal), with the Results page's lead line under it;
- the climb's four bars with Wilson whiskers, the counts, and the dashed goal at 60% · 24/40;
- the footnote;
- a right-hand column listing what is inside (behind the spiral from the room view, so you read it on the way in).

A 128 × 64 glow spills soft light onto the board and the wall round the screen.

Every number comes from `proofData` (`CLIMB`, `GOAL`, `LEAD`, `CLIMB_FOOTNOTE_SHORT`). The screen is dark until
the room's lamps come on (`power.ts addGlow`).

**Opening it.** Any of these opens the place, the same way as the other places:

- a click on the wall;
- its hub tag **"05 The proof"** ("0/40 → 30/40, pre-registered. How we know.");
- the hub bar's **Proof**;
- the journey rail's **PROOF**;
- **`#proof`** in the URL.

The camera turns to face the board square on (`stations/proof/view.ts`).

**The way out** is the shared `StationBar`: "← Back to room" top left with the Esc hint. Escape, the browser's Back
and Forward, and a reload all work as they do for the other places. A reload with `#proof` opens it in the room.

**Inside it** (`stations/proof/Place.tsx`), the board goes blank: just glass and frame. The story's four figures are
laid exactly over its screen, so they read as the board's own content:

1. How SANT works: the 5 steps.
2. The climb: 0 → 3 → 15 → 30 of 40, with the goal line and the Wilson whiskers.
3. Did the human demos matter? 113/128 vs 0/128.
4. SANT checks the teacher too: 3/50 → 50/50.

How the panels work:

- **Size:** the panel's box comes from the camera itself (`SCREEN_IN_VH`). A test checks it against the projected
  screen at 1280×720, 1440×900 and 1920×1080.
- **Stepping:** Prev and Next, ← and →, and four dots. There is a "2 / 4" counter and a live region for screen
  readers.
- **Drawing:** each graph draws in when its panel opens: 1.8 s on `requestAnimationFrame`, using the same draw
  0 → 1 the scroll gives it in the story. On entering, the panel waits 0.8 s while the camera turns. With reduced
  motion it is whole at once.
- **Each visit starts at panel 1.**
- **The two links come last:** "Watch the real test runs →" (`/test-track`) and "Every number, with its sources →"
  (`/site/results#proof`).
- **Where it is a solid panel instead:** held upright, under 700 px wide, or in the 2D fallback. On a phone it sits
  under the way out and Contact, scrolls inside, and keeps the steps and links at its foot.

**One source of truth.** The figures (pipeline, climb, teacher, gate), their words, the data tables, the sources
lines and the two links are now in `world/ui/proofFigures.tsx`. Both the story and the wall render them. The
palette in `proofBeats.css` is shared by `.intro-pbeat` and `.world-proof`. The story's beats are unchanged.

**The hub holograms** took exactly four tags (`vec4` uniforms). They now take any number (float arrays).

**The proof tag's hologram stands forward of the spiral** (`holoTags.ts PROOF_LABEL_Z`), on the line of sight to a
spot just over the screen. Seen in Chrome: placed by the wall, a label that far back is metres wide and turned to
the camera. Its right end sank into the back wall, and the spiral cut it to "05 T". Two tests now keep every label
in front of the back wall and the proof label in front of the spiral.

**The low-tier cards:** the wall's card moved left, from (−15, 9.5, −12) to (−19.5, 9.5, −13), so the proof card fits
over the board beside it.

## The rail fix (`6b8cc44`)

On this branch's tip, Skip the intro and the rail's WORKSHOP left the room view with **no hub tags and no hub bar**
at 720, 900 and 1080 px tall. 800 and 844 were fine. Seen in the first SwiftShader walk.

- **Why:** the intro's 18.9 viewports put the workshop's dwell a hair over a whole pixel (16344.000000000002 px at
  720). The browser scrolls to 16344, so `locate()` read "travel, t 0.99999…", and `inHub` wants `arrive` at 1.
- **Fix:** `locate()` now snaps the last half pixel of a travel to the dwell, as it already did for a station's start.
- **Merge:** the lead says `pm/site-bugs` made the same fix in `rail.ts`. Expect a one-line conflict and keep one.

## The lead's three bugs (`65780da`)

1. **The 2D fallback (stills):**
   - **Before:** the bar said "Click a tag to go in", but the tags are only drawn into the picture, and the place
     buttons were hidden above phone width.
   - **After:** the bar says "Pick a place to go in" and shows Shelf, Machine, Bench, Robots and Proof at every width
     (`data-flat`). Below 1600 px the long hint is hidden so the bar clears the brand. Shots `desk-14`, `desk-15`.
2. **Phone room:** the cards (not the desktop holograms) now slide onto the screen, and down past each other where
   two would land on top of one another (`clampTag.ts placeCards`, applied as each card's own CSS `translate`).
   - The bench, wall and proof cards now stack down the left (`phone-01`).
   - The bar's gaps shrink so the five places and "↑ Story" fit 390 px.
3. **The hub bar's "↑ Story":** the hidden bar is now `inert` and `aria-hidden`, so its buttons leave the Tab order
   and the accessibility tree.

## Performance

| | Room view, high (1280×720) | Room view, low (390×844) |
|---|---|---|
| Draw calls with / without the wall | 47 / 45 | 45 / 43 |
| Triangles with / without | 309,150 / 309,146 | 246,675 / 246,671 |

- **How measured:** SwiftShader, `gl.info` with the wall's group hidden and shown.
- **Textures:** one 1024 × 512 canvas (about 2.8 MB with mipmaps) and one 128 × 64.
- **Per frame:** no work. A store subscription repaints the face only when the place opens or closes, and the real
  font's arrival repaints it once.
- **The panel:** no backdrop blur. The graph plays write a few styles per frame for 1.8 s.
- **Budget tests:** there was no room-wide draw-call budget test (only the robot wall's own,
  `wallParts.test.ts`, which is untouched). `proofWallPlan.test.ts` adds the wall's: two meshes, two triangles each,
  a 1024 × 512 face, a spill canvas of at most 128 × 64, plain `MeshBasicMaterial`s.

## Tests

**Written first:** each new test failed before its code, except the blank-face test and the screen-fit test, which
came with the second design pass after the first walk.

- **`stations/proof/Place.test.tsx`** (the whole world, no WebGL):
  - opens from the hub bar, from the rail straight from the story (it lands in the room), and from `#proof` on a
    reload;
  - Back to room, Escape, the browser's Back and Forward;
  - Prev/Next, the arrows and the dots, each visit from panel 1, arrows only while open;
  - each graph from nothing to whole, after the way in, and again on returning to a panel;
  - reduced motion: whole at once, no frames scheduled;
  - the numbers from `proofData`;
  - the two links, once each;
  - the story's beats as they were.
- **`scene/proofWallPlan.test.ts`:**
  - where it hangs, and clear of the spiral, its lift, the arm, the bench, the machine and the shelves;
  - the face's words and numbers from `proofData`, through a recording 2D context;
  - the landmark check from the room view: in view, under the bar, left of the spiral, clear of the tags, the
    headline over 12 px tall;
  - two meshes and the texture sizes;
  - blank while open;
  - the corners;
  - the camera: square on, about 80% of a 16:9 view, upright fits the width;
  - the panel's box against the projected screen at three sizes.
- **`scene/materializeAll.test.ts`:** `<ProofWall` is inside `<Materialize>`, and its screen and spill take the
  dissolve patch.
- **`holoTags.test.ts`:** five labels; the proof label's emitter on the screen's top edge; every label in front of
  the back wall; the proof label in front of the spiral. The atlas `uv` check is now to 6 places: fifths aren't exact
  in float32.
- **`HubBar.test.tsx`:** five places with Proof; the 2D bar; the inert hidden bar.
- **`clampTag.test.ts`**, **`placeHash.test.ts`** (`#proof`), **`waiting.test.ts`** (stands with the workshop),
  **`rail.test.ts`** (the travel's end).

## Checks (tip `65780da`)

| Check | Result |
|---|---|
| `npx vitest run --maxWorkers=2 --minWorkers=1` | 233 files, **2069 passed, 1 skipped**, 0 failed |
| `npx tsc -b` | clean |
| `npm run build` | passes (the usual three.js chunk-size warning) |
| Chrome walks: headless, SwiftShader, `vite` dev on 127.0.0.1:5263 (stopped after; 5241 was taken by something else, left alone) | No console errors. Only React Router's two future-flag warnings. No horizontal page scroll at 1280 or 390 |

## Screenshots (`2026-10-26-proof-wall/`)

**Desktop:** 1280×720, `?q=high`.

| Shot | What it shows |
|---|---|
| `desk-01-room` | The room view: the wall with 0/40 → 30/40 left of the spiral |
| `desk-02-proof-tag-unfolded` | The proof tag hovered: unfolded, whole |
| `desk-03-opening` | Just after the click, the panel coming in |
| `desk-04` to `desk-08` | Each panel, with the climb drawing in `desk-05` |
| `desk-09-back-to-room` | Back to room |
| `desk-10`, `desk-11` | The browser's Back and Forward |
| `desk-12-reload-hash-proof` | A reload with `#proof` |
| `desk-13-escape-to-room` | Escape |
| `desk-14`, `desk-15` | The 2D fallback (`?static`): the place buttons, then the proof as a solid panel |

**Phone:** 390×844 @2, touch, `?q=low`.

| Shot | What it shows |
|---|---|
| `phone-01-room` | The room: the cards on screen and apart; five places in the bar |
| `phone-02` | Opening |
| `phone-03` to `phone-08` | Each panel, with the gate scrolled to its end in `phone-08` |
| `phone-09` to `phone-11` | Back to room, a reload with `#proof`, Escape |
| `phone-12`, `phone-13` | The 2D fallback |

## What the user can check by hand

1. **Skip the intro (Tab, Enter) and look at the room.**
   - Left of the spiral, on the back wall: a lit board reading **0/40 → 30/40**, with four bars and the goal.
   - The five tags are there; this also checks the rail fix.
2. **Hover "05 The proof".** It unfolds whole, over the board, in front of the spiral.
3. **Click the board (or the tag).**
   - The camera turns to it.
   - The board goes blank and the panel lands on its screen inside the teal frame.
   - "← Back to room" is top left; the URL ends in `#proof`.
4. **Step through:** Next, →, the dots.
   - Each graph draws in as its panel opens.
   - The numbers match the story's beats 05–08.
   - The links "Watch the real test runs →" and "Every number, with its sources →" work.
5. **The way out:**
   - Esc, Back to room, the browser's Back (the room) and Forward (the proof again).
   - A reload in the proof comes back to it.
   - The journey rail's PROOF from the top of the story lands there, inside a lit room.
6. **With Effects off (or the OS's reduced motion):** each graph is whole at once.
7. **On a phone:**
   - The bar reads SHELF MACHINE BENCH ROBOTS PROOF ↑ STORY.
   - The tag cards are all on screen.
   - The proof is a scrolling panel with its steps at the foot.
8. **`/?static`:**
   - The bar offers the five places.
   - Proof opens a solid panel.
   - Tab doesn't stop on the hidden bar in the story.
9. **The story's beats 05–08** still play with the scroll as before.

## Not verified

- **No real GPU.** Everything ran in SwiftShader (3–6 fps at high). The 47 vs 45 draw calls were measured there; the
  frame time on a real GPU wasn't.
- **No real screen reader.** The structure is checked in jsdom only: regions, the live region, the figures' tables,
  `inert`.
- **The low tier on a desktop** (the HTML cards at 1280) wasn't shot. Only the phone's low tier was. The proof card's
  spot beside the wall's was checked by projection only.
- **1440×900 and 1920×1080** were checked by the camera maths (the panel-to-screen test), not by eye.
- **Between square and 1.39:1** (for example 1024×900) the 3D screen is wider than the viewport. The panel then stays
  inside the rail's clearance, so it is narrower than the screen.
- **At 1280×720 the climb's and the teacher's panels scroll a few pixels inside the screen.** A thin teal scrollbar
  shows (`desk-05`, `desk-07`).
- **The 2D fallback's picture (`stills/workshop.webp`) predates the wall.** It still shows the two empty boards
  (`desk-14`).
- **The phone's stacked cards** (`placeCards`) cover part of the spiral's left side on 390 px, and their stems no
  longer point exactly at their objects.
- **Process note:** I deleted one scratch test file I had made minutes earlier (`core/tmpArrive.test.ts`, never
  committed), against the "overwrite, don't rm" habit.

## Questions for the user

1. **The spot:** the left board on the back wall, so the right one stays dark and empty. Should the right board get
   something too (for example the earlier 3/40 → 17/40 result), or stay plain?
2. **The 2D picture:** re-render `stills/workshop.webp` in Blender with the wall on it?
3. **The proof tag** floats in front of the spiral on desktop, and unfolded it reaches over the spiral's top. Is that
   fine, or would you rather the tag sit lower on the board itself (covering its kicker line)?
4. **Each visit starts at panel 1.** Keep that, or reopen where you left off?
5. **Ask SANT:** add "show me the proof" → the proof wall? It needs the backend's tool list to learn a new section.
6. **Phone room:** the clamped cards now stack on the left. Keep that, or hide the cards of things that are off
   screen on a phone, since the bar has the buttons anyway?
