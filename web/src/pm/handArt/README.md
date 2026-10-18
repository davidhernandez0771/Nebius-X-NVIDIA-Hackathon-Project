# Hand art (T7)

The Record overlay that draws the tracked hand. There is one style for each thing that happens,
and a 400 ms crossfade between styles, at most one per 400 ms cooldown. A **break-through** plays
when the hand passes through the workspace plane in depth.

| Event | Style | Look |
|---|---|---|
| idle | **Ink strokes** | Light dry-brush strokes along the bones, thick at the joints, breaking into bristles at the fingertips, over a thin teal wireframe |
| grab (gripper closes) | **Ink bloom** | Amber brush strokes burst out of the palm, sparse to dense, then settle smaller and sparser so a long grab still shows the hand |
| release (gripper opens) | **Particle burst** | Streaks shoot out from where the fingertips let go (1.1 s) |
| recording (start to stop) | **Particle trail** | A glowing particle hand that leaves a light trail as it moves |
| no hand for 300 ms (tracking lost) | **Dot ripple** | A calm dot field rippling out from the last palm position |
| reset | **Glitch** | The hand tears into displaced rows, dark slabs and pixel fragments, then snaps back (0.9 s) |

When several apply at once, the most urgent wins, in this order: reset, no hand, grab, release,
recording, idle (`artDirector.ts`).

**Colors** are Volt:
- light ink `#E6EDF3` and teal `#19F5C2`;
- amber `#FFB000` while the gripper is closed;
- a transparent background, with a soft dark backdrop under the hand so it reads over the webcam.

**Reduced motion** holds one static style (ink).

## Break-through (depth crossing)

The page bumps `breakthrough` each time the hand passes through the workspace plane in depth, and
sets `breakthroughDir`.
- Only real plane crossings should bump it, never reaching the min/max depth or the square's
  edges. Detecting that is the page's job (T4).
- Push through (`1`, toward the camera):
  - a noise-edged teal front races out from the palm, the same mask as the style crossfade but
    radial and stronger;
  - the art is shoved outward across the front like a lens;
  - the surface behind the front breaks into glassy shards whose cracks drift outward, densest at
    the palm.
- Back out (`-1`): the front closes in on the palm, the cracks stay outside it, and the palm blinks
  as the surface closes.
- No direction (missing, or not ±1): one effect, the outward front and lens without shards.
- Timing:
  - it plays for 420 ms, and the current style keeps running underneath;
  - a crossing within 250 ms of the last accepted one is dropped;
  - one after that restarts the effect in its own direction.
- Reduced motion: a 220 ms flash. The hand tints to the accent with a soft halo, and nothing moves.

The effect is drawn inside each style's program, before the crossfade weighting, so it stays
exact during a style change (`breakthrough.ts`, `breakFx` in `shaders.ts`).

## Commits for T4 (branch `pm/art-v3`, from `pm/hand-v3` at `a2cf609`)

| Commit | What |
|---|---|
| `f39377f` | The six styles: director, style cycle, shaders, renderer, overlay props, `/pm/hand-art` (cherry-pick of `6c66532`) |
| `2232ff7` | The first version of this README (cherry-pick of `4db5463`) |
| `9e9356a` | hand-v3 adaptation: use Record's `cue` counter when the page sends no `recording`/`resets` |
| `b191027` | The break-through: `breakthrough` and `breakthroughDir` props, the effect, preview buttons, the measured row |
| this README's commit | This note |

All of them touch only `web/src/pm/handArt/**`. `pm/hand-v3` already has the earlier hand-art
commits these build on (`161d75d`, `c868b1f`, `14e680d`), so it's
`git cherry-pick f39377f 2232ff7 9e9356a b191027 <this commit>`, or merge `pm/art-v3`.

## Mount on Record (`pm/hand-v3`)

**It works as is.** hand-v3's RecordPage already passes `landmarks`, `gripperClosed` and `cue`.
- Grab, release and no-hand come from the gripper and the landmarks.
- A `cue` bump the gripper doesn't explain (Reset scene, record start/stop) plays the reset glitch,
  since a bare counter can't say which event it was.
- The page's `trigger="events"` prop is accepted and ignored: the style always follows the events.

**For the exact mapping, add these lines to `artHand.current` in RecordPage** (T4's file):

```tsx
artHand.current = {
  landmarks: hand?.landmarks ?? null,
  gripperClosed: gripper === 1,
  recording: recordingNow.current,   // record start/stop: the particle trail while recording
  resets: resets.current,            // each Reset scene: the glitch
  breakthrough: crossings,           // +1 per plane crossing in depth
  breakthroughDir: lastCrossingDir,  // 1 pushing through toward the camera, -1 backing out
  // cue may stay; it's ignored once recording or resets is sent.
};
```

The `LazyHandArtOverlay` mount needs no change: `source`, `morphMs`/`cooldownMs` 400 and
`onActiveChange` all stay as they are.

## How to try it

1. Run `npm --prefix web run dev` from `C:\dev\pm-t7`, then open `http://localhost:5173/pm/hand-art`.
   - **Depth crossing** has **Push through** and **Back out** buttons (and "Cross with no
     direction"). They fire the break-through over whatever style is showing.
   - **Follow the events** (the default) plays a 14 s synthetic hand through every event.
   - Pick a style to pin it.
   - **Busy background** and **Reduce motion** check readability and the fallback.
   - **Measure each style** times each style, then break-throughs firing every 0.45 s.
2. Live from this worktree: `web/public/models` and `web/public/mediapipe` are already here
   (copied, git-ignored). Open `/pm/record`, start the camera, and keep **Hand art** on.
   - The break-through needs T4's crossing detection and the two props above.
   - Until then, it shows only on the preview page.

## Frame time (RTX 5080, Chrome/ANGLE D3D11, drawn at 1201×900, DPR capped at 1.5)

Measured with **Measure each style**, using GPU timer queries, 3.5 s each:

| Measured | GPU mean | GPU p95 | CPU mean |
|---|---|---|---|
| Ink strokes | 0.07 ms | 0.07 ms | 0.17 ms |
| Ink bloom | 0.10 ms | 0.12 ms | 0.65 ms |
| Particle burst | 0.13 ms | 0.23 ms | 2.43 ms |
| Particle trail | 0.88 ms | 0.94 ms | 1.87 ms |
| Dot ripple | 0.98 ms | 1.07 ms | 0.50 ms |
| Glitch | 0.31 ms | 0.93 ms | 0.63 ms |
| Break-through on ink, firing every 0.45 s, alternating direction | 0.14 ms | 0.16 ms | 0.40 ms |

- **GPU:** everything is about 1 ms or less per frame. The break-through adds about 0.07 ms to the
  style under it.
- **CPU:** the automated tab was throttled to about 10 fps, so the CPU numbers include tab noise
  (they vary run to run). GPU timings don't depend on the frame rate.
- **Not measured with Isaac and MediaPipe running.** Check during the live test (`onStats`).
- **Startup:** one shader program per style, compiled in the background (`compileAsync`). The
  longest main-thread stall while the overlay starts is about 13 ms.

## Inspiration

These are our own shader versions of the user-picked studies on recent.design. No code, assets or
compositions were copied:
- Zach Lieberman's Wireframe Ink and Radial Brushstroke;
- A. J. Ortigo's Particle Burst and Particle Figure;
- Particle Face Illustration;
- Dot Field Motion;
- Martin Lorenz's Glitch Brush Study.

The break-through is our own extension of the style crossfade.
