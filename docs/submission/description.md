# Perfect, then multiply: Devpost project description (DRAFT)

<!-- Draft written 2026-10-16, refreshed in sprint 3b, and again after sprint 4 (sprint 4
     results, the ablation, the teleop sink). Every number cites its source note in an HTML
     comment. Sections marked PENDING must be filled in from measured results before submitting. -->

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
2. **Diagnose:** the result is structured JSON: the demo's segments, its issues with
   timestamps, which repairs to run, and a keep / repair / discard decision. The default
   is a **hybrid**:
   - a rules detector owns the timing issues (pauses, tremor, idle time);
   - NVIDIA **Nemotron 3.5 Super VL**, on **Nebius Token Factory**, gets key frames, the
     metrics, the rules' findings and a code-measured grasp offset;
   - the model is asked only for what the rules never name (an off-center grasp, a bad
     release, a drop, the wrong object) and the segments;
   - gates drop any claim the measurements contradict.
   <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 4 Task 1) -->
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

The web app has four pages:
- **Record:** webcam hand tracking that drives the sim arm, with Start, Stop and save, and
  Reset scene.
- **Review:** each demo's timeline in three lanes (what the model saw, the demo's phases,
  what code repaired), plus a Perfect button.
- **Dataset.**
- **Results.**
<!-- src: docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3, 3b, 3c) -->

## How we built it

- **Pure-Python core** (`src/demo_pipeline`, numpy + pydantic only): schemas, metrics, a
  rules detector, the repair ops, the multiply transform, the success check, the teleop
  mapping and a demo store. The backend, the Isaac Lab worker and the LeRobot exporter all
  import it, so all three agree on one contract.
- **Diagnoser** (`src/app/ai/diagnose.py`):
  - It builds the prompt from the pydantic schema, so the prompt and the validator cannot
    drift apart.
  - It validates the reply, retries once with the validation error, and gates it against
    the metrics.
  - The hybrid merges the model's findings with the rules'. If the model fails, the
    backend falls back to the rules alone.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2; Diagnoser calibration; sprint 4 Tasks 1-2) -->
- **Sim worker** (`sim_worker/`, Isaac Sim 6.2 + Isaac Lab 3.0):
  - a pick-place scene with contact sensors and front + wrist cameras;
  - a differential-IK replay with joint-velocity feedforward;
  - an HTTP server for replay and multiply jobs (one at a time, resumable by seed), which
    keeps the PC awake while a job runs;
  - the webcam-teleop sink that drives the arm from the browser and saves each recording
    as a demo.
  <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 2-4); docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3c T5) -->
- **Backend** (FastAPI):
  - a WebSocket relay that carries hand poses and record/stop/reset controls to the sim, and
    the sim's status back;
  - `/demos` routes;
  - `POST /demos/{id}/perfect` jobs that diagnose, repair and verify through the sim worker;
  - `GET /results` for the chart.
  <!-- src: t4-status (sprint 3 Tasks 2-3); docs/superpowers/notes/2026-10-16-web-pages.md -->
- **LeRobot tools:** export to the LeRobot v3.0 dataset format, a symlink-free training
  wrapper for Windows, an experiment runner, and a policy server that `sim_eval/` uses to
  evaluate policies in Isaac. <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md -->
- **Testing:**
  - Every stage was built test-first, with every AI call mocked.
  - The backend + pipeline suite is at 1090 passed, 0 failed, 16 skipped (the skips need
    lerobot, torch, Isaac or a GPU).
  - The web app has 178 tests, and the Isaac-side suites pass 539 tests.
  <!-- src: test output 2026-10-16 on 97d1c92 (code identical to 68e4e68), recorded in docs/superpowers/notes/2026-10-16-web-pages.md (docs refresh after sprint 4) -->

## How we use NVIDIA Nemotron and Nebius Token Factory

- **Model:** `nvidia/Nemotron-3.5-Super-VL` (text + image → text), called at runtime through
  Token Factory's OpenAI-compatible API. <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md -->
- **Input per diagnosis:** 7 front-camera key frames captioned with their times, plus 1
  wrist frame at the moment the gripper closes. Token Factory allows at most 8 images per
  prompt. Also the metrics table as compact text, the task sentence, and whether the
  replay succeeded. In the hybrid, it also gets the rules' findings and the measured grasp
  offset. <!-- src: t4-nemotron-vl; t4-status (sprint 4 Task 1) -->
- **Output:** one JSON diagnosis, validated against the schema and gated against the
  metrics before any repair runs.
- **Cost and speed (measured):** about $0.0013–$0.0016 and 2.3–3.9 s per diagnosis, with
  8 images. Images are billed as prompt tokens, about 263 tokens per 256×256 image. The
  20-episode ablation cost $0.0618 for 42 calls.
  <!-- src: t4-nemotron-vl ($0.001332, 2.52 s, 263 tokens); docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2 Task 6: $0.001648, 3.9 s; calibration: $0.001366, 2.3 s; sprint 4 Task 3: 42 calls, $0.0618) -->
