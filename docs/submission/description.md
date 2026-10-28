# SANT: Devpost project description (DRAFT)

**SANT** stands for **S**imulate · **A**ugment · **N**eaten · **T**rain: perfect one demo, then multiply it.

*Perfect, then multiply.*

<!-- Draft written 2026-10-16 and refreshed through sprint 7. Rewritten 2026-10-20 for the real webcam demos
     (live test #10), the Nemotron repairer's blind A/B, the human10c training result, the new site and the
     Isaac Lab Mimic positioning. Every number cites its source note in an HTML comment, and
     docs/submission/README.md has the full Results tables. -->

## Inspiration

Robot policies learn by imitating human demonstrations, and they need a lot of them. Collecting them is the
expensive part: teleoperation rigs cost $6k–$80k, operators cost $25–$50/hour, and 20–30% of demos are thrown
away (vendor estimates).
<!-- src: docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md §2 -->

A webcam is almost free, and anyone can wave a hand in front of one. But webcam demos are sloppy: the hand
pauses, shakes, grabs off center and presses the gripper into the bin. Tools like NVIDIA's Isaac Lab Mimic
multiply demos that already succeed. We asked about the step before that: can a sloppy human demo be **checked in
physics**, **repaired**, and only then **multiplied** into many good demos?

## What it does

You record a pick-and-place demonstration in the browser. Your hand drives a simulated Franka arm in NVIDIA Isaac
Lab live, through a webcam, the keyboard or the mouse. A 3D twin of the arm shows it from behind, the side and
above, with an alignment grid over the cube. Then the pipeline runs:

1. **Physics-check.** Isaac Lab replays the demo with real contacts. Pure code decides success: cube in the bin,
   gripper open, cube settled, no hard collision, no drop.
2. **Repair (Neaten).** A demo that fails is repaired, then checked again. There are two repairers:
   - **The rules:** code measures the demo and fixes it from a fixed, unit-tested menu: trim, remove pauses,
     smooth, retime, recenter the grasp, release above the bin.
   - **Nemotron edits:** NVIDIA Nemotron reads what the simulator measured and writes small, concrete edits to
     the hand's path. That covers contact forces, grasp offsets and where the cube was let go. Code rejects any
     edit over 5 cm, outside the workspace or not smooth, and sends the errors back. Isaac Lab verifies each
     accepted plan and sends the new verdict back, for up to 3 rounds.
3. **Multiply.** A verified demo is transformed to new cube and bin positions. Every copy is replayed and kept
   only if physics says it still works; a failure is kept out with a named reason.
4. **Label.** Nemotron 3.5 Super VL says what the person did and whether each copy kept their intent.
5. **Export and train.** Only verified demos go out, as a LeRobot dataset, each with a *passport* (lineage,
   repairs, edit plan). ACT trains on it, and Isaac Lab evaluates the policy on unseen scenes.

The design rule is **the AI proposes, code checks, physics decides.** The model never moves the robot directly
and never overrules the physics check.

**The site** is the product's front door, a journey you scroll through:
- **The descent:** a glass SANT logo, then a fall through a misty forest ("robots need demos") into a reactor
  that powers up with the story, then through THE RING. The ring bursts into particles that build the workshop.
- **The workshop:** a spiral of cartridges (each one a job), a machine and a bench where you make your own
  cartridge. Drag a cartridge onto the machine and it projects a hologram of the robot replaying a verified demo.
- **The robot wall:** every arm SANT has run, with what was tested in Isaac and what wasn't.
- **Record, Review and Results**, and a "bring your robot" report card for any URDF.
<!-- src: docs/superpowers/notes/2026-10-20-site-descent.md; 2026-10-20-site-interact.md; 2026-10-20-site-robots.md; 2026-10-19-keyboard-mode.md; 2026-10-19-camera-fixes.md; 2026-10-20-live-11-site-merge.md (record-aids: the twin's three views and grid); 2026-10-20-live-11-integration.md -->

## How we built it

- **Pure-Python core** (`src/demo_pipeline`, numpy + pydantic): schemas, metrics, the rules detector, the repair
  ops, the multiply transform, the success check, the trajectory edit language (`edit_plan.py`), the stats
  (Wilson, Fisher, exact McNemar) and a demo store. The backend, the Isaac Lab worker and the LeRobot exporter all
  import it, so all three agree on one contract.
- **Sim worker** (`sim_worker/`, Isaac Sim 6.2 + Isaac Lab 3.0, on Windows 11):
  - a pick-place scene with contact sensors and front + wrist cameras;
  - differential-IK replay with joint-velocity feedforward;
  - an HTTP server for replay and multiply jobs;
  - the live teleop sink. It saves what the arm actually did (the achieved path), not the hand targets it lagged
    by 2.5–5 cm.
  <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md; docs/superpowers/notes/2026-10-19-live-test-10-results.md (achieved-path fix) -->
- **Nemotron repairer** (`src/app/ai/nemotron_repair.py`):
  - **The prompt** has the replay's phases, verdict and contact facts, the scene geometry, and the path every
    0.2 s.
  - **The reply** is strict JSON edits. Invalid replies and failed replays go back as feedback.
  - **The prompt never shows** a hand-written op or the rules' diagnosis, and a test checks every prompt.
  <!-- src: docs/superpowers/notes/2026-10-20-nemotron-repair.md -->
- **Backend** (FastAPI): the WebSocket teleop relay, `/demos` (with discard, delete-last and camera video), the
  perfect jobs, `/robots` (bring your robot), `/results` and `/api/ask`.
- **Web** (React + three.js): the site, the hologram Record page with hand lock, keyboard and mouse modes, and the
  URDF twin, plus Review and Results.
- **Experiments:** one command per experiment (`scripts/run_human_demo_experiment.py`). It freezes every demo by
  content hash and writes the pre-registration before anything trains. It also holds a GPU lock so only one heavy
  job runs at a time.
- **LeRobot tools:** export, a symlink-free training wrapper for Windows, and a policy server that `sim_eval/`
  uses to evaluate policies in Isaac.
- **Testing:** nearly every stage was built tests-first, with every AI call mocked. At submission the suites are
  1997 Python tests passed (15 skipped: they need Isaac, a GPU, lerobot or are opt-in) and 1418 web tests.
  <!-- src: docs/superpowers/notes/2026-10-20-pr-live-11.md (pytest on 72b9577; web on 0cc6e9d); re-run on the submission commit -->

## How we use NVIDIA Nemotron and Nebius Token Factory

- **Models, all served by Nebius Token Factory** (OpenAI-compatible API):
  - `nvidia/Nemotron-3.5-Super-VL` (images + text): the labeler and the intent judge;
  - `nvidia/nemotron-3-super-120b-a12b` with thinking on: the repairer;
  - the `nano` tier: the site's Ask SANT box.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md; src/nebius_llm/config.py; 2026-10-20-nemotron-repair.md -->
- **As the repairer** (the new role):
  - It got about 4k tokens of the simulator's measurements per demo and up to 3 rounds.
  - In the blind A/B, its edits repaired **5/10** failed webcam demos, against the rules' 3/10. That includes
    every demo the rules fixed, plus two more. The re-run gave **2/10** vs 3/10, so it did not replicate: its plans
    vary from run to run.
  - The 10 demos cost **$0.207** in all. 3 of the 5 passes came only after it read a failed replay's verdict and
    tried again.
  <!-- src: docs/superpowers/notes/2026-10-20-nemotron-repair.md ("Result: the blind A/B") -->
- **As labeler and judge** (pre-registered): labels **40/40**, intent judgements **59/60**, 108 calls,
  **$0.1064** in all, about $0.001 a call. Simple code baselines tie it (39/40 and 60/60). Its value is saying in
  words *what* a demo is; whether it worked stays physics' call.
  <!-- src: docs/superpowers/notes/2026-10-18-nemotron-judge.md -->
- Every call is logged with its tokens and cost, under a hard spend cap that stops a run cleanly and resumably.

## Challenges we ran into

- **Real hands fail physics, even when they "work".**
  - **What happened.** In our live session, all 10 webcam demos put the cube in the bin. But the pre-registered
    check failed every one, because the gripper pressed into the bin while placing (9/10, up to 927 N against a
    5 N limit).
  - **Replay was the wrong motion.** Replaying the demos first gave 0/10 in the bin, because we had saved the
    hand's targets, which the arm lagged. We switched to saving the arm's achieved path.
  - **A gate we set ourselves.** We stopped at our own pre-registered gate of 6 raw passes. Then we wrote repair
    ops for the failures we saw.
  <!-- src: docs/superpowers/notes/2026-10-19-live-test-10-results.md -->
- **Replays aren't exact.** PhysX is not deterministic, and the live grasps were marginal, so the best replay
  reproduces only 2–4 of 10 live outcomes. A demo can pass or fail by luck, which is why every claim is
  pre-registered and reported whatever it says.
  <!-- src: docs/superpowers/notes/2026-10-19-live-test-10-results.md ("Latest (19:45)") -->
- **Letting a model edit a robot path safely.**
  - **Code limits.** The edit language has a per-step budget (no tool point more than 5 cm from where it was at
    that moment), a workspace box and two smoothness checks.
  - **What the first real calls found.** They exposed two flaws in our own code: a too-strict jerk check, and a
    gripper edit that would have dropped the cube mid-carry. We fixed both before the A/B.
  - **Out of tokens.** 3 of 23 calls ran out of tokens while thinking; a one-time re-ask now rescues them.
  <!-- src: docs/superpowers/notes/2026-10-20-nemotron-repair.md -->
- **Getting the VLM's judgement right, and measuring it honestly.**
  - Our first prompt invented 5 issues on a clean episode, and the calibrated prompt then missed all 9 real ones.
  - In a pre-registered 32-demo test, code alone diagnosed better than rules + Nemotron (F1 0.90 vs 0.86). That
    is why the model now proposes repairs instead of judging.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2 Task 6; calibration; sprint 6 Task 1) -->
- **Multiplication failures, traced and fixed.** A fixed-time handover from the cube's frame to the bin's sent
  variants of human-timed demos up to 0.42 m off course. Re-planning the carry between the gripper events took
  yields from 34/75 to **75/75**.
  <!-- src: t2-status (sprint 2 Task 4; sprint 4 Tasks 1, 3) -->
- **The PC going to sleep looked like a bad demo** (CUDA died mid-batch). The sim worker now keeps Windows awake
  while a job runs. Separately, ~4% of localhost HTTP responses were reset, so idempotent calls retry.
  <!-- src: t2-status (sprint 4 Tasks 2–3) -->
- **One GPU, many jobs.** Isaac Lab, training and several parallel work tracks share one 16 GB GPU, so every Isaac
  and training run takes a GPU lock and waits its turn.
  <!-- src: docs/superpowers/notes/2026-10-18-byor-backend.md (gpu.lock) -->
- **Windows:** LeRobot's checkpoint symlinks need admin rights (we wrote a symlink-free wrapper), torchcodec
  needed a shared FFmpeg (we decode with PyAV), and Python environments inside OneDrive fail to install.
  <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md -->

## Accomplishments we're proud of

- **Multiplying made a better robot**, on scripted demos:
  - 10 demos alone: **3/40** on unseen scenes. The same 10 plus 100 physics-verified copies: **17/40**
    (Fisher **p = 0.0005**).
  - A separately trained set with 300 copies replicated it: 16/40.
  <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md (sprint 7 Tasks 3–4; sprint 8) -->
- **A full loop with a real person.** We recorded 10 webcam demos live into Isaac Lab. All were physics-checked
  (0/10 pass), repaired (rules 3/10) and multiplied (**24/30** copies verified). A policy was trained and evaluated
  on the result.
  <!-- src: docs/superpowers/notes/2026-10-19-live-test-10-results.md; 2026-10-20-human10c-multiplied-only.md -->
- **Nemotron as a repairer that physics keeps honest,** blind and pre-registered: 5/10 vs the rules' 3/10 for
  $0.21, then 2/10 vs 3/10 in the re-run. It isn't better than the rules yet; physics decides which edits are kept.
  <!-- src: docs/superpowers/notes/2026-10-20-nemotron-repair.md -->
- **Tests that tell on us.** We pre-registered fair tests of our own Nemotron roles and published them. Code beat
  the model as a diagnoser and tied it as a judge.
- **Physics checks at scale:** 100/100 and 300/300 multiplied copies verified for the training sets, and 30/30 for
  the Franka in "bring your robot". The OpenArm gets 0/30, and its report card names the wrist joint that causes
  it.
  <!-- src: t2-status (sprint 6 Task 2; Task 2b); docs/superpowers/notes/2026-10-18-byor-backend.md -->
- **Everything on one Windows PC.** Isaac Lab 3.0, LeRobot ACT training (20.7 steps/s on an RTX 5080) and the
  site all run on Windows 11.
  <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md -->

## Results

All policy numbers: ACT, 30k steps, batch 8, one training run per cell, the same 40 unseen scenes (seeds
5020–5059, never used to choose anything), Wilson 95% intervals.

| What | Result |
|---|---|
| Scripted demos: 10 alone vs 10 + 100 verified copies | **3/40** vs **17/40**, Fisher p = 0.0005 |
| Scripted demos: 10 + 300 copies, trained separately | **16/40** (p = 0.0012 vs 3/40) |
| Grasp fix on the 10×10 data (pre-registered) | 20/40 vs 17/40, p = 0.65: no detectable difference |
| 10 real webcam demos, physics as recorded | **0/10** pass |
| Rules repair → multiply | **3/10** repaired → **24/30** copies verified |
| Blind repair A/B, same 10 demos | Nemotron edits **5/10** vs rules **3/10**, exact McNemar **p = 0.50 (not significant)**, $0.207 |
| The A/B re-run (`repair_ab2`) | Nemotron edits **2/10** vs rules **3/10**, **p = 1.0**, $0.278 |
| A policy trained only on what SANT made from the webcam demos: 27 episodes from 3 repaired demos | **3/40** (2.6–19.9%). One arm, not a comparison. 26 of the 37 failures dropped the cube |
| 10 real mouse demos (live test #11): physics, then repair → multiply | **10/10** pass live and on replay → 10/10 cleaned → **100/100** copies verified |
| Raw vs SANT on those mouse demos (pre-registered): 10 raw episodes vs 110 | **0/40** vs **3/40**, Fisher **p = 0.24: not significant**. SANT's policy collided in 27/40 |
| Nemotron labeler / judge (pre-registered) | 40/40 / 59/60, tied with code baselines |
<!-- src: docs/submission/README.md "Results (measured only)" and the notes it names: 2026-10-15-t3-status.md, 2026-10-18-t3-grasp-fix.md, 2026-10-19-live-test-10-results.md, 2026-10-20-nemotron-repair.md, 2026-10-20-human10c-multiplied-only.md (pre-registered e979c54), 2026-10-18-nemotron-judge.md -->

**What the webcam result says, honestly.**
- Repair turns real-hand rejects into demos that pass, and those multiply well. But 3 repaired demos weren't
  enough to train a good policy: 3/40.
- For reference only (not a comparison), the scripted run got 17/40 from 10 demos and 110 episodes. That suggests
  the number of distinct repaired demos matters. The runs also differ in source and size, so it doesn't show the
  cause.
- More repaired demos (more recordings, or Nemotron's 5/10 repairs, which that cell didn't use) is the next step.

**What the mouse result says, honestly.**
- It is our only two-arm test on human demos, and it found no significant difference: 0/40 vs 3/40, p = 0.24.
- SANT's policy gets the cube into its fingers (26/40 lose it before the bin; the raw one records no drops), but it
  pushes into the bin or table in 27/40 episodes (raw: 2/40).
- It is not the soft floor (which held 9 of the 10 demos up while recording) teaching it to push down: no training
  label goes more than 3.7 mm under the floor. The collisions' cause is being traced in a per-step eval.
  <!-- src: docs/superpowers/notes/2026-10-20-mouse20261020-results.md (sections 3–4); 2026-10-20-floor-labels.md -->

**Limits.**
- **Narrow setup:** one task, one training robot, one policy type, one training run per cell.
- **Few webcam demos:** 10, from one person.
- **The rules' home advantage:** the rules' two newest ops were written after seeing these same 10 failures, and
  Nemotron saw neither.
- **Simulation only.**

## Prior art, and how SANT relates to NVIDIA GR00T-Mimic / Isaac Lab Mimic

**Mimic multiplies good demos; SANT is the step before it.**
- **What Mimic does.** Isaac Lab Mimic, presented by NVIDIA as GR00T-Mimic in the Isaac GR00T blueprint for
  synthetic motion generation, takes a few teleop demos and splits each into subtasks, one per reference object.
  It moves each segment rigidly to new object poses, runs the result and keeps it if the task succeeds (about 40%
  for its Franka stacking example).
- **What it starts from.** Its tutorial starts from "10 successful demonstrations": a demo with a mistake is
  discarded with the reset key, and the tips ask for short, direct motions with no pauses.
- **What SANT adds.** SANT takes demos as people actually make them, checks them in physics as recorded (ours:
  0/10), and repairs the failures with rules or Nemotron edits. Then it multiplies them the same way, in its own
  code, and verifies every copy.
- **Better together.** SANT's repaired, verified demos can be Mimic's input, and we ran it on the 3 repaired webcam
  demos. Isaac Lab Mimic, given SANT's tracking, produced demos SANT verifies at the same rate as SANT's own multiplier: 82% vs 80%, p = 0.79; SANT's check rejected 9 of Mimic's 100 self-reported successes. SANT's side is the existing `human10c` 24/30 (the same 3 repaired sources); the planned 102-attempt SANT run was not done. We did not run GR00T-Mimic or SkillGen.
  <!-- src: docs/superpowers/notes/2026-10-20-mimic-export.md ("The rerun's result": 91/111 SANT-verified, Wilson 73.8–88.0%, vs human10c 24/30, 62.7–90.5%, Fisher p = 0.79; rejects collision 6, unreachable 8, not_settled 1) -->
<!-- src: C:\isaac\IsaacLab docs/source/features/imitation-learning/teleop_imitation.rst ("What is Isaac Lab Mimic?", Step 1, generation success ~40%) and skillgen.rst; src/demo_pipeline/multiply.py -->

**Other prior work we build on:** MimicGen (demo multiplication), SkillGen (planned motion between human
segments), DemoBridge (planner-based repair with no VLM), ISR (de-pausing), DQAF (VLM diagnosis given only as
feedback to the human), and handrobot and AnyTeleop (webcam teleoperation).
<!-- src: spec §5 -->

Our claim, to our knowledge: *"A human demo is checked in physics as recorded, repaired automatically (from a fixed
menu, or by a language model's trajectory edits within code-checked limits), verified by physics replay after
every repair, and only then multiplied across positions."* We do not claim to be first at any single piece.
<!-- src: docs/superpowers/notes/2026-10-17-claims-audit.md (earlier wording, extended with the repairer); 2026-10-20-nemotron-repair.md -->

## What we built during the submission period

<!-- Dates are from git history and the dated notes. Confirm them against the official submission-period dates before submitting. -->

- **2026-10-15:** the design spec (commit `8072315`), then four parallel tracks:
  - the pure-Python core;
  - the Isaac Lab scene, replay and success check;
  - LeRobot export and ACT training;
  - the Nemotron VL diagnoser.
- **2026-10-16:** the demo store, the IK lag fix, the multiply handover fix (75/75), the sleep fix, the hybrid
  diagnoser and its ablation, the four web pages and the webcam-teleop sink.
- **2026-10-17:** the confirmatory multiply test, 3/40 vs 17/40 (p = 0.0005), and the claims audit.
- **2026-10-18:**
  - the 10×30 replication (16/40) and the pre-registered grasp fix (20/40, no detectable difference);
  - the pre-registered Nemotron labeler/judge test;
  - "bring your robot";
  - the hologram Record page with the hand lock and the 3D URDF twin.
- **2026-10-19:**
  - live test #10: 10 real webcam demos;
  - the achieved-path fix, the human-demo Neaten ops and `human10c` (3/10 repaired, 24/30 copies);
  - keyboard and mouse modes and Record's recording aids;
  - the site's workshop journey and the workbench editor.
- **2026-10-20:**
  - the Nemotron repairer and its blind A/B (5/10 vs 3/10), and its re-run (2/10 vs 3/10);
  - the `human10c` training result (3/40, one arm);
  - live test #11's 10 mouse demos and the pre-registered raw vs SANT on them (0/40 vs 3/40, p = 0.24, not
    significant);
  - the site's descent intro, the robot wall and the drag to the machine.
<!-- src: the dated notes in docs/superpowers/notes/ for each day; git history -->
- **Reused from SANT's earlier room-organizer version** (started 2026-09-13 for the same hackathon; it grew into
  this robot-training tool on 2026-10-15): the Token Factory client and usage logging, the FastAPI backend shell,
  and the browser MediaPipe hand tracking.

