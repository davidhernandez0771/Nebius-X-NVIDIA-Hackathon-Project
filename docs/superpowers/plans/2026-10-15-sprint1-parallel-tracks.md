# Sprint 1: Four Parallel Tracks Implementation Plan

> **For agentic workers:** Execute ONLY your own track (T1–T4), task by task,
> in your own worktree. Steps use checkbox (`- [ ]`) syntax.
> Required skills:
> - `test-driven-development` for every code task;
> - `systematic-debugging` for every failure;
> - `verification-before-completion` before writing your status note.
>
> The skills `subagent-driven-development` and `executing-plans` are not
> installed; skip any reference to them.

**Goal:** In about 90 unattended minutes, build the four independent
foundations of the perfect-then-multiply pipeline:

- T1: pure-Python core (measure, rules, repair, multiply);
- T2: Isaac Lab sim worker (pick-place scene, replay, verify);
- T3: LeRobot export + training feasibility on Windows;
- T4: Nemotron 3.5 Super VL diagnoser.

**Architecture:**

- The lead session already committed the shared contract in
  `src/demo_pipeline/schemas.py` and `src/demo_pipeline/episode_io.py`.
  Read both first; they are the only shared types.
- Each track owns a disjoint set of files.
- Integration happens later, in the lead session.

**Tech Stack:** Python, numpy, pydantic v2, pytest, uv. Track-specific:

- T2: Isaac Lab 3.0.0 + Isaac Sim 6.2.0 (Python 3.12, `C:\isaac\env_isaaclab`);
- T3: LeRobot;
- T4: OpenAI SDK against Nebius Token Factory.

**Spec:** `docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md`
(read sections 6–10).

**Not in this sprint** (later sprints, lead session):

- webcam teleop recorder;
- backend routes;
- web pages;
- second-arm replay;
- the rules fallback wiring;
- experiments.

## Global Constraints

**Where to work:**

- Work only in your worktree (paths below) on your branch `pm/<track>`.
- Read anything. Modify only the files your track lists.

**Environment (SANT-side tracks T1, T3, T4).** Python environments must live
outside OneDrive, and uv must copy, not hardlink, or installs fail with os
error 5/396. Run these in every new PowerShell before any `uv` command:

```powershell
$env:UV_PROJECT_ENVIRONMENT = "C:\venvs\pm-<track>"
$env:UV_LINK_MODE = "copy"
uv sync --all-extras
```

**Known baseline failures.**

- `uv run pytest -q` shows exactly **54 failed, 165 passed** before any work.
  The failures are Windows-only and in: `tests/test_app_api.py`,
  `tests/test_chat_actions.py`, `tests/test_scan_retrieval.py`,
  `tests/test_usage.py`.
- Never touch them; a separate task fixes them.
- Your bar: all YOUR new tests pass, and the failure count stays at 54.

**Units and conventions.**

- Meters, seconds, Isaac Lab world frame, Z-up.
- Quaternions are `(w, x, y, z)` everywhere.
- Control/recording rate is 50 Hz (dt = 0.02 s); physics dt = 0.01 s,
  decimation 2.
- The task text is exactly `"pick up the red cube and place it in the blue bin"`.

**Purity.** `src/demo_pipeline/*` may import only the stdlib, numpy and
pydantic. No scipy, torch, isaac or lerobot.

**Installs.**

- Only into the venvs named in your track.
- No system, driver or registry changes.
- Never modify Norton or other security settings.

**Git.** Commit after every green task on your own branch. Never push, merge
or rebase.

**Money.** Only T4 may call Token Factory for real: at most 3 calls, at most
$0.05 total, all logged to `usage_log.jsonl`. Every other test mocks the
network.

**GPU.**

- Only T2 runs Isaac Lab, headless (no `--viz`), with `--num_envs 1`.
- T3 may use the GPU only for a short ACT smoke run (≤ 300 steps, batch ≤ 8).

**If blocked** (a missing permission, an unclear API, something that needs a
human):

- Do not guess and do not work around it.
- Write it in your status note and continue with the next task.

**Finish.** Before you stop, write `docs/superpowers/notes/2026-10-15-<track>-status.md`:

- done (with test counts);
- blocked (with exact errors);
- decisions you made;
- next steps.

Commit it.

## Review Focus

