# Video shot list: 3 minutes

<!-- Rewritten 2026-10-17 (sprint 7, T5 Task 1) from the 2026-10-16 notes: T3's sprint 6 Task B
     (raw vs multiplied), T2's sprint 6 Task 2 (100/100 multiply yield) and T4's sprint 6 Task 1
     (the pre-registered v2 diagnosis ablation). Sprint 7 runs (grid B, 30k-step training, more
     episodes) were still in progress when it was written; see "Refresh before recording".
     Shots 3-7 (0:30-1:45) show the application modules in action, 75 s in all. The official
     rules' video requirements are not in our notes: re-read the rules page, logged in, before
     recording (2026-10-16-prepublish-audit.md, finding 12; claims audit, video_script.md:4-5). -->

Every shot has one tag:

- **[READY]** can be recorded today from files in the repo (`docs/media/*`) or from saved runs.
- **[LIVE]** needs the live hand-teleop session with a person at the webcam. **The user records
  these.** Each has a [READY] fallback.
- **[REFRESH]** shows a number that a sprint 7 run may change. Record it last, from the newest
  note.
- **[USER DECISION]** depends on the role the user picks for Nemotron after the v2 ablation.

**Rules for what's on screen:**

- Every number must match the note cited in its row.
- Never show a SAMPLE DATA page, or a "pending" value, as if it were measured.
- Say that the "human" demos are synthetic: the scripted expert, degraded with ground truth.
  Only the [LIVE] shots show a real hand. <!-- src: docs/media/README.md -->

## Shot list

