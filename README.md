# Perfect, then multiply

**Turn a noisy webcam robot demo into many physics-verified training demos: NVIDIA
Nemotron 3.5 Super VL diagnoses it, code repairs it, Isaac Lab checks it, and the
verified demo is multiplied and exported for LeRobot.**

Submission for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/),
Physical AI track. Simulation only, no physical robot (allowed by the official FAQ; see
[the screenshot](docs/superpowers/notes/2026-10-15-faq-physical-ai-simulation-allowed.jpg)).

**Rule: the AI decides, code acts, physics checks.**

> **Status (2026-10-16): work in progress.** Every stage is built and tested, and the
> physics side is measured: 50/50 scripted demos verify in Isaac Lab and 27/30 multiplied
> variants pass. The backend can now chain diagnose → repair → verify through a sim worker,
> but **that chain has not run live yet** (the sim worker's HTTP server is still being
> built), and the headline experiment has not run. See [Pipeline status](#pipeline-status)
> and [Results](#results). Nothing below claims a result that has not been measured.
> <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 2 Tasks 3-4: 50/50, 27/30); docs/superpowers/notes/2026-10-15-t4-status.md (sprint 3 Tasks 3-5: perfect jobs built, live run not done, worker down) -->

## The problem

- Robot policies learn by imitating demonstrations, and they need many of them.
- Human demonstrations are the expensive part. Vendor estimates: teleoperation rigs cost
  $6k–$80k, operators $25–$50/hour, and 20–30% of demos are discarded.
  <!-- src: docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md §2 (vendor estimates) -->
- A webcam costs almost nothing, but webcam teleoperation demos are noisy: pauses, shaking,
  off-center grasps.

So the question is: can a cheap, noisy demo be *perfected*, checked in physics, and then
*multiplied* into many good ones?

## How it works

One task: pick up a red 5 cm cube and place it in a blue bin, with a simulated Franka arm.
<!-- src: spec §4 -->

```
record ─► measure ─► diagnose ─► repair ─► verify ─► multiply ─► export ─► train
webcam    code       Nemotron    code      Isaac     code +       LeRobot   LeRobot
hand      metrics    3.5 Super   (fixed    Lab       Isaac        v3.0      ACT
                     VL          menu)     replay    verify
```

1. **Record.** The browser tracks your hand with MediaPipe and sends a hand pose at about
   30 Hz over a WebSocket. The backend validates each message and relays it to the sim
   worker, which maps it to an end-effector target for differential IK.
   <!-- src: spec §8.1; docs/superpowers/notes/2026-10-15-t4-status.md (sprint 1b) -->
2. **Measure.** Pure code computes motion metrics in 0.5 s windows: speed, jerk, gripper
   state, end-effector-to-cube distance, cube height and contacts.
   <!-- src: spec §7 Metrics -->
3. **Diagnose.** Nemotron 3.5 Super VL, on Nebius Token Factory, looks at key frames plus
   the metrics table. It returns JSON: the demo's segments, its issues with timestamps,
   which repairs to run, and a `keep` / `repair` / `discard` decision.
4. **Repair.** Code applies the chosen repairs from a fixed menu: `trim`, `remove_pause`,
   `smooth`, `retime`, `recenter_grasp`, `replan_transit`, `discard`. Each op has
   unit-tested invariants (for example, `remove_pause` leaves no position jump over 1 cm at
   the stitch). <!-- src: spec §8.4 -->
5. **Verify.** Isaac Lab replays the trajectory through the same diff-IK controller and
   records the episode. Pure code (`demo_pipeline/success.py`) then decides success: cube
   in the bin, gripper open, cube settled, no hard arm collisions, no drop.
   <!-- src: spec §8.5; docs/superpowers/notes/2026-10-15-t2-status.md -->
6. **Multiply.** A verified demo is transformed to newly sampled cube and bin positions:
   up to the grasp it moves rigidly with the cube, from the release on rigidly with the
   bin, and the carry between them is re-planned along the new grasp→release line. Each
   variant is verified again, and failures are kept out of the dataset with a named
   reason. Sampling ranges are per robot.
   <!-- src: docs/superpowers/notes/2026-10-15-t1-status.md (sprint 3 Tasks 1-2); docs/superpowers/notes/2026-10-15-t2-status.md (sprint 2 Task 4) -->
7. **Export.** Only verified episodes go out, as a LeRobot v3.0 dataset with front and
   wrist video. Each episode gets a *passport* recording its lineage, repairs, diagnosis
   source and model ID. <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md -->
8. **Train.** LeRobot ACT, served over HTTP by a policy server and evaluated in Isaac on
   fixed test scenes by `sim_eval/`, with the same success check.
   <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md (sprint 2 Task 2; sim_eval final summary) -->

### How NVIDIA Nemotron 3.5 Super VL is used (via Nebius Token Factory)

- **Model ID:** `nvidia/Nemotron-3.5-Super-VL` (text+image→text). The API echoed the same
  ID back. <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md -->
- **Endpoint:** Token Factory's OpenAI-compatible API, `https://api.tokenfactory.nebius.com/v1/`,
  through the repo's `nebius_llm` client (vision tier `nemotron-vl` in
  [`src/nebius_llm/config.py`](src/nebius_llm/config.py); override it with
  `NEBIUS_MODEL_VISION_NEMOTRON`). Every call is logged to `usage_log.jsonl` with its token
  counts and estimated cost.
