# Video script: 3 minutes (DRAFT)

<!-- Draft written 2026-10-16. Physical AI rule for sim-only entries: the video must show the
     key application modules in action. This script gives them 1:35 (0:35–2:10), above the
     1-minute minimum. -->

Every shot is tagged:

- **[READY]** can be recorded today from what exists in the repo.
- **[PENDING]** depends on work not built or measured yet. Re-record it, or replace it with
  its listed fallback.

The three [READY] module shots alone add up to 60 s (20 + 25 + 15). Both [PENDING] module
shots also have [READY] fallbacks, so the modules get the full 1:35 either way. Numbers on
screen must match the cited notes.

| Time | Shot (screen) | Voice-over |
|---|---|---|
| **0:00–0:15** | Title card: "Perfect, then multiply". Cut to a hand moving in front of a laptop webcam. | "Robots learn from human demonstrations, and they need a lot of them. Collecting them is expensive: teleop rigs cost six to eighty thousand dollars, and a fifth to a third of demos get thrown away." <!-- src: spec §2 (vendor estimates) --> |
| **0:15–0:35** | Diagram: record → measure → diagnose → repair → verify → multiply → export → train. Highlight "Nemotron 3.5 Super VL on Nebius Token Factory" and "Isaac Lab". | "A webcam is free, but webcam demos are noisy. Our pipeline perfects a noisy demo, checks it in physics, then multiplies it. The rule: the AI decides, code acts, physics checks." |
| **0:35–0:55** | **Module 1, Record.** [PENDING] Webcam view with hand landmarks next to the Isaac Franka following the hand. **Fallback [READY]:** browser hand tracking, plus `GET /teleop/status` showing the relay, plus the hand→target mapping tests passing. | "You move your hand; MediaPipe tracks it in the browser, and the backend relays the pose to the simulator, which maps it to a gripper target." |
| **0:55–1:15** | **Module 2, Verify in Isaac Lab.** [READY] Isaac Lab replay of the scripted pick-and-place: the cube goes into the bin. Then the terminal line `RESULT_JSON {"success": true, ...}`. Recording option: run `smoke_replay.py` with `--viz kit` (**unverified flag for this script**), or play the recorded front and wrist PNG frames from `data/smoke_cam`. | "Every demo is replayed in Isaac Lab with real contacts. Pure code decides success: cube in the bin, gripper open, cube settled, no collisions. This 7.5-second demo passes." <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md --> |
| **1:15–1:40** | **Module 3, Diagnose with Nemotron.** [READY] The 7 front frames + 1 wrist frame sent to the model. Then its JSON reply scrolling (segments, issues), next to the rules detector's `keep`. Overlay: "$0.0016 · 3.9 s per diagnosis". Source: `data/diagnose_real_episode/result.json` (git-ignored, from the one real run). | "Nemotron 3.5 Super VL, on Nebius Token Factory, sees seven key frames, a wrist view at the grasp, and the motion metrics, and returns a structured, timestamped diagnosis. Its segmentation is excellent. But on this clean demo it also flagged five issues that aren't there, so we gate its claims against the measured metrics." <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md sprint 2 Task 6 ($0.001648, 3.9 s, 5 false positives) --> |
| **1:40–1:55** | **Module 4, Repair + multiply.** [PENDING] Before/after trajectory plot of one repair (a pause removed), then a grid of variants with new cube and bin positions replaying in Isaac. **Fallback [READY]:** a repair-op unit test run (`remove_pause`, `smooth`) and a plot of the multiply transform from the tested code. | "Code applies the repairs from a fixed menu, then moves the verified demo to new cube and bin positions. Every variant is verified again." |
| **1:55–2:10** | **Module 5, Export + train.** [READY] The LeRobot dataset folder (`meta/`, `data/`, `videos/`) and the ACT training log running on Windows. | "Only verified demos are exported to LeRobot, each with a passport of where it came from, and ACT trains on them natively on Windows, at 20.7 training steps a second on one RTX 5080." <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md (20.7 steps/s) --> |
| **2:10–2:35** | **THE CHART GOES HERE.** [PENDING] Policy success on 50 test positions against human demos (5, 10, 20): raw vs raw + multiply vs perfected + multiply. Then the ablation bar at 10 demos (rules-only vs rules + Nemotron) and the multiplication yield next to MimicGen's 38–74%. | **[PENDING: write after measuring.]** State the measured result, including a negative one. <!-- src: spec §3 --> |
| **2:35–2:50** | Prior-art slide: MimicGen, SkillGen, DemoBridge, ISR, DQAF, handrobot/AnyTeleop. Then the claim sentence. | "We build on MimicGen, SkillGen, DemoBridge, ISR, DQAF and webcam teleop work. What's new, to our knowledge: a VLM's structured, timestamped diagnosis drives the automatic repair of webcam demos, verified by physics replay, then multiplied." <!-- src: spec §5 --> |
| **2:50–3:00** | Closing card: repo URL, "NVIDIA Nemotron 3.5 Super VL · Nebius Token Factory · Isaac Sim 6.2 / Isaac Lab 3.0 · LeRobot". | "A webcam, a model that knows what it's looking at, and physics that checks the work. Perfect, then multiply." |

## Recording notes

- Record the Isaac shots on the RTX 5080 with one environment. The camera run needed
  7184 MiB of GPU memory, so close other GPU apps first. <!-- src: t2-status -->
- **Do not re-run `diagnose_real_episode.py` just for the video.** It refuses once its
  result file exists, and every run is a billed call. Use the saved `result.json`.
  <!-- src: t4-status sprint 2 Task 6 -->
- **Keep the false-positive finding in the cut** unless a later, gated run replaces it with
  measured numbers. It is the honest answer to "why AI?".
- Before recording 2:10–2:35, replace the PENDING row with the measured chart, and update the
  README's [Results](../../README.md#results) section to match.
