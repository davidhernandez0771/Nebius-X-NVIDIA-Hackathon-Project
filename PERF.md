# PERF.md: measuring `/world` on the real PC

The cloud session that built the site journey has no GPU. Everything it measured ran in SwiftShader
(software WebGL), where every tier runs at 1–5 fps, so **none of its frame rates mean anything**. It
did measure the things a software renderer gets right: draw calls, triangles, points and bytes loaded.
This checklist gets the real numbers. Budget (docs/design/site-build-brief.md): **60 fps at High** on
a mid laptop (Iris Xe / GTX 1650 class) at 1080p.

## 0. Before you start

- [ ] **Laptops with two GPUs (e.g. an RTX 4060 plus integrated graphics):** make Chrome use the RTX.
  1. Open Windows Settings → System → Display → Graphics.
  2. Find Chrome (Browse to `chrome.exe` if it isn't listed).
  3. Set it to **High performance**, then restart Chrome.
  4. Check the HUD's `gpu` line: it should name the NVIDIA GPU, not Intel or AMD integrated graphics.

- [ ] Nothing else on the GPU: close Isaac Sim, and check that nobody holds `C:\dev\gpu.lock`.
- [ ] Plug the laptop in and set Windows to "Best performance".
- [ ] Use a 1920×1080 browser window at 100% zoom (or F11 full screen on a 1080p panel).
- [ ] Run the production build, not the dev server:
  ```
  npm --prefix web ci
  npm --prefix web run build
  npm --prefix web run preview -- --port 4186
  ```
  To use the per-part measurement in step 6, run the dev server instead
  (`npm --prefix web run dev -- --port 5186`). The script reads a dev-only hook.
- [ ] Clear the tier the auto-tune saved. In DevTools → Application → Local Storage, delete
  `world.tier`, or run `localStorage.removeItem("world.tier")` in the console.

## 1. The HUD

- Open `http://localhost:4186/world?hud`, or press **`** (backtick) at any time.
- The HUD shows:

  | Line | Meaning |
  |---|---|
  | tier | the tier in use; `(url)` when `?q=` forced it; `auto → x` once the auto-tune decided |
  | fps | frames per second over the last 0.25 s |
  | dpr | the canvas pixel ratio, and the live scale. The tier caps the ratio (low 1, high 1.5, ultra 2) and a pixel budget holds it (1.3 / 2.6 / 3.7 MP). The scale drops to 0.6 while frames run slow; if it sits below 1, the GPU is struggling there. |
  | calls / tris / points | the last frame, every pass included (scene, bloom, final pass) |
  | particles | logo plus dust points for the tier |
  | post | `bloom ½ + final, msaa 4x` on high and ultra, `none` on low |
  | textures / geometry / programs | GPU memory objects and compiled shader programs |
  | heap | the JS heap in MB (Chrome only) |
  | gpu | the renderer string. **Check that it names the real GPU, not "SwiftShader" or "Microsoft Basic".** |
  | at | the station, and the scroll position in viewport heights (vh) |

- The pill at the bottom right shows `tier · fps`. Clicking it steps through low → high → ultra and
  saves the choice.
- The fps only moves while something animates. The canvas renders on demand, and on low nothing
  animates by itself. To read fps on low, scroll slowly, or use the Performance panel (step 5).

## 2. FPS per tier at each journey stop

For each tier, open `/world?q=low`, then `/world?q=high`, then `/world?q=ultra` (with `?hud`, e.g.
`/world?q=high&hud`). `?q=` turns the auto-tune off.

- Scroll to each stop below. To jump straight there, run
  `scrollTo(0, innerHeight * VH)` in the console.
- At each stop, wait 3 s and note the fps, calls and points. Then move the mouse in small circles for
  5 s (the logo, the hover and the arm all react) and note the lowest fps.

| Stop | VH | What should be on screen | low fps | high fps | ultra fps | calls (high) |
|---|---|---|---|---|---|---|
| Logo | 0 | the loader, then the mark and plumes in front of the ring | | | | |
| Beat 2 | 1.6 | "CHECKED BY PHYSICS.", particles arcing up | | | | |
| Stats | 4.3 | 3/40 → 17/40, 40/40 over the skylight, the roof lattice below | | | | |
| The dive | 6.05 | the frame closing to dark with particles streaming, then opening in the room | | | | |
| Spiral, step 0 | 7.3 | RECORD at the front, the dock bottom left | | | | |
| Spiral, step 12 | 10.9 | ACT 30K at the front | | | | |
| Spiral, step 23 | 14.2 | 59 / 60 at the front | | | | |
| Machine, plug in | 15.8 | the cartridge seats, the slot flashes | | | | |
| Projection | 16.6 | the beam, the wireframe arm, the Record screen | | | | |
| Zoom end | 17.9 | the Record screen fills the view (Record opens) | | | | |

- [ ] **Scroll stress, on high:** go to 7.3, then spin the mouse wheel down hard through all 24 steps
  and back up. Note the lowest fps, and whether a step was skipped or a frame hitched. The RGB split
  should flare while you move and settle when you stop.
- [ ] **Filter:** at 7.3, click `-> results`. The four cartridges slide to the top. Note the lowest fps
  while they slide.
- [ ] **Detail:** click a cartridge. Note the fps during the camera move in. Click **Plug in →** and
  note the fps through the plug-in, the glide and the zoom, until Record opens.

Pass: high stays at **60 fps or more at every stop** on the Iris Xe / GTX 1650 class machine, and
the scroll stress never drops under 50.

## 3. The auto-tune

- [ ] Clear `world.tier` (step 0), then open `/world?hud` with no `?q=`. The tier starts from the GPU
  check: high on a normal GPU, ultra on a discrete one with 8+ cores.
- [ ] Let the loader finish and the logo gather. About 2.4 s later the tune counts 120 frames, and the
  HUD's tier line then reads `auto → <tier>`. Note the result.
- [ ] Reload. The saved tier is used straight away and the tune doesn't run again: the line shows
  no `auto`.
- [ ] Known limit: the tune measures time between frames, and a 60 Hz display caps that at 16.7 ms.
  So "below 9 ms on high → ultra" only happens on a 120 Hz+ display. On 60 Hz, set ultra with the
  pill or `?q=ultra`, check its fps here, and write it down.
- [ ] To force a drop, throttle the GPU: open a heavy WebGL tab next to it, or on a laptop switch to
  the integrated GPU. The HUD should go high → low after about 2 s of slow frames.

## 4. Draw calls

The budget is **60 or fewer** in the workshop. The cloud measured the "calls" line at 7.3 vh, step 0.
Those numbers are the same on any GPU; recheck them:

| Tier | Measured in the cloud | Real PC |
|---|---|---|
| low (no post) | 34 | |
| high (post: RenderPass + bloom's 12 + final) | 47 | |
| ultra (adds the haze's 3 shafts) | ~50 (not measured separately) | |

## 5. Memory

- [ ] **HUD, at the spiral:** note heap, textures, geometry and programs. Cloud, high: heap about
  55 MB, textures 23, geometries 81, programs 56.
- [ ] **Task Manager (Shift+Esc in Chrome):** note the tab's "GPU memory" at the logo and at the
  spiral, per tier.
- [ ] **Leak check:**
  1. At the spiral, take a heap snapshot (DevTools → Memory).
  2. Open the detail view, plug in, let Record open, press Back, and scroll back to the spiral.
     Do this 3 times.
  3. Take a second snapshot.

  The heap should be within about 10 MB of the first snapshot. The WebGL context should also be
  lost when Record opens (the console logs "Context Lost"); that frees the GPU for Isaac Sim.
- [ ] **Hidden tab:** switch tabs for 10 s and come back. In the Performance panel, no frames should
  be recorded while the tab was hidden.

## 6. Optional: the existing scripted measurement

`web/scripts/world-perf.mjs` drives headless Chrome on the real GPU. Read the header of the script
for the modes. Run it against the dev server:

```
node web/scripts/world-perf.mjs http://localhost:5186 perf.json
```

`TIERS=low,high,ultra` gives GPU time per tier; `MODE=parts` gives the cost per part. Note that
`?quality=` there means the same as `?q=`.

## 7. First load

The cloud measured the production build (`vite preview`, SwiftShader), counting the response bodies
until the loader finished:

- **1.66 MB before the first frame:**
  - the app (441 KB);
  - three, r3f and drei (815 KB);
  - the world chunks (121 + 23 + 73 KB);
  - CSS (69 KB);
  - fonts;
  - the mark.
- **4.1 MB streamed after it:** the nine GLBs.

Budget: under 3 MB. To check on the real PC:

- [ ] DevTools → Network, "Disable cache", throttling "Fast 4G". Reload `/world?q=high`.
- [ ] Note the transferred size and the time when the loader's counter reads //100.
- [ ] Note when the workshop's lamps come on: the last GLB has arrived.

## Write the results

- Add the filled tables to `docs/superpowers/notes/2026-10-19-site-journey.md`, under "Measured on
  the real PC".
- If high misses 60 fps somewhere, note the stop and the HUD numbers there.
- If a tier's default is wrong, the numbers to change are in `web/src/world/core/quality.ts`
  (`TIERS`) and `web/src/world/core/autotune.ts` (`TUNE`).
