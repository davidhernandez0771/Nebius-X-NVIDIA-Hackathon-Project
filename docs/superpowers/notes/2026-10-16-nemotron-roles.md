# Where could Nemotron really help? (Sprint 5, T7 research note)

- **Date:** 2026-10-16. Branch `pm/t7-audit`, fast-forwarded to `68e4e68`.
- **Plan:** `docs/superpowers/plans/2026-10-16-sprint5-fair-nemotron-test.md`, section T7.
- **Status:** a research note that ranks options. **It does not decide.** The user picks
  Nemotron's role after T4's fair v2 ablation is in.
- **Probes:** 2 live calls, **$0.001326** in total (cap: 10 calls, $0.02). Both were logged
  to this worktree's `usage_log.jsonl`, which is git-ignored. `.env` was loaded by the
  probe script and never printed. Isaac was not used.

## The starting point

From T4's sprint 4 notes in `2026-10-15-t4-status.md`, section "Sprint 4, Track T4":

- **The zero-call code baseline won.** Rules plus a measured grasp offset scored F1
  **0.95**. The hybrid scored **0.90**: it matched the code on the grasps and added 10
  false `bad_release` claims, all on replays that verified success. Nemotron alone scored
  **0.00**.
- **The model added nothing measurable**, because the set allowed nothing else:
  - every degraded demo had an off-center grasp, so there were no negatives;
  - there were no drops or bad releases, so a `bad_release` claim could only be wrong;
  - the code-measured grasp offset was given to the model in the prompt.
- **One fact frames every role below.** In simulation, code reads the exact state: cube
  pose, contacts, gripper. A VLM can only beat code where that state is **missing**
  (no sim, or a real camera) or where the input is **open-ended language**.

**Rule constraint (spec, Changes, 2026-10-15).** The project must make "a runtime call to
the Token Factory inference API" and use at least one NVIDIA open model. So whatever role
is chosen, the submitted pipeline must still call Nemotron at runtime, and that call
should be one we can defend with a number.

## What the model can take as input (checked)

**From the official model card** (Hugging Face, `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16`):

- **Inputs:** text, images (jpeg, png) and **video (mp4, up to 2 minutes)**. The card's
  vLLM example allows one image and one video per request, and samples up to 256 frames at
  2 FPS.
- **Size and license:** 120B parameters with 12B active, a 1M-token context, license
  **OpenMDW-1.1**. Reasoning can be switched on or off in the chat template.
- **Training data** includes **RoboVQA** and **RoboInter-VQA**, robot-video question
  answering. The card does not claim robotics or grounding as a capability.
- **Benchmarks it reports:** Video-MME v2 32.85, V\* 85.60, BabyVision 29.60. These are
  below Qwen3.8-Flash-Next on all three. It reports no embodied or spatial benchmark (ERQA,
  RefCOCO, CV-Bench).
- **NVIDIA's launch blog** pitches the model for documents (OCR, tables, charts) and
  agents. It does not mention robotics or video.

**On Token Factory:**

