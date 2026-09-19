# Design brief

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

## Entry scene (after login)

Short (3-5 seconds), skippable, purely decorative, uses no user data. Reuse the landing scene's point cloud to solid transition so it feels like one system.

## Out of scope for the design pass

No light theme yet. No new colors. No custom fonts that need paid licenses.
