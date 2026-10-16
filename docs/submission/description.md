# Perfect, then multiply: Devpost project description (DRAFT)

<!-- Draft written 2026-10-16, refreshed in sprint 3b with the merged sprint 2-3 results.
     Every number cites its source note in an HTML comment.
     Sections marked PENDING must be filled in from measured results before submitting. -->

## Inspiration

Robot policies learn by imitating human demonstrations, and they need a lot of them.
Collecting them is the expensive part: teleoperation rigs cost $6k–$80k, operators cost
$25–$50/hour, and 20–30% of demos are thrown away (vendor estimates).
<!-- src: docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md §2 -->

A webcam is almost free, and anyone can wave a hand in front of one. But webcam demos are
noisy: the hand pauses, shakes and grabs off center. We asked whether a noisy webcam demo
could be **perfected** automatically, **checked in physics**, and then **multiplied** into
many good demos.

## What it does

You record a pick-and-place demonstration by moving your hand in front of a webcam, and a
simulated Franka arm in NVIDIA Isaac Lab follows it. Then the pipeline runs:

1. **Measure:** code computes motion metrics in 0.5 s windows. <!-- src: spec §7 -->
2. **Diagnose:** NVIDIA **Nemotron 3.5 Super VL**, on **Nebius Token Factory**, looks at key
   frames plus the metrics. It returns structured JSON: the demo's segments, its issues
   with timestamps, which repairs to run, and a keep / repair / discard decision. A
   **metric gate** then drops any claim the measurements contradict.
3. **Repair:** code applies those repairs from a fixed, unit-tested menu: trim,
   remove_pause, smooth, retime, recenter_grasp, replan_transit, discard.
4. **Verify:** Isaac Lab replays the repaired demo, and pure code decides success: cube in
   the bin, gripper open, cube settled, no hard collisions, no drop.
5. **Multiply:** a verified demo is transformed to new cube and bin positions. Each variant
   is verified again, and failures are kept out with a named reason.
6. **Export:** only verified demos go out, as a LeRobot dataset. Each one carries a
   *passport* with its lineage, the repairs applied, and which model diagnosed it.

The design rule is **the AI decides, code acts, physics checks.** The model never moves
the robot directly. It names problems, and code computes the exact fix from the simulator
state.

A web app shows it: **Record** (webcam hand tracking and teleop status), **Review** (each
demo's timeline in three lanes: what the model saw, the demo's phases, what code repaired,
plus a Perfect button), **Dataset** and **Results**.
<!-- src: docs/superpowers/notes/2026-10-16-web-pages.md -->

## How we built it

- **Pure-Python core** (`src/demo_pipeline`, numpy + pydantic only): schemas, metrics, a
  rules detector, the repair ops, the multiply transform, the success check, the teleop
  mapping and a demo store. The backend, the Isaac Lab worker and the LeRobot exporter all
  import it, so all three agree on one contract.
- **Diagnoser** (`src/app/ai/diagnose.py`): builds the prompt from the pydantic schema, so
  the prompt and the validator cannot drift apart. It validates the reply, retries once
  with the validation error, gates it against the metrics, and falls back to the rules
  detector if the reply is still invalid or the API errors.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2; Diagnoser calibration) -->
- **Sim worker** (`sim_worker/`, Isaac Sim 6.2 + Isaac Lab 3.0): a pick-place scene with
  contact sensors and front + wrist cameras, a differential-IK replay with joint-velocity
  feedforward, batch and multiply runners, and per-robot constants for a second arm.
  <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md -->
- **Backend** (FastAPI): a WebSocket relay from the browser's hand tracking to the sim;
  `/demos` routes; `POST /demos/{id}/perfect` jobs that diagnose, repair and verify through
  the sim worker over HTTP; and `GET /results` for the chart.
  <!-- src: t4-status (sprint 3 Tasks 2-3); docs/superpowers/notes/2026-10-16-web-pages.md -->
- **LeRobot tools:** export to the LeRobot v3.0 dataset format, a symlink-free training
  wrapper for Windows, an experiment runner, and a policy server that `sim_eval/` uses to
  evaluate policies in Isaac. <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md -->
- Every stage was built test-first. The backend + pipeline suite is at 770 passed,
  0 failed, 10 skipped (the skips need lerobot, torch or a GPU), and the web app at 163
  tests, with every AI call mocked.
  <!-- src: test output 2026-10-16, recorded in docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3b) -->

