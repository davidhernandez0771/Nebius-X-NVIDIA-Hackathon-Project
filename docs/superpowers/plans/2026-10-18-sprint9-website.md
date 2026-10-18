# Sprint 9: The SANT Website (Page Round 1)

Read by T1, T3, T5, T6 and T7. T2 and T4 are fixing the hand control in parallel; never edit their files.

**Global rules:**
- Own only your files, keep 0 failed (`npm --prefix web test`, `npm --prefix web run build`, `uv run pytest -q`), and commit after each task.
- Never push, merge or rebase.
- Skills: frontend-design (all UI), test-driven-development (pure logic), verification-before-completion.
- Make our own versions of the references; copy no one's code, assets or compositions.
- Respect reduced motion and the "Effects off" toggle.
- Never invent numbers: every number cites its note.

**First step for every terminal** (only after the user says the website-base PRs are merged):

```
git fetch origin
git switch -c <your branch> origin/perfect-then-multiply
```

Then confirm that `web/src/sant/` and `docs/design/content-spec.md` exist.

## The product (the new pitch; read it carefully)

Robots need huge amounts of demonstration data, and teleoperation doesn't scale. That is why Tesla (Optimus learns from videos of humans), Figure (Project Go-Big) and NVIDIA (GR00T-Mimic multiplies a few demos; GR00T-Dreams generates them) are racing to turn human video into robot training data. The known gap: video lacks the physics.

**SANT** (Simulate · Augment · Neaten · Train; tagline "Perfect, then multiply") turns a $0 webcam demo of a human hand into robot training data that is **checked in real physics** (NVIDIA Isaac Lab), fixed, multiplied, and labeled by NVIDIA Nemotron:
- **Physics** judges "does it work".
- **Nemotron** watches what you did and writes and validates the label.

**Proof so far** (scripted-expert source demos; human demos come next): the same 10 demos trained raw → **3/40**; plus 100 physics-verified copies → **17/40** (p = 0.0005); plus 300 copies → 16/40 (equal training steps). Notes: `docs/superpowers/notes/2026-10-15-t3-status.md`.

**"Bring your robot"** (coming next): upload a URDF, give parts roles (base / hand / gripper), run the same workflow, and get training data plus a robot report card (reach, success %, why it fails). Real example: OpenArm scored 0/30 because its wrist range is too small, a design flaw found in the simulator.

**The user flow:** **Show** (Record) → **Review** (physics + Nemotron verdict, fixes) → **Get** (dataset or trained robot + report card).

## The look (decided; memory "website-design-decisions")

- **Story pages** (landing, results) use **Field Notes**: light paper #F4F1EA, ink #111111, deep teal accent, Instrument Serif headlines.
- **App pages** (robots, record, review, dataset) use **Volt**: #07090C, text #E6EDF3, teal #19F5C2, amber #FFB000 for issues.
- Use T5's `web/src/sant/` tokens, components and shells. Don't fork them; ask T5 for additions via your note.
- **The logo is a symbol** the user will draw. Use the existing placeholder.
- **The user dislikes:** gimmicky over-interaction, cream + terracotta, Tachometer-style gauges, busy HUDs.

**References** (open them; full list in the scratchpad `visual-references-2026-10-17.md`):
- **Landing hero:** Linear "Animation Principle" (a slow hand plus a faster cursor swarm, i.e. one hand → many copies): https://recent.design/i/jwc04f4-linear-animation-principle ; Vercel Store shader (photo dissolving to a dot matrix, i.e. a demo becoming data): https://recent.design/i/oyqwazd-vercel-store-shader-effect
- **Robot shelf:** the Grokipedia bookshelf idea, rendered as a MIX of the WebGL cassette portfolio and Retro Resume Cartridges: https://recent.design/i/i3io5ld-grokipedia-book-covers , https://recent.design/i/68a8v4h-webgl-portfolio-explorer , https://recent.design/i/5zhlkjw-retro-cartridge-cards
- **Robot setup:** Data Tree Component https://recent.design/i/97iqamt-data-tree-component ; Node Connection https://recent.design/i/x2hewj5-node-connection-interaction
- **Record HUD:** Pressure Monitor https://recent.design/i/ycdnfr7-pressure-monitor-interface (liked). HUD Loading Screen https://recent.design/i/3ymz32g-hud-loading-screen only toned down. NO tachometer.
- **Review:** Human to Machine Transition (glitch morph raw → perfected) https://recent.design/i/zpci603-human-to-machine-docs-transition ; Codex Code Review UI https://recent.design/i/jl10434-codex-code-review-ui ; Tessel poster series (X-ray scan feel).
- **Results:** Live Data Loading Animation (the chart fills as data arrives) https://recent.design/i/tjp1zyb-live-data-loading-animation

## Ownership and tasks

To add a page's route, add ONE route line in `web/src/App.tsx` inside the SantRoot block; the lead resolves line conflicts.

### T1 (`C:\dev\pm-t1`, branch `pm/web-review`): new content spec, then Review

1. **Rewrite `docs/design/content-spec.md` for the new pitch** above:
   - sitemap: Landing, Results, My robots (+ Robot setup), Record, Review, Dataset;
   - each page's single job, sections, real copy, and every number with its source;
   - the landing scroll story: problem (with the companies) → how SANT works → proof → Bring your robot → CTA.

   **Commit this EARLY.** T5, T6 and T3 read it from `C:\dev\pm-t1`.
