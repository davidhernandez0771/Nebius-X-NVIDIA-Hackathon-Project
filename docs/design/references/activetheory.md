# Reference: activetheory.net, a full walkthrough (2026-10-18)

I walked the whole site: load, idle, cursor moves, every scroll step from top to end, the filters, the chat box, a project page, contact and the Lab. The user's screenshots from the same session are in the chat. Nothing here is copied; it describes how the site works so SANT can build its own version.

## 1. The scroll is one camera path (Home → About → Work → Lab)
The page has no normal document scroll; `scrollHeight` equals the window height. The wheel drives one camera through four "views" (`Home`, `About`, `Work`, `Lab`), and the URL changes on the way (`/` → `/work` → `/`). Scrolling up plays everything in reverse. You never leave the 3D scene.

| Step | What you see | How it moves |
|---|---|---|
| **Loader** | Black screen, a tiny `//5` counter in the center; then a half dome made of `/` slash characters fills up while the counter climbs (`//60`) | ~6 s; nothing else on screen. Only the nav pill fades in at the end |
| **Logo reveal** | The chrome/iridescent logo ring on a long ribbon (a figure-8 loop) with a yellow-green particle cloud around its base; "SCROLL DOWN" above it in tiny mono caps | The logo **turns to face the cursor**; the ring's rainbow sheen shifts with the cursor angle. Jellyfish and bubbles drift by (underwater mood). A click on the logo fires an iridescent spark |
| **Scroll 1–4** | The camera orbits around the logo; the logo turns edge-on | Smooth, damped (the scroll is eased, never 1:1) |
| **Scroll 5–9** | The camera **dives down into the particle cloud**, which becomes a dense point-cloud forest (green → orange → white light pools) | Particles fill the whole screen; the colors change with depth |
| **About** | A **diagonal wipe**: a dark slab slides up over the forest, and behind it is a second scene: the logo, huge and glassy, spinning, with `CREATIVE DIGITAL EXPERIENCES` in a big mono font plus 3 short lines on the right | The headline **glitch-reveals** (letters scramble, then settle). The logo spins on its axis as you scroll |
| **Work** (`/work`) | A vertical **spine** (an iridescent sculpture) with **glass project cards** wrapped around it in a helix. Each card is a rounded glass slab playing a video, with the title in big mono letters. A filter list sits bottom-left: `WHAT ARE YOU LOOKING FOR?` `-> websites / installations / XR VR AI / multiplayer / games`, with an `ASK ME ANYTHING...` pill under it. Colored particle clouds (purple, pink, teal) around the spine | Each scroll step **rotates the helix** so the next card comes to the front. Fast scrolling smears the cards with an RGB-split, doubled-text glitch. Hovering a card tilts it toward the cursor and re-scrambles its title (`E.C.H.▯..` → `E.C.H.O.`) |
| **End of Work** | The spine dissolves into particles and **flies down into a reactor**: a steel cage with hanging cables; the particles gather into a sphere/torus inside it | This is the "machine" moment: everything you browsed gets pulled into the machine |
| **Lab** | The camera goes **through the reactor floor and a water surface** (seen from below, with caustics) to a **hex-tile video wall**: `// THE LAB ->`, a cross logo, one line of text | Hovering makes the hex tiles **bulge like a lens around the cursor**. A click opens their experiments site in the same tab |

## 2. Interactions, one by one
- **Nav pill** (top right): `WORK ——— CONTACT`, a dark glass capsule with a soft glow under it. When music plays, the line between the words becomes a moving waveform.
- **Music player:** `<< 2. Flint - Fly up High >>` appears under the nav once audio is on. Audio started after the first click on a filter.
- **Filters** (bottom left): click one and the spine **reshuffles to that category's cards**. The active item turns white and indents (`  -> games`). Clicking again steps to the next card in that category.
- **Ask me anything:** focusing the pill makes it brighter and slides in a privacy line above it. I did not send a question; it would go to their server.
  - **The important part:** the chat is an **AI agent whose tools drive the 3D scene**. They register it through `navigator.modelContext.registerTool` (WebMCP), with these tools:
    - `scroll_to_page_section` (top/about/work/lab);
    - `show_projects_with_tag`, `show_projects_by_permas`, `scroll_through_projects`;
    - `show_specific_project`, `search_projects_by_keywords`, `get_all_projects`;
    - `get_more_agency_info`, `open_contact_page`.

    So "show me your VR work" **physically moves the camera and reshuffles the cards**. The chat doesn't answer in text alone.
