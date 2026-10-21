# pm/live-11: the four finished branches of the 20th (interact, robots, descent, nemotron-repair)

On `pm/live-11` from `0031687` (see [the site merge note](2026-10-20-live-11-site-merge.md)), in `C:\dev\pm-t7`.
Merged in the order asked. Nothing was pushed. The T1, T2, T3 and T5 worktrees were only read (`git log`/`diff`).
No Isaac. Blender was open, so headless Chrome ran on software rendering (SwiftShader), not the GPU.

| # | Branch (head) | Merge | Conflicts | tsc | Web tests | Build |
|---|---|---|---|---|---|---|
| 1 | `pm/site-interact` (`7be8281`, T1) | `872f09f` | none | clean | 1347 passed (150 files) | OK |
| 2 | `pm/site-robots` (`61b2b6a`, T5) | `37f196f` | 3, hub | clean | 1383 passed (156) | OK |
| 3 | `pm/site-descent` (`79cad00`, T2) | `200fc78` | none | clean | 1418 passed (159) | OK |
| 4 | `pm/nemotron-repair` (`1718f5f`, T3) | `771ea37` | 1, a test file | clean | 1418 passed (159) | OK |
| — | the hub-bar fix below | this commit | — | — | 1418 passed (159), 1 skipped | OK |

Full pytest at the end (after #4): **1987 passed, 15 skipped, 0 failed.** The web suite has 1 skipped test in every run.

## The conflicts and how they were solved

All of them kept both sides.

**#2, `pm/site-robots` after `pm/site-interact`:**
- `web/src/world/stations/workshop/HubBar.tsx`: the hint. T1: "Drag a cartridge to the machine · click the shelf, the
  machine or the bench · Esc goes back" (the middle part in `world-hubbar__more`). T5: "Click the shelf, the machine,
  the bench or the robot wall · Esc goes back". Merged: T1's sentence with T5's list, "· click the shelf, the machine,
  the bench or the robot wall". T5's **Robots** button auto-merged into the hub bar after Shelf, Machine, Bench.
- `web/src/world/stations/workshop/HubTags.tsx`: the header comment and the React import line. Both comments merged
  (four tags, the drop zone, the `hubTagLayer` portal); the import keeps T5's `MutableRefObject`. The bodies
  auto-merged: T1's drop zone and drag subscription, T5's portal and the **"04 The wall"** tag. The `TAGS` order,
  so the Tab order, is shelf, machine, bench, wall.
- `web/src/world/stations/workshop/Scene.tsx`: the header comment and the imports. T1's (`shellOf`, `instanceSlot`,
  the bench `draft` and `layout`, `drag`, `Dragged`) plus T5's `RobotWall`. T5 deleted `Library` (the wall of
  spines is now the robot wall), and the body uses `RobotWall` with T1's `Dragged` and bench instance.
- The dock auto-merged: the robots' buttons, a button for each saved cartridge (T1), and "+ Add a cartridge".
- The label atlas: only T1 changed `labels.ts` (tile 36, the bench's draft; 10 rows). T5 and T2 didn't touch it.

**#3, `pm/site-descent`:** no file in common with `pm/site-interact` or `pm/site-robots`. The journey rail
auto-merged: Story · Descent · Workshop, then Machine · Workbench · Robots.

**#4, `pm/nemotron-repair`:** `tests/test_run_human_demo_experiment.py`. Both sides' tests were kept (record-aids'
`--input` tests and T3's `test_repairer_nemotron_edits_routes_the_repair_step`). `scripts/run_human_demo_experiment.py`
auto-merged with `--input`, the achieved path and `--repairer rules|nemotron-edits` all in; checked by diff.

## One thing broken by the merge, fixed

**The hub bar ran into the brand at 1280×720** (`d06-hub.jpg`). T1 hid the hint's middle part below 1100 px. With T5's
"or the robot wall" added, the whole hint is ~1060 px wide, centred, so it covers the top-left "S·A·N·T PERFECT, THEN
MULTIPLY" on anything under ~1600 px. Fix in `workshop.css`: the breakpoint moves from `max-width: 1100px` to
`max-width: 1599px`. Narrower desktops show "Drag a cartridge to the machine · Esc goes back" (the tags name the
clicks). Re-shot: `d06-hub-after-fix.jpg`. Phones are unchanged (under 700 px the hint is hidden and the hub bar
shows the buttons).

## The walk, headless Chrome

Production build (`vite preview`), SwiftShader, `?q=high`, 1280×720 (`d*`) and 390×844 @3× with mobile emulation (`p*`).
The script drives the page over CDP. The drag is real mouse events: it finds a cartridge by moving the pointer down
the spiral until the hover tip shows, presses, moves 30 steps onto the machine, holds, and releases. **Every step passed
at both sizes, with no console errors or exceptions** (`report-1280x720.json`, `report-390x844.json`).

| Step | Shot | Checked |
|---|---|---|
| hero → forest → reactor → the ring | `01`–`04` | T2's descent: "ROBOTS NEED DEMOS." in the forest, the reactor at 48% with the proof, the ring at 100% ("Into the workshop") |
| build | `05` | the descent station: "// building the workshop" particles |
| hub | `06` | 4 tags (shelf, machine, bench, wall); hub bar Shelf, Machine, Bench, Robots |
| the shelf | `07` | browse panel, robots and "+ Add a cartridge" in the dock |
| drag to the machine | `d-drag-held`, `08` | the hover tip reads "· click to open · drag to the machine"; the cartridge in the hand over the machine; on release the machine opens |
| the hologram | `09` | "10 × 30 plugs in…": the hologram Franka, the replay card, the joints |
| the bench | `10` | T1's editor (name, look, robot, Save to the spiral, 0/4) |
| the robot wall + catalog | `11`, `12` | T5's robots view; 5 entries: Franka, Flexiv Rizon 4s, OpenArm (tested in Isaac), SO-101, PiPER (planned); scrolled to the last |
| Results, Review, /record | `13`–`15` | `/site/results`, `/review2`, `/record` (Keyboard / Mouse / Camera, the twin views) |

The FPS badge in the shots is software rendering and means nothing.

## Not checked

- Nothing on the GPU (Blender was open). No real-GPU frame rates after the four merges.
- Touch drag on the phone: the phone walk dragged with mouse events under mobile emulation. T1's note covers a touch drag.
- Saving a cartridge, then plugging it in from the dock's button; the Tab walk (T5's audit) after the merge; Ask SANT.
- `--repairer nemotron-edits` end to end (needs Isaac and the Nemotron API); its unit tests pass.
