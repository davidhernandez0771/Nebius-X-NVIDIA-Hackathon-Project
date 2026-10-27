# SANT demo video: under 3 minutes (v5, 2026-10-27)

<!-- v5 (2026-10-27): built around the live flow the user rehearses: record a demo in Isaac Lab, Run SANT (physics
     check + multiply), Nemotron building a scene from a sentence, then the proof. It opens on the side-by-side LOOK
     clip (/look, an illustrative replay of picked scenes, labelled so on screen) and has the counted 0/40 and 30/40 by
     0:25. It's real footage only (screen recordings of the site and of the Isaac Sim window); the voice can be the
     user's or an AI voice reading this text. v4 and earlier are in git history.
     Every number below is in README.md "The headline result" and docs/superpowers/notes/2026-10-23-bigtest-prereg.md. -->

**The story in one line:** ten sloppy mouse demos: copied directly, the robot fails every time; through SANT, it
succeeds 30 of 40 on scenes it has never seen. Then we show how, live.

**The path:**
1. **The look:** the same scene, two robots.
2. **The result.**
3. **The problem.**
4. **Live:** record a demo.
5. **Live:** SANT checks and multiplies it.
6. **Live:** Nemotron on Nebius builds a scene from a sentence.
7. **Why it works:** the teacher, and the proof the human demos mattered.
8. **The real test runs.**
9. **The close.**

**Tags:**
- **[SCREEN]:** a screen recording of the site. No backend needed.
- **[LIVE]:** a screen recording with the backend and Isaac Lab running (`scripts\start-live.ps1` + the sim). Record
  these in the rehearsal session.
- **[ISAAC]:** the Isaac Sim window itself, captured with OBS or Win+Alt+R (Xbox Game Bar).
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
| 1 | 0:00–0:12 | [SCREEN] [CHECK] | `/look?embed=1&q=high`: the two robots on one clock, the same scene. Left never touches the cube; right grasps it, carries it, drops it in the bin. The caption ("Same 10 demos. Same scene. 0/40 vs 30/40") and the "Illustrative replay" kicker stay visible. | "Ten sloppy demos, made with a mouse. Same scene, two robots. Left: one that copied the demos directly. Right: the one SANT built from them." |
| 2 | 0:12–0:24 | [SCREEN] [CHECK] | `/site/results`: the climb chart builds **0 → 3 → 15 → 30 of 40**, with the 60% goal line. Hold on 30/40. | "Copied directly: zero successes in forty new scenes. Through SANT: thirty of forty, in a test we registered before we ran it." |
| 3 | 0:24–0:36 | [SCREEN] | The hero, then a fast scroll: the forest with robots half-buried in moss; "927 N against a 5 N limit". | "Robots learn from human demos, and good demos are expensive. Cheap ones, from a mouse or a webcam, are sloppy. One of ours pressed the gripper into the bin with almost a thousand newtons. SANT makes cheap demos usable." |
| 4 | 0:36–1:02 | [LIVE] + [ISAAC] inset | `/record`, Keyboard mode: Start, Record, drive to the cube, grip, lift, drop it in the bin, Stop. The counter goes to 1. Put the real Isaac Sim window in a corner inset for at least 10 s. | "Here's a demo, recorded live. The keyboard drives a Franka arm inside NVIDIA Isaac Lab. The twin shows it from behind, the side and above, so I can line up the grasp. Grab the cube, into the bin, stop." |
| 5 | 1:02–1:28 | [LIVE] + [ISAAC] | Click "Run SANT on 1 demo →" → `/pipeline`: the physics-check verdict, then multiplying, with variants arriving and each replayed. Cut to the Isaac window replaying a copy for about 5 s. | "Run SANT. Isaac Lab replays the demo with real contact forces, and code decides whether it worked. Then SANT multiplies it: the cube and the bin move, every copy is replayed in physics, and only the copies that pass are kept." |
| 6 | 1:28–1:46 | [LIVE] | Back on `/record`: "Scene" → type "put the cube near the left edge and the bin far right" → "Create with Nemotron" → the validated plan, then the new scene. | "The language layer is NVIDIA Nemotron, on Nebius Token Factory. It turns a sentence into a scene, labels demos and proposes repairs. It never moves the robot: code checks every answer, and physics decides." |
| 7 | 1:46–2:10 | [SCREEN] [CHECK] | The workshop's proof wall (or `/site/results` part 2): **113/128 with the demos vs 0/128 without**, then the card "1.7 m/s → 3/50 pass · capped at 0.5 m/s → 50/50". | "Copying ten demos isn't enough to learn a grasp. So a reinforcement-learning teacher practises in Isaac Lab, four thousand arms at once, starting from the human demos. Without them, the same teacher never lifted the cube. And SANT checks the teacher too: it caught it moving impossibly fast." |
| 8 | 2:10–2:36 | [SCREEN] [CHECK] | `/test-track`, "The final test · 30/40": one success end to end, then one failure with its reason ("dropped"). | "Its skill is distilled into a robot that only sees through cameras. These are its real test runs. Thirty succeed. Ten fail, most of them drops. That's what we fix next." |
| 9 | 2:36–2:52 | [SCREEN] | `/site/results` "What didn't work", then back to the hero. The repo URL on screen. | "We publish what failed too, and everything here is simulation; a real arm is next. Ten sloppy demos in, a robot that works out. SANT." |