- Every call is logged with its token counts and cost, under a hard budget. A batch stops
  itself, resumably, before it could pass its call or dollar budget, rather than silently
  falling back to rules. <!-- src: t4-status (sprint 3 Task 4) -->

## Challenges we ran into

- **Getting the VLM's judgement right, and measuring it honestly.**
  1. On a clean Isaac episode, our first prompt made Nemotron report 5 issues, all false.
     We calibrated the prompt, and that episode came back clean.
  2. On the first live pipeline run, the calibrated prompt then missed all 9 real issues
     in 3 degraded demos. Scored on 5 demos, its recall was 0.
  3. So we built a hybrid: the rules own timing, and the model is given a code-measured
     grasp offset.
  4. Then we ran an ablation on 20 rendered degraded episodes:
     - rules **0.82** F1;
     - hybrid **0.90**;
     - a zero-call code grasp check **0.95**;
     - Nemotron alone **0.00**.

  On this set, the hybrid's gain comes from the code measurement, not the model's own
  judgement, and the hybrid added 10 false `bad_release` claims. We report that as it is.
  <!-- src: t4-status (sprint 2 Task 6; Diagnoser calibration; sprint 3 Task 3; sprint 4 Task 3); recall 0 on 5 demos: docs/superpowers/notes/2026-10-15-t1-status.md (sprint 4 Task 2, "s1 compare") -->
- **IK lag:** the arm trailed the target, and the cause was the joint PD drive's damping,
  not IK. Joint-velocity feedforward cut the mean tracking error from 26.8 mm to 2.1 mm
  without changing the demo. <!-- src: t2-status (sprint 2 Task 2) -->
- **Multiplication failures, traced and fixed:**
  - The cause was the old transform's fixed-time handover from the cube's frame to the
    bin's.
  - With human timing, that moment fell earlier in the lift, so variants swung up to
    0.42 m off course and reached up to 1.0 m from the shoulder.
  - Re-planning the carry between the gripper events took the clean expert from 27/30 to
    **30/30**, and degraded and perfected demos from 34/75 to **75/75**.
  <!-- src: t2-status (sprint 2 Task 4; sprint 4 Tasks 1, 3); docs/superpowers/notes/2026-10-15-t1-status.md (sprint 3 Task 1; sprint 4 Task 1) -->
- **A PC going to sleep looked like a bad demo.**
  - Five variants of one repaired demo failed with `sim_error`.
  - Windows had logged "entering sleep" in the same second as the first CUDA error.
    Replayed directly, all five succeed.
  - The sim worker now asks Windows to stay awake while a job runs, without changing any
    power setting, and retries once after the GPU recovers.
  <!-- src: t2-status (sprint 4 Task 2) -->
- **About 4% of localhost HTTP responses were reset** on this machine, even from a plain
  stdlib server. The multiply client retries, which is safe because multiply is idempotent
  by seed. <!-- src: t2-status (sprint 4 Task 3) -->
- **The second arm didn't fit.**
  - The OpenArm's ±45° wrist confines a vertical grasp to a ~0.2 m height band: 0/30
    multiplied.
  - The Flexiv Rizon 4s did better, 9/30, but its gripper physics slips.
  <!-- src: t2-status (sprint 2 Task 5; sprint 3 Task 3) -->
- **Webcam tremor broke the rules detector** (F1 0.00), until stillness was measured on a
  smoothed path and jitter on an absolute limit. <!-- src: t1-status (sprint 2 tremor run) -->
- **The 8-image limit** was discovered only through an HTTP 400 on the first live call. The
  design had planned 11 images. <!-- src: t4-nemotron-vl -->
- **Isaac Lab 3.0 differences from older tutorials:** xyzw quaternions, nested prim paths,
  glob (not regex) filter patterns, and no window unless you pass `--viz kit`.
  <!-- src: t2-status; sprint1 plan T2 Gotchas -->
- **Windows:**
  - LeRobot's checkpoint symlink fails without admin rights, so we wrote a symlink-free
    wrapper.
  - torchcodec needed a shared FFmpeg, so we decode with PyAV instead.
  - Python environments inside OneDrive fail to install.
  <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md; t3-status (sprint 2 Task 1); spec Changes -->

## Accomplishments we're proud of

- **Physics checks at scale:**
  - 50/50 scripted demos replay and verify in Isaac Lab (20/20 with cameras).
  - **30/30** multiplied variants of the clean expert pass.
  - **75/75** variants of degraded and perfected demos pass.
  - Our task is easier than MimicGen's (published 38–74%), so the claim we make is
    narrower: every failure is kept out of the dataset with a named reason.
  <!-- src: t2-status (sprint 2 Tasks 3, 6; sprint 4 Tasks 1, 3); MimicGen range: spec §3 -->
- **The full pipeline ran live:** a 12-demo set, then 5 human demos × raw / rules /
  Nemotron, perfected, multiplied and assembled into a training grid that the trainer's
  dry run accepted. <!-- src: t4-status (sprint 3 Task 3) -->
- **An ablation that tells on itself:** we scored our own model-based diagnoser against a
  zero-cost code baseline, and published that the code baseline wins on this set.
  <!-- src: t4-status (sprint 4 Task 3) -->