1. **Repair times after an earlier repair changed the timeline.** Diagnosis
   times refer to the ORIGINAL demo. `apply_repairs` must map them through
   earlier trims and pause removals. Pinned in T1 Task 3.
2. **A demo where the gripper never closes** (a failed human demo). Rules must
   return `decision="discard"` and must not crash. Pinned in T1 Task 2.
3. **Nemotron output with markdown fences or prose around the JSON.**
   `parse_diagnosis` must extract the JSON object. Pinned in T4 Task 2.
4. **Quaternion sign flips** (q and −q are the same rotation). Smoothing must
   align signs before averaging. Pinned in T1 Task 3.
5. **Episodes without cameras** (`cameras=[]`, if VRAM forces it). The exporter
   must still export state-only episodes. Pinned in T3 Task 2.

---

## Track T1: demo_pipeline core

- **Worktree:** `C:\dev\pm-t1`, branch `pm/t1-core`.
- **venv:** `C:\venvs\pm-t1`.

### Task 1: Measure

**Files:**

- Create: `src/demo_pipeline/measure.py`
- Test: `tests/test_dp_measure.py`

**Interfaces:**

- Consumes: `Trajectory`, `SimSignals`, `MetricsWindow` from `demo_pipeline.schemas`.
- Produces:
  - `speed_profile(traj: Trajectory) -> np.ndarray` — shape [N], m/s, finite
    differences of `ee_pos`; the first element equals the second.
  - `jerk_rms(traj: Trajectory, t0: float, t1: float) -> float` — RMS of the
    third derivative of `ee_pos` over `[t0, t1]`.
  - `compute_windows(traj: Trajectory, sim: SimSignals, window_s: float = 0.5) -> list[MetricsWindow]`
    — consecutive windows covering the whole demo; the last window may be
    shorter.
  - `gripper_events(traj: Trajectory) -> tuple[float | None, float | None]`
    — (time of first close, time of last open after that close).

- [ ] **Step 1:** Write the tests:
  - `test_speed_of_constant_velocity_line_is_constant`
    - 0.1 m/s straight line, 50 Hz.
    - `np.allclose(speed_profile(tr), 0.1, atol=1e-9)`.
  - `test_jerk_is_zero_for_constant_velocity_and_positive_for_noise`
    - Adding N(0, 1 mm) noise gives jerk_rms > 10× the clean value.
  - `test_windows_cover_demo_and_aggregate_signals`
    - A 2.2 s demo gives 5 windows: [0, 0.5], …, [2.0, 2.2].
    - A window contains a contact step → its `contact_arm_bin` is True.
    - `cube_height` is the window's mean `cube_pos[:, 2]`.
    - `dist_ee_cube` is the window's mean distance between `ee_pos` and `cube_pos`.
    - `gripper` is the window's majority value.
  - `test_gripper_events`
    - `[0,0,1,1,0]` at 50 Hz gives `(0.04, 0.08)`.
    - All zeros gives `(None, None)`.
- [ ] **Step 2:** `uv run pytest -q tests/test_dp_measure.py` → FAIL (module missing).
- [ ] **Step 3:** Implement with numpy only. `jerk_rms` uses `np.gradient`
  three times on `ee_pos` against `t`.
- [ ] **Step 4:** Tests pass. The full suite still shows 54 failed.
- [ ] **Step 5:** Commit `feat(demo_pipeline): measure`.

### Task 2: Rules detector

**Files:**

- Create: `src/demo_pipeline/rules.py`
- Test: `tests/test_dp_rules.py`

**Interfaces:**

- Consumes: Task 1 functions, `Diagnosis`, `Segment`, `Issue`, and the repair op models.
- Produces: `detect_rules(traj: Trajectory, windows: list[MetricsWindow], task_text: str = TASK_TEXT) -> Diagnosis`.
  Also define `TASK_TEXT = "pick up the red cube and place it in the blue bin"` in this module.

**Rules (spec 8.4):**

| Finding | Condition | Repair added |
|---|---|---|
| `pause` | speed < 0.01 m/s for ≥ 0.4 s, gripper unchanged in that span | `remove_pause` |
| `jitter` | a window's jerk_rms > 3 × the median window jerk_rms | `smooth` (`strength="med"`) on that window |
| `idle_start_end` | speed < 0.01 m/s for the first or last ≥ 0.4 s | `trim` keeping the active range |

