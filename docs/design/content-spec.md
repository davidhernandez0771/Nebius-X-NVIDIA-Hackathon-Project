# SANT website: content and story spec (sprint 9, the new pitch)

- **Owner:** T1. Docs only. T5 (Landing), T6 (My robots), T3 (Results), T7 (Record HUD) and T1 (Review)
  build the pages from this spec (sprint 9 plan, `docs/superpowers/plans/2026-10-18-sprint9-website.md`).
- **Rewritten:** 2026-10-18 for the new pitch, on `pm/web-review` from `origin/perfect-then-multiply` at `3e817f1`.
  It replaces the sprint 8 spec (`8eb45bc`, `db0f24d` on `pm/t1-core`, never merged). Sections 11–13 (UI pieces, hand-art states, motion
  off) are carried over from it with small edits; everything before them is new.
- **The pitch** (the user's, 2026-10-17; plan9 "The product"):
  - Robots need huge amounts of demonstration data, and teleoperation doesn't scale.
  - Tesla, Figure and NVIDIA are racing to turn human video into robot training data. The known gap:
    video lacks the physics.
  - **SANT turns a $0 webcam demo of a human hand into robot training data that is checked in real physics
    (NVIDIA Isaac Lab), fixed, multiplied and labeled.**
  - **Physics** judges "does it work". **Nemotron** watches what you did and writes and validates the label.
  - **The user flow:** **Show** (Record) → **Review** (physics + Nemotron verdict, fixes) → **Get** (a
    dataset, or a trained robot and its report card).
  - **"Bring your robot"** (coming next): upload a URDF, give its parts roles, run the same workflow, get
    data plus a report card.
- **The look** is decided (memory "website-design-decisions"; `docs/design/visual-references.md`):
  - story pages (Landing, Results) are **Field Notes** (paper);
  - app pages (My robots, Record, Review, Dataset) are **Volt** (dark);
  - the robot-shelf prototype's select HUD is the app pages' visual language
    (`docs/design/prototypes/robot-shelf.html`).

## 0. How to read this spec

**Every number on the site comes from the [fact registry](#1-fact-registry).** Each fact has an ID (e.g.
`R2`), the exact wording to use, and its source as `note:line`. A page section lists the IDs it shows. If a
number is not in the registry, it does not go on the site. Add it here first, with its source.

**Source abbreviations.** Line numbers are at the base of this branch unless the row says otherwise. The
notes are append-only, so these lines should stay valid; re-check them with `git blame` if a note is ever
edited.

| short | file |
|---|---|
| `t1` / `t2` / `t3` / `t4` | `docs/superpowers/notes/2026-10-15-t<N>-status.md` |
| `t3s8` | the sprint 8 part of `t3` (lines 1220–1357), merged with PR #38 |
| `vl` | `docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md` |
| `roles` | `docs/superpowers/notes/2026-10-16-nemotron-roles.md` |
| `web` | `docs/superpowers/notes/2026-10-16-web-pages.md` |
| `power` | `docs/superpowers/notes/2026-10-17-power.md` |
| `audit` | `docs/superpowers/notes/2026-10-17-claims-audit.md` |
| `spec` | `docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md` |
| `media` | `docs/media/README.md` |
| `plan9` | `docs/superpowers/plans/2026-10-18-sprint9-website.md` (decisions and copy direction, no measurements) |
| `refs` | `docs/design/visual-references.md` (inspiration only, no measurements) |
| `store` | the local demo store the Review fixture was exported from: `C:\dev\pm-t4\data\demos\s1_0002*` (the same run as `media`'s `s1_0002` GIF) |

**Wording rules** (these apply on every page):
1. **Quote the confirmatory result:** 3/40 vs 17/40 on the 40 fresh scenes (R1–R3). The 300-copy arm
   (R16–R18) is the second, independent comparison on the same scenes.
   - Never lead with the pooled 4/60 vs 24/60 (R4). If it appears at all, give its selection caveat with it.
2. **Never call the 10 source demos "human" or "webcam" demos.** They came from a scripted expert (R10).
   The pitch is about human video; **the proof so far is not.** Every proof beat says so in the same
   viewport: "scripted-expert source demos; human demos come next" (plan9).
3. **Never say "perfected + multiplied" about 17/40 or 16/40.** Those arms were raw + multiplied. The
   sources were already clean, so no repair ran (R10, C3).
4. **Never write "multiplying is proven" or "always helps".** Use T3's suggested wording (R14), or the
   short form in [Beat 3](#beat-3-proof).
5. **More copies did not help (yet):** 300 copies scored 16/40 vs 17/40 for 100 (R17). Say it plainly
   wherever the 300 appear. Never imply "more copies → better robot".
6. **Every page that shows the result also shows its limits,** at least C1–C4, in the same viewport or one
   click away. Never in a footnote only.
7. **Nemotron, two tenses:**
   - **Measured** (say what was measured): N1–N8. Code beat it as a visual demo judge (N1); it turned plain
     repair requests into repair ops 34/34 (N5).
   - **The pitch's role** (writes and validates the label; judges "is it what you meant"): **not built and
     not measured yet** (L1–L3). Present it as "what Nemotron does in SANT" only with "coming next" or
     "being tested" next to it. Never print an accuracy for it.
8. **"Bring your robot" is coming next.** Only the measured robot facts (B1–B5) are numbers. The upload,
   role picker and report card are a preview (plan9), and every screen of it says "preview".
9. **The companies (P4–P6) are context, not our numbers.** Name what each is doing, with no figures. If a
   figure is ever wanted, add it here with a public source first.
10. **No "first" claims** (spec:104-109). "To our knowledge" stays wherever the claim sentence appears.
11. **Rounding:** show k/n with every rate (3/40, not just 7.5%). Round CIs to whole percents only in tight
    spots (R1/R2 give both forms).
12. **A pending result says "pending",** never 0 and never a projection.

**Placeholder copy that must not ship** (illustration, not data):
- "verified ×200", "One demo in. Two hundred verified demos out.", "a grid of 200";
- "Demo 0004 · 13.8 s → 9.3 s · pause 1.4 s". The 13.8 → 9.3 s demo is `s1_0002`, not 0004 (V1); its
  pauses are 2.02 s and 1.60 s (V5); no "1.4 s" pause is in any note. `refs` uses "PAUSE 1.4 s" as an
  illustration of a detection box: label real boxes from the demo's own issues;
- "17/40 perfected + multiplied";
- the prototype's "copies 100/100 verified" top line on the shelf: true for the training set (Y1), but the
  shelf must cite Y1 next to it or drop it;
- "5.7× better" as the headline: the user rejected it as the pitch (memory "pitch-human-video-to-robot-data").

## 1. Fact registry

### Problem and context

| ID | Wording on the site | Source |
|---|---|---|
| P1 | Teleoperation rigs cost $6k–$80k (vendor estimate) | spec:33 |
| P2 | Operators cost $25–$50 an hour (vendor estimate) | spec:34 |
| P3 | 20–30% of demos are discarded (vendor estimate) | spec:35 |
| P4 | **Tesla:** Optimus learns from videos of people doing the task | plan9 "The product" (no figure; cite a public source before adding one) |
| P5 | **Figure:** Project Go-Big, training from human video at internet scale | plan9 (as P4) |
| P6 | **NVIDIA:** GR00T-Mimic multiplies a few demos; GR00T-Dreams generates demos with a video model | plan9 (as P4) |
| P7 | The gap: video has no physics. It shows the hand, not the forces, and a generated video can be physically wrong | plan9; memory "pitch-human-video-to-robot-data" |

### The headline result (T3, sprints 7 and 8)

| ID | Wording on the site | Source |
|---|---|---|
| R1 | The 10 demos alone: **3/40 (7.5%)**, 95% CI 2.6–19.9% (short: 3–20%) | t3:1156 (short form: t3:1172) |
| R2 | The 10 demos + 100 multiplied, physics-verified variants: **17/40 (42.5%)**, 95% CI 28.5–57.8% (short: 28–58%) | t3:1156 (short form: t3:1171-1172) |
| R3 | Fisher exact **p = 0.0005** (two-sided; 0.00055 in T3's table, 0.000549 in T1's recount). Short form: "p < 0.001" | t3:1156; t1:2090-2095; t3:1172 |
| R4 | Pooled over all 60 scenes: 4/60 vs 24/60, p = 2.2 × 10⁻⁵. **Optimistic:** includes the 20 scenes used to choose the pair | t3:1157 |
| R5 | The 40 scenes (seeds 5020–5059) were run after the pair was chosen and never used to choose anything. The run stopped at a pre-set time (13:00), not on the result, and nobody looked at p between blocks | t3:1060-1069, 1143, 1145-1146, 1156 |
| R6 | All policies: ACT, 30k training steps each. **Equal steps, not equal epochs:** ~49 passes over the data for raw, ~4.5 for 100 copies, ~1.6 for 300 copies | t3:1080-1081, 1167; t3s8:1257 |
| R7 | The confidence intervals of R1 and R2 don't overlap | t3:1161 |
| R8 | Even after a ×4 correction for the sprint's earlier looks, p ≈ 0.002 | t3:1163-1164 |
| R9 | The multiplied policy's main failure is dropping the cube: 22 of its 23 failures (100 copies); 23 of 24 (300 copies) | t3:1176-1177; t3s8:1325 |
| R10 | The 10 source demos came from a **scripted expert** (no human, no noise), all starting from one home pose | t2:897; t3:907 |
| R11 | Multiplied training set: 10 sources + 100 variants, 53,170 frames (raw: 4,886 frames) | t3:907-908 |
| R12 | Earlier, smaller runs, none significant alone: 2/20 vs 3/20 (10 demos, 10k steps, p = 1.0); 1/20 vs 5/20 (5 demos, 10k steps, p = 0.18); 1/20 vs 7/20 (10 demos, 30k steps, n = 20, p = 0.044, the pair later extended) | t3:907-908, 914; t3:1041, 1188-1189; t3:1071, 1095-1096 |
| R13 | The first policies (sprint 3) scored 0/20 on unseen scenes; the 0 was too little data, not a bug | t3:725; t3:801 |
| R14 | T3's suggested sentence: "on 40 held-out home-start scenes, ACT trained on 10 demos + 100 multiplied variants succeeded 17/40 (43%, 95% CI 28–58%) vs 3/40 (8%, 3–20%) for the 10 demos alone (Fisher p < 0.001); one training run per cell, 30k steps each." | t3:1171-1173 |
| R15 | Multiplying moved the failure later: from "doesn't get the cube" to "gets it, sometimes loses it" | t3:1181 |
| R16 | The same 10 demos + **300** physics-verified variants (a separate, independently multiplied set): **16/40 (40.0%)**, 95% CI 26.3–55.4% | t3s8:1307 |
| R17 | 300 vs 100 copies: **16/40 vs 17/40, p = 1.0.** No detectable difference at n = 40 ("not 'no effect'"); the 300-copy policy saw each variant ~1.6 times vs ~4.5 | t3s8:1314, 1321-1324, 1257 |
| R18 | 300 copies vs the 10 demos alone: 16/40 vs 3/40, **p = 0.0012**. The multiply effect replicates with a second multiplied dataset (the raw arm and the seeds are shared) | t3s8:1313, 1318-1320 |

### Caveats (shown wherever R1–R3 or R16–R18 are)

| ID | Wording on the site | Source |
|---|---|---|
| C1 | One task (a 5 cm cube into a bin), one simulated arm (Franka), one policy type (ACT), **one training run per arm** | t3:1165-1166; spec:62; t3s8:1335 |
| C2 | Equal steps, not equal epochs (R6) | t3:1167 |
| C3 | No human demos yet, and no repair: the sources were already-clean scripted demos, so this tests **multiplying**, not perfecting | t2:897; README.md:54-56 |
| C4 | It still drops the cube (R9) | t3:1176; t3s8:1325 |
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

### Perfecting (the GIFs and the Review fixture)

| ID | Wording on the site | Source |
|---|---|---|
| V1 | One demo before and after repair: **13.8 s → 9.3 s**, both replays succeeded (`s1_0002`) | t1:1500; store `s1_0002/passport.json`, `s1_0002_rules/passport.json` |
| V2 | A second demo: 10.6 s → 7.8 s (`s1_0003`, idle at both ends) | t1:1501 |
| V3 | A degraded demo: 14.1 s, with tremor, 2 pauses, slowness ×1.27, idle at both ends, and an 11.8 mm off-center grasp (`degraded_0004`) | t1:1503 |
| V4 | These "human" demos are **synthetic**: the scripted expert, with tremor, pauses, slowness, idle and off-center grasps added on purpose | media:15-17; audit:257 |
| V5 | `s1_0002`'s diagnosis by the rules: idle for the first 0.82 s; jitter over the whole demo (jerk RMS above 20 m/s³); a 2.02 s pause at 4.50–6.52 s; a 1.60 s pause at 8.98–10.58 s. Repairs: trim, remove both pauses, smooth (medium). Replays: 13.76 s, path 2.28 m → 9.32 s, path 1.10 m; both succeeded | store `s1_0002_rules/diagnosis.json`, `s1_0002_rules/passport.json`, `s1_0002/passport.json`; media:23 |
| V6 | The same demo, diagnosed by the sprint 3 Nemotron (`nvidia/Nemotron-3.5-Super-VL`): no issues, decision "keep". The rules found 4 | store `s1_0002/diagnosis.json`; media:59 |

### Nemotron, measured

| ID | Wording on the site | Source |
|---|---|---|
| N1 | **As a visual demo judge, it lost to code.** Pre-registered test, 32 synthetic demos: code alone F1 **0.90**; rules + Nemotron **0.86**; rules alone 0.81 | t4:1323; t1:1636-1640 (set) |
| N2 | Without the code-measured grasp offset, Nemotron called **all 8** centered grasps off-center | t4:1329, 1336 |
| N3 | It never reported a drop (code found 6/6) | t4:1317, 1347-1348 |
| N4 | That test cost 68 calls, $0.1043 | t4:1305 |
| N5 | **As a translator of plain repair requests, it works on our test:** 34/34 requests turned into the right repair ops, vs 31/34 for a keyword parser. **Not significant** (p = 0.25); one person wrote the requests, prompt and baseline; a prototype, **not wired into the app** | t4:1504, 1526, 1540-1541, 1559 |
| N6 | Cost: about $0.0013 per 8-image demo diagnosis (2.5 s); about $0.0002 per repair request (median 0.69 s) | vl:30-31; t4:1536 |
| N7 | Video input works on Token Factory (one probe: a 14.1 s clip, $0.000776) | roles:56-58 |
| N8 | Models: `nvidia/Nemotron-3.5-Super-VL` (images); `nvidia/nemotron-3-super-120b-a12b` (requests), on Nebius Token Factory | vl:8; t4:1439 |

### Nemotron, the pitch's role (not measured yet)

| ID | Wording on the site | Source |
|---|---|---|
| L1 | **What it will do:** watch the replay and the measured facts, then write the demo's language label (the task sentence plus a sentence per phase) and check it against what you asked for ("gently, left corner"). If they don't match, it says why and asks for a repair from the fixed menu | plan9 "The product"; roles:183-197 (R4); memory "pitch-human-video-to-robot-data" |
| L2 | **Why labels matter:** language-conditioned robot models (VLAs) train on a demo plus its instruction. Today every demo gets one templated sentence, "pick up the red cube and place it in the blue bin" | roles:187-190; `src/demo_pipeline/rules.py:113`; store `s1_0002_rules/diagnosis.json` |
| L3 | **Status: not built, not measured.** It will be measured with a pre-registered test (matching vs mismatching demos, Nemotron vs a code baseline) and reported whatever it shows. ACT, the policy we train, ignores the task text, so a downstream gain can't be measured with it | memory "pitch-human-video-to-robot-data"; roles:196-197 |

### Robots ("Bring your robot")

| ID | Wording on the site | Source |
|---|---|---|
| B1 | **Franka Panda:** our main robot. Every result above is on it (C1) | t3:907; t2:4 |
| B2 | **OpenArm: 0/30** variants (multiply, the same source and seeds as Franka). **Why:** its ±45° wrist confines a vertical grasp to a ~0.2 m height band. **A design limit found in simulation**, before anyone built a cell around it | t2:310-311, 368, 528 |
| B3 | **Flexiv Rizon 4s: 9/30** variants on the same seeds. **Why:** the gripper model's near-massless fingers slip or drag the cube; reach is fine | t2:513, 529, 540, 592 |
| B4 | **SO-101** and **AgileX PiPER:** open URDFs, **coming next** (no runs yet) | memory "open-robot-arm-catalog" (licenses: SO-101 Apache-2.0, PiPER MIT, as in the shelf prototype) |
| B5 | **Your robot:** upload a URDF, mark the base, the hand and the gripper, and run the same workflow. **Preview:** the upload and role picker are not built | plan9 "Bring your robot" |

### The app and the system

| ID | Wording on the site | Source |
|---|---|---|
| A1 | The Record → Isaac path works end to end. An automated fake hand recorded **376/376** steps at 19.1 ms per step, and the demo was verified live and again by replay | web:415-425 |
| A2 | **A real person's recorded demo is not yet in a note.** A live run with a real person at the webcam has not been done (as of this base) | web:436 |
| A3 | Parallel evaluation: **2.12×** faster at 4 scenes at once, and 7 of 8 outcomes agree with one-at-a-time. Headline numbers use one-at-a-time | t2:1044; t3s8:1268-1270 |
| A4 | Stack: Isaac Lab 3.0.0 / Isaac Sim 6.2, Python 3.12; LeRobot 0.6.1 ACT; one RTX 5080 16 GB | t2:4; t3:6 |

## 2. Sitemap

| Page | Mode | Path (sprint 9) | Owner | Single job |
|---|---|---|---|---|
| Landing | paper | `/site` (later `/`) | T5 | In one scroll: the industry problem, how SANT answers it, the proof and its limits, "bring your robot", then try it |
| Results | paper | `/site/results` | T3 | Let a skeptical reader check the claim, every run and its limits in two minutes, and read a robot report card |
| My robots | volt | `/robots` | T6 | Pick the robot you're making data for, and see what the simulator found about each one |
| Robot setup | volt | `/robots` → "+" (placeholder) | T6 | Preview of "Bring your robot": upload a URDF and give its parts roles |
| Record | volt | today `/pm/record`; HUD pieces at `/site/record-hud` | T4 / T7 | **Show:** do the task with your hand in front of the webcam; the simulated robot copies you |
| Review | volt | `/review2` (later `/review`) | T1 | **Review:** see what physics and Nemotron decided about your demo, what was wrong, and what was fixed |
| Dataset | volt | today `/pm/dataset` | (next round) | **Get:** the verified, multiplied, labeled demos, and the export |

**Navigation:**
- **Story nav (paper):** symbol + wordmark · How it works (Landing Beat 2) · Results · Robots · **Try it**.
  "Try it" is the power-on crossing into Record.
- **App nav (volt):** the glass pill nav (§11.8): symbol · **Robots** —— **Record** —— **Review** ——
  **Dataset** · "The story", which crosses back to paper. The order is the user flow: pick a robot, show,
  review, get.

## 3. Landing: the scroll story

**Job:** one scroll from "why does this matter" to "try it". Built as a sticky picture with text steps
scrolling past it (T5 owns the motion). Each beat says what moves and what the visitor sees with **motion
off** (`prefers-reduced-motion` or the "Effects off" toggle).

**Global motion-off rule:** every beat renders its end state, static; no scroll-jacking; every number in
full with its denominator; nothing that carries meaning is dithered or ASCII-rendered.

### Beat 0: hero

- **Copy:**
  - H1 (Instrument Serif): **Show a robot once. Get the data to teach it.**
  - Sub: Do a task with your hand in front of a webcam. SANT replays it on a simulated robot, checks it in
    real physics, fixes it, multiplies it and labels it. Out comes robot training data.
  - Buttons: **Try it** (primary; the power-on into Record) · **See the proof** (scrolls to Beat 3).
  - Small line under the buttons: Simulate · Augment · Neaten · Train. Perfect, then multiply.
- **Numbers:** none.
- **What animates** (plan9 T5): our own take on Linear's principle. A slow, heavy hand silhouette moves; a
  fast swarm of small robot-cursor marks follows it and multiplies around it: one demo, many copies.
- **Motion off:** the hand at rest with the swarm frozen around it, as one still picture.
- **Media:** no real-hand video (A2). Do not use the fake-hand run (A1) as if it were a person.

### Beat 1: the problem

- **Copy:**
  - H2: **Robots learn from demonstrations. Nobody has enough.**
  - Body:
    - A robot learns a task by copying examples, and it needs a great many.
    - The usual way to make them is teleoperation: a person drives the robot through the task. Rigs cost
      $6k–$80k, operators $25–$50 an hour, and 20–30% of demos get thrown away. *(Vendor estimates.)*
  - Second step: **So the biggest labs are learning from human video.**
    - Three short rows, one per company, no numbers (P4–P6):
      - **Tesla:** Optimus learns from videos of people doing the work.
      - **Figure:** Project Go-Big trains on human video at internet scale.
      - **NVIDIA:** GR00T-Mimic multiplies a few demos; GR00T-Dreams generates new ones with a video model.
  - Third step: **Video has no physics.** (P7)
    - A video shows a hand, not the grip, the weight or the contact. A generated video can show a cube
      floating into a bin. A robot trained on that learns the wrong thing.
- **Numbers:** P1, P2, P3 (each labelled a vendor estimate); P4–P7 carry no numbers.
- **What animates:** the three costs count up once; on "Video has no physics", the hand picture loses its
  shadow and contact marks (the "missing physics").
- **Motion off:** the final figures; the hand picture shown once with and once without its contact marks.
- **Company names in plain text only.** No logos, no brand colours (`logo-brief.md` §5).

### Beat 2: how SANT works

Three steps, the user flow, beside one sticky picture of a hand, the robot and a growing stack of data.

| Step | Copy (H3 + one or two sentences) | Numbers | What animates | Motion off |
|---|---|---|---|---|
| 1 Show | **Do it once, with your hand.** Your browser tracks your hand and a simulated robot in NVIDIA Isaac Lab copies it. A webcam is all you need. | none (A1 belongs on Results) | the hand path draws and the robot ghost follows | the drawn path and the robot at its end pose |
| 2 Review | **Physics checks it. Nemotron reads it.** Isaac Lab replays the demo: if the cube doesn't end up in the bin, it doesn't count. Code measures every move and fixes shakes, pauses and idle time from a fixed menu. Nemotron writes what the demo shows, and checks it is what you meant *(coming next, L1–L3)*. | V1 (13.8 s → 9.3 s, synthetic, V4) | the trace's pauses collapse and the wobble smooths; a check resolves | before and after traces side by side, both durations printed, the check shown |
| 3 Get | **One demo becomes a dataset.** New cube and bin positions; every copy is replayed and verified again; only verified copies are kept, labeled, and exported for training (LeRobot format). | Y1 (100/100); Y2 (300/300) | one path copies itself into a 10 × 10 grid, then 10 × 30, at the true counts | a static grid, labelled "10 sources × 30 variants, 300/300 verified" |

- **Grid counts are real counts:** 10 × 10 = 100 (Y1) and 10 × 30 = 300 (Y2). Never 200.
- **The S·A·N·T letters** are the brand line under the hero, not step tags. (This closes sprint 8's O1.)

### Beat 3: proof

- **Copy:**
  - H2: **Same 10 demos. Multiplied, the robot succeeded 17 times out of 40 instead of 3.**
  - Three bars, each with its k/n (count-up tiles, §11.4):
    - **The 10 demos alone: 3/40 (7.5%)**
    - **+ 100 verified copies: 17/40 (42.5%)**
    - **+ 300 verified copies: 16/40 (40.0%)**
  - Under the bars: "On 40 new scenes, chosen before the test and never used to pick anything. 95%
    confidence intervals 3–20%, 28–58% and 26–55%. Fisher exact p = 0.0005 for 100 copies and 0.0012 for
    300, each against the 10 demos alone."
  - One sentence on the plateau (R17): "Tripling the copies didn't help at the same training budget: 16/40
    vs 17/40."
  - **"What it does not show yet"** (always visible under the bars):
    - the 10 demos came from a scripted expert, not a person, and needed no repair: this tests
      multiplying, not perfecting. **Human demos come next** (C3, rule 2);
    - one task, one simulated arm, one policy type, one training run per arm (C1);
    - equal training steps, not equal epochs (C2);
    - it still mostly fails by dropping the cube (C4).
  - Link: **See every run and how we tested** (Results).
- **Numbers:** R1, R2, R3, R5, R16, R17, R18; C1–C4.
- **What animates:** the tiles count from 0 to 7.5, 42.5 and 40.0 and land exactly (never overshoot); the
  bars grow; the CI whiskers draw last. The k/n labels are shown from the start.
- **Motion off:** all three bars at full length with whiskers and k/n; the caveats are the same text.
- **T5's CountUp** "7.5% → 42.5%, captioned 'same 10 demos'" (plan9) is this beat's first two tiles.
- **Media missing:** sim clips of the multiplied policy succeeding and dropping (no eval video, t3:919).

### Beat 4: bring your robot

- **Copy:**
  - H2: **Bring your robot. Find out if it can do the job before you build it.**
  - Body: Load your robot's model (a URDF), mark its base, hand and gripper, and run the same workflow. SANT
    gives you training data for that robot, and a report card: what it can reach, how often it succeeds,
    and why it fails.
  - **A real example** (B2): "OpenArm couldn't place a single copy: 0 of 30. Its wrist turns only ±45°, so
    it can grasp straight down only inside a band about 0.2 m tall. The simulator found that before anyone
    built a cell around it."
  - Two more lines, small: "Flexiv Rizon 4s: 9 of 30; its gripper model lets the cube slip (B3). Franka:
    our main robot (B1)."
  - Status line: **Coming next.** Upload and part roles are a preview (B5).
  - Link: **See the robots** (My robots).
- **Numbers:** B2, B3 (and B1 with no figure).
- **What animates:** the shelf teaser: three cartridges, the OpenArm one slides out with its "Design flaw
  found" sticker.
- **Motion off:** the three cartridges, OpenArm already out.

### Beat 5: where NVIDIA Nemotron fits

- **Copy:**
  - H2: **Physics decides if it works. Nemotron decides if it's what you meant.**
  - Two cards:
    1. **Measured: as a visual judge, code beat it.** In a pre-registered test on 32 synthetic demos, code
       alone scored F1 0.90 and rules + Nemotron 0.86. Without the measured grasp offset, the model called
       all 8 centered grasps off-center. So code and physics judge the motion (N1, N2).
    2. **Measured: it understands what people ask for.** "Don't trim the end, just remove the pauses."
       Nemotron turned 34 of 34 such requests into the right repairs; a keyword parser got 31. A small test
       (not significant, p = 0.25) (N5).
  - Then the role, with its status (L1–L3): **Next: Nemotron writes each demo's label and checks it against
    your request.** Robot models that follow instructions train on a demo plus its sentence. Not built yet;
    it will be tested before we claim it works.
  - Footer line: Runs on Nebius Token Factory, at about $0.0002 per request (N6).
- **Numbers:** N1, N2, N5, N6.
- **Motion off:** both cards static.

### Beat 6: try it

- **Copy:**
  - H2: **Your hand. A webcam. A robot that copies you.**
  - Body: Record a demo in your browser. Nothing is sent anywhere until you press Start camera; the camera
    asks for permission only then.
  - **Pinch-sheet teaser** (§11.6), optional (plan9): **Try a pinch.** "Grab the sheet and drag it. On the
    next page your hand does this to a robot gripper."
  - Button: **Power on**. The story → app crossing into Record (§11.7).
  - Small print: Needs the local SANT backend and an Isaac Lab sim worker; see the RUNBOOK.
- **Numbers:** none.
- **Motion off:** an instant cut to Record; the teaser is a still.
- **Camera rule:** the camera prompt never fires on page load, only on Record's own "Start camera" (web:31).

### Footer (story pages)

- "Built with NVIDIA Isaac Lab, NVIDIA Nemotron and Nebius Token Factory." Plain text (`logo-brief.md` §5).
- "Our entry for the Nebius x NVIDIA Global AI Hackathon, Physical AI track. Everything runs in simulation."
  (README.md:10-12.)
- Team: David Hernandez Del Risco and Susana Rojas (README.md:152).
- Links: GitHub, the RUNBOOK, Results, Robots.
- Credits for the visual inspiration (`refs`): inspiration only; no code or assets were copied.

## 4. Results (paper)

**Job:** a skeptical reader can check the claim, see every run (including the null ones), find each
source, and read a robot's report card.

**Sections, in order:**

1. **Headline:** H1 **Multiplying 10 demos made the robot better. Tripling the copies didn't help more.**
   Sub: R14, verbatim, then R18 in one sentence.
   - Count-up tiles: **3/40 · 7.5%** (R1), **17/40 · 42.5%** (R2), **16/40 · 40.0%** (R16), with
     **p = 0.0005** and **p = 0.0012** as static lines (R3, R18).
2. **The "how many copies" chart** (plan9 T3): x = copies (0, 100, 300), y = success on the 40 scenes,
   Wilson whiskers, k/n on every point. Caption: the honest plateau (R17) and its caveat: equal steps, so 300
   copies got ~1.6 epochs vs ~4.5 (R6). It draws as the values "arrive" (refs: Live Data Loading).
   - A toggle **"All 60 scenes"** shows R4, with its caveat as the toggle's label text.
3. **How we kept it fair:** the pair was chosen by a rule fixed in advance (R5); the 40 scenes were new
   (R5); the stopping time was fixed, no one looked at p between blocks (R5); Wilson 95% CIs and two-sided
   Fisher exact tests (`demo_pipeline/stats.py`), with a power analysis before the extension (power:6-14);
   ×4 correction still gives p ≈ 0.002 (R8); headline evals run one scene at a time (A3).
4. **Every run so far:** all sprint 7 cells (t3:1186-1193), the sprint 8 300-copy cell (t3s8:1303-1307; its 10 human demos column means the scripted sources, R10) and
   the sprint 3 zeros (R13). Columns: training data · steps · scenes · successes · 95% CI.
   Caption: "Smaller runs at 20 scenes each could not tell the arms apart (R12). That's why we ran 40 more."
5. **What it does not show yet:** C1–C5, plus the epochs line (R6), plus A2 (no real person's demo yet).
6. **How it fails:** R9 and R15. The next lever: "reducing drops (grip force, slower transit, more data)"
   (t3:1181-1182).
7. **The yield:** Y1–Y6, with the MimicGen context caveat (Y6).
8. **Report card template** (plan9 T3), filled for Franka from real facts only:
   - success %: R2 / R16 with k/n;
   - failure reasons: drops 22 of 23 (R9);
   - reach: **pending** (no reach map is measured yet);
   - a second card for OpenArm: multiply 0/30, reason "wrist range ±45°" (B2); a third for Flexiv: 9/30,
     "gripper slip" (B3). Their policy success: **pending** (no policy trained on them).
9. **Nemotron, measured:** the v2 ablation table (t4:1314-1323), N2, N3, the R6 repair-request table
   (t4:1502-1512) with N5's caveats, costs N4, N6. Then L1–L3 as "next", with no number.
10. **Sources:** links to every note above and to `docs/media/README.md`.

**Data note:**
- `results.json` holds the **pooled** counts for the 30k pair (4/60 vs 24/60) (t1:2125-2126). The 40-scene
  confirmatory split and the 300-copy cell are not in it yet. Show them from this spec's static facts
  (R1–R3, R16–R18), or ask T1 for a seed-range filter in `build_results_json.py`. **Never compute them in
  the browser from pooled numbers.**
- Never show `web/src/pm/mocks/results.sample.json` on the story page.

## 5. My robots (volt) and Robot setup

**Job:** pick the robot you're making data for, and see at a glance what the simulator found about each.

**Visual:** the approved robot-shelf prototype, rebuilt in React (plan9 T6), with its two fixes (no
intersecting cartridges; a softer key light).

**Each cartridge** (data in `robots.json`, every number cited):

| Robot | Sticker | Detail-card lines | Facts |
|---|---|---|---|
| Franka Panda | **Tested** | "7-DOF, parallel gripper. Our main robot." · "Multiply: 30/30 clean-expert copies (Y3); 100/100 and 300/300 in the training sets (Y1, Y2)." · "Policy: 3/40 → 17/40 with 100 copies (R1, R2)." | B1, Y1–Y3, R1, R2 |
| OpenArm | **Design flaw found** | "7-DOF, open source." · "Multiply: 0/30." · "Why: its ±45° wrist confines a straight-down grasp to a ~0.2 m band." | B2 |
| Flexiv Rizon 4s | **Tested** | "7-DOF, force control." · "Multiply: 9/30." · "Why: the gripper model's fingers slip or drag the cube." | B3 |
| SO-101 | **Coming next** | "5-DOF + jaw, low cost. Open URDF (Apache-2.0)." · "Not run yet." | B4 |
| AgileX PiPER | **Coming next** | "6-DOF, low cost. Open URDF (MIT)." · "Not run yet." | B4 |
| Your robot (+) | **Preview** | "Upload a URDF. Mark the base, hand and gripper." | B5 |

- **Top line** (the prototype's "copies 100/100 verified"): keep it only as "Franka: 100/100 copies
  verified" with Y1 one click away, or drop it.
- **Empty or error state:** "Couldn't load the robot list. Reload the page." (static JSON, so rare.)

**Robot setup (placeholder, "Preview" on every screen):**
- H1 **Bring your robot**. Sub: "Load a URDF, then tell SANT which parts are the base, the hand and the
  gripper."
- A part tree (refs: Data Tree) with clearly fake parts, and three role slots (Base · Hand · Gripper)
  connected by lines (refs: Node Connection).
- Button **Upload a URDF** (disabled) with "Preview: uploads aren't built yet."
- What it will produce: "Training data for your robot, and a report card: reach, success %, and why it
  fails." No numbers.

## 6. Record (volt)

**Job:** **Show.** Do the task with your hand; the simulated robot copies you; save one demo.

The flow and states are unchanged from sprint 8 (web:372-385); the HUD pieces are T7's (§11, plan9 T7).

**Sections, in order:**
0. **App nav:** the pill nav (§11.8), Record lit.
1. **Header:** H1 **Show it once**. Sub: "Move your hand; the robot follows. Pinch to close the gripper."
2. **Camera and link:** the camera view with the hand overlay (§12) and the tracking HUD (§11.1); the
   glyph loader while tracking and the sim start (§11.5); status pills Camera · Relay · Sim. Primary
   button **Start camera** until the camera is on.
3. **Controls:** **Start recording** (runs the 3-2-1 countdown, §11.2, then becomes **Stop and save**);
   **Reset scene** (button, plus ✌ held for 1.5 s; "Hold ✌ to reset the scene").
4. **Live readouts** (the instrument rack, `record-console.html`): grip, height, reach, palm angle, grasp
   mode, clutch. An amber **Frozen** pill when the hand is edge-on or tracking is unsure. **No tachometer.**
5. **Result:** the sim's last result line, the recorded length (sim seconds and steps), and **Review this
   demo** (to Review, with `?id=`).

**Copy for the states:**

| State | Copy |
|---|---|
| Camera blocked | "Camera access is blocked. Allow it in the browser's site settings, then press Start camera." |
| No camera | "No camera found. Plug one in, then press Start camera." |
| Hand lost | "Paused: hand tracking lost. Bring your whole hand back into the frame." |
| Frozen (edge-on / low confidence) | "Holding still: turn your palm toward the camera to take control again." |
| Sim not connected | "The sim isn't connected. Start the sim worker:" + the exact sink command (as today) |
| Relay error | "The relay rejected a message. Recording is paused." |
| Saved, verified | "Saved and verified in physics. Review it." |
| Saved, failed | "Saved. The replay did not put the cube in the bin; you can still review and fix it." |

**Numbers:** live only. Do not print A1 here.

## 7. Review (volt)

**Job:** **Review.** See what physics and Nemotron decided about your demo, what was wrong with it, and
what was fixed, as one scan from the raw demo to the perfected one.

**Visual language:** the robot-shelf select HUD (plan9): black stage, thin frames, crosshair "×" boxes,
`x: y:` coordinates, mosaic tiles that resolve, scrambled text that settles. Amber marks issues; teal marks
what is verified. Plus `refs`' Human to Machine (glitch morph raw → perfected), Codex Code Review (the issue
list) and the Tessel X-ray scan.

**Sections, in order:**

1. **App nav** (pill nav, Review lit) and a **demo picker** (the list of demos, as today).
2. **Title block** (HUD style): the demo id, its source (human / repaired / variant), its length in sim
   seconds, its robot, its scene seed.
3. **The scan** (the one big moment): the demo's front-camera replay inside a thin frame. A scan band sweeps
   the timeline; where it passes an issue, a detection box locks on with the issue's own label and time
   (e.g. `PAUSE 2.02 s · 4.50–6.52 s`, from the diagnosis, never invented). Then the frame **glitch-morphs**
   from the raw demo into the perfected one (mosaic → resolve), and the clock shortens to the perfected
   length.
   - Below the frame, the timeline in three lanes: **Issues** (amber), **Phases**, **Fixes** (teal), with the
     scan line on it.
   - With no frames served, the scan uses the demo's end-effector path (top-down X-ray of `ee_pos`) instead
     of camera frames. Say which one is shown.
4. **Issues and fixes, code-review style:** each issue is a row with its time range, its type, the
   measured evidence in mono ("speed < 0.01 m/s for 2.02 s"), and the fix applied under it (trim,
   remove_pause, smooth…), like a reviewed line and its suggested change. Gated claims stay struck through
   with "dropped: the measured metrics contradict it".
5. **The verdict card:**
   - **Physics:** "Verified ✓, the cube ended in the bin" or "Failed ✗" + the reasons, from the replay's
     verification (success, duration, path length). If the backend doesn't serve it: "not served by this
     backend yet", never a guess.
   - **Label:** the demo's label, and who wrote it: "rules template" or the Nemotron model id. Today it is
     always the template sentence (L2).
   - **Matches your request:** "Not checked yet: Nemotron's label check is coming next (L3)." Never "yes" or
     "no" until that check runs.
   - **Fixed:** "N issues, M fixes", counted from the diagnosis.
6. **Before / after numbers** (from the two verifications, when both exist): length, path length, settle
   time.
7. **Perfect** (for a human demo): the primary button **Perfect this demo**, with the rules / Nemotron
   choice and job polling (as today: running · verified · failed · timed out).
8. **Passport:** lineage (parent link), robot, seed, diagnosis source.

**Copy:**
- Empty state: "No demos yet. Record one with your webcam." + **Record a demo**.
- Backend down: "Can't reach the SANT backend. Start it with `start.ps1 -Backend`, then reload." The page
  then offers the **recorded example** (below).
- Sim down (503): "The sim worker isn't running, so fixes can't be verified yet."
- Not diagnosed: "Not reviewed yet. Perfect runs the diagnosis, the fixes and the physics check."

**The recorded example** (for viewing without a backend, and for the video): `s1_0002` → `s1_0002_rules`,
exported from `store` with every value unchanged (V1, V5, V6). It is labelled on the page: "Recorded
example: a synthetic demo (the scripted expert with tremor, pauses and idle added on purpose)" (V4).
- It shows **both** diagnosers honestly: the rules found 4 issues; the sprint 3 Nemotron found none (V6).

**Numbers:** live per demo, or the example's own (V1, V5, V6). No static figures.

## 8. Dataset (volt)

**Job:** **Get.** See what you've collected, and export it. (Not rebuilt in sprint 9.)

**Sections, in order:**
1. **Counts:** per source (human / perfected / multiplied), human minutes, perfected-per-human,
   variants-per-perfected.
2. **The shelf of demos** (refs: Grokipedia): each demo or copy is a spine; the selected one slides out with
   its card: frame, verified glyph, label, copies.
3. **Export:** "Export verified demos as a LeRobot dataset", disabled until there is one verified demo.

**Copy:**
- Empty state: "Nothing to export yet. Every demo you record and verify lands here."
- `/export` missing: "This backend has no export endpoint. Update SANT and restart it."

**Numbers:** live only. Do not pre-fill Y1/Y2 as the user's dataset. For scale, a styled note: "Our test
set: 10 sources × 30 variants, 300/300 verified" (Y2).

## 9. Media inventory

**Exists** (`docs/media/**`, each ≤ 2 MB):

| File | Shows | Use on | Caption must say |
|---|---|---|---|
| `s1_0002_raw_vs_perfected.gif` | before / after one repair, 13.8 → 9.3 s (V1) | Landing Beat 2, Review | synthetic demo (V4) |
| `s1_0003_raw_vs_perfected.gif` | 10.6 → 7.8 s (V2) | Results | synthetic (V4) |
| `s1_0002_raw_sheet.png` | 6 captioned frames | Results | synthetic (V4) |
| `degraded_0004_rules_timeline.gif` | a degraded demo with the rules' diagnosis (V3) | Results | synthetic (V4); the off-center grasp is found by the code metric, not the rules |
| `charts/comparison.svg` | all pairs; the 30k pair **pooled** (R4) | Results, under the toggle | pooled, so optimistic |
| `charts/success.svg` | the 10k cells (R12) | Results, "Every run" | 10k steps, n = 20 |
| `charts/yield.svg` | 100/100 vs MimicGen 38–74% (Y1, Y6) | Results | context, not like-for-like |
| `charts/ablation.svg` | both arms **pending** | nowhere | (pending) |
| `web/src/site/review/example/*` | the Review example, exported from `store` (s1_0002 raw + perfected: trajectories, diagnoses, verifications, front-camera frames every 0.2 s) | Review | synthetic (V4) |

**Missing** (the page shows "pending" or leaves the slot out; never a mock-up passed off as real):

| Needed for | Missing media | Blocked on |
|---|---|---|
| Landing hero, Record, video | a real person's hand driving the robot, recorded and verified | A2 |
| Landing Beat 3, Results | sim clips of a multiplied-policy success and a drop | no eval video (t3:919) |
| Results | perfected + multiplied vs raw + multiplied | not run (C5) |
| Review "Matches", Landing Beat 5 | Nemotron's label check and its test | L3 |
| My robots, Results report card | a reach map per robot | not measured |
| Every page | the SANT symbol | the user (`logo-brief.md`) |
| Record | the hand-art overlay per state (§12) | the user's Poet Engineer references (plan9 T7) |

## 10. Open decisions for the user

| ID | Question | Proposal |
|---|---|---|
| O1 | Hero H1: "Show a robot once. Get the data to teach it." or "We make the data robots learn from." | The first: it names the user's action |
| O2 | Ship the plain-English repair box (N5) in Review? | Your call; it is measured (34/34) but not wired in |
| O3 | Beat 3 H2 uses counts ("17 times out of 40 instead of 3"), no ratio | Counts. The user rejected "5.7×" as the pitch |
| O4 | Show the 300-copy bar on the landing, or only on Results? | Both. Hiding the plateau would read as cherry-picking |
| O5 | Company rows in Beat 1 (P4–P6): names only, or add public figures with sources? | Names only for now |
| O6 | Dust colours at the crossing | Teal and violet only (§11.7) |
| O7 | Optional pieces: depth contours, the swarm intro, the dial HUD, an audio toggle | Dial HUD only if the sim streams the values; others later |
| O8 | "Cube" and "bin" boxes in the Record HUD? | Not on the webcam: they aren't in the camera image (§11.1) |

## 11. New UI pieces (from the visual references)

*Sections 11–13 are carried over from the sprint 8 spec; only the cross-references changed. T7 owns the Record pieces now (plan9), and the hand-art waits for the user's Poet Engineer references.*

`refs` is inspiration only. We build our own versions and copy no one's code, assets or exact
compositions. Credit the inspiration in the story footer (§3, Footer).

**Rules for every piece:**
- **Volt colours** (the sprint 8 plan):
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
| 11.4 | Count-up tiles | Results, Landing Beat 3 | *CSS Count Up Animations* |
| 11.5 | Glyph loader | Record, the crossing | Active Theory's loader |
| 11.6 | Pinch-sheet teaser | Landing Beat 6 | *Pinchable Fabric Sheet* |
| 11.7 | Dust power-on | Landing Beat 6 → Record | Active Theory's hero dust |
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
  - in the Review header (§7.2) and the Perfect panel's steps;
  - in front of each row in each demo in Dataset (§8.2).
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

### 11.4 Count-up tiles (Results and Landing Beat 3)

- **Where:** Results §1 (three tiles), and Landing Beat 3 (the two bar values).
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

### 11.6 Pinch-sheet teaser (Landing Beat 6)

- **Where:** Landing Beat 6, above **Power on →**, in a small framed panel.
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

### 11.7 Dust power-on (Landing Beat 6 → Record)

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

The hand overlay on Record (T7; the sprint 8 plan) changes style with each action. These are the six core states
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
- **The overlay's toggle** (the sprint 8 plan) turns all of this off and leaves the plain landmarks.

### 12.1 The six states

| State | When (the app's own signal) | Style | What the user sees | Label / words next to it | Reference (`refs`) |
|---|---|---|---|---|---|
| **Idle / hovering** | a hand is tracked, not recording, gripper open | **Ink along the bones:** brush strokes painted along the finger edges, thick at the joints, dry-brush at the tips | a calm inked hand that follows theirs | the live readouts only | Zach Lieberman, *Wireframe Ink* (the user's own pick) |
| **Grab (close)** | the gripper command goes to closed (pinch or fist) | **Radial bloom:** ink strokes burst out of the palm, sparse to dense | a short burst at the palm, then the hand holds amber | grasp mode reads **pinch** or **fist**; Gripper: **closed** | Zach Lieberman, *Radial Brushstroke* |
| **Release (open)** | the gripper command goes to open | **Particle burst:** streaks shoot out from the fingertips | a short burst at the fingertips, then back to idle or recording | Gripper: **open** | *Particle Burst* |
| **Recording / moving** | the sim is recording (after the countdown, §11.2) | **Particle silhouette with a luminous trail** | the hand as particles, leaving a fading trail of its path | **● Recording** pill | *Particle Figure*, *Particle Face Illustration* |
| **Paused / frozen** | palm turned away or edge-on, or low confidence: today's "Frozen" | **Rippling dot field:** calm, low energy | the hand settles into a quiet dot field; the arm holds still | amber **Frozen** pill, with "Holding still: turn your palm toward the camera to take control again." | *Dot Field Motion* |
| **Reset (✌)** | ✌ held until T6's ring fills (1.5 s, the sprint 8 plan) | **Glitch brush:** black brush forms plus pixel fragments, then a snap back | the ring fills while held; on completion a glitch, then the clean idle hand | "Hold ✌ to reset the scene", then "Scene reset" | *Glitch Brush Study* |

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

"Motion off" means `prefers-reduced-motion`, or the "Effects off" toggle (the sprint 8 plan). The global rule in §3
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
