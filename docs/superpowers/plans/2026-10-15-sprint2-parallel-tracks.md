# Sprint 2: Four Parallel Tracks (long, unattended) Implementation Plan

> **For agentic workers:** Execute ONLY your own track, in order, in your
> worktree.
> Required skills:
> - `test-driven-development` for every code task;
> - `systematic-debugging` for every failure;
> - `verification-before-completion` before claiming anything works.
>
> This sprint is long. Keep going task after task until your list is done,
> or every remaining task is blocked.

**Goal:** turn the sprint-1 foundations into a working pipeline:

- **T1:** synthetic "webcam-like" human demos with ground truth, the perfect
  orchestration, and diagnosis scoring.
- **T2:** reliable sim replay, batch runs, multiplication yield, and the
  second arm.
- **T3:** Windows-safe training, policy serving for evaluation, and the
  experiment runner.
- **T4:** the teleop link, the demo store, and the backend demo routes.

**Architecture:** unchanged, per the spec. Sprint 1 is merged into
`perfect-then-multiply` at `f3df189`. Every track starts from it; the lead
fast-forwarded the worktrees before this sprint.

**Spec:** `docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md`.
Read its **Changes** section. Read your own track's sprint-1 status note in
`docs/superpowers/notes/`.

## Global Constraints

**Ownership.** Work only in your worktree, on your branch. Modify only the
files your track owns (listed per track). Read anything.

**SANT-side environment.** Venvs live in `C:\venvs\pm-<track>` and run with
`UV_LINK_MODE=copy`. Run these in every new shell before `uv`:

```powershell
$env:UV_PROJECT_ENVIRONMENT = "C:\venvs\pm-<track>"
$env:UV_LINK_MODE = "copy"
uv sync --all-extras
```

**Isaac side.** Use `C:\isaac\env_isaaclab\Scripts\python.exe`. Its
`demo_pipeline` is an editable install from `C:\dev\pm-t2`.

**Baseline.**

- `uv run pytest -q` gives **54 failed, 238 passed, 1 skipped**.
- The 54 are the known Windows-only failures (being fixed elsewhere). Never
  touch them.
- Your bar: your new tests pass, and the failure count stays at 54.

**Conventions.**

- Meters, seconds, Z-up.
- Quaternions are wxyz in the contract. Isaac Lab uses xyzw; convert at the
  boundary only.
- 50 Hz.
- `TASK_TEXT = "pick up the red cube and place it in the blue bin"` (in
  `demo_pipeline.rules`).

**Purity.** `src/demo_pipeline/*` imports only the stdlib, numpy and pydantic.

**Installs.** Only into the venvs named in your track. No system settings
(that includes Developer Mode), no drivers, no shared FFmpeg, no Norton
changes.

**Git.** Commit after every green task on your branch. Never push, merge or
rebase.

**Money.** Only T4 may call Token Factory for real: at most 3 calls, at most
$0.02, in Task 6. Everything else mocks the network.

**GPU.** T2 runs Isaac, headless, 1 env. T3 trains with batch ≤ 8 and runs
of ≤ 2,000 steps. Both can share the 16 GB.

**If blocked:** record the exact error in your status note and move on. Do
not work around a constraint.

**Progress.** After EVERY task, append a dated entry to
`docs/superpowers/notes/2026-10-15-<track>-status.md` and commit it, so the
human sees progress even if the session stops.

## Review Focus

1. **A diagnosis that fails, a repair that raises, or a verification that
   fails** — each must end in a recorded outcome, never a crash (T1 Task 3).
2. **Webcam-like noise** that makes the rules flag a clean motion — measure
   false positives (T1 Task 1, 4).
3. **Sampled scenes at workspace corners** the arm can't reach — they count as
   failures with reason `unreachable`, never a hang (T2 Task 3).
4. **A training run longer than one checkpoint save** on Windows — it must
   finish with exit 0 (T3 Task 1).
