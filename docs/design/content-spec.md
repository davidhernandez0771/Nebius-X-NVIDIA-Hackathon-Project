# SANT website: content and story spec

- **Owner:** T1 (sprint 8). Docs only; T5 builds the design system and shells, and the page round builds
  the pages from this spec.
- **Written:** 2026-10-17, at `8572b6e` (`origin/perfect-then-multiply`).
- **Decisions this spec follows** (the user's, from the sprint 8 plan):
  - **Name:** SANT, Simulate · Augment · Neaten · Train. **Tagline:** "Perfect, then multiply".
  - **"Combo 2, split by page"** (from the moodboard):
    - Story pages (Home, Results, About) are **Field Notes** (paper).
    - App pages (Record, Review, Dataset) are **Volt** (dark).
    - Crossing from story to app "powers on".
- **Updated 2026-10-17** with the lead's visual references (`refs`, below):
  - the new UI pieces are in [§11](#11-new-ui-pieces-from-the-visual-references);
  - the six hand-art states are in [§12](#12-hand-art-six-states);
  - what everything looks like with motion off is in [§13](#13-motion-off-everything-in-one-table).
  - The logo is now a **symbol**, not letters (`logo-brief.md`).
  - The references add **no measurements**. Every number below still comes from the fact registry.

## 0. How to read this spec

**Every number on the site comes from the [fact registry](#1-fact-registry).** Each fact has an ID (e.g.
`R2`), the exact wording to use, and its source as `note:line`. A page section lists the IDs it shows. If a
number is not in the registry, it does not go on the site. Add it here first, with its source.

**Source abbreviations.** Line numbers are at `8572b6e`. The notes are append-only, so these lines should
stay valid; re-check them with `git blame` if a note is ever edited.

| short | file |
|---|---|
| `t1` / `t2` / `t3` / `t4` | `docs/superpowers/notes/2026-10-15-t<N>-status.md` |
| `vl` | `docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md` |
| `roles` | `docs/superpowers/notes/2026-10-16-nemotron-roles.md` |
| `web` | `docs/superpowers/notes/2026-10-16-web-pages.md` |
| `power` | `docs/superpowers/notes/2026-10-17-power.md` |
| `audit` | `docs/superpowers/notes/2026-10-17-claims-audit.md` |
| `spec` | `docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md` |
| `plan8` | the lead's sprint 8 plan (`sprint8-plan.md`, not in the repo; design decisions only, no measurements) |
| `refs` | the lead's visual references, 2026-10-17 (`visual-references-2026-10-17.md`, not in the repo; inspiration only, no measurements) |

**Wording rules** (these apply on every page):
1. **Quote the confirmatory result:** 3/40 vs 17/40 on the 40 fresh scenes (R1–R3).
   - Never lead with the pooled 4/60 vs 24/60 (R4). If it appears at all, give its selection caveat with it.
2. **Never say "perfected + multiplied" about 17/40.** That arm was raw + multiplied. The 10 sources were
   scripted-expert demos that were already clean, so no repair ran (R10, C3).
   - The moodboard's "17/40 perfected + multiplied" pane is placeholder copy. Do not reuse it.
3. **Never call the 10 source demos "human" or "webcam" demos.** They came from a scripted expert (R10).
   - The "human" demos in the GIFs are synthetic: the scripted expert with noise added (V4).
4. **Never write "multiplying is proven" or "always helps".** Use T3's suggested wording (R14), or the short
   form in [Beat 3](#beat-3--proof).
5. **Every page that shows the result also shows its limits,** at least C1–C4, in the same viewport or one
   click away. Never put them in a footnote only.
6. **Nemotron:** say what was measured (N1–N7). Never say it "diagnoses" or "judges" demos in the shipped
   pipeline: code won that test (N1).
7. **Vendor estimates are labelled as such** (P1–P3). They are not our measurements.
8. **No "first" claims** (spec:104-109). "To our knowledge" stays wherever the claim sentence appears.
9. **Rounding:** show k/n with every rate (3/40, not just 7.5%), and round CIs to whole percents only in
   tight spots (R1/R2 give both forms).
10. **A pending result says "pending",** never 0 and never a projection.

**Placeholder copy in the moodboard that must not ship.** It was illustration, not data:
- "verified ×200";
- "One demo in. Two hundred verified demos out.";
- "a grid of 200";
- "Demo 0004 · 13.8 s → 9.3 s · pause 1.4 s". The 13.8 → 9.3 s demo is `s1_0002`, not 0004 (V1), and no
  "1.4 s" pause is in any note;
- "17/40 perfected + multiplied".

The largest verified multiplied set is 300 variants from 10 sources (Y2), not 200 from 1.

## 1. Fact registry

### Problem (vendor estimates, not ours)

| ID | Wording on the site | Source |
|---|---|---|
| P1 | Teleoperation rigs cost $6k–$80k (vendor estimate) | spec:33 |
| P2 | Operators cost $25–$50 an hour (vendor estimate) | spec:34 |
| P3 | 20–30% of demos are discarded (vendor estimate) | spec:35 |

### The headline result (T3, sprint 7)

| ID | Wording on the site | Source |
|---|---|---|
| R1 | The 10 demos alone: **3/40 (7.5%)**, 95% CI 2.6–19.9% (short: 3–20%) | t3:1156 (short form: t3:1172) |
| R2 | The 10 demos + 100 multiplied, physics-verified variants: **17/40 (42.5%)**, 95% CI 28.5–57.8% (short: 28–58%) | t3:1156 (short form: t3:1171-1172) |
| R3 | Fisher exact **p = 0.0005** (two-sided; 0.00055 in T3's table, 0.000549 in T1's recount). Short form: "p < 0.001" | t3:1156; t1:2090-2095; t3:1172 |
| R4 | Pooled over all 60 scenes: 4/60 vs 24/60, p = 2.2 × 10⁻⁵. **Optimistic:** includes the 20 scenes used to choose the pair | t3:1157 |
| R5 | The 40 scenes (seeds 5020–5059) were run after the pair was chosen and never used to choose anything. The run stopped at a pre-set time (13:00), not on the result, and nobody looked at p between blocks | t3:1060-1069, 1143, 1145-1146, 1156 |
| R6 | Both policies: ACT, 30k training steps each. **Equal steps, not equal epochs:** ~49 passes over the data for raw vs ~4.5 for multiplied | t3:1080-1081, 1167 |
| R7 | The confidence intervals don't overlap | t3:1161 |
| R8 | Even after a ×4 correction for the sprint's earlier looks, p ≈ 0.002 | t3:1163-1164 |
| R9 | The multiplied policy's main failure is dropping the cube: 22 of its 23 failures | t3:1176-1177 |
| R10 | The 10 source demos came from a **scripted expert** (no human, no noise), all starting from one home pose | t2:897; t3:907 |
| R11 | Multiplied training set: 10 sources + 100 variants, 53,170 frames (raw: 4,886 frames) | t3:907-908 |
| R12 | Earlier, smaller runs, none significant alone: 2/20 vs 3/20 (10 demos, 10k steps, p = 1.0); 1/20 vs 5/20 (5 demos, 10k steps, p = 0.18); 1/20 vs 7/20 (10 demos, 30k steps, n = 20, p = 0.044, the pair later extended) | t3:907-908, 914; t3:1041, 1188-1189; t3:1071, 1095-1096 |
| R13 | The first policies (sprint 3) scored 0/20 on unseen scenes; the 0 was too little data, not a bug | t3:725; t3:801 |
| R14 | T3's suggested sentence: "on 40 held-out home-start scenes, ACT trained on 10 demos + 100 multiplied variants succeeded 17/40 (43%, 95% CI 28–58%) vs 3/40 (8%, 3–20%) for the 10 demos alone (Fisher p < 0.001); one training run per cell, 30k steps each." | t3:1171-1173 |
| R15 | Multiplying moved the failure later: from "doesn't get the cube" to "gets it, sometimes loses it" | t3:1181 |

### Caveats (shown wherever R1–R3 are)

| ID | Wording on the site | Source |
|---|---|---|
| C1 | One task (a 5 cm cube into a bin), one simulated arm (Franka), one policy type (ACT), **one training run per arm** | t3:1165-1166; spec:62 |
| C2 | Equal steps, not equal epochs (R6) | t3:1167 |
| C3 | No human demos yet, and no repair: the sources were already-clean scripted demos, so this tests **multiplying**, not perfecting | t2:897; README.md:54-56 |
| C4 | It still drops the cube (R9) | t3:1176 |
| C5 | Whether perfecting noisy human demos first adds more is not measured yet | README.md:55-56; audit:125 |

### Yield and verification

| ID | Wording on the site | Source |
|---|---|---|
| Y1 | The training set multiplied **100/100**: 10 sources × 10 variants, every one verified in physics | t2:892, 898 |
| Y2 | A bigger set: **300/300** variants verified (10 sources × 30), 144,964 frames | t2:1109, 1119 |
| Y3 | Clean-expert multiply: 30/30 (it was 27/30 before a handover fix) | t2:639-640 |
| Y4 | Degraded and perfected demos multiplied: 75/75 (it was 34/75 before the fix) | t2:728 |
| Y5 | 50 of 50 scripted test demos verify in Isaac Lab | t2:316 |
| Y6 | MimicGen publishes 38–74% for this step. **Context, not a like-for-like comparison:** our task is easier (one 5 cm cube, a large open bin, a top-down grasp) | spec:53; t2:252-253 |
| Y7 | Every episode starts from the same home pose (first-frame joint spread ≤ 0.0002 rad) | t2:915 |

### Perfecting (the GIFs)

| ID | Wording on the site | Source |
|---|---|---|
| V1 | One demo before and after repair: **13.8 s → 9.3 s**, both replays succeeded (`s1_0002`) | t1:1500 |
| V2 | A second demo: 10.6 s → 7.8 s (`s1_0003`, idle at both ends) | t1:1501 |
| V3 | A degraded demo: 14.1 s, with tremor, 2 pauses, slowness ×1.27, idle at both ends, and an 11.8 mm off-center grasp (`degraded_0004`) | t1:1503 |
| V4 | These "human" demos are **synthetic**: the scripted expert, with tremor, pauses, slowness, idle and off-center grasps added on purpose | docs/media/README.md:15-17; audit:257 |

### Nemotron (measured roles)

| ID | Wording on the site | Source |
|---|---|---|
| N1 | **As a demo judge, it lost to code.** Pre-registered test, 32 synthetic demos: code alone F1 **0.90**; rules + Nemotron **0.86**; rules alone 0.81 | t4:1323; t1:1636-1640 (set) |
| N2 | Without the code-measured grasp offset, Nemotron called **all 8** centered grasps off-center | t4:1329, 1336 |
| N3 | It never reported a drop (code found 6/6) | t4:1317, 1347-1348 |
| N4 | That test cost 68 calls, $0.1043 | t4:1305 |
| N5 | **As a translator of plain repair requests, it works on our test:** 34/34 requests turned into the right repair ops, vs 31/34 for a keyword parser. **Not significant** (p = 0.25); one person wrote the requests, prompt and baseline; a prototype, **not wired into the app** | t4:1504, 1526, 1540-1541, 1559 |
| N6 | Cost: about $0.0013 per 8-image demo diagnosis (2.5 s); about $0.0002 per repair request (median 0.69 s) | vl:30-31; t4:1536 |
| N7 | Video input works on Token Factory (one probe: a 14.1 s clip, $0.000776) | roles:56-58 |
| N8 | Models: `nvidia/Nemotron-3.5-Super-VL` (images); `nvidia/nemotron-3-super-120b-a12b` (requests), on Nebius Token Factory | vl:8; t4:1439 |

### The app and the system

| ID | Wording on the site | Source |
|---|---|---|
| A1 | The Record → Isaac path works end to end. An automated fake hand recorded **376/376** steps at 19.1 ms per step, and the demo was verified live and again by replay | web:415-425 |
| A2 | **A real person's recorded demo is not yet in a note.** The live hand tests are under way (sprint 8, T4/T6), but no real-person demo has been recorded and verified in a note | web:436; plan8 (T4 "live test #3", "live test #4") |
| A3 | Parallel evaluation: **2.12×** faster at 4 scenes at once, and 7 of 8 outcomes agree with one-at-a-time | t2:1044 |
| A4 | Stack: Isaac Lab 3.0.0 / Isaac Sim 6.2, Python 3.12; LeRobot 0.6.1 ACT; one RTX 5080 16 GB | t2:4; t3:6 |
| A5 | The **300-copy policy** (trained on Y2) is **pending**: T3 trains it in sprint 8; its eval comes after review | plan8 (T3; "Next round") |

## 2. Sitemap

The route paths are T5's call (plan8: T5 owns the route tree). The names below are proposals. Today's app
pages live at `/pm/record`, `/pm/review`, `/pm/dataset` and `/pm/results` (`web/src/App.tsx`).

| Page | Mode | Proposed path | Single job |
|---|---|---|---|
| Home (landing) | paper | `/` | In one scroll, make a visitor understand what SANT does, believe the result, and want to try it |
| Results | paper | `/results` | Let a skeptical reader check the claim and its limits in two minutes |
| About / How it works | paper | `/how-it-works` | Explain each stage, what we measured there, where Nemotron fits, and who built it |
| Record | volt | `/app/record` (today `/pm/record`) | Drive the simulated arm with your hand and save one demo |
| Review | volt | `/app/review` (today `/pm/review`) | See what is wrong with a demo, then perfect it and see it verified |
| Dataset | volt | `/app/dataset` (today `/pm/dataset`) | See what you have collected and export it |

**Navigation:**
- **Story nav (paper):** symbol + wordmark · How it works · Results · **Try it →**. "Try it" is the power-on crossing.
- **App nav (volt):** the glass pill nav (§11.8): symbol · Record · Review · Dataset · "← The story", which crosses back to paper.

The old room-organizer routes stay until the page round (plan8, T5 task 5).

## 3. Home (landing): the scroll story

**Job:** one scroll from "why" to "try it". It is built as a sticky graphic with text steps scrolling past it
(the moodboard's Scrollama pattern). T5 owns the motion presets. The beats below say what moves, and what
the visitor sees with **motion off**: `prefers-reduced-motion`, or the "Effects off" toggle (plan8).

**Global motion-off rule:**
- every beat renders its **end state**, static;
- no scroll-jacking, and no smooth scroll;
- every number is printed in full, with its denominator;
- nothing that carries meaning is dithered or ASCII-rendered (plan8).

### Beat 0: hero

- **Copy:**
  - Eyebrow: `SIMULATE · AUGMENT · NEATEN · TRAIN`
  - H1 (Instrument Serif): **Perfect, then multiply.**
  - Sub: Record one robot demo by moving your hand in front of a webcam. Get back many physics-checked
    training demos.
  - Buttons: **Try it** (primary; crosses to Record) · See the result (scrolls to Beat 3).
- **Numbers:** none.
- **What animates:**
  - the SANT symbol builds in (`logo-brief.md` §3 gives each direction's build). Until the user's symbol
    exists, T5's text placeholder "S·A·N·T" lights unit by unit;
  - the headline fades in line by line.
- **Motion off:** the symbol (or placeholder) is shown in its finished state, and the text is static.
- **Not adopted from `refs`:** Active Theory's black-void hero with dust. The landing stays paper; the dust
  appears only at the crossing (Beat 6).
- **Media:**
  - **missing:** a looping, muted clip of a real hand driving the arm (needs A2; see §9). Until then, no
    hand video.
  - Do not use the fake-hand run as if it were a person.

### Beat 1: the problem

- **Copy:**
  - H2: **Robots learn by copying. They need a lot of copies.**
  - Body:
    - A robot policy learns a task from demonstrations, and it needs many.
    - Human demos are the expensive part: teleoperation rigs cost $6k–$80k, operators $25–$50 an hour,
      and 20–30% of demos get thrown away.
    - *(Small print: vendor estimates.)*
  - Second step: **A webcam is nearly free. Its demos are noisy.**
    - Shaky hands, pauses, idle time, off-center grasps.
    - And ten demos, noisy or not, are not much to learn from.
- **Numbers:** P1, P2, P3, each labelled a vendor estimate.
- **What animates:** the three costs count up as they enter. A sample demo trace, drawn as a line, wobbles
  and stalls where the pauses are.
- **Motion off:** the final figures, and a static trace with the pauses marked.
- **Media:** the trace can come from `degraded_0004`'s data (V3). That is synthetic; caption it so.

### Beat 2: S·A·N·T, step by step

The four letters are the brand. The pipeline runs in a different order: record, neaten, verify, multiply,
train. Each step therefore lights **its** letter, and S lights twice (recording, then verifying). This is
open decision **O1**; the alternative is to drop the letter tags from the steps.

Each step is a text step beside one sticky picture of the arm, the demo and the dataset.

| Step | Letter lit | Copy (H3 + one or two sentences) | Numbers | What animates | Motion off |
|---|---|---|---|---|---|
| 1 Record | **S**imulate | **Your hand drives a simulated arm.** The browser tracks your hand, and a Franka arm in NVIDIA Isaac Lab follows it. Press stop, and it's a demo. | none (A1 belongs on About) | the hand path draws, and the arm ghost follows it | the drawn path and the arm at its end pose |
| 2 Neaten | **N**eaten | **Code measures every move, then repairs it.** Speed, shake, pauses, idle time, grasp centering: a timestamped list of problems. Repairs come from a fixed menu: trim, remove pauses, smooth, retime, recenter. | V1 (13.8 s → 9.3 s) | the trace's pauses collapse and the wobble smooths; the duration counter runs 13.8 → 9.3 | before and after traces, side by side, with both durations printed |
| 3 Verify | **S**imulate | **Physics decides.** Isaac Lab replays the repaired demo. If the cube doesn't end up in the bin, the demo doesn't count. | Y5 (50/50) | a check mark resolves on the replayed path | the check mark is shown |
| 4 Multiply | **A**ugment | **One verified demo becomes many.** New cube and bin positions, and every copy is replayed and verified again. | Y1 (100/100); Y2 (300/300) | one path copies itself into a grid of 10 × 10, then 10 × 30, at the true counts | a static grid, labelled "10 sources × 30 variants, 300/300 verified" |
| 5 Train | **T**rain | **Out comes a standard dataset.** Only verified demos are exported, in LeRobot format, and a policy trains on them. | none | the grid flows into a dataset block | the dataset block, static |

**Grid counts are real counts:** 10 × 10 = 100 (Y1) and 10 × 30 = 300 (Y2). Do not draw 200 (see §0).

### Beat 3: proof

- **Copy:**
  - Eyebrow: `THE TEST`
  - H2: **Same 10 demos. Multiplied, the robot succeeded 5.7× as often.**
    - Arithmetic: 42.5 / 7.5 = 5.67, from R1 and R2.
    - Drop the ratio if the user prefers only the measured values. The alternative H2 is **Same 10 demos.
      3 of 40 vs 17 of 40.**
  - Two bars, each with its k/n: **The 10 demos alone, 3/40 (7.5%)** · **The same 10 + 100 multiplied,
    verified variants, 17/40 (42.5%)**.
  - Under the bars: "On 40 new scenes, chosen before the test and never used to pick anything. 95%
    confidence intervals 3–20% and 28–58%; they don't overlap. Fisher exact p = 0.0005."
  - **"What it does not show yet"** (always visible under the bars):
    - one task, one simulated arm, one policy type, one training run per arm (C1);
    - the 10 demos came from a scripted expert, not a person, and needed no repair. This tests
      multiplying, not perfecting (C3);
    - equal training steps, not equal epochs (C2);
    - it still drops the cube in 22 of its 23 failures (C4).
  - Link: **See every run and how we tested →** (Results).
- **Numbers:** R1, R2, R3, R5, R7; C1–C4. R6 (49 vs 4.5 epochs) goes on Results.
- **What animates:**
  - the two numbers count from 0 to 7.5 and to 42.5, as count-up tiles
    ([§11.4](#114-count-up-tiles-results-and-home-beat-3)). The k/n labels are shown from the start, never
    animated;
  - the bars grow;
  - the CI whiskers draw last.
  - The counter must land on exactly 7.5 and 42.5, and never pass them.
- **Motion off:**
  - both bars at full length, with the whiskers and the "3/40" and "17/40" labels;
  - the caveat list is the same text with motion on or off.
- **Media:**
  - **exists:** `docs/media/charts/comparison.svg`. It shows the pooled n = 60 for this pair, so on the
    landing page **draw the 40-scene bars from R1/R2**, not that SVG (see §4, the data note).
  - **missing:** a short sim clip of the multiplied policy succeeding, and one of it dropping the cube.
    T3 notes there is no video for the eval cells (t3:919).

### Beat 4: the yield

- **Copy:**
  - H2: **Every copy is checked in physics. They all passed.**
  - Body:
    - The training set multiplied 100 of 100, and a larger set 300 of 300. Each variant was replayed in
      Isaac Lab and kept only if the cube landed in the bin.
    - For context, MimicGen publishes 38–74% for this step on harder tasks. Ours is one cube and a large
      open bin, so this is context, not a contest.
- **Numbers:** Y1, Y2, Y6 (with its caveat). Y3/Y4 belong on Results.
- **What animates:** the yield ring fills to 100%, and the MimicGen band appears as a muted range.
- **Motion off:** a static ring at 100% with the label "300/300", and the band.
- **Media:** **exists:** `docs/media/charts/yield.svg`. It shows 100/100 (Y1) and the MimicGen band. A
  300/300 version is **missing**; T1 can refresh it if `results.json` is pointed at `home_v2`.

### Beat 5: where NVIDIA Nemotron fits (honestly)

- **Copy:**
  - H2: **We tested where the AI helps. Code won one test; Nemotron won the other.**
  - Two cards:
    1. **As a judge of demos: code wins.** In a pre-registered test on 32 synthetic demos, code alone
       scored F1 0.90 and rules + Nemotron 0.86. Without the measured grasp offset, the model called all 8
       centered grasps off-center. So code measures the demos.
    2. **As a translator of plain-English repair requests: promising.** "Don't trim the end, just remove
       the pauses." Nemotron turned 34 of 34 such requests into the right repair operations; a keyword
       parser got 31. A small test (not significant, p = 0.25), and a prototype that isn't in the app yet.
  - Footer line: Runs on Nebius Token Factory, at about $0.0002 per request.
- **Numbers:** N1, N2, N5, N6 (the request cost only).
- **What animates:** the two cards flip in; the F1 bars grow.
- **Motion off:** both cards static.
- **Open decision O2:** if the user decides to ship R6 in Review, card 2's last clause becomes "and it's in
  the Review page". Until then, keep "a prototype that isn't in the app yet" (t4:1559).

### Beat 6: Try it

- **Copy:**
  - H2: **Your hand. A webcam. A robot that follows.**
  - Body: Record a demo in your browser. Nothing is sent anywhere until you press Start; the camera asks for
    permission only then.
  - **Pinch-sheet teaser** above the button: a small sheet the visitor pinches and drags with the
    mouse, finger or trackpad ([§11.6](#116-pinch-sheet-teaser-home-beat-6)).
    - Label: **Try a pinch.** Hint under it: "Grab the sheet and drag it. On the next page your hand does
      this to a robot gripper."
  - Button: **Power on →**. This is the story → app crossing: the page "powers on" into Volt (plan8).
  - Small print: Needs the local SANT backend and an Isaac Lab sim worker; see the RUNBOOK.
- **Numbers:** none.
- **What animates:** the **dust power-on** ([§11.7](#117-dust-power-on-home-beat-6--record)):
  - paper dims to black;
  - drifting dust gathers into the SANT symbol;
  - the symbol lights, and the Volt Record page resolves around it.
- **Motion off:** an instant cut to the Record page, with no transition. The teaser becomes a static
  picture (§11.6).
- **Camera rule:** the camera prompt never fires on page load. Only the Record page's own "Start camera"
  triggers it (moodboard, landing story; web:31, where the socket opens only after the camera starts).

### Footer (all story pages)

- "Built with NVIDIA Isaac Lab, NVIDIA Nemotron and Nebius Token Factory." Plain text only; see
  `logo-brief.md` §5.
- "Our entry for the Nebius x NVIDIA Global AI Hackathon, Physical AI track. Everything runs in simulation."
  (README.md:10-12.)
- Team: David Hernandez Del Risco and Susana Rojas (README.md:152).
- Links: GitHub, the RUNBOOK, Results, How it works.

## 4. Results (paper)

**Job:** a skeptical reader can check the claim, see every run (including the null ones), and find each
source.

**Sections, in order:**

1. **Headline:** H1 **Multiplying 10 demos made the robot better.** Then a sub with R14, verbatim.
   - Numbers: R1, R2, R3, R7.
   - Under the sub, three **count-up tiles** ([§11.4](#114-count-up-tiles-results-and-home-beat-3)):
     **3/40 · 7.5%** (R1), **17/40 · 42.5%** (R2), **p = 0.0005** (R3, static).
2. **The chart:** two bars with CI whiskers and k/n, 40-scene confirmatory (R1/R2), redrawn in the paper
   style.
   - Below it, a toggle **"All 60 scenes"** shows R4, with its caveat as the toggle's label text.
3. **How we kept it fair:** a numbered list.
   1. The pair to extend was chosen by a rule fixed in advance (R5).
   2. The 40 confirmatory scenes were new (R5).
   3. The stopping time was fixed in advance, and no one looked at p between blocks (R5).
   4. Statistics: Wilson 95% CIs and two-sided Fisher exact tests, from `demo_pipeline/stats.py`, with a
      power analysis done before the extension (power:6-14).
   5. Even with a ×4 correction for the earlier looks, p ≈ 0.002 (R8).
4. **Every run so far:** a table of all six sprint 7 cells (t3:1186-1193), plus the sprint 3 zeros (R13).
   - Columns: training data · steps · scenes · successes · 95% CI.
   - Caption: "Smaller runs at 20 scenes each could not tell the arms apart (R12). That's why we ran 40
     more."
5. **What it does not show yet:** C1–C5, plus the epochs line (R6).
6. **How it fails:** R9 and R15. One sentence on the next lever: "Reducing drops (grip force, slower
   transit, more data)" (t3:1181-1182).
7. **The yield:** Y1–Y6, with the MimicGen context caveat (Y6). Chart: `yield.svg`.
8. **Nemotron, measured:** the v2 ablation table (t4:1314-1323, five arms, F1 all types: 0.81 / 0.84 /
   **0.90** / 0.86 / 0.80), N2, N3, then the R6 table (t4:1502-1512) with N5's caveats. Costs: N4, N6.
9. **What's next:**
   - the 300-copy policy (A5, **pending**);
   - real human demos (A2);
   - perfected + multiplied, the arm that tests repair (C5);
   - more training runs per arm (C1).
10. **Sources:** links to the notes above and to `docs/media/README.md`.

**Data note for the page round (important):**
- `results.json`, and so `comparison.svg`, holds the **pooled** counts for the 30k pair (4/60 vs 24/60),
  because that is what T3's results files hold (t1:2125-2126, sprint 7 open items).
- The confirmatory 3/40 vs 17/40 is **not** in `results.json`. Two ways to show it:
  - **(a)** add a seed-range filter (5020–5059) to `build_results_json.py`. That is T1's file; ask T1.
  - **(b)** put R1–R3 in the page's static content, citing this spec.
- **Do not compute it in the browser from pooled numbers.**
- The in-app Results page today reads `web/src/pm/mocks/results.sample.json` under a "SAMPLE DATA" banner
  (web:44-48). The story Results page must read the real file, or this spec's facts, and never show the
  sample.

**Media:**
- **exists:** `charts/comparison.svg` (pooled), `charts/yield.svg`, `charts/success.svg` (10k cells only),
  `charts/ablation.svg` (both arms pending: a policy-ablation placeholder, do not show it).
- **missing:**
  - a 40-scene confirmatory chart (needs data note a or b);
  - a 300-copy point (A5);
  - a perfected + multiply arm (C5).

## 5. About / How it works (paper)

**Job:** for the reader who wants the mechanism. What each stage does, what we measured there, where
Nemotron fits, what we build on, and who we are.

**Sections, in order:**

1. **The rule.**
   - The spec's rule is "the AI decides, code acts, physics checks" (spec:27). After N1 that overclaims the
     AI's part.
   - Proposed: **"Code measures, code repairs, physics checks."** This is open decision **O3**.
2. **The pipeline:** one block per stage, each with "what we measured" in Geist Mono.
   - **Record:** browser hand tracking (MediaPipe), a WebSocket relay, the Isaac Lab arm.
     - Measured: A1.
     - Honest line: A2.
   - **Measure + diagnose:** code metrics, with the rules detector naming each issue.
     - Measured: the rules found every injected pause, jitter and idle (docs/media/README.md:57-58).
     - Measured: code F1 0.90 (N1).
   - **Repair:** the fixed menu (trim, remove_pause, smooth, retime, recenter_grasp, replan_transit,
     discard; t4:1417-1421).
     - Measured: V1, V2.
   - **Verify:** physics replay.
     - Measured: Y5, Y7.
   - **Multiply:** new cube and bin positions, each variant re-verified.
     - Measured: Y1–Y4, with Y6 as context.
   - **Export + train:** LeRobot dataset, ACT.
     - Measured: R1–R3 (link to Results). Stack: A4.
   - **Evaluate:** unseen scenes; parallel eval.
     - Measured: A3.
3. **Where Nemotron fits:** the Beat 5 copy, longer.
   - Add N7 (video input) as a capability we probed, not a feature.
   - Add N8 (model IDs) and N6 (costs).
   - Link the roles note for the untested roles (roles:97-251).
4. **What we build on:** MimicGen, SkillGen, DemoBridge, ISR, DQAF, handrobot and AnyTeleop (spec:91-96).
   - Then the claim sentence. **The wording is the user's decision (O4).**
     - The spec's sentence (spec:100-102) is flagged as an overclaim by audit:115.
     - The proposed rewording is audit:115 and TECHNICAL.md:222.
   - Keep "to our knowledge". No "first" claims (spec:104-109).
5. **Limitations:** C1–C5, A2, and "simulation only; one task" (spec:58-85).
6. **Team and history:**
   - README.md:152 (team);
   - README.md:155-156: SANT began as a room organizer and became this tool on 2026-10-15.
7. **Credits:**
   - NVIDIA and Nebius in plain text (`logo-brief.md` §5);
   - the visual inspiration: Zach Lieberman and the other `refs` studies, and Active Theory. Inspiration
     only; no code or assets were copied.

**Media:**
- **exists:** `s1_0002_raw_vs_perfected.gif` (V1), `s1_0003_raw_vs_perfected.gif` (V2),
  `degraded_0004_rules_timeline.gif` (V3), and the sheets. Every caption carries V4 ("synthetic").
- **missing:**
  - a pipeline diagram in the new style (T5 / page round);
  - a clip of the arm following a real hand (A2).

## 6. Record (volt)

**Job:** drive the simulated arm with your hand, and save one demo.

**Sections, in order** (this keeps today's flow; web:372-385):

0. **App nav:** the glass pill nav ([§11.8](#118-pill-nav-app-pages)).
1. **Header:** H1 **Record a demo**. Sub: "Move your hand; the arm follows. Pinch to close the gripper."
2. **Camera and link:**
   - the camera view with the hand overlay (T7's hand-art, behind its toggle; plan8). The overlay changes
     style with each action ([§12](#12-hand-art-six-states));
   - the **tracking HUD** over the camera view ([§11.1](#111-tracking-hud-record));
   - the **glyph loader** while hand tracking and the sim start ([§11.5](#115-glyph-loader-record-and-the-crossing));
   - status pills (in teal, for live state): Camera · Relay · Sim.
   - Primary button: **Start camera** until the camera is on.
3. **Controls:**
   - **Start recording**, which runs the **3-2-1 countdown** ([§11.2](#112-3-2-1-countdown-record)) and
     then becomes **Stop and save**;
   - **Reset scene**: a button, plus the reset gesture.
     - Gesture: hold ✌ (Victory) for 1.5 s, and T6's ring fills (plan8, T6 task 2).
     - Label: "Hold ✌ to reset the scene".
4. **Live readouts** (Geist Mono; T4's panel): confidence, palm angle, grasp mode (pinch / fist), clutch.
   - Show a **"Frozen"** pill (amber) when the hand is edge-on or tracking is unsure.
   - Optional: the **dial HUD** for the gripper, reach and joint angles ([§11.9](#119-dial-hud-record-optional)).
5. **Result:** the sim's last result line, the recorded length (sim seconds and steps), and **Review this
   demo →**.

**Copy for the states** (these replace or keep today's states; web:31-33, 384):

| State | Copy |
|---|---|
| Camera blocked | "Camera access is blocked. Allow it in the browser's site settings, then press Start camera." |
| No camera | "No camera found. Plug one in, then press Start camera." |
| Hand lost | "Paused: hand tracking lost. Bring your whole hand back into the frame." |
| Frozen (edge-on / low confidence) | "Holding still: turn your palm toward the camera to take control again." |
| Sim not connected | "The sim isn't connected. Start the sim worker:" + the exact sink command (as today) |
| Relay error | "The relay rejected a message. Recording is paused." |
| Saved, verified | "Saved and verified in physics. Review it →" |
| Saved, failed | "Saved. The replay did not put the cube in the bin; you can still review and repair it." |

**Numbers:** none static. Every value on this page is live. Do not print A1 here.

**Media:** **missing:** a recorded live session (A2), for the landing hero and the video.

## 7. Review (volt)

**Job:** see what is wrong with a demo, then perfect it and watch physics check it.

**Sections, in order** (from web:34-40):

1. **Header:** the demo id, its length and its pipeline **status glyph**
   ([§11.3](#113-pipeline-status-glyphs-review-and-dataset)), replacing the teal / amber pill.
   - The Perfect panel's steps (today Queued · Perfecting · Done, `web/src/pm/review/PerfectPanel.tsx:20-24`)
     use the same glyph set.
2. **The demo strip,** in three lanes:
   - **Frames** (today "what the model saw"; renamed, because code is the judge, N1; open decision **O5**);
   - **Phases**: approach, carry, retreat;
   - **Repairs.**
3. **Issues** (amber pills) and **repairs** (teal once applied). Claims struck out by a gate keep the
   strike-through.
4. **Before / after:** the hand-speed plot against the parent demo.
5. **Perfect:** the primary button, with job polling.
   - States: running · verified · failed · timed out (as today).
6. **Ask for a repair** (only if O2 ships R6): a text box with the placeholder "e.g. 'Don't trim the end,
   just remove the pauses'".
   - Show the parsed ops before they are applied; code applies them and physics checks.
7. **Passport:** the demo's lineage.

**Copy:**
- Empty state: "No demos yet. Record one →".
- Backend down: "The backend isn't running. Start it with `start.ps1 -Backend`."
- Sim down (503): "The sim worker isn't running, so repairs can't be verified yet."

**Numbers:** live, per demo. No static figures.

**Media:**
- **exists:** `s1_0002_raw_vs_perfected.gif`, usable as the empty-state illustration, with the caption
  "Example: a synthetic demo, 13.8 s → 9.3 s after repair" (V1, V4).

## 8. Dataset (volt)

**Job:** see what you've collected, and export it.

**Sections, in order** (web:41-43):

1. **Counts:** per source (human / perfected / multiplied), human minutes, perfected-per-human,
   variants-per-perfected.
2. **Latest demos:** each row starts with its **status glyph**
   ([§11.3](#113-pipeline-status-glyphs-review-and-dataset)), followed by the status word.
3. **Export:** "Export verified demos as a LeRobot dataset". It is disabled until there is at least one
   verified demo.

**Copy:**
- Empty state: "Nothing to export yet. Every demo you record and verify lands here."
- `/export` missing: "This backend has no export endpoint. Update SANT and restart it."

**Numbers:** live only. **Do not** pre-fill Y1/Y2 as if they were the user's dataset. If a reference is
wanted, add the line "For scale: our test set is 10 sources × 30 variants, 300/300 verified" (Y2), styled
as a note.

## 9. Media inventory

**Exists** (`docs/media/**`, each ≤ 2 MB; docs/media/README.md:3-5):

| File | Shows | Use on | Caption must say |
|---|---|---|---|
| `s1_0002_raw_vs_perfected.gif` | before / after one repair, 13.8 → 9.3 s (V1) | Home Beat 2, About, Review empty state | synthetic demo (V4) |
| `s1_0003_raw_vs_perfected.gif` | 10.6 → 7.8 s (V2) | About | synthetic (V4) |
| `s1_0002_raw_sheet.png` | 6 captioned frames | About | synthetic (V4) |
| `degraded_0004_rules_timeline.gif` | a degraded demo with the rules' diagnosis (V3) | About (the Measure stage) | synthetic (V4); the off-center grasp is found by the code metric, not the rules |
| `degraded_0004_sheet.png` | its frames | About | synthetic (V4) |
| `charts/comparison.svg` | all pairs; the 30k pair **pooled** (R4) | Results, under the toggle | pooled, so optimistic (R4) |
| `charts/success.svg` | the 10k cells by demo count (R12) | Results, "Every run" | 10k steps, n = 20 |
| `charts/yield.svg` | 100/100 vs MimicGen 38–74% (Y1, Y6) | Home Beat 4, Results | context, not like-for-like (Y6) |
| `charts/ablation.svg` | the policy ablation, **both pending** | nowhere yet | (pending) |

These charts are the current style. The page round can redraw them in the paper style from the same data.

**Missing** (the page round shows "pending" or leaves the slot out; never a mock-up passed off as real):

| Needed for | Missing media | Blocked on |
|---|---|---|
| Home hero, Record, video | a live session: a real hand driving the Isaac arm, recorded and verified | A2: the user's live test #4 (plan8) |
| Home Beat 3, Results | a 40-scene confirmatory chart | data note §4 (a or b) |
| Results "What's next" | the 300-copy policy's result | A5: T3's training, then eval (plan8) |
| Results | perfected + multiply vs raw + multiply | not run (C5) |
| Home Beat 3 | sim clips of a success and of a drop by the multiplied policy | no eval video exists (t3:919) |
| Home Beat 4 | a 300/300 yield chart | a T1 refresh pointed at `home_v2` (Y2) |
| Every page, the crossing | the SANT symbol (now a symbol, not letters) | the user (`logo-brief.md`) |
| Record | a capture of T7's hand-art overlay, one clip per state (§12) | T7 (plan8) |
| Home Beat 6 | a still of the pinch sheet, for motion off (§11.6) | page round |
| Social / OG | a share image | page round |

## 10. Open decisions for the user

| ID | Question | Proposal |
|---|---|---|
| O1 | Steps in pipeline order with letter tags (S lights twice), or untagged steps? | Tagged, with S twice. It keeps the brand and the truth |
| O2 | Ship R6 (plain-English repair requests) in Review? | Your call. Beat 5 card 2 and Review §6 change with it |
| O3 | Change the rule "the AI decides, code acts, physics checks"? | "Code measures, code repairs, physics checks" |
| O4 | Claim sentence wording (spec §5) | audit:115's proposed wording |
| O5 | Rename the Review lane "what the model saw" to "Frames"? | Yes |
| O6 | Beat 3 headline: the 5.7× ratio, or the raw counts only? | Counts only, if in doubt. A ratio of two small rates invites over-reading |
| O7 | Dust colours at the crossing: `refs` has teal/gold, then orange/red | Teal and violet only. Gold reads as amber (issues, gripper closed), and orange/red as errors (§11.7) |
| O8 | Ship the optional pieces: depth contours, the swarm intro, the dial HUD, an audio toggle? | Dial HUD only if the sim streams the values (§11.9). The others after the core states work |
| O9 | Show "cube" and "bin" boxes in the HUD? | Not on the webcam: the cube and bin aren't in the camera image (§11.1) |

## 11. New UI pieces (from the visual references)

`refs` is inspiration only. We build our own versions and copy no one's code, assets or exact
compositions. Credit the inspiration on About, under Credits, where it fits.

**Rules for every piece:**
- **Volt colours** (plan8):
  - teal `#19F5C2` means live or OK;
  - violet `#A78BFA` is secondary;
  - amber `#FFB000` means issues, repairs and "gripper closed" (`refs`).
- **Never colour alone:** each state also has a word or a shape.
- **Live values are live:** a piece shows what the app measures at that moment, never a sample value.
  The `refs` example "hand 0.97" is an illustration, not a number for the site.
- **Timing comes from T5's motion tokens** (`docs/design/motion.md`); this spec sets none.
- Motion off is in each piece and in [§13](#13-motion-off-everything-in-one-table).

| # | Piece | Page | Reference (`refs`) |
|---|---|---|---|
| 11.1 | Tracking HUD | Record | *Object Detector Shader*, *Micrographics System* |
| 11.2 | 3-2-1 countdown | Record | *Dotted Countdown* |
| 11.3 | Pipeline status glyphs | Review, Dataset | *Status Icon System* |
| 11.4 | Count-up tiles | Results, Home Beat 3 | *CSS Count Up Animations* |
| 11.5 | Glyph loader | Record, the crossing | Active Theory's loader |
| 11.6 | Pinch-sheet teaser | Home Beat 6 | *Pinchable Fabric Sheet* |
| 11.7 | Dust power-on | Home Beat 6 → Record | Active Theory's hero dust |
| 11.8 | Pill nav | app pages | Active Theory's nav |
| 11.9 | Dial HUD (optional) | Record | *Rolling Dial Shader* |

### 11.1 Tracking HUD (Record)

- **Where:** over the camera view, on the same canvas as the hand overlay. Today that canvas shows "your
  hand, mirrored, with the workspace box" (`web/src/pm/record/RecordPage.tsx:243`).
- **Look:** thin strokes, corner brackets rather than full boxes, and small Geist Mono labels.
- **Labels:**

| Box | Label | Value |
|---|---|---|
| around the tracked hand | `hand 0.00` | the tracker's live confidence, two decimals; the same value as the "confidence" readout |
| the control region | `workspace` | none. Its bottom edge is table height (RecordPage.tsx:65) |
| the hand, when frozen | `hand · frozen` | in amber, matching the "Frozen" pill |
| no hand found | no box | the "Hand lost" copy (§6) shows instead |

- **No "cube" or "bin" boxes on the webcam.** The cube and the bin are in the sim, not in the camera
  image. The sim draws in its own Kit window (`--viz kit`, RecordPage.tsx:118), not in the browser.
  - If a sim view is ever streamed into the page, label its cube and bin there, from the sim's own poses.
  - Open decision **O9**.
- **Motion off:** the brackets and labels are static (no scan lines, no flicker). The confidence number
  still updates, because it is live data.

### 11.2 3-2-1 countdown (Record)

- **Where:** centred over the camera view, after **Start recording** is pressed and before the sim starts
  recording.
- **What it says:**
  - a dotted **3**, then **2**, then **1**. Under the numeral: "Recording starts in…";
  - then the pill **● Recording** (teal), and the button becomes **Stop and save**.
- **Cancel:** pressing the button during the countdown (it reads **Cancel** then), or Esc, stops it. No
  demo is started.
- **If tracking is lost or frozen during the countdown:** stop the countdown, show the "Hand lost" or
  "Frozen" copy from §6, and return the button to **Start recording**. A recording never starts on a hand
  it can't see.
- **Screen readers:** announce "3", "2", "1", "Recording" once each (a polite live region).
- **Motion off:** the countdown still runs, because it gives the user time to get their hand in place.
  The numerals change in place as plain text, with no dot animation, scaling or fading.

### 11.3 Pipeline status glyphs (Review and Dataset)

- **Where:**
  - in the Review header (§7.1) and the Perfect panel's steps;
  - in front of each row in Dataset's "Latest demos" (§8.2).
- **Look:** rounded-square icons, one per state. **The status word always sits next to the glyph.**

| State | Glyph (a proposal; T5 draws them) | Colour | Word | Comes from (today's web code) |
|---|---|---|---|---|
| recorded | an outlined square with a dot | text `#E6EDF3` | Recorded | a demo with source `human` (`web/src/pm/types.ts:6`) |
| diagnosed | a square with a scan line | violet | Diagnosed | a stored diagnosis exists for the demo (`types.ts:70`) |
| repaired | a square with a stitch | amber | Repaired | source `repaired` (`types.ts:6`) |
| verified | a square with a check | teal | Verified | the backend's physics-replay result (see below) |
| failed | a square with a cross through it | amber, with the word | Failed | a job with status `failed`, or outcome `discarded` (`web/src/pm/jobs.ts:21`) |
| blocked | a square with a bar | muted, with the word | Blocked | the step can't run: the sim worker or backend is down (the §7 copy says which) |

- **"Verified" needs a real field.** The web types have no per-demo "verified" field today.
  - The nearest is the job outcome `perfected` (jobs.ts:21).
  - Confirm with T2 that "perfected" means the replay put the cube in the bin before using it as
    "verified". Until then, show no "verified" glyph rather than guess one.
- **Running states:**
  - while a job runs, its glyph shows a slow sweep (motion on);
  - the word reads **Diagnosing…**, **Repairing…** or **Verifying…**;
  - this replaces today's "Queued / Perfecting / Done" steps (PerfectPanel.tsx:20-24).
- **Variants:** a source `variant` demo shows the verified glyph plus a small "×" badge, word
  **Variant**. The badge is never a close button (`logo-brief.md` §7).
- **Motion off:** each glyph is static; a running state shows its word with "…" and no sweep.

### 11.4 Count-up tiles (Results and Home Beat 3)

- **Where:** Results §1 (three tiles), and Home Beat 3 (the two bar values).
- **What they say:**

| Tile | Big number | Small line (static from the start) | Fact |
|---|---|---|---|
| 1 | **7.5%** | 3/40 · the 10 demos alone · 95% CI 3–20% | R1 |
| 2 | **42.5%** | 17/40 · + 100 multiplied, verified variants · 95% CI 28–58% | R2 |
| 3 | **p = 0.0005** | Fisher exact, two-sided | R3 |

- **Motion:**
  - tiles 1 and 2 count up from 0 when they enter the viewport, once;
  - they land on exactly 7.5 and 42.5, and never overshoot (Beat 3 rule);
  - tile 3 does not count. A p-value counting up would read as a score.
- **Screen readers:** the final value is in the text from the start; the counting digits are
  `aria-hidden`.
- **Motion off:** the final values, static.

### 11.5 Glyph loader (Record and the crossing)

- **Where:**
  - on Record, while the hand tracker loads (after **Start camera**) and while the relay and sim connect;
  - during the crossing, if Record's code is still loading.
- **Look:** rows of glyph characters (like `////2///`) that resolve, left to right, into the words of the
  current step.
- **What it says** (one line per real step, in order):
  1. "Loading hand tracking"
  2. "Connecting to the relay"
  3. "Waiting for the sim worker"
  - Each line resolves into its words when that step really completes, then the status pill turns teal.
- **No progress numbers.** No percentages and no fake bars: the steps don't report progress, so the
  loader shows only which step it is on.
- **If a step fails:** the line resolves into the matching §6 error copy (e.g. "The sim isn't connected…")
  in amber, and the loader stops.
- **Motion off:** the step words as plain text, each followed by "…" until done, then "done".

### 11.6 Pinch-sheet teaser (Home Beat 6)

- **Where:** Home Beat 6, above **Power on →**, in a small framed panel.
- **What it is:** a small sheet (cloth-like) that the visitor pinches and drags with the mouse, finger or
  trackpad. It springs back when let go.
- **What it says:**
  - Label: **Try a pinch.**
  - Hint: "Grab the sheet and drag it. On the next page your hand does this to a robot gripper."
  - While held, the grab point turns amber: the same "gripper closed" colour as the app.
- **Camera rule:** the teaser never uses the camera. The camera asks for permission only on Record, after
  **Start camera** (Beat 6 camera rule).
- **Accessibility:** decorative (`aria-hidden`). The keyboard path is the **Power on →** button; the teaser
  is not a required step.
- **Motion off:** a still picture of the sheet, mid-pinch, with the same label. It does not move or
  respond (the still is listed as missing in §9).

### 11.7 Dust power-on (Home Beat 6 → Record)

- **Where:** the story → app crossing, started by **Power on →** (Beat 6) or **Try it →** in the story nav.
- **What happens:**
  1. the paper page dims to Volt black `#07090C`;
  2. drifting dust gathers into the SANT symbol (`logo-brief.md`);
  3. the symbol lights, showing a glass look with a teal / violet rim;
  4. the Record page resolves around it, and the symbol settles into the nav.
- **What it says:** nothing but the symbol. If Record's code is still loading, the glyph loader (§11.5)
  takes the line under the symbol.
- **Colours:** teal and violet dust only (proposal; **O7**). `refs` has teal/gold then orange/red, but here:
  - gold sits too close to amber, which means issues and "gripper closed";
  - orange and red read as errors.
- **Way back:** "← The story" reverses it (dust scatters, paper returns), or a plain fade.
- **Motion off:** an instant cut to Record. The symbol is already in the nav; there is no dust.

### 11.8 Pill nav (app pages)

- **Where:** the top of Record, Review and Dataset, replacing the plain app nav of §2.
- **What it says:** symbol · **Record** —— **Review** —— **Dataset** · "← The story".
  - The links are joined by a thin line; the current page is lit teal.
- **Look:** a glass pill on Volt.
  - The text keeps its contrast (`#E6EDF3` on the pill's dark fill); never put text on bare blur.
- **Not adopted:** the audio toggle (`refs` mentions it; the app has no sound). Open decision **O8**.
- **Motion off:** the same pill, with no blur animation or hover glow.

### 11.9 Dial HUD (Record, optional)

- **Where:** next to the live readouts (§6.4).
- **What it says:** one small rolling dial per value, with its word:
  - **Gripper** (open / closed: the gripper state the page already sends);
  - **Reach**;
  - **Joints**.
- **Only real values.** Show a dial only for a value the page actually has.
  - The gripper state is on the page today (RecordPage.tsx:55, `gripper: 0 | 1`).
  - Reach and joint angles need the sim to stream them to the browser. If it doesn't, leave those dials
    out; never draw a needle that isn't wired to data.
- **Motion off:** each dial is a static readout: the word and the value, in Geist Mono.

## 12. Hand-art: six states

The hand overlay on Record (T7; plan8) changes style with each action. These are the six core states
from `refs`; depth and the landing swarm are optional ([§12.2](#122-optional-states)).

**Rules for every state:**
- **Colours on Volt:** strokes are light `#E6EDF3` or teal `#19F5C2` on black. **Amber `#FFB000` means
  the gripper is closed** (`refs`). No other state turns the hand amber.
- **Readable over the webcam:** put a slightly darkened backdrop, or a blend mode, between the video and
  the strokes (`refs`). T7 sets the amount; the HUD labels over it must still meet 4.5:1.
- **The state is never in the art alone.** The live readouts and pills (§6) carry it in words: grasp
  mode, "Frozen", "● Recording", "Hold ✌ to reset the scene".
- **Precedence**, if two apply at once: reset > paused/frozen > grab / release (short bursts) > recording
  > idle.
- **The overlay's toggle** (plan8) turns all of this off and leaves the plain landmarks.

### 12.1 The six states

| State | When (the app's own signal) | Style | What the user sees | Label / words next to it | Reference (`refs`) |
|---|---|---|---|---|---|
| **Idle / hovering** | a hand is tracked, not recording, gripper open | **Ink along the bones:** brush strokes painted along the finger edges, thick at the joints, dry-brush at the tips | a calm inked hand that follows theirs | the live readouts only | Zach Lieberman, *Wireframe Ink* (the user's own pick) |
| **Grab (close)** | the gripper command goes to closed (pinch or fist) | **Radial bloom:** ink strokes burst out of the palm, sparse to dense | a short burst at the palm, then the hand holds amber | grasp mode reads **pinch** or **fist**; Gripper: **closed** | Zach Lieberman, *Radial Brushstroke* |
| **Release (open)** | the gripper command goes to open | **Particle burst:** streaks shoot out from the fingertips | a short burst at the fingertips, then back to idle or recording | Gripper: **open** | *Particle Burst* |
| **Recording / moving** | the sim is recording (after the countdown, §11.2) | **Particle silhouette with a luminous trail** | the hand as particles, leaving a fading trail of its path | **● Recording** pill | *Particle Figure*, *Particle Face Illustration* |
| **Paused / frozen** | palm turned away or edge-on, or low confidence: today's "Frozen" | **Rippling dot field:** calm, low energy | the hand settles into a quiet dot field; the arm holds still | amber **Frozen** pill, with "Holding still: turn your palm toward the camera to take control again." | *Dot Field Motion* |
| **Reset (✌)** | ✌ held until T6's ring fills (1.5 s, plan8) | **Glitch brush:** black brush forms plus pixel fragments, then a snap back | the ring fills while held; on completion a glitch, then the clean idle hand | "Hold ✌ to reset the scene", then "Scene reset" | *Glitch Brush Study* |

**While recording,** the grab and release bursts play on top of the particle silhouette, and the hand
stays amber while the gripper is closed.

**Frozen uses amber for its pill, not for the hand.** The hand's amber means only "gripper closed"; the
Frozen state is carried by the dot field and the pill's word.

### 12.2 Optional states

These ship only if the six core states work first (open decision **O8**).
- **Depth hint:** topographic contour lines around the hand. More lines as it gets closer. No number is
  shown. (*Topographic Lines*.)
- **Landing intro:** a swarm swirling into a hand, then into the arm (*Cyanotype Fish Vortex*). It would
  sit at Beat 0 or Beat 2 step 1, on **paper**, so it uses ink and deep teal `#0B7A63`, never `#19F5C2`
  (`logo-brief.md` §2).

### 12.3 Motion off

**One static style for every state** (`refs`):
- the ink-along-the-bones hand, drawn without brush animation or particles;
- the hand turns amber while the gripper is closed. That is a colour change, not motion;
- no bursts, trail, ripple or glitch.

The words next to the art (the table's "Label" column) carry every state, so nothing is lost.

## 13. Motion off: everything in one table

"Motion off" means `prefers-reduced-motion`, or the "Effects off" toggle (plan8). The global rule in §3
still applies: end states, no scroll-jacking, every number in full with its denominator.

| Piece | Motion on | Motion off |
|---|---|---|
| Hero symbol (Beat 0) | builds in (`logo-brief.md` §3) | finished symbol, static |
| Beats 1–5 | per beat (§3) | each beat's end state (§3) |
| Count-up tiles (§11.4) | 0 → 7.5 / 42.5, once | final values; k/n and CIs always static |
| Pinch-sheet teaser (§11.6) | draggable sheet, springs back | a still, mid-pinch, with the label |
| Dust power-on (§11.7) | dust gathers into the symbol, the app resolves | instant cut to Record |
| Pill nav (§11.8) | glass blur, hover glow | same pill, static |
| Glyph loader (§11.5) | glyph rows resolve into words | plain step words, "…" then "done" |
| Tracking HUD (§11.1) | brackets with scan detail | static brackets and labels; the confidence still updates (live data) |
| 3-2-1 countdown (§11.2) | dotted numerals animate | **still runs**, as plain numerals changing in place |
| Hand-art (§12) | six styles, one per action | one static style; amber while closed; words carry the state |
| Status glyphs (§11.3) | sweep while running | static glyph + word, "…" while running |
| Dial HUD (§11.9) | rolling dials | word + value, static |
| Results chart, Beat 3 bars | bars grow, whiskers draw | full bars, whiskers, k/n |

**What never changes with motion off:**
- the copy;
- the numbers;
- the caveats (C1–C4);
- the live values on app pages.
