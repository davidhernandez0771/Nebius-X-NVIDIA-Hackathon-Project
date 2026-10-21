# A real loading screen (`pm/real-loader`, 2026-10-20). Paused mid-task

Branched from `pm/live-12` at `309ee2e`, with `pm/hero-tesseract` at `0e02132` (T2's hero perf fix) merged in. Nothing
pushed. No new dependencies.

**Paused at the lead's request** (the user went to sleep). The work is committed and the tests are green, but the task
isn't finished: see "Half-done" and "Next" below.

## Done

**The loader holds until the first scene is truly ready**, with a bar driven by the real work, not a timer
(`stations/intro/progress.ts`, `Loader.tsx`):

| Step | What it waits for |
|---|---|
| engine | the 3D chunk arrived and the WebGL context is up |
| fonts | each face the hero, the beats and the wordmark use, counted as it loads (capped at 4 s each) |
| build | the tesseract and the dust made for the tier |
| shaders | every program compiled and linked, counted one by one (`compileSafe`'s new `onProgress`) |
| rooms | the later scenes built and compiled under the loader (below) |
| frames | 3 frames drawn back to back at a steady frame time (`frameGate`: within a third of the median of the last 3, judged against itself; it lets go after 12 frames whatever they were) |

The hero is built in code (the tesseract), so it fetches no files: its real costs are the engine, the type, the shaders
and the first frames.

**Visually:**
- the new SANT mark at the centre, its four parts lighting as the work gets done;
- a hairline bar (`transform` only, no layout);
- the share, and what it waits for now ("Compiling shaders 12 / 31", "Building the rooms 4 / 5");
- `role="progressbar"`, with the step in `aria-valuetext`.

**The lift:** the mark rises and dissolves as the black opens. With reduced motion it is a plain 0.25 s fade.

**The page is held still while loading:**
- `overflow: hidden` on the root, so no wheel, touch or keyboard scrolling;
- the world's chrome (brand, rail, Contact, HUD, skip link) waits behind the loader and comes in with the hero.

**The loader is mounted at the world's root**, not in the intro's overlay, so it also covers a visit that opens
elsewhere (a return lands in the workshop).

**A way on when it takes too long:**
- at 12 s it offers "Continue anyway" (in at what is ready) and "Use the 2D version" (the stills);
- if the 3D engine never even started by 30 s, it falls back to the stills by itself.

**The rooms (`core/rooms.ts`, `core/RoomBuild.tsx`).** Under the loader, after the hero's shaders:
1. It mounts every later scene whose files are already in (the forest and reactor, then the stations that have a scene),
   one at a time, out of sight.
2. Then it compiles everything once, every object shown for the compile, and uploads the textures.
3. Files still on their way get a 2 s grace.
4. A 6 s budget keeps the loader short on a slow device.
5. A room that never stands (its scene threw) counts as built after 8 s.

What isn't in by then is built after the reveal, one room per idle moment (`requestIdleCallback`), or at once when the
visitor reaches it.

**The background (`core/assets.ts`, `core/waiting.ts`):**
- **What it fetches:** the heavier stations' files, in the journey's order: the forest's crack and robots, then what
  the descent builds the workshop from, then the rest.
- **How:** two at a time, each file once.
- **Real bytes:** counted as they arrive, against the files' known sizes (`assetSizes.json`, from
  `scripts/asset-sizes.mjs`, checked against the files by a test).
- **Where they go:** finished files go into three's cache, so drei's `useGLTF` and GLTFLoader find them without a
  second download. The crack and the robot models fetch through it.

**Scrolled ahead of what has arrived (`ui/Wait.tsx`):** a small chip in the middle of the view, for example "Loading
the workshop 4.1 / 6.9 MB" with a bar.
- It shows after 250 ms, so a quick arrival never flashes.
- The visitor's station's files jump to the front of the queue.
- It lifts once the files are in and the scene stands.

## Measured

**Real GPU** (RTX 5080, headless d3d11, 1280×800 at 1.5×; `web/scripts/world-perf.mjs`'s new `MODE=reveal`).
The lead checked first, and Blender was idle (0 CPU, GPU 0–2%). 3 fresh loads per tier, holding the hero for 6 s after
the reveal:

| | Before (`0e02132`) | After (`pm/real-loader`) |
|---|---|---|
| Loader lets go | 1.0–1.2 s | 1.9–2.1 s |
| Worst frame in the 6 s after | 83–150 ms | 8.5–16.7 ms |
| Frames over 16.7 ms | 10–14 | 0–1 (the one at 16.7) |
| Stall (sum over 16.7 ms) | 400–533 ms | 0 ms |
| Long tasks | 5–7 (to 118 ms) | 0 |

That held on both high and ultra. On the GPU, the rooms step takes about 0.8 s.

**SwiftShader:**
- The loader lets go at 11.6 s at 1280×720 on high (27 s before the rooms budget).
- With every model download held 1.5 s and a jump to the workshop right after the reveal, the chip showed "Loading the
  workshop" at 4.1, then 5.3, then 5.8 / 6.9 MB, then lifted onto the room.
- SwiftShader can't judge the "no frame over 16 ms" target: every software frame is itself about 120 ms.

**Checks:** web tests 194 files, 1739 passed, 1 skipped; `tsc -b` clean.

**New tests:**
- `progress.test.ts` (the steps, counts, status, release, `frameGate`);
- `Loader.test.tsx` (the held scroll, the real value and text, letting go only when done, the 12 s choices, the
  stills fallback, reduced motion);
- `assets.test.ts`, `waiting.test.ts` (the sizes against the files), `rooms.test.ts`, `Wait.test.tsx`;
- `compileSafe`'s progress.

## Half-done (the next session)

1. **Screenshots for the note** aren't copied yet. The scratchpad has `ss-loading-0..3`, `ss-after-0`, `slow-wait-*`
   and `slow2-*`. Still to shoot: 1280×720 high, the 12 s choices, 390×844 phone, reduced motion.
2. **Not yet checked in the browser:**
   - the phone (390×844) and reduced motion with the new loader;
   - the "Continue anyway" and "Use the 2D version" buttons by hand (the unit tests cover them);
   - the low tier (where the forest skips the crack's model).
3. **The first scroll into each station** after the reveal isn't measured on the GPU: only the hero hold is. Its
   shaders are compiled under the loader, so it should be smooth.
4. **A temporary checkout of `0e02132`** sits in my scratchpad (`git worktree list` shows it) with a junction to
   `web/node_modules`. Remove it with `git worktree remove --force <path>` once the "before" numbers aren't needed.
5. **This branch hasn't been sent to T7.**

## Next step (exact)

1. Shoot the loader screenshots (high 1280×720, phone 390×844, reduced motion, the 12 s choices via a CPU-throttled
   run) into `2026-10-20-real-loader/`.
2. Run one GPU `MODE=reveal` scroll check through the stations.
3. Finish this note, commit, and tell T7 the commit.
