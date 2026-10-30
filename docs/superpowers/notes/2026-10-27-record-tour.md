# /record tour: what you're looking at (2026-10-27)

Branch `pm/record-tour` (worktree `C:\dev\pm-rectour`), from `pm/live-14` at 543170c. Not pushed.

The problem, in the user's words: "they go in and see the robot demo running and a bunch of stuff and they are not
going to know what they are looking at."

## What changed

1. **A six-card tour on /record** (`web/src/site/record/tour/`). Each card rings the real element:
   1. *Drive the robot from here*: the camera pane (input switch, Start).
   2. *This is the robot*: the twin's main view. It says that until you press Start, the robot plays an example (a demo SANT already verified), not you.
   3. *Three more views help you aim*: the side, top and ALIGN views.
   4. *Live readouts*: gripper_cmd, ee_target_z, ee_target_y, in plain words.
   5. *Record and stop*: the Record button, the clock, and the "recorded" counter (three rings).
   6. *Then Run SANT*: what the pipeline does with your demos, plus the one number (`LEAD` in `site/results/proofData.ts`).
   - It opens by itself once per browser, 1.9 s after the page draws in, and not if you're already driving. The key is `localStorage["sant.record.tour.seen"]`, and every access is in try/catch.
   - "? Tour", next to "? How to", replays it. Skip is on every card. Esc skips, ← → step.
   - While it's open, Esc and all four arrows belong to the tour; it takes them first, in the capture phase, so the arm doesn't move. Enter and Space on the card's own buttons press those buttons and nothing else, so no recording starts and the gripper doesn't toggle. When it closes, its listener goes away and every drive key works again.
   - At 390 px the card docks at the bottom, and the page scrolls the ringed element into view above it. While the tour is open, the page gets extra bottom padding so the last rows can scroll up.
   - With reduced motion, nothing slides or pulses.
   - It reuses the workshop guide's `placeCard` (`world/guide/guidePlace.ts`) unchanged, and mirrors the guide's look in the hologram's `--rg-*` tokens. The state module is a slimmed copy of `guideState.ts` without the room-view parts.
2. **The idle replay is labelled on the twin.** An amber tag reads "EXAMPLE · a verified demo replaying. Yours appears here when you Start." Once you've started but the sim isn't streaming yet, it ends "…once the simulator connects." The tag goes away when the twin goes live. The twin header's mode tag now reads "example" (amber) instead of "replay". The caption is now "example replay · verified demo s1_0004_…" (`robotTwin.ts`).
3. **Status chips have plain tooltips** (`CHIP_TIPS` in `RecordConsole.tsx`). For example, sim: "the Isaac Lab simulator runs the robot; not connected yet (no relay)". relay: "the link from this page to the SANT backend…". keyboard, mouse and hand each say what drives the arm.
4. **Run SANT now shows on phones.** Below 960 px, `.rg-steps` was `display: none`, a leftover from the removed S·A·N·T strip, so phones had no way on to /pipeline. Below 520 px, the camera pane header drops its "robot frame / mirror" tag to make room for "? Tour".

## Checks

- `npx vitest run`, run twice: 248 files passed both times (2172 tests, 1 skipped). `npx tsc -b` and `npm run build` pass.
- New tests:
  - `tour/RecordTour.test.tsx`: opens once, Skip, keys, the drive keys get through, focus, storage refusing.
  - `tour/tourSteps.test.ts`
  - `tour/tourClicks.test.ts`: the pointer-events rules.
  - Updated: `RecordConsole.test.tsx` (example tag, chip tooltips) and `robotTwin.test.ts`.
- Real input over CDP, SwiftShader headless Chrome, a fresh profile, no backend: `web/scripts/record-tour-clicks.mjs`. Every click uses `Input.dispatchMouseEvent` after an `elementFromPoint` check. 69/69 PASS at 1280×720 (and again with reduced motion); 75/75 PASS at 390×844, which adds a "docks at the bottom" check per card.
- Screenshots of each card are in `2026-10-27-record-tour/`, named `{1..6}-{id}-{1280x720|390x844}.png`, plus `7-closed-*.png`.

## Your checklist (about 2 minutes)

Use a private window, or clear `sant.record.tour.seen` in localStorage.

- [ ] Open /record. After the page draws in, card 1 rings the left pane.
- [ ] The robot twin has an amber **EXAMPLE** tag, and its header says "example".
- [ ] Click Next through all six cards. Each ring sits on the thing the card talks about. Card 5 rings Record, the clock and the counter.
- [ ] ← and → step, Esc closes. While a card is open, the arrows don't move anything.
- [ ] Reload: the tour doesn't come back by itself. "? Tour", next to "? How to", replays it.
- [ ] Press Start keyboard: W/A/S/D, R/F, Space and Enter all drive. Once the sim connects, the EXAMPLE tag goes and the header says "live".
- [ ] Hover the keyboard, relay and sim chips: each says what it is.
- [ ] On a phone, or at 390 px: the card docks at the bottom, the ringed thing scrolls into view above it, and Run SANT shows under the crumb.

## Open questions

- The EXAMPLE tag sits top right on the twin's main view. In the replay the arm sometimes passes under it. Bottom right, over the empty table, would need the front view's height from `twin/aids.ts`.
- At 390 px, card 1 rings the whole camera pane, which is taller than the screen. The docked card covers Start keyboard until you press Next.
- Should the HowTo strip also offer "Show me around"? Right now "? Tour" sits beside "? How to".
