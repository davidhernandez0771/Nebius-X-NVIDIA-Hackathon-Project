# Design brief

**Product name: SANT.** Use it in the nav, the landing page, the browser title and the loader. Show it as plain wordmark text (no logo file exists yet); the wordmark is set in the landing serif display face, and stays uppercase.

One source of truth for the look and feel. Both the UI terminal and the 3D terminal follow this.

**Vibe in one line:** clean Apple-style restraint, with a real 3D room as the hero. Dark, warm, glassy, one accent color, calm motion.

Reference images live in `docs/inspo/` (smart-home dashboard shots). They are **style inspiration only**. Do not reuse their photos, faces, logos, text or exact layouts.

## Reference sites (for the landing page and motion)

- optiver.com: restrained corporate polish, confident type, scroll-linked reveals.
- animejs.com: playful but precise motion, timelines, scroll-linked animation.
- activetheory.net: immersive WebGL, camera moves and particles driven by scroll.

Take the *feel* (scroll-driven 3D that changes as you go), not their code or assets.

## Palette (approximated by eye from the references; tune in one place)

Define all of these as CSS variables in one tokens file. No hard-coded colors elsewhere.

| Token | Value | Use |
|---|---|---|
| `--bg-0` | `#0B0807` | page background base |
| `--bg-glow` | `#2A130A` to transparent | warm radial glow behind hero (top-left and bottom) |
| `--surface` | `rgba(255,255,255,0.045)` | glass cards |
| `--surface-border` | `rgba(255,255,255,0.09)` | 1px card outline |
| `--text` | `#F4F0EC` | primary text |
| `--text-muted` | `#8E837B` | secondary text |
| `--accent` | `#35F0D0` | the single brand accent: active tab, toggles on, primary buttons, "confirmed" |
| `--warm` | `#FF9A2E` | secondary: value bars, warnings, "unknown" |
| `--danger` | `#FF5A5F` | trash and destructive states |

Rule: **one accent.** Teal means "active / confirmed". Amber is for meters and "needs attention". Do not add more hues.

## Shape and material

- Cards: radius 24-28px, frosted glass (`backdrop-filter: blur(20px)`), 1px `--surface-border`, soft inner top highlight, no hard drop shadows.
- Icon tiles (sidebar, location picker): 56-64px rounded squares. Active tile filled `--accent` with dark icon; inactive tiles dark glass with a light outline icon.
- Toggles: pill switches, `--accent` when on.
- Meters: rows of small round dots (filled `--warm` or `--accent`, rest dim) instead of plain progress bars. Use for confidence scores and cost budget.
- Pills for status chips (`At home`-style): small, muted, one line.
- Type: system stack (`-apple-system, "SF Pro Display", Inter, system-ui`). Large light headings, small muted secondary lines, generous line spacing. Numbers in tabular figures.
- Spacing: generous. Prefer fewer things per screen.
- Motion: springy, short (150-350ms), ease-out. Respect `prefers-reduced-motion`.

## Layout pattern to reuse

Dashboard screens use **three zones**:
1. **Left rail:** vertical stack of icon tiles (rooms and locations: shelf, drawer, desk).
2. **Center hero:** the 3D scan of the room. Floating glass cards are pinned to 3D objects with thin connector lines (like the "Lightning / Music system / Vacuum" cards in the second reference).
3. **Right panel:** scrollable stack of glass cards (candidate items, inventory, proposals). Each card: icon or thumbnail, name, muted subline, and the control on the right.

Top bar: small avatar and title on the left, a glass status pill in the middle (use it for **Nebius spend, e.g. `$0.02 / $25`**), and the time or user on the right.

## How the reference maps to this app

| Reference element | In our app |
|---|---|
| Isometric 3D house | The user's GLB room scan, orbit-able, dark-tinted |
| Room icon tiles | Locations in the room (shelf, drawer, desk) |
| Floating device cards with connector lines | Candidate items pinned to where they were seen; tap to confirm |
| Toggle on each device | Three-way control per item: **organize / unknown / trash** |
| Dot-meter | Vision confidence, and cost vs budget |
| Temperature/humidity pill | Cost pill, plus scan status |
| Music-player bar | The **chat command bar**, docked at the bottom of the right panel |

## The design rule in the UI