- **Input per diagnosis:** at most **8 images**, because Token Factory rejects more with
  HTTP 400. That means 7 evenly spaced front-camera frames, each captioned with its time,
  plus 1 wrist frame at the first gripper close, or 8 front frames when there is no wrist
  frame. Also the metrics table as compact text, the task sentence, and the replay success
  flag. Thinking is turned off (`chat_template_kwargs: {enable_thinking: false}`).
  <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md; docs/superpowers/plans/2026-10-15-sprint1-parallel-tracks.md T4 Task 2 -->
- **Output:** one JSON `Diagnosis` that is validated before use: segments in order and
  inside the demo, issue types and repair ops from fixed lists, valid times. The prompt is
  generated from the pydantic schema, so the prompt and the validator cannot drift apart.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md -->
- **On failure:** an invalid reply is retried once, with the validation error appended.
  If it is still invalid, or Token Factory returns an error (auth, 429, 400), the backend
  falls back to the rules detector and records `diagnosis_source: "rules"`.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2, Task 5) -->
- **Metric gate:** after parsing, `gate_diagnosis` drops any `rim_contact`, `jitter` or
  `slow` issue that the measured windows contradict (no arm-bin contact, jerk below the
  jitter limit, speed not slow), along with the repairs tied only to it. If nothing is
  left, the decision becomes `keep`. Every dropped item is listed and stored with the
  diagnosis, and the Review page shows it struck through.
  <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (Diagnoser calibration, "Gate"; sprint 3 Task 1) -->
- **Measured cost and latency:**

  | Call | Images | Prompt tokens | Completion tokens | Cost | Latency |
  |---|---|---|---|---|---|
  | Synthetic demo, 256×256 frames | 8 | 3,269 | 390 | $0.001332 | 2.52 s |
  | Real Isaac episode, old prompt | 8 | 3,595 | 633 | $0.001648 | 3.9 s |
  | Same episode, calibrated prompt | 8 | 3,990 | 188 | $0.001366 | 2.3 s |

  <!-- src: row 1 docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md; row 2 docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2, Task 6); row 3 t4-status (Diagnoser calibration, Before / after table and "Tokens") -->
  - Price: $0.30 per 1M prompt tokens, $0.90 per 1M completion tokens. Images are billed
    as prompt tokens, about 263 tokens per 256×256 image.
    <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md -->
  - So one diagnosis costs about $0.0013–$0.0016 and takes about 2.3–3.9 s.
    <!-- src: the three rows above -->
