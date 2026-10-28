# Site trial merge (2026-10-22): the three site fixes in one branch

`pm/site-trial` (local worktree `C:\dev\pm-site-trial`) is `pm/live-13` at `a17f231` plus the three site branches. The
user tested each branch alone and saw the others' missing pieces as bugs. This branch puts them together for one test.
Nothing is pushed, and nothing is merged into `pm/live-13`.

## Merges

| # | Branch (tip, owner) | Merge | Conflicts |
|---|---|---|---|
| 1 | `pm/site-fixes-1` (`44bdbdd`, T1): no stuck "Loading", the page hold, Back to room everywhere, light pools, robot close-ups | `2422821` | none |
| 2 | `pm/site-intro-forest` (`48c00bf`, T2): the modelled trees, the rift, the digit loader, the room revealed whole (`roomWhole`), `pow` guards | `b76bc5e` | 1, below |
| 3 | `pm/site-workshop-interact` (`4cd1beb`, T5): the arm carries cartridges, the spiral lift, the bench mat, the cartridge bay | `114cba7` | none |
| 4 | `pm/site-workshop-interact` (`0be89db`, T5, one commit on `4cd1beb`): the spiral lifts only while the arm and its cartridge are inside its core | `54f97ed` | none |

**The one conflict, `web/src/world/stations/intro/Loader.tsx` (merge 2): the header comment only.**
- T1 rewrote its first lines, because the page hold moved out of the Loader to `WorldRoot` (`core/pageHold.ts`).
- T2 rewrote its next lines for the mark written in digits (`DigitMark.tsx`).
- **Resolved by keeping both:** T1's first two lines, then T2's lines on the digit mark.
- The code merged cleanly: T1's removal of the Loader's own `overflow` effect stands, and the hold is `pageHold`'s.

**The known overlaps, checked after the merges:**
- `workshop/Scene.tsx`:
  - T1's one `<FloorPools />` line is there (line 140).
  - T2's `roomWhole()` gates the hub (line 106).
  - T5's `detail` prop on `<Baked>` sits inside `<Materialize>`.
- **T5's Materialize and T2's `roomWhole()`:** T2's `roomWhole()` (`scene/dissolve.ts`, `materialize.p >= 1`) is read by
  the Lamps, the descent's counter and the hub. T5's `materializeAll.test.ts` checks that the bench mat, the arm, the
  ribbon, the helix and the baked room are each inside a `<Materialize>`; it passes.
- **The `pow` guards:** T1 (workshop shafts), T2 (forest, reactor, descent) and T5 (the drop light) touched different
  shaders, with no textual overlap. T2's `shaderPow.test.ts` (every GLSL `pow` guards its base) passes on the merged
  tree.

## Checks (on `54f97ed`)

- **Dependencies:** no change to `web/package.json` or `package-lock.json`. `node_modules` was missing in the new
  worktree, so `npm ci` ran from the existing lockfile (235 packages).