5. **A backend diagnose on a demo with no episode frames or no signals** — it
   gets a clear 409 or 422, not a 500 (T4 Task 5).

---

## Track T1: synthetic demos, orchestration, scoring

- **Worktree:** `C:\dev\pm-t1`, branch `pm/t1-core`.
- **venv:** `C:\venvs\pm-t1`.
- **Owns:**
  - `src/demo_pipeline/{measure,rules,repair,multiply,degrade,refine,process,scoring}.py`
  - `tests/test_dp_{measure,rules,repair,multiply,degrade,refine,process,scoring}.py`
  - `scripts/score_rules_on_degraded.py`

### Task 1: `degrade.py`, webcam-like human demos with ground truth

**Produces:**

- `InjectedIssue(type: IssueType, t0: float, t1: float)` — pydantic.
- `degrade(traj: Trajectory, rng: np.random.Generator, *, n_pauses: int = 1, pause_s: tuple[float, float] = (0.5, 1.2), jitter_mm: float = 2.0, grasp_offset_mm: float = 8.0, slow_factor: float = 1.0, idle_start_s: float = 0.0, idle_end_s: float = 0.0) -> tuple[Trajectory, list[InjectedIssue]]`

**Behavior:**

- **Pauses:** insert holds at random times outside ±0.3 s of gripper events.
- **Jitter:** Gaussian position noise, low-pass filtered at about 6 Hz so it
  looks like hand tremor, not white noise.
- **Grasp offset:** shift the approach and grasp by an offset of that
  magnitude, in a random xy direction, so the close happens off-center.
- **Slow factor:** time-stretch the whole demo.
- **Idle:** add holds at the start and end.

Gripper events are preserved. Times in the returned issues refer to the
degraded timeline. The output validates as a `Trajectory`.

**Tests:**

- each injected issue type appears with correct times;
- `detect_rules` finds an injected 0.9 s pause within ±0.06 s;
- jitter raises `jerk_rms`;
- grasp offset moves the close point by the offset, ±1 mm;
- the same seed gives the same output.

### Task 2: `refine.py`, snap model times to the data

T4 measured that Nemotron's times are window-aligned (0.5 s windows).

**Produces:** `refine_diagnosis(diag: Diagnosis, traj: Trajectory) -> Diagnosis`.

- For `pause`, `idle_start_end`, `remove_pause` and `trim`: snap each range to
  the overlapping per-step still-run, using the same still detection as
  `rules`.
- If none overlaps, drop that issue and its repair.
- Other ops are unchanged.
- The output passes `check_times`.

**Tests:**

- a window-aligned pause (1.0–1.5) on a true 1.0–1.9 pause becomes 1.0–1.9,
  ±0.04;
- a spurious pause over real motion is dropped;
- other ops pass through unchanged.

### Task 3: `process.py`, orchestration with fallback (Review Focus 1)

**Produces:**

- `PerfectResult` (pydantic):
  - `status: Literal["perfected", "kept", "discarded"]`
  - `trajectory: Trajectory | None`
  - `diagnosis: Diagnosis | None`
  - `diagnosis_source: Literal["nemotron", "rules", "none"]`
  - `attempts: int`
  - `verification: VerificationResult | None`
  - `notes: list[str]`
- `perfect_demo(demo: Demo, signals: SimSignals, *, diagnose_fn: Callable[[Demo, list[MetricsWindow], list[str]], Diagnosis] | None, verify_fn: Callable[[Trajectory, Scene], tuple[VerificationResult, SimSignals]], bin_rim_z: float, max_rediagnose: int = 2) -> PerfectResult`

**Flow:**

1. `compute_windows`.
2. `diagnose_fn`. On ANY exception, or if it is None, use `detect_rules`
   (source `"rules"`).
3. `refine_diagnosis`.
4. `decision == "discard"` → discarded.
5. `"keep"` → verify the original → kept, or retry like a failed repair.
6. `apply_repairs`. `DiscardDemo` or `ValueError` → discarded, with the
   message in notes.