- **Webcam teleop into Isaac, end to end:**
  - An automated fake-hand smoke recorded 376/376 steps.
  - The saved demo verified live, and again by an independent replay.
  - It ran at 19.1 ms per control step headless, just inside real time.
  <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md (Sprint 3c T5 Task 3 follow-up) -->
- **LeRobot ACT trains natively on Windows** on an RTX 5080: 20.7 steps/s at batch 8,
  under 1 GB of torch memory. <!-- src: t3-lerobot-windows -->
- A pipeline that refuses to fake results: unmeasured values are `null` end to end, and the
  web Results page and the charts show them as "pending".
  <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3b); docs/media/README.md (Charts) -->

## Results

> **PENDING.** The headline chart: policy success on 50 fixed test positions against the
> number of human demos (5, 10, 20), for raw, raw + multiply (a MimicGen-style baseline),
> and perfected + multiply (ours). Also the policy ablation at 10 demos (rules-only vs
> rules + Nemotron repair) and the logged human minutes. <!-- src: spec §3 -->
> ACT cells of 5, 10 and 13 clean-expert episodes are trained, but not yet evaluated in
> Isaac. <!-- src: t3-status (sprint 3 Tasks 3-4) -->

Measured so far (details in the README's Results):

- **Multiplication yield, Franka:**
  - clean expert **30/30**, up from 27/30 before the handover fix;
  - degraded and perfected sources **75/75**, up from 34/75.
  <!-- src: t2-status (sprint 2 Task 4; sprint 4 Tasks 1, 3) -->
- **Diagnosis ablation** (20 degraded episodes, F1 over all issue types):

  | Diagnoser | F1 |
  |---|---|
  | rules | 0.82 |
  | hybrid | 0.90 |
  | code-only grasp check | 0.95 |
  | Nemotron alone | 0.00 |

  **The model's value is still open.** Showing it needs a test set with grasp negatives and
  real release, drop and wrong-object issues. <!-- src: t4-status (sprint 4 Task 3) -->
- **Second arm** (a negative result): OpenArm 0/30, Flexiv 9/30 multiplied.
  <!-- src: t2-status (sprint 2 Task 5; sprint 3 Task 3) -->

## Prior art, and what's new

We build on MimicGen (demo multiplication), SkillGen (segment-wise repair), DemoBridge
(planner-based repair with no VLM), ISR (de-pausing), DQAF (VLM diagnosis given only as
feedback to the human), and handrobot and AnyTeleop (webcam teleoperation).
<!-- src: spec §5 -->

Our claim, to our knowledge: *"A VLM's structured, timestamped diagnosis drives the
automatic repair of webcam teleoperation demos, verified by physics replay, then
multiplied across positions and similar arms."* We do not claim to be the first at any of
the individual pieces. Our own ablation does not yet show the VLM beating a code-only
check, so the "VLM-driven" part of the claim is still to be shown.
<!-- src: t4-status (sprint 4 Task 3) -->

## What we built during the submission period

<!-- Dates are from git history. Confirm them against the official submission-period dates before submitting. -->

- **2026-10-15:** the design spec (commit `8072315`). Then, in four parallel tracks:
  - the pure-Python core (measure, rules, repair, multiply);
  - the Isaac Lab scene, replay and success check;
  - LeRobot export and the ACT training smoke;
  - the Nemotron VL diagnoser with its first live calls.

  Also the teleop hand → end-effector mapping, the WebSocket relay and the browser client.
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
  - the sim worker's HTTP server, the Flexiv trial and 20 rendered degraded demos;
  - the first live pipeline run and ACT training on sim episodes;
  - the multiply fix confirmed in Isaac (30/30, 75/75), the sleep root cause and the
    keep-awake fix;
  - the hybrid diagnoser and its ablation;
  - the media in `docs/media/`;
  - the four web pages, `GET /results`, and the webcam-teleop sink.
  <!-- src: t4-status, t2-status, t1-status, t3-status (sprint 2-4 entries); docs/superpowers/notes/2026-10-16-web-pages.md -->
- **Reused from earlier in this repo** (started 2026-09-13 as *SANT*, a room-organizer app
  for the same hackathon): the Token Factory client and usage logging, the FastAPI backend
  shell, and the browser MediaPipe hand tracking.
- **PENDING:**
  - a webcam demo recorded by a real person;
  - the Isaac evaluation of the trained policies, which is the chart;
  - the policy ablation;
  - a demo-grade second arm.

## What's next

- Evaluate the trained policies in Isaac, and run the experiments behind the chart and the
  policy ablation. Report them, whatever they show.
- Record real webcam demos.
- Build a diagnosis test set with grasp negatives and real release, drop and wrong-object
  issues, so the model's contribution can be measured rather than assumed.

## Built with

NVIDIA Nemotron 3.5 Super VL · Nebius Token Factory · NVIDIA Isaac Sim 6.2 · NVIDIA Isaac
Lab 3.0 · LeRobot (ACT) · MediaPipe · FastAPI · React · Python · numpy · pydantic · PyTorch
