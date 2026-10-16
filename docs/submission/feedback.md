# Tool feedback (DRAFT)

<!-- Draft written 2026-10-16 from the project's dated notes. Each finding cites its source.
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
  2.5–3.9 s per 8-image diagnosis. <!-- src: t4-nemotron-vl; docs/superpowers/notes/2026-10-15-t4-status.md -->
- **Usage fields in every response** let us log exact prompt/completion tokens and keep a
  hard budget per sprint. Our whole diagnoser track spent about $0.0017.
  <!-- src: t4-nemotron-vl -->

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

- **Format compliance:** valid JSON on the first try in both live diagnoses (no fences, no
  prose, times inside the demo), against a fairly strict schema-generated prompt.
  <!-- src: t4-nemotron-vl; t4-status sprint 2 Task 6 -->
- **Semantic segmentation:** on a real Isaac episode it split the demo into approach
  0–1 s, grasp 1–1.5, lift 1.5–3.5, carry 3.5–6, release 6–6.5 and retreat 6.5–7.5. That
  matches the gripper events and is finer than our rules' three segments.
  <!-- src: t4-status sprint 2 Task 6 -->
- **Latency** of 2.5–3.9 s with thinking off is fine for a per-demo step.
  <!-- src: t4-nemotron-vl; t4-status -->

**What needs work** (our measurements; the sample is small, 2 valid diagnoses)

- **False positives on a clean demo.** On a perfect scripted demo, which our rules
  correctly rated `keep`, it returned `repair` with **5 issues, all false**: two jitter, two
  slow, and one `rim_contact`. The rim contact contradicted the contact columns in the
  table it was given (no arm-bin contact, 0 N max force). Its proposed repairs would have
  degraded the demo. <!-- src: t4-status sprint 2 Task 6 -->
- **Misreading the numeric table.** On a synthetic demo it said "gripper remains open"
  while the table said closed throughout. It also read a constant `dist_ee_cube = 0.000`
  column as "no motion" and invented two idle periods, although speed was 0.11–0.12 m/s
  there. <!-- src: t4-nemotron-vl -->
- **Time bounds snap to the input windows.** It bounded a true 1.0–1.9 s pause as
  1.0–1.5 s. That is partly our fault (0.5 s metric windows), but it never interpolated.
  <!-- src: t4-nemotron-vl -->
- Part of this is our prompt: "find what makes this demo a poor training example"
  presumes a problem exists. We will recalibrate the prompt before blaming the model
  further. <!-- src: t4-status sprint 2 Task 6, Recommendations -->
- There is no video input (the modality is text+image→text), so we sample key frames.
  Native short-video input would suit robot demos well. <!-- src: t4-nemotron-vl -->

**Onboarding:** fast, because it sits behind the same Token Factory API as the text
Nemotron models.

**Would we build with it again?** *Draft: yes, for what code cannot see.* Here that means
segment labels, and (still to be tested) wrong object, drops and grasp quality from the
wrist view. We would not trust its kinematic claims without gating them against measured
metrics. Our architecture already assumes this ("the AI decides, code acts, physics
checks").

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
- **IK tracking lag** with the high-PD Franka preset: mean TCP error 24.6 mm (max 51 mm)
  during motion, about 0.1 s behind the target. This matters for faster, human-like demos.
  <!-- src: t2-status Risks -->
- The first launch downloads assets (37 s here). Fine, but worth saying in the quickstart.
  <!-- src: t2-status -->

**Onboarding:** the pip route (Isaac Sim 6.2.0.0 + Isaac Lab `release/3.0.0` on
Python 3.12) worked on Windows, with the venv kept outside OneDrive. The main friction was
the API changes from older tutorials (quaternion order, launcher, prim paths), not the
install. <!-- src: spec §6; t2-status. Versions per the task brief. -->

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
  <!-- src: t3-lerobot-windows -->
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
