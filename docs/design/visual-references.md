# SANT visual references (user-picked sources, curated by the lead, 2026-10-17)

These are inspiration only. Build our own versions: copy no one's code, assets or exact compositions. Credit inspiration in docs where it is fitting.

## Hand-art styles, one per action

The style changes on each action.

| Action | Style | Reference |
|---|---|---|
| Idle / hovering | **Ink along the bones**: brush strokes painted along the finger "edges", thick at the joints, dry-brush texture at the ends | Zach Lieberman, *Wireframe Ink* — https://recent.design/i/03vukqv-wireframe-ink-motion-study (**the user's own pick**) |
| Grab (close) | **Radial bloom**: ink strokes burst out of the palm from sparse to dense | Zach Lieberman, *Radial Brushstroke* — https://recent.design/i/ycasm0a-radial-brushstroke-motion-study |
| Release (open) | **Particle burst**: streaks shoot out from the fingertips | *Particle Burst* — https://recent.design/i/6lhc7lj-particle-burst-motion-study |
| Recording / moving | **Particle silhouette with a luminous trail** | *Particle Figure* — https://recent.design/i/oy4rlv2-particle-figure-descent ; *Particle Face Illustration* — https://recent.design/i/da4nn8v-particle-face-illustration |
| Paused / frozen (palm away) | **Rippling dot field**: calm, low energy | *Dot Field Motion* — https://recent.design/i/6tjky6l-dot-field-motion |
| Reset (✌️) | **Glitch brush**: black brush forms plus pixel fragments, then snap back | *Glitch Brush Study* — https://recent.design/i/5oevu47-glitch-brush-study |
| Depth hint (optional) | **Topographic contour lines** around the hand; more lines as it gets closer | *Topographic Lines* — https://recent.design/i/odkvopa-topographic-lines |
| Landing intro (optional) | **A swarm swirling into a hand**, then into the arm | *Cyanotype Fish Vortex* — https://recent.design/i/u2g5him-cyanotype-fish-vortex |