## What's next

- **More repaired human demos to train on:** more recordings (with the webcam, or the new keyboard mode), and
  Nemotron's repairs in the training cell. Then the two-arm test raw vs SANT on human demos, with enough roots to answer it.
- **The hybrid repairer:** the rules first, and Nemotron's blind edits only for the demos the rules fail. The A/B
  re-run (2/10 vs 3/10, after 5/10 vs 3/10) showed Nemotron's plans vary, so it should add to the rules, not
  replace them.
- **An A/B on fresh failing demos** the rules were not written for, with the hybrid as the primary arm.
- **A self-improvement loop.**
- **Find why the mouse-SANT policy collides** (27/40), with a traced eval. The soft floor is ruled out.
- **Fix the drops,** the failure mode in every trained policy so far.
- **Mimic on SANT's demos, further:** run the planned 102-attempt SANT comparison, and train on Mimic's verified
  demos vs SANT's. Then try SkillGen.
<!-- src: docs/superpowers/notes/2026-10-20-human10c-multiplied-only.md ("Reading it"); 2026-10-20-nemotron-repair.md ("Open"); 2026-10-18-t3-grasp-fix.md -->

## Built with

NVIDIA Nemotron 3.5 Super VL · NVIDIA Nemotron 3 Super · Nebius Token Factory · NVIDIA Isaac Sim 6.2 · NVIDIA
Isaac Lab 3.0 · LeRobot (ACT) · MediaPipe · FastAPI · React · three.js · Python · numpy · pydantic · PyTorch