## How we use NVIDIA Nemotron and Nebius Token Factory

- **Model:** `nvidia/Nemotron-3.5-Super-VL` (text + image → text), called at runtime through
  Token Factory's OpenAI-compatible API. <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md -->
- **Input per diagnosis:** 7 front-camera key frames captioned with their times, plus 1
  wrist frame at the moment the gripper closes. Token Factory allows at most 8 images per
  prompt. Also the metrics table as compact text, the task sentence, and whether the
  replay succeeded. <!-- src: t4-nemotron-vl -->
- **Output:** one JSON diagnosis, validated against the schema and gated against the
  metrics before any repair runs.
- **Cost and speed (measured):** about $0.0013–$0.0016 and 2.3–3.9 s per diagnosis, with
  8 images. Images are billed as prompt tokens, about 263 tokens per 256×256 image.
  <!-- src: t4-nemotron-vl ($0.001332, 2.52 s, 263 tokens); docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2 Task 6: $0.001648, 3.9 s; calibration: $0.001366, 2.3 s) -->
- Every call is logged with its token counts and cost, under a hard budget. A batch stops
  itself, resumably, before it could pass its call or dollar budget, rather than silently
  falling back to rules. <!-- src: t4-status (sprint 3 Task 4) -->

## Challenges we ran into

- **The VLM over-reported on clean demos, and we fixed it on the test episode.** On a real
  Isaac episode of a perfect scripted demo, the first prompt made Nemotron report 5 issues,
  all false, including a rim contact that contradicted the contact data it was given.
  Applied as-is, its repairs would have made the demo worse. We calibrated the prompt
  ("a clean demo is common and must be keep", normal ranges, contacts as ground truth) and
  added a gate that drops claims the metrics contradict. The same episode now comes back
  **0 issues, keep**, at $0.0014 and 2.3 s. That is one sample, and recall is not measured
  yet. <!-- src: t4-status (sprint 2 Task 6; Diagnoser calibration) -->
- **IK lag:** the arm trailed the target, and the cause was the joint PD drive's damping,
  not IK. Joint-velocity feedforward cut the mean tracking error from 26.8 mm to 2.1 mm
  without changing the demo. <!-- src: t2-status (sprint 2 Task 2) -->
- **Multiplication failures:** 3 of 30 variants failed. We traced them to the transform
  handing over from the cube's frame to the bin's at a fixed time, which swung the hand
  past the arm's reach. The carry is now re-planned between the gripper events.
  <!-- src: t2-status (sprint 2 Task 4); docs/superpowers/notes/2026-10-15-t1-status.md (sprint 3 Task 1) -->
- **The second arm didn't fit.** The OpenArm runs end to end, but its ±45° wrist confines
  a vertical grasp to a ~0.2 m height band, so its yield in the shared workspace was 0/30.
  <!-- src: t2-status (sprint 2 Task 5) -->
- **Webcam tremor broke the rules detector** (F1 0.00), until stillness was measured on a
  smoothed path and jitter on an absolute limit. <!-- src: t1-status (sprint 2 tremor run) -->
- **The 8-image limit** was discovered only through an HTTP 400 on the first live call. The
  design had planned 11 images. <!-- src: t4-nemotron-vl -->
- **Isaac Lab 3.0 differences from older tutorials:** xyzw quaternions, nested prim paths,
  glob (not regex) filter patterns, and no window unless you pass `--viz kit`.
  <!-- src: t2-status; sprint1 plan T2 Gotchas -->
- **Windows:** LeRobot's checkpoint symlink fails without admin rights (we wrote a
  symlink-free wrapper), torchcodec needed a shared FFmpeg (we decode with PyAV instead),
  Python environments inside OneDrive fail to install, and a PC going to sleep killed CUDA
  mid-batch. <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md; t3-status (sprint 2 Task 1); spec Changes; t2-status (sprint 2 Task 6) -->

## Accomplishments we're proud of

- **Physics checks at scale:** 50/50 scripted demos replay and verify in Isaac Lab (20/20
  with cameras), and **27/30 = 90%** of multiplied variants pass, next to MimicGen's
  published 38–74%. Our task is easier than MimicGen's, so the claim we make is narrower:
  every failure is kept out of the dataset with a named reason.
  <!-- src: t2-status (sprint 2 Tasks 3, 4, 6); MimicGen range: spec §3 -->
