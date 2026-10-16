# Perfect, then multiply: Devpost project description (DRAFT)

<!-- Draft written 2026-10-16. Every number cites its source note in an HTML comment.
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
   with timestamps, which repairs to run, and a keep / repair / discard decision.
3. **Repair:** code applies those repairs from a fixed, unit-tested menu: trim,
   remove_pause, smooth, retime, recenter_grasp, replan_transit, discard.
4. **Verify:** Isaac Lab replays the repaired demo, and pure code decides success: cube in
   the bin, gripper open, cube settled, no hard collisions, no drop.
5. **Multiply:** a verified demo is transformed to new cube and bin positions. Each variant
   is verified again.
6. **Export:** only verified demos go out, as a LeRobot dataset. Each one carries a
   *passport* with its lineage, the repairs applied, and which model diagnosed it.

The design rule is **the AI decides, code acts, physics checks.** The model never moves
the robot directly. It names problems, and code computes the exact fix from the simulator
state.

## How we built it

- **Pure-Python core** (`src/demo_pipeline`, numpy + pydantic only): schemas, metrics, a
  rules detector, the repair ops, the multiply transform, the success check, the teleop
  mapping and a demo store. The backend, the Isaac Lab worker and the LeRobot exporter all
  import it, so all three agree on one contract.
- **Diagnoser** (`src/app/ai/diagnose.py`): builds the prompt from the pydantic schema, so
  the prompt and the validator cannot drift apart. It validates the reply, retries once
  with the validation error, and falls back to the rules detector if the reply is still
  invalid or the API errors.
- **Sim worker** (`sim_worker/`, Isaac Sim 6.2 + Isaac Lab 3.0): a pick-place scene with
  contact sensors and front + wrist cameras, plus a differential-IK replay that records
  episodes. <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md -->
- **Backend** (FastAPI): a WebSocket relay from the browser's hand tracking to the sim, and
  `/demos` routes to store and diagnose demos.
- **LeRobot tools:** export to the LeRobot v3.0 dataset format and an ACT training smoke
  test, natively on Windows. <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md -->
- Every stage was built test-first. The full backend + pipeline suite is at 407 passed,
  1 skipped, with every AI call mocked.
  <!-- src: test output 2026-10-16, recorded in docs/superpowers/notes/2026-10-16-fix-windows-tests.md -->

## How we use NVIDIA Nemotron and Nebius Token Factory

- **Model:** `nvidia/Nemotron-3.5-Super-VL` (text + image → text), called at runtime through
  Token Factory's OpenAI-compatible API. <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md -->
- **Input per diagnosis:** 7 front-camera key frames captioned with their times, plus 1
  wrist frame at the moment the gripper closes. Token Factory allows at most 8 images per
  prompt. Also the metrics table as compact text, the task sentence, and whether the
  replay succeeded. <!-- src: t4-nemotron-vl -->
- **Output:** one JSON diagnosis, validated against the schema before any repair runs.
- **Cost and speed (measured):** about $0.0013–$0.0016 and 2.5–3.9 s per diagnosis, with
  8 images. Images are billed as prompt tokens, about 263 tokens per 256×256 image.
  <!-- src: t4-nemotron-vl ($0.001332, 2.52 s, 263 tokens); docs/superpowers/notes/2026-10-15-t4-status.md ($0.001648, 3.9 s) -->
- Every call is logged with its token counts and cost, under a hard budget.

## Challenges we ran into

- **The VLM over-reports on clean demos.** On a real Isaac episode of a perfect scripted
  demo, the rules said `keep`. Nemotron said `repair`, with 5 issues that were all false
  positives, including a rim contact that contradicted the contact data it was given.
  Applied as-is, its repairs would have made the demo worse. Its segmentation, though, was
  good, and finer than the rules'. So the model's kinematic claims must be gated by the
  metrics, and its value has to come from what code cannot see: wrong object, drops,
  grasp quality from the wrist view, segment labels.
  <!-- src: t4-status, sprint 2 Task 6 -->
- **The 8-image limit** was discovered only through an HTTP 400 on the first live call. The
  design had planned 11 images. <!-- src: t4-nemotron-vl -->
- **Isaac Lab 3.0 differences from older tutorials:** xyzw quaternions, nested prim paths,
  glob (not regex) filter patterns, and no window unless you pass `--viz kit`.
  <!-- src: t2-status; sprint1 plan T2 Gotchas -->
- **IK lag:** the arm trails the target by about 0.1 s (mean 24.6 mm error), which matters
  for fast human demos. <!-- src: t2-status -->
- **Windows:** LeRobot's checkpoint symlink fails without admin rights, torchcodec needed a
  shared FFmpeg (we decode with PyAV instead), and Python environments inside OneDrive
  fail to install. <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md; spec Changes -->

## Accomplishments we're proud of

- The **Isaac Lab go/no-go passed:** a scripted pick-and-place replays and verifies as
  success, with and without cameras. <!-- src: t2-status -->
- **LeRobot ACT trains natively on Windows** on an RTX 5080: 20.7 steps/s at batch 8,
  under 1 GB of torch memory. <!-- src: t3-lerobot-windows -->
- An honest, measured answer to "why AI?", including where the AI is currently wrong.

## Results

> **PENDING.** The headline chart: policy success on 50 fixed test positions against the
> number of human demos (5, 10, 20), for raw, raw + multiply (a MimicGen-style baseline),
> and perfected + multiply (ours). Also the ablation at 10 demos (rules-only vs rules +
> Nemotron repair), the multiplication yield next to MimicGen's published 38–74%, and the
> logged human minutes. <!-- src: spec §3 -->

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
- **2026-10-16:** the demo store, the `/demos` backend routes with the rules fallback, the
  first Nemotron diagnosis on real Isaac frames, and fixes for the Windows-only test
  failures. <!-- src: t4-status (sprint 2); 2026-10-16-fix-windows-tests.md -->
- **Reused from earlier in this repo** (started 2026-09-13 as *SANT*, a room-organizer app
  for the same hackathon): the Token Factory client and usage logging, the FastAPI backend
  shell, and the browser MediaPipe hand tracking.
- **PENDING:** the webcam → sim teleop loop, multiply in sim and the second arm (OpenArm),
  the evaluation harness and experiments, and the web pages (Record, Review, Dataset,
  Results).

## What's next

Gate Nemotron's issues against the metrics. Run the first real webcam demos. Then run the
experiments behind the chart and the ablation, and report them, whatever they show.

## Built with

NVIDIA Nemotron 3.5 Super VL · Nebius Token Factory · NVIDIA Isaac Sim 6.2 · NVIDIA Isaac
Lab 3.0 · LeRobot (ACT) · MediaPipe · FastAPI · React · Python · numpy · pydantic · PyTorch