| # | Time | Tag | Picture | Voice-over |
|---|---|---|---|---|
| 1 | 0:00–0:15 | [READY] | Title card "Perfect, then multiply". Cut to a hand moving in front of a laptop webcam (any phone clip). | "Robots learn from human demonstrations, and they need a lot of them. Teleop rigs cost six to eighty thousand dollars, and twenty to thirty percent of demos get thrown away. A webcam is free, but webcam demos are noisy." <!-- src: spec §2 (vendor estimates, not our measurements) --> |
| 2 | 0:15–0:30 | [READY] [USER DECISION] | Pipeline diagram: record → measure → diagnose → repair → verify → multiply → export → train. Highlight **Isaac Lab** on verify and multiply. The Nemotron label follows the user's decision (see "Nemotron wording" below). | "Our pipeline measures a noisy demo, repairs it, checks it in physics, then multiplies it into many verified demos for training. The rule: code acts, physics checks." |
| 3 | 0:30–0:50 | [LIVE] | **Module 1, Record.** The webcam view and the Record page (`/pm/record`) next to the Isaac Franka following the hand (`teleop_sink.py --viz kit`). Press Start recording, then Stop and save; the "Review …" link appears. **Fallback [READY]:** the Record page with the mirrored hand skeleton and relay status, then the terminal of the automated fake-hand run (`teleop_sink.py --fake-hand --no-cameras`) ending in `RESULT_JSON {"ok": true, ...}`, 376/376 steps. | "You move your hand; MediaPipe tracks it in the browser, the backend relays it, and the simulated arm follows. Stop saves the recording as a demo." <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md (Task 3 follow-up: 376/376, ok) --> |
| 4 | 0:50–1:05 | [READY] | **Module 2, Verify.** An Isaac Lab replay: the cube goes into the bin. Then the terminal lines `RESULT_JSON {"success": true, ...}` and `SUMMARY {"n": 50, "successes": 50, ...}`. Footage: the recorded front and wrist frames of any verified episode (for example `C:\dev\pm-t2\data\episodes\home_src_3000`). | "Every demo is replayed in Isaac Lab with real contacts, and code decides success: cube in the bin, gripper open, cube settled, no collision. Fifty scripted demos out of fifty pass." <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 1 smoke; sprint 2 Task 3: 50/50) --> |
| 5 | 1:05–1:20 | [READY] | **Module 3, Measure + repair.** `docs/media/degraded_0004_rules_timeline.gif` (diagnosis strip under the frames), then `docs/media/s1_0002_raw_vs_perfected.gif`: the same demo raw (13.8 s) and perfected (9.3 s) on one clock, both marked done. | "Code measures the demo and names the pauses, the shaking and the idle time. Repairs come from a fixed menu: here the pauses and idle are cut and the tremor smoothed, from 13.8 to 9.3 seconds, and the repaired demo still succeeds in physics." <!-- src: docs/media/README.md (degraded_0004; s1_0002 13.8 s → 9.3 s, both replays succeeded) --> |
| 6 | 1:20–1:35 | [READY] | **Module 4, Multiply.** `docs/media/charts/yield.svg`: Ours 100% beside MimicGen's published 38–74%. Overlay: "100/100 variants verified (10 sources × 10)". Then a card: "Degraded and perfected sources: 75/75, up from 34/75 after the carry fix". | "A verified demo is moved to new cube and bin positions, and every variant is replayed again. All hundred variants of our ten home-start sources verified. Our task is easier than MimicGen's, so the honest claim is this: failures never reach the dataset, and each one has a named reason." <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 6 Task 2: 10/10 sources, 100/100 variants; sprint 4 Task 3: 34/75 → 75/75); MimicGen range: spec §3 --> |
| 7 | 1:35–1:45 | [READY] | **Module 5, Export + train.** The LeRobot dataset folder (`meta/`, `data/`, `videos/`), then the ACT training log on Windows. | "Only verified demos are exported to LeRobot, each with a passport of where it came from, and ACT trains on them natively on Windows: 20.7 steps a second on one RTX 5080." <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md (20.7 steps/s); t2-status (sprint 6 Task 2: Passport per episode) --> |
| 8 | 1:45–2:15 | [READY] [REFRESH] | **The result, as it stands.** A card with two bars and their counts, on 20 unseen scenes, same home start, same 10k training steps: **raw 10 demos 2/20 (10%)**, **10 demos + 100 multiplied 3/20 (15%)**, with Wilson 95% CIs 3–30% and 5–36%. Under it: "Fisher exact p = 1.0: not a significant difference" and "demos: scripted expert, not human". Never caption it, or `success.svg`, as human demos, and never say "multiply improves the policy". Then one line: "Multiplied policy: 13 drops, 0 collisions; raw: 4 drops, 9 collisions". Use `docs/media/charts/success.svg` only once it shows both points and no "human demos" label (T1, sprint 7); on this branch it still draws the multiplied point as pending and labels the series "Raw human demos". Optional B-roll for "why more data": T3's sprint 6 Task A GIFs, a training scene where the policy places the cube (`C:\dev\pm-t3\data\evals\sprint6_taskA\raw_13_train_vs_unseen_frames\seed_0_front.gif`) vs an unseen scene where it never goes to the cube (`seed_5000_front.gif`). To put them in `docs/media/`, keep each under 2 MB: `seed_5000_front.gif` is 2.7 MB, so trim or re-encode it first. | "Does multiplying help the robot learn? Here's what we measured. On twenty unseen scenes, ten raw demos give two successes; with a hundred multiplied variants, three. That's not a significant difference: it's a tie. The multiplied policy reaches and grasps more often, but drops the cube on the way. It saw eleven times the data in the same ten thousand steps, so it's probably undertrained. That's the run we're doing next." <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md (sprint 6 Task B 22:12: 2/20 vs 3/20, p = 1.0, failure reasons, ~1.5 vs ~16 epochs; sprint 6 Task A: frames); CIs: docs/superpowers/notes/2026-10-17-power.md (T1); scripted-expert sources: t2-status (sprint 6 Task 2) --> |
| 9 | 2:15–2:40 | [READY] [USER DECISION] | **Nemotron, tested honestly.** A table card from the pre-registered v2 test (32 rendered demos, F1 over all issue types): code only **0.90**; rules + Nemotron **0.86**; Nemotron without the measured offset **0.80**; rules **0.81**. Highlight two cells: "blind Nemotron called 8/8 centered grasps off-center" and "drop: code 1.00, Nemotron 0.00". Footer: "68 calls, $0.10; arms, prompts and thresholds fixed before any scored call". Then the role shot, per the user's decision (see below). | "We use NVIDIA Nemotron 3.5 Super VL on Nebius Token Factory, and we tested where it earns its place. In a pre-registered test on thirty-two demos, plain code scored 0.90; adding the model scored 0.86. Without the measured grasp offset, it called every centered grasp off-center. Code alone matched or beat the model on every issue type, so in this pipeline code does the diagnosing, and we say so." Then the role sentence (see below). <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 6 Task 1 RESULTS: F1 table, false positives on negatives, spend 68 calls $0.1043, deviations); docs/media/README.md (v2 table) --> |
| 10 | 2:40–2:52 | [READY] [USER DECISION] | Prior-art slide: MimicGen, SkillGen, DemoBridge, ISR, DQAF, handrobot / AnyTeleop. Then the claim sentence (see below). | "We build on MimicGen, SkillGen, DemoBridge, ISR, DQAF and webcam teleop work." Then the claim. <!-- src: spec §5 --> |
| 11 | 2:52–3:00 | [READY] | Closing card: repo URL, "NVIDIA Nemotron 3.5 Super VL · Nebius Token Factory · Isaac Sim 6.2 / Isaac Lab 3.0 · LeRobot". | "A webcam, code that measures every move, and physics that checks the work. Perfect, then multiply." <!-- src: claims audit (video_script.md:30) --> |

