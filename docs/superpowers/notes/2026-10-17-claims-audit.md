# Claims audit (Sprint 7, Track T7)

- **Date:** 2026-10-17
- **Branch / worktree:** `pm/t7-audit` at `C:\dev\pm-t7`, audited at `9b781d4` (`origin/perfect-then-multiply` with
  the sprint 7 plan).
- **Scope (plan T7):** every number and claim in `README.md`, `docs/submission/**` (`description.md`,
  `video_script.md`, `feedback.md`) and `docs/media/README.md`.
- **Report only.** None of those files was edited. **T5 applies the fixes to `README.md` and `docs/submission/**`.**
  `docs/media/**` is T1's (results and media scripts); those rows are marked **T1**.
- **Ran unattended.** No Isaac, no API calls, no push, merge or rebase. The other worktrees' `data/` was read
  only, read-only, to check two media captions (E4).

**Note paths.** A bare `t1-status.md`, `t2-status.md`, `t3-status.md`, `t4-status.md` means
`docs/superpowers/notes/2026-10-15-t<N>-status.md`. `web-pages.md`, `nemotron-roles.md`, `t4-nemotron-vl.md`,
`t3-lerobot-windows.md` and `prepublish-audit.md` are the dated notes in the same folder. `spec` is
`docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md`. Line numbers are at `9b781d4`.

**Verdicts.**
- **STALE:** true when written, but a newer measurement supersedes it.
- **WRONG:** the value does not match its source.
- **UNSOURCED:** no note supports it.
- **OVERCLAIM:** the wording says more than the evidence.
- **CITE:** the value is right, but the source comment is missing or wrong.

**Severity.**
- **High:** wrong or misleading to a judge.
- **Medium:** out of date; update it.
- **Low:** a citation or cosmetic fix.

## Verdict

**The submission docs describe the project as of sprint 4.** Every number they cite matches its source note.
Sprints 5 and 6 then changed three headline facts, and the docs don't show it yet:

1. **Policy success is no longer PENDING.** In Isaac, on 20 unseen scenes, ACT scored `raw_10` **2/20** and
   `raw_multiply_10` **3/20**. That is Fisher p = 1.0: a tie, not a win for multiplying. Both cells trained on the
   **scripted expert's** demos, not human ones.
2. **The diagnosis ablation was redone fairly, and Nemotron lost to code.** A pre-registered test on 32 synthetic
   demos gave F1 **0.90** for code alone against **0.86** for the hybrid. Without the measured offset, the model
   called all 8 centered grasps off-center. Every "the model's value is still open / needs grasp negatives"
   sentence is therefore stale. **The claim sentence "A VLM's structured, timestamped diagnosis drives the
   automatic repair …" is no longer supported as written.**
3. **The home-start training set multiplied 100/100**, and the start-pose leak that the Limitations section
   still lists is fixed.

Also:
- **Two wrong facts:**
  - `README.md:647` says the backend client does not retry. It does.
  - `feedback.md:133` says Token Factory has no video input. Video was accepted in a probe.