- **`tsc -b`:** clean.
- **vitest** (`--maxWorkers=2 --minWorkers=1`): **1938 passed, 1 skipped** (221 files).
  - At `114cba7` (before T5's lift fix): 1934 passed, 1 skipped (220 files).
  - T5 reported one timeout in `site/data/DataPage.test.tsx` in a full run (it passes alone). It did not happen in
    either of my full runs.
- **Build:** OK (the usual three.js chunk-size warning).
- **No fixes were needed.** No merge broke anything.

## The walk (SwiftShader, 1280×720, `?q=high`, `vite preview` on 127.0.0.1:5199)

The usual walk script plus checks for this merge. There were **no console errors or warnings in any step** (the
reports: `d-report.json`, `lift-report.json`, `lift2-report.json`).

| Check | Result | Shots |
|---|---|---|
| The forest's modelled trees | `trees.glb`, `bark_albedo.jpg`, `bark_normal.jpg` and `leaves.png` all fetched; the trunks with bark relief are in the forest | `d02-forest` |
| The machine: no stuck "Loading" | the wait line is empty at 4.5 s and at 10 s; no visible "Loading" text | `d10-hologram`, `d11-machine-10s` |
| The projection (zoom) | no wait text at 1 s or later; it hands off to the cartridge's 2D page (`/record`), as designed (`core/handoff.ts`) | `d12-zoom` |
| The robot wall: no stuck "Loading" | the wait line is empty at 4.5 s and at 9 s; five entries with their status (3 Tested in Isaac, 2 Planned) | `d15-robot-wall`, `d16-robots-catalog-scrolled` |
| Shelf → rail **Story** → 4 wheel notches | the page lets go: `y` 0 → 480, `overflow` "" (no hold), the station is `intro`, the camera on the hero | `d18-shelf-rail-story` |
| Shelf → rail **Descent** → 4 wheel notches | `y` 8424 → 8904, `overflow` "", the station is `descent` (the workshop building, 23%) | `d21-shelf-rail-descent` |
| Back to the room after each | `hub: true`, the four tags and the bar | `d19-hub-again`, `d22-hub-after-descent` |
| The bench, contact, results, review, `/record` | each opens | `d14`, `d23`–`d27` |
| Drag a cartridge to the machine | it plugs in and the machine projects; no wait | `d09`, `d-drag-held`, `d-drag-held-3s` |

**The spiral lift (T5's `0be89db`): it never passes through the arm or the cartridge in any frame captured.**
- **Drag pick and hold:**
  - The first frame after the press already shows the end of the lift: the spiral is up and out of view, and the arm
    hangs straight down with the cartridge inside the core, beside the mast.
  - It stays there while held (`lift-drag-held-*`, `lift2-b-drag-*`).
- **Let go (put-back):**
  - The spiral comes down round the arm, which waits inside the core; it is visible through the gap between the tiers
    (`lift2-b-putback-1.01s`).
  - Then the arm pushes the cartridge out into its slot (`lift2-b-putback-2.10s`, `lift-put-back-3s`).
  - The room is back as it was (`lift2-b-putback-done`, `lift-put-back-16s`).
- **The click path:**
  - A click opens the cartridge's detail view (`lift-click-*`).
  - Its "Plug in →" sends it to the machine: the cartridge comes down into the bay, then the projection
    (`lift2-b-plug-1.48s`, `lift2-b-plug-3.82s`).
  - Then it autoplays on through the zoom to the cartridge's page (`lift2-b-plug-8.64s`). That is the existing
    `plug.autoplay` behaviour (`machine/Scene.tsx`), not this merge.
- **The limit:** SwiftShader renders at 2–4 fps, and each screenshot takes about a second. So the lift's own motion
  (rising or coming down) is between frames, and only its ends were seen.
  - The check of the motion itself is T5's `liftClear.test.ts` (every slot, 41 lift steps, arm segments and cartridge
    corners against the ring), which passes on this tree.
  - **Worth a hand check on the real GPU:** watch the spiral rise and fall during a pick and a put-back.

**Leftover files:** the first walk (at `114cba7`) stopped part-way, so its later shots were taken out of the world. It
was re-run on the final tip with the step names renumbered. Its stale shots are not committed and are left untracked in
this folder:
- `d13-bench`, `d14-robot-wall`, `d15-robots-catalog-scrolled`, `d16-shelf-again`, `d17-shelf-rail-story`,
  `d18-hub-again`, `d19-shelf-3`, `d20-shelf-rail-descent`, `d21-hub-after-descent`;
- `d22-contact`, `d23-results`, `d24-results-real`, `d25-review`, `d26-record`.

## To try it

```text
cd C:\dev\pm-site-trial\web
npm run dev
```

Then open http://localhost:5173. Only if no other vite is on 5173: vite falls back to the next free port, and prints it.
