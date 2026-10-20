# SANT demo video: 3 minutes

<!-- Rewritten 2026-10-20 for the site on pm/live-11: the descent intro (hero → forest → reactor → THE RING →
     the workshop), the workshop's four places (shelf, machine, bench, robot wall), dragging a cartridge to the
     machine, Record with keyboard/mouse/camera and three twin views, and the Nemotron repairer's blind A/B.
     The 2026-10-19 version (the older intro, no repairer) is in git history. Every number below is in
     docs/submission/README.md's Results tables, with its note. -->

**The path:** the descent intro → the workshop and its robot wall → drag a cartridge to the machine → Record →
the Nemotron repairer → the results.

**Tags:**
- **[SCREEN]** a screen recording of the site, with no backend needed. The machine's hologram and Record's twin
  replay `web/public/world/demo-episode.json`, a sim-verified episode.
- **[LIVE]** needs the live session: the backend, the Isaac Lab sink and a person at the webcam or keyboard
  ([live-test-10](../superpowers/notes/2026-10-19-live-test-10.md) has the terminals). Only one Isaac process at
  a time. Each [LIVE] shot has a [SCREEN] fallback.
- **[EDIT]** a card made in the edit (text over a still), for things the site doesn't show.
- **[CHECK]** confirm the number on screen matches the README's Results tables before recording.

**Rules for what's on screen:**
- Never show a number that isn't in the README's Results tables, and never show sample data as measured.
- Say once, clearly, that the 3/40 → 17/40 policy result was trained on scripted demos, not human ones.
- **The repair A/B is not significant (p = 0.50, one run).** Say "as well as the rules, and two more", never
  "beats".
- **The webcam training result is one arm: 3/40.** Show it as "3 repaired demos are not enough yet". Never put
  it next to 17/40 as a comparison, and never next to the scripted raw 3/40 (a different setup that happens to
  share the number).
- Record at 1920×1080 with the site's quality tier fixed (`?q=high`; no tier change mid-shot), on the real GPU in
  a normal browser window. Close Blender and any other GPU renderer, and keep Isaac closed during [SCREEN]
  shots.

## Shot list

