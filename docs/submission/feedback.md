# Tool feedback (DRAFT)

<!-- Draft written 2026-10-16 from the project's dated notes, refreshed in sprint 3b, after sprint 4, and in sprint 7 (v2 ablation, video probe). Each finding cites its source.
     The "would we build with it again" answers are a draft for the team to confirm. -->

Context: one developer machine, Windows 11, RTX 5080 16 GB. Simulation-only Physical AI
project: webcam demo → Nemotron diagnosis → code repair → Isaac Lab verification →
multiply → LeRobot export → ACT training.
<!-- src: docs/superpowers/notes/2026-10-15-t2-status.md; docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md §1 -->

---

## 1. Nebius Token Factory

**What we used it for:** every runtime model call. Above all, multi-image diagnosis calls
to `nvidia/Nemotron-3.5-Super-VL` through the OpenAI-compatible API, using the standard
OpenAI Python SDK.

**What worked**

- **OpenAI compatibility.** Our existing client code needed only a new model tier and a
  multi-image helper. No new SDK.
- **The free model listing is genuinely useful.** `GET /v1/models?verbose=true` returned
  the modality (`text+image->text`), the context length (1,048,576), the region
  (us-north1), the rate limits (2M tokens/min, 300 requests/min) and the per-token prices,
  all without spending anything. We used it as the source of truth for our cost config.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md -->
- **Cheap and fast enough for a per-demo pipeline step:** about $0.0013–$0.0016 and
  2.3–3.9 s per 8-image diagnosis. <!-- src: t4-nemotron-vl; docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2 Task 6; Diagnoser calibration) -->
- **Usage fields in every response** let us log exact prompt/completion tokens and keep a
  hard budget per sprint. Through our pre-registered 32-demo ablation, the usage log totals
  119 calls and $0.178.
  <!-- src: t4-nemotron-vl; docs/superpowers/notes/2026-10-15-t4-status.md (sprint 6 Task 1: "usage log 51 → 119 calls, $0.073744 → $0.178014") -->

**What needs work**

- **The 8-images-per-prompt limit is not discoverable before you hit it.** It is not in
  the verbose model listing. We found it only when our first live call (10 images) failed
  with HTTP 400 `At most 8 image(s) may be provided in one prompt. (parameter=image)`.
  Our design had planned 11 images. Please expose the limit as a field in
  `/v1/models?verbose=true` (for example `max_images_per_prompt`) and in the model card.
  <!-- src: t4-nemotron-vl -->
- **Image pricing is ambiguous.** The listing says `pricing.image = "0"`, which reads as
  "images are free". In fact images are billed as prompt tokens. We had to measure it with
  a text-only calibration call: about 263 prompt tokens per 256×256 image (about $0.000079
  per image). Please document the tokens-per-image formula, or return the image token
  count separately in `usage`. <!-- src: t4-nemotron-vl -->
- **The sampling-parameter metadata is inconsistent.** The listing shows
  `supported_sampling_parameters: []`, but `temperature=0.2` was accepted. It is unclear
  which parameters are honoured. <!-- src: t4-nemotron-vl -->
- Thinking is toggled through `extra_body={"chat_template_kwargs": {"enable_thinking": False}}`.
  This works, but it is not an obvious OpenAI-style parameter. A documented example per
  model would help. <!-- src: docs/superpowers/plans/2026-10-15-sprint1-parallel-tracks.md T4 Task 2 -->

**Onboarding:** smooth for text. API key → OpenAI SDK with a base URL → working call. Vision
onboarding was less smooth, because of the two undocumented points above (the image cap and
image billing).

**Would we build with it again?** *Draft: yes.* The OpenAI compatibility and the free,
detailed model listing made it easy to integrate and to budget. The fixes we'd ask for are
documentation and metadata, not the API itself.

---

## 2. NVIDIA Nemotron 3.5 Super VL

**What we used it for:** diagnosing a robot demonstration from 7 front-camera key frames +
1 wrist frame + a text metrics table. It returns strict JSON: segments, timestamped issues,
repairs from a fixed menu, and a keep / repair / discard decision.
<!-- src: t4-nemotron-vl; t4-status -->

**What worked**