Module time (shots 3–7): 20 + 15 + 15 + 15 + 10 = 75 s.

## Nemotron wording ([USER DECISION])

The pre-registered v2 test failed R1 (Nemotron as a diagnoser) against its bar. The spec's
claim, "A VLM's structured, timestamped diagnosis drives the automatic repair …", is no longer
supported as written. <!-- src: t4-status (sprint 6 Task 1, "What this means for Nemotron's role"); spec §5 -->
The user picks the role. The rule still requires a runtime Token Factory call. <!-- src: docs/superpowers/notes/2026-10-16-nemotron-roles.md ("Rule constraint") -->

- **Shot 2 diagram label:** put Nemotron on the step it actually runs in for the submitted
  pipeline. Do not label "diagnose" with Nemotron unless the user keeps the hybrid.
- **Shot 9 role sentence:** only if the user adopts R6 and T4's sprint 7 prototype has a
  measured result, say what it measured (model vs keyword baseline, exact-match and per-op F1),
  from T4's note. Until then, leave the sentence out. Do not describe R6 as working.
- **Shot 10 claim:** use the README's claim wording (T7's proposal; it rewords spec §5, so
  the user must approve it): "What's new, to our knowledge: a structured, timestamped
  diagnosis of a teleoperation demo drives its automatic repair from a fixed menu; physics
  replay verifies every repair; and the verified demo is multiplied across positions." Keep
  the spec's never-claim list (first webcam teleop, first demo repair, first VLM demo
  critique, first demo multiplication).
  <!-- src: docs/superpowers/notes/2026-10-17-claims-audit.md (README.md:196-200; video_script.md:29) -->

## Refresh before recording

Sprint 7 is re-running the policy experiments. Before recording shot 8:

1. Read T3's sprint 7 entries in `docs/superpowers/notes/2026-10-15-t3-status.md`:
   - grid B (`raw_5` / `raw_multiply_5`);
   - 10k vs 30k steps for `raw_10` and `raw_multiply_10`;
   - any extended-n eval.
2. Read T1's power note (`docs/superpowers/notes/2026-10-17-power.md`) for what n = 20 can and
   cannot show, and put the Wilson 95% interval under each bar.
3. Show the newest measured cells. If 30k steps changes nothing, say so; a tie stays a tie.
4. Re-render `docs/media/charts/*` (commands in `docs/media/README.md`) and use the chart only
   if it shows no "pending" point for the bars in the voice-over.

## Recording notes

- **GPU:** record the Isaac shots on the RTX 5080 with one environment. A single camera run
  needed 7184 MiB of GPU memory, so close other GPU apps first, including a running sim
  worker server. Don't record while T3 holds the GPU. <!-- src: t2-status -->
- **Sleep:** turn Windows sleep off for the session. Between jobs, and in other scripts, the PC
  can sleep, and a sleep mid-run kills CUDA. <!-- src: t2-status (sprint 2 Task 6; sprint 4 Task 2) -->
- **The Record page needs the MediaPipe assets** in `web/public/` (README, Setup step 4). A
  fresh clone has no hand model. <!-- src: docs/superpowers/notes/2026-10-16-prepublish-audit.md (finding 7) -->
- **Say what the pre-registered ablation shows:** code alone matched or beat both model arms
  on every issue type (0.90 vs 0.86 / 0.80). Do not imply the model found the grasps, drops
  or bad releases. <!-- src: t4-status (sprint 6 Task 1) -->
- **Don't re-run the ablation or `diagnose_real_episode.py` for the video.** Every run is
  billed. Use the saved tables. <!-- src: t4-status (sprint 6 Task 1: spend) -->
- **There is no video of the `raw_10` / `raw_multiply_10` eval episodes.** Don't present other
  footage as theirs; the Task A GIFs are a different checkpoint (`raw_13`, sprint 3 data).
  <!-- src: t3-status (sprint 6 Task B: "there is no video for these cells"; Task A) -->