- At most 8 images per prompt (T4's sprint 1 note, HTTP 400).
- **Video works.** This was new, and probe 1 confirms it.

### Probe 1: does Token Factory accept video, and can the model time events? (1 call)

- **Input:** T2's `degraded_0004` front camera, 703 PNGs at 50 Hz, encoded as a 14.1 s
  MP4 at 10 fps and 256×256 (75 KB). Sent as a `video_url` data-URI part, thinking off.
- **Result:** accepted. **2,397 prompt tokens, 63 completion tokens, $0.000776, 6.2 s.**
  That is cheaper than our 8-image diagnose call (about 3,300–4,000 tokens) while covering
  the whole clip.

| Question | Truth (`demo.json`, `truth.json`, `verification.json`) | Model |
|---|---|---|
| Cube ends in the bin? | yes | **yes** |
| Gripper closes at | 2.48 s | 2.0 s (0.48 s early) |
| Gripper opens at | 10.96 s | **11.0 s** |
| Pauses ≥ 0.4 s (not dont-care) | 5.47–6.32 s and 8.2–9.05 s | **none** (missed both) |
| Idle at start and end | 0–1.20 s and 12.86–14.04 s | **none** (missed both) |

**Reading (n = 1, anecdotal):**

- The outcome and the coarse gripper events come through, within about 0.5 s.
- Stillness does not come through. The model missed both 0.85 s pauses, the same weakness
  as in sprint 1 and sprint 4.
- Code already finds all of these exactly whenever a trajectory exists.

### Probe 2: can it explain a real failure? (1 call)

- **Input:** T2's `s1_0000_mx_100000`, a Franka multiply variant that **failed**
  verification with `not_in_bin, collision, dropped, unreachable`. Its max contact force
  was 928 N, and the gripper closed at 1.00 s and opened at 6.48 s. Sent as a 9.2 s MP4 at
  10 fps. In the frames, the bin sits at the left edge of the image.
- **Result:** 1,586 + 82 tokens, $0.000550, 4.8 s. The model answered
  `success: false` (**correct**) and `failure: missed_grasp, failure_t: 0.0`, with the
  evidence "the gripper … never closes on it". **That is wrong:** the gripper did close on
  the cube at 1.0 s, and the cube was dropped and hit the bin.
- Its advice ("record a demo where the gripper closes directly around the cube") follows
  from the wrong diagnosis.
- The sim's own reason codes were right, at zero cost.

**What the probes show together:** video input works and is cheap. In simulation, the model
gets the outcome right, but its account of *what happened* is unreliable. This matches the
literature below. In FailBench, the best of 13 VLM success detectors reaches **0.77**
balanced accuracy, and the detectors lean toward predicting "success" when the evidence is
ambiguous.

## Candidate roles

**Effort** assumes 14 days to Oct 30, with the main experiment, the v2 ablation and the
video still pending. **S** is ≤ 1 day for one track, **M** is 2–3 days, **L** is ≥ 4 days or
needs new capture hardware or flows.

### R1. Read the wrist frame without measured hints (T4's `hybrid_blind`)

- **What it is:** the model judges `grasp_off_center` from the wrist image alone, without
  the code-measured offset in the prompt.
- **Why code can't:** in sim, **code can, exactly**: the measured offset found 20/20 with
  0 false positives.
  - The model only beats code where sim state is missing: a real robot, or a real webcam
    scene. So a positive result here shows the model can *see* the grasp. It does not
    beat code inside this pipeline.
- **Evidence:** T4's pre-registered v2 ablation (8 off-center vs 8 centered grasps):
  - P/R/F1 for `grasp_off_center`, and the false-positive rate on the 8 negatives;
  - `hybrid_blind` vs `rules_grasp_metric`.
  - **Bar:** blind recall ≥ 0.75 with FP rate ≤ 0.25. Chance is 0.5/0.5 on this balanced
    set.
- **Effort:** **none extra.** It is already in T4's sprint 5 tasks (≤ 80 calls,
  ≤ $0.15).
- **Prior art:** DQAF (VLM diagnosis of teleop demos, cited in the spec), RoboFAC and AHA
  (failure identification), FailBench.
  - FailBench's finding that performance depends on "the visual evidence needed" applies
    directly: a 128×128 wrist frame at a 3–14 mm offset is a hard visual case.

### R2. Judge video-only demos where no sim signals exist

- **What it is:** a first-pass judge for webcam or real-world demo video: outcome, gripper
  event times, a coarse quality flag. It runs before any sim replay, or for data that never
  touches the sim.
- **Why code can't:** without sim state there is no cube pose and no contact.
  - MediaPipe landmarks give hand speed (pauses, jitter), so code still owns timing.
  - But "did the human actually grasp the right object, and did it end up in the bin?"
    can't be read from landmarks.
