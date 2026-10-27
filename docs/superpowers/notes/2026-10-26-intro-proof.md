# The proof in the story's scroll (`pm/site-nav-fix`, 2026-10-26)

The user asked for the proof in the scroll journey itself, with time and space for animated graphs, because judges
may never reach `/site/results`. This is on `pm/site-nav-fix` in `C:\dev\pm-site-nav`, on top of `7244c3c`. Nothing
was pushed and no dependencies were added.

## Where it sits

There is a new **proof** stage in the intro (`storyPlan.ts` `PLAN`), after the reactor's three beats
(S·A·N·T, the first result, Nemotron) and before the ring:

hero 1.2 → sink 1.5 → forest 1.9 → crack 1.5 → reactor 4.5 → **proof 7.2** → ring 1.1 (in viewport heights).

- **Length:** the intro grows from 11.7 to 18.9 viewport heights.
- **The stage:** four beats of **1.8 viewport heights** each, about 1,300 px of scroll each on a 720 px screen.
  Across each beat:

  | Share of the beat | What happens |
  |---|---|
  | 0–8% | the panel fades in |
  | 10–55% | the graph draws with the scroll (about 0.8 viewport) |
  | 55–90% | the graph holds, whole and fully shown (about 0.6 viewport), for the presenter to talk over |
  | last 10% | the panel fades out |

- **Behind the beats:** the reactor stays at full power and lit. The camera keeps circling the core slowly (30°
  over the stage, 1 m lower), and the power readout steps aside.
- **Scrolling back** undraws each graph. No timer is involved.

| # | Beat | Graph |
|---|---|---|
| 05 | **How SANT works:** "10 demos in. A tested robot out." | The five steps, lit one by one along a wire: record 10 demos (mouse), physics check in Isaac Lab, repair + multiply into verified copies, an RL teacher learns from those demos, distilled into a camera-only robot and tested once on 40 unseen scenes |
| 06 | **The proof:** "0/40 → 30/40" | The climb. Each bar grows in turn (raw 0/40, SANT 3/40, v1 15/40, v2 30/40) and its count counts up. Wilson whiskers, a goal mark at 60% (24/40), and the line "Each bar is its own pre-registered test, run once; v2 on fresh seeds." Links: **Watch the real test runs →** (`/test-track`) and **Every number, with its sources →** (`/site/results#proof`) |
| 07 | **Did the human demos matter?** | The teacher curve draws left to right: with demo starts 0, 10, 99, 109, 113 of 128 at iterations 300–1499; without, 0 throughout. A readout names the last checkpoint reached (never an in-between number) |
| 08 | **SANT checks the teacher too** | Two strips of 50 cells fill in seed order. **Uncapped** (median 1.73 m/s): 3/50, passing seeds 5303, 5308 and 5313 shown teal and the rest amber. **Capped** at 0.5 m/s, on fresh seeds: 50/50. A dashed pass mark sits at 45/50 |

**Every number comes from `site/results/proofData.ts`.** New there:
- `TEACHER_GATE`, cited to the distill pre-registration (lines 439–441, 451, 495, 546, 551) and to T3's gate note
  `2026-10-21-rl-teacher-gate.md` (lines 22, 25, 37, 76, 81, 105).
- `PROOF_NOTES.gate`.
- `CLIMB_FOOTNOTE_SHORT`.

The Results page's "first teacher was too fast" setback now builds its figure and text from `TEACHER_GATE`. Its
words are unchanged.

**One word changed in the old story:** the reactor's beat 03 ("3/40 → 17/40") was titled "03 / The proof". It is
now **"03 / First result · scripted demos"**, so it doesn't read as the same claim as 06 with different numbers. It
is the Results page's "earlier result, from scripted demos".

## How it's built

- **The beats:** `stations/intro/ProofBeats.tsx` (mounted inside `Story.tsx`).
- **The look:** `proofBeats.css`. The intro's mono uppercase type and teal hairlines, on a dim glass panel
  (`rgba(3,7,8,.84)`, corner ticks), in the Results band's colours: teal only for what matters, grey for context,
  amber only for failures. There is no backdrop blur: over the canvas that would be a full-screen pass every frame.
- **The motion:** `proofMotion.ts`, pure functions of the drawn share: steps lit, bars grown, the checkpoint
  reached, the cells filled.
- **The scroll:** `storyPlan.ts` (`proofBeatState`: shown and draw). `path.ts` holds the camera's drift.
- **Frame cost:** a few style writes per beat, only when its draw changes (transform, opacity, one clip-path, data
  attributes). No 3D was added.

**Accessibility:**
- Each beat is a `<section>` named by its kicker and heading, and Tab can reach it.
- **Focus brings the story to the beat.** Tab from the top goes Skip the intro → See the result → 05 → 06 → its
  two links → 07 → 08.
- **Each graph is a `<figure>`:**
  - named by a title;
  - described by a visible sentence that gives every number (`aria-describedby`);
  - backed by a visually hidden data table (the pipeline is a real `<ol>`);
  - with the drawing itself `aria-hidden`.
- **The beats stay in the accessibility tree** while the story is the current station, so a screen reader can read
  them without scrolling.
- **With reduced motion,** each graph is whole the moment its beat shows. The camera holds the hero as before.

**Navigation fix (found in Chrome):** at 720 px the descent now starts at 13608.000000000002 px. The browser's
whole-pixel scroll landed a hair short of it, so the rail's DESCENT left you on the Story's last frame.
`core/rail.ts` `locate` now counts a scroll within half a pixel short of a station's start as there, and
`rail.test.ts` has a test for it. Resume needed no change: it stores a share of the rail, and the rail is laid out
from the new length.

## Tests (written first; each new one failed before its code)

