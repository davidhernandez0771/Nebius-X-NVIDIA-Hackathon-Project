# SANT demo video: 3 minutes (v4, 2026-10-27)

<!-- v4 (2026-10-27): opens on the side-by-side LOOK clip (/look): the same scene, the raw-imitation robot vs the v2
     robot. It is an illustrative replay of picked scenes, labelled so on screen; the numbers stay the counted 0/40 and
     30/40. Shots 1 and 2 of v3 became shots 1-3; the rest moved later by a few seconds and lost a few words.
     Rewritten 2026-10-26 to lead with the pre-registered result (v2: 30/40 on fresh seeds). The 2026-10-20 version
     (the scripted 3/40 → 17/40 story and the repair A/B) is in git history.
     Every number below is in README.md "The headline result" and docs/superpowers/notes/2026-10-23-bigtest-prereg.md.
     The judges asked for: a fast "aha", graphs over text, a real problem, honesty about failures. So the result is
     on screen by 0:25, and the failures get their own beat. -->

**The path:**
1. The look: same scene, two robots.
2. The result.
2. Why demos are hard.
3. What SANT does.
4. Record.
5. The teacher, and the proof the demos mattered.
6. SANT catching the teacher.
7. The real test runs.
8. Nemotron's role.
9. The close.

**Tags:**
- **[SCREEN]:** a screen recording of the site. No backend needed.
- **[EDIT]:** a card made in the edit (text over a still), for things the site doesn't show.
- **[CHECK]:** check the number on screen against the README right before recording.

**The hackathon's video rules (submission checklist, 2026-10-27):**
- Under 3 minutes, **public on YouTube**, showing the app actually working, and explaining the Nebius + NVIDIA usage.
- **Physical AI needs at least 1 minute of footage of the robot actually operating.** The FAQ allows simulation
  instead of hardware (`docs/superpowers/notes/2026-10-15-faq-physical-ai-simulation-allowed.jpg`), so this means at
  least 60 s of the simulated arm moving. Count it on the cut:
  - shot 1, the side-by-side (12 s);
  - shot 6, live Record driving the arm (17 s);
  - shot 9, the test-track runs (27 s);
  - **plus Isaac Lab's own viewport:** about 15 s or more of a real Isaac Sim window, either the v2 policy running a
    test scene or live teleop. That puts the total well over 60 s, and judges see the actual simulator, not only
    the site's replays.
- **Upload early:** the day it's recorded, not on Friday.

**Rules for what's on screen:**
- **Never show a number that isn't in the README or the prereg.**
- **Comparisons are descriptive, never p-values.** 0/40 and 3/40 were tested on other seeds than 30/40. Say "imitating
  the raw demos gave 0 of 40"; never "SANT beat raw, p = …".
- **Nemotron is NOT in the 30/40 path.** The mouse demos passed physics as recorded (10/10), so they were verified
  and multiplied by code, with no repair. Show Nemotron for what it does (descriptions, repair proposals, scenes), and
  never as the reason for 30/40.
- **Simulation only.** Never imply a real robot.
- **The side-by-side is an illustration, not a result.** Its scenes were picked to show the difference, and the page
  says so. Every number spoken over it is a counted one (0/40, 30/40).
- **Credit v2's gain to "longer training and a gripper fix" together,** never to one of them.
- **Recording setup:**
  - 1920×1080, quality fixed with `?q=high`, on the real GPU, in a normal browser window.
  - Close Blender, Isaac, CARLA and games while recording.

## Shot list

