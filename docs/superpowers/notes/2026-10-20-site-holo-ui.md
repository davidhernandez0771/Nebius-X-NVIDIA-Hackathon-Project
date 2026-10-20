# The room's tags as holograms, and a Contact entry point (`pm/site-holo-ui`, 2026-10-20)

Branched from `pm/live-11` at `2abc94e`; started as `pm/site-holo-carts` and renamed. The first brief (cartridge
holograms) was withdrawn before any code was written, so nothing from it exists. Nothing was pushed, merged or
rebased. No new dependencies. Not touched: the intro and descent, the robot wall, the Record page.

## 1. The hub tags are holograms

The room view's four tags ("01 The shelf", "02 The machine", "03 The bench", "04 The wall") were flat HTML cards. On
high and ultra they are now holograms projected from the objects (`stations/workshop/HubHolograms.tsx`, layout in
`holoTags.ts`).

**Each hologram:**
- a small emitter disc lying on its object, with a pulsing ring:
  - the bench's on its top behind the turntable;
  - the machine's on its top;
  - the wall's on the front edge of the top board;
  - the shelf's on the spiral's front;
- a thin cone of light, with rising streaks, from the emitter to the panel's lower edge;
- the panel itself:
  - smoked teal glass, turned square to the room view's camera so the text reads straight on;
  - scanlines, a glowing edge, a slow scan band and a faint flicker;
  - mouse-look gives it real parallax, since it stands in the scene.

**Readable text.** It is drawn into a canvas atlas at about 3× its screen size, mipmapped. Titles come out 15 px or
more on screen at 1280×720 (tested). Under each line of text the atlas carries a dark blurred halo. The bright Bone
cartridges behind the shelf panel are brighter than white in the HDR scene target, and without the halo they washed
its text out. For the same reason the glass is about 80% opaque, so the hologram reads as smoked glass rather than
clear glass.

**Hover and focus.** The tag's panel brightens and stutters back in (a third of a second of "materialize"). Entering
the room view materializes all four, one after another. A cartridge in the hand dims them (the drag still works:
04).

**Accessibility.** The HTML buttons stay: same names, same Tab order (shelf, machine, bench, wall: checked in the
browser), the same clicks. They are see-through, and every frame each one is laid exactly over its panel's box on
screen. Keyboard focus also draws a thin outline round the panel (02). Clicking a panel opens its branch: checked
with the bench.

**The fallback.** The HTML cards, exactly as before (same places, same look), in the stills, on the low tier, with
reduced motion, and below 700 px wide (`holoMode`, tested; 06, 07).

**Cost.**
- **One draw call for all four:** one indexed geometry (`buildHoloGeometry`, tested) and one premultiplied-alpha
  shader. The glass darkens what's behind it, and the light (text glow, edges, cones, emitters) adds, in one pass.
- **Hub on high: 54 → 55.** Within the brief's ≤ 60 budget; the cards it replaces cost nothing on the GPU.
- **Outside the room view it costs 0.**
- **Low (40) and reduced motion (54) are unchanged:** they draw the cards.

**Layout** (`holoTags.test.ts`). From the room view's camera at 1280×720, each panel:
- is 243–276 px wide (the cards were 240);
- sits under the hub bar, above Ask SANT and clear of the journey rail;
- overlaps no other panel;
- has its emitter on its own object.

## 2. The hub bar hint and Ask SANT stay HTML

**Why:**
- Neither stands on anything in the room. They are screen controls that follow the viewport, so there is nothing for
  a hologram to project from.
- Ask SANT is a real text input and must stay readable over anything behind it.
- A pseudo-hologram in CSS over the 3D would be a second visual language next to the real ones.

## 3. Contact

- **The entry point.** A quiet "Contact" button, top right in the brand's mono caps (on a phone it sits under the hub
  bar on the left, clear of the tier badge). It opens a small panel under itself (`world/ui/Contact.tsx`).
- **The links** come from one config file, `web/src/site/contact.ts` (`CONTACT_LINKS`, empty for now), and while it
  is empty the panel says "Links coming soon." Only `https://`, `http://` and `mailto:` links are listed (tested).
  They open in a new tab with `rel="noopener noreferrer"`.
- **Closing.** Escape, Close or a click outside closes it, and focus goes back to the button. Its Escape doesn't
  reach the world's (checked: the room view stays).
- **Where it shows.** It is in the world page only (`WorldRoot`), not the other routes; the Record page is untouched.

## Checks

| Check | Result |
|---|---|
| Tests first | `holoTags.test.ts`: 11 tests (where the tags stand, on screen at 1280×720, the one geometry, `holoMode`, hover and focus). `Contact.test.tsx`: 2 tests. All failed before the code. |
| `npm --prefix web test` | 162 files, **1445 passed**, 1 skipped, 0 failed (1433 on `2abc94e`). |
| `npx tsc -b` | Clean. |
| `npm --prefix web run build` | Passes; the only warning is the old >500 kB chunk notice. |

### In headless Chrome

**SwiftShader only:** the GPU is training (T4), so no real-GPU browser. The tier was forced with `?q=` (about
3 fps on high in software). The dev server ran inside the check script's own Node process and closed with it.

| What | Viewport and tier | Result |
|---|---|---|
| Holograms on | 1280×720, high | All four on. The buttons' boxes match the panels (e.g. the shelf 502,85, 243×139). |
| Hub draw calls | 1280×720, high | 55. |
| Tab order | 1280×720, high | Shelf > machine > bench > wall. |
| Focus and hover | 1280×720, high | The panel lights. |
| Clicking the bench panel | 1280×720, high | Opens the bench. |
| Drag to the machine | 1280×720, high | Machine opens; panels dim during the drag. |
| Contact | 1280×720, high | Opens and shows "Links coming soon."; Escape closes it; no sideways scroll. |
| Low, reduced motion, phone | 1280×720 low; 1280×720 high + reduced; 390×844 @3× low | HTML cards everywhere. Draw calls 40 (low) and 54 (reduced). Same Tab order. Contact placed clear of the hub bar and the tier badge. |

No console errors or exceptions in any run, apart from React Router's future-flag warnings.

## Screenshots (`2026-10-20-site-holo-ui/`, 1280×720)

| | |
|---|---|
| ![](2026-10-20-site-holo-ui/01-hub-holograms.jpg) 01 the room view: the four holograms | ![](2026-10-20-site-holo-ui/02-focus-machine.jpg) 02 keyboard focus on the machine |
| ![](2026-10-20-site-holo-ui/03-hover-bench.jpg) 03 hover on the bench | ![](2026-10-20-site-holo-ui/04-dimmed-while-dragging.jpg) 04 dimmed while a cartridge is in the hand |
| ![](2026-10-20-site-holo-ui/05-contact-open.jpg) 05 Contact open | ![](2026-10-20-site-holo-ui/06-low-tier-cards.jpg) 06 low tier: the HTML cards |
| ![](2026-10-20-site-holo-ui/07-reduced-motion-cards.jpg) 07 reduced motion: the HTML cards | |

## Not verified, or open

- **Real GPU, ultra, a person.** Nothing ran on the RTX 4060 (the GPU is busy training). The flicker, the scan band
  and the sharpness at 120 fps on ultra are unseen. Nobody has used it with a real mouse or a screen reader.
- **Translucency.** The glass is fairly opaque, for the text's sake over the bright cartridges. If the user wants
  clearer glass, lower `glassA` in `HubHolograms.tsx` and check the shelf panel's middle line.
- **Ultrawide screens.** The panels are sized for the room view at 16:9 and scale with the viewport; on very wide or
  very tall windows they keep the same place in the scene, not the same pixel size.
