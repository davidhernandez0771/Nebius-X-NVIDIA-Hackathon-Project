# Hand art (T7)

The Record overlay that draws the tracked hand. There is one style for each thing that happens,
and a 400 ms crossfade between styles, at most one per 400 ms cooldown.

| Event (page state) | Style | Look |
|---|---|---|
| idle | **Ink strokes** | Light dry-brush strokes along the bones, thick at the joints, breaking into bristles at the fingertips, over a thin teal wireframe |
| grab (gripper closes) | **Ink bloom** | Amber brush strokes burst out of the palm, sparse to dense, then settle smaller and sparser so a long grab still shows the hand |
| release (gripper opens) | **Particle burst** | Streaks shoot out from where the fingertips let go (1.1 s) |
| recording | **Particle trail** | A glowing particle hand that leaves a light trail as it moves |
| no hand for 300 ms (tracking lost) | **Dot ripple** | A calm dot field rippling out from the last palm position, with the hand's last pose in teal dots |
| reset (each rise of the reset count) | **Glitch** | The hand tears into displaced rows, dark slabs and pixel fragments, then snaps back (0.9 s) |

When several apply at once, the most urgent wins, in this order: reset, no hand, grab, release,
recording, idle (`artDirector.ts`).

**Colors** are Volt:
- light ink `#E6EDF3` and teal `#19F5C2`;
- amber `#FFB000` while the gripper is closed;
- a transparent background, with a soft dark backdrop (`#07090C`, about 34%) under the hand so it
  reads over the webcam.

**Reduced motion** holds one static style (ink): no crossfades, and time is frozen.

**Inspiration:** the user-picked studies in the sprint's visual references, all from
recent.design. Wireframe Ink and Radial Brushstroke by Zach Lieberman; Particle Burst and
Particle Figure by A. J. Ortigo; Particle Face Illustration; Dot Field Motion; Glitch Brush Study
by Martin Lorenz. These are our own shader versions, and no code, assets or compositions were
copied.

## Commits (branch `pm/t7-audit`)

| Commit | What |
|---|---|
| `6c66532` | The six styles: director, style cycle, shaders, renderer, overlay props, the `/pm/hand-art` preview, and tests |
| this note's commit | This README |

Both touch only `web/src/pm/handArt/**`, so they cherry-pick onto `pm/hand-v3` as they are. They
build on T4's `788eeb8` and earlier hand-art commits (`22f5b12`, `ee79ef9`), which
`pm/t4-diagnoser` already has. If `pm/hand-v3` doesn't have those, cherry-pick them first.

## Mount on Record (`pm/hand-v3`)

Poll the hand once per frame. The overlay works out the events itself from these four values:

```tsx
import { LazyHandArtOverlay, type HandArtFrame } from "../handArt";

const artHand = useRef<HandArtFrame | null>(null);
// In the tracker frame callback:
artHand.current = {
  landmarks: hand?.landmarks ?? null, // null = no hand: after 300 ms, the dot ripple
  gripperClosed: gripper === 1,        // grab = closes, release = opens
  recording: simIsRecording,           // record start / stop
  resets: resetCount,                  // +1 per reset_scene sent (button or gesture)
};

<LazyHandArtOverlay source={() => artHand.current} morphMs={400} cooldownMs={400} />
```

- `frozen` is optional. A page whose control freezes the arm can pass it to show the ripple too.
- `cue` and `trigger` are still accepted but ignored, so `pm/t4-diagnoser`'s RecordPage compiles
  unchanged. They can be deleted.
- `onActiveChange` still reports whether the overlay is drawing. Without WebGL it renders nothing,
  so keep the 2D skeleton as the fallback.

## How to try it

1. Run `npm --prefix web run dev` from `C:\dev\pm-t7`, then open `http://localhost:5173/pm/hand-art`.
   - **Follow the events** (the default) plays a 14 s synthetic hand through every event. The bar
     under the stage marks recording (teal), gripper closed (amber), no hand (grey) and the reset
     (tick).
   - Pick a style to pin it. A pinned bloom, burst or glitch replays every 1.3–2.6 s.
   - **Busy background** puts a bright, cluttered stand-in behind the art.
   - **Reduce motion** shows the static fallback.
   - **Measure each style** times each one for 3.5 s.
2. Live, from this worktree: `web/public/models` and `web/public/mediapipe` were copied from
   `C:\dev\pm-t4` (they are git-ignored). Open `/pm/record`, start the camera, and keep **Hand art**
   on.
   - This branch's RecordPage (T4's, unchanged) passes the landmarks and the gripper. So live you
     see ink, bloom on a pinch, burst on release, and the ripple when the hand leaves the frame.
   - The trail and the glitch need `recording` and `resets` from the page, as in the mount above.
     Until then they show only on `/pm/hand-art`.

## Frame time (RTX 5080, Chrome/ANGLE D3D11, drawn at 1201×900, DPR capped at 1.5)

Measured with **Measure each style** on `/pm/hand-art`, using GPU timer queries, 3.5 s per style:

| Style | GPU mean | GPU p95 | CPU mean |
|---|---|---|---|
| Ink strokes | 0.07 ms | 0.10 ms | 0.20 ms |
| Ink bloom | 0.11 ms | 0.14 ms | 0.23 ms |
| Particle burst | 0.12 ms | 0.22 ms | 0.75 ms |
| Particle trail | 0.74 ms | 0.78 ms | 0.37 ms |
| Dot ripple | 0.76 ms | 0.81 ms | 0.35 ms |
| Glitch | 0.32 ms | 0.75 ms | 1.13 ms |
| Following the events (with crossfades), 15 s | 0.14 ms | 0.37 ms | 0.29 ms |

- **Within the ~4 ms budget:** all six styles are well under it.
- **Throttled tab:** the automated browser tab ran at about 10 fps. GPU timings don't depend on the
  frame rate, but the CPU numbers include tab noise.
- **Not yet measured alongside Isaac and MediaPipe.** Watch it during the live test: `onStats`
  gives the same numbers.
- **Startup:**
  - The six styles in one program took 1.1–1.3 s to compile on D3D, and that compile blocked the
    main thread.
  - Now there is one program per style (34–174 ms each), compiled with `compileAsync` (parallel
    compile).
  - The longest main-thread stall while the overlay starts dropped from about 1.3 s to 13 ms.
  - Nothing draws until the programs are ready, a fraction of a second.

## What changed from T4's version

- **Event to style:** `styleCycle` no longer cycles on a counter. It follows a target style from
  `artDirector`. A target that arrives during the cooldown waits; it is never dropped.
  `HAND_ART_STYLES` are now the six above, replacing the five earlier textmode, dither and
  halftone styles.
- **RecordPage and teleop files are untouched** (the lead's rule). On this branch RecordPage still
  imports `ArtCue` and passes `cue`/`trigger`, which the overlay ignores.
- **The synthetic clip is now 14 s.** It adds a recording span, a hand-out-of-view gap, and a
  victory sign with a reset. Clip frames may carry the optional `recording`, `resets` and `frozen`,
  and `ClipRecorder.add` takes them.
