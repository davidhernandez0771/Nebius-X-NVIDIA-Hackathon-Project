# Runbook: run *Perfect, then multiply* on Windows 11

This is the exact, step-by-step way to set up and run everything. Every command comes from the
repo's dated notes (`docs/superpowers/notes/`), the README, or the code's own `--help`, and each
one cites its source in an HTML comment. Steps nobody has run on this machine are marked
**UNVERIFIED**. Expected outputs are the ones the notes recorded, with their dates.

Written 2026-10-16 at commit `c32a3d2` + the T6 launch scripts. Verified machine: Windows 11 Home,
RTX 5080 16 GB.

**Contents**

1. [What runs where](#1-what-runs-where)
2. [Fresh Windows setup](#2-fresh-windows-setup)
3. [Start, stop and status](#3-start-stop-and-status)
4. [Record a demo with your hand](#4-record-a-demo-with-your-hand)
5. [Perfect a demo](#5-perfect-a-demo)
6. [Run the experiment](#6-run-the-experiment)
7. [Train and evaluate](#7-train-and-evaluate)
8. [Build the results and charts](#8-build-the-results-and-charts)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. What runs where

Three Python environments, because Isaac Lab, LeRobot and the backend pin different versions,
plus Node for the web pages. <!-- src: README "Setup"; spec §6 -->

| Piece | Environment | Port | Health check |
|---|---|---|---|
| Backend (FastAPI) + teleop relay | SANT venv, e.g. `C:\venvs\pm-main` | 8000 | `/api/health`, `/teleop/status` |
| Web pages (Vite) | Node, `web/` | 5173 | the page itself |
| Sim worker (Isaac Lab) | `C:\isaac\env_isaaclab` | 8770 | `/health` (`busy` while it runs a job) |
| Policy server (LeRobot ACT) | `C:\venvs\lerobot` | 8765 | `/health` |
| Teleop sink (Isaac Lab, for recording) | `C:\isaac\env_isaaclab` | (a client of the relay) | the Record page's "sim connected" |

<!-- src: ports from README "Run what exists today" (8000), src/app/main.py CORS (5173), sim_worker/server.py DEFAULT_PORT and sprint 3 plan (8770), lerobot_tools/policy_server.py (8765) -->

**Rules that hold everywhere:**

- **At most one Isaac process at a time.** The sim worker, the teleop sink and an Isaac eval are
  each one. <!-- src: sprint 3 plan, Global Constraints "Isaac processes" -->
- **Every venv lives outside OneDrive** (`C:\venvs\...`, `C:\isaac\...`), and every `uv` command
  runs with `UV_LINK_MODE=copy`. A venv inside OneDrive fails to install (os errors 5 and 396).
  <!-- src: README "Setup" -->
- **Turn Windows sleep off before long runs.** A sleep mid-batch once killed CUDA: 7 episodes came
  back `sim_error` (`Warp CUDA error 999`). <!-- src: t2-status sprint 2 Task 6 -->

---

## 2. Fresh Windows setup

### 2.1 NVIDIA driver — UNVERIFIED (not recorded)

No note records how the driver was installed or which version is required.

- **Seen on this machine** (2026-10-16): `nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader`
  printed `NVIDIA GeForce RTX 5080, 617.42, 16303 MiB`. <!-- src: run read-only by T6, 2026-10-16 -->
- The RTX 5080 needs the CUDA 12.8 build of torch (§2.4), so use a driver that supports CUDA 12.8.
  <!-- src: README "LeRobot" (CUDA 12.8 build needed for the RTX 5080) -->

**Check:** `nvidia-smi` prints the GPU and its memory.

### 2.2 Backend + pipeline: the SANT venv

Needs Python 3.11+, [uv](https://docs.astral.sh/uv/), git, and a Nebius Token Factory API key
from [tokenfactory.nebius.com](https://tokenfactory.nebius.com). <!-- src: README "1. Backend + pipeline" -->

```powershell
git clone https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project.git
cd Nebius-X-NVIDIA-Hackathon-Project

$env:UV_PROJECT_ENVIRONMENT = "C:\venvs\pm-main"   # any folder outside OneDrive
$env:UV_LINK_MODE = "copy"
uv sync --all-extras

cp .env.example .env    # then paste your key into NEBIUS_API_KEY; never commit .env
```

<!-- src: README "1. Backend + pipeline"; `C:\venvs\pm-main` is an example name in place of the README's `pm-<name>` -->

- **Set both `$env:` variables again in every new PowerShell**, before any `uv` command.
- In Git Bash, a bare `python` may be a broken uv trampoline; use `uv run python`.
  <!-- src: README; 2026-10-16-fix-windows-tests.md "Other notes" -->
- `uv sync` may warn that `VIRTUAL_ENV` points at another `.venv`. It is harmless: uv uses
  `UV_PROJECT_ENVIRONMENT`. <!-- src: t1-status "Environment" -->
- Without `.env` the backend still runs; Nemotron calls fail and fall back to the rules
  detector. <!-- src: t4-status sprint 2 Task 5 ("Fallback") -->

**Check:**

```powershell
uv run pytest -q
```

Expected: **0 failed**. Last run on this branch: `973 passed, 14 skipped` (2026-10-16, T6).
The skips need lerobot, PIL or torch (they run in the other venvs), are GPU runs gated by
`T3_GPU_TESTS=1`, or are T6's opt-in launch test. <!-- src: t6-status Task 2; README "Run what exists today" -->

### 2.3 Isaac Sim 6.2 + Isaac Lab 3.0 (the sim worker)

What works on this machine: the **Isaac Sim 6.2.0.0 pip package** on **Python 3.12**, with
**Isaac Lab from the `release/3.0.0` branch**. The venv is `C:\isaac\env_isaaclab` (Python
3.12.14) and the Isaac Lab checkout is `C:\isaac\IsaacLab`. <!-- src: README "2. Isaac Sim 6.2 + Isaac Lab 3.0" -->

> **UNVERIFIED: the install commands for Isaac Sim and Isaac Lab are not recorded** in this repo's
> notes. Follow NVIDIA's official Isaac Lab pip installation guide for those versions, with the
> venv outside OneDrive. <!-- src: README; fix-windows-tests note "Decisions" -->

Then install this repo's pure-Python contract into Isaac's venv:

```powershell
C:\isaac\env_isaaclab\Scripts\python.exe -m pip install -e <path-to-this-repo> --no-deps
C:\isaac\env_isaaclab\Scripts\python.exe -m pip install pytest
```

<!-- src: README; sprint 1 plan Track T2 -->

- **The editable install points at the checkout you give it.** If you later work in another
  checkout, Isaac's `demo_pipeline` is still the old one. Seen: 20 `test_dp_*` tests failed in
  Isaac's python for that reason, and all passed with `PYTHONPATH=<checkout>\src`.
  `start.ps1` sets `PYTHONPATH=<repo>\src` for the sim worker for this reason.
  <!-- src: 2026-10-16-web-pages.md sprint 3c Task 3 (on branch pm/fix-windows-tests) -->

**Check 1, the Isaac-side tests** (they need no repo fixtures, hence `--noconftest`):

```powershell
C:\isaac\env_isaaclab\Scripts\python.exe -m pytest -q --noconftest -p no:cacheprovider tests/test_dp_success.py tests/test_sim_scripted.py tests/test_dp_schemas.py
```

Expected: `39 passed` (sprint 1; these files have grown since, so expect more). <!-- src: README; t2-status sprint 1 -->

**Check 2, a smoke replay** (scripted expert on a fixed scene → replay → verify; run it only when
no other Isaac process runs):

```powershell
C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\smoke_replay.py --no-cameras --out data\smoke
```

Expected, after about 16 s (the first launch also downloads assets, 37 s here):

```
RESULT_JSON {"success": true, "reasons": [], "duration": 7.5, "path_length": 0.975, ...}
```

<!-- src: t2-status sprint 1 "Smoke results" and the timing table -->

- Drop `--no-cameras` to record front and wrist 128×128 PNGs as well (about 47 s).
- **Isaac Lab 3.0 opens no window unless you pass `--viz kit`.** UNVERIFIED on `smoke_replay.py`:
  it was only run headless. <!-- src: README; sprint 1 plan T2 Gotchas -->

### 2.4 LeRobot (export + training + policy server)

```powershell
$env:UV_LINK_MODE="copy"
uv venv --python 3.12 C:\venvs\lerobot
uv pip install --python C:\venvs\lerobot\Scripts\python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python C:\venvs\lerobot\Scripts\python.exe "lerobot[dataset,training]==0.6.1" pytest
uv pip install --python C:\venvs\lerobot\Scripts\python.exe pydantic
uv pip install --python C:\venvs\lerobot\Scripts\python.exe -e <path-to-this-repo> --no-deps
```

<!-- src: 2026-10-15-t3-lerobot-windows.md "Install (what was run)" -->

- `pydantic` is needed by `demo_pipeline` but is not a LeRobot dependency, so it is installed
  explicitly. <!-- src: t3-lerobot-windows "Problems found" 2 -->
- The same editable-install caveat as §2.3 applies (`start.ps1 -Policy` sets `PYTHONPATH` too).

**Check:**

```powershell
C:\venvs\lerobot\Scripts\python.exe -c "import torch, lerobot; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
C:\venvs\lerobot\Scripts\python.exe -m pytest -q lerobot_tools\tests
```

Expected: `2.11.0+cu128 True NVIDIA GeForce RTX 5080`, then `51 passed, 3 skipped` (sprint 2; the
3 skips are GPU tests gated by `T3_GPU_TESTS=1`). <!-- src: t3-lerobot-windows "Verification"; t3-status sprint 2 final summary -->

Optional training smoke (300 ACT steps on synthetic data, ~90 s):

```powershell
C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.train_smoke
```

Expected: 300/300 steps at about 20.7 steps/s (batch 8), a checkpoint that reloads. It runs the
stock `lerobot-train`, which **exits 1 after saving** on Windows (the symlink problem, §9.5); the
checkpoint is fine. <!-- src: t3-lerobot-windows "ACT training smoke" -->

### 2.5 Node and the web pages

Node.js with npm. **UNVERIFIED: no note records the Node version or how it was installed.**

```powershell
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
```

Expected: `163 passed` (11 files) and a build that exits 0. <!-- src: 2026-10-16-web-pages.md sprint 3b "Verification" -->
Not re-run for this runbook (that would install `node_modules`).

- `npm --prefix web ci` warns that esbuild's install script isn't covered by `allowScripts`. The
  build works without it. <!-- src: web-pages note "For the human / other tracks" -->

### 2.6 MediaPipe hand-tracking files — UNVERIFIED gap

The Record page loads `/mediapipe/wasm` and `/models/hand_landmarker.task` from `web/public/`.
<!-- src: web/src/hand/tracking/mediapipeTracker.ts (WASM_BASE_PATH, MODEL_ASSET_PATH) -->
Both are git-ignored ("large binaries fetched from Google's CDN by setup, not committed").
<!-- src: .gitignore -->

- **No note or script in this repo records where to get them or how,** and no checkout on this
  machine has them (checked 2026-10-16). Until they are in place, the Record page's camera can't
  track a hand. A live hand on the Record page has never been checked. <!-- src: web-pages note "Not checked live" -->

### 2.7 One shared `DATA_DIR` (recommended)

Demos, episodes, sets, datasets, the training registry and the results all live under
`DATA_DIR`, which is git-ignored. <!-- src: README "Backend"; t3-status sprint 2 Task 4 -->

- **If `DATA_DIR` is not set, each venv picks its own default:** `data\` next to the checkout its
  `demo_pipeline` was imported from. The Isaac and LeRobot venvs have editable installs from other
  checkouts, so without care the worker, the trainer and the backend write to three different
  `data\` folders. <!-- src: src/demo_pipeline/paths.py (REPO_ROOT from the module's own path); t1-status sprint 3b "For others" 3 -->
- So set it once per PowerShell, before anything else, for example:

  ```powershell
  $env:DATA_DIR = "C:\dev\pm-data"   # any folder outside OneDrive; example name
  ```

  `start.ps1` passes it on to everything it starts. The backend and the sim worker must also run
  on the same machine, because the backend reads the worker's episode folders by path.
  <!-- src: t4-status sprint 3 Task 5 ("Worker and backend must share a disk") -->

---

## 3. Start, stop and status

Three scripts in `scripts\launch\`. Run them through `powershell -ExecutionPolicy Bypass -File`,
because Windows doesn't run unsigned `.ps1` files by default (here the machine and user policies
are `Undefined`). Bypass applies to that one process only. <!-- src: t6-status Task 1 -->

### 3.1 Status (read-only)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\launch\status.ps1
```

One line per service (OK, BUSY or DOWN), GPU memory, and the Isaac python processes. Exit code 0
when every required service is up (default: backend, web, sim; change it with
`-Require backend,sim,policy`). `-Json` prints the same as JSON. It never starts or stops anything.

Real output (2026-10-16, T2's worker running a job, nothing else up):

```
DOWN  backend        http://127.0.0.1:8000/api/health       unreachable (ConnectionRefusedError)
DOWN  web            http://127.0.0.1:5173/                 unreachable (ConnectionRefusedError)
BUSY  sim worker     http://127.0.0.1:8770/health           running a job (robot franka, cameras)
DOWN  policy server  http://127.0.0.1:8765/health           unreachable (ConnectionRefusedError)
DOWN  teleop relay   http://127.0.0.1:8000/teleop/status    unreachable (ConnectionRefusedError)
GPU   5687 / 16303 MiB used (10616 MiB free)
ISAAC pid 57016: -m sim_worker.server --port 8770 --robot franka --cameras
required but not up: backend, web
```

<!-- src: t6-status Task 1 live check (the detail text shortened as noted there) -->

- `ISAAC` lists every python started from `C:\isaac\env_isaaclab`, including HTTP clients such as
  `sim_worker/scripts/client_multiply.py`.
- The same checks without PowerShell: `uv run python scripts/launch/health.py status`.

### 3.2 Start

```powershell
$env:UV_PROJECT_ENVIRONMENT = "C:\venvs\pm-main"; $env:UV_LINK_MODE = "copy"
powershell -ExecutionPolicy Bypass -File scripts\launch\start.ps1 -Backend -Web
powershell -ExecutionPolicy Bypass -File scripts\launch\start.ps1 -Sim
powershell -ExecutionPolicy Bypass -File scripts\launch\start.ps1 -Policy <checkpoint>
```

Each switch starts one hidden background process from the repo root and waits for its health check:

| Switch | Command it runs | Wait |
|---|---|---|
| `-Backend` | `uv run uvicorn app.main:app --app-dir src --port 8000` (needs `$env:UV_PROJECT_ENVIRONMENT` or `-SantVenv`) | 120 s |
| `-Web` | `npm --prefix web run dev` (needs `web\node_modules`) | 120 s |
| `-Sim` | `C:\isaac\env_isaaclab\Scripts\python.exe -m sim_worker.server --port 8770 --robot franka --cameras` | 900 s |
| `-Policy X` | `C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.policy_server --checkpoint X --port 8765` | 300 s |

<!-- src: backend README + fix-windows-tests note (verified with --port 8011); web README + web/package.json; sim t2-status sprint 3 Task 1 and final summary; policy t3-status sprint 2 Task 2 and sim_eval "How to use" -->

- **Logs:** `data\logs\<service>.log` (stdout) and `data\logs\<service>.err.log` (stderr). Each
  start overwrites them. uvicorn logs to stderr, so look in `.err.log` first.
- **PID file:** `data\logs\pids.json`, with each process's PID and start time.
- **It refuses, and starts nothing,** when:
  - `-Sim` and port 8770 is taken, or any Isaac python process is running;
  - a port is taken by something that doesn't answer that service's health check;
  - the checkpoint, the Isaac or LeRobot python, `web\node_modules`, the SANT venv or `uv` is missing.
- A service that already answers its health check is left alone and counts as up.
- **Exit code** 0 when every requested service is up, 1 otherwise, 2 for usage.
- **Don't pipe or capture its output** (for example `$x = powershell -File start.ps1`): the
  services inherit its output handles, so the reader waits until they stop. Run it in a console,
  or redirect to a file (`> start.txt`). <!-- src: t6-status Task 2 ("Found while testing") -->

Real output, a backend on a scratch port (2026-10-16, T6 test):

```
[backend] starting: C:\Users\...\uv.exe run uvicorn app.main:app --app-dir src --port 59671
[backend] pid 12896; logs ...\logs\backend.log, ...\logs\backend.err.log
[backend] waiting up to 120 s for its health check
[backend] up after 3 s: OK    backend        http://127.0.0.1:59671/api/health      status ok
all requested services are up. Status: scripts\launch\status.ps1; stop: scripts\launch\stop.ps1
```

Real refusal, with T2's worker already on 8770:

```
[sim] REFUSED: port 8770 is already taken, so a second sim worker will not be started.
  what answers there: OK    sim worker     http://127.0.0.1:8770/health           idle (robot franka, cameras)
  it was not started by start.ps1, so it is left alone
```

**UNVERIFIED:** `-Sim`, `-Policy` and `-Web` have not been started by `start.ps1` yet (Isaac and
the GPU belonged to other terminals, and this checkout has no `web\node_modules`). Their commands
are the verified ones above; only the wrapper around them is untested live.

The sim worker prints `{"event": "ready", ...}` to its log once it serves `/health`, and then
`/health` answers `{"ok":true,"robots":["franka"],"cameras":true,"busy":false}`. It holds about
4.5 GB of GPU memory. <!-- src: sim_worker/server.py; t2-status sprint 3 Task 1 and final summary -->

### 3.3 Stop

```powershell
powershell -ExecutionPolicy Bypass -File scripts\launch\stop.ps1
powershell -ExecutionPolicy Bypass -File scripts\launch\stop.ps1 -Service web,backend
```

- It stops **only** what `start.ps1` recorded in `pids.json`, and only if the PID still has the
  recorded start time (Windows reuses PIDs). It stops the child processes too (`taskkill /T`).
- Anything else, like a sim worker another terminal started, is never touched.

Expected: `[backend] stopped pid 12896 and its child processes`, or `nothing to stop` when the
file is empty.

### 3.4 Without the scripts

The same commands by hand, each in its own PowerShell (set the `$env:` variables first):

```powershell
uv run uvicorn app.main:app --reload --app-dir src                                  # backend, :8000
npm --prefix web run dev                                                            # web, :5173
C:\isaac\env_isaaclab\Scripts\python.exe -m sim_worker.server --port 8770 --robot franka --cameras
C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.policy_server --checkpoint <dir> --port 8765
```

<!-- src: README "Backend" and "Web pages"; t2-status sprint 3 final summary; t3-status sim_eval "How to use" -->

Then open `http://localhost:5173/pm/review` (pages: `/pm/record`, `/pm/review`, `/pm/dataset`,
`/pm/results`). <!-- src: README "Web pages"; web-pages note "Pages" -->

---

## 4. Record a demo with your hand

> **UNVERIFIED end to end, and not merged at this commit.** The sim-side teleop session
> (`sim_worker/teleop_session.py`, `teleop_isaac.py`, `sim_worker/scripts/teleop_sink.py`) and the
> Record page's Start/Stop/Reset controls are on branch `pm/fix-windows-tests` (commits
> `866c19f`..`6b7ea69`), not in `c32a3d2`. Even there, the automated Isaac smoke and a run with a
> person have not happened. <!-- src: web-pages note sprint 3c Tasks 3-4 (on pm/fix-windows-tests); git log -->

Once it is merged, the steps are (from that branch's note and the script's docstring):

1. **Stop the sim worker** if it runs: the sink is an Isaac process too.
2. Start the backend and the web pages (§3.2).
3. Start the sink, with a window so you can see the arm:

   ```powershell
   C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\teleop_sink.py --viz kit
   ```

   It connects to `ws://127.0.0.1:8000/ws/teleop?role=sim` and saves into the demo store under
   `DATA_DIR` (or `--data-dir`). Franka only.
4. Open `http://localhost:5173/pm/record`. **Start camera**, check that the page says the sim is
   connected, then **Start recording**, move your hand, and **Stop and save**.
5. Expected: the page shows the sim's last result, `saved <id>: verified success` or
   `saved <id>: not verified (<reasons>)`, and a "Review <id>" link to `/pm/review?id=<id>`.

<!-- src: web-pages note sprint 3c Tasks 2-4; teleop_sink.py docstring on pm/fix-windows-tests -->

What to expect while recording:

- The arm follows your hand while idle too, so you can line up before you start.
- If tracking is lost for more than 0.3 s, recording pauses ("Paused: hand tracking lost"), and
  the pause is cut out of the demo.
- **Isaac steps slower than real time, so the arm lags your hand.** The demo is recorded in sim
  time. <!-- src: web-pages note sprint 3c Task 2 and Task 3 "Known limit" -->
- First session tuning: `invert_y`, `invert_z` and the yaw sign may need flipping, and
  `palm_far` / `palm_near` set the depth range per person and camera.
  <!-- src: t4-status sprint 1b "Live tuning" -->

**Automated smoke, no person and no backend** (UNVERIFIED: never run):

```powershell
C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\teleop_sink.py --fake-hand --no-cameras
```

It should print `RESULT_JSON {"ok": true, ...}` and exit 0. <!-- src: teleop_sink.py docstring on pm/fix-windows-tests -->

**Until then, demos come from a synthetic set** (§5.3), which is how every measured run so far
got its demos.

---

## 5. Perfect a demo

Perfecting = replay the demo as recorded → diagnose (rules, or Nemotron + the metric gate) →
repair → verify in Isaac, re-diagnosing up to twice on failure. It needs the backend and the sim
worker. Nemotron needs a worker with `--cameras` and costs money. <!-- src: t4-status sprint 3 Task 3; t1-status sprint 2 Task 3 -->

### 5.1 From the web page

1. Open `/pm/review?id=<demo id>` (or pick a demo on `/pm/review`).
2. Press **Perfect**. The diagnoser defaults to rules; Nemotron is labelled "billed Token Factory call".
3. Expected: the panel polls the job and ends with "Outcome: perfected / kept / discarded", with
   a link to the new demo `<id>_<diagnoser>`. A 503 means the sim worker is down.

<!-- src: web-pages note sprint 3 "Pages", decision 5, and sprint 3b "A fix outside this sprint's task list" -->

### 5.2 From the API

The routes (no `/api` prefix):

- `GET /demos` lists the demos;
- `POST /demos/{id}/perfect?diagnoser=rules|nemotron` → **202** `{job_id, status, poll}`;
- `GET /jobs/{id}` → the job: `queued`, `running`, `succeeded` or `failed`, with its result.

<!-- src: README "Backend"; t4-status sprint 3 Task 3 -->

In PowerShell (composed here from those routes; not run as written):

```powershell
Invoke-RestMethod http://127.0.0.1:8000/demos
Invoke-RestMethod -Method Post "http://127.0.0.1:8000/demos/<id>/perfect?diagnoser=rules"
Invoke-RestMethod http://127.0.0.1:8000/jobs/<job_id>
```

- **503** = the worker is unreachable; **409** = a derived demo, a worker for another robot, or
  Nemotron on a worker without cameras; **404** = no such demo. <!-- src: t4-status sprint 3 Task 3 "Routes" -->
- Jobs live in memory: a backend restart forgets them.

### 5.3 A batch over a synthetic set

1. **Build a set** (pure code, no sim, about 1 s for 60 demos):

   ```powershell
   uv run python scripts/make_experiment_set.py --name s1 --n 12
   ```

   Expected: `DATA_DIR\sets\s1\` with `s1_<seed>\demo.json` + `truth.json` per demo, and
   `manifest.json` written last. The live run made 12 demos, 0 skipped. <!-- src: t1-status sprint 3 Task 3; t4-status sprint 3b Task 3 -->

2. **Perfect them with the rules** (free), a few first:

   ```powershell
   uv run python scripts/run_pipeline_batch.py --set data/sets/s1 --diagnoser rules --limit 3
   ```

3. **Then with Nemotron** (billed; it stops itself before the budget could be passed):

   ```powershell
   uv run python scripts/run_pipeline_batch.py --set data/sets/s1 --diagnoser nemotron --limit 3 --max-model-calls 10 --max-cost-usd 0.05
   ```

   <!-- src: t4-status sprint 3 Task 5 ("To run Task 5 later"); `data/sets/s1` assumes DATA_DIR = data -->

   Expected: `<set>\pipeline\<diagnoser>\<id>.json` per demo and a `summary.json`. Live
   (2026-10-16): rules 3/3 perfected, Nemotron 3/3 kept, every replay verified on the first
   attempt, 34–82 s per demo with cameras. Nemotron: 3 calls, $0.0043. <!-- src: t4-status sprint 3b Task 3 -->

   - A worker that goes down mid-batch stops it with exit 2: re-run with `--resume`.
   - Nemotron with `--no-cameras` is refused up front.

4. **Score the diagnoses** against `truth.json`:

   ```powershell
   uv run python scripts/score_pipeline_run.py --set data/sets/s1 --diagnoser rules
   uv run python scripts/score_pipeline_run.py --set data/sets/s1 --compare
   ```

   Expected: `<set>\pipeline\<diagnoser>\scores.json` (per-type precision, recall, F1, IoU), and a
   side-by-side table. Demos re-diagnosed after a failed verification are listed as not scored.
   <!-- src: t1-status sprint 3b Task 1 -->

**What the data says so far:** as calibrated, Nemotron kept every degraded demo (recall ~0 on
n = 3), while the rules repaired them. <!-- src: t4-status sprint 3b Task 3 "Finding" -->

---

## 6. Run the experiment

Raw → perfected (rules and Nemotron) → multiplied → a training grid. Needs the backend's venv and a
sim worker with cameras (Franka). <!-- src: t4-status sprint 3b Task 2 -->

```powershell
uv run python scripts/run_experiment.py --set data/sets/s1 --n-human 5 --variants-per-demo 5 --robot franka
```

<!-- src: t4-status sprint 3b Task 3 (step 3, the live run) -->

Expected (the live run, 2026-10-16, 16:22 → 16:50, about 28 min):

- raw: 3 replays reused from §5.3, 2 recorded; rules 5/5 perfected; Nemotron 5/5 kept (2 more
  calls, $0.0029);
- multiply yield: raw 12/25, rules 10/25, Nemotron 12/25;
- `data\sets\s1\experiment\grid.json` with 4 complete cells (raw_5, raw_multiply_5,
  rules_multiply_5, perfected_multiply_5), and `experiment.json` with the stages, yields and errors.

<!-- src: t4-status sprint 3b Task 3 -->

- The full plan uses `--n-human 5,10,20 --variants-per-demo 10`. Defaults: both diagnosers,
  `--max-model-calls 10 --max-cost-usd 0.05`. <!-- src: t4-status sprint 3b Task 2 -->
- A worker that is down, crashes or refuses stops the run (exit 2, "re-run with --resume"); the grid
  still holds the complete cells. If the Nemotron budget runs out, the other conditions finish.
- Known: 5 `sim_error`s on `s1_0004_rules` variants, and 40–48% multiply yield on degraded demos
  (vs 27/30 on the clean expert). Both are open with T2. <!-- src: t4-status sprint 3b final summary -->

---

## 7. Train and evaluate

### 7.1 Train (LeRobot venv)

Check the grid first, then train. One ACT run per cell, in a subprocess:

```powershell
C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.experiments --grid data\sets\s1\experiment\grid.json --steps 2000 --dry-run
C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.experiments --grid data\sets\s1\experiment\grid.json --steps 2000
```

<!-- src: t3-status sprint 2 Task 4; grid path from t4-status sprint 3b Task 3 -->

- `--dry-run` validates every cell and prints the plan as JSON; it writes nothing. T3's dry run on
  the live grid above: all 4 cells valid. <!-- src: t4-status sprint 3b Task 3 -->
- **Budget enforced by the code:** `--steps` ≤ 2000 and `--batch-size` ≤ 8 (`MAX_STEPS`,
  `MAX_BATCH` in `lerobot_tools/train.py`). <!-- src: lerobot_tools/train.py; t3-status sprint 2 Task 4 -->
- Output: `DATA_DIR\experiments\<grid>_<timestamp>\{datasets,train,logs}\<cell>`, and one row per
  cell in `DATA_DIR\results\registry.jsonl` (`status` ok/failed, `checkpoint`, `final_loss`, ...).
  A failed cell is a row, not a crash; exit code 1 if any cell failed.
- Each checkpoint is about 591 MB. Speed: 11.8–20.7 steps/s at batch 8, depending on whether
  Isaac shares the GPU. <!-- src: t3-status sprint 2 Task 1; t3-lerobot-windows -->
- Train only through this runner or `python -m lerobot_tools.train <lerobot-train args>`, never a
  bare `lerobot-train` (§9.5). Resume with `--resume-last <output_dir>`.

### 7.2 Evaluate (policy server + Isaac)

1. **Free the GPU for Isaac.** The eval is an Isaac process: stop the sim worker if you started it
   (`stop.ps1 -Service sim`), or at least check that `nvidia-smi` shows ≥ 8 GB free.
   <!-- src: sprint 3 plan Global Constraints (T3's ≥ 8 GB rule) -->
2. **Start the policy server** on the cell's checkpoint (the registry row's `checkpoint`):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\launch\start.ps1 -Policy <checkpoint>
   ```

   Its `/health` reports `state_dim`, cameras, the checkpoint and the device.
3. **Run the eval** with Isaac's python:

   ```powershell
   C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\run_eval.py --checkpoint-url http://127.0.0.1:8765 --n 50 --seed0 5000 --cell <cell name> --cameras
   ```

   <!-- src: t3-status sim_eval "How to use"; run_eval.py docstring -->

Expected:

- One line per episode, then `RESULT_JSON {summary}` as the last line.
- The results land in `DATA_DIR\evals\<cell>_<timestamp>.json`. With `--cell`, `eval_success`
  (successes / n) goes into that cell's registry row, matched by the checkpoint the server
  reports.
- **Time:** a failing episode runs its full 30 s of sim time, about 110–170 s of wall time, so 50
  scenes of a weak policy take about 1.5–2.5 h. Successful episodes stop early. Whole-GPU VRAM
  peaked at about 9 GB. <!-- src: t3-status sim_eval Step 4 -->
- Preflight: if the server is down or its policy doesn't match (state 9, front/wrist 128×128,
  `--cameras` when it needs images), it exits 2 before Isaac launches.
- Test scenes use seeds ≥ 5000, so they never overlap the training scenes.
- The smoke checkpoint gave 0/3, as expected: it was never trained on real episodes.

Stop the policy server afterwards: `stop.ps1 -Service policy`.

---

## 8. Build the results and charts

1. **The results file** (pure code; reads the registry, the evals, the multiply `yield.json`
   files and the `scores.json` files):

   ```powershell
   uv run python scripts/build_results_json.py --data-dir <DATA_DIR> --t2-data <another data root>
   ```

   `--t2-data` is optional and repeatable, for yields written under another root. Default output:
   `<data-dir>\results\results.json`, with `"sample": false`. Every value has a source in
   `sources`; anything not measured is `null` and listed in `pending`. <!-- src: t1-status sprint 3b Task 2 -->

   The dry run on real data (2026-10-16): 11 values pending, and the multiply yield 0.9 from T2's
   27/30 run (before the handover fix).

2. **The charts** (pure Python writing SVG):

   ```powershell
   uv run python scripts/render_charts.py --results <results.json> --out <dir>
   ```

   Defaults: `DATA_DIR\results\results.json` → `DATA_DIR\results\charts\`. Expected:
   `success.svg`, `ablation.svg` and `yield.svg`. A `null` is drawn as "pending", never 0. A file
   without `"sample": false` gets a red SAMPLE watermark. <!-- src: t1-status sprint 3c Task 2 -->

3. **The web Results page** reads `GET /results` (the same `DATA_DIR\results\results.json`) as soon
   as it exists. Without it, the page shows the sample under a "SAMPLE DATA" banner.
   <!-- src: web-pages note sprint 3b -->

4. **Media for the README and the video** (needs Pillow, which is not in the default extras):

   ```powershell
   uv pip install --python <SANT venv>\Scripts\python.exe pillow
   uv run python scripts/make_media.py --episode <episode dir> --rules --out <dir>
   uv run python scripts/make_media.py --episode <raw ep> --diagnosis <stored diagnosis.json> --compare <perfected ep> --labels raw,perfected --out <dir>
   ```

   Expected: `<id>.gif` (with a timeline strip), `<id>_sheet.png` (6 frames), and with `--compare`
   `<a>_vs_<b>.gif`. <!-- src: t1-status sprint 3c Task 3 and final summary -->

---

## 9. Troubleshooting

Every problem here was hit and recorded in a note.

### 9.1 Environments and shells

| Symptom | Cause and fix |
|---|---|
| `uv sync` fails with os error 5 or 396 | The venv is inside OneDrive. Put it in `C:\venvs\...` and set `UV_LINK_MODE=copy`. <!-- src: README --> |
| "uv trampoline failed to spawn", or the wrong `python` runs | A bare `python` on PATH is a broken uv trampoline into a OneDrive `.venv`. Use `uv run python`, or a venv's full `...\Scripts\python.exe`. <!-- src: t1-status; fix-windows-tests note --> |
| uv warns about `VIRTUAL_ENV` | Harmless; it uses `UV_PROJECT_ENVIRONMENT`. Unset `VIRTUAL_ENV` to silence it. <!-- src: fix-windows-tests note --> |
| A `.ps1` "cannot be loaded because running scripts is disabled" | Run it as `powershell -ExecutionPolicy Bypass -File <script>`. <!-- src: t6-status Task 1 --> |
| `start.ps1` "hangs" when its output is captured | The services it started hold the pipe. Run it in a console or redirect to a file. <!-- src: t6-status Task 2 --> |
| Isaac-side `test_dp_*` fail, or the worker behaves like old code | Isaac's (or LeRobot's) editable `demo_pipeline` points at another checkout. Set `PYTHONPATH=<repo>\src` (`start.ps1` does) or reinstall it from this checkout. <!-- src: web-pages note sprint 3c Task 3 --> |
| Results, registry or episodes "missing" | Each venv defaults `DATA_DIR` to its own checkout's `data\`. Set `$env:DATA_DIR` in every terminal (§2.7). <!-- src: paths.py; t1-status sprint 3b --> |
| A test writes into your home folder | Fixed: `test_usage.py` used to write `C:\Users\<you>\shared.jsonl` on Windows, because `~` follows `USERPROFILE`. That file can be deleted by hand. <!-- src: fix-windows-tests note, root cause 2 --> |

### 9.2 Isaac Lab and the sim worker

| Symptom | Cause and fix |
|---|---|
| No window opens | Isaac Lab 3.0 is headless unless you pass `--viz kit`. <!-- src: README --> |
| The first launch is slow | It downloads assets (37 s here). <!-- src: t2-status --> |
| `sim_error` with `CUDA error: unknown error` or `Warp CUDA error 999` | The PC went to sleep (Event Viewer, System log: Kernel-Power 42). Turn sleep off; re-run the lost seeds (`--resume` on `run_batch.py` / `multiply_run.py`, or the batch's own `--resume`). <!-- src: t2-status sprint 2 Task 6; sprint 3 Task 3 --> |
| A script exits 0 and prints nothing | Leaving `launch_simulation` ends the process; results must be printed inside the `with` block. <!-- src: t2-status decision 12 --> |
| `Filter pattern ... did not match the correct number of entries` | PhysX filter paths are globs, not regexes; the 3.0 Franka bodies are nested under `Robot/Geometry/...`. <!-- src: t2-status "Errors hit" --> |
| Quaternions look wrong at the sim boundary | Isaac Lab 3.0 uses xyzw; this repo uses wxyz and converts only at the boundary. <!-- src: t2-status decision 1 --> |
| `/perfect` or a batch says 422 "started without --cameras" | One sim session per process: cameras are fixed at start. Restart the worker with `--cameras`. <!-- src: t2-status decision 11; t4-status sprint 3 Task 3 --> |
| `409 busy` from the worker | It runs one job at a time. The backend's jobs retry up to 60 × 10 s; check `status.ps1` (BUSY). <!-- src: t2-status sprint 3 Task 1; t4-status sprint 3 Task 3 --> |
| `/perfect` answers 503 | The worker is not running or reports `ok=false`. Start it (§3.2) or set `SIM_WORKER_URL`. <!-- src: t4-status sprint 3 Task 3 --> |
| Isaac warns "DLSS ... render resolution (85, 85) is below minimal input resolution of 300" | Harmless: it comes from the 128×128 cameras, and training episodes are rendered the same way. <!-- src: t3-status sim_eval Step 4 --> |
| OpenArm or Flexiv yields are low | Known: OpenArm's ±45° wrist and Flexiv's Grav gripper physics. Use the Franka for results. <!-- src: t2-status sprint 2 Task 5, sprint 3 Task 3 --> |

### 9.3 Nemotron (Token Factory)

| Symptom | Cause and fix |
|---|---|
| HTTP 400 "At most 8 image(s) may be provided in one prompt" | The limit is 8 images per prompt; `diagnose()` already subsamples to 7 front + 1 wrist. <!-- src: t4-nemotron-vl note --> |
| Diagnosis source is `rules` although you asked for Nemotron | An invalid reply (after one retry), an auth error, a 429 or a 400 falls back to the rules, and the reason is logged. A missing `NEBIUS_API_KEY` is an auth error too. <!-- src: t4-status sprint 2 Task 5; src/nebius_llm/client.py (missing key → AuthError) --> |
| A batch stops with a budget message | `--max-model-calls` / `--max-cost-usd` would be passed. It is resumable; it stops rather than silently falling back. <!-- src: t4-status sprint 3 Task 4 --> |

Cost: about $0.0013–0.0016 per diagnose call, 2.3–3.9 s. Every call is logged in
`usage_log.jsonl` (git-ignored). <!-- src: README "Measured cost and latency" -->

### 9.4 Web pages

| Symptom | Cause and fix |
|---|---|
| A page says the backend or sim worker is down | Start them (§3.2); every page shows this instead of a blank screen. <!-- src: web-pages note --> |
| Results shows "SAMPLE DATA" | `GET /results` has no file, or the file lacks `"sample": false`. Build it (§8). <!-- src: web-pages note sprint 3b --> |
| The Record page can't track a hand | The MediaPipe files are missing (§2.6). |
| `status.ps1` calls the web DOWN although Vite runs | UNVERIFIED guess: Vite 5 binds `localhost`, which may be IPv6-only. `status.ps1` also tries `localhost:5173`; open the page in a browser to be sure. <!-- src: t6-status Task 3 --> |

### 9.5 LeRobot and training

| Symptom | Cause and fix |
|---|---|
| `lerobot-train` exits 1 at a checkpoint save: `OSError: [WinError 1314] A required privilege is not held by the client` | It makes a `last` symlink, which needs admin rights or Developer Mode. Train with `python -m lerobot_tools.train ...` (or `lerobot_tools.experiments`): it writes `checkpoints\last.txt` instead. <!-- src: t3-lerobot-windows; t3-status sprint 2 Task 1 --> |
| `Could not load libtorchcodec ... We support versions 4, 5, 6, 7, and 8` | torchcodec needs a shared FFmpeg 4–8; the system FFmpeg is a static 9.0 build. Load and train with `video_backend=pyav` (the wrapper adds `--dataset.video_backend=pyav`). `lerobot-info` still crashes on it. <!-- src: t3-lerobot-windows "Problems found" 1 --> |
| The torchcodec traceback, then "Falling back to 'pyav'" | Harmless. <!-- src: t3-status sprint 2 Task 1 --> |
| `ModuleNotFoundError: No module named 'pydantic'` in the LeRobot venv | Install it explicitly (§2.4). <!-- src: t3-lerobot-windows --> |
| Exporting a cell raises `FileExistsError` | Each cell is exported once; the runner uses a fresh `<grid>_<timestamp>` folder per run. <!-- src: t3-status sprint 2 Tasks 3-4 --> |
| An eval episode ends with `policy_error`: `[WinError 10054] An existing connection was forcibly closed` | Loopback HTTP resets (about 1 per 2,000–3,000 new connections). `run_eval.py` retries a connection failure once (`RetryingPolicy`). The real fix (HTTP/1.1 keep-alive in the policy server and client) is not done. <!-- src: t3-status sim_eval Step 4 --> |
| Low eval success | Check the start pose too: the eval starts from the robot's default joint pose, which may differ from where the training demos start. <!-- src: t3-status sim_eval "Open items" 2 --> |

### 9.6 Tests

| Symptom | Cause and fix |
|---|---|
| `PermissionError [WinError 32]` on `test.db` in tearDown | Fixed in `tests/conftest.py` (`close_db()`); a held SQLite connection blocked the temp-dir cleanup. <!-- src: fix-windows-tests note, root cause 1 --> |
| A full `uv run pytest` once didn't finish, or one test failed once | Seen once each, never reproduced (T4, sprint 3b). Re-run; report it with the test name if it repeats. <!-- src: t4-status sprint 3b --> |
