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

From 2 it borrows one thing: the conduit ends in an outlet arrow toward "your data", so the strip reads as the machine's flow out to the download.

**Shared primitives:** T1 is restyling /data (pm/data-holo) in the same language and owns `web/src/site/holo/holo.css` + `Holo.tsx`. They also own the data-* look (badges, buttons, notes), which the pipeline reuses. This branch styles only the `pipe-*` classes, against T1's `--holo-*` token names with fallbacks.

## Build
(in progress)