**Segments:**

- `approach` = [0, t_close];
- `carry` = [t_close, t_open];
- `retreat` = [t_open, end].

**Decision:**

- `"discard"` if the gripper never closes;
- `"keep"` if there are no issues;
- `"repair"` otherwise.

Rules never emit semantic issues (`grasp_off_center`, `wrong_object`,
`rim_contact`, `bad_release`); that gap is what the ablation measures.

- [ ] **Step 1:** Write the tests:
  - `test_clean_scripted_demo_is_keep_with_three_segments`
  - `test_pause_of_0_9_s_is_found_and_removed`
    - Inserting a 0.9 s hold at t = 1.5 gives one `pause` issue with
      t0 ≈ 1.5 and t1 ≈ 2.4 (±0.04 s), and a matching `remove_pause` repair.
  - `test_short_hold_of_0_2_s_is_not_a_pause`
  - `test_never_closed_gripper_is_discard` (Review Focus 2)
  - `test_output_passes_diagnosis_check_times`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `detect_rules`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(demo_pipeline): rules detector`.

### Task 3: Repair operations

**Files:**

- Create: `src/demo_pipeline/repair.py`
- Test: `tests/test_dp_repair.py`

**Interfaces:**

- Consumes: `Trajectory`, `Scene`, `RepairOp` and `REPAIR_ORDER` from the schemas; `gripper_events` from Task 1.
- Produces:
  - `class DiscardDemo(Exception)`
  - `apply_repairs(traj: Trajectory, repairs: list[RepairOp], scene: Scene, bin_rim_z: float) -> Trajectory`
    - Applies the ops in `REPAIR_ORDER`, ignoring list order.
    - Raises `DiscardDemo` if a `discard` op is present.
  - One function per op, same names as the ops:
    - `trim(traj, t0, t1)`
    - `remove_pause(traj, t0, t1)`
    - `smooth(traj, t0, t1, strength)`
    - `retime(traj, t0, t1, target_speed)`
    - `recenter_grasp(traj, t, cube_pos: tuple[float, float, float])`
    - `replan_transit(traj, t0, t1, bin_rim_z, clearance=0.10)`

**Decisions the implementer cannot infer:**

- **Time mapping (Review Focus 1).** Op times are in the ORIGINAL timeline.
  `apply_repairs` keeps a monotone map from original time to current time,
  updated after each `trim` and `remove_pause`, and maps every later op's
  times through it.
- **Output timing.** Every op returns a trajectory resampled to an even 50 Hz
  grid starting at t = 0. Positions use linear interpolation; quaternions use
  slerp. Gripper takes the nearest-previous value.
- **`smooth`.**
  - Gaussian kernel on position with sigma = 0.04 / 0.08 / 0.16 s for
    low / med / high.
  - The smoothing weight ramps to 0 within 0.1 s of every gripper event, so
    poses at events stay within 1 mm.
  - Quaternions: flip signs into one hemisphere first (Review Focus 4),
    average, then normalize.
- **`recenter_grasp`.**
  - Offset = (cube_xy − ee_xy at the close time t); z is unchanged.
  - Apply it with a linear ramp from 0 at t − 1.0 s to full at t.
  - Hold it through the lift until t + 1.0 s, then ramp back to 0 by
    t + 2.0 s.
  - Use `cube_pos` from `scene.cube_pose.pos`.
- **`replan_transit`.**
  - The gripper must be constant in [t0, t1]; otherwise raise `ValueError`.
  - The new path: vertical rise to z_clear = max(z(t0), z(t1), bin_rim_z + 0.10),
    then horizontal, then vertical descent.
  - Same average speed as the original span; slerp the orientation.
- **`retime`.** Constant speed `target_speed` along the original path in
  [t0, t1].

- [ ] **Step 1:** Write the tests:
  - `test_remove_pause_shortens_by_pause_and_has_no_jump`
    - Duration drops by 0.9 ± 0.04 s.
    - Max step distance at the stitch < 0.01 m.
    - Gripper close/open events are preserved in order.
  - `test_smooth_reduces_jerk_and_keeps_event_poses`
    - jerk_rms drops.
    - Poses at gripper events within 1e-3 m.
  - `test_smooth_handles_quaternion_sign_flips`
    - q and −q alternating every step gives output close to q, not NaN or zero.
  - `test_retime_keeps_shape_and_changes_duration`
  - `test_recenter_grasp_closes_at_cube_center`
    - At the close step, |ee_xy − cube_xy| < 0.002.
  - `test_replan_transit_clears_rim_and_keeps_endpoints`
    - min z in span ≥ rim + 0.10 − 1e-6, except near the endpoints.
    - Endpoint poses unchanged within 1e-6.
  - `test_replan_transit_rejects_gripper_change_in_span`
  - `test_apply_repairs_maps_times_after_pause_removal`
    - remove_pause(1.5, 2.4) plus smooth(3.0, 4.0) in original time: the
      smoothed span in the output starts at 3.0 − 0.9 ± 0.04.
  - `test_apply_repairs_runs_in_fixed_order_regardless_of_list_order`
  - `test_discard_raises`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(demo_pipeline): repair ops`.