- **Evidence:**
  - Test: on N ≥ 20 video clips with known outcomes (half failures), outcome accuracy and
    balanced accuracy, plus gripper-event time error.
  - Compare against a trivial baseline ("always success") and against FailBench's best
    0.77.
  - Probe 1 (n = 1) gives a first point: correct outcome, events within 0.5 s.
- **Effort:** **L**, if it means real webcam video.
  - The Record page does not save the webcam video today: `TrackingAdapter` does not
    expose it (`2026-10-16-web-pages.md`).
  - Real-world human demos are out of the spec's scope ("Real hardware", one task).
  - **M** for the sim-video version: the video path is proven, and the clips exist.
    But in sim, code already knows the outcome, so that version shows feasibility only.
- **Prior art:**
  - SuccessVQA (VLMs as success detectors, 2023);
  - FailBench (2026: 2,197 attempts, best 0.77, bias toward "success");
  - AHA (ICLR 2025);
  - DQAF (spec).
  - Our angle would be the *webcam demo* setting. The new part would be the input source,
    not the method.

### R3. Explain failed policy rollouts, to choose the next demos to collect

- **What it is:** after an eval, the model watches the failed rollouts and says why each
  failed, and which demonstration a human should record next.
- **Why code can't:**
  - **Partly it can.** `success.py` already emits `not_in_bin`, `gripper_closed`,
    `not_settled`, `too_slow`, `collision`, `dropped` and `unreachable`, and `sim_eval`
    histograms them. Signals can also give the time and place of a drop.
  - What code can't easily give is *behavioural* cause and advice in words, e.g. "the
    policy hesitates over the cube when it is near the left edge; record more left-edge
    approaches".
- **Evidence:**
  - Test: on the M failed rollouts from T3's eval, cause-classification accuracy against
    a code labeller built from signals (drop time, closest approach, contact force).
  - Then the real test: collect K demos following the model's advice vs K at random, and
    compare success rates.
  - **Probe 2 (n = 1): wrong cause ("missed grasp"; it was a drop and a collision).**
