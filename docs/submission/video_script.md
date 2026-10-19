# SANT demo video: 3 minutes

<!-- Rewritten 2026-10-19 for the merged site (the journey at /, the hologram Record at /record with the hand
     lock and the 3D twin, Results at /site/results). It replaces the sprint 6/7 shot list, whose policy
     numbers (2/20 vs 3/20) are out of date; that version is in git history. Every number below is in
     docs/submission/README.md's Results table, with its note. -->

**The path:** the site journey → the workshop → Record with a live hand → the hologram twin → the results.

**Tags:**
- **[SCREEN]** a screen recording of the site, no backend needed (the twin replays
  `web/public/world/demo-episode.json`, a sim-verified episode).
- **[LIVE]** needs the live session: backend, Isaac Lab sink and a person at the webcam
  ([live-test-10](../superpowers/notes/2026-10-19-live-test-10.md) has the four terminals). Only one Isaac
  process at a time. Each [LIVE] shot has a [SCREEN] fallback.
- **[CHECK]** confirm the number on screen matches the README's Results table before recording.

**Rules for what's on screen:**
- Never show a number that isn't in the README's Results table, and never show sample data as measured.
- Say once, clearly, that the policy result was trained on scripted demos, not human ones.
- The human-demo experiment is PENDING. Don't imply it ran.
- Record at 1920×1080 with the site's quality tier fixed (no tier change mid-shot). Close Blender and any other
  GPU renderer while Isaac runs.

## Shot list

| # | Time | Tag | Picture | Voice-over |
|---|---|---|---|---|
| 1 | 0:00–0:12 | [SCREEN] | `http://localhost:5173/`: the loader, then the logo's particles and the ring. | "Robots learn by copying people. They need thousands of demonstrations, and today each one costs a teleop rig and an operator's time." |
| 2 | 0:12–0:35 | [SCREEN] | Scroll slowly through the intro's breaks: the problem, then S·A·N·T (Simulate, Augment, Neaten, Train), then the proof, then what you can do. Hold one second on each slab. | "SANT starts from the cheapest sensor there is: a webcam. You show the task once with your hand. SANT checks it in physics, repairs it, multiplies it into many verified copies, and has NVIDIA Nemotron label what you did. Out comes a standard LeRobot dataset." |
| 3 | 0:35–0:55 | [SCREEN] | The descent over the skylight, the dive into the workshop, then the spiral of cartridges with the robot arm in the middle. Hover one cartridge so its detail shows; use a filter once. Optionally type a question in "Ask SANT" and let it jump to a section. | "Each cartridge is a robot and a task. The arm in the middle is the robot we test on: a Franka in NVIDIA Isaac Lab." |
| 4 | 0:55–1:08 | [SCREEN] | Click a cartridge: it plugs into the machine, the projection lights the wall, and the zoom opens Record. | "Plug in a cartridge, and you're in the recording studio." |
| 5 | 1:08–1:40 | [LIVE] | `/record`. Click Start camera. A hand comes into view; the lock chip shows the hand locked. Move the hand: the Isaac Lab Kit window (picture-in-picture or split) and the twin pane, tagged `LIVE`, follow. Bring a second hand in: nothing moves. Pinch to grasp, carry, release over the bin. Stop and save. **Fallback [SCREEN]:** the same page with the twin tagged `REPLAY`, playing the verified episode; say "a recorded demo" instead of "my hand". | "MediaPipe tracks my hand in the browser, and the simulated arm follows it live. SANT locks onto one hand, so a second hand in the frame moves nothing. I pick up the cube and drop it in the bin. Stop, and it's saved as a demo." |
| 6 | 1:40–1:58 | [LIVE] / [SCREEN] | Close on the hologram twin: rotate it once. Then Review: the verdict card (physics result, Nemotron's label, the repairs applied). | "The 3D twin is the robot's own model, drawn from its URDF. Isaac Lab replays every demo with real contacts, and code decides if it worked. Nemotron 3.5 Super VL, on Nebius Token Factory, says what the person did; physics says whether it worked." |
| 7 | 1:58–2:35 | [SCREEN] [CHECK] | `/site/results`: the three arms with their intervals, then the scene-by-scene replay filling the 40 squares per arm. Overlay in the edit if the page lacks it: **3/40 vs 17/40, p = 0.0005**, seeds 5020–5059, and the caption "source demos: scripted expert". Then the 10×30 arm: **16/40, p = 0.0012**. | "Does it help the robot learn? We trained the same policy twice: on ten demos, and on the same ten plus a hundred physics-verified copies. On forty scenes it had never seen, fixed in advance, it went from three successes to seventeen. A separately trained set with three hundred copies gave sixteen. These source demos were scripted, not human; running the same test on real webcam demos is next." |
| 8 | 2:35–2:50 | [SCREEN] [CHECK] | Two cards. **Nemotron, tested:** labeler 40/40, judge 59/60, both pre-registered, about a tenth of a cent per call. **Bring your robot:** the report cards, Franka 30/30, OpenArm 0/30 with its wrist joint named as the cause. | "We test our own claims. Nemotron labeled forty of forty clips and judged fifty-nine of sixty pairs, as well as simple code but in words. And any robot's URDF gets a report card: the Franka passes thirty of thirty; the OpenArm fails, and the card says why." |
| 9 | 2:50–3:00 | [SCREEN] | Back to the journey's logo. Title: "SANT: perfect one demo, then multiply it." The repo URL. | "One demo, perfected, then multiplied. SANT." |

## Notes for the edit

- **Numbers to check against the README just before recording** ([CHECK] shots): 3/40, 17/40, p = 0.0005;
  16/40, p = 0.0012; 40/40; 59/60; 30/30; 0/30. If any note changes, change the shot, not the README.
- **Don't say:** "human demos" for the policy result; "Nemotron beats code"; "the robot learned from my hand"
  (no policy has trained on a real webcam demo yet); anything about the human-demo experiment's outcome.
- **The grasp fix** (20/40 vs 17/40, p = 0.65) is not in the cut: it's a "no detectable difference" result
  that needs more time than it has here. It's in the README.
- **Fallbacks:** every [LIVE] shot has a [SCREEN] version, so the video can be cut without Isaac running. The
  live session is still the stronger shot for 5 and 6.
- **Voice-over length:** about 310 words, about 2:15 at 140 words a minute, which leaves room for the site to breathe.
