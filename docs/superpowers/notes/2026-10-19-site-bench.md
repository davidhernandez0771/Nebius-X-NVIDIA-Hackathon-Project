# The workbench cartridge editor (`pm/site-bench`, 2026-10-19)

Branched from `pm/site-journey`. The workbench station (`web/src/world/stations/workbench/`) was a
placeholder; it is now the cartridge editor. Not pushed or merged.

## What it does

- **Name** the cartridge (up to 16 characters; Enter saves).
- **Look:** five shells, Graphite, Smoke, Bone, Ash and Signal (`scene/saved.ts` `SHELLS`). Smoke is
  see-through on the bench only.
- **Robot:** the robots in `scene/robots.ts`, with the picked one's spec line.
- **Live preview:** the cartridge on the bench turntable (`cartridge.glb` parts, the label art from
  `scene/labels.ts`) follows every edit, with a small turn on each change.
- **Save** puts it in the next empty place on the spiral, kept in localStorage (`world.bench.v1`),
  and a printed label slides out of the label printer. Saved cartridges hover, label and plug into
  the machine like the robot cartridges. The editor lists them, each with a remove.
- **Esc and Back** return to the room view.
- **At most 4 saved.** The spiral's 29 slots are all used; Blender's helix skips one place after
  slot 10 and three after slot 21, and saved cartridges fill those (`scene/layout.ts` `SPARE`).
  More would need new slots in Blender.

## How to try it

1. `npm --prefix web ci`, then `npm --prefix web run dev`, and open `http://localhost:5173/world`.
2. Scroll to the workshop and press **+ Add a cartridge** (or **Workbench**).
3. Type a name, pick a shell and a robot, and press **Save to the spiral →**.
4. Press **← Back** (or Esc). The new cartridge stands in its place on the spiral; click it to plug it in.
5. To start over, clear `world.bench.v1` from localStorage.

## Checks

- `npm --prefix web test`: 73 files, 624 tests, 0 failed.
- `npm --prefix web run build` (tsc -b + vite build): passes. The only warning is the chunk-size one.
- Seen in headless Chrome on the real GPU (high tier, 1280×800): live edits, the label printing, the
  saved cartridge on the spiral between EVAL 40 and RECOVERY, Back to the room view.

## Unverified / not done

- **Not tried by a person in a normal browser window**, only headless Chrome. Not tried on a phone,
  a touch screen, the low or ultra tiers, or the laptop GPU.
- **Plugging in a saved cartridge** was checked in unit tests (slot pose, route), not watched end to end.
- **Stills mode** (no WebGL): the editor works and saves, but the stills cartridge list doesn't show
  saved ones.
- **Ask SANT** doesn't know about saved cartridges.
- **Pre-existing:** an intermittent `Cannot read properties of undefined (reading 'isReady')` on load,
  from three's shader pre-compile. `pm/site-journey` throws it too (2 of 4 loads). Not fixed.