### Task 4 (only if time remains): Multiply transform

**Files:**

- Create: `src/demo_pipeline/multiply.py`
- Test: `tests/test_dp_multiply.py`

**Interfaces:**

- Produces:
  - `transform_trajectory(traj: Trajectory, src: Scene, dst: Scene) -> Trajectory`
    - Steps up to the end of `lift` (t_close + 1.0 s) are rigidly moved by the
      cube's pose change (translation + yaw).
    - Steps from then on are moved by the bin's pose change.
    - A 0.5 s minimum-jerk blend joins the two parts.
  - `sample_scene(rng: np.random.Generator, robot: RobotName, seed: int) -> Scene`
    - cube x ∈ [0.40, 0.60], y ∈ [−0.20, 0.20], yaw ±90°;
    - bin x ∈ [0.40, 0.65], y ∈ [−0.30, 0.30];
    - at least 0.15 m between cube and bin edges (bin half-size 0.11 m, cube
      half-size 0.025 m).
    - Cube center z = 0.025; bin z = 0.

- [ ] **Step 1:** Write the tests:
  - `test_identity_transform_returns_same_trajectory` (within 1e-9)
  - `test_cube_translation_moves_grasp_point`
  - `test_bin_translation_moves_release_point`
  - `test_sampled_scenes_respect_ranges_and_gap` (1000 samples)
- [ ] **Steps 2–5:** Same cycle as Task 1. Commit `feat(demo_pipeline): multiply transform`.

---

## Track T2: Isaac Lab sim worker

- **Worktree:** `C:\dev\pm-t2`, branch `pm/t2-sim`.
- **Python:** `C:\isaac\env_isaaclab\Scripts\python.exe` (Isaac Lab 3.0.0,
  Python 3.12).
- **Before anything else:**
  1. Install the contract into Isaac's env:
     `C:\isaac\env_isaaclab\Scripts\python.exe -m pip install -e C:\dev\pm-t2 --no-deps`.
  2. Install pytest there if it is missing:
     `C:\isaac\env_isaaclab\Scripts\python.exe -m pip install pytest`.