The AI only proposes; the user or backend decides. So:
- Proposed items look **provisional** (dashed outline or dimmed) until confirmed, then become solid glass with the accent.
- Nothing the AI suggests ever looks like it already happened.
- Trash is a soft state (muted, with an Undo), never a hard-delete look.

## Landing page (scroll-driven 3D)

A single long page, dark, with a fixed 3D canvas behind the content. Scroll progress drives the camera and the scene. The scroll journey follows the product story:

1. **Hero:** a slowly rotating point cloud of a room (it *is* a LiDAR scan). Big calm headline and one button.
2. **Scan:** the point cloud resolves into a clean solid, glass-toned room.
3. **Photograph:** floating glass cards appear pinned to objects, with connector lines.
4. **Review:** cards flip through organize / unknown / trash states.
5. **Organize:** items glide into tidy positions on shelves.
6. **Chat:** a command bar types "send the lamp to trash" and the lamp fades out.
7. **Closing:** call to action.

Constraints: lazy-load the 3D code, keep the landing under a sensible size budget, add a static fallback for low-power devices and reduced motion, and keep text readable over the scene (contrast).

## What the three reference sites actually do (observed, and the landing page must use these)

Observed by loading each site and scrolling. Active Theory's 3D scene did not render fully in the test browser, so its notes come only from what was visible.

**animejs.com: the scroll structure to copy**
- **One hero object persists for the whole page** (a camera lens) and transforms as you scroll: it rotates, tilts and comes apart into an exploded view. The page is one continuous scene, not separate sections.
- **The background tone shifts between chapters** (charcoal to warm light grey), so the scroll feels like moving through spaces.
- **Thin leader lines with tiny monospace labels point at parts of the object**, like a technical diagram. This is the same idea as the connector-line cards in `docs/inspo`, so use one system for both: leader line + small mono label + glass card.
- A **small scrub bar** at the bottom-right shows scroll progress through the story.
- Each chapter is a short title plus one line of text. Nothing more.
- Tech under the hood: several canvases and a lot of inline SVG, plus its own scroll-observer animation.

**optiver.com: the typography and pacing to copy**
- **Very large serif display headlines** ("Where ideas become breakthroughs") over a small sans body. The serif/sans contrast is the whole personality.
- **One idea per screen**, generous empty space, deep navy background (`#021129`).
- **Paragraph text reveals word by word as you scroll**, with unread words dim and read words bright.
- **Floating translucent rounded squares drift in the hero** at different depths (parallax).
- **A glass pill navigation bar** (logo, search, Menu), floating over the content.
- No WebGL canvas at all. The polish is pure DOM, type and motion, so do not assume it needs heavy 3D.

**activetheory.net: the mood to copy**
- Near-black stage with **soft colored light blooms in the corners** rather than flat fills.
- **Tiny glass pill navigation** (WORK and CONTACT with a thin line between), with a faint glow along its edge.
- A **dotted circular loader with a `>>>` enter gesture** before the experience starts. Use this idea for the entry scene.
- Its real strength is immersive WebGL: camera moves and particle fields driven by the user's input. Aim for that feel in the hero point cloud.

**How this becomes our landing page**
- Landing type: a free serif display face (for example Instrument Serif or Fraunces from Google Fonts) for big headlines, the system sans for body, and a small free monospace (for example JetBrains Mono) for the leader-line labels. The dashboard itself keeps the system font.
- One persistent 3D room drives the whole scroll. It goes point cloud, then solid room, then exploded view with labelled parts, then items sorting into place.
- Background shifts between warm dark tones per chapter. One lighter "paper" chapter is optional, as long as the app palette still holds.
- Word-by-word text reveal on the big statements.
- Scroll progress scrub bar at the bottom-right, styled like the chat bar.
- A floating glass pill nav (logo, "Enter app").
- Loader with a dotted ring and `>>>` before the entry scene.
- Scroll-linked animation can use anime.js's scroll observer for DOM and three.js for the room. Keep them synced to one scroll value.

## Entry scene (after login)

Short (3-5 seconds), skippable, purely decorative, uses no user data. Reuse the landing scene's point cloud to solid transition so it feels like one system.

## Out of scope for the design pass

No light theme yet. No new colors. No custom fonts that need paid licenses.
