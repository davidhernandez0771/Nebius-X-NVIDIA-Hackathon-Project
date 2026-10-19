# SANT site: overnight build brief (for a cloud Claude Code session)

**Look and behaviour = `docs/design/prototypes/site-journey.html`.** Open it first and copy its feel.
**Reference studio site = `docs/design/references/activetheory.md`.** Read it for the camera path, the filters, the tool-driven chat and the card-to-window move.
**Build on top of `pm/world-core`** (T5's r3f world: tiers, baked room, helix, plug sequence, rail). Don't start a new 3D stack.

## What to build, in order (commit after each step, tests at 0 failed)
1. **The opening as a station before the workshop** (`web/src/world/stations/intro/`):
   - the slash-cartridge loader driven by REAL asset progress (drei `useProgress` or the loader manager), not a fake timer;
   - the logo particles (mark + plumes) that fly up and become the roof lattice, plus the iridescent ring that becomes the skylight rim;
   - the story beats as DOM over the canvas, with the scramble reveal;
   - the dust.

   Port the shaders from the prototype as they are (they already cap point size).
2. **The spiral with a robot arm in the middle.** Reuse the instanced Helix and the label atlas. Scroll steps one cartridge at a time (snap), the arm turns toward the hovered cartridge, and hover lifts it and scrambles the title.
3. **Filters (bottom left, "What are you looking for?").** The tags are record / perfect / multiply / train / bring your robot / results. A filter slides the matching cartridges along the helix to the top slots, dims the rest and limits the scroll to them.
4. **Click → detail → plug in.** The camera closes in on the cartridge; the info block shows bottom-left with "scroll to close". PLUG IN runs the EXISTING plug sequence, then the projector-to-wall zoom (Blender shot: `docs/design/blender/W-anim-wall-projection-v1-0960-1110.mp4`), and the real Record page opens as the window.
5. **Ask SANT.** One tool registry on the client:
   - the tools: `go_to_section`, `show_cartridges_with_tag`, `open_cartridge`, `start_tutorial`;
   - the model (Nemotron through our existing backend) only picks tools plus a one-line reply;
   - if the backend is down, keep the prototype's keyword rules as the fallback;
   - show the tool call line like the prototype does.
6. **Accessibility and fallback:**
   - `prefers-reduced-motion` gives instant moves, no scramble and no RGB split;
   - keyboard: arrows/PageDown step, Esc closes;
   - no WebGL or `?q=static` gives the static page with the renders.

## Performance rules (the main point)
- **Tiers** (keep T5's `quality.ts` and extend it with these numbers):

  | Tier | DPR cap | Logo particles | Dust | Post | MSAA |
  |---|---|---|---|---|---|
  | Low | 1 | 18k | 4k | none | none |
  | High | 1.5 | 70k | 14k | bloom at half res + one final pass (RGB split on scroll velocity, grain, vignette) | 4× on the composer target |
  | Ultra | 2 | 140k | 28k | same as High | same as High |

- **Auto-tune:** after the intro, average 120 frames. Above 22 ms, drop a tier; below 9 ms on High, go to Ultra. Save the choice. The URL `?q=` overrides.
- **Point size is clamped in the shader** (5 px logo, 3.5 px dust, times DPR). Unclamped points near the camera stalled the prototype.
- **Draw calls ≤ 60** in the workshop: instanced shells and labels, two Points objects, baked room.
- **No shadow maps.** The lighting is baked; only moving parts are lit live.
- **Compile every shader during the loader** (`renderer.compileAsync`) so the first scroll never hitches.
- **Pause the render loop** when the tab is hidden; render on demand when nothing moves (r3f `frameloop="demand"` outside the journey).
- **First load:** under 3 MB before the first frame. The spiral, machine and baked room stream after the loader; the Record page is lazy.
- **Budget: 60 fps at High** on a mid laptop (Iris Xe / GTX 1650 class) at 1080p.

  **The cloud has no GPU:** it can only check that it builds, the tests pass and a software-rendered screenshot looks right. **Write a `PERF.md` checklist** with the exact steps to measure on the real PC in the morning: the HUD (backtick key), fps per tier at each journey stop, draw calls, and memory.

## Rules
- **Git:** work on a new branch from `pm/world-core`. Never touch `main` or `perfect-then-multiply`. One PR at the end; the user reviews and merges.
- **Never commit `.env`.** Use honest numbers only (they're in the prototype's `ITEMS`); mark anything pending as pending.
- **Look:** no NVIDIA green (#76B900), eye motif or "NV" letterforms. The logo mark is a placeholder until the user's symbol arrives; keep it swappable (one image → particle sampler).
- **End note:** finish with `docs/superpowers/notes/<date>-site-journey.md` covering what was built, what's left, the screenshots, and the PERF.md steps.