- **Format compliance:** valid JSON (no fences, no prose, times inside the demo), against a
  fairly strict schema-generated prompt. It was valid on the first try in the first three
  live diagnoses, and the 42 sprint-4 ablation calls needed no retries or fallbacks. Of the
  68 v2 ablation calls, 4 were retries, and one demo fell back to rules after two invalid
  replies (a zero-length segment).
  <!-- src: t4-nemotron-vl; t4-status sprint 2 Task 6 and Diagnoser calibration (1 call each); sprint 4 Task 3; sprint 6 Task 1 (spend, model fallbacks) -->
- **Semantic segmentation:** on a real Isaac episode it split the demo into approach
  0–1 s, grasp 1–1.5, lift 1.5–3.5, carry 3.5–6, release 6–6.5 and retreat 6.5–7.5. That
  matches the gripper events and is finer than our rules' three segments.
  <!-- src: t4-status sprint 2 Task 6 -->
- **Latency** of 2.3–3.9 s with thinking off is fine for a per-demo step.
  <!-- src: t4-nemotron-vl; t4-status (sprint 2 Task 6; Diagnoser calibration) -->
- **It responds to calibration.** Telling it that a clean demo is common and must be
  `keep`, giving it the normal metric ranges, and making the contact columns ground truth
  took the clean episode from 5 false issues to 0, with a shorter reply (633 → 188
  completion tokens) and a lower cost ($0.001648 → $0.001366).
  <!-- src: t4-status (Diagnoser calibration, Before / after and Tokens) -->

**What needs work** (our measurements: 3 early live diagnoses, 5 in the first pipeline run,
42 calls in a 20-episode ablation, and 68 calls in a pre-registered 32-demo ablation)
<!-- src: t4-nemotron-vl; t4-status (sprint 2 Task 6; calibration; sprint 3 Task 3; sprint 4 Task 3; sprint 6 Task 1) -->

- **Calibrating it is a seesaw. On a pre-registered 32-demo test, its own judgement added
  nothing measurable over code.**
  - After we calibrated it against false positives (below), it kept every degraded demo:
    it reported 0 of 9 real issues on 3 demos, and its recall over 5 scored demos was 0.
  - We then fixed a test in advance: 32 rendered demos (8 off-center grasps, 8
    centered-grasp negatives, 6 drops, 6 bad releases, 4 clean), with arms, prompts, gates
    and thresholds registered before any call.
  - F1 over all issue types:

    | Diagnoser | Model calls | F1 |
    |---|---|---|
    | rules | 0 | 0.81 |
    | rules + code grasp check | 0 | 0.84 |
    | code only (grasp + release checks) | 0 | **0.90** |
    | hybrid (rules + Nemotron, told the measured grasp offset) | 35 | 0.86 |
    | Nemotron without the measured offset | 33 | 0.80 |

  - Without the measured offset, it called **all 8 centered grasps off-center**, so it did
    not read grasp centering from the 128×128 wrist frame. With the offset, its grasp calls
    were the code metric's.
  - It **never reported a drop** (it labelled them `bad_release`), and a verified-success
    gate had to drop 20 release claims on replays that verified.
  - Code alone matched or beat both model arms on every issue type. Limits: 32 synthetic,
    scripted demos; 128×128 frames; one prompt.
  <!-- src: t4-status (sprint 3 Task 3; sprint 5 Task 1a pre-registration; sprint 6 Task 1 results); t1-status (sprint 4 Task 2, "s1 compare") -->

- **Out of the box, it over-reported on a clean demo.** With our first prompt, on a
  perfect scripted demo that our rules correctly rated `keep`, it returned `repair` with
  **5 issues, all false**: two jitter, two slow, and one `rim_contact`. The rim contact
  contradicted the contact columns in the table it was given (no arm-bin contact, 0 N max
  force). The calibrated prompt fixed this on that episode (above), and a metric gate now
  drops contradicted claims either way. One sample does not give a false-positive rate.
  Recall was measured later: the calibrated prompt alone scored 0 on 20 degraded episodes
  (see above). <!-- src: t4-status sprint 2 Task 6; Diagnoser calibration; sprint 4 Task 3 (Nemotron alone, recall 0 at n = 20) -->