- **What it is good at so far:** see [Results](#results). In short: valid JSON on the first
  try every time, good segmentation, and, since the calibration, no false issues on the
  clean episode it was tested on (one sample; recall is not measured yet).

### NVIDIA Isaac Sim 6.2 / Isaac Lab 3.0

- The pick-place scene is defined in `sim_worker/scene_cfg.py`: table, Franka
  (`FRANKA_PANDA_HIGH_PD_CFG`), red cube, a blue bin built from 5 cuboids, contact sensors,
  and two 128×128 cameras (front and wrist). <!-- src: docs/superpowers/plans/2026-10-15-sprint1-parallel-tracks.md T2 Task 2; t2-status -->
- `sim_worker/replay.py` drives the arm with differential IK (absolute pose) and records
  the episode: joint states, actions, images, cube pose and contacts.
- **Joint-velocity feedforward is on by default.** The arm used to trail the target: the
  joint PD drive's damping lags a moving target by about 0.2 s. Sending the commanded
  twist as joint velocity targets cut the mean tracking error from 26.8 to 2.1 mm (16.0
  to 3.3 mm at the gripper close), without changing the demo. More IK iterations changed
  nothing. <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 2 Task 2) -->
- `sim_worker/robots.py` holds per-robot constants: the Franka, and the OpenArm as a
  second arm (see [Results](#results) for why its yield is low).
  <!-- src: t2-status (sprint 2 Task 5) -->
- Physics dt 0.01 s, control and recording at 50 Hz. <!-- src: spec §6 -->

### LeRobot

- `lerobot_tools/export.py` writes verified episodes as a LeRobot dataset (lerobot 0.6.1,
  dataset format v3.0): state, action, front and wrist video, task text, plus a
  `passports.jsonl`.
  <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md -->
- Policy: LeRobot **ACT** (`lerobot-train --policy.type=act`).

## Prior art and our claim

This work builds on, and cites:

- **MimicGen**: object-relative demo multiplication.
- **SkillGen**: segment-wise repair.
- **DemoBridge**: planner-based repair of single-view human demos, with no VLM.
- **ISR**: de-pausing demos, reported +25%. <!-- src: spec §5 -->
- **DQAF**: VLM diagnosis of teleop demos, given as feedback to the human only.
- **handrobot** and **AnyTeleop**: webcam teleoperation.

**Our claim (to our knowledge):**

> "A VLM's structured, timestamped diagnosis drives the automatic repair of webcam
> teleoperation demos, verified by physics replay, then multiplied across positions and
> similar arms."

We do **not** claim to be the first at webcam teleop, demo repair, VLM demo critique or demo
multiplication. Each of those exists already (see above). <!-- src: spec §5 -->

## Pipeline status

| Stage | Code | State today |
|---|---|---|
| Record | `demo_pipeline/teleop.py`, `src/app/routers/teleop.py`, `web/src/teleop/*`, `web/src/pm/record/` | Hand→target mapping, gripper latch, WebSocket relay, browser client and Record page are built and tested. **The sim-worker side that drives the arm from the webcam, and saves the recording as a demo, is not merged yet.** |
| Measure | `demo_pipeline/measure.py` | Built, tested |
| Diagnose | `src/app/ai/diagnose.py`, `POST /demos/{id}/diagnose` | Built, with a calibrated prompt and a metric gate. Tested with mocks; 3 live diagnose calls so far |
| Rules detector + repair | `demo_pipeline/rules.py`, `repair.py` | Built. Scored on synthetic tremor demos (see [Results](#results)) |
| Verify | `sim_worker/replay.py`, `demo_pipeline/success.py` | Built, measured: 50/50 scripted demos verify |
| Multiply | `demo_pipeline/multiply.py`, `sim_worker/scripts/multiply_run.py` | Built, measured in Isaac: Franka 27/30. The handover fix for the 3 failures is merged; **its Isaac re-run is PENDING** |
| Second arm (OpenArm) | `sim_worker/robots.py` | Runs end to end, but its yield in the shared ranges is near zero (see [Results](#results)) |
| Perfect pipeline | `POST /demos/{id}/perfect`, `GET /jobs/{id}`, `scripts/run_pipeline_batch.py` | Built and tested against a fake sim worker. **Not run live yet**: the sim worker's HTTP server is not merged |
| Export | `lerobot_tools/export.py`, `assemble.py` | Built, tested |
| Train / eval | `lerobot_tools/train.py`, `experiments.py`, `policy_server.py`; `sim_eval/` | Built. Isaac eval smoke-tested on a smoke checkpoint. **No policy trained on real episodes yet** |
| Web pages | `web/src/pm/` | Record, Review (with the Perfect button), Dataset and Results are built and tested; Results reads `GET /results` |

<!-- src: docs/superpowers/notes/2026-10-15-t1-status.md (sprint 2 tremor run; sprint 3); docs/superpowers/notes/2026-10-15-t2-status.md (sprint 2); docs/superpowers/notes/2026-10-15-t3-status.md (sprint 2; sim_eval); docs/superpowers/notes/2026-10-15-t4-status.md (calibration; sprint 3); docs/superpowers/notes/2026-10-16-web-pages.md; 3 diagnose calls = t4-status Money (1 synthetic), sprint 2 Task 6 and calibration (2 on the same real episode); the 4th usage-log entry is a text-only token-count call -->

## Setup (Windows 11, verified on an RTX 5080 16 GB)

The project uses **three Python environments**, because Isaac Lab, LeRobot and the backend
pin different versions. `demo_pipeline` depends only on numpy and pydantic, so all three
can import it. <!-- src: spec §6, Changes -->

**Rule for every environment:** keep it **outside OneDrive** (we use `C:\venvs\...`) and
run uv with `UV_LINK_MODE=copy`. A `.venv` inside a OneDrive folder fails to install (os
errors 5 and 396). <!-- src: spec Changes; sprint1 plan Global Constraints -->

### 1. Backend + pipeline (the "SANT" venv)

Needs Python 3.11+, [uv](https://docs.astral.sh/uv/), and a Nebius Token Factory API key
from [tokenfactory.nebius.com](https://tokenfactory.nebius.com).

```powershell
git clone https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project.git
cd Nebius-X-NVIDIA-Hackathon-Project

$env:UV_PROJECT_ENVIRONMENT = "C:\venvs\pm-<name>"   # any folder outside OneDrive
$env:UV_LINK_MODE = "copy"
uv sync --all-extras

cp .env.example .env    # then paste your key into NEBIUS_API_KEY; never commit .env
```

Set the two `$env:` variables again in every new PowerShell before any `uv` command. In Git
Bash, a bare `python` may hit a broken uv trampoline, so use `uv run python`.
<!-- src: docs/superpowers/notes/2026-10-15-t1-status.md; 2026-10-16-fix-windows-tests.md -->

### 2. Isaac Sim 6.2 + Isaac Lab 3.0 (the sim worker)

What works on this machine: the **Isaac Sim 6.2.0.0 pip package** on **Python 3.12**, with
**Isaac Lab from the `release/3.0.0` branch**. The venv is `C:\isaac\env_isaaclab`
(Python 3.12.14) and the Isaac Lab checkout is `C:\isaac\IsaacLab`.
<!-- src: spec §6 (venv, Python 3.12.14); t2-status (Isaac Lab 3.0.0 / Isaac Sim 6.2 / Python 3.12); sprint1 plan T2 (C:\isaac\IsaacLab); pip version 6.2.0.0 and branch release/3.0.0 from the submission-docs task brief (not in a note) -->

> **Unverified here:** the exact install commands for Isaac Sim and Isaac Lab were not
> recorded in this repo's notes. Follow NVIDIA's official Isaac Lab pip installation guide
> for those versions, using a venv outside OneDrive.

Then install this repo's pure-Python contract into Isaac's venv:

```powershell
C:\isaac\env_isaaclab\Scripts\python.exe -m pip install -e <path-to-this-repo> --no-deps
C:\isaac\env_isaaclab\Scripts\python.exe -m pip install pytest
```

<!-- src: docs/superpowers/plans/2026-10-15-sprint1-parallel-tracks.md, Track T2 -->

Gotchas:

- **Isaac Lab 3.0 opens no window unless you pass `--viz kit`.** Without it, runs are
  headless. <!-- src: sprint1 plan, T2 Gotchas -->
- The first launch downloads assets. It took 37 s here. <!-- src: t2-status -->
- Isaac Lab 3.0 uses **xyzw** quaternions. This repo uses wxyz everywhere and converts only
  at the sim boundary. <!-- src: t2-status, Decision 1 -->

### 3. LeRobot (export + training)

```powershell
$env:UV_LINK_MODE="copy"
uv venv --python 3.12 C:\venvs\lerobot
uv pip install --python C:\venvs\lerobot\Scripts\python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python C:\venvs\lerobot\Scripts\python.exe "lerobot[dataset,training]==0.6.1" pytest
uv pip install --python C:\venvs\lerobot pydantic
uv pip install --python C:\venvs\lerobot\Scripts\python.exe -e <path-to-this-repo> --no-deps
```

<!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md (Install); pydantic line from docs/superpowers/plans/2026-10-15-sprint2-parallel-tracks.md T3 -->

- The CUDA 12.8 build is needed for the RTX 5080. <!-- src: sprint1 plan T3 Task 1 -->
- **Load and train with `video_backend=pyav`.** torchcodec could not load here: it needs a
  *shared* FFmpeg 4–8, and the system FFmpeg was a static 9.0 build. PyAV bundles its own
  FFmpeg. <!-- src: t3-lerobot-windows, Problems found 1 -->
- pydantic is needed by `demo_pipeline` but is not a LeRobot dependency. Install it
  explicitly, as above. <!-- src: t3-status, Blocked 3 -->
- **Bare `lerobot-train` exits 1 at every checkpoint save on Windows** (`WinError 1314`:
  it creates a symlink, which needs admin rights or Developer Mode).
  <!-- src: t3-lerobot-windows --> Train through the wrapper instead,
  `python -m lerobot_tools.train <lerobot-train args>`. It writes a `last.txt` pointer
  instead of the symlink and resumes with `--resume-last <output_dir>`. A 1,000-step run
  with 4 checkpoint saves exits 0. <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md (sprint 2 Task 1 and final summary) -->

## Run what exists today

**Tests (backend + pipeline, all AI calls mocked, no network, no spend):**

```powershell
uv run pytest -q
```

Latest run on this branch: **770 passed, 10 skipped, 0 failed.** The skips need lerobot,
PIL or torch (they run in the other venvs), or are GPU runs gated by `T3_GPU_TESTS=1`.
<!-- src: test output 2026-10-16 (`uv run pytest -q -rs`), recorded in docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3b) -->

**Isaac-side tests** (they need no repo fixtures, hence `--noconftest`):

```powershell
C:\isaac\env_isaaclab\Scripts\python.exe -m pytest -q --noconftest -p no:cacheprovider tests/test_dp_success.py tests/test_sim_scripted.py tests/test_dp_schemas.py
```

<!-- src: sprint2 plan T2 "Run tests"; t2-status reports 39 passed for these files -->

**Smoke replay in Isaac Lab** (scripted expert on a fixed scene → replay → verify):

```powershell
C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\smoke_replay.py --no-cameras --out data\smoke
```

- It prints `RESULT_JSON {"success": true, ...}`. <!-- src: t2-status -->
- Drop `--no-cameras` to also record front and wrist 128×128 PNGs (`--out data\smoke_cam`
  was used for the camera run).
- **Unverified:** adding `--viz kit` to open a window. The script uses Isaac Lab's
  standard launcher arguments, but it was only run headless.

**Nemotron diagnosis (real, billed Token Factory calls):**

```powershell
uv run python scripts/smoke_test.py                 # checks the API key with one tiny call
uv run python scripts/diagnose_smoke.py             # synthetic demo with one 0.9 s pause
uv run python scripts/diagnose_real_episode.py --dry-run --episode <episode-dir>   # builds inputs + runs rules, no call
```

- `smoke_test.py` comes from the previous README and was not re-run for this one.
- Both diagnose scripts refuse to run past their call budget, so they cannot overspend by
  accident. <!-- src: script docstrings; t4-status -->

**Backend** (http://localhost:8000):

```powershell
uv run uvicorn app.main:app --reload --app-dir src
```

The new routes:

- `GET /teleop/status` and the WebSocket `/ws/teleop?role=browser|sim`;
- `POST /demos`, `GET /demos`, `GET /demos/{id}`, `POST /demos/{id}/diagnose`,
  `GET /demos/{id}/diagnosis`;
- `POST /demos/{id}/perfect?diagnoser=rules|nemotron` → 202 with a job id, then
  `GET /jobs/{id}`. It answers 503 when the sim worker (default `http://127.0.0.1:8770`,
  or `SIM_WORKER_URL`) is not running;
- `GET /results`: `DATA_DIR/results/results.json`, or 404 "no results yet".

Demos and results live under `DATA_DIR` (default `data/`, git-ignored).
<!-- src: t4-status sprint 1b, sprint 2 Task 5, sprint 3 Tasks 2-3; docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3b, GET /results) -->

**Web pages** (Record, Review, Dataset, Results, under `/pm/` in the dashboard):

```powershell
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
```

- Latest run: **163 web tests passed**, and the build passes.
  <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md (sprint 3b) -->
- To open them, run the backend above and the Vite dev server (`npm --prefix web run dev`,
  from `web/package.json`; the backend's CORS allows `http://localhost:5173`), then go to
  `/pm/review`. <!-- src: CORS port from docs/superpowers/notes/2026-10-15-t4-status.md (sprint 1b) -->
- Every page shows a clear message when the store is empty, the backend or sim worker is
  down, or a route is missing. Results shows the sample file under a **SAMPLE DATA**
  banner until `GET /results` serves measured data.
  <!-- src: docs/superpowers/notes/2026-10-16-web-pages.md -->

**LeRobot exporter tests and the ACT training smoke:**

```powershell
C:\venvs\lerobot\Scripts\python.exe -m pytest -q lerobot_tools\tests
C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.train_smoke
```

<!-- src: t3-status (5 passed); t3-lerobot-windows (train smoke) -->

## Results

Every number here was measured, and each cites the note it comes from. Anything not
measured yet is marked **PENDING**.

### Physics: verify and multiply (Isaac Lab, Franka)

| What | Result |
|---|---|
| Scripted demos replayed and verified | **50/50** success, 13 s per episode, no cameras <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md (sprint 2 Task 3) --> |
| Workspace corners | **8/8** success <!-- src: t2-status (sprint 2 Task 3) --> |
| With front + wrist cameras | **20/20** success, median 38.0 s per episode, peak GPU 5980 MiB <!-- src: t2-status (sprint 2 Task 6) --> |
| Tracking error, after the velocity feedforward fix | mean **26.8 → 2.1 mm**, at the gripper close 16.0 → 3.3 mm <!-- src: t2-status (sprint 2 Task 2) --> |
| **Multiplication yield, Franka** | **27/30 = 90%** (seeds 100–129), next to MimicGen's published 38–74% <!-- src: t2-status (sprint 2 Task 4); MimicGen range: spec §3, §8.6 --> |

- **The 3 multiply failures were traced, not guessed.** The old transform handed the hand
  over from the cube's frame to the bin's at a fixed time, while the hand was still above
  the source cube. Variants with the bin far on one side swung past the Franka's reach.
  <!-- src: t2-status (sprint 2 Task 4) -->
- **The fix is merged:** the carry now follows the new grasp→release line, with the
  handovers at the gripper events. In geometry, 0/30 variants now reach further than the
  scripted expert, against 19/30 before. **The Isaac re-run that would confirm 30/30 is
  PENDING.** <!-- src: docs/superpowers/notes/2026-10-15-t1-status.md (sprint 3 Task 1) -->
- **Our task is easier than MimicGen's**: one 5 cm cube, a large open bin, a top-down
  grasp. The honest claim is that the transform + verify loop keeps every failure out of
  the dataset, with a named reason. <!-- src: t2-status (sprint 2 Task 4, "vs MimicGen") -->

### The second arm: OpenArm (a negative result)

- The OpenArm runs end to end: scene, replay, batch and multiply. It tracks within 4 mm
  below about 0.20 m and grasps with 1.0–1.2 mm error at the close.
  <!-- src: t2-status (sprint 2 Task 5) -->
- **But its yield in the shared workspace is near zero:** 0/30 multiplied, 2/30 scripted.
  22 more scripted runs put the cube in the bin but fail the strict `unreachable` rule
  (they deviate 3–4.5 cm from the demo for more than 1 s). <!-- src: t2-status (sprint 2 Task 5) -->
- **Cause, measured:** its wrist joint is limited to ±45°, so holding the gripper
  vertical confines it to a ~0.15–0.2 m height band, and the shared workspace does not
  fit in that band from any base placement we tried. Per-robot ranges now exist in code;
  tuning them for the OpenArm, or choosing another second arm, is **PENDING**.
  <!-- src: t2-status (sprint 2 Task 5); t1-status (sprint 3 Task 2); spec Changes 2026-10-16 -->

### Diagnosis: rules and Nemotron

- **The rules detector under synthetic webcam tremor:** F1 on the issue types it detects
  (pause, idle, jitter) went from **0.00 to 0.97–0.99** at 1–4 mm of tremor, with precision
  ≥ 0.99 (seeds 0–199; 0.98 pooled on held-out seeds 1000–1199). Clean demos are unchanged.
  <!-- src: docs/superpowers/notes/2026-10-15-t1-status.md (sprint 2, Step 5 tables and "Reading the tables") -->
- **What the rules cannot do:** on a 60-demo mixed set they never name `slow` or
  `grasp_off_center` (54 of the 57 misses); F1 over all issue types is 0.85. That gap is
  where Nemotron has to earn its place. <!-- src: t1-status (sprint 3 Task 3, rules baseline on pilot60) -->
- **Nemotron's false positives, fixed on the test episode.** On a clean Isaac episode,
  the first prompt reported 5 issues, all false (2 jitter, 2 slow, 1 rim contact), and
  would have "repaired" a perfect demo. With the calibrated prompt and the metric gate:
  **0 issues, decision `keep`**, matching the rules. That call cost $0.0014 and took
  2.3 s. <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md (Diagnoser calibration, Before / after) -->
  - The gate alone, applied offline to the old reply, also removes all 5.
  - **Limits:** this is one episode and one call; the model's output varies run to run.
    **Recall is not measured yet**, and "when in doubt, leave it out" could hide real
    issues. Scoring Nemotron against ground truth is **PENDING**.
    <!-- src: t4-status (Diagnoser calibration, "Limits, honestly") -->
  - What it adds over the rules so far: **segmentation**, six segments (approach,
    grasp, lift, carry, release, retreat) against the rules' three.
    <!-- src: t4-status (Diagnoser calibration, "Segmentation is unchanged") -->

### Training and evaluation

- **LeRobot ACT trains natively on Windows:** 300/300 steps at 20.7 steps/s (batch 8),
  0.99 GB of torch memory; the checkpoint reloads and returns a finite action. Synthetic
  data only. <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md -->
- **The Isaac eval harness works end to end** on a smoke checkpoint: 3 test scenes, every
  episode ran its full 30 s with no policy errors. That checkpoint was never trained on
  real episodes, so its 0/3 says nothing about the method.
  <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md (sim_eval Step 4) -->

### The chart: PENDING

> **PENDING, not yet measured.** Policy success rate on 50 fixed test positions against
> the number of human demos (5, 10, 20), for three conditions: raw; raw + multiply (a
> MimicGen-style baseline); perfected + multiply (ours). Logged human minutes per
> condition.
> <!-- src: spec §3 -->
>
> The web Results page draws it from `GET /results` as soon as the experiment writes
> `DATA_DIR/results/results.json`; values not measured yet show as "pending".

### Ablation: PENDING

> **PENDING, not yet measured.** At 10 human demos: rules-only repair vs rules + Nemotron
> repair. <!-- src: spec §3 -->

Negative results will be reported as they come out.

## Limitations

- **Not run end to end yet.** The perfect pipeline is built and tested against a fake sim
  worker, but the live run waits for the sim worker's HTTP server. The webcam → sim
  teleop loop is not merged either. <!-- src: t4-status (sprint 3 Task 5) -->
- **Nemotron's evidence base is small:** 3 live diagnose calls, one synthetic and two on
  the same real episode (before and after the calibration). Its recall is unmeasured.
  <!-- src: t4-status (Money / real calls; sprint 2 Task 6; Diagnoser calibration) -->
- **Rules numbers are on synthetic tremor** (6 Hz Gaussian), not yet on real webcam
  recordings. <!-- src: t1-status (Tremor run final summary, For the lead 3) -->
- **The OpenArm second arm does not fit the shared workspace** (see above).
- **The eval starts from the robot's default joint pose**, which may differ from where the
  training demos start. <!-- src: t3-status (sim_eval, Open items 2) -->
- **One task, simulation only, no real hardware.** <!-- src: spec §4 -->
- **Windows-specific workarounds** for LeRobot: `video_backend=pyav`, and the
  symlink-free training wrapper.
- **Unattended Isaac runs need Windows sleep turned off:** a sleep mid-batch once killed
  CUDA (recorded as `sim_error`, then re-run). <!-- src: t2-status (sprint 2 Task 6) -->
- The problem-cost figures are vendor estimates, not our measurements.
- 16 GB VRAM, so 1 environment and 128×128 cameras. <!-- src: spec §11; t2-status -->

## Project layout

```
src/demo_pipeline/  pure numpy + pydantic: schemas, measure, rules, repair, multiply,
                    success, teleop, store, episode_io, process, sim_protocol, scoring
src/app/            FastAPI backend; ai/diagnose.py (Nemotron + gate), jobs.py, sim_client.py,
                    routers/demos.py, routers/teleop.py, routers/results.py
src/nebius_llm/     Token Factory client: config, chat, vision, usage log
sim_worker/         Isaac Lab scene, robots, scripted expert, replay, tracking; scripts/ (smoke, batch, multiply)
sim_eval/           Isaac policy evaluation against the LeRobot policy server
lerobot_tools/      LeRobot v3.0 export, per-cell assembly, training wrapper, experiments, policy server
scripts/            make_experiment_set.py, run_pipeline_batch.py, diagnose_*.py, score_rules_on_degraded.py, ...
web/                React + Vite; src/pm/ (Record, Review, Dataset, Results), src/teleop/, src/hand/
docs/superpowers/   spec, plans, and dated status notes with every measurement
docs/submission/    Devpost description, tool feedback, video script
```

## History

This repo started as **SANT**, a room organizer built earlier in the hackathon: photograph a
shelf, a vision model proposes items, you confirm them, and Nemotron suggests how to
arrange them. On 2026-10-15 the project changed direction to *Perfect, then multiply*.
<!-- src: previous README.md (SANT); spec header (approved 2026-10-15) -->
It reuses SANT's Token Factory client (`src/nebius_llm`), its FastAPI backend shell, its
MediaPipe hand tracking in `web/src/hand/`, and its usage logging. The SANT routes and
dashboard are still in the tree, but they are not part of this submission's pipeline.

## License

MIT, see [LICENSE](LICENSE).