- **Project card click** (`/work/<slug>`): the card **grows to fill the screen**. The video becomes the background and the **mouse pans the camera inside it**. An info block sits bottom-left: title, `2014 / FOX / GAME`, one sentence, `PROJECT LINK`, `<- CLOSE`, with `SCROLL TO CLOSE` above. Scrolling shrinks it back into the helix.
- **Contact:**
  - The scene dims and blurs, and a full-screen overlay shows `✦ CONTACT US ✦` and `LAX → NYC → AMS` in huge thin mono letters, the email underlined, small social icons and links, and a QR code bottom-right.
  - The nav changes to `WORK ——— CLOSE ×`.
- **Cursor everywhere:** the logo, cards and hex wall react to it; nothing is static.

## 3. Look
- **Palette:** near-black blue-green (#05080b-ish) with a teal light leak in a top corner; iridescent chrome (thin-film rainbow) on the hero objects; particle colors change per section (yellow-green → green → orange → purple/pink → blue).
- **Type:** ONE squared mono display face, all caps, used huge for headlines and tiny (10–11 px, wide tracking) for UI. No serif.
- **Materials:** glass slabs (rounded, with an edge highlight and refraction), chrome, point clouds. Soft vignette and film grain on top.
- **Mood:** underwater/dreamlike: jellyfish, bubbles, caustics.

## 4. Tech hints
- Their own engine ("Hydra") on three.js, one 1.8 MB app bundle, one full-screen canvas at 1.5× resolution (2160×1350 for a 1440×900 window).
- I found no named GPU-tier code. The loader holds until the assets are in.

---

# What SANT takes from it (the user's direction)

| Active Theory | SANT version |
|---|---|
| Slash-character loader → the logo forms | A loader made of `/` (or tape-reel ticks) filling a cartridge outline with a %, then the **SANT symbol forms from particles** |
| The logo particles stay in the scene | **The logo's particles drift up and become the workshop ROOF/skylight**, still glowing over everything that follows (the user's idea) |
| Dive into the particle forest | Dive down through the stats ("one demo → 100", "17/40 → 20/40"): numbers made of particles that you fall through |
| Diagonal wipe → About headline | The story section: big mono headline glitch-reveal, the S·A·N·T steps |
| Spine with project cards in a helix | **Our cartridge SPIRAL**, with **a robot arm in the middle** instead of the spine (the Franka/SO-101 twin, slowly posing). The cartridges orbit it; scroll turns the helix |
| Filter list `-> games…` | `WHAT ARE YOU LOOKING FOR?` `-> record a demo / perfect it / multiply / train / bring your robot / results`. Each filter reshuffles the spiral to **the cartridges for that job** (the user: "specific cartridges for specific stuff") |
| Ask me anything agent with scene tools | **Ask SANT** (Nemotron): tools like `open_cartridge`, `show_cartridges_with_tag`, `go_to_section(story/workshop/machine/bench)`, `show_result(run)`, `start_tutorial`. The chat drives the camera |
| Card click grows to full screen | Cartridge click → it **plugs into the machine → the projector throws a hologram onto the wall → the camera flies into the wall → it becomes the work UI** (Record etc.). "Scroll to close" brings you back out |
| End of Work → the reactor | Our machine IS the reactor moment: the cartridge goes in, the light comes up |
| Lab hex wall, a lens bulge on hover | Optional end: the "Lab"/results wall with hover lens tiles (each tile is a sim run video) |
| Contact overlay | Team/credits overlay: `NEBIUS × NVIDIA HACKATHON`, repo link, the team |

**Keep from our own rules:** quality tiers plus a pre-rendered fallback, baked lighting for the static workshop, no NVIDIA green/eye, and the user's own symbol for the logo.
