# Perfect, then multiply: design

- **Status:** approved in conversation, 2026-10-15.
- **This design may change as we build.** Record changes in the "Changes" section at the end.
- **Hackathon:** Nebius x NVIDIA Global AI Hackathon, Physical AI track.
- **Deadline:** Oct 30, 2026, 10:00 PDT. Target submit: Oct 29.

## 1. Summary

A person records a robot demonstration by moving their hand in front of a
webcam. A simulated Franka arm in Isaac Lab follows the hand. The raw demo is
noisy: pauses, shaking, off-center grabs.

The pipeline perfects the demo, then multiplies it:

1. **Measure:** code computes motion metrics.
2. **Diagnose:** NVIDIA Nemotron 3.5 Super VL, on Nebius Token Factory, looks
   at key frames plus the metrics. It returns which problems exist, where, and
   which repairs to run.
3. **Repair:** code applies those repairs from a fixed menu.
4. **Verify:** Isaac Lab replays the repaired demo, and code decides success.
5. **Multiply:** verified demos are turned into many variants (new cube and
   bin positions, plus a second arm), and each variant is verified.
6. **Export:** only verified demos go out, in LeRobot format, each with a
   passport describing its origin.

**Rule:** the AI decides, code acts, physics checks.

## 2. Problem and users

- Robot policies learn by imitating demonstrations, and they need many.
- Human demonstrations are the expensive part. Sources (vendor estimates):
  - Teleoperation rigs cost $6k–$80k.
  - Operators cost $25–$50/hour.
  - 20–30% of demos are discarded.
- Webcam teleoperation is cheap, but the demos are noisy.

**Primary user:** robot companies that need lots of reliable data.
**Secondary users:** students and hobbyists, who need no rig, and researchers,
who get standard formats.

## 3. Success criteria

1. **The chart.** Policy success rate (out of 50 fixed test positions) against
   the number of human demos (5, 10, 20), for three conditions:
   - raw;
   - raw + multiply (a MimicGen-style baseline);
   - perfected + multiply (ours).
2. **Ablation** at 10 human demos: rules-only repair vs rules + Nemotron
   repair.
3. **Logged human minutes** per condition.
4. **Multiplication yield** (successful variants / attempted), reported next to
   MimicGen's published 38–74%.

No result is claimed before it is measured. Negative results are reported
honestly.

## 4. Scope

**In scope:**

- One task: pick a red cube (5 cm) and place it in a blue bin.
- Arms: Franka (primary), OpenArm unimanual (second similar arm).
- Webcam recording.
- Nemotron diagnosis.
- The repair menu.
- Verification, multiplication, and LeRobot export.
- ACT training and evaluation.
- Web app pages: Record, Review, Dataset, Results.

**Stretch:**

- SO-101 as a third arm.
- A GR00T-ready modality file.

**Out of scope:**

- Live coaching.
- A "director" that chooses the next human demo.
- Game-engine export.
- Real hardware.
- Multiple tasks.
- RLDS or HDF5 export.
- SkillGen/cuRobo: it needs a Linux-style install and recommends 24 GB VRAM;
  we have 16 GB.

## 5. Prior art and claim wording

**Built on, and cited:**

- MimicGen (object-relative demo multiplication).
- SkillGen (segment-wise repair).
- DemoBridge (planner-based repair of single-view human demos, no VLM).
- ISR (de-pausing, +25%).
- DQAF (VLM diagnosis of teleop demos, given as feedback to the human only).
- handrobot and AnyTeleop (webcam teleoperation).

**Claim (to our knowledge):**

> "A VLM's structured, timestamped diagnosis drives the automatic repair of
> webcam teleoperation demos, verified by physics replay, then multiplied
> across positions and similar arms."

**Never claim:**

- first webcam teleop;
- first demo repair;
- first VLM demo critique;
- first demo multiplication.

## 6. Architecture