7. `verify_fn`. Success → perfected. Failure → call `diagnose_fn` again with
   the failure reasons as the 3rd argument, up to `max_rediagnose` times →
   then discarded.

All dependencies are injected; no I/O.

**Tests:** fakes for every branch above, including "nemotron raises → rules
used" and "verify fails twice → discarded with reasons".

### Task 4: `scoring.py`, diagnosis accuracy vs. ground truth

**Produces:** `score_diagnosis(diag: Diagnosis, truth: list[InjectedIssue], iou_threshold: float = 0.3) -> DiagnosisScore`.

- Per issue type: true positives, false positives, false negatives.
- Precision, recall, and mean time IoU over matched pairs.
- Also `aggregate(scores) -> DiagnosisScore`.

**Tests:** hand-built cases.

Then add `scripts/score_rules_on_degraded.py`:

- 200 seeded degraded demos from `sim_worker.scripted.scripted_expert` on
  `sample_scene` scenes (pure, no sim);
- run `detect_rules` → score;
- print a table.

Record the table in the status note. This is the rules-only baseline for the
ablation.

### Task 5: tune the thresholds

Use Task 4's script to tune `STILL_SPEED` and `JITTER_MIN_JERK` against
precision and recall on degraded demos with `jitter_mm` ∈ {1, 2, 4}. Change
the constants only if F1 improves, and keep every existing test green.
Record before/after.

---

## Track T2: sim worker, from reliable replay to yield to second arm

- **Worktree:** `C:\dev\pm-t2`, branch `pm/t2-sim`.
- **Python:** Isaac.
- **Owns:**
  - `sim_worker/**`
  - `src/demo_pipeline/success.py`
  - `tests/test_sim_*.py`
  - `tests/test_dp_success.py`

**Run tests** with
`C:\isaac\env_isaaclab\Scripts\python.exe -m pytest -q --noconftest -p no:cacheprovider <files>`.

### Task 1: write signals with every episode

When `ep_dir` is set, `replay()` also calls
`demo_pipeline.episode_io.save_signals(ep_dir, signals)`. Extend the smoke
script to reload them with `load_signals` and assert the lengths match.

### Task 2: fix IK lag (measured)

**Baseline:** sprint 1 measured a 24.6 mm mean TCP error, with 16 mm at the
gripper-close command.

**Fast variant:** add `scripted_expert(..., hold_s: float = 0.5)` and test it
with `hold_s=0.15`, which is closer to human demos.

**Options to compare** on 20 `sample_scene` scenes (seeds 0–19), fast
variant, no cameras:

- (a) baseline;
- (b) command lookahead k ∈ {3, 5, 8} steps;
- (c) 2 or 4 IK iterations per physics substep;
- (d) gate gripper close/open until TCP error < 5 mm, with a max wait of
  0.5 s. Gating extends the recorded trajectory honestly: the hold is added
  to the trajectory, not hidden.

**Record a table:** success rate, mean and max TCP error, and error at close.

**Make the best option the default.** Prefer the one that changes the
recorded demo least. Keep a CLI flag for the others.

### Task 3: batch runner + reach check (Review Focus 3)

`sim_worker/scripts/run_batch.py --n 50 --seed0 0 --out data/batch_franka [--cameras]`:

- sample scenes with `demo_pipeline.multiply.sample_scene`;
- run the scripted expert, then replay;
- write episodes;
- write `summary.json`: success rate, reasons histogram, wall time.

**Unreachable targets:**

- Detect them: IK residual > 2 cm for > 1 s.
- Record them as failures with reason `unreachable`, in
  `VerificationResult.reasons`. Add it to `check_success`'s documented codes,
  with a test.

**Also:** test the 4 corners of the cube and bin ranges explicitly. Write the
recommended ranges in the note. Do NOT edit `multiply.py`; T1 owns it.