- **Misreading the numeric table.** On a synthetic demo it said "gripper remains open"
  while the table said closed throughout. It also read a constant `dist_ee_cube = 0.000`
  column as "no motion" and invented two idle periods, although speed was 0.11–0.12 m/s
  there. <!-- src: t4-nemotron-vl -->
- **Time bounds snap to the input windows.** It bounded a true 1.0–1.9 s pause as
  1.0–1.5 s. That is partly our fault (0.5 s metric windows), but in that one call it did not interpolate.
  <!-- src: t4-nemotron-vl -->
- Part of this was our prompt: "find what makes this demo a poor training example"
  presumed a problem existed. Rewording it to "decide whether this demo is a good training
  example as recorded" was part of the fix. <!-- src: t4-status (Diagnoser calibration, What changed) -->
- **Video input works, but the listing doesn't say so.** The modality field says
  `text+image->text`, yet a `video_url` part was accepted (a 14.1 s, 10 fps, 256×256 MP4:
  2,397 prompt tokens, $0.000776, 6.2 s). Please list video in the modality field and
  document its format and limits. In our one probe, it got the outcome and the gripper-open
  time (11.0 s vs 10.96 s) but missed two 0.85 s pauses.
  <!-- src: docs/superpowers/notes/2026-10-16-nemotron-roles.md (Probe 1) -->

**Onboarding:** fast, because it sits behind the same Token Factory API as the text
Nemotron models.

**Would we build with it again?** *Draft: yes, but only behind code checks, and only for
what code cannot see.*
- In this sim pipeline, code sees almost everything. On our pre-registered test, the model
  did not detect drops (0/6) or read grasp centering from the wrist frame, and code matched
  or beat it on every issue type. What is left is segment labels (unscored), video-only
  demos with no sim state, and language tasks, none of them measured yet.
  <!-- src: t4-status (sprint 6 Task 1); docs/superpowers/notes/2026-10-16-nemotron-roles.md -->