**Colors and contrast:** on the Volt (dark) app, the ink strokes are light (#E6EDF3 / teal #19F5C2 on black). Amber #FFB000 means "gripper closed".
- Keep the overlay readable over the webcam: use a slight darkened backdrop or a blend mode.
- Reduced motion: one static style.

## UI ideas for the app pages (Volt)

- **Tracking HUD on Record:** detector-style labeled boxes ("hand 0.97", "cube", "bin"), thin strokes and technical labels. Ref: *Object Detector Shader* — https://recent.design/i/n2vc3b4-object-detector-shader ; *Micrographics System* — https://recent.design/i/k6v39ws-micrographics-system
- **Pipeline status glyphs:** recorded → diagnosed → repaired → verified → failed/blocked, as animated rounded-square status icons. Ref: *Status Icon System* — https://recent.design/i/96z4z4r-status-icon-system
- **Counters:** the 7.5% → 42.5% count-up on tiles, and a dotted 3-2-1 countdown before recording starts. Ref: *CSS Count Up Animations* — https://recent.design/i/h0xhuv4-css-count-up-animations ; *Dotted Countdown* — https://recent.design/i/cqt5k5j-dotted-countdown
- **Dial HUD** for the gripper, reach and joint angles. Ref: *Rolling Dial Shader* — https://recent.design/i/8r9hgol-rolling-dial-shader
- **A "try a pinch" teaser on the landing page:** a small cloth or sheet you pinch and drag with the mouse (or hand) before entering the app. Ref: *Pinchable Fabric Sheet* — https://recent.design/i/4yuu0qi-pinchable-fabric-sheet

## User-picked references (2026-10-18)

### Tessel Poster Series (Roktimm, recent.design)

**What it is:**
- An X-ray illustration of a Trojan horse on textured, muted paper.
- A pink scan band crosses it, with labeled detection boxes ("SCRIPT 1/2/3") revealing what is hidden inside.
- Small monospace chat callouts: "You: Add …" / "Tessel · Review: I didn't. It hides 3 scripts…".

**Our use (Review page, plus one landing scroll beat, paper mode):**
- An X-ray-style robot arm/demo with a scan line sweeping the demo timeline.
- Detection boxes on the issues: PAUSE 1.4 s, GRIP OFF-CENTER, DROP RISK.
- A monospace verdict card: "Physics: worked · Matches your request: yes · Fixed: 2 issues".
- Fits Field Notes (light, editorial, textured).

### Grokipedia bookshelf UI (Benji Taylor, recent.design)

**What it is:** every article is a book spine on a shelf; the selected one tilts out and shows an illustrated cover.

**Our use:**
- **Dataset page:** each demo or variant is a spine, so 300 copies visibly fill a shelf. The selected one slides out with its card: thumbnail, ✅ verified, Nemotron label, copies.
- **"Bring your robot" gallery:** each robot is a spine.

## recent.design picks by page (2026-10-18, from the Interface and Web sections)

**Robot shelf / "My robots" + Dataset (the bookshelf the user wants):**
- Grokipedia bookshelf: https://recent.design/i/i3io5ld-grokipedia-book-covers
- Retro Resume Cartridges (each item a 3D NES cartridge): https://recent.design/i/5zhlkjw-retro-cartridge-cards
- WebGL Portfolio (3D cassette tapes as project cards): https://recent.design/i/68a8v4h-webgl-portfolio-explorer
- Stampstack (3D coverflow): https://recent.design/i/o7r25ux-stampstack
- Album Carousel UI: https://recent.design/i/x97ktju-album-carousel-ui
- Dither Helix Carousel: https://recent.design/i/lqf6134-dither-helix-carousel
- 3D Tornado Card Stream: https://recent.design/i/0h0clcf-3d-tornado-card-stream
- Framer Folders: https://recent.design/i/nr46ccm-framer-folders
- Expanding Card: https://recent.design/i/eoyvn9b-expanding-card-transitions
- Card Details Transition: https://recent.design/i/ayc72nk-card-details-microinteraction

**Robot setup (URDF upload + part roles):**
- Data Tree Component (part tree): https://recent.design/i/97iqamt-data-tree-component
- Node Connection Interaction (connecting parts to roles): https://recent.design/i/x2hewj5-node-connection-interaction
- Uploading Button: https://recent.design/i/7upeli1-uploading-button

**Record (live HUD):**
- Agentic Hand-Tracking: https://recent.design/i/9akeal7-ai-agent-hand-tracking-ui
- HUD Loading Screen: https://recent.design/i/3ymz32g-hud-loading-screen
- FUI Loading Animation: https://recent.design/i/nhoi2ht-fui-loading-animation
- Tachometer Component: https://recent.design/i/danf4d1-tachometer-react-component
- Pressure Monitor Interface: https://recent.design/i/ycdnfr7-pressure-monitor-interface
- Thinking Effort Dial: https://recent.design/i/xny36la-brain-effort-dial
- Live Audio Recorder UI (recording state): https://recent.design/i/b9n7kb1-live-audio-recorder-ui

**Review (check → fix → verdict):**
- Codex Code Review UI: https://recent.design/i/jl10434-codex-code-review-ui
- Boarding Pass Scanner (scan effect): https://recent.design/i/zuidimn-boarding-pass-scanner
- Human to Machine Transition (glitch morph raw → rendered: raw demo → perfected demo): https://recent.design/i/zpci603-human-to-machine-docs-transition
- Agent Status Component (pipeline states pill): https://recent.design/i/leos28t-agent-status-component
- Border Beam Effect: https://recent.design/i/rkouarq-border-beam-effect

**Pipeline progress / Results:**
- AI Task Progress Pills (training/multiply progress): https://recent.design/i/ds7ot78-ai-task-progress-pills
- Live Data Loading Animation (chart fills as data arrives): https://recent.design/i/tjp1zyb-live-data-loading-animation
- Visual Stepper Demo (step-by-step flow): https://recent.design/i/llz48sy-visual-stepper-demo
- Graph Markers: https://recent.design/i/o5zj037-aave-graph-markers
- ASCII Image Loader (sparse ASCII → photo): https://recent.design/i/igha6dd-ascii-image-loader-effect
- Workout in 3D (path replay over 3D, like a demo trajectory replay): https://recent.design/i/0w22k4n-workout-in-3d

**Landing page (Web section):**
- Vercel Store Shader (photo dissolving into a dot-matrix: demo dissolving into data): https://recent.design/i/oyqwazd-vercel-store-shader-effect
- Linear Animation Principle (slow hand + cursor swarm; maps to "one hand → many copies"): https://recent.design/i/jwc04f4-linear-animation-principle
- Dreamvision Hero (3D typewriter types itself): https://recent.design/i/mjy0sgn-dreamvision-typing-app-website
- OpenCode Reloaded (scrambled glitch → readable title, dark ↔ light: fits our story ↔ app power-on): https://recent.design/i/giax8gr-opencode-reloaded-light-mode
- Quartr Posters Web (editorial posters as pages): https://recent.design/i/olso2y8-quartr-poster-web-experience
- Corporate ID Features (dark minimal product landing): https://recent.design/i/361zrzn-corporate-id-landing-page
- Sam Cheng site (physics lanyard hero): https://recent.design/i/uugl3yv-sam-cheng-personal-site
- Krea Agent landing: https://recent.design/i/0ewrq4e-krea-agent-landing-page
- Profound Website: https://recent.design/i/q4fzfg0-profound-website-redesign

## Active Theory (https://activetheory.net/): ideas for the intro, transitions and nav

- **Loader:** glyph-text loading (rows of "////2///" characters resolving) instead of a spinner.
- **Hero:** a black void with drifting particle dust around a glowing glass emblem with a chromatic rim.
- **Scroll-reactive dust:** the dust changes color with scroll (teal/gold, then orange/red), and light beams cross behind the emblem.
- **Nav:** a minimal glass pill nav ("WORK —— CONTACT", joined by a thin line), plus an audio toggle.
- **Our use:**
  - the story → app **"power on"** transition: dust gathers into the SANT symbol, then the dark app UI appears;
  - the glyph loader while Isaac/MediaPipe start;
  - the pill nav on app pages.