### Task 4: multiplication yield

`sim_worker/scripts/multiply_run.py --n 30 --seed0 100 --out data/multiply_franka`:

- the source is the scripted demo on the base scene (cube (0.5, 0), bin (0.5, 0.3));
- make variants with `transform_trajectory(src_traj, src_scene, sample_scene(...))`;
- replay each, keep successes, and write `yield.json`: attempts, successes,
  yield, reasons.

Compare with MimicGen's 38–74% in the note.

### Task 5: second arm (OpenArm)

- Add `robot="openarm"` support to `scene_cfg`/`replay`, using
  `OPENARM_UNI_HIGH_PD_CFG` from `isaaclab_assets`.
- Find its end-effector body, the TCP offset that puts the fingertip center at
  the target, its gripper joints and open/closed values, and its base
  placement so the cube and bin ranges are reachable. Read the asset config;
  probe the stage as you did for Franka.
- Replay the scripted expert, then `multiply_run --robot openarm`.
- Record the yield. Episodes are written with `robot="openarm"`.

### Task 6 (stretch): cameras at scale

Run `run_batch --n 20 --cameras` and record wall time per episode and peak VRAM.

---

## Track T3: training that survives Windows, policy serving, experiments

- **Worktree:** `C:\dev\pm-t3`, branch `pm/t3-lerobot`.
- **venvs:** `C:\venvs\lerobot` (training) and `C:\venvs\pm-t3` (repo tests).
- **Owns:** `lerobot_tools/**`.
- **Pre-approved:** `uv pip install --python C:\venvs\lerobot pydantic` (make
  it explicit) and `websockets` if you need it.

### Task 1: symlink-free checkpoints (Review Focus 4)

**Decided:** an in-repo wrapper. No Developer Mode.

`lerobot_tools/train.py`:

- monkeypatches lerobot's `update_last_checkpoint`, so `last` becomes a
  directory copy or a `last.txt` pointer instead of a symlink (choose; note
  which `lerobot-train --resume` supports);
- then runs lerobot's train entry point in-process, with `video_backend=pyav`.

**Tests:**

- a unit test of the patched function on a temp folder;
- an integration run: 1,000 steps, `save_freq=250`, batch 8, on T3's synthetic
  dataset → exit 0, 4 checkpoints, `last` resolves.

Record the steps per second.

### Task 2: policy server + stdlib client (for evaluation inside Isaac)

**Server.** `lerobot_tools/policy_server.py --checkpoint <dir> --port 8765`,
running in the lerobot venv:

- `POST /reset` clears the policy state.
- `POST /act` takes
  `{"state": [9 floats], "images": {"front": "<base64 raw uint8 HxWx3>", "wrist": "..."}, "h": 128, "w": 128}`
  and returns `{"action": [9 floats]}`.
- `GET /health`.

**Client.** `lerobot_tools/policy_client.py` uses ONLY the stdlib (urllib,
base64, json, so the Isaac env can import it without new installs):

- `PolicyClient(url).reset()`
- `PolicyClient(url).act(state: np.ndarray, images: dict[str, np.ndarray]) -> np.ndarray`

**Tests:** start the server in a background thread on the sprint-1 smoke
checkpoint; the client gets a finite (9,) action. Also measure round-trip
latency.

### Task 3: dataset assembly per experiment cell

`lerobot_tools/assemble.py`:

- `Cell` (pydantic):
  - `condition: Literal["raw", "raw_multiply", "perfected_multiply", "rules_multiply"]`
  - `n_human: int`
  - `episode_dirs: list[Path]`
- `assemble(cell: Cell, out_root: Path) -> Path` exports via `export_episodes`
  into `out_root/<condition>_<n_human>/`.
- A manifest JSON records the episode dirs and lineage, read from each
  episode's passport.

**Tests:** synthetic episodes; the exported counts match.

### Task 4: experiment runner (dry-run capable)