**Robot-operating footage** (the rule is ≥ 60 s): shot 1 (12 s) + shot 4 (26 s) + shot 5 (about 20 s of replays) +
shot 8 (26 s) ≈ **84 s**, with at least 15 s of it in the real Isaac Sim window (shots 4 and 5).

**Nebius + NVIDIA, said out loud** (required): Isaac Lab in shots 4, 5 and 7; Nemotron + Nebius Token Factory in shot 6.

**Length:** about 370 words of voice-over, roughly 2:45 at 135 words a minute, which leaves about 10 s of slack under
3:00. If it runs long, cut the forest line in shot 3 ("One of ours pressed…") first.

## Notes for the edit

- **Numbers to check just before recording** ([CHECK] shots; shot 1 also checks the kicker is visible):
  - 0/40, 3/40, 15/40, 30/40, and the 60% goal;
  - 113/128 vs 0/128;
  - 1.7 m/s, 3/50 → 50/50;
  - 30 succeed / 10 fail.
- **Don't say:**
  - "beats" or "significant" when comparing 30/40 with 0/40 or 3/40 (different seeds);
  - that Nemotron made the 30/40;
  - "the robot learned from my hand" (the demos are mouse demos);
  - anything about a real robot;
  - that DAgger helped.
- **Shot 7's "four thousand":** the teacher trains with 4,096 parallel environments on one RTX 5080. That's local, not
  Nebius. Don't say "on Nebius" for training.
- **Shot 1 depends on the LOOK clip's data** (one short Isaac run, pending). Without it, open on shot 2.
- **Shot 6 depends on Nemotron answering live:** do one dry run in the rehearsal. If Token Factory is slow, record
  it once and cut the wait.
- **Shot 8:** the test track's "final test" source is merged (the 40 real runs).
- **The voice:** the user's own, or an AI voice reading the voice-over column as written. Either way, every picture is
  a real recording of the app or of Isaac Sim, never generated footage: the rules ask for the app "actually working".
- **Captions:** burn the key numbers in as text (0/40, 30/40, 113/128 vs 0/128) so they read with the sound off.
- **Record in pieces:** shots 4–6 in the rehearsal session with the backend and Isaac running, and the rest from the
  plain site. Stitch them in any editor (Clipchamp is built into Windows).
- **Before recording:** walk the whole site once on the real GPU. The latest checks were software-rendered only.