- **Effort:**
  - **M** for the classification test (rollouts exist after T3's eval).
  - **L** for the closed-loop "advice improves success" test: it needs extra human
    demos, training and eval cycles, more than fit before Oct 30 next to the main
    experiment.
- **Prior art:**
  - AHA, RoboFAC (failure analysis and correction, 9,440 failure trajectories), KITE
    (keyframes for VLM failure analysis);
  - CUPID (influence functions decide which demos help or hurt; about 25–100 rollouts).
    It is a code-only alternative for the "what to collect" half, and a strong baseline
    to cite.
  - The spec lists a "director that chooses the next human demo" as **out of scope**.

### R4. Write language annotations for the LeRobot dataset

- **What it is:** for each exported episode, the model writes subtask instructions per
  segment ("move above the red cube", "grasp it", "carry it over the blue bin",
  "release") and paraphrases of the task sentence.
- **Why code can't:** code can template "pick up the red cube and place it in the blue
  bin" (today's single `task` string in `lerobot_tools/export.py:79`).
  - Varied, grounded, per-segment language is what VLMs add.
  - But segment *times* come from code here: gripper events and `rules` segments.
- **Evidence:**
  - Annotation quality: a human rates 30 episodes, % correct and specific.
  - The downstream test needs a language-conditioned policy, e.g. GR00T, the spec's
    stretch goal; a modality writer exists in `lerobot_tools/gr00t_modality.py`.
  - **ACT, the policy we train, ignores the task text,** so the downstream gain cannot be
    measured with the current trainer.
- **Effort:** **S** to generate (one call per episode, about $0.001 with video). **L**
  for a downstream number (GR00T fine-tuning on 16 GB is unverified).
- **Prior art:**
  - DIAL (RSS 2023: VLM instruction augmentation over 80k demos, 60 new instructions);
  - MolmoAct2 (2026: re-annotated SO-100/101 LeRobot data with an open VLM because
    crowd labels were junk like "lerobot_test");
  - TREAD (2026: VLM sub-task relabelling).
  - Well-trodden. Low novelty, low risk.

### R5. Turn a task sentence into a scene config and a success check

- **What it is:** "put the red cube in the bin, bin on the left" becomes a validated
  `Scene` (or multiply sampling ranges) plus parameters for `success.py`. Physics then
  checks the result, as the project's rule says.
- **Why code can't:** free-form language. A form with sliders would do the same for
  the one task we have.
- **Evidence:**
  - Test: 20 held-out sentences. Measure the % that produce schema-valid configs whose
    sampled scenes satisfy the sentence (checked by code), and the % of generated success
    checks that agree with the hand-written `success.py` on a set of verified and failed
    episodes.
- **Effort:**
  - **M** for the reduced version: sentence → multiply sampling ranges, within the
    existing `Scene` schema. The sim verifies every variant anyway, so a bad proposal
    costs yield, not correctness.
  - **L** for new tasks or success checks: `Scene` has one cube, and multiple tasks are
    out of scope.
- **Prior art:**
  - GenSim (LLM-generated sim tasks), RoboGen (generated scenes);
  - Eureka and DrEureka (LLM-written reward code, checked by training in Isaac Gym).
  - These are crowded and stronger than what fits here. Only the reduced version is
    realistic.

### R6. Natural-language repair requests on the Review page (text model)

- **What it is:** the user types "the end is too slow, and smooth the carry". The model
  maps it to validated ops from the fixed menu (`retime`, `smooth`, …), and code applies
  and verifies them.
- **Why code can't:** parsing open-ended requests into op + time range + parameters.
  - The repo already has this pattern: `src/app/ai/commands.py` (SANT: parse → validate →
    execute, `"unknown"` as the safe default) and `scripts/command_eval.py`.
- **Evidence:**
  - Test: 40 written requests with gold ops and params; exact-op accuracy, param-in-range
    rate, and the "unknown" rate on out-of-menu requests.
  - Baseline: a keyword matcher.
- **Effort:** **S–M.** It reuses the command-parser pattern and eval script. The web
  Review page exists.
  - It can use a Nemotron text tier (cheaper than VL), and the runtime-call rule is still
    met.
  - It is human-in-the-loop, so it moves Nemotron from *judge* to *interface*, which
    fits the "Design" criterion.
- **Prior art:** LLM tool and function calling in general; our own SANT command parser.
  It is not robotics-specific, so it adds little research novelty.

## Ranking (not a decision)

**Criteria, in this order:**

1. **(a)** the chance that a fair test shows the model beating code *in this project*;
2. **(b)** the effort before Oct 30;
3. **(c)** whether it keeps a defensible runtime Nemotron call in the submitted pipeline;
4. **(d)** the risk of a misleading claim.

| Rank | Role | (a) beats code here? | (b) effort | (c) runtime call | (d) risk | Why this rank |
|---|---|---|---|---|---|---|
| 1 | **R1 blind wrist read** | Unknown, and measured this sprint | none extra | yes (diagnose path) | low: pre-registered, balanced set | The only test that already exists and is fair. Its answer decides whether the "VLM diagnoses" story survives at all. Even a positive only shows the model can *see* the grasp (useful beyond sim), not that it beats sim state |
| 2 | **R6 language repair requests** | Likely: code can't parse free text, and a keyword baseline is weak | S–M | yes (text tier) | low: menu-validated, physics-verified | Cheap, measurable in a day, and honest ("the AI understands the request, code acts, physics checks"). Weak on robotics novelty |
| 3 | **R4 dataset annotations** | Yes for language variety; the downstream gain can't be measured with ACT | S (gen) / L (gain) | yes (export step) | medium: easy to overclaim without a downstream test | Low effort and standard (DIAL, MolmoAct2), but its benefit stays unmeasured unless a language-conditioned policy is trained |
| 4 | **R2 video-only judge** | Only where no sim exists; sim version is feasibility only | M (sim clips) / L (real webcam) | yes | medium-high: FailBench ceiling of 0.77, bias toward "success" | The strongest story for a webcam product, and video input is now proven and cheap. But real webcam capture isn't built, and n = 1 is all we have |
| 5 | **R3 failure explanation → next demos** | Doubtful: sim reason codes already exist; probe 2 was wrong | M (classify) / L (closed loop) | yes | high: wrong advice looks plausible | Code covers the "what failed". The "what to collect" half is CUPID's territory, and a director is out of scope in the spec |
| 6 | **R5 sentence → scene and success** | Only against a form, for one task | M (reduced) / L (full) | yes | medium | Crowded prior art (GenSim, RoboGen, Eureka); the full version breaks scope (one cube, one task) |

**Rejected as a role:** segmentation. T4 found the model's segments unscored, and the
multiply handover now keys on gripper events in code (t1 notes, sprint 3 Task 1).

**Combinations the user may weigh** (options, not recommendations):

- R1 + R6: keep the diagnose path only if R1 passes its bar, and add R6 as the
  user-facing Nemotron feature either way.
- R1 + R4: the cheapest way to keep two runtime Nemotron roles, with one of them
  measured.
- If R1 fails, report it as an honest negative result (as T4 already does), and move the
  runtime call to R6 or R4. The README's claim wording in spec §5 would then need to
  change.

## Open questions for the user

1. **Is "the model can see it" enough?** Does a positive R1 justify keeping the VLM in a
   sim-only pipeline where code reads the state exactly? Or should the claim move to
   "ready for real cameras", which we cannot test here?
2. **Webcam capture.** Is saving the webcam video (needed for R2) worth M–L effort this
   close to the deadline?
3. **The README claim** (spec §5) names "a VLM's structured, timestamped diagnosis drives
   the automatic repair". It holds only if R1, or the v2 types (`drop`, `bad_release`),
   beat code. Otherwise it needs rewording.

## Sources

- NVIDIA, Nemotron 3.5 Super VL model card: https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16
- NVIDIA blog, "NVIDIA Expands Nemotron Family With Highest Efficiency Super VL and Bolt Models": https://blogs.nvidia.com/blog/nemotron-3-5-super-vl/
- AHA (ICLR 2025): https://arxiv.org/abs/2410.00371
- Vision-Language Models as Success Detectors (SuccessVQA): https://arxiv.org/abs/2303.07280
- FailBench: https://arxiv.org/abs/2609.03611
- RoboFAC: https://arxiv.org/abs/2505.12224
- KITE: https://arxiv.org/abs/2604.07034
- CUPID: https://arxiv.org/abs/2506.19121
- DIAL, Robotic Skill Acquisition via Instruction Augmentation with VLMs (RSS 2023): https://arxiv.org/abs/2211.11736
- MolmoAct2: https://arxiv.org/abs/2605.02881
- TREAD, Task Robustness via Re-Labelling Vision-Action Robot Data: https://arxiv.org/abs/2606.10918
- DrEureka (and Eureka, GenSim, RoboGen as cited there): https://github.com/eureka-research/dreureka

**Caveat:** the papers' numbers come from their abstracts and from search snippets. The
full texts were not read. The model-card facts come from a fetch of the card page; its last
6.5k characters, which may hold a limitations section, were not read.

## Probe log

- **Script:** session scratchpad `probe_video.py`, hard cap of 1 call per run, 2 runs.
  Clips were made with ffmpeg from T2's frames, read-only.
- **Calls:** 2,397 + 63 tokens ($0.000776) and 1,586 + 82 tokens ($0.000550). Total
  **$0.001326**. The usage log shows exactly 2 entries, tagged `t7 sprint5 video probe`.

## Progress

- **2026-10-16:**
  - `git merge --ff-only perfect-then-multiply` reported "Already up to date" at
    `68e4e68`.
  - The plan file is not in `68e4e68`, so I read it from the main checkout.
  - Note written; 2 probe calls ($0.0013).
  - Committed on `pm/t7-audit`. No push, merge or rebase; no Isaac.
