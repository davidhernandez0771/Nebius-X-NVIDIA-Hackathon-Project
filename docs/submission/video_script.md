# Video script: 3 minutes (DRAFT)

<!-- Draft written 2026-10-16, refreshed in sprint 3b with the merged sprint 2-3 results.
     Physical AI rule for sim-only entries: the video must show the key application modules
     in action. This script gives them 1:35 (0:35–2:10), above the 1-minute minimum. -->

Every shot is tagged:

- **[READY]** can be recorded today from what exists in the repo.
- **[PENDING]** depends on work not built or measured yet. Re-record it, or replace it with
  its listed fallback.

The three [READY] module shots alone add up to 60 s (20 + 25 + 15). Both [PENDING] module
shots also have [READY] fallbacks, so the modules get the full 1:35 either way. Numbers on
screen must match the cited notes. **Never show the sample Results page as if it were
measured**: it carries a SAMPLE DATA banner for a reason.

| Time | Shot (screen) | Voice-over |
|---|---|---|
| **0:00–0:15** | Title card: "Perfect, then multiply". Cut to a hand moving in front of a laptop webcam. | "Robots learn from human demonstrations, and they need a lot of them. Collecting them is expensive: teleop rigs cost six to eighty thousand dollars, and a fifth to a third of demos get thrown away." <!-- src: spec §2 (vendor estimates) --> |
| **0:15–0:35** | Diagram: record → measure → diagnose → repair → verify → multiply → export → train. Highlight "Nemotron 3.5 Super VL on Nebius Token Factory" and "Isaac Lab". | "A webcam is free, but webcam demos are noisy. Our pipeline perfects a noisy demo, checks it in physics, then multiplies it. The rule: the AI decides, code acts, physics checks." |
| **0:35–0:55** | **Module 1, Record.** [PENDING] Webcam view with hand landmarks next to the Isaac Franka following the hand. **Fallback [READY]:** the web Record page (`/pm/record`) with the mirrored hand skeleton inside the workspace box, its framing hints and relay status, plus `GET /teleop/status`. | "You move your hand; MediaPipe tracks it in the browser, and the backend relays the pose to the simulator, which maps it to a gripper target." <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md --> |
| **0:55–1:15** | **Module 2, Verify in Isaac Lab.** [READY] Isaac Lab replay of the scripted pick-and-place: the cube goes into the bin. Then the terminal line `RESULT_JSON {"success": true, ...}`, then the batch line `SUMMARY {"n": 50, "successes": 50, ...}`. Recording option: run `smoke_replay.py` with `--viz kit` (**unverified flag for this script**), or play the recorded front and wrist PNG frames from `data/smoke_cam`. | "Every demo is replayed in Isaac Lab with real contacts, and pure code decides success: cube in the bin, gripper open, cube settled, no collisions. Fifty scripted demos out of fifty pass." <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 1 smoke; sprint 2 Task 3: 50/50) --> |
| **1:15–1:40** | **Module 3, Diagnose with Nemotron.** [READY] The 7 front frames + 1 wrist frame sent to the model. Split screen on the same clean episode: the first prompt's reply (5 issues, `repair`) next to the calibrated reply (0 issues, `keep`). Overlay: "$0.0014 · 2.3 s per diagnosis". Then the Review page's timeline for a demo, with a gated claim struck through. Sources: `data/diagnose_real_episode/result.json` and `data/diagnose_real_episode/calibrated/result.json` (git-ignored, on the machine that ran them). | "Nemotron 3.5 Super VL, on Nebius Token Factory, sees seven key frames, a wrist view at the grasp, and the motion metrics, and returns a structured, timestamped diagnosis. Our first prompt made it see five problems in a perfect demo. We calibrated the prompt and added a gate that drops any claim the measurements contradict: the same demo now comes back clean." <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2 Task 6: 5 false positives; Diagnoser calibration: 0 issues, keep, $0.001366, 2.3 s) --> |
| **1:40–1:55** | **Module 4, Repair + multiply.** [PENDING] Before/after of one repaired webcam demo (a pause removed), then a grid of variants with new cube and bin positions replaying in Isaac. **Fallback [READY]:** a repair-op unit test run (`remove_pause`, `smooth`), then the multiply terminal line `YIELD {"attempts": 30, "successes": 27, ...}`. | "Code applies the repairs from a fixed menu, then moves the verified demo to new cube and bin positions. Every variant is verified again: twenty-seven of thirty pass, and the three that don't are kept out with a named reason." <!-- src: t2-status (sprint 2 Task 4: 27/30, reasons unreachable 3) --> |
| **1:55–2:10** | **Module 5, Export + train.** [READY] The LeRobot dataset folder (`meta/`, `data/`, `videos/`) and the ACT training log running on Windows. | "Only verified demos are exported to LeRobot, each with a passport of where it came from, and ACT trains on them natively on Windows, at 20.7 training steps a second on one RTX 5080." <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md (20.7 steps/s) --> |
| **2:10–2:35** | **THE CHART GOES HERE.** [PENDING] The web Results page (`/pm/results`) once `GET /results` serves measured data, with no SAMPLE DATA banner: policy success on 50 test positions against human demos (5, 10, 20), raw vs raw + multiply vs perfected + multiply, then the ablation at 10 demos (rules-only vs rules + Nemotron). **Fallback [READY], measured only:** a card with the multiplication yield, 27/30 = 90% next to MimicGen's published 38–74%, and the OpenArm's 0/30 as an honest negative. | **[PENDING: write after measuring.]** State the measured result, including a negative one. Fallback: "Our multiply-and-verify loop keeps ninety percent of variants on the Franka. On a second arm, the OpenArm, its wrist limits make it fail our workspace, and we report that too." <!-- src: spec §3; t2-status (sprint 2 Tasks 4, 5) --> |
| **2:35–2:50** | Prior-art slide: MimicGen, SkillGen, DemoBridge, ISR, DQAF, handrobot/AnyTeleop. Then the claim sentence. | "We build on MimicGen, SkillGen, DemoBridge, ISR, DQAF and webcam teleop work. What's new, to our knowledge: a VLM's structured, timestamped diagnosis drives the automatic repair of webcam demos, verified by physics replay, then multiplied." <!-- src: spec §5 --> |
| **2:50–3:00** | Closing card: repo URL, "NVIDIA Nemotron 3.5 Super VL · Nebius Token Factory · Isaac Sim 6.2 / Isaac Lab 3.0 · LeRobot". | "A webcam, a model that knows what it's looking at, and physics that checks the work. Perfect, then multiply." |

## Recording notes

- Record the Isaac shots on the RTX 5080 with one environment. A single camera run needed
  7184 MiB of GPU memory, so close other GPU apps first. <!-- src: t2-status -->
- **Turn Windows sleep off before recording long Isaac runs.** A sleep mid-batch once
  killed CUDA. <!-- src: t2-status (sprint 2 Task 6) -->
- **Do not re-run `diagnose_real_episode.py` just for the video.** It refuses once its
  result file exists, and every run is a billed call. Use the two saved `result.json`
  files. <!-- src: t4-status sprint 2 Task 6; Diagnoser calibration -->
- **Say it is one episode.** The 5 → 0 result is a single sample; recall is not measured
  yet. Do not claim a false-positive rate. <!-- src: t4-status (Diagnoser calibration, "Limits, honestly") -->
- Before recording 2:10–2:35, check that `/pm/results` shows **no** SAMPLE DATA banner. If
  it does, use the measured-only fallback card instead, and update the README's
  [Results](../../README.md#results) section to match whatever is shown.