- **A strong, honest baseline:** under synthetic tremor, the rules detector's F1 on the
  issues it detects went from 0.00 to 0.97–0.99. <!-- src: t1-status (sprint 2 Step 5) -->
- **A VLM that stopped crying wolf** on a clean demo (5 → 0 false issues), with the gate as
  a deterministic safety net. <!-- src: t4-status (Diagnoser calibration) -->
- **LeRobot ACT trains natively on Windows** on an RTX 5080: 20.7 steps/s at batch 8,
  under 1 GB of torch memory. <!-- src: t3-lerobot-windows -->
- A pipeline that refuses to fake results: unmeasured values are `null` end to end, and the
  web Results page shows them as "pending".
  <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3b) -->

## Results

> **PENDING.** The headline chart: policy success on 50 fixed test positions against the
> number of human demos (5, 10, 20), for raw, raw + multiply (a MimicGen-style baseline),
> and perfected + multiply (ours). Also the ablation at 10 demos (rules-only vs rules +
> Nemotron repair) and the logged human minutes. <!-- src: spec §3 -->

Measured so far (details in the README's Results):

- Multiplication yield, Franka: 27/30 = 90%. The Isaac re-run after the handover fix is
  PENDING. <!-- src: t2-status (sprint 2 Task 4); t1-status (sprint 3 Task 1) -->
- OpenArm: 0/30 multiplied, 2/30 scripted, in the shared workspace (a negative result).
  <!-- src: t2-status (sprint 2 Task 5) -->
- Nemotron on a clean episode: 0 false issues after calibration (n = 1). Recall: PENDING.
  <!-- src: t4-status (Diagnoser calibration) -->

## Prior art, and what's new

We build on MimicGen (demo multiplication), SkillGen (segment-wise repair), DemoBridge
(planner-based repair with no VLM), ISR (de-pausing), DQAF (VLM diagnosis given only as
feedback to the human), and handrobot and AnyTeleop (webcam teleoperation).
<!-- src: spec §5 -->

Our claim, to our knowledge: *"A VLM's structured, timestamped diagnosis drives the
automatic repair of webcam teleoperation demos, verified by physics replay, then
multiplied across positions and similar arms."* We do not claim to be the first at any of
the individual pieces.

## What we built during the submission period

<!-- Dates are from git history. Confirm them against the official submission-period dates before submitting. -->

- **2026-10-15:** the design spec (commit `8072315`). Then, in four parallel tracks: the
  pure-Python core (measure, rules, repair, multiply); the Isaac Lab scene, replay and
  success check; LeRobot export and the ACT training smoke; and the Nemotron VL diagnoser
  with its first live calls. Also the teleop hand → end-effector mapping, the WebSocket
  relay and the browser client.
  <!-- src: t1-status, t2-status, t3-status, t4-status (all 2026-10-15) -->
- **2026-10-16:**
  - the demo store and `/demos` routes, the first Nemotron diagnosis on real Isaac frames,
    then the prompt calibration and the metric gate;
  - the IK lag fix, the 50-demo batch, the multiplication yield, and the OpenArm;
  - the tremor-robust rules detector, the multiply handover fix, per-robot ranges and the
    experiment-set builder;
  - the symlink-free training wrapper, the policy server, the experiment runner and the
    Isaac eval harness;
  - the perfect jobs, the sim worker client and the resumable pipeline batch;
  - the four web pages and `GET /results`.
  <!-- src: t4-status, t2-status, t1-status, t3-status (sprint 2-3 entries); docs/superpowers/notes/2026-10-16-web-pages.md -->
- **Reused from earlier in this repo** (started 2026-09-13 as *SANT*, a room-organizer app
  for the same hackathon): the Token Factory client and usage logging, the FastAPI backend
  shell, and the browser MediaPipe hand tracking.
- **PENDING:** the sim worker's HTTP server and the first live pipeline run, the webcam →
  sim teleop loop, the OpenArm workspace, and the experiments behind the chart and the
  ablation.

## What's next

Run the perfect pipeline live through the sim worker. Score Nemotron against ground truth
on degraded episodes, to measure its recall. Then run the experiments behind the chart and
the ablation, and report them, whatever they show.

## Built with

NVIDIA Nemotron 3.5 Super VL · Nebius Token Factory · NVIDIA Isaac Sim 6.2 · NVIDIA Isaac
Lab 3.0 · LeRobot (ACT) · MediaPipe · FastAPI · React · Python · numpy · pydantic · PyTorch