- **One chart overclaims:** `success.svg` labels the scripted-expert cell "Raw human demos" (T1's file).

No novelty claim says "first". The spec's "to our knowledge" wording is kept everywhere it appears. The claim
it qualifies is the problem (item 2).

**Must-fix before submitting (High), in order:**
1. The policy-success status, everywhere it says PENDING or "not evaluated": the README status, pipeline table,
   Training, Chart and Limitations sections; the description's Results and PENDING list; the video's chart shot.
2. The ablation tables and their reading: the README Results and Limitations, the description, the feedback and
   the video card. Replace them with the v2 table.
3. The claim sentence, in the README, the description and the video's prior-art shot. **Rewording spec §5 is the
   user's call;** the fix below is a proposal.
4. The `success.svg` series label "Raw human demos", and its stale "pending" raw + multiply point (T1).
5. `feedback.md:133` (video input).

## Current facts (what the docs should say), with sources

| Fact | Value | Source |
|---|---|---|
| Sprint 3 ACT cells (5/10/13 clean-expert demos, each starting above its own cube) | 0/20 each on unseen scenes | t3-status.md:729-735 |
| Task A: is the 0 a bug? | raw_13: 3/5 on its own training scenes, 0/5 unseen, so it is generalization (too little data) | t3-status.md:801-822 |
| Home-start cells (ACT 10k steps, batch 8, 20 unseen scenes, seeds 5000–5019) | `raw_10` **2/20** (0.10); `raw_multiply_10` **3/20** (0.15) | t3-status.md:905-908 |
| Significance | two-sided Fisher exact p = 1.0, "a tie" | t3-status.md:914-915; recomputed in E2 |
| Wilson 95% CI (T7's computation; T1 will publish its own) | 2/20: 2.8–30.1%; 3/20: 5.2–36.0% | E2 |
| How the cells fail | multiplied: 13 `dropped` vs 4, 0 `collision` vs 9 | t3-status.md:917-920 |
| Undertraining | multiplied cell ≈ 1.5 epochs vs ≈ 16 | t3-status.md:923 |
| What the policies trained on | 10 **scripted-expert** sources (`home_start=True`), plus 100 variants | t2-status.md:897-898 |
| Home-start multiply yield | 100/100 variants, 10/10 sources, cameras; first-frame joint spread ≤ 0.0002 rad | t2-status.md:892-898, 915 |
| Grid B (`raw_5` / `raw_multiply_5`) | paused, not evaluated | t3-status.md:946-956 |
| Pre-registration (set v2) | written and committed before any v2 result | t4-status.md:1135-1222 |
| Set v2 contents | 32 demos: 8 off-center, 8 centered negatives, 6 drop, 6 bad_release, 4 clean | t1-status.md:1636-1640 |
| v2 F1, all types | rules 0.81; rules + grasp metric 0.84; **code_all 0.90**; hybrid 0.86; hybrid_blind 0.80 | t4-status.md:1323 |
| v2 per type | drop: code 1.00, both model arms 0.00. bad_release: code 1.00, hybrid 0.71, blind 0.67 | t4-status.md:1316-1317 |
| R1 bar (blind arm reads the grasp) | **fails:** recall 1.00, FP 8/8 on centered grasps | t4-status.md:1335-1338 |
| Hybrid grasp | its grasp calls are the code metric's; the arms differ on 1 episode (a fallback) | t4-status.md:1341-1343 |
| Model on releases | 20 release claims gated on verified replays; never reports `drop` | t4-status.md:1344-1348 |
| v2 spend | 68 calls, $0.1043 (hybrid 35 / $0.0544, 3 retries; blind 33 / $0.0499, 1 retry); 1 fallback | t4-status.md:1305-1310 |
| v2 limits | n = 32 synthetic, scripted demos; 128×128; one prompt | t4-status.md:1383-1388 |
| Nemotron's role | the user's decision; T4 is prototyping R6 this sprint | plan 2026-10-17 lines 31-33; t4-status.md:1376-1381 |
| Video input on Token Factory | accepted (14.1 s MP4, 2,397 tokens, $0.000776, 6.2 s) | nemotron-roles.md:52-58 |
| Backend suite, now | 1295 passed, 17 skipped, 0 failed at `9b781d4` | E1 |
| Real person at the webcam | not done yet | web-pages.md:436 |
| Second arms | OpenArm 0/30, Flexiv 9/30 multiplied (15 of Flexiv's 21 failures were the old handover swing; not re-run) | t2-status.md:513, 523, 527 |

## Findings

Count: **64 findings.**
- By file: README 20, description 17, video_script 8, feedback 13, media README 6 (T1).
- By severity: High 23, Medium 20, Low 21.
- By verdict: STALE 40, OVERCLAIM 16, WRONG 4, CITE 3, UNSOURCED 1. README.md:600-609 is both stale and an overclaim; it is counted as STALE.

**The same fix must read the same everywhere:**
- the claim sentence: use the README.md:196-200 wording in all three files;
- the v2 table;
- the policy numbers, from [Current facts](#current-facts-what-the-docs-should-say-with-sources).

### `README.md`

| file:line | claim | source (note:line) | sev | verdict | exact fix |
|---|---|---|---|---|---|
| README.md:3-5 | "Turn a noisy webcam robot demo into many … demos: NVIDIA Nemotron 3.5 Super VL diagnoses it" | No real webcam demo yet: web-pages.md:436. V2: code alone (`code_all`, F1 0.90) beats hybrid (0.86), and hybrid's grasp calls are the code metric's: t4-status.md:1323, 1341 | Medium | OVERCLAIM | Replace lines 3-5 with: "**Built to turn a noisy webcam robot demo into many physics-verified training demos: code and NVIDIA Nemotron 3.5 Super VL diagnose it, code repairs it, Isaac Lab checks it, and the verified demo is multiplied and exported for LeRobot.**" If the user changes Nemotron's role, reword to match. |
| README.md:13-23 | Status (2026-10-16): "Policy success (the headline chart) is still PENDING" | t3-status.md:907-914 (2/20 vs 3/20, p = 1.0); V2 done (t4-status.md:1299-1388); HOME (t2-status.md:892-898) | High | STALE | Replace lines 13-23 with: "> **Status (2026-10-17): work in progress.** Every stage is built and tested, and the pipeline has run end to end on a live Isaac Lab sim worker. Measured so far:<br>> - 50/50 scripted demos verify.<br>> - Multiplication yield: 30/30 (clean expert), 75/75 (degraded and perfected), 100/100 (the home-start training set).<br>> - **First policy results, too small to call:** ACT trained on 10 scripted demos succeeds on 2/20 unseen scenes; on the same 10 plus 100 multiplied variants, 3/20. Fisher p = 1.0, so this is a tie, not a win for multiplication.<br>> - In a pre-registered diagnosis test, code alone scored higher than Nemotron (F1 0.90 vs 0.86; see [Results](#results)).<br>><br>> Perfected + multiply, and the policy ablation, are still PENDING." `<!-- src: t2-status.md:892-898; t3-status.md:899-924; t4-status.md:1299-1388 -->` |
| README.md:66-75 | Hybrid: the model gets "key frames, the metrics table, the rules' findings and the code-measured grasp offset" | Sprint 5 added release facts and a verified-success gate (t4-status.md:1224-1236). The pipeline passes no `bin_pose` (t4-status.md:1238-1240; E3) | Low | STALE | Append a bullet: "- Since sprint 5 it also gets measured release facts, and any `drop` or `bad_release` claim on a replay that verified is dropped. The perfect pipeline (`app/jobs.py`) does not pass the bin pose yet, so there the model gets no release facts." |
| README.md:145 | "The format is reliable: no retries or fallbacks in 42 ablation calls." | t4-status.md:1008 (sprint 4: none in 42) vs V2: 68 calls, 3 + 1 retries, 1 fallback (t4-status.md:1305-1310) | Medium | STALE | "The format is mostly reliable: over the 110 ablation calls (42 in sprint 4, 68 in the v2 test), 4 replies needed a retry and 1 fell back to the rules (a zero-length segment)." `<!-- src: t4-status.md:1008, 1305-1310 -->` |
| README.md:147-150 | "On the 20-episode ablation, its own judgement added no measured value over code … Whether the model can earn its place, for example by reading the wrist frame, is still an open question." | V2 answered it: `hybrid_blind` called 8/8 centered grasps off-center and failed the pre-registered R1 bar (t4-status.md:1335-1338); code_all 0.90 > hybrid 0.86 (t4-status.md:1323); never reports drop (t4-status.md:1347) | High | STALE | Replace with: "- **In a pre-registered test on 32 synthetic demos (set v2), code alone beat it:** F1 0.90 for a zero-call code check, against 0.86 for the hybrid.<br>- **It does not read the grasp from the 128×128 wrist frame:** without the measured offset, it called all 8 centered grasps off-center.<br>- It never reported a `drop`; it called drops `bad_release`." `<!-- src: t4-status.md:1323, 1336, 1347 -->` |
| README.md:196-200 | Claim: "A VLM's structured, timestamped diagnosis drives the automatic repair of webcam teleoperation demos, verified by physics replay, then multiplied across positions and similar arms." | The spec wording (spec:98-102). But: code beats the VLM (t4-status.md:1323, 1367-1368); no person has recorded a webcam demo (web-pages.md:436); no second arm is demo-grade, OpenArm 0/30, Flexiv 9/30 (t2-status.md:527) | High | OVERCLAIM | Replace the quote with: "> "A structured, timestamped diagnosis of a teleoperation demo drives its automatic repair from a fixed menu; physics replay verifies every repair; and the verified demo is multiplied across positions."" Then add: "We also tested whether a VLM (Nemotron 3.5 Super VL) improves that diagnosis over code. In a pre-registered test it did not (F1 0.86 vs 0.90). The webcam recorder and two second arms are built but not yet shown working: no person has recorded a demo yet, and neither arm is demo-grade." **The user must approve this change:** it rewords spec §5. Keep "to our knowledge" and lines 202-203 as they are. |
| README.md:214 | Multiply row: "clean expert 30/30; degraded and perfected sources 75/75" | HOME: 100/100 (t2-status.md:892-898) | Medium | STALE (incomplete) | Append "; home-start training set 100/100 (10 sources × 10)". `<!-- src: t2-status.md:892-898 -->` |
| README.md:216 | Perfect pipeline: "5 human demos × raw / rules / Nemotron" | set s1 is synthetic and degraded (t4-status.md:817-819; docs/media/README.md:15-17) | Low | OVERCLAIM | Change "5 human demos" to "5 synthetic human-style demos". |
| README.md:218 | Train/eval row: "ACT trained on 5, 10 and 13 clean-expert sim episodes … **not evaluated in Isaac yet**: policy success is PENDING" | Sprint 3 cells 0/20 each (t3-status.md:729-735); Task A (t3-status.md:801-813); S6B (t3-status.md:905-914) | High | STALE | Replace the state cell with: "Built and evaluated in Isaac on 20 unseen scenes. Sprint 3 cells (5/10/13 demos): 0/20 each. Home-start cells: raw_10 2/20, raw_multiply_10 3/20 (p = 1.0, a tie). Perfected + multiply not run." `<!-- src: t3-status.md:729-735, 905-914 -->` |
| README.md:337 | "Latest run on this branch: **1090 passed, 16 skipped, 0 failed.**" | E1: 1295 passed, 17 skipped, 0 failed at `9b781d4`. The latest note says 1284 / 0 / 14 (t1-status.md:1829) | Low | STALE | "Latest run (2026-10-17, `9b781d4`): **1295 passed, 17 skipped, 0 failed.**" `<!-- src: docs/superpowers/notes/2026-10-17-claims-audit.md (E1) -->`. Re-run on the submission commit. |
| README.md:348 | Isaac-side tests: "Latest run: **539 passed, 1 skipped.**" | web-pages.md:459 (2026-10-16, on 68e4e68). Later runs cover only the sim + dp suites (500 passed, 1 skipped: t2-status.md:826) | Low | CITE (dated) | "Last run (2026-10-16, on `68e4e68`): **539 passed, 1 skipped.** Re-run before submitting." |
| README.md:454-462 | Physics results table: no row for the dataset the policies train on | HOME (t2-status.md:892-898, 915) | Medium | STALE (missing) | Add after line 461: "\| **Multiplication yield, home-start training set** \| **100/100** (10 scripted sources × 10 variants, seeds 3100–3199, cameras; every episode starts at the same home pose, spread ≤ 0.0002 rad) <!-- src: t2-status.md:892-898, 915 --> \|" |
| README.md:556-566 | Ablation table: rules 0.82, code grasp check 0.95, hybrid 0.90, Nemotron alone 0.00 (20 episodes) | These are sprint 4's values (t4-status.md:1020) and match their source. The pre-registered v2 test supersedes them (t4-status.md:1135, 1312-1331) | High | STALE | Retitle: "**Ablation, pre-registered** (set v2: 32 rendered synthetic demos, with 8 off-center grasps, 8 centered-grasp negatives, 6 drops, 6 bad releases and 4 clean; F1 over all issue types; arms and thresholds fixed before any result)". Replace the table with:<br>"\| Diagnoser \| F1, all types \| grasp recall / FP on 8 centered \| drop F1 \| bad_release F1 \| Calls / cost \|<br>\|---\|---\|---\|---\|---\|---\|<br>\| rules \| 0.81 \| 0.00 / 0/8 \| 0.00 \| 0.00 \| 0 / $0 \|<br>\| rules + code grasp check \| 0.84 \| 1.00 / 1/8 \| 0.00 \| 0.00 \| 0 / $0 \|<br>\| **code only** (grasp + release checks) \| **0.90** \| 1.00 / 1/8 \| **1.00** \| **1.00** \| 0 / $0 \|<br>\| hybrid (rules + Nemotron + gates) \| 0.86 \| 1.00 / 1/8 \| 0.00 \| 0.71 \| 35 / $0.054 \|<br>\| Nemotron without the measured offset \| 0.80 \| 1.00 / **8/8** \| 0.00 \| 0.67 \| 33 / $0.050 \|"<br>`<!-- src: t4-status.md:1312-1331 -->`. Keep sprint 4 as one sentence: "An earlier, unregistered 20-episode test (sprint 4) gave the same ordering: code grasp check 0.95, hybrid 0.90, rules 0.82, Nemotron alone 0.00." `<!-- src: t4-status.md:1020 -->` |
| README.md:568-585 | "What this says, honestly": 10 `bad_release` FPs, `slow` 0/8, and "The model's value is still open. Showing it needs a set with true negatives for the grasp … and real release, drop and wrong-object issues." | V2 is that set (t1-status.md:1636-1640; t4-status.md:1141-1146), and code still won (t4-status.md:1367-1380) | High | STALE | Replace the bullets with:<br>"- **Code alone matches or beats both model arms on every issue type.**<br>- **The hybrid's grasp calls are the code metric's.** The two differ on one episode, where the hybrid fell back to the rules.<br>- **Without the measured offset, the model fails the pre-registered bar:** it called all 8 centered grasps off-center.<br>- **On releases, the model flags too much.** The verified-success gate dropped 20 of its claims, and it never reports `drop`.<br>- **Shared misses:** every arm misses all 16 `slow` issues and 5 of 41 pauses, because timing comes from the rules.<br>- **Limits:** n = 32 synthetic demos, 128×128 frames, one prompt fixed in advance. Larger crops and real webcam scenes are untested.<br>- Which role Nemotron keeps is the user's decision."<br>`<!-- src: t4-status.md:1336-1388 -->` |
| README.md:596-598 | "ACT on real sim episodes: cells of 5, 10 and 13 … **Their Isaac evaluation has not run: policy success is PENDING.**" | t3-status.md:725-735 (0/20 ×3); t3-status.md:801-822 (Task A); S6B (t3-status.md:899-924) | High | STALE | Replace with three bullets:<br>"- **Sprint 3 cells** (5, 10 and 13 clean-expert demos, each starting above its own cube): **0/20** each on unseen scenes.<br>- **That 0 is too little data, not a bug:** the 13-demo policy succeeds on 3/5 of its own training scenes and 0/5 unseen ones.<br>- **Home-start cells, ACT 10k steps, 20 unseen scenes:** `raw_10` (10 scripted demos) **2/20** (Wilson 95% CI 3–30%); `raw_multiply_10` (the same 10 + 100 verified variants) **3/20** (5–36%). Fisher exact p = 1.0, so this is a tie. The multiplied policy grasps more often but drops the cube more (13 drops vs 4). It saw about 1.5 epochs against about 16, so it is probably undertrained."<br>`<!-- src: t3-status.md:729-735, 811-822, 905-923; CIs: claims-audit E2 -->` |
| README.md:600-609 | "### The chart: PENDING … Policy success … on 50 fixed test positions against the number of human demos (5, 10, 20)" | S6B is a measured point (n = 20, not 50), trained on **scripted-expert** sources, not human demos (t2-status.md:897) | High | STALE + OVERCLAIM | Retitle "### The chart: partly measured". Replace the block with: "> **Measured:** 10 demos, raw vs raw + multiply: 2/20 vs 3/20 on unseen scenes (p = 1.0). The demos are the **scripted expert's**, not human ones, and n is 20 per cell, not the planned 50.<br>> **PENDING:** perfected + multiply, the 5- and 20-demo points, and logged human minutes." `<!-- src: t3-status.md:905-914; t2-status.md:897; spec:44-51 -->` |
| README.md:621-622 | Limitation: "**No policy has been evaluated yet,** so the headline … is PENDING." | S6B (t3-status.md:905-914) | High | STALE | "- **Policy results are small and not significant yet:** 2/20 vs 3/20 (p = 1.0) on 20 unseen scenes, trained on scripted demos. Perfected + multiply and the policy ablation have not run." `<!-- src: t3-status.md:905-914 -->` |
| README.md:627-630 | Limitation: "Nemotron has not shown measured value over code … That set has no grasp negatives and no release, drop or wrong-object truths, so it cannot show what the model might add." | V2 has 8 grasp negatives, 6 drops and 6 bad releases (t1-status.md:1636-1640), and code still won (t4-status.md:1323) | High | STALE | "- **Nemotron did not beat code as a diagnoser.** In the pre-registered v2 test (32 demos, with grasp negatives, drops and bad releases), a zero-call code check scored F1 0.90 against the hybrid's 0.86. Without the measured offset, the model called every centered grasp off-center. Wrong-object issues and real webcam frames were not tested." `<!-- src: t4-status.md:1323, 1336, 1383-1388 -->` |
| README.md:634-635 | Limitation: "**The eval starts from the robot's default joint pose**, which may differ from where the training demos start." | Fixed in sprints 5-6: demos and evals share one home start, spread 2×10⁻⁵ rad (t2-status.md:746-760; t3-status.md:864, 886-887) | Medium | STALE | "- **Start pose:** the sprint 3 demos each started above their own cube, which leaked the cube's position into the first frame. Since sprint 6, every training demo and every eval episode starts at one shared home pose." `<!-- src: t2-status.md:746-760; t3-status.md:864, 886 -->` |
| README.md:644-648 | "about 4% … The backend's `src/app/sim_client.py` does not retry yet." | The client retries since `0b0992c` (t4-status.md:1098-1108; E3). 4% = 4/100 in one probe (t2-status.md:705) | Medium | WRONG | "This machine resets about 4% of localhost HTTP responses (4 of 100 in one probe) … The backend's `src/app/sim_client.py` retries too: up to 3 times, 10 s apart, on a reset connection or a busy worker." `<!-- src: t2-status.md:705; t4-status.md:1098-1108 -->` |

### `docs/submission/description.md`

| file:line | claim | source (note:line) | sev | verdict | exact fix |
|---|---|---|---|---|---|
| description.md:21-22 | "You record a pick-and-place demonstration by moving your hand in front of a webcam, and a simulated Franka arm … follows it." | Only the fake-hand smoke has run; no live run with a person (web-pages.md:407-437, 436) | Medium | OVERCLAIM | Append: "The record loop is built and passed an automated fake-hand smoke (376/376 steps, verified); a session with a real person is still to come." Drop that clause once the user's live session is recorded and in a note. |
| description.md:27-33 | Default hybrid: Nemotron gets key frames, the metrics … and is "asked only for what the rules never name" | V2 (t4-status.md:1367-1376) | Medium | OVERCLAIM (by omission) | After line 33 add: "   - measured on a pre-registered 32-demo set, code alone matched or beat this model on every issue type (F1 0.90 vs 0.86); see Results." `<!-- src: t4-status.md:1299-1388 -->` |
| description.md:90 | "Every stage was built test-first" | "One test came after its code" (web-pages.md:118-119) | Low | OVERCLAIM | "Every stage was built with tests, nearly all of them written first, with every AI call mocked." |
| description.md:91-93 | "1090 passed, 0 failed, 16 skipped … 178 … 539" | E1: 1295 / 0 / 17 at `9b781d4`. 178 and 539 date from 2026-10-16 on `68e4e68` (web-pages.md:456, 459) | Medium | STALE | "The backend + pipeline suite is at 1295 passed, 0 failed, 17 skipped (the skips need lerobot, torch, Isaac or a GPU)." `<!-- src: claims-audit E1 -->`. Re-run all three counts on the submission commit. |
| description.md:103-104 | "In the hybrid, it also gets the rules' findings and the measured grasp offset." | Sprint 5 added release facts (t4-status.md:1224-1240) | Low | STALE | "…the rules' findings, the measured grasp offset and the measured release facts." `<!-- src: t4-status.md:1224-1240 -->` |
| description.md:107-110 | "The 20-episode ablation cost $0.0618 for 42 calls." | Correct (t4-status.md:1002); newer t4-status.md:1305 | Low | STALE | Add: "The pre-registered 32-demo ablation cost $0.1043 for 68 calls." `<!-- src: t4-status.md:1305 -->` |
| description.md:124-132 | Challenge 4: "ablation on 20 rendered degraded episodes: rules 0.82; hybrid 0.90; code 0.95; Nemotron alone 0.00 … 10 false bad_release" | t4-status.md:1020 → V2 (t4-status.md:1323, 1336) | High | STALE | Keep items 1-3. Replace item 4 and the conclusion with: "4. Then we pre-registered a fair test: 32 demos with centered-grasp negatives, drops and bad releases, with arms, prompts and thresholds fixed before any call. Code alone scored F1 **0.90**, the hybrid **0.86**, and Nemotron without the measured offset **0.80**: it called every centered grasp off-center. In this sim pipeline, code diagnoses better than the model, and we report that as it is." `<!-- src: t4-status.md:1135-1210, 1299-1388 -->` |
| description.md:176-178 | Physics at scale: 50/50, 30/30, 75/75; no home-start yield | HOME (t2-status.md:892, 898) | Medium | STALE | Add: "  - **100/100** home-start variants (10 sources × 10, with cameras) verify. That is the dataset the policies trained on." `<!-- src: t2-status.md:886-898 -->` |
| description.md:182-184 | "a 12-demo set, then 5 human demos × raw / rules / Nemotron" | Set s1 is synthetic and degraded (t4-status.md:817-819, 839-841) | Low | OVERCLAIM | "…then 5 synthetic human-style demos (the scripted expert, degraded with ground truth) × raw / rules / Nemotron…" |
| description.md:185-187 | "An ablation that tells on itself … the code baseline wins on this set." | t4-status.md:1060 → V2 | Low | STALE | "**An ablation that tells on itself:** we pre-registered a fair test of our own model-based diagnoser against zero-call code, and published the result: code won on every issue type." `<!-- src: t4-status.md:1135-1210, 1299-1388 -->` |
| description.md:199-206 | "PENDING … ACT cells of 5, 10 and 13 clean-expert episodes are trained, but not yet evaluated in Isaac." | t3-status.md:725-731 (0/20 ×3); S6B (t3-status.md:907-914) | High | STALE | Replace 201-206 with: "> **Measured so far (one experiment, n = 20 unseen scenes per cell):** ACT trained on 10 home-start demos of the *scripted expert* (not human demos) succeeds on **2/20** (10%, 95% CI 3–30%). Trained on the same 10 plus 100 multiplied variants: **3/20** (15%, CI 5–36%). The difference is **not significant** (Fisher p = 1.0): this run shows a tie, not a gain from multiplying. Earlier cells that started above their own cube scored 0/20 at 5, 10 and 13 demos.<br>> **Still PENDING:** the spec's chart (50 test positions, 5/10/20 *human* demos, perfected + multiply), the policy ablation, and logged human minutes." `<!-- src: t3-status.md:725-731, 899-924; spec §3; CIs: claims-audit E2 -->` |
| description.md:214-224 | Table: "rules 0.82 / hybrid 0.90 / code-only grasp check 0.95 / Nemotron alone 0.00" (20 episodes); "The model's value is still open. Showing it needs a test set with grasp negatives…" | t4-status.md:1020 → V2 (t4-status.md:1323, 1336, 1367-1376) | High | STALE | Use the README.md:556-566 v2 table, or this short form: "**Diagnosis ablation, pre-registered** (32 rendered demos: 8 off-center grasps, 8 centered negatives, 6 drops, 6 bad releases, 4 clean; F1 over all issue types): code only (0 calls) **0.90**; hybrid, rules + Nemotron (35 calls, $0.054) **0.86**; rules + code grasp check **0.84**; rules **0.81**; Nemotron without the measured offset **0.80**, which called 8/8 centered grasps off-center. **Code alone matched or beat the model on every issue type.** The model never reported a `drop`, and the hybrid's grasp calls are the code metric's." `<!-- src: t4-status.md:1299-1388 -->` |
| description.md:235-240 | "Our claim, to our knowledge: *A VLM's structured, timestamped diagnosis drives the automatic repair…* … the 'VLM-driven' part of the claim is still to be shown." | V2 (t4-status.md:1367-1368: "the pre-registered test says no"); spec:98-102 | High | OVERCLAIM | Use the README.md:196-200 claim wording, verbatim. Keep "We do not claim to be the first at any of the individual pieces." Replace the last sentence with: "We also tested whether a VLM (Nemotron 3.5 Super VL) should be that diagnoser; in our pre-registered ablation, code alone matched or beat it on every issue type." **User approval needed** (spec §5). |
| description.md:237 | "…multiplied across positions **and similar arms**." | OpenArm 0/30, Flexiv 9/30 (t2-status.md:368, 592) | Medium | OVERCLAIM | Covered by the claim fix above, which drops "and similar arms". |
| description.md:254-270 | The build timeline ends with sprint 4 items | git: `e714c9a` (set v2), `151b488` (rehome), `883f623` (2/20 vs 3/20), all 2026-10-16 evening | Low | STALE | Add to 2026-10-16: "  - the frozen measurement set v2, the home start pose and `high_release`, the pre-registered v2 ablation, the 100/100 home-start multiply dataset, and the first unseen-scene policy successes (2/20 raw, 3/20 multiplied);". Add 2026-10-17 items when they land. |
| description.md:274-278 | PENDING: "the Isaac evaluation of the trained policies, which is the chart" | t3-status.md:725-731; S6B | Medium | STALE | Replace that bullet with: "the spec's chart: 50 test positions, policies trained on *human* demos at 5/10/20, including perfected + multiply (so far only scripted-expert cells at n = 20 are evaluated, and they tie);". Keep the other three bullets. |
| description.md:282-286 | What's next: "Evaluate the trained policies in Isaac … Build a diagnosis test set with grasp negatives…" | S6B; set v2 built (t1-status.md:1621-1690); V2 | Medium | STALE | Replace with: "- Evaluate on enough scenes to resolve raw vs multiplied (20 per cell cannot), and train the larger multiplied dataset to equal epochs.<br>- Record real webcam demos, and run the perfected + multiply arm.<br>- Decide Nemotron's role from measurements: it lost as a diagnoser; other roles are untested." `<!-- src: t3-status.md:919-924; t4-status.md:1365-1388 -->` |

### `docs/submission/video_script.md` (T5 is rewriting it this sprint: the new shot list must use these facts)

| file:line | claim | source (note:line) | sev | verdict | exact fix |
|---|---|---|---|---|---|
| video_script.md:4-5 | "the video must show the key application modules … above the 1-minute minimum" | Nothing in the notes, spec or plans (grep). prepublish-audit.md:209 says the video rules were "not audited" | Low | UNSOURCED | Cite the official rules page (re-read it logged in; prepublish-audit finding 12), or drop "1-minute minimum". |
| video_script.md:21 | VO: "a fifth to a third of demos get thrown away" | spec:35 ("20–30%") | Low | WRONG | "twenty to thirty percent of demos get thrown away". |
| video_script.md:25 | Card "rules 0.82, hybrid 0.90, code-only 0.95, Nemotron alone 0.00"; VO "the hybrid beats the rules … proving what the model adds is our next experiment" | t4-status.md:1020 → V2 (t4-status.md:1323, 1336) | High | STALE | Card: "Pre-registered, 32 demos, F1: code only 0.90 · rules + Nemotron 0.86 · rules 0.81 · Nemotron without the measured offset 0.80". VO: "…we ran that experiment, pre-registered. Code alone matched or beat the model on every issue type, so in this pipeline code does the diagnosing, and we say so." |
| video_script.md:26 | Card "30/30 clean, 75/75 from degraded and perfected demos" | HOME (t2-status.md:892-898) | Medium | STALE | Add "100/100 home-start variants (the training set)" to the card and the VO. |
| video_script.md:28 | Chart shot "[PENDING]"; the fallback card has no policy numbers | S6B | High | STALE | Show the measured tie: "raw_10 2/20 (10%) vs raw + 100 multiplied 3/20 (15%), n = 20 unseen scenes, p = 1.0, not significant; scripted-expert demos". Never say "multiply improves the policy". Add T3's sprint 7 numbers only once they are in a note. Never caption `success.svg` as "human demos" (see the media README findings). |
| video_script.md:29 | Claim: "a VLM's structured, timestamped diagnosis drives the automatic repair…" | V2 (t4-status.md:1367) | High | OVERCLAIM | Use the README.md:196-200 claim wording. |
| video_script.md:30 | "A webcam, a model that knows what it's looking at, and physics that checks the work." | The blind model called 8/8 centered grasps off-center (t4-status.md:1336, 1376) | High | OVERCLAIM | "A webcam, code that measures every move, and physics that checks the work. Perfect, then multiply." |
| video_script.md:47-49 | "The code-only grasp check beats the hybrid on this set, and Nemotron alone finds nothing." | V2 | Medium | STALE | "Say what the pre-registered ablation shows: code alone matched or beat both model arms on every issue type (0.90 vs 0.86 / 0.80). Do not imply the model found the grasps, drops or bad releases." `<!-- src: t4-status.md:1299-1388 -->` |

### `docs/submission/feedback.md`

| file:line | claim | source (note:line) | sev | verdict | exact fix |
|---|---|---|---|---|---|
| feedback.md:3 | "refreshed in sprint 3b and again after sprint 4" | Sprint 5-6 results exist (t4-status.md:1299; t3-status.md:899; t2-status.md:886) | Low | STALE | After the fixes, change to "refreshed in sprint 3b, after sprint 4, and in sprint 7 (v2 ablation, video probe)." |
| feedback.md:31-33 | "Through the 20-episode ablation, the usage log totals 51 calls and $0.0737." | t4-status.md:1002 (correct then); now 119 calls, $0.178014 (t4-status.md:1305) | Medium | STALE | "Through our pre-registered 32-demo ablation, the usage log totals 119 calls and $0.178." `<!-- src: t4-status.md:1305 -->` |
| feedback.md:74-77 | "the 42 ablation calls needed no retries or fallbacks" | t4-status.md:1008 (sprint 4); V2: 3 + 1 retries, 1 fallback (t4-status.md:1306-1309) | Medium | STALE | "the 42 sprint-4 ablation calls needed no retries or fallbacks. Of the 68 v2 ablation calls, 4 were retries, and one demo fell back to rules after two invalid replies (a zero-length segment)." |
| feedback.md:90-92 | "(our measurements: 3 early live diagnoses, 5 in the first pipeline run, and 42 in a 20-episode ablation)" | t4-status.md:1002; V2: 68 calls (t4-status.md:1305) | Medium | STALE | "(our measurements: 3 early live diagnoses, 5 in the first pipeline run, 42 calls in a 20-episode ablation, and 68 calls in a pre-registered 32-demo ablation)" |
| feedback.md:94-114 | "on our ablation its own judgement added nothing measurable over code"; the 20-episode F1 table (0.82 / 0.90 / 0.95 / 0.00); "The set has no grasp negatives … That question is still open." | Correct for sprint 4 (t4-status.md:1020), superseded by V2: t4-status.md:1135-1210 (pre-registration), 1323, 1336, 1341, 1344-1347, 1368, 1384 | High | STALE | Replace lines 94-114 with:<br>"- **Calibrating it is a seesaw. On a pre-registered 32-demo test, its own judgement added nothing measurable over code.**<br>- After we calibrated it against false positives (below), it kept every degraded demo: it reported 0 of 9 real issues on 3 demos, and its recall over 5 scored demos was 0.<br>- We then fixed a test in advance: 32 rendered demos (8 off-center grasps, 8 centered-grasp negatives, 6 drops, 6 bad releases, 4 clean), with arms, prompts, gates and thresholds registered before any call.<br>- F1 over all issue types:"<br>a table with columns Diagnoser \| Model calls \| F1: rules \| 0 \| 0.81; rules + code grasp check \| 0 \| 0.84; code only (grasp + release checks) \| 0 \| **0.90**; hybrid (rules + Nemotron, told the measured grasp offset) \| 35 \| 0.86; Nemotron without the measured offset \| 33 \| 0.80.<br>Then:<br>"- Without the measured offset, it called **all 8 centered grasps off-center**, so it did not read grasp centering from the 128×128 wrist frame. With the offset, its grasp calls were the code metric's.<br>- It **never reported a drop** (it labelled them `bad_release`), and a verified-success gate had to drop 20 release claims on replays that verified.<br>- Code alone matched or beat both model arms on every issue type. Limits: 32 synthetic, scripted demos; 128×128 frames; one prompt."<br>`<!-- src: t4-status (sprint 3 Task 3; sprint 5 Task 1a pre-registration; sprint 6 Task 1 results); t1-status (sprint 4 Task 2, "s1 compare") -->` |
| feedback.md:121-122 | "One sample does not give a false-positive rate, and recall is not measured yet." | Recall measured since: 0 at n = 20 (t4-status.md:1043); 0 on 5 (t1-status.md:1521) | Medium | STALE | "One sample does not give a false-positive rate. Recall was measured later: the calibrated prompt alone scored 0 on 20 degraded episodes (see above)." |
| feedback.md:127-128 | "… but it never interpolated." | One sample, anecdotal (t4-nemotron-vl.md:33, 36-40) | Low | OVERCLAIM | "but in that one call it did not interpolate." |
| feedback.md:133-134 | "There is no video input (the modality is text+image→text), so we sample key frames. Native short-video input would suit robot demos well." | **Video works:** a 14.1 s MP4 sent as `video_url` was accepted, 2,397 + 63 tokens, $0.000776, 6.2 s (nemotron-roles.md:52-58) | High | WRONG | "- **Video input works, but the listing doesn't say so.** The modality field says `text+image->text`, yet a `video_url` part was accepted (a 14.1 s, 10 fps, 256×256 MP4: 2,397 prompt tokens, $0.000776, 6.2 s). Please list video in the modality field and document its format and limits. In our one probe, it got the outcome and the gripper-open time (11.0 s vs 10.96 s) but missed two 0.85 s pauses." `<!-- src: docs/superpowers/notes/2026-10-16-nemotron-roles.md (Probe 1) -->` |
| feedback.md:139-142 | "Here that means segment labels and, still to be shown, wrong object, drops and grasp quality from the wrist view." | Wrist-view grasp fails the bar (t4-status.md:1336); drop 0/6, never reported (t4-status.md:1323, 1347); R6/R4/R2 unmeasured (t4-status.md:1376-1381) | High | STALE | "- In this sim pipeline, code sees almost everything. On our pre-registered test, the model did not detect drops (0/6) or read grasp centering from the wrist frame, and code matched or beat it on every issue type. What is left is segment labels (unscored), video-only demos with no sim state, and language tasks, none of them measured yet." `<!-- src: t4-status (sprint 6 Task 1); docs/superpowers/notes/2026-10-16-nemotron-roles.md -->` |
| feedback.md:166-167 | "27/30 at first … 30/30 clean, and 75/75 from degraded and perfected demos." | Values correct (t2-status.md:224, 639, 728); newer: home-start 100/100 (t2-status.md:892-898) | Low | STALE | Append: ", and 100/100 for the home-start training set (10 sources × 10 variants, with cameras)." |
| feedback.md:201-203 | "confines a vertical grasp to a ~0.2 m height band" | "~0.15–0.2 m height band" (t2-status.md:302-303) | Low | WRONG | Replace "~0.2 m height band" with "~0.15–0.2 m height band". |
| feedback.md:205-207 | "The near-massless finger bodies slip or drag the cube, so it scored only 9/30 multiplied." | 15 of the 21 failures were the old handover swing; 6 were grip slips (t2-status.md:523); the finger masses need a re-tune (t2-status.md:617) | Medium | OVERCLAIM | "The near-massless finger bodies slip or drag the cube. It scored 9/30 multiplied, but most of the 21 failures (15) came from our old handover swing, since fixed and not re-run; the other 6 are grip slips. Realistic finger masses need a grip re-tune." `<!-- src: t2-status (sprint 3 Task 3 and final summary, Open items 2-3) -->` |
| feedback.md:211-214 | "Isaac Sim 6.2.0.0 + Isaac Lab `release/3.0.0` on Python 3.12" (src: "Versions per the task brief") | t2-status.md:4; prepublish-audit.md:177; fix-windows-tests.md:85 | Low | CITE | Replace the src comment with: `<!-- src: spec §6; t2-status (header: Isaac Lab 3.0.0 / Isaac Sim 6.2 / Python 3.12); 2026-10-16-prepublish-audit.md (Task 3: Isaac Sim 6.2.0.0); 2026-10-16-fix-windows-tests.md (Verification) -->` |

### `docs/media/README.md` and the charts (owned by **T1**, not T5; T1 is refreshing the charts this sprint)

| file:line | claim | source (note:line) | sev | verdict | exact fix |
|---|---|---|---|---|---|
| docs/media/README.md:12 | "s1_0002 side by side: 4.6 MB → 0.96 MB" | Not in a note. The message of commit `eeb4397` says "4.58 -> 0.96 MB"; the file is 963,401 B now | Low | CITE | Append "(commit `eeb4397`)". |
| docs/media/README.md:31 | "The rules name the timing issues, not the off-center grasp; that one is the hybrid diagnoser's job (T4, sprint 4)." | V2: the hybrid's grasp calls are the code metric's (t4-status.md:1341); the code check finds it with 0 calls (t4-status.md:1323) | Low | STALE | "…not the off-center grasp. The code-measured grasp offset catches that one; the hybrid's grasp calls are that metric's (T4, v2)." |
| docs/media/README.md:41 | `success.svg`: "Raw + multiply at 10 (10 sources + 100 variants) … **pending**" | `raw_multiply_10` = 3/20 (0.15), evaluated by 22:12 (t3-status.md:899, 908). T1's last refresh was at ~22:00 (t1-status.md:1793-1829). The SVG still draws it as `class="pending"` (E5) | High | STALE | **T1:** rebuild with the same `--run-id`, and change the row to: "Raw at 10 demos: 10% (2/20) and raw + multiply at 10: 15% (3/20), on unseen scenes, seed0 5000. Fisher p = 1.0: not a significant difference." Source: `registry.jsonl` row 5 and `evals\sprint6_home_a_20261016_205725\raw_multiply_10.json`. |
| docs/media/charts/success.svg (legend "Raw human demos", axis "human demos"); docs/media/README.md:41 | The plotted raw_10 cell is "human demos" | The 10 sources are the **scripted expert** (`home_start=True`), with no human and no degradation (t2-status.md:897; t3-status.md:862-863) | High | OVERCLAIM | **T1:** label the series "Raw demos (scripted expert)" and the axis "demos", or add a subtitle: "demos: scripted expert, home start". Add to the row: "These demos are the scripted expert's, not human ones." **T5:** never caption this chart as human demos. |
| docs/media/README.md:41 | "the project's first non-zero" | The 3/5 on raw_13's own training scenes came first (t3-status.md:812) | Low | OVERCLAIM | "the project's first success on unseen scenes" (the wording of t3-status.md:912). |
| docs/media/README.md:43 | `yield.svg`: Franka 100%, "MimicGen's published 38–74% is shown beside it" | The value matches t2-status.md:898. But the comparison crosses tasks: "Our 90% is higher, but the task is easier" (t2-status.md:252), and the chart has no caveat (E5) | Low | OVERCLAIM (by omission) | Add to the row: "MimicGen's tasks are harder (here: one 5 cm cube and a large open bin), so this is context, not a like-for-like comparison." **T1:** consider the same subtitle on the chart. |

## Verified OK

Every claim below was checked against the cited line and matches. Keep these as they are, unless a fix above
rewrites the surrounding text.

### `README.md`

| file:line | claim | source (note:line) |
|---|---|---|
| README.md:8-9 | simulation only, allowed by the FAQ | the screenshot `docs/superpowers/notes/2026-10-15-faq-physical-ai-simulation-allowed.jpg` exists |
| README.md:15-18 | 50/50; 30/30; 34/75 → 75/75 | t2-status.md:316, 639, 728 |
| README.md:29-30 | $6k–$80k, $25–$50/h, 20–30% (vendor estimates) | spec:32-35 |
| README.md:38-43 | GIF: 13.8 s → 9.3 s; tremor, two pauses, slowness, idle; synthetic | t1-status.md:1500; E4 (s1_0002 truth: idle 0.61 s, 2 pauses, slow ×1.39) |
| README.md:48 | red 5 cm cube, blue bin, Franka | spec:62 |
| README.md:58-62 | MediaPipe, ~30 Hz, WebSocket relay, Start/Stop save | web-pages.md:220-405 |
| README.md:77-80 | repair menu; `remove_pause` jump < 1 cm | spec §8.4 |
| README.md:100-101 | `nvidia/Nemotron-3.5-Super-VL`, ID echoed | t4-nemotron-vl.md:8-9 |
| README.md:107-111 | ≤ 8 images (HTTP 400); 7 front + 1 wrist; thinking off | t4-nemotron-vl.md:15-17 |
| README.md:117-120 | retry once, then the rules fallback, `diagnosis_source: "rules"` | t4-status.md:70, 82, 222 |
| README.md:121-129 | metric gate; 3.3 mm = sprint 2 IK tracking error at the close | t2-status.md:365; t4-status.md:922 |
| README.md:132-136 | 3,269 / 390 / $0.001332 / 2.52 s; 3,595 / 633 / $0.001648 / 3.9 s; 3,990 / 188 / $0.001366 / 2.3 s | t4-nemotron-vl.md:25; t4-status.md:287, 371-375 |
| README.md:139-142 | $0.30 / $0.90 per 1M; 263 tokens per image; $0.0013–$0.0016 | t4-nemotron-vl.md:13, 28-30 |
| README.md:146 | segmentation is good (6 segments vs 3) | t4-status.md:376-378 |
| README.md:155-157 | scene: Franka HIGH_PD, 5-cuboid bin, contact sensors, two 128×128 cameras | t2-status.md:26, 53-57 |
| README.md:160-164 | feedforward: 26.8 → 2.1 mm; 16.0 → 3.3 mm at the close; ≈ 0.2 s lag; IK iterations change nothing | t2-status.md:123-125, 138, 365 |
| README.md:168-171 | `/replay`, `/multiply`, `/health`; 409 busy; resume by seed; keep-awake | t2-status.md:407-424, 669 |
| README.md:172-174 | teleop at 50 Hz; pause on tracking loss | web-pages.md:245-357 |
| README.md:179-183 | lerobot 0.6.1, v3.0, passports; ACT | t3-lerobot-windows.md; t3-status.md:6 |
| README.md:189-194, 202-203 | prior-art list; ISR +25%; never claim "first" | spec:91-96, 104-109 |
| README.md:209 | fake-hand smoke 376/376; no real person yet | web-pages.md:415-417, 436 |
| README.md:213 | Verify 50/50 | t2-status.md:316 |
| README.md:215 | OpenArm 0/30, Flexiv 9/30 | t2-status.md:513, 527 |
| README.md:216 | Perfect pipeline ran live: 12-demo set; grid accepted by the dry run | t4-status.md:817-884 |
| README.md:229-231 | venvs outside OneDrive; `UV_LINK_MODE=copy`; os errors 5/396 | spec Changes; sprint1 plan |
| README.md:277 | first launch took 37 s | t2-status.md:29 |
| README.md:278-279 | xyzw quaternions at the sim boundary | t2-status.md:51 |
| README.md:295-305 | pyav; static FFmpeg 9.0; WinError 1314; wrapper; 1,000 steps, 4 saves, exit 0 | t3-lerobot-windows.md:67-73, 109; t3-status.md:33, 90-91 |
| README.md:378-384 | 376/376, 19.1 ms per step, live + replay verified; cameras not measured | web-pages.md:415-425, 434 |
| README.md:427 | 178 web tests (dated) | web-pages.md:456 |
| README.md:456-462 | 50/50, 13 s; 8/8; 20/20 median 38.0 s, 5980 MiB; 26.8 → 2.1; 30/30, 9.8 s, was 27/30; 75/75 from 34/75; smoke 376/376 | t2-status.md:203, 340-343, 365-366, 639-640, 728; web-pages.md:417 |
| README.md:466-470 | raw 12/25, rules 10/25 (5 `sim_error`), Nemotron 12/25 → 25/25 each | t2-status.md:687-689 |
| README.md:474-481 | 0.31–0.42 m swing, ≤ 1.0 m reach; after: ≤ 0.020 m, ≤ 0.714 m | t2-status.md:696-698 |
| README.md:482-489 | sleep at 16:46:29, the same second; replayed directly, 5/5 succeed; `SetThreadExecutionState`; retry once | t2-status.md:655, 662-663, 669-675 |
| README.md:490-493 | the task is easier than MimicGen's 38–74% | t2-status.md:252; spec:53 |
| README.md:497-503 | Flexiv 9/30 vs 0/30, 5/30 scripted; grip physics + handover; bin y ≥ −0.25; re-run pending | t2-status.md:513-528; t1-status.md:1389, 1406 |
| README.md:508-517 | OpenArm: within 4 mm below ~0.20 m; 1.0–1.2 mm at the close; 0/30, 2/30; 22 fail on `unreachable` (3–4.5 cm for > 1 s); ±45° wrist, ~0.15–0.2 m band | t2-status.md:300-318 |
| README.md:522-528 | rules F1 0.00 → 0.97–0.99 at 1–4 mm, P ≥ 0.99, 0.98 held-out; 60-demo set: 54 of 57 misses, F1 0.85 | t1-status.md:708, 714, 956, 959 |
| README.md:529-540 | calibration: 5 false → 0, `keep`, $0.0014, 2.3 s; the gate alone removes all 5; 6 segments | t4-status.md:369-378 |
| README.md:541-545 | live run: 3 demos, 9 true issues, 0 reported; recall 0 on 5; rules 0.81 | t4-status.md:829; t1-status.md:1519-1521 |
| README.md:550-553 | degraded_0004 GIF; 11.8 mm off-center | t1-status.md:1503; E4 |
| README.md:589-595 | ACT smoke: 300/300, 20.7 steps/s, 0.99 GB; eval-harness smoke 0/3, full 30 s | t3-lerobot-windows.md:91-95; t3-status.md:419-430 |
| README.md:611-615 | policy ablation PENDING | still true: no rules_multiply / perfected_multiply cells (E5) |
| README.md:623-626 | every "human" demo is synthetic; no real person yet | docs/media/README.md:15-17; web-pages.md:436 |
| README.md:631-633, 636-643, 649-650 | rules on synthetic tremor; one task, sim only; Windows workarounds; sleep; 16 GB, 1 env | t1-status.md:729-784; spec §4, §11; t2-status.md:669-675 |
| README.md:673-681 | SANT history; reused parts | git `1b0f357` (2026-09-13) |

### `docs/media/README.md`

| file:line | claim | source (note:line) |
|---|---|---|
| docs/media/README.md:3 | made on 2026-10-16 | git log: `512e846`, `eeb4397` (2026-10-16) |
| docs/media/README.md:5 | each file ≤ 2 MB, enforced by a test | `tests/test_dp_media.py:127-132`; the largest file is 963,401 B |
| docs/media/README.md:15-17 | all human demos are synthetic | t2-status.md:551-572; E4 (`"synthetic": true`) |
| docs/media/README.md:23-25 | s1_0002 13.8 → 9.3 s, 0.6 s idle, two pauses; s1_0003 10.6 → 7.8 s | t1-status.md:1500-1501; E4 |
| docs/media/README.md:31 | degraded_0004: 14.1 s, 2 mm, two pauses, ×1.27, 1.2 s idle at each end, 11.8 mm | t1-status.md:1503; E4 |
| docs/media/README.md:41 | raw_10 = 10% (2/20, seed0 5000); sprint 3 cells left out with `--run-id` | t3-status.md:907; t1-status.md:1793-1810 |
| docs/media/README.md:42 | ablation chart: both pending | E5 |
| docs/media/README.md:43 | yield 100% (100/100), replacing 27/30; 30/30 under `others` | t2-status.md:898; t1-status.md:1812-1820 |
| docs/media/README.md:56-60 | s1: rules P = R = 1.00 on its types, recall 0.81; calibrated Nemotron recall 0 | t1-status.md:1519-1521 |
| docs/media/README.md:62-81 | v2: 32 demos, SHA `21d82eac…`; F1 0.81 / 0.84 / 0.90 / 0.86 / 0.80; R1 pass/fail; 35 / $0.054, 33 / $0.050; drop 1.00 vs 0.00; bad_release 1.00 vs 0.71 / 0.67; 8/8 centered; the hash-bug deviation fixed before any scored call | t4-status.md:1141-1142, 1272-1297, 1305-1307, 1316-1338, 1368 |

### `docs/submission/description.md` and `video_script.md`

| file:line | claim | source (note:line) |
|---|---|---|
| description.md:10-11 | $6k–$80k rigs, $25–$50/h, 20–30% discarded (vendor estimates) | spec:32-35 |
| description.md:24, 35-38, 44 | 0.5 s windows; fixed repair menu; success definition; "the AI decides, code acts, physics checks" | spec:27, 187, 268, 291 |
| description.md:48-55 | four web pages; Review has three lanes and a Perfect button | web-pages.md:18-20, 34, 447 |
| description.md:64-69 | prompt from the pydantic schema; 1 retry; gate; rules fallback | t4-status.md (sprint 2 Task 5); commit `2002a37` |
| description.md:71-77 | sim worker: cameras, diff-IK + feedforward, one job at a time, resumable, keep-awake, teleop sink | t2-status.md:365, 407-450, 669; web-pages.md:286-357 |
| description.md:86-88 | v3.0 export, symlink-free wrapper, runner, policy server | t3-status.md:88-206 |
| description.md:98-102 | model ID; 7 front + 1 wrist frame; ≤ 8 images | t4-nemotron-vl.md:8-9, 15-17 |
| description.md:107-108 | $0.0013–$0.0016, 2.3–3.9 s, 263 tokens per image | t4-nemotron-vl.md:25, 28; t4-status.md:287, 371, 375 |
| description.md:111-113 | the batch stops itself, resumably, before passing its budget | t4-status.md:623-629 |
| description.md:118-121 | 5 false issues → clean; all 9 real issues missed; recall 0 on 5 | t4-status.md:369-371, 829; t1-status.md:1518-1521 |
| description.md:133-153 | IK lag 26.8 → 2.1 mm; handover cause, ≤ 0.42 m swing, ≤ 1.0 m reach; 27/30 → 30/30, 34/75 → 75/75; sleep root cause; ~4% resets | t2-status.md:122-125, 365, 639-640, 655-676, 696, 705-709, 728 |
| description.md:155-165 | OpenArm ±45°, 0/30; Flexiv 9/30; tremor F1 0.00 and its fix; 8-image limit, 11 planned; Isaac Lab 3.0 differences | t2-status.md:51, 61-62, 302-303, 368, 592; t1-status.md:367, 543, 608; t4-nemotron-vl.md:15-17 |
| description.md:167-170 | WinError 1314; torchcodec → PyAV; OneDrive venvs | t3-lerobot-windows.md:67-73, 108-115 |
| description.md:176, 179-180 | 50/50, 20/20; easier than MimicGen | t2-status.md:252, 316, 340 |
| description.md:188-197 | fake-hand smoke 376/376, 19.1 ms; ACT 20.7 steps/s, < 1 GB; null → "pending" | web-pages.md:157, 200, 415-425; t3-lerobot-windows.md:91-95 |
| description.md:210-212, 225 | 30/30 (from 27/30), 75/75 (from 34/75); OpenArm 0/30, Flexiv 9/30 | t2-status.md:368, 592, 639-640, 728 |
| description.md:230-232 | prior-art list | spec:91-96 |
| description.md:246-273 | spec commit `8072315` (2026-10-15); 10-15 and 10-16 work items; SANT started 2026-09-13 | git `8072315`, `48013cd`…`e0f92d6`, `ae0829b`, `f1e21d9`, `1b0f357` |
| description.md:290-291 | Built-with list | README:153-183, 307-325 |
| video_script.md:13 | 20 + 25 + 15 + 15 = 75 s | the shot rows |
| video_script.md:23-24 | fake-hand `ok: true`, 376/376; `SUMMARY {"n": 50, "successes": 50}` | web-pages.md:415-417; t2-status.md:179, 316 |
| video_script.md:26-28 | 13.8 → 9.3 s; 20.7 steps/s; MimicGen 38–74%; OpenArm 0/30, Flexiv 9/30 | docs/media/README.md:23; t3-lerobot-windows.md:92; spec:53; t2-status.md:368, 592 |
| video_script.md:34-41, 50-51 | 7184 MiB in a camera run; keep-awake caveats; the demos are synthetic | t2-status.md:26, 669-670; docs/media/README.md:15-17 |

### `docs/submission/feedback.md`

| file:line | claim | source (note:line) |
|---|---|---|
| feedback.md:6-8 | Windows 11, RTX 5080 16 GB; sim-only Physical AI | t2-status.md:4; spec:5 |
| feedback.md:15-26 | model ID; multi-image calls; listing fields (1,048,576 context, us-north1, 2M tok/min, 300 req/min, prices, free) | t4-nemotron-vl.md:8-13; t4-status.md:9, 25 |
| feedback.md:28-29 | $0.0013–$0.0016, 2.3–3.9 s per 8-image call | t4-nemotron-vl.md:25; t4-status.md:287, 375 |
| feedback.md:37-53 | 8-image HTTP 400 (exact text), 11 planned; `pricing.image="0"`, 263 tokens/image ≈ $0.000079; empty sampling params but `temperature` accepted; `enable_thinking` | t4-nemotron-vl.md:12-18, 28-29; sprint1 plan:601 |
| feedback.md:67-88 | 7 + 1 frames, strict JSON; valid first try; segments finer than the rules' 3; 2.3–3.9 s; 5 → 0 false issues, 633 → 188 tokens, $0.001648 → $0.001366 | t4-nemotron-vl.md:17-18, 35; t4-status.md:281-308, 369-378 |
| feedback.md:96-102 | 0 of 9 on 3 demos; recall 0 on 5; sprint 4 hybrid details (true for that run; replaced by the rewrite) | t4-status.md:827, 1027-1037; t1-status.md:1521 |
| feedback.md:116-132 | first prompt `repair` with 5 false issues; calibration; "gripper remains open" misread; 2 invented idles; pause bounds; prompt rewording | t4-status.md:290-300, 369-425; t4-nemotron-vl.md:36-45 |
| feedback.md:151-171 | scene; go/no-go in ~16 min; 16 s / 4172 MiB, 47 s / 7184 MiB; 287 N / 116 N; 50/50, 20/20, 38.0 s, 5980 MiB; 27/30 → 30/30, 75/75; tutorials as API reference | t2-status.md:3, 25-43, 53-57, 224, 340-343, 366, 639, 728 |
| feedback.md:175-199 | `--viz kit`; xyzw; glob filters; nested paths, mimic joint; process exit; one sensing body; 26.8 → 2.1 mm, PD-damping cause | t2-status.md:51, 54, 62, 70, 82, 88-90, 122-138, 365 |
| feedback.md:201-203, 208 | OpenArm 0/30 vs Franka 27/30 (30/30 after the fix); asset download 37 s | t2-status.md:29, 224, 310, 639 |
| feedback.md:224-262 | v3.0 + ACT; 300/300, 20.7 steps/s, 0.99 GB, loss 14.974 → 2.994; spawn workers; WinError 1314 and the wrapper; torchcodec / FFmpeg 9.0; export constraints, extras | t3-lerobot-windows.md:11-29, 68-72, 92-95, 109; t3-status.md:16, 33-58, 82, 90-91, 251 |
| feedback.md:278-301 | OneDrive os errors 5/396; 5 `sim_error` in 8.3 s, Kernel-Power 42, 5/5 replayed; keep-awake; ~4% resets, retries | spec:472-474; t2-status.md:645-675, 705-706 |

## Evidence

### E1. Fresh test run

```
$ git rev-parse --short HEAD          # 9b781d4
$ uv run pytest -q -p no:cacheprovider   # SANT venv C:\venvs\pm-t7
1295 passed, 17 skipped, 2 warnings in 149.76s (0:02:29)
```

- The 2 warnings are a `SyntaxWarning` for the `"\l"` escape in a docstring, `lerobot_tools/tests/test_start_state.py:2`.
- The latest count in the notes was 1284 / 0 / 14 (t1-status.md:1829). The README still says 1090 / 0 / 16.
- The web and Isaac-side suites were not re-run. Isaac is T3's this sprint, and the plan forbids it for T7.

### E2. Confidence intervals and significance (computed, stdlib only)

- **Wilson 95%, z = 1.959964:**
  - 2/20 → **0.028–0.301**;
  - 3/20 → **0.052–0.360**.
- **Two-sided Fisher exact, 2/20 vs 3/20:** **p = 1.0**, which matches t3-status.md:914.
- The intervals overlap almost entirely. 20 scenes per cell cannot separate 10% from 15%.
- T1's `stats.py` and power note (sprint 7) will be the canonical numbers. **T5 should prefer T1's once committed.**

### E3. Code checks behind two README claims

- **`src/app/sim_client.py:80-81, 107-115`** has `retries: int = 3` and `retry_wait_s: float = 10.0`, applied to
  every call except `/health`. That makes "does not retry yet" (`README.md:647`) wrong. It was added in
  `0b0992c` (t4-status.md:1098).
- **`src/app/jobs.py:387-388`** calls `diagnose_hybrid(...)` with no `bin_pose`. The pipeline hybrid therefore
  gets no release facts, as t4-status.md:1238-1240 says.

### E4. Media captions against the truth files (read-only)

- **`C:\dev\pm-t4\data\sets\s1\s1_0002\truth.json`:**
  - `idle_start_s` 0.607;
  - `n_pauses` 2;
  - jitter 2.78 mm;
  - slow ×1.39.

  This matches "0.6 s of idle at the start", "two pauses" and "tremor" (`docs/media/README.md:23`).
- **`C:\dev\pm-t2\data\episodes\degraded_0004\truth.json`:**
  - `jitter_mm` 2.0;
  - idle 0–1.205 s and 12.862–14.04 s;
  - 2 pauses (not don't-care);
  - grasp_off_center.

  This matches "2 mm tremor, two pauses, 1.2 s of idle at each end, 14.1 s" (`docs/media/README.md:31`).
  ×1.27 and 11.8 mm are from t1-status.md:1503.

### E5. The committed charts

- **`docs/media/charts/success.svg`:**
  - one filled point, at x = 10, y = 274.8 (= 10%, raw_10);
  - raw + multiply at 10 is drawn as `class="pending"`;
  - the legend reads "Raw human demos" and the axis "human demos".
- **`yield.svg`:** Ours 100%, MimicGen 38–74%, with no caveat.
- **`ablation.svg`:** both bars pending, which is correct: no rules_multiply / perfected_multiply cells exist.

## Decisions (made without asking)

1. **Sprint-4 numbers that match their source are STALE, not WRONG.** They were measured, but a pre-registered
   test superseded them. The fixes keep them as one line of history, so no measurement disappears.
2. **The claim sentence is flagged, and a reworded claim is proposed, not decided.** Spec §5 is the user's
   wording, and Nemotron's role is the user's decision (plan lines 31-33). The proposal states only what was
   measured.
3. **CIs:** I computed them (E2) so that the fixes are paste-ready today. T1's `stats.py` is the canonical
   source once it lands.
4. **`docs/media/**` rows go to T1,** who owns the results and media scripts and is refreshing the charts this
   sprint. T5 only needs to avoid repeating those overclaims.
5. **Two forked sub-agents** checked `feedback.md` and `description.md` + `video_script.md` in parallel. I
   spot-checked their highest-impact evidence: nemotron-roles.md:52-58 (video accepted) and t2-status.md:523
   (15 of 21 Flexiv failures were the handover swing).
6. **Test counts** come from a fresh run (E1), not the notes.

## Progress

- 2026-10-17: plan found on the first poll; audit written and committed for T5.
