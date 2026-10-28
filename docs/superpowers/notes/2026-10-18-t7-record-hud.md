# T7, sprint 9: Record HUD tiles (`pm/web-record-hud`)

The instrument rack from `docs/design/prototypes/record-console.html`, rebuilt as presentational React
components fed by props, on Volt. Preview at **`/site/record-hud`**, fed by a recorded fixture.

## How to view

```
npm --prefix web run dev
```

Open http://localhost:5173/site/record-hud. The buttons top right switch the preview state: **Hand tracked**
(the fixture playing), **Starting simulator** (the quiet loader), **Hand lost** (the arm holds its target).
The record button toggles recording/paused. The Effects switch (or OS reduced motion) holds the rack still
at 4.8 s, mid-lift with the cube held.

## What is where (`web/src/site/record-hud/`)

| File | What |
|---|---|
| `hudModel.ts` | Pure. `toTarget(msg)` mirrors `demo_pipeline.teleop.to_ee_target` (incl. the `control` path); `stepHud(state, msg, landmarks?)` adds the sim's gripper latch (`nextGripper`), holds the target while tracking is lost, keeps 240-sample histories (8 s at 30 Hz). Also `frameAt`, `meanRateHz`, `formatClock`, `knobAngle`. |
| `RackTile.tsx` | `RackTile` (label, unit top right, `selected`, `span`), `ChannelTile`, `readout()` (dash for null). |
| `PalmPad.tsx` | `PalmPad` / `PalmPadTile` (`palm_xy`): dot + crosshair; amber at the region edge. |
| `GripKnob.tsx` | `GripKnob` / `GripKnobTile` (`gripper_cmd`): needle follows the pinch ratio, two marks at the latch thresholds (0.45 open / 0.35 close), dimmed `stale` while the hand is lost. One needle, no arc: not a tachometer. |
| `HeightTrace.tsx` | `Trace` (SVG, crisp at any width) and `HeightTraceTile` (wide `ee_target_z`): height bright, reach faint, dashed `grasp_z` (the cube's height from `framing.ts`). |
| `CamTile.tsx` | `CamTile` (two rows; the webcam goes in as children) and `HandOverlay` (landmarks, pinch gap, palm trail, dashed control region; mirrored; letterboxes like `object-fit: contain`). |
| `RecordBar.tsx` | `RecordBar`, `StatusChip` (ok / wait / off: teal dot, amber dot, hollow ring, plus words), `RecordControl` (button keeps the name "Record", state in `aria-pressed`; timer `mm:ss.d`). |
| `SimStartLoader.tsx` | The toned-down loader: one line + time, a 1 px rule, the steps in order. Still under reduced motion. |
| `RecordRack.tsx` | The whole rack composed from the tiles. Sets `data-mode="volt"` on itself, so it works inside or outside `AppShell`. |
| `RecordHudPreview.tsx`, `useReplay.ts`, `fixture/` | The preview page and the fixture player (preview only). |

`web/scripts/record-hud-fixture.mjs` writes `fixture/session.json`.

## For T4: mounting on Record

```tsx
import { RecordRack, initialHud, stepHud } from "../../site/record-hud";
// per HandPoseMsg sent to the relay (landmarks optional, for the overlay):
setHud((s) => stepHud(s, msg, landmarks));
<RecordRack hud={hud} chips={[...]} state={rec} elapsedMs={ms} onToggle={...} camera={<video ... />} phase={...} rateHz={...} />
```

Or take single tiles (`PalmPadTile`, `GripKnobTile`, `HeightTraceTile`, `ChannelTile`, `RecordBar`, `CamTile`,
`SimStartLoader`) into another layout; they need a `.rh` ancestor for their styles (`<div className="rh" data-mode="volt">`).
The video inside `CamTile` is drawn mirrored with `object-fit: contain`, matching the overlay.

I only import from `web/src/pm/record/framing.ts` (`CALIBRATION`, `Z_RANGE`, `TABLE_MARK`, `GRIPPER`,
`nextGripper`) and the `HandPoseMsg` type; nothing under `pm/record`, `teleop` or `handArt` was edited.
The workspace x/y ranges are copied from `teleop.py` `Calibration` in `hudModel.ts` (`WORKSPACE`), because
`framing.ts`'s `X_RANGE` isn't on every branch yet. Update together.

## Numbers and honesty

- **The fixture is scripted, not a webcam recording.** Keyframes drive a drawn hand; the wire fields are then
  measured from the landmarks the way `handPoseMessage.ts` does, so a real session file can replace it. The
  page says so under the rack.
- Every value on the rack is computed from the fixture through the sim's own mapping (`teleop.py`).
- **Changed from the prototype:** `link_latency` (46 ms) and `hand_conf` were illustrative and nothing measures
  them, so they are gone; `isaac_lab 3.0` lost its version. In their place: `ee_target_y`, `wrist_yaw`, and
  `msg_rate` (measured from the fixture's timestamps; ~30 Hz is the real rate, `2026-10-15-t4-status.md:169`).

## Design decisions

- Volt tokens throughout (bg, surfaces, lines, text, teal live, amber hold). The one local colour is the
  prototype's signal orange `#ff5a1f` (`--rh-needle`) for needles and dots.
- Geist Mono (the system's data face), not the prototype's IBM Plex Mono.
- Full width of the app column instead of the prototype's centred 1240 px, so the rack lines up with the page title.
- The pinch label sits outside the thumb, and `grasp_z` is named in the legend, so neither covers the data.

## Requests

- **T5:** `web/index.html` loads Geist Mono at `wght@400..600`; the rack's large readouts are set at 300 (the
  prototype's light look) and fall back to 400 until the font URL says `Geist+Mono:wght@300..600`.
- **T5 (optional):** if the signal orange should be used elsewhere, promote `--rh-needle` to a Volt token.
- **Lead:** one route line plus one lazy import in `web/src/App.tsx` (SantRoot block).

## Verification (on `pm/web-record-hud`, from `origin/perfect-then-multiply` at 3e817f1)

- `npm --prefix web test`: 38 files, 479 tests passed (24 new in `web/src/site/record-hud/`).
- `npm --prefix web run build`: built (the >500 kB warning is the existing three.js chunk; this route's lazy
  chunk is 135 KB, mostly the fixture).
- `uv run pytest -q`: 1490 passed, 18 skipped. One earlier full run had
  `tests/test_launch_start_stop.py::test_stop_kills_only_what_the_pid_file_proves_it_started` fail; it passed
  3/3 alone and in the next full run, so it looks timing-flaky under load. No Python was changed here.
- Looked at in Chrome at 1568 px wide (all three preview states, Effects off holds at 4.8 s, no console
  errors) and in 375 px and 820 px iframes (no horizontal scroll).
- `docs/design/content-spec.md` is not on the base yet (T1's); nothing here depends on it.