```
Browser (web/, React)          Backend (src/app, FastAPI, SANT venv)           Sim worker (sim_worker/, Isaac Lab venv)
  MediaPipe hand tracking  ─WS─►  /ws/teleop relay  ───────────────── WS ──►   teleop: hand pose → EE target → diff-IK → Franka
  Record / Review /              demo routes, Nemotron calls                   recorder, replay+verify, multiply, eval
  Dataset / Results pages  ◄──── job status, results                           writes episodes to DATA_DIR
                                        │
                                        ▼
                           demo_pipeline (src/demo_pipeline): pure Python (numpy + pydantic)
                           schemas, measure, rules detector, repair ops, multiply math, passport
                           imported by BOTH the backend and the sim worker
```

**Two Python environments.**

- The SANT venv (Python ≥ 3.11).
- The Isaac Lab venv at `C:\isaac\env_isaaclab` (Python 3.12.14, numpy 2.3.1,
  pydantic 2.14.1).
- `demo_pipeline` depends only on numpy and pydantic, so it works in both.
- The sim worker gets it with an editable install:
  `pip install -e . --no-deps` from the repo root.
- `numpy` is added to `pyproject.toml`.

**Data folder.** `DATA_DIR`, default `data/`, is git-ignored and holds:

- `raw/`
- `repaired/`
- `variants/`
- `datasets/` (LeRobot exports)
- `runs/` (training and eval)

**Frames and units.**

- Isaac Lab world frame, Z-up, meters.
- Quaternions are `wxyz`, as in Isaac Lab, everywhere in `demo_pipeline`.
- Physics `dt = 0.01 s`; control and recording at 50 Hz (decimation 2).

## 7. Data model (pydantic, in `demo_pipeline/schemas.py`)

### Trajectory

The robot-independent hand path.

- `t: float[N]`: seconds from start.
- `ee_pos: float[N,3]`
- `ee_quat: float[N,4]`: `wxyz`, unit quaternions.
- `gripper: int[N]`: 0 = open, 1 = closed.

### Scene

- `cube_pose`: position + `wxyz`.
- `bin_pose`: position + `wxyz`.
- `robot`: `"franka"` | `"openarm"`.
- `seed`

### Demo

- `id`
- `source`: `"human"` | `"repaired"` | `"variant"`
- `parent_id`
- `trajectory`
- `scene`
- `created_at`
- `human_seconds`: wall-clock time the human spent; 0 for derived demos.

### Episode

What the verifier records during replay.

- Per step: `front_rgb` and `wrist_rgb` image paths, `joint_pos`, `action`
  (joint position targets), `ee_pos`, `ee_quat`, `gripper`.
- Plus `task_text`.

### Metrics

Computed by code every 0.5 s window:

- `speed` (m/s)
- `jerk_rms`
- `gripper`
- `dist_ee_cube` (m)
- `cube_height` (m)
- `contact_gripper_cube`
- `contact_arm_bin`
- `contact_arm_table`

### Diagnosis

Nemotron's output, validated before use.

- `segments`: list of `{name ∈ {approach, grasp, lift, carry, release, retreat}, t0, t1}`.
  They must be ordered and non-overlapping, and lie within `[0, T]`.
- `issues`: list of `{type, t0, t1 | t, evidence}`. `type` is one of:
  `pause`, `jitter`, `slow`, `grasp_off_center`, `wrong_object`, `rim_contact`,
  `bad_release`, `drop`, `idle_start_end`, `other`.
- `repairs`: list of `{op ∈ menu, params}`, validated per op (section 8.4).
- `decision`: `"repair"` | `"discard"` | `"keep"`.
- `label`: the task sentence.

### Verification

- `success: bool`
- `reasons: list[str]`
- `metrics: {duration, path_length, max_contact_force, settle_time}`

### Passport

- `demo_id`
- `lineage`: the chain of `parent_id`s back to a human demo.
- `repairs_applied`
- `diagnosis_source`: `"nemotron"` | `"rules"` | `"none"`
- `model_id`
- `variant_seed`
- `robot`
- `verification`
- `pipeline_version`

## 8. Components

### 8.1 Recorder (sim worker + browser)

- The browser sends hand pose at 30 Hz over a WebSocket: wrist position, a
  palm-orientation estimate, and pinch distance.
- The sim worker maps it to an end-effector target:
  - workspace scaling and offsets come from calibration;
  - depth comes from hand scale;
  - the gripper closes when the thumb–index distance is below 0.35 × palm
    width, and opens above 0.45 × (hysteresis).