2. **Build Review** at `web/src/site/review/**` (Volt):
   - the raw → perfected demo as a glitch morph;
   - a code-review-style issue list with timestamps and the fixes applied;
   - a verdict card: "Physics: verified ✓" + "Nemotron label: …" + "Matches: yes/no";
   - an X-ray/scan feel.

   Read the existing data from `web/src/pm/review/**` (import, don't edit). Route `/review2` for now.

### T5 (`C:\dev\pm-fix`, branch `pm/web-landing`): Landing

**Build `web/src/site/landing/**`** (Field Notes, light):
- **Hero:** our own take on Linear's principle. A slow, heavy hand silhouette moves while a fast swarm of small robot-cursor marks follows and multiplies around it, i.e. "one demo → many copies".
- **Scroll story:** the beats from T1's spec. Use placeholder copy until it lands, then poll `C:\dev\pm-t1` every 15 min.
- **Proof beat:** the CountUp from the foundation: 7.5% → 42.5%, captioned "same 10 demos".
- **"Bring your robot" teaser:** link to the shelf.
- **CTA → Record:** with the dust "power on" into Volt.
- **The demo-becoming-data moment:** a Vercel-style dot-matrix dissolve.
- **Pinch-sheet teaser:** optional.

Route `/` stays the old landing for now; use `/site`. You own `web/src/sant/**`; others request additions through their notes.

### Approved blueprints (built by the lead with the user, in the repo after the base merge)

- **`docs/design/prototypes/robot-shelf.html`** (My robots), approved by the user:
  - **The HUD/preview on select is "absolutely perfect": keep it exactly.** That covers the darkened scene, the 3 tilted orbits with traveling dots, the title block, the frame, the crosshair "×" boxes, the `x: y:` coordinates, the light streaks, and the mosaic tiles in each robot's own palette and effect.
  - **Must be fixed:**
    1. **Cartridges intersect each other.** Make the spiral collision-free while keeping it "messy but controlled": compute each step's vertical gap from the tilts of it and its neighbor, and/or run an oriented-bounding-box overlap check at layout time and re-roll the offending jitter.
    2. **The key light is too strong** (blown-out white faces). Use a reference-like exposure: thin edge highlights, small glow orbs, readable labels.
- **`docs/design/prototypes/record-console.html`** (Record): the instrument-rack layout after the Pressure Monitor reference, approved as the direction.
- **`docs/design/visual-references.md`:** every reference link and what to take from each.

### T6 (`C:\dev\pm-t6`, branch `pm/web-robots`): My robots shelf

**PRIMARY:** rebuild `docs/design/prototypes/robot-shelf.html` as production React + react-three-fiber at `/robots`. Match it visually, apply the two fixes above, and keep the HUD exactly. That replaces the "3D shelf" description below wherever they differ.

**Build `web/src/site/robots/**`** (Volt):
- A 3D shelf (three.js / react-three-fiber) where each robot is a cassette/cartridge hybrid (the WebGL portfolio + retro cartridges mix):
  - a label with the robot's name;
  - a status sticker (Ready / Tested / Design flaw found);
  - picking one slides it out into an expanding detail card.
- **Data** in `robots.json`, with real numbers and their sources (T2/T3 notes):
  - **Franka:** our main robot, multiply 30/30, the 3/40 → 17/40 policy;
  - **OpenArm:** 0/30, wrist range;
  - **Flexiv Rizon 4s:** 9/30, the gripper drag finding;
  - **SO-101, PiPER:** "coming next", from memory "open-robot-arm-catalog".
- **An "Add your robot" slot:** a cartridge with "+", which opens a placeholder Setup page showing a part-tree UI (Data Tree / Node Connection references) with fake parts, clearly marked "preview".

Route `/robots`. Performance: cap DPR, low poly; reduced motion = a 2D shelf.

### T3 (`C:\dev\pm-t3`, branch `pm/web-results`): Results / report card

**Build `web/src/site/results/**`** (Field Notes):
- The headline counter 3/40 → 17/40 with Wilson CIs.
- **The "how many copies" chart:** 0 → 100 → 300 copies, with the honest plateau and its caveat (equal steps, so 300 got fewer epochs).
- **The live-data feel:** the chart draws as values "arrive".
- **A report-card panel template:** success %, failure reasons (drops 22/23), reach.

Data from the existing `/results` API or `results.json` via T1's builder. Every number cites its note. Route `/site/results`.

### T7 (`C:\dev\pm-t7`, branch `pm/web-record-hud`): Record HUD pieces

**PRIMARY:** build the instrument-rack tiles from `docs/design/prototypes/record-console.html`:
- `palm_xy` pad, `gripper_cmd` knob, the wide `ee_target_z` trace tile, and the small channel tiles;
- the top bar with the record button and timer;
- reusable components fed by props, matching the prototype's look.

**Build `web/src/site/record-hud/**`** (Volt): presentational components fed by props, so T4 can mount them later.
- Pressure-monitor-style gauges for grip (pinch), height and reach.
- A recording state pill with time.
- Status chips: sim connected, tracking, verified.
- A TONED-DOWN loader for "starting simulator" (thin, quiet, no weapon-HUD clutter).
- **No tachometer.**

Preview route `/site/record-hud`, fed with a recorded fixture.
- **Do NOT edit** `web/src/pm/record/**`, `web/src/teleop/**` or `web/src/pm/handArt/**` (T4 owns them).
- **Hand art:** waits until the user sends Poet Engineer references.

## Order

1. The user merges the 3 website-base PRs.
2. T1 commits the spec early.
3. Everyone builds in parallel.
4. The lead trial-merges, then you review on `/site`, `/robots`, `/review2`, `/site/results` and `/site/record-hud`.