- Our ablation says to measure the model against a zero-cost code baseline before trusting
  it, and to gate every kinematic claim. Our architecture already assumed this ("the AI
  decides, code acts, physics checks").

---

## 3. NVIDIA Isaac Sim 6.2 / Isaac Lab 3.0 (Windows, pip install)

**What we used it for:** a Franka pick-and-place scene with a cube, a 5-part bin, contact
sensors and two 128×128 cameras. It replays demos with differential IK, records episodes,
and feeds a pure-Python success check. <!-- src: t2-status -->

**What worked**

- **The go/no-go passed in a single short session** (about 16 minutes): the scripted demo
  replays with `"success": true`, with and without cameras. <!-- src: t2-status -->
- **Reasonable cost on a 16 GB card:** 16 s per run and 4172 MiB without cameras; 47 s and
  7184 MiB with two 128×128 cameras. <!-- src: t2-status -->
- **Contact sensors are trustworthy.** A probe that drove the fingertips into the table
  reported 287 N max; into a bin wall, 116 N. A second replay in the same process reset
  correctly. <!-- src: t2-status, Extra verification -->
- **It holds up over batches:** 50/50 scripted demos verified (13 s each without cameras),
  20/20 with cameras at a median 38.0 s and a 5980 MiB GPU peak.
  - Multiplied variants: 27/30 at first. After our own handover fix (pipeline-side, not
    Isaac), 30/30 clean, and 75/75 from degraded and perfected demos, and 100/100 for the
    home-start training set (10 sources × 10 variants, with cameras).
  <!-- src: t2-status (sprint 2 Tasks 3, 4, 6; sprint 4 Tasks 1, 3; sprint 6 Task 2) -->
- **The bundled tutorials** (`scripts/tutorials/05_controllers/run_diff_ik.py`, the
  scene, rigid-object and sensor tutorials) were the reliable API reference.
  <!-- src: sprint1 plan, T2 API source of truth -->

**What needs work**

- **Isaac Lab 3.0 opens no window by default.** You must pass `--viz kit`. For a new user
  this looks like nothing is happening. A one-line log message ("running headless; pass
  `--viz kit` for a window") would save time. <!-- src: sprint1 plan T2 Gotchas; sim_worker/scripts/smoke_replay.py docstring -->
- **Quaternion order changed to xyzw** for config `rot`, every `*_pose_w` and the IK
  command, while much online material uses wxyz. This silently produces wrong
  orientations if you follow older examples. A loud migration note would help.
  <!-- src: t2-status Decision 1 -->
- **Contact-sensor filter patterns are globs, not regexes**, and the error does not say so:
  `Filter pattern '/World/envs/env_*/Robot/(Geometry/*/)?panda_leftfinger' did not match the correct number of entries (expected 1, found 0)`.
  We had to probe the stage for `RigidBodyAPI` prims to find the real paths.
  <!-- src: t2-status Errors hit -->
- **The 3.0 Franka asset has deeply nested body paths**
  (`Robot/Geometry/panda_link0/panda_link1/…/panda_hand/panda_leftfinger`), and
  `panda_finger_joint2` has no drive (it follows by mimic). Neither is obvious from the
  config. <!-- src: t2-status Decisions 4, 7 -->
- **Leaving `launch_simulation` ends the process.** Our first smoke run exited 0 and
  printed nothing, because the prints came after the `with` block.
  <!-- src: t2-status Decision 12, Errors hit -->
- Filtered contacts need one sensing body per environment, so we put the sensors on the
  table and bin parts rather than on each arm link. <!-- src: t2-status Decision 3 -->
- **IK tracking lag** with the high-PD Franka preset: the arm trailed the target (mean TCP
  error 26.8 mm in our fast-demo comparison). The cause was the joint PD drive damping a
  moving target, not IK; more IK iterations changed nothing. Sending the commanded twist as
  joint velocity targets cut it to 2.1 mm. A note in the diff-IK tutorial that position-only
  targets lag by about damping / stiffness would help.
  <!-- src: t2-status (sprint 2 Task 2) -->
- **Joint limits matter more than reach for the OpenArm.** Its ±45° wrist confines a
  vertical grasp to a ~0.15–0.2 m height band, so it scored 0/30 in our shared workspace while
  the Franka scored 27/30 (30/30 after our handover fix). A per-robot workspace hint in the
  asset docs would help. <!-- src: t2-status (sprint 2 Task 5; sprint 4 Task 1) -->
- **Gripper finger masses on the Flexiv Rizon 4s + Grav.** The near-massless finger bodies
  slip or drag the cube. It scored 9/30 multiplied, but most of the 21 failures (15) came
  from our old handover swing, since fixed and not re-run; the other 6 are grip slips.
  Realistic finger masses need a grip re-tune.
  <!-- src: t2-status (sprint 3 Task 3 and final summary, Open items 2-3) -->
- The first launch downloads assets (37 s here). Fine, but worth saying in the quickstart.
  <!-- src: t2-status -->

**Onboarding:** the pip route (Isaac Sim 6.2.0.0 + Isaac Lab `release/3.0.0` on
Python 3.12) worked on Windows, with the venv kept outside OneDrive. The main friction was
the API changes from older tutorials (quaternion order, launcher, prim paths), not the
install. <!-- src: spec §6; t2-status (header: Isaac Lab 3.0.0 / Isaac Sim 6.2 / Python 3.12); 2026-10-16-prepublish-audit.md (Task 3: Isaac Sim 6.2.0.0); 2026-10-16-fix-windows-tests.md (Verification) -->

**Would we build with it again?** *Draft: yes.* Physics replay with real contact forces is
what makes "verified" mean something in this project, and it ran on a single consumer GPU.
We'd ask for clearer 3.0 migration notes and better error messages.

---

## 4. LeRobot 0.6.1 on Windows

**What we used it for:** exporting verified episodes to the LeRobot v3.0 dataset format
(state, action, front and wrist video, task) and training ACT policies.
<!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md -->

**What worked**

- **ACT trains natively on Windows with CUDA:** 300/300 steps at 20.7 steps/s (batch 8),
  0.99 GB of torch memory, loss 14.974 → 2.994. The checkpoint reloads and
  `select_action` returns a finite action. <!-- src: t3-lerobot-windows -->
- The `LeRobotDataset.create` / `add_frame` / `save_episode` / `finalize` API is clear once
  you know its rules (below). The default `num_workers=4` with spawn worked on Windows.
  <!-- src: t3-status Next steps 6 -->

**What needs work**

- **`lerobot-train` crashes at every checkpoint save on Windows.** `update_last_checkpoint`
  creates a symlink:
  `OSError: [WinError 1314] A required privilege is not held by the client: '000300' -> '...\checkpoints\last'`.
  Windows allows symlinks only for admins or in Developer Mode, so a long run dies at its
  first `--save_freq`. The checkpoint is written first, so nothing is lost, but the run
  stops. Suggestion: fall back to a copy or a `last.txt` pointer when `symlink_to` fails.
  We did the latter in a small wrapper (`lerobot_tools/train.py`); a 1,000-step run with 4
  saves now exits 0 and resumes. <!-- src: t3-lerobot-windows; t3-status (sprint 2 Task 1) -->
- **torchcodec fails to load:** `Could not load libtorchcodec ... We support versions 4, 5, 6, 7, and 8`
  / `Could not find module '...libtorchcodec_core8.dll'`. The only system FFmpeg was a
  static 9.0 build, and torchcodec needs a shared FFmpeg 4–8. `lerobot-info` crashes on the
  same error. The workaround is `video_backend="pyav"` everywhere. Suggestion: fall back to
  PyAV automatically, and make `lerobot-info` report the problem instead of crashing.
  <!-- src: t3-lerobot-windows Problems found 1 -->
- **Surprises in the dataset API:**
  - the output root must not exist yet (`mkdir(exist_ok=False)`);
  - `finalize()` is required, or the parquet footers are missing and the dataset won't
    load;
  - there is no per-episode custom metadata parameter, so we write our passports to a
    side file.
  <!-- src: t3-lerobot-windows Dataset API; t3-status Decisions -->
- **The base `lerobot` package has no dataset stack.** You need the `[dataset]` extra, and
  `[training]` for `lerobot-train`. We learned this by installing.
  <!-- src: t3-lerobot-windows Version -->

**Onboarding:** the install was straightforward with uv (CUDA 12.8 torch first, then
`lerobot[dataset,training]==0.6.1`). The Windows problems showed up only at runtime.
<!-- src: t3-lerobot-windows Install -->

**Would we build with it again?** *Draft: yes.* It is the standard format and trainer our
users expect, and training itself was fast on Windows. The symlink and torchcodec problems
are small, fixable Windows gaps.

---

## Cross-cutting: Python environments on Windows with OneDrive

Not an NVIDIA or Nebius tool, but it cost us time, and other Windows hackers will hit it:

- A uv `.venv` inside a OneDrive-synced folder fails to install, with os errors 5 and 396.
  Fix: keep environments outside OneDrive (`C:\venvs\...`) and set `UV_LINK_MODE=copy` so uv
  copies instead of hardlinking. <!-- src: spec Changes; sprint1 plan Global Constraints -->
- Install guides for Isaac Sim, Isaac Lab and LeRobot could mention this, since all three
  use large pip environments.

## Cross-cutting: long GPU runs on a Windows desktop

- **Windows idle sleep kills CUDA mid-run, and it looks like a bad input.**
  - Five multiply variants of one repaired demo failed with `sim_error`, in 8.3 s in total.
    The worker log showed `CUDA error: unknown error` and then `Warp CUDA error 999`.
  - The Windows System log had `Kernel-Power 42` ("entering sleep") in the same second.
  - Replayed directly, the same variants all succeed.
  - **Fix:** while a job runs, the sim worker calls
    `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`, which changes no power
    setting and needs no admin. After a failed replay, it waits for the GPU to answer and
    retries once.
  - A hint in the Isaac Lab docs ("long headless runs: keep the system awake") would have
    saved us a debugging session.
  <!-- src: t2-status (sprint 4 Task 2) -->
- **About 4% of localhost HTTP responses were reset** (`WinError 10054`) on this machine,
  even from a plain stdlib `ThreadingHTTPServer`. The likely cause, unproven, is security
  software inspecting traffic. Retrying idempotent calls makes it harmless.
  <!-- src: t2-status (sprint 4 Task 3) -->
