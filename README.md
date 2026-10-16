# Perfect, then multiply

**Turn a noisy webcam robot demo into many physics-verified training demos: NVIDIA
Nemotron 3.5 Super VL diagnoses it, code repairs it, Isaac Lab checks it, and the
verified demo is multiplied and exported for LeRobot.**

Submission for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/),
Physical AI track. Simulation only, no physical robot (allowed by the official FAQ; see
[the screenshot](docs/superpowers/notes/2026-10-15-faq-physical-ai-simulation-allowed.jpg)).

**Rule: the AI decides, code acts, physics checks.**

> **Status (2026-10-16): work in progress.** The pipeline stages are built and unit-tested
> one by one, and the Isaac Lab replay go/no-go passed. They are **not yet chained end to
> end**, and the headline experiment has not run. See [Pipeline status](#pipeline-status)
> and [Results](#results). Nothing below claims a result that has not been measured.

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
6. **Multiply.** A verified demo is split into a cube-relative part (approach, grasp, lift)
   and a bin-relative part (carry, release, retreat). It is transformed to newly sampled
   cube and bin positions, the parts are joined with a 0.5 s minimum-jerk blend, and each
   variant is verified again. <!-- src: spec §8.6; docs/superpowers/notes/2026-10-15-t1-status.md -->
7. **Export.** Only verified episodes go out, as a LeRobot v3.0 dataset with front and
   wrist video. Each episode gets a *passport* recording its lineage, repairs, diagnosis
   source and model ID. <!-- src: docs/superpowers/notes/2026-10-15-t3-status.md -->
8. **Train.** LeRobot ACT, evaluated in Isaac on fixed test scenes.

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
- **Measured cost and latency:**

  | Call | Images | Prompt tokens | Completion tokens | Cost | Latency |
  |---|---|---|---|---|---|
  | Synthetic demo, 256×256 frames | 8 | 3,269 | 390 | $0.001332 | 2.52 s |
  | Real Isaac episode, 128×128 frames | 8 | 3,595 | 633 | $0.001648 | 3.9 s |

  <!-- src: row 1 docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md; row 2 docs/superpowers/notes/2026-10-15-t4-status.md (sprint 2, Task 6) -->
  - Price: $0.30 per 1M prompt tokens, $0.90 per 1M completion tokens. Images are billed
    as prompt tokens, about 263 tokens per 256×256 image.
    <!-- src: docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md -->
  - So one diagnosis costs about $0.0013–$0.0016 and takes about 2.5–3.9 s.
    <!-- src: same two notes -->
- **What it is good and bad at so far:** see [Results](#results). In short: valid JSON on
  the first try both times, good segmentation, but false-positive kinematic issues on a
  clean demo.

### NVIDIA Isaac Sim 6.2 / Isaac Lab 3.0

- The pick-place scene is defined in `sim_worker/scene_cfg.py`: table, Franka
  (`FRANKA_PANDA_HIGH_PD_CFG`), red cube, a blue bin built from 5 cuboids, contact sensors,
  and two 128×128 cameras (front and wrist). <!-- src: docs/superpowers/plans/2026-10-15-sprint1-parallel-tracks.md T2 Task 2; t2-status -->
- `sim_worker/replay.py` drives the arm with differential IK (absolute pose) and records
  the episode: joint states, actions, images, cube pose and contacts.
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
| Record | `demo_pipeline/teleop.py`, `src/app/routers/teleop.py`, `web/src/teleop/*` | Hand→target mapping, gripper latch, WebSocket relay and browser client are built and tested. **The sim-worker side that drives the arm from the webcam is not built yet.** |
| Measure | `demo_pipeline/measure.py` | Built, tested |
| Diagnose | `src/app/ai/diagnose.py`, `POST /demos/{id}/diagnose` | Built, tested with mocks, 2 live calls + 1 rejected call |
| Repair | `demo_pipeline/repair.py`, `rules.py` | Built, tested on synthetic trajectories |
| Verify | `sim_worker/replay.py`, `demo_pipeline/success.py` | Built. Go/no-go passed on a scripted expert demo |
| Multiply | `demo_pipeline/multiply.py` | Transform and scene sampling built and tested. **Not yet run through Isaac**, so there is no yield number yet. |
| Second arm (OpenArm) | — | **Not built** |
| Export | `lerobot_tools/export.py` | Built, tested |
| Train / eval | `lerobot_tools/train_smoke.py` | ACT training smoke on synthetic data only. **No evaluation harness yet.** |
| Web pages (Record, Review, Dataset, Results) | — | **Not built.** The `web/` app is still the SANT dashboard (see [History](#history)) |

<!-- src: t1-status, t2-status, t3-status, t4-status notes; git tree at 851e919 -->

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
- **`lerobot-train` exits 1 at every checkpoint save on Windows** (`WinError 1314`: it
  creates a symlink, which needs admin rights or Developer Mode). The checkpoint itself is
  written first. For short runs, set `--save_freq` equal to `--steps`. A symlink-free
  wrapper is planned, not built. <!-- src: t3-lerobot-windows -->

## Run what exists today

**Tests (backend + pipeline, all AI calls mocked, no network, no spend):**

```powershell
uv run pytest -q
```

Latest run on this branch: **407 passed, 1 skipped, 0 failed.**
<!-- src: test output 2026-10-16, recorded in docs/superpowers/notes/2026-10-16-fix-windows-tests.md -->

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

The new routes are `GET /teleop/status`, the WebSocket `/ws/teleop?role=browser|sim`,
`POST /demos`, `GET /demos`, `GET /demos/{id}`, `POST /demos/{id}/diagnose` and
`GET /demos/{id}/diagnosis`. Demos live under `DATA_DIR` (default `data/`, git-ignored).
Checked on 2026-10-16: `/api/health`, `/teleop/status` and `/demos` respond.
<!-- src: t4-status sprint 1b + sprint 2 Task 5 -->

**Web (teleop message builder + client tests):**

```powershell
npm --prefix web ci
npm --prefix web test
```

<!-- src: t4-status sprint 1b (vitest: 80 passed); sprint1b plan Task 3 -->

**LeRobot exporter tests and the ACT training smoke:**

```powershell
C:\venvs\lerobot\Scripts\python.exe -m pytest -q lerobot_tools\tests
C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.train_smoke
```

<!-- src: t3-status (5 passed); t3-lerobot-windows (train smoke) -->

## Results

### Measured so far

- **Isaac Lab go/no-go: passed.** The scripted expert demo (376 steps = 7.5 s) replays
  with `"success": true`, with and without cameras.
  <!-- src: docs/superpowers/notes/2026-10-15-t2-status.md -->

  | Mode | Process wall time | Peak GPU memory (whole GPU) |
  |---|---|---|
  | No cameras | 16 s | 4172 MiB |
  | Front + wrist cameras, 128×128 | 47 s | 7184 MiB |

  <!-- src: t2-status -->
- **The success check catches collisions.** Driving the fingertips into the table gave
  max 287 N and reason `collision`; into a bin wall, max 116 N and `collision`.
  <!-- src: t2-status, Extra verification -->
- **LeRobot ACT trains natively on Windows.** 300/300 steps on CUDA at 20.7 steps/s
  (batch 8), under 1 GB of torch memory (0.99 GB). Loss went from 14.974 to 2.994, and the
  checkpoint reloads and returns a finite action. Synthetic data only.
  <!-- src: docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md -->
- **Nemotron on a real Isaac episode (one call; a clean scripted demo):**
  <!-- src: docs/superpowers/notes/2026-10-15-t4-status.md, sprint 2 Task 6 -->
  - The rules detector said `keep`, with 0 issues. That is correct.
  - Nemotron said `repair`, with **5 issues, all false positives**: two jitter, two slow,
    one rim contact. The rim contact contradicts the contact data it was given.
  - Its repairs, applied as-is, would have made a perfect demo worse.
  - What it got right: **segmentation**. Its six segments (approach, grasp, lift, carry,
    release, retreat) match the gripper events and are finer than the rules' three.
  - Our honest takeaway: code measures kinematics better than the VLM does. The VLM's
    value has to come from what code cannot see (wrong object, drop, grasp quality from
    the wrist view, segment labels), and its kinematic claims must be gated by the
    metrics. That gating is the next step.
- **Nemotron on a synthetic demo (one call):** valid JSON. It found the pause but bounded
  it at 1.0–1.5 s instead of the true 1.0–1.9 s, because its metrics windows are 0.5 s
  wide. It also reported two false idle issues. <!-- src: t4-nemotron-vl -->

### The chart: PENDING

> **PENDING, not yet measured.** Policy success rate on 50 fixed test positions against
> the number of human demos (5, 10, 20), for three conditions: raw; raw + multiply (a
> MimicGen-style baseline); perfected + multiply (ours). Logged human minutes per
> condition.
> <!-- src: spec §3 -->
>
> `[chart goes here]`

### Ablation: PENDING

> **PENDING, not yet measured.** At 10 human demos: rules-only repair vs rules + Nemotron
> repair. <!-- src: spec §3 -->

### Multiplication yield: PENDING

> **PENDING, not yet measured.** Successful variants / attempted (cap 50 per perfected
> demo), reported next to MimicGen's published 38–74%. <!-- src: spec §3, §8.6 -->

Negative results will be reported as they come out.

## Limitations

- **Not end to end yet.** The stages are tested separately. The webcam→sim teleop loop,
  multiply-in-sim, the second arm, the evaluation harness and the web pages are not built
  (see [Pipeline status](#pipeline-status)).
- **Nemotron over-reports issues on clean demos** (5 false positives in our one real-frame
  test). Gating its issues against the metrics is not implemented yet. The rules fallback
  is the safety net.
- **Small evidence base for the model:** two valid live diagnoses so far, one synthetic
  and one real.
- **IK lag.** In replay, the arm lags the target by about 0.1 s: mean tracking error
  24.6 mm, max 51 mm. The scripted demo succeeds because of its 0.5 s holds; faster human
  demos may not. <!-- src: t2-status, Risks -->
- **One task, simulation only, no real hardware.** <!-- src: spec §4 -->
- **Windows-specific workarounds** for LeRobot: `video_backend=pyav`, and short runs
  because of the checkpoint symlink.
- The problem-cost figures are vendor estimates, not our measurements.
- 16 GB VRAM, so 1 environment and 128×128 cameras. <!-- src: spec §11; t2-status -->

## Project layout

```
src/demo_pipeline/  pure numpy + pydantic: schemas, measure, rules, repair, multiply,
                    success, teleop, store, episode_io
src/app/            FastAPI backend; ai/diagnose.py (Nemotron), routers/demos.py, routers/teleop.py
src/nebius_llm/     Token Factory client: config, chat, vision, usage log
sim_worker/         Isaac Lab scene, scripted expert, replay; scripts/smoke_replay.py
lerobot_tools/      LeRobot v3.0 export, ACT training smoke
scripts/            diagnose_smoke.py, diagnose_real_episode.py, smoke_test.py, ...
web/                React + Vite; src/teleop/ (hand pose message + client)
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
