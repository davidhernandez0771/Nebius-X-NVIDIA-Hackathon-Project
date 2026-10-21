# Pipeline holo: the /pipeline pages inside the SANT machine (2026-10-21)

Branch `pm/pipeline-holo`, from pm/live-13 (`7637481`). Nothing pushed. Training day: no GPU. Every screenshot is taken in headless Chrome with SwiftShader, using the example run (no backend).

**The brief, from the lead:** today the pipeline pages read as a flat dark dashboard, while the descent and the workshop are holographic, in the Active Theory style. The pipeline should feel like being inside the SANT machine.

**What must not change:** every function, data binding and test; accessibility (reduced motion is static); the phone layout; the performance budget (no new WebGL).

## Three directions (brainstorm)
1. **Inside the hologram (Record's language).**
   - **Panels:** see-through glass panels with hairline teal borders, corner ticks and small mono uppercase labels ("STAGE 02 / 06"), over the workbench's cutting-mat grid.
   - **The stage strip:** a single lit conduit. A thin track runs through one node per stage and fills with teal as the stages complete.
   - **Stage panels:** a panel draws in from the top with one scanline sweep when the stage changes.
   - **Smaller pieces:**
     - the verdicts are holo tags;
     - the loss curve is a glowing trace on a faint grid;
     - the downloads are cartridge cards.
   - **Pros:** it is the same family as /record ("inside the hologram") and T1's hub labels, and it costs no WebGL. It is pure CSS and SVG, with transform/opacity/clip-path animation only.
   - **Con:** it is quieter than the 3D rooms.
2. **The projection wall.** The machine projects the UI onto the wall, as in the Blender beam shot (frames 960–1110).
   - **The look:** a volumetric beam above, the panels tilted slightly in CSS perspective, and a faint projector flicker.
   - **Pro:** a strong link to the workshop's zoom-in.
   - **Cons:** tilted text reads worse, phones get nothing from the tilt, and a flicker is the kind of gimmick the user dislikes ("goes too far").
3. **The instrument rack.** Each stage is an instrument (gauges, needles, LED rows) after the Pressure Monitor reference.
   - **Pro:** it is a reference the user liked.
   - **Cons:** it is a Record reference, and it turns the pipeline back into a dashboard, only skeuomorphic this time. Six gauges in a row also read "too AI".

**Pick: 1, inside the hologram.** It is closest to the workshop and to Record, which is the page you come from. It also keeps every number readable.

From 2 it borrows one thing: the conduit runs off the strip's right edge once the run is done, so the strip reads as the machine's flow out to the download.

**Shared primitives:** T1 is restyling /data (pm/data-holo) in the same language and owns `web/src/site/holo/holo.css` + `Holo.tsx`. They also own the data-* look (badges, buttons, notes), which the pipeline reuses. This branch styles only the `pipe-*` classes, against T1's `--holo-*` token names with fallbacks.

## Build
**The frame.** `/pipeline` now sits in T1's shared `HoloPage`: Record's top strip (mark, "⏏ workshop", serif title, the path Record › Pipeline › Data), the void, and the cutting-mat grid. It replaces AppShell. Inside it, the `--sant-*` tokens take the holo values, so /data's badges, buttons, notes and tables come out in the same look. Cherry-picked from T1's pm/data-holo: 2bb9484 → 0dd8cf2, 2bd1fd9 → b37c3fb, 96699c6 → bfbbc6d (holo files only), and T1's /data restyle 80683b6 → c65318d (data files only).

**The pieces, all in `pipeline.css` plus a little markup:**
- **Panels.** The bar, each stage's page and the start form are `.holo-panel` (glass, a teal hairline, corner ticks). The run rows and download cards are the same glass without ticks.
  - Labels are small mono caps. A stage's page opens with "STAGE 02 OF 06" after a lit tick.
  - Run names and stage titles are in Instrument Serif, as Record's title is.
- **The conduit** (`PipelineBar`):
  - A hairline runs through one node per stage. The teal light fills it by `conduitOf(run)` (model.ts, tested), which counts stages done, the running stage's share, and a real run's skipped stage as passed. A dry run counts nothing.
  - The light reaches a node when its stage starts and runs on toward the next stage as it goes.
  - Nodes: lit when done, ringed by progress while running (a conic ring), amber if stopped, dashed if skipped.
  - The stage on screen has corner brackets.
  - Under 760 px the conduit turns down the left side, one stage a row, filled by the same measure.
- **Stage panels.** PipelinePage keys `StageView` by stage, so a new stage, or the run moving on, mounts a new panel. The panel draws in from the top (clip-path, 320 ms), then one scanline runs down it once.
- **Holo tags.** The verdict badges are /data's, restyled by T1. The seeds are small tags, lit or amber.
- **The loss trace.** A faint grid, a wide soft under-stroke as the glow (no SVG filter), a 1.5 px line, and a lit head at the latest point (`lossHead`, tested).
- **Teacher pages:**
  - **Gate:** a gate meter under the sentence. The score is a lit bar and the 90% gate is a line; it goes amber if the gate failed. It is `aria-hidden`, since the sentence says it.
  - **Distill / DAgger:** the round's phases as a small conduit, Rollouts › Mix › Train › Pick, with `aria-current="step"` on the phase it is in.
- **Downloads.** Cartridge cards with a cut corner and a lit top strip (teal for datasets), the kind on the label, and a ↓ on the link.
  - At the end of a real run, a hand-off link reads "Next: Data, the demos and their verdicts →" (T1's `HandoffLink`).
  - The "Your data is ready" link stays a plain Link. It goes to another stage of the same page, and a hand-off there would wait on a veil no new page lifts.
- **Motion and performance:**
  - Animation is transform, opacity and clip-path only; the conduit and gate fills are `scaleX`. There is no blur, no filter and no WebGL.
  - With reduced motion (the OS setting or `data-motion="reduced"`) nothing animates: the panel just appears, and the fills jump.
- **Contrast.** Text is ink or ink-2. The frame's ink-3 (3.3:1) is decoration only.

## Checks
- **Tests first:**
  - model: `conduitOf` and `lossHead`, 2 new tests;
  - pages: 5 new (the conduit's fill and nodes, stage panels and remounting, the trace's glow and head, download kinds and run states, the gate meter and phase track), plus the Data hand-off at the end;
  - every old test unchanged and passing.
  - Pipeline: model 14, stub 3, pages 34 (51 in all).
- **Full web suite** (with T1's holo + /data commits): 199 files, 1,808 passed, 1 skipped.
  - The first full run had 1 failure in T1's `DataPage.test.tsx` ("shows the variants with their badges…"). It passed 3/3 alone and in the next full run, so it is load-dependent (reported to T1).
- **`tsc -b` and `npm run build`:** pass.
- **Headless Chrome, SwiftShader only** (`ANGLE … SwiftShader Device`), after 17:35 per the lead's CPU window:
  - The example run (no backend) covers the list, Check, Train, Evaluate and Export. A scratch fixture server covers the teacher pages; it served the tests' teacher snapshot (runs labelled "FIXTURE:"), with no run, GPU or backend.
  - The "before" set is pm/live-13 `7637481`, from a detached scratch worktree.
  - Desktop shots are 1280×720 (full page). Phone shots are 390×844, full page, and none scrolls sideways (scrollWidth 390).
- **Reduced motion** (emulated `prefers-reduced-motion: reduce`):
  - after a stage click, the panel has animation `none` and opacity 1;
  - the scanline has animation `none`;
  - the conduit's transition is 0 s. (shot `after/desktop-11-transition-reduced.jpg`)
- **Fixed from the shots:**
  - an empty status row left a gap under the bar;
  - the demos field was 44 px tall (the app's global input min-height) next to 36 px fields.

## Screenshots (`2026-10-21-pipeline-holo/`)
`before/` and `after/`, each named `desktop-NN-…` and `phone-NN-…`:
- 01: the list and start form;
- 02: Check;
- 03: Train (the loss trace);
- 04: Export (the downloads);
- 05: Evaluate;
- 06: Gate (fixture);
- 07: Distill (fixture);
- 08: Teacher (fixture);
- 09: the teacher form (fixture);
- 10: a stage click mid draw-in, with the scanline;
- 11 (after only): the same click with reduced motion.

## Open
- **The example's end asks the absent API for its artifact list** (`GET /pipeline/runs/example/artifacts`, connection refused, 2 requests), then shows its own list. This happened before this branch too (same count on live-13). It could skip the fetch for the example; not changed here.
- **The fixture's loss noise** on the Distill shot is the fixture's, not a run's.
- **The teacher pages:** like the rest, they have been seen live only against fixtures. The first real teacher run tonight is their first live view.
- **Left on disk, by design** (no rm): the scratch worktree `scratchpad/before-wt`, whose `web/node_modules` is a junction to pm-t2's. Remove the junction (`rmdir`, not a recursive delete) before `git worktree remove`.