| # | Time | Tag | Picture | Voice-over |
|---|---|---|---|---|
| 1 | 0:00–0:10 | [SCREEN] | `http://localhost:5173/?q=high`: the loader, then the glass SANT logo in dark space, "SHOW A ROBOT ONCE." | "Robots learn by copying people. Show one a task once, and it should be able to learn it." |
| 2 | 0:10–0:25 | [SCREEN] | Scroll: the drop into the misty forest, the Franka's parts half-buried in the moss. "ROBOTS NEED DEMOS." with its three lines; hold on "927 N against a 5 N limit". | "But robots need hundreds of demos, and each one costs a teleop rig and an operator's time. A webcam is free, but human demos are sloppy: when we recorded ten with a webcam, nine pressed the gripper into the bin." |
| 3 | 0:25–0:48 | [SCREEN] [CHECK] | Through the crack into the reactor. It powers up with the scroll: S·A·N·T (Simulate, Augment, Neaten, Train), then the proof slab **3/40 → 17/40**, then "NEMOTRON PROPOSES. PHYSICS VERIFIES." | "SANT checks every demo in NVIDIA Isaac Lab, repairs what fails, and multiplies what passes into many verified copies. On scripted demos, multiplying took a policy from three successes in forty unseen scenes to seventeen. The rule: Nemotron proposes, physics verifies." |
| 4 | 0:48–0:58 | [SCREEN] | At full power the ring lifts off; the camera dives through THE RING; it bursts into particles that build the workshop. | (music; no voice) |
| 5 | 0:58–1:10 | [SCREEN] | The workshop: the spiral of cartridges, the four tags. Click **04 The wall**: the camera turns to the robot wall; hover the Franka, then the OpenArm; the catalog panel shows each one's status. | "Each robot SANT runs on stands on the wall. The Franka passed thirty of thirty copies in Isaac. The OpenArm passed none, and its report card names the wrist joint that stops it." |
| 6 | 1:10–1:25 | [SCREEN] | Escape back to the room. Press a cartridge on the spiral and **drag it onto the machine**: it waits over the port, plugs in, and the hologram Franka replays a verified demo with its joints panel. | "A cartridge is a job. Drag one onto the machine, and it projects the robot: a real, physics-checked demo, replayed." |
| 7 | 1:25–1:52 | [LIVE] | `/record` (Into the projection → Record). Keyboard (or Camera). Start; the Kit window and the twin pane, tagged `LIVE`, follow. Show the three twin views (behind, side, top) and the alignment grid lighting up over the cube. Grasp, carry, release over the bin; Enter to save. **Fallback [SCREEN]:** the same page with the twin tagged `REPLAY`; say "a recorded demo". | "To teach it, you record. Drive the simulated arm with your hand on a webcam, or with the keyboard. The twin shows the robot from behind, the side and above, and the grid lights up when you're over the cube. Stop, and it's saved as a demo." |
| 8 | 1:52–2:25 | [EDIT] [CHECK] | Three cards. **1:** "10 real webcam demos → **0/10** pass physics as recorded." **2:** one demo's Nemotron plan in its own words, from the A/B (66bc: first grasp re-aimed 2.6 cm, gripper held closed across the regrasps, the tail lifted 3 cm → **pass** in round 3). If possible, its before/after replay from Isaac (record it in a [LIVE] session). **3:** the A/B: **Nemotron edits 5/10 vs rules 3/10, McNemar p = 0.50, one run, $0.21**. | "Real hands make demos that physics rejects: zero of our ten passed. So SANT repairs them. NVIDIA Nemotron reads what the simulator measured, the forces, the grasp offset, where the cube was let go, and writes small edits to the path. Code caps each edit at five centimetres; Isaac Lab replays it and sends back the verdict. In a blind test on those ten demos, Nemotron repaired five, the hand-written rules three. That's not significant yet, but it fixed every demo the rules did, and two more, for twenty cents." |
| 9 | 2:25–2:50 | [SCREEN] [CHECK] | `/site/results`: the arms with their intervals, the 40 squares per arm. Overlay: **3/40 vs 17/40, p = 0.0005**, seeds 5020–5059, "source demos: scripted expert"; **16/40** with 300 copies. Then a separate card (not beside the bars): "webcam demos: 3 repaired by the rules → **24/30** verified copies → a policy trained on them: **3/40**. 3 repaired demos aren't enough yet." | "And the copies make better robots. On forty scenes fixed in advance, the same policy went from three successes to seventeen with verified copies, and a separately trained set gave sixteen. Our webcam demos aren't there yet: three repaired demos, multiplied, trained a policy that succeeds three times in forty. More repaired demos are next." |
| 10 | 2:50–3:00 | [SCREEN] | Scroll back up through the ring to the glass logo. Title: "SANT: perfect one demo, then multiply it." The repo URL. | "One demo, perfected, then multiplied. SANT." |

## Notes for the edit

- **Numbers to check against the README just before recording** ([CHECK] shots): 3/40, 17/40, p = 0.0005; 16/40;
  0/10; 5/10 vs 3/10, p = 0.50, $0.21; 3/10 → 24/30 → 3/40 (one arm); 30/30 and 0/30 (the wall). If any note changes, change the
  shot, not the README.
- **Don't say:**
  - "human demos" for the 3/40 → 17/40 result;
  - "Nemotron beats the rules" or "beats code";
  - "the robot learned from my hand" (the webcam-trained policy got 3/40);
  - that repairing webcam demos made a better robot (the webcam training has one arm, nothing to compare).
- **The A/B's caveats** stay out of the voice-over for time, but card 3 carries "one run, not significant".
  Two caveats live in the README: the rules' two newest ops were written after seeing these 10 demos, and replays
  reproduce live outcomes only 2–4 times in 10.
- **Left out for time:** the Nemotron labeler/judge test (40/40, 59/60) and the grasp fix (20/40 vs 17/40,
  p = 0.65). Both are in the README.
- **Fallbacks:** every [LIVE] shot has a [SCREEN] version, so the video can be cut without Isaac running. Shot 8's
  Isaac before/after is optional; the cards alone work.
- **The site was checked only in headless Chrome** after the latest merges (software rendering). Do one full
  walk on the real GPU before recording, and drag the cartridge by hand a few times: the drag needs a 6 px
  press-and-move to start.
- **Voice-over length:** about 340 words, about 2:25 at 140 words a minute, which leaves room for shot 4 and the site to breathe. If
  it runs long, cut the second sentence of shot 5 and the "and a separately trained set" clause of shot 9.