| # | Time | Tag | Picture | Voice-over |
|---|---|---|---|---|
| 1 | 0:00–0:12 | [SCREEN] [CHECK] | `http://localhost:5173/look?embed=1&q=high`: the two robots on one clock, same scene. Left fumbles and never touches the cube; right grasps, carries, drops it in the bin. The caption "Same 10 demos. Same scene. 0/40 vs 30/40" and the kicker "Illustrative replay · picked to show the difference" stay on screen. | "Same ten sloppy demos, made with a mouse. Same scene. On the left, a robot that copied them directly. On the right, the robot SANT made from them." |
| 2 | 0:12–0:16 | [SCREEN] | `http://localhost:5173/?q=high`: the hero "SHOW A ROBOT ONCE." | "SANT turns cheap human demos into a robot that works." |
| 3 | 0:16–0:28 | [SCREEN] [CHECK] | The hero's "See the result" link → `/site/results` proof section: the climb chart builds **0 → 3 → 15 → 30 of 40**, the 60% goal line. Hold on 30/40. | "Copied directly: zero of forty new scenes. Through SANT: thirty of forty, on scenes it had never seen, in a test we registered before we ran it." |
| 4 | 0:28–0:42 | [SCREEN] | Back to the start, scroll: the forest, robots half-buried in the moss; "927 N against a 5 N limit"; the reactor powering up with S·A·N·T. | "Human demos are cheap but sloppy. Ours pressed the gripper into the bin with almost a thousand newtons. SANT checks every demo in NVIDIA Isaac Lab physics, repairs what fails, and multiplies what passes." |
| 5 | 0:42–0:55 | [SCREEN] | Through the ring into the workshop. Drag a cartridge to the machine; it plugs in; the hologram Franka replays a verified demo. | "Each cartridge is a job, and the machine replays a real, physics-checked demo." |
| 6 | 0:55–1:12 | [SCREEN] | Click "Into the projection" → `/record`: keyboard and mouse modes, the twin's three views, the alignment grid. | "You record in the browser, with a mouse, a keyboard or a webcam, driving a simulated Franka arm while the twin shows it from three sides." |
| 7 | 1:12–1:38 | [SCREEN] [CHECK] | `/site/results`, part 2: the teacher curve, **113/128 with the demos vs 0/128 without**. | "Copying ten demos isn't enough to learn a grasp. So a reinforcement-learning teacher practises in Isaac Lab, four thousand simulated arms at once, and it starts each try from the human demos. We trained it again without them: same code, same budget. It never lifted the cube." |
| 8 | 1:38–1:58 | [EDIT] [CHECK] | Card: "The teacher cheated: **1.7 m/s** → SANT's physics replay: **3/50** pass. Capped at 0.5 m/s → **50/50**." Then "distilled into a camera-only policy". | "And SANT checks the teacher too. Its first version learned to move impossibly fast. Replayed through SANT's physics check, only three of fifty runs held up. Capped to a realistic speed, all fifty passed. Then its skill is distilled into a robot that only sees through cameras." |
| 9 | 1:58–2:25 | [SCREEN] [CHECK] | `/test-track`, source "The final test · 30/40": play one success (the grasp, the carry, the drop into the bin), then one failure with its reason ("dropped"). | "These are the real test runs. Thirty succeed. Ten fail, and most of those still drop the cube. That's where we go next." |
| 10 | 2:25–2:48 | [SCREEN] | `/site/results`, "What didn't work"; then a Nemotron scene card or the Record page's Nemotron description. | "We publish what failed too, like an idea that passed none of its hundred and ten tries. NVIDIA Nemotron, on Nebius Token Factory, describes demos and proposes repairs in plain words, but it never moves the robot. Code checks, and physics decides." |
| 11 | 2:48–3:00 | [SCREEN] | Back to the hero. Title: "SANT: ten sloppy demos in, a robot that works out." The repo URL. | "Ten sloppy demos in. A robot that works out. SANT." |

## Notes for the edit

- **Numbers to check just before recording** ([CHECK] shots; shot 1 also checks the kicker is visible):
  - 0/40, 3/40, 15/40, 30/40, and the 60% goal;
  - 113/128 vs 0/128;
  - 1.7 m/s, 3/50 → 50/50;
  - 30 succeed / 10 fail; 0/110 ("passed none of its hundred and ten tries" = the held-human re-execution).
- **Don't say:**
  - "beats" or "significant" when comparing 30/40 with 0/40 or 3/40 (different seeds);
  - that Nemotron made the 30/40;
  - "the robot learned from my hand" (the demos are mouse demos);
  - anything about a real robot;
  - that DAgger helped.
- **Shot 7's "four thousand":** the teacher trains with 4,096 parallel environments on one RTX 5080. That's local, not
  Nebius. Don't say "on Nebius" for training.
- **Shot 1 depends on the LOOK clip's data** (one short Isaac run, pending on 10-27). Without it, open on shot 3.
- **Shot 9 depends on the test-track replay** of the final test (pm/test-track-final). If it isn't merged by recording
  day, use the proof section's 40-scene strip with the 10 failures marked.
- **Voice-over length:** about 390 words, about 2:50 at 140 words a minute. If it runs long:
  - cut the second sentence of shot 4;
  - cut "while the twin shows it from three sides" in shot 5.
- **Before recording:** walk the whole site once on the real GPU. The latest checks were software-rendered only.
