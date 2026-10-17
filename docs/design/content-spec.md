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
- **Story nav (paper):** wordmark · How it works · Results · **Try it →**. "Try it" is the power-on crossing.
- **App nav (volt):** wordmark · Record · Review · Dataset · "← The story", which crosses back to paper.

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
  - the S·A·N·T mark lights unit by unit (the logo placeholder until the user's logo exists; see
    `logo-brief.md`);
  - the headline fades in line by line.
- **Motion off:** the mark is fully lit and the text is static.
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
  - the two numbers count from 0 to 7.5 and to 42.5. The k/n labels are shown from the start, never
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
  - Button: **Power on →**. This is the story → app crossing: the page "powers on" into Volt (plan8).
  - Small print: Needs the local SANT backend and an Isaac Lab sim worker; see the RUNBOOK.
- **Numbers:** none.
- **What animates:** the PowerOn transition (T5): paper dims, the mark's four units light, and the volt
  shell resolves.
- **Motion off:** an instant cut to the Record page, with no transition.
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
7. **Credits:** NVIDIA and Nebius in plain text (`logo-brief.md` §5).

**Media:**
- **exists:** `s1_0002_raw_vs_perfected.gif` (V1), `s1_0003_raw_vs_perfected.gif` (V2),
  `degraded_0004_rules_timeline.gif` (V3), and the sheets. Every caption carries V4 ("synthetic").
- **missing:**
  - a pipeline diagram in the new style (T5 / page round);
  - a clip of the arm following a real hand (A2).

## 6. Record (volt)

**Job:** drive the simulated arm with your hand, and save one demo.

**Sections, in order** (this keeps today's flow; web:372-385):

1. **Header:** H1 **Record a demo**. Sub: "Move your hand; the arm follows. Pinch to close the gripper."
2. **Camera and link:**
   - the camera view with the hand overlay (T7's hand-art, behind its toggle; plan8);
   - status pills (in teal, for live state): Camera · Relay · Sim.
   - Primary button: **Start camera** until the camera is on.
3. **Controls:**
   - **Start recording**, which becomes **Stop and save**;
   - **Reset scene**: a button, plus the reset gesture.
     - Gesture: hold ✌ (Victory) for 1.5 s, and T6's ring fills (plan8, T6 task 2).
     - Label: "Hold ✌ to reset the scene".
4. **Live readouts** (Geist Mono; T4's panel): confidence, palm angle, grasp mode (pinch / fist), clutch.
   - Show a **"Frozen"** pill (amber) when the hand is edge-on or tracking is unsure.
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

1. **Header:** the demo id, its length and its verification status (a teal pill if verified, amber if not).
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
2. **Latest demos:** with their verification status.
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
| Every page | the SANT logo | the user (`logo-brief.md`) |
| Record | a capture of T7's hand-art overlay | T7 (plan8) |
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