- **API source of truth:** Isaac Lab 3.0's API differs from older tutorials
  online. Read these files and copy their patterns
  (`add_launcher_args`, `launch_simulation`, `InteractiveSceneCfg`,
  `DifferentialIKController`):
  - `C:\isaac\IsaacLab\scripts\tutorials\05_controllers\run_diff_ik.py`
  - `scripts\tutorials\02_scene\*.py`
  - `scripts\tutorials\01_assets\run_rigid_object.py`
  - the contact-sensor and camera tutorials under `scripts\tutorials\04_sensors\`
- **Gotchas:**
  - Isaac Lab 3.0 opens no window unless you pass `--viz kit`; stay headless.
  - The first runs download assets and can take minutes.

### Task 1: Success checker (pure, no Isaac)

**Files:**

- Create: `src/demo_pipeline/success.py`
- Test: `tests/test_dp_success.py`

**Interfaces:**

- Produces: `check_success(traj: Trajectory, sim: SimSignals, bin_pose: Pose, bin_inner=(0.20, 0.20, 0.08), time_limit=30.0, settle_speed=0.01, settle_s=0.5, force_limit=5.0) -> VerificationResult`.

**Success requires all of (spec 8.5):**

- the final cube center lies inside the bin's inner box (bin frame, z from
  bin_pose z to + 0.08);
- the final gripper value is 0;
- cube speed (from `cube_pos` differences) < 0.01 m/s for the last 0.5 s;
- duration ≤ 30 s;
- `max_contact_force` ≤ 5 N whenever `contact_arm_bin` or `contact_arm_table`
  is true;
- the cube is not lost before reaching the bin: if `contact_gripper_cube`
  goes from true to false while the gripper is still closed and the cube is
  not above the bin's footprint, that counts as a drop.

`reasons` lists each failed check with a short code: `not_in_bin`,
`gripper_closed`, `not_settled`, `too_slow`, `collision`, `dropped`.

Metrics:

- `path_length` = sum of ee step distances;
- `settle_time` = seconds the cube has been still at the end.

- [ ] **Step 1:** Write one test per reason code, plus `test_clean_success`,
  using synthetic arrays.
- [ ] **Step 2:** Run with Isaac's python: `C:\isaac\env_isaaclab\Scripts\python.exe -m pytest -q tests\test_dp_success.py` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 2: Pick-place scene + scripted expert

**Files:**

- Create: `sim_worker/__init__.py`
- Create: `sim_worker/scene_cfg.py` — `PickPlaceSceneCfg(InteractiveSceneCfg)`:
  - ground plane, dome light, table, `FRANKA_PANDA_HIGH_PD_CFG`;
  - cube: `RigidObjectCfg` 0.05 m cube, red, mass 0.1 kg;
  - bin: 5 static cuboids, inner 0.20 × 0.20 × 0.08 m, wall 0.01 m, blue;
  - contact sensors on the gripper fingers and the arm links;
  - two cameras, `front` and `wrist`, both 128×128.
- Create: `sim_worker/scripted.py` — `scripted_expert(scene: Scene, rate_hz: int = 50) -> Trajectory`, a pure function that can be tested in Isaac's python without starting the sim:
  1. above cube +0.15 m
  2. descend to cube center z
  3. close (hold 0.5 s)
  4. lift to z 0.25
  5. move above bin center
  6. descend to bin floor +0.10
  7. open (hold 0.5 s)
  8. retreat up 0.15 m

  Orientation: gripper pointing down, wxyz `(0, 1, 0, 0)`, then rotated by
  the cube yaw for steps 1–3.

  Speeds: 0.15 m/s with minimum-jerk profiles.
- Test: `tests/test_sim_scripted.py`:
  - the trajectory validates;
  - gripper events happen at the cube and at the bin;
  - duration < 15 s.

- [ ] **Steps 1–5:** TDD cycle for `scripted_expert`.
  `scene_cfg.py` gets no unit test; Task 3's smoke run exercises it.
  Commit.

### Task 3: Replay + record (the go/no-go)

**Files:**

- Create: `sim_worker/replay.py` — `replay(traj: Trajectory, scene: Scene, *, ep_dir: Path | None, record_cameras: bool) -> tuple[VerificationResult, SimSignals]`.
  - Differential IK in absolute pose mode drives the arm; the binary gripper
    uses Franka finger joint targets (open 0.04, closed 0.0).
  - Logs the `episode_io` arrays and, when `ep_dir` is set, writes the
    episode, PNG images included.
  - Ends by calling `check_success`.
- Create: `sim_worker/scripts/smoke_replay.py`
  - CLI: `--seed`, `--no-cameras`, `--out`. Plus the launcher args.
  - Samples a fixed scene (cube (0.5, 0.0), bin (0.5, 0.3)), runs
    `scripted_expert`, then `replay`, and prints the VerificationResult JSON.

- [ ] **Step 1:** Run `C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\smoke_replay.py --no-cameras --out data\smoke`.
  Expected: `"success": true`.
  If it fails, use systematic-debugging: log ee-to-target error per step,
  cube pose, and contacts.
- [ ] **Step 2:** Run with cameras.
  Expected: the episode folder has 128×128 PNGs and `load_episode` reads it.
  - If VRAM or cameras fail, record the exact error.
  - Then keep `--no-cameras` as the working mode and note it.
- [ ] **Step 3:** Commit, with the measured run time and VRAM (from `nvidia-smi`) in the status note.

---

## Track T3: LeRobot export + training feasibility

- **Worktree:** `C:\dev\pm-t3`, branch `pm/t3-lerobot`.
- **venvs:**
  - `C:\venvs\pm-t3` — SANT side, for repo tests.
  - `C:\venvs\lerobot` — Python 3.12, LeRobot.

  Keep the exporter out of `demo_pipeline`: it imports lerobot, which would
  break the purity rule.

### Task 1: Install and verify LeRobot on Windows

**Files:**

- Create: `docs/superpowers/notes/2026-10-15-t3-lerobot-windows.md`

- [ ] **Step 1:** Look up the current LeRobot version and its install
  instructions (PyPI + GitHub README).
  - Record the version.
  - Record the dataset API: create a dataset, add a frame, save an episode,
    finalize, load.
  - Record the dataset format version.
- [ ] **Step 2:** Create the venv and install:
  ```powershell
  $env:UV_LINK_MODE="copy"
  uv venv --python 3.12 C:\venvs\lerobot
  ```
  Then `uv pip install --python C:\venvs\lerobot torch --index-url https://download.pytorch.org/whl/cu128`
  (the RTX 5080 needs a CUDA 12.8 build), then `uv pip install --python C:\venvs\lerobot lerobot`.