`lerobot_tools/experiments.py --grid grid.json --steps N [--dry-run]`:

- for each cell: assemble → train (Task 1 wrapper) →
  `results/registry.jsonl` row `{cell, dataset, checkpoint, steps, train_time_s, final_loss}`.
- Evaluation success is filled in later by the sim eval. The column exists and
  stays null for now.

**Test:** run on a tiny synthetic 2-cell grid with 200 steps each.

### Task 5 (stretch): GR00T-ready export

- Research the GR00T N1.x LeRobot-compatible format (the `meta/modality.json`
  schema) from NVIDIA's official repo docs.
- Write `lerobot_tools/gr00t_modality.py`, which writes it for our features.
- Test against a sample in the docs if one is available. Cite sources in the
  note.

---

## Track T4: teleop link, demo store, backend routes

- **Worktree:** `C:\dev\pm-t4`, branch `pm/t4-diagnoser`.
- **venv:** `C:\venvs\pm-t4`.
- **Owns:**
  - sprint 1b's file list;
  - `src/demo_pipeline/store.py`
  - `tests/test_dp_store.py`
  - `src/app/routers/demos.py`
  - `tests/test_demos_api.py`
  - `src/app/main.py` (router includes only)

### Tasks 1–3: Sprint 1b teleop link

Execute `docs/superpowers/plans/2026-10-15-sprint1b-t4-teleop-link.md`
exactly. It is on this branch after the fast-forward.

### Task 4: `store.py`, demo store on disk

`DemoStore(root: Path = data_dir())`:

- `new_id(prefix: str) -> str` — `<prefix>_<yyyymmddHHMMSS>_<4 hex>`.
- `save_demo(demo: Demo) -> Path` — writes `root/demos/<id>/demo.json`.
- `get_demo(id) -> Demo` — raises `KeyError` if missing.
- `list_demos(source: str | None = None) -> list[Demo]` — newest first.
- `episode_dir(id) -> Path` — `root/demos/<id>/episode`.
- `save_diagnosis(id, diag: Diagnosis, source: str, model_id: str | None)`
  and `get_diagnosis(id) -> tuple[Diagnosis, str, str | None] | None`.
- `save_passport(id, Passport)` and `get_passport(id)`.
- `lineage(id) -> list[str]` — follows `parent_id` up to the human root;
  returns root first.

Writes are atomic: write to a temp file, then `os.replace`.

**Tests:** round trips, lineage of a 3-generation chain, missing ids.

### Task 5: backend demo routes (Review Focus 5)

`src/app/routers/demos.py`:

- `POST /demos` (body: Demo JSON) → 201 `{id}`.
- `GET /demos?source=` → list.
- `GET /demos/{id}` → 404 if missing.
- `POST /demos/{id}/diagnose`:
  1. load the episode front frames (`load_episode`) and signals
     (`load_signals`) from `store.episode_dir(id)`;
  2. `compute_windows`;
  3. `select_frames` → `diagnose()`;
  4. on `DiagnosisError` or any `nebius_llm` error → `detect_rules`, with
     source `"rules"`;
  5. save; return `{source, model_id, diagnosis}`.
- `GET /demos/{id}/diagnosis`.
- Errors: no episode → 409; no signals → 409; corrupt files → 422.
- DATA_DIR comes from the env, so tests use `tmp_path`.

**Tests:** mock `diagnose`, following the existing app-test style in
`tests/conftest.py`'s `api` fixture.

### Task 6: one real check on real sim frames (budget ≤ $0.02, ≤ 3 calls)

Script `scripts/diagnose_real_episode.py`:

- run `diagnose()` once on T2's clean scripted episode, at
  `C:\dev\pm-t2\data\smoke_cam` (read-only; it has front and wrist frames);
- use signals if present, otherwise compute windows with empty contacts and
  note it.

A clean expert demo should come back `keep`, or with only minor issues.
Record the false positives in the status note. This is the first real-frame
evidence for the "why AI" question.