- **`storyPlan.test.ts`:**
  - the plan now includes the proof stage;
  - the four spans tile it;
  - one beat (story or proof) at a time;
  - each graph's draw is 0 at the start, only goes forward, and holds whole from 55% to 88%;
  - the beats play backwards;
  - the reactor stays full and lit with the ring resting.
- **`path.test.ts`:** the camera stays in the cavern through the proof and drifts slowly (under 1.5 m per viewport).
- **`proofMotion.test.ts`:** the steps, bars, checkpoints and cells.
- **`ProofBeats.test.tsx`** (the whole world, no WebGL):
  - four named beats, one at a time;
  - the pipeline, climb, curve and gate numbers come from `proofData`;
  - mid-scroll they are part drawn, whole in the hold, and undrawn again on the way back;
  - with reduced motion they are whole at once;
  - Tab focus brings each beat in;
  - the links;
  - the rail's Descent lands past the proof;
  - a reload mid-climb resumes on the climb;
  - Skip the intro still lands in the room;
  - the sources line.
- **`proofData.test.ts`:** `TEACHER_GATE` (its Wilson bounds against `wilson()` to 2 places, the seeds, both
  sources), the setback built from it, and the short footnote.
- **`rail.test.ts`:** the half-pixel snap.

## Checks

| Check | Result |
|---|---|
| `npx vitest run --maxWorkers=2 --minWorkers=1` | 230 files, **2033 passed, 1 skipped**, 0 failed |
| `npx tsc -b` | clean |
| `npm run build` | passes (the usual three.js chunk-size warning) |
| Chrome walks: headless, SwiftShader, `vite` dev on 127.0.0.1:5231 (stopped after) | No console errors. Only React Router's two future-flag warnings, as before. No horizontal scroll at 1280 or 390 |

## Screenshots (`2026-10-26-intro-proof/`)

| | Desktop 1280×720 (`?q=high`) | Phone 390×844 @2, touch (`?q=low`) |
|---|---|---|
| 05 pipeline, mid / done | `desk-1-pipeline-mid`, `-done` | `phone-1-…` |
| 06 climb, mid / done / scrolled back | `desk-2-climb-mid`, `-done`, `-scrolled-back` | `phone-2-…` |
| 07 teacher, mid / done | `desk-3-teacher-mid`, `-done` | `phone-3-…` |
| 08 gate, mid / done | `desk-4-gate-mid`, `-done` | `phone-4-…` |
| The ring after the proof (no panel) | `desk-5-ring-after-proof` | `phone-5-…` |
| Tab from the top lands on 05 (focus ring); three more Tabs land on 06's link | `desk-6-tab-to-pipeline`, `desk-6b-tab-on` | `phone-6…` |
| Rail DESCENT from the climb → the descent | `desk-7-rail-descent` | `phone-7-…` |
| Skip the intro from beat 08 → the room | `desk-8-skip-intro` | `phone-8-…` |
| Reload in the climb's hold → back on the climb | `desk-9-reload-mid-climb` | `phone-9-…` |
| Reduced motion: each graph whole just as its beat comes in | `reduced-1…4-*-just-in` (1280) | n/a |
| The stills (no 3D), every beat done | n/a | `stills-phone-1…4-*-done` |

## What the user can check by hand

1. **Scroll past Nemotron (04).** The core is at full power and a panel comes in: **05 How SANT works**.
   - Scroll slowly: the five steps light one by one along the wire.
   - Scroll back up: they go out again.
2. **06 The proof:**
   - the bars grow raw → SANT → v1 → v2, their counts climbing;
   - v2 (teal) crosses the dashed 60% goal;
   - the whiskers come in as each bar finishes;
   - the footnote reads "Each bar is its own pre-registered test, run once; v2 on fresh seeds.";
   - both links work (`/test-track`, `/site/results#proof`).
3. **07:** the teal line draws itself to 113/128 while the grey dashed one stays at 0. The readout under it names
   each checkpoint as the line reaches it.
4. **08:** the uncapped strip fills amber with three teal cells (3/50), then the capped strip fills all teal (50/50).
   The pass mark is at 45.
5. **Each beat holds whole for a while before the next.** Is the length right for talking over it? (See the
   questions.)
6. **The journey:**
   - **Tab from the top:** after "See the result", Tab jumps the story to 05, then 06 and its links, then 07, then 08.
   - **The rail:** DESCENT and WORKSHOP still land where they should.
   - **Skip the intro:** still lands in the room.
   - **A reload in the middle of a beat:** comes back to that beat.
7. **On a phone:** each panel sits under Contact and the tier chip, left of the rail's marks, with no sideways
   scroll. The steps stack.
8. **With Effects off (or the OS's reduced motion),** each graph is already whole when its beat comes in.

## Not verified

- **No real GPU.** Everything ran in SwiftShader (6–12 fps at high), so the frame budget on a real GPU wasn't
  measured. The beats add no 3D and write styles only when the scroll moves them.
- **No real screen reader** (NVDA, VoiceOver). The structure is tested in jsdom: names, descriptions, tables, focus.
- **The rail's MACHINE, WORKBENCH and ROBOTS from inside the proof** weren't walked. They go through the same
  `goTo` path the site-nav batch covered.
- **The 0.5 px snap in `rail.ts`** changes where every station boundary counts as reached, by under a pixel. The
  full suite passes.

## Questions for the user

1. **Length:** 1.8 viewport heights per beat (the intro is now 18.9 viewports). Longer, shorter, or should the hold
   be longer than the drawing?
2. **The old "3/40 → 17/40" beat (03),** now titled "First result · scripted demos": keep it, or drop it so the
   story's only numbers are the pre-registered climb?
3. **The tier chip** ("LOW · 50 FPS") sits over the top of the panels' area on a phone. The panels start below it.
   Should it be shown to visitors at all?