- [ ] **Step 3:** Verify:
  - `C:\venvs\lerobot\Scripts\python.exe -c "import torch, lerobot; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"`
    prints True and the RTX 5080.
  - Record the result and any errors in the note.
- [ ] **Step 4:** Commit the note.

### Task 2: Exporter

**Files:**

- Create: `lerobot_tools/__init__.py`
- Create: `lerobot_tools/export.py` — `export_episodes(ep_dirs: list[Path], out_root: Path, repo_id: str = "local/perfect_then_multiply", fps: int = 50) -> Path`
- Test: `lerobot_tools/tests/test_export.py` (pytest, run with the lerobot venv)

**Interfaces:**

- Consumes: `demo_pipeline.episode_io.load_episode` and `EpisodeMeta`. Install
  the repo into the lerobot venv with `uv pip install --python C:\venvs\lerobot -e C:\dev\pm-t3 --no-deps`.
- Produces the dataset feature names:
  - `observation.state` = joint_pos;
  - `action` = action;
  - `observation.images.front` and `observation.images.wrist`, only when
    present in `meta.cameras`;
  - task = `meta.task_text`.
- The passport goes into per-episode metadata if the API supports it.
  Otherwise write it to a `passports.jsonl` file next to the dataset.

- [ ] **Step 1:** Write the tests, using synthetic episodes created with
  `save_episode` (random 128×128 PNGs written with Pillow, which comes with
  LeRobot):
  - `test_export_two_episodes_and_reload` — episode count 2, frame counts
    match, feature keys match, task text matches.
  - `test_export_state_only_episode` (`cameras=[]`, Review Focus 5).
- [ ] **Step 2:** Run with `C:\venvs\lerobot\Scripts\python.exe -m pytest -q lerobot_tools\tests` → FAIL.
- [ ] **Step 3:** Implement against the API recorded in Task 1.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 3: ACT training smoke

**Files:**

- Create: `lerobot_tools/train_smoke.py` — trains ACT for 300 steps, batch 8,
  on a synthetic exported dataset of 10 episodes × 100 frames.

- [ ] **Step 1:** Run it. Record in the note:
  - steps per second;
  - peak VRAM (from `nvidia-smi`);
  - whether a checkpoint saved and reloads.
- [ ] **Step 2:** Commit.

If LeRobot training fails on Windows, record the exact error and do not
attempt WSL. The fallback decision belongs to the human.

---

## Track T4: Nemotron 3.5 Super VL diagnoser

- **Worktree:** `C:\dev\pm-t4`, branch `pm/t4-diagnoser`.
- **venv:** `C:\venvs\pm-t4`.
- **`.env`:** the lead session copies `.env`, with the API key, into this
  worktree. Never print or commit it.

### Task 1: Multi-image vision call + Nemotron VL tier

**Files:**

