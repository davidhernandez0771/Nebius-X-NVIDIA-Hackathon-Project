# Video script: 3 minutes (DRAFT)

<!-- Draft written 2026-10-16, refreshed in sprint 3b, and again after sprint 4.
     Physical AI rule for sim-only entries: the video must show the key application modules
     in action. This script gives them 1:35 (0:35–2:10), above the 1-minute minimum. -->

Every shot is tagged:

- **[READY]** can be recorded today from what exists in the repo.
- **[PENDING]** depends on work not built or measured yet. Re-record it, or replace it with
  its listed fallback.

The four [READY] module shots add up to 75 s (20 + 25 + 15 + 15). The [PENDING] Record shot
has a [READY] fallback, so the modules get the full 1:35 either way.

Numbers on screen must match the cited notes. **Never show the sample Results page as if it
were measured**: it carries a SAMPLE DATA banner for a reason.

| Time | Shot (screen) | Voice-over |
|---|---|---|
| **0:00–0:15** | Title card: "Perfect, then multiply". Cut to a hand moving in front of a laptop webcam. | "Robots learn from human demonstrations, and they need a lot of them. Collecting them is expensive: teleop rigs cost six to eighty thousand dollars, and a fifth to a third of demos get thrown away." <!-- src: spec §2 (vendor estimates) --> |
| **0:15–0:35** | Diagram: record → measure → diagnose → repair → verify → multiply → export → train. Highlight "Nemotron 3.5 Super VL on Nebius Token Factory" and "Isaac Lab". | "A webcam is free, but webcam demos are noisy. Our pipeline perfects a noisy demo, checks it in physics, then multiplies it. The rule: the AI decides, code acts, physics checks." |
| **0:35–0:55** | **Module 1, Record.** [PENDING: first live run with a person] The webcam view and the Record page next to the Isaac Franka following the hand (`teleop_sink.py --viz kit`). Press Start recording, then Stop and save; a "Review …" link appears. **Fallback [READY]:** the Record page (`/pm/record`) with the mirrored hand skeleton and relay status, then the terminal of the automated fake-hand run, `teleop_sink.py --fake-hand --no-cameras`, ending in `RESULT_JSON {"ok": true, ...}` with 376/376 steps. | "You move your hand; MediaPipe tracks it in the browser, the backend relays it, and the simulated arm follows. Stop saves the recording as a demo." <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md (Sprint 3c T5 Tasks 1-4; Task 3 follow-up: 376/376, ok) --> |
| **0:55–1:15** | **Module 2, Verify in Isaac Lab.** [READY] Isaac Lab replay of the scripted pick-and-place: the cube goes into the bin. Then the terminal line `RESULT_JSON {"success": true, ...}`, then the batch line `SUMMARY {"n": 50, "successes": 50, ...}`. Recording option: run `smoke_replay.py` with `--viz kit` (**unverified flag for this script**), or play the recorded front and wrist PNG frames from `data/smoke_cam`. | "Every demo is replayed in Isaac Lab with real contacts, and pure code decides success: cube in the bin, gripper open, cube settled, no collisions. Fifty scripted demos out of fifty pass." <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 1 smoke; sprint 2 Task 3: 50/50) --> |
| **1:15–1:40** | **Module 3, Diagnose.** [READY] `docs/media/degraded_0004_rules_timeline.gif`: a degraded demo with the diagnosis strip under it. Then the ablation table as a card: rules 0.82, hybrid 0.90, code-only grasp check 0.95, Nemotron alone 0.00 (F1, 20 degraded episodes). | "The rules detector finds the pauses, the shaking and the idle time. For what it can't name, an off-center grasp, we ask Nemotron 3.5 Super VL on Nebius Token Factory, giving it key frames, the wrist view and a measured grasp offset. We measured it honestly: the hybrid beats the rules, but on this test set a code-only grasp check does even better, and the model alone finds nothing. Proving what the model adds is our next experiment." <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 4 Task 3); docs/media/README.md --> |
| **1:40–1:55** | **Module 4, Repair + multiply.** [READY] `docs/media/s1_0002_raw_vs_perfected.gif`: the same demo raw (13.8 s) and perfected (9.3 s), on one clock. Then a card: "Multiplied and re-verified: 30/30 clean, 75/75 from degraded and perfected demos". | "Code applies the repairs from a fixed menu: here pauses and idle time are cut and the tremor smoothed, and the demo still succeeds. Then the verified demo is moved to new cube and bin positions, and every variant is verified again. After we fixed how the carry is re-planned, thirty of thirty clean variants pass, and seventy-five of seventy-five from degraded demos." <!-- src: docs/media/README.md (13.8 s, 9.3 s); t2-status (sprint 4 Tasks 1, 3) --> |
| **1:55–2:10** | **Module 5, Export + train.** [READY] The LeRobot dataset folder (`meta/`, `data/`, `videos/`) and the ACT training log running on Windows. | "Only verified demos are exported to LeRobot, each with a passport of where it came from, and ACT trains on them natively on Windows, at 20.7 training steps a second on one RTX 5080." <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md (20.7 steps/s) --> |
| **2:10–2:35** | **THE CHART GOES HERE.** [PENDING] The web Results page (`/pm/results`) once `GET /results` serves measured policy success, with no SAMPLE DATA banner: policy success on 50 test positions against human demos (5, 10, 20), raw vs raw + multiply vs perfected + multiply, then the policy ablation at 10 demos. **Fallback [READY], measured only:** a card with multiply 30/30 and 75/75 (MimicGen's published 38–74% for context, on a harder task), the diagnosis ablation, and the second arms as an honest negative: OpenArm 0/30, Flexiv 9/30. | **[PENDING: write after measuring.]** State the measured result, including a negative one. Fallback: "Every variant we keep is physics-verified, and the ones that fail are kept out with a reason. Policy results are still being measured. On second arms, the OpenArm's wrist limits and the Flexiv's gripper physics still hold them back, and we report that too." <!-- src: spec §3; t2-status (sprint 2 Task 5; sprint 3 Task 3; sprint 4 Tasks 1, 3); t4-status (sprint 4 Task 3); t3-status (sprint 3 Task 4: eval not run) --> |
| **2:35–2:50** | Prior-art slide: MimicGen, SkillGen, DemoBridge, ISR, DQAF, handrobot/AnyTeleop. Then the claim sentence. | "We build on MimicGen, SkillGen, DemoBridge, ISR, DQAF and webcam teleop work. What's new, to our knowledge: a VLM's structured, timestamped diagnosis drives the automatic repair of webcam demos, verified by physics replay, then multiplied." <!-- src: spec §5 --> |
| **2:50–3:00** | Closing card: repo URL, "NVIDIA Nemotron 3.5 Super VL · Nebius Token Factory · Isaac Sim 6.2 / Isaac Lab 3.0 · LeRobot". | "A webcam, a model that knows what it's looking at, and physics that checks the work. Perfect, then multiply." |

## Recording notes

- **GPU:** record the Isaac shots on the RTX 5080 with one environment. A single camera run
  needed 7184 MiB of GPU memory, so close other GPU apps first, including a running sim
  worker server. <!-- src: t2-status -->
- **Sleep:**
  - The sim worker and the batch scripts keep the PC awake while a job runs.
  - For a recording session, still turn Windows sleep off: between jobs, and in other
    scripts, the PC can sleep, and a sleep mid-run kills CUDA.
  <!-- src: t2-status (sprint 2 Task 6; sprint 4 Task 2) -->
- **The Record page needs the MediaPipe assets** in `web/public/` (README, Setup step 4).
  A fresh clone has no hand model. <!-- src: docs/superpowers/notes/2026-10-16-prepublish-audit.md (finding 7) -->
- **Do not re-run `diagnose_real_episode.py` or the ablation just for the video.** Every
  run is billed. Use the saved results and the tables in the notes.
  <!-- src: t4-status sprint 2 Task 6; Diagnoser calibration; sprint 4 Task 3 -->
- **Say what the ablation shows.** The code-only grasp check beats the hybrid on this set,
  and Nemotron alone finds nothing. Do not imply the model is what found the off-center
  grasps. <!-- src: t4-status (sprint 4 Task 3, "What this says, honestly") -->
- **Say that the demos are synthetic.** The scripted expert, degraded with ground truth;
  no real webcam demo has been recorded yet. <!-- src: docs/media/README.md -->
- **Before recording 2:10–2:35:**
  - Check that `/pm/results` shows **no** SAMPLE DATA banner.
  - If it does, use the measured-only fallback card instead.
  - Update the README's [Results](../../README.md#results) section to match whatever is
    shown.