- The target drives differential IK (absolute pose mode, Franka high-PD
  preset).
- The trajectory is saved at 50 Hz in sim time.
- If hand tracking is lost for more than 0.3 s, recording pauses.

### 8.2 Measurer (`demo_pipeline/measure.py`)

Pure function: Trajectory + per-step sim signals → a list of Metrics windows.

### 8.3 Diagnoser (backend, `src/app/ai/diagnose.py`)

- **Model:** `nvidia/Nemotron-3.5-Super-VL` (text+image→text, confirmed live
  on 2026-10-15).
- **Input:**
  - 10 front frames evenly spaced, each captioned with its `t`;
  - 1 wrist frame at the first gripper close;
  - the Metrics table as compact text;
  - the task text;
  - the replay success flag.
- **Output:** Diagnosis JSON (section 7).
- **On invalid output:**
  1. retry once with the validation error appended;
  2. then fall back to the rules detector, with `diagnosis_source="rules"`.
- **Calls** go through `nebius_llm`'s chat/vision path, so they are logged to
  `usage_log.jsonl` with a hard cap.
- **Open item:** the image token cost is unknown. Measure it on the first call
  and set the frame count from that.

### 8.4 Rules detector + repair menu (`demo_pipeline/rules.py`, `repair.py`)

The rules detector finds:

- `pause`: speed < 0.01 m/s for ≥ 0.4 s, gripper unchanged;
- `jitter`: a window's jerk_rms > 3× the demo's median window jerk_rms;
- `idle_start_end`.

It never finds semantic issues; that is the point of the ablation.

| op | params | invariants (unit-tested) |
|---|---|---|
| `trim` | `t0, t1` (keep range) | Keeps the first close and the last open |
| `remove_pause` | `t0, t1` | Output is shorter by about `t1 - t0`; no position jump > 1 cm at the stitch; gripper events preserved |
| `smooth` | `t0, t1, strength ∈ {low, med, high}` | Gripper-event poses unchanged (±1 mm); jerk_rms goes down |
| `retime` | `t0, t1, target_speed` (m/s) | Path shape unchanged; duration changes as expected |
| `recenter_grasp` | `t` (grasp time) | Approach and grasp segments are shifted so the gripper closes at the true cube center from the sim state, ±2 mm |
| `replan_transit` | `t0, t1` | Replaced by lift → over the rim at clearance height 0.10 m above the rim → descend. Endpoints unchanged. |
| `discard` | none | The demo is dropped |

Repairs are applied in this fixed order: trim, remove_pause, recenter_grasp,
replan_transit, smooth, retime.

### 8.5 Verifier (sim worker)

- Replays the trajectory through the same diff-IK controller, while recording
  the Episode.
- **Success** (all must hold):
  - the cube center is inside the bin's inner volume (inner size
    0.20 × 0.20 × 0.08 m);
  - the gripper is open at the end;
  - cube speed is below 0.01 m/s for 0.5 s;
  - total time ≤ 30 s;
  - no arm–bin or arm–table contact above 5 N;
  - the cube does not leave the gripper before it is above the bin.
- A failed repaired demo goes back to the Diagnoser with the failure reasons
  and new frames, at most 2 times; then `discard`.

### 8.6 Multiplier (`demo_pipeline/multiply.py` + sim worker)

1. Split by segments:
   - approach + grasp + lift: relative to the cube frame;
   - carry + release + retreat: relative to the bin frame.
2. Sample a new Scene, in the robot base frame:
   - cube: x ∈ [0.40, 0.60] m, y ∈ [−0.20, 0.20] m, yaw ±90°;
   - bin: x ∈ [0.40, 0.65] m, y ∈ [−0.30, 0.30] m;
   - at least 0.15 m between cube and bin edges.

   These ranges get adjusted in the first sim session so they lie inside both
   arms' reach; that change is recorded in the Changes section.
3. Transform each segment.
4. Join the segments with a minimum-jerk interpolation of 0.5 s.
5. Verify. Keep only successes.
6. Cap at 50 attempts per perfected demo. Report the yield.

**Second arm:** the same Trajectory is replayed on OpenArm unimanual via its
own diff-IK. IK failures count as failed attempts.