- Modify: `src/nebius_llm/config.py` — add to `VISION_TIERS`:
  - tier `"nemotron-vl"`;
  - `model_id = os.environ.get("NEBIUS_MODEL_VISION_NEMOTRON") or "nvidia/Nemotron-3.5-Super-VL"`;
  - prices from `GET /v1/models?verbose=true`. That call is free; do it once
    and record the source in a comment.

  `DEFAULT_VISION_TIER` stays `"minicpm"`.
- Modify: `src/nebius_llm/vision.py` — add `chat_vision_images(prompt: str, images: list[bytes], *, mime_type: str = "image/png", tier: str | None = None, max_tokens: int = 2048, temperature: float = 0.2, retries: int = 0, log_usage: bool = True, extra_body: dict | None = None) -> ChatResult`.
  - Content = one text part, then one image part per image, in order.
  - Share code with `chat_vision`; do not duplicate.
- Modify: `src/nebius_llm/__init__.py` — export `chat_vision_images`.
- Test: `tests/test_vision_client.py` — add tests in the existing mocked style
  (`api_mock` fixture):
  - `test_multi_image_request_has_text_then_images_in_order`;
  - `test_nemotron_vl_tier_routes_to_its_model_id`.

- [ ] **Steps 1–5:** TDD cycle. Commit.

### Task 2: Diagnosis prompt + parsing

**Files:**

- Create: `src/app/ai/diagnose.py`
- Test: `tests/test_diagnose.py`

**Interfaces:**

- Consumes: `Diagnosis`, `MetricsWindow` and the repair op models from
  `demo_pipeline.schemas`, plus `chat_vision_images`.
- Produces:
  - `class DiagnosisError(Exception)`
  - `build_diagnosis_prompt(task_text: str, windows: list[MetricsWindow], frame_times: list[float], has_wrist_frame: bool, replay_success: bool) -> str`
    - It must state the full repair menu with each op's fields, the issue
      types, the segment names, and "times in seconds from demo start".
    - It must ask for exactly one JSON object and nothing else.
    - The metrics table is compact text, one line per window.
  - `parse_diagnosis(text: str, duration: float) -> Diagnosis`
    - Strips markdown fences and surrounding prose by taking the outermost
      `{…}` (Review Focus 3).
    - Validates, then runs `check_times(duration)`.
    - Raises `DiagnosisError` with the validation message on any failure.
  - `diagnose(frames: list[tuple[float, bytes]], wrist_frame: bytes | None, windows: list[MetricsWindow], task_text: str, replay_success: bool, duration: float, *, max_attempts: int = 2) -> Diagnosis`
    - Calls tier `"nemotron-vl"` with
      `extra_body={"chat_template_kwargs": {"enable_thinking": False}}`.
    - On `DiagnosisError`, retries once with the error appended to the prompt.
    - After `max_attempts` failures, raises `DiagnosisError`. The rules
      fallback is wired later by the lead.

- [ ] **Step 1:** Write the tests (mock `chat_vision_images`):
  - `test_parse_accepts_fenced_json_with_prose`
  - `test_parse_rejects_unknown_op`
  - `test_parse_rejects_times_past_demo`
  - `test_diagnose_retries_once_with_error_then_succeeds`
  - `test_diagnose_raises_after_two_bad_replies`
  - `test_prompt_lists_every_repair_op_and_issue_type`
    - Iterate over the `Literal` values from the schemas, so the prompt and
      the schema cannot drift apart.
- [ ] **Steps 2–5:** TDD cycle. Commit.

### Task 3: One live smoke call (budget ≤ $0.05)

**Files:**

- Create: `scripts/diagnose_smoke.py`
  - Draws 10 synthetic 256×256 frames (a red square moving toward a blue
    square, with t written in the filename only).
  - Writes PNGs with the stdlib (zlib + struct); no new dependency.
  - Builds 6 fake MetricsWindows that contain one obvious 0.9 s pause.
  - Calls `diagnose` once and prints the Diagnosis JSON, plus prompt tokens,
    completion tokens, cost and latency from the usage log.
- Create: `docs/superpowers/notes/2026-10-15-t4-nemotron-vl.md`, recording:
  - the exact model ID;
  - prompt tokens per image (estimated from the call);
  - cost per call;
  - latency;
  - whether the JSON was valid on the first try;
  - whether the pause was found.

- [ ] **Step 1:** Run `uv run python scripts/diagnose_smoke.py` at most 3 times total.
- [ ] **Step 2:** Write the note. Commit.