### 8.7 Exporter (`demo_pipeline/export_lerobot.py`)

- Converts verified Episodes into a LeRobot dataset: front and wrist video,
  `observation.state`, `action`, `task`.
- The passport goes into the episode metadata.
- **Open item:** check the LeRobot dataset version and API on Windows before
  coding.

### 8.8 Trainer + evaluator

- LeRobot ACT, one run per cell of the experiment table.
- Evaluation runs in the sim worker over 50 seeded test Scenes, scored by the
  Verifier's success check.
- **Fallbacks** if LeRobot training fails on Windows:
  1. WSL2;
  2. a Nebius GPU rental. This costs money, so it is the user's decision.

### 8.9 Web app (`web/`)

Reuses the SANT shell, glass components, and `web/src/hand/*`.

| Page | Content |
|---|---|
| Record | Webcam with hand overlay, calibration, start/stop, connection status |
| Review | Demo timeline with issue markers, repair list, before/after replay clips, passport |
| Dataset | Counts per source, yields, export button |
| Results | The chart + the ablation |

**New backend routes:**

- `/ws/teleop`
- `POST /demos`
- `GET /demos/{id}`
- `POST /demos/{id}/diagnose`
- `POST /demos/{id}/repair`
- `POST /demos/{id}/verify`
- `POST /demos/{id}/multiply`
- `POST /export`
- `GET /experiments`

Sim worker jobs run asynchronously; the UI polls job status.

## 9. Error handling

| Failure | Behaviour |
|---|---|
| Nemotron JSON invalid | Retry once with the error, then rules fallback (flagged in the passport) |
| Token Factory 429/5xx | The existing client retries (max 3, honouring Retry-After), then the job fails visibly |
| Repaired demo fails verify | Up to 2 re-diagnoses, then discard with reasons saved |
| Variant unreachable / IK fails | Counted as a failed attempt in the yield |
| Hand tracking lost | Recording pauses; the user is told |
| Sim worker not running | The backend returns 503 with a clear message; the UI shows "start the sim worker" |

## 10. Testing

- **TDD for all of `demo_pipeline`:**
  - schema validation, including rejecting bad Diagnoses;
  - the measure functions;
  - the rules detector;
  - every repair op's invariants, on synthetic trajectories;
  - multiply transforms (round-trip: identity scene → same trajectory);
  - passport lineage;
  - the LeRobot exporter, on a tiny synthetic episode.
- **Backend:** Nemotron is mocked, following SANT's existing pattern, so tests
  make no network calls and spend nothing.
- **Sim worker:** scripted smoke runs on one demo: record → verify →
  multiply(5) → export. Run with `--viz kit` off; record the output.

## 11. Risks and open items

| Risk | Mitigation |
|---|---|
| Webcam depth noise | Hand-scale depth + calibration; the repair step exists for exactly this |
| VLM unreliable on fine physical detail | Nemotron only names issues; code computes the exact fixes from sim state; ablation measures its value |
| LeRobot ACT training on Windows unverified | Check on day 1 of training work; WSL2 → Nebius GPU fallback |
| OpenArm IK / reach differs from Franka | Sample the workspace inside both arms' reach; report the yield honestly |
| 16 GB VRAM | 1–4 environments; small images (e.g. 128×128) for training |
| Sim-only eligibility for the Physical AI track | Ask in the Nebius Discord; screenshot the answer |
| Judges ask "why AI?" | Ablation + examples of semantic issues the rules miss |

## 12. Milestones

| Dates | Milestone |
|---|---|
| Oct 15–16 | Diff-IK go/no-go (Franka + second arm); `demo_pipeline` schemas, measure, rules, repair ops (TDD) |
| Oct 16–18 | Pick-place scene + verifier; hand → sim teleop + recorder |
| Oct 18–20 | Diagnoser (Nemotron VL) + review flow; multiplier + second arm |
| Oct 20–22 | LeRobot export; ACT training + 50-scene eval harness |
| Oct 22–25 | Experiments (11 runs) + ablation; web pages |
| Oct 26–28 | README (Nemotron/Token Factory section, prior art), video, tool feedback |
| Oct 29 | Submit |

## Changes

None yet.
