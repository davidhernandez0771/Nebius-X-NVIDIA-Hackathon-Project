# Teacher → student distillation with DAgger (2026-10-20, pm/distill-dagger)

This builds sections 2.4 and 4.1–4.2 of the research note (`docs/superpowers/notes/2026-10-20-research-approach.md`)
on top of the practice-and-correct loop:
- the camera policy (ACT, the **student**) learns from a state-based **teacher**;
- first by behaviour cloning on the teacher's rollouts (round 0);
- then by 1–2 DAgger rounds, in which the student drives and the teacher labels every state it visits.

The branch comes from pm/live-12 (2d1e5ad). It's code only and Isaac was never started: a toy kinematic env, a stub
teacher and a stub student stand in.

**The user's decision (from the lead): no hand-written teacher.**
- The scripted expert / `recovery.py` is not a teacher, not even an option. The user sees it as bypassing the human
  demos.
- The only teacher is T3's RL teacher (pm/rl-teacher), learned from the reward and SANT-verified human demo starts.
- A test (`test_there_is_no_hand_written_teacher`) fails if any distill file mentions `scripted_expert` or
  `recovery_trajectory`.
- **The goal:** the final camera policy above 60%, i.e. ≥ 24/40 on 5020–5059.

## One thing to know first: the two action spaces differ (bridged)

- **Our ACT student** outputs **9 joint targets**. The `action` in every training episode is replay's
  differential-IK output, not an end-effector pose.
- **T3's teacher** outputs an **absolute tool target + binary gripper**.

**Executing the teacher (changed 2026-10-21; agreed with T3, approved by the lead as a run-enabling fix).**
`IsaacDistillEnv.step_teacher()` runs a teacher command exactly as T3's RL env does (pm/rl-teacher
`sim_worker/rl_action.py` on `mimic_tracking.py`):
- **Every physics substep (twice per 50 Hz step):** Isaac Lab's absolute damped-least-squares IK on the **tool
  frame** (panda_hand + the 0.1034 m TCP offset as `body_offset`), λ = 0.01, no joint-limit term, as the position
  target.
- **Once per step:** SANT's joint-velocity feed-forward. It is the twist from the previous teacher command to this
  one over 0.02 s, clamped to 1 m/s and 3 rad/s, solved by one DLS step, and used as the velocity target. There is
  none on the first step after a reset or after a student step.
- **Where the arithmetic lives:** `sim_eval/teacher_ik.py` (numpy). Its formulas are Isaac Lab 3.0's
  (`differential_ik.py` "dls", `compute_pose_error` axis-angle, `_compute_frame_jacobian` with the offset).
  `tests/test_teacher_ik.py` checks them against finite differences on a 3-joint spatial arm.
- **Why:** the 50-scene gate then measures the teacher in our scene, not a different controller.

**The labels (the lead's decision, 2026-10-21, after T3 and I first proposed the first-substep label for both).**
- **Round 0 (the teacher executes).** The label is the **last substep's** arm target plus the finger targets, which
  `step_teacher` returns. That is exactly what `replay.py`'s `_physics_step` returns and every human/SANT episode
  records as `action`.
- **Teacher episode rows also follow replay's pairing.** Replay steps first, then reads the joints, tool pose and
  both cameras. So row k = **the observation after step k** + step k's label, and the rollout's last step is dropped
  (it has no later observation). The whole round-0 mix (human 0.25 + teacher 0.5) then gives `action` one meaning.
- **DAgger (the student executes).** No teacher step runs, so the label is `ik_label()`: one DLS step on the tool
  frame from the observation before the step, paired with that observation. **This is the known approximation:** a
  label one substep (10 ms) earlier than replay's, and paired the other way round. It is only used if round 0 at 600
  misses 18/30.
- **Both targets are kept** for every teacher-labelled step in `teacher.npz` (`label_first`, `label_last`, with
  `obs_step` / `label_step`), to measure the difference. `distill.json` records `pairing` and `label`.
- **Post-hackathon experiment (not for today, the lead's note).** Replay's own pairing labels s(k+1) with the target
  that produced it. At test time the student observes s(k) and then acts, so every dataset carries a one-step shift.
  Whether it matters is worth an A/B after the test, not now.
- The finger targets are open or closed.
- So the student keeps its action space and nothing downstream changes (export, training, eval).
- The student's own steps (`step`) hold their 9-joint target for both substeps with zero arm velocity targets,
  exactly as in the eval env.
- The raw teacher targets are kept beside every episode (`teacher.npz`). An end-effector-space student would be
  possible later, but isn't built.

## The teacher contract (for T3)

`sim_eval/teacher.py`, pure:

```python
teacher = factory(checkpoint="<path>", device="cuda:0")   # --teacher package.module:factory
teacher.name                       # str: goes into lineage "teacher-<name>" / "dagger-r<k>-<name>"
teacher.reset(scene)               # demo_pipeline Scene
teacher.act(state) -> TeacherAction | None
```

**`TeacherState`** is read before each step's action:
- **Robot:** `seed`, `k` (50 Hz step); `joint_pos` (9) and `joint_vel` (9) in Isaac order (panda_joint1..7, then the
  2 fingers); `tcp_pos`, `tcp_quat_wxyz` (fingertip centre).
- **Gripper:** `gripper` (last command, 0/1); `contact_gripper_cube`.
- **Cube:** `cube_pos`, `cube_quat_wxyz`, `cube_lin_vel`.
- **Bin:** `bin_pos`, `bin_quat_wxyz`.
- **Frame:** the env frame (robot base at the origin, as in every sim_worker scene), metres, quaternions wxyz.

**`TeacherAction`:** `ee_pos` (3), `ee_quat_wxyz` (4) and `gripper` 0/1, all absolute.
- `check_action` normalises the quaternion. It raises on anything malformed, so a broken teacher never writes labels.
- **`None` means "no label here".**
  - In a DAgger rollout those steps get no label, and the labelled runs become separate episodes.
  - In a teacher rollout, a `None` ends the episode as `teacher_abstained`.

**What T3 adapts in its own factory:** its observation layout, any action scaling, and the last-action memory. The
factory is imported **after** the Isaac app is up, so it may import Isaac Lab / rsl_rl.

## What is new

### `sim_eval/distill.py` (pure)

**`rollout(env, scene, teacher, cfg, student=None)`.** Rollouts run in the eval env with cameras on and stop at the
first passing `check_success` (checked every 0.5 s).
- **`driver="teacher"` (round 0):** the label is what gets executed. Only passing rollouts are written, so round 0
  also validates the teacher in our env (research-note risk 2).
- **`driver="student"` (DAgger):** the student drives. With `beta` (default 0) the teacher's command is executed
  instead on that share of steps.
  - At every visited state the teacher is asked, and its answer is the label: **relabel, not replace**.
  - The trajectory stays the student's own, mistakes included.
- **Errors:** a student or sim error ends the rollout with a recorded outcome. A teacher error raises.

**Row pairing:** a row is the **observation before the action** (joints, both images, the tool pose) plus that step's
label. That is what the student sees at test time. Replayed demos pair the state after step k with action k, one
20 ms step later. With 100-step ACT chunks both are fine, and they are mixed as they are.

**`write_rollout`** writes episodes in the usual `episode_io` format, so `assemble`, `export` and training run
unchanged. Each episode also gets:
- `scene.json`;
- `distill.json` (provenance: kind, round, teacher, student checkpoint, seed, segment, beta, the rollout's outcome,
  and student-vs-teacher disagreement);
- `teacher.npz` (the raw teacher targets, the executed actions, and who executed each step).

| Kind | Episode name | Lineage root |
|---|---|---|
| Teacher | `teacher_r0_<seed>` | `teacher-<name>` |
| DAgger | `dagger_r<k>_<seed>_<i>`, one per labelled segment of ≥ 25 steps | `dagger-r<k>-<name>` |

**Helpers for the GPU script:**
- **Seed rules:** teacher rollouts use training-side seeds < 5000 (default 4000–4599). DAgger uses practice seeds
  5200–5279 only.
- **Resume:** `rollouts.jsonl`, one row per seed.
- **Done file:** `rollouts_done.json`.
- **`set_aside_stale`:** moves a seed's leftovers from an interrupted attempt to `_stale/`. Nothing is deleted.

### `lerobot_tools/assemble.py`: per-source provenance

- **Machine sources:** lineage roots `teacher-` and `dagger-` are machine sources, like `recovery-`. They never count
  toward `n_human`, and a cell still needs ≥ 1 human demo.
- **`manifest.json["sources"]`:** gives `{human, recovery, teacher, dagger: {episodes, frames}}` per cell. With it,
  the final table can say exactly what each arm was trained on: raw human / SANT / SANT + teacher + DAgger.
- **New condition:** `distill`.

### `sim_eval/distill_round.py` + `sim_eval/scripts/distill_round.py`

**Mixing (`mix_cell`).**
- **Weights:** one weight per source, as a share of the training frames. Defaults: human (SANT) 0.25, teacher 0.5,
  DAgger 0.25. Weight 0 drops a source.
- **Repeats:** LeRobot samples frames uniformly, so a weight is realised by repeating whole episodes. The source with
  the most frames per unit of weight is used once; the others are repeated (rounded, at most ×10).
- **Report:** target and achieved shares go into `round.json`.
- **Check:** each episode's lineage must match the source it is listed under.

**Rounds.** Each round is one resumable command under `C:\dev\gpu.lock` with KeepAwake. Phases:

| Round | Phases |
|---|---|
| 0 | preflight → teacher rollouts → grid (human + teacher) → train → select |
| 1, 2 | preflight (the previous round's chosen student exists) → DAgger rollouts → decide → grid (human + teacher + every DAgger round so far, retrained from scratch: "aggregate and retrain") → train → select |

**The teacher gate** is recorded in `round.json`: the share of teacher rollouts that pass in our env, against 0.9 (the
research note's day-4 gate).
- The grid refuses if fewer than `--min-teacher` (100) passed.
- `--stop-after rollouts` checks the gate on a few seeds first. A later larger `--teacher-n` resumes the same folder.

**Round 0 at a larger `--teacher-n` (the preregistered "300 → 600" path; fixed 2026-10-21).**
- **What runs:** the same command with `--teacher-n 600` after a finished round 0 at 300 keeps the 300 rollouts and
  rolls out only 4300–4599. It then mixes, trains from scratch and selects again.
- **Names:** round 0's grid, training run, evals, round record and selection are per teacher set
  (`distill_mouse_r0_t300` / `_t600`, `r0\round_t300.json`, `r0\selection_t300.json`). Nothing of the 300 run is
  overwritten.
- **Teacher episodes:** each round-0 grid takes only its own seed range, 4000 to 4000 + n − 1.
- **What round 1 uses:** `r0\selection.json` is always the latest selection. DAgger round 1 starts from it and mixes
  in the teacher set it was trained on (its `teacher_seeds`).

**Stop rule (`stop_decision`)**, checked after a DAgger round's rollouts. Those rollouts measure the previous round's
student on seeds it never trained on. The round stops when:
- the student already succeeds on ≥ 90% of them (nothing left to correct); or
- it gained < 5 points over the round before (plateau); or
- the round produced < 5,000 labelled frames.

A stop skips grid, train and select, and is written to `decision.json` and `round.json`.

**Seeds, kept apart:**

| Use | Seeds |
|---|---|
| Teacher | 4000–4599 |
| DAgger round 1 | 5200–5239 |
| DAgger round 2 | 5240–5279 |
| Checkpoint selection | 5300–5329 (eval_cells' own practice range) |
| Test | 5020–5059, never touched by any round |

**What may train the student (guard added 2026-10-21, the lead's request).** T3's gate writes teacher trajectories
on 5300–5349 (under `data\rl\eval\v6_gate`), and those are our selection seeds. The grid phase runs
`check_training_episodes` on every episode before mixing and stops the round (PhaseFailed) on the first offender:

| Source | Must be |
|---|---|
| Any | Carries a `scene.json` with its seed; not in a `data\rl` tree; not on a selection (5300–5399) or test (5020–5059) seed |
| Human (the SANT cell) | A training-side seed, < 5000 (the mouse cell: 110 episodes, seeds 0 and 3100–4009) |
| Teacher | This round's teacher range, inside `r0\episodes` |
| DAgger | The practice seeds 5200–5279, inside its own round's `episodes` |

`round.json` records the result as `data_check` (episodes and seed range per source). No code reads `data\rl` for
training: the sources are only the human grid's cell and our own round folders. The guard makes that a checked fact.

**Inference options:** the `lerobot_tools.inference` flags from the Stage-0 test (`--binarize-gripper`,
`--n-action-steps`, `--temporal-ensemble`) pass through `--inference-args` to the DAgger student and the selection.
The training options (`--augment shift`, `--dilation`) pass through `--train-args`.

### `sim_eval/isaac_distill_env.py` + `sim_eval/scripts/distill_rollouts.py` (Isaac; **never run**)

**`IsaacDistillEnv(IsaacEvalEnv)`** has the same scene, cameras, physics, start pose and student stepping, plus
`teacher_state()`, `step_teacher()` (the teacher's own tracking, see the top) and `ik_label()`.
`IsaacEvalEnv.step` was split into `_apply` + `_record` (no behaviour change) so teacher steps record the same
StepRecord.

**`distill_rollouts.py`:**
- **DAgger mode:** starts the student's policy server (eval_cells' own helpers) on port 8766.
- **Teacher:** loaded in-process after the app is up.
- **Output:** episodes plus one row per seed, resumable.
- **Shutdown:** the server is stopped inside the sim context (closing the app ends the process).

## The order for 2026-10-21 (bound by T7's preregistration)

The preregistration is `pm/live-13` 23adef0, `C:\dev\pm-t8\docs\superpowers\notes\2026-10-21-distill-prereg.md`.
- **Fixed recipe:** 60k steps, candidates 40k / 60k, selection 5300–5329, weights 0.25 / 0.5 / 0.25.
- **No extra flags:** no `--train-args`, no `--inference-args`.
- **No round 2.**

Run the steps strictly one after another, one heavy GPU job at a time. Set these once (cmd):

```
cd C:\dev\pm-t6
set TEACHER=--teacher sim_worker.rl_policy:make --teacher-checkpoint <T3: data\rl\logs\rsl_rl\sant_rl_teacher\<run>\exported\policy.pt>
set HUMAN=--human-grid data\human_exp\mouse20261020\grid.json --human-cell perfected_multiply_10 --start-state data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10
set PY=C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\distill_round.py
```

1. **Dry run** (writes nothing):

   ```
   %PY% --round 0 --run-id distill_mouse %TEACHER% %HUMAN% --teacher-n 300 --dry-run
   ```

   `sim_worker.rl_policy` lives on pm/rl-teacher. For the real runs it must be importable from this worktree (merged
   in, or T3's checkout on the path).
2. **Smoke test, about 30 min.** This is the first time `teacher_state`, `step_teacher` and `ik_label` run in Isaac.

   ```
   %PY% --round 0 --run-id distill_smoke %TEACHER% %HUMAN% --teacher-n 4 --min-teacher 1 --steps 200 --save-freq 100 --candidates 100 200 --select-n 2
   ```

   Check that:
   - the rollouts finish;
   - the `action` columns are joint targets close to `joint_pos`;
   - the front frames show the arm following the teacher;
   - training and selection run.
3. **Teacher gate (b), 4000–4049, about 20 min.** It needs **≥ 45/50**. If it is below, stop and report to the lead.

   ```
   %PY% --round 0 --run-id distill_mouse %TEACHER% %HUMAN% --teacher-n 50 --stop-after rollouts
   ```

   Read `data\distill\distill_mouse\r0\rollouts_done.json`:
   - `successes / attempted`;
   - `ended_by`;
   - 2–3 episodes' `front/` frames.
4. **Round 0 at 300, about 4–5 h**, detached, under gpu.lock, with KeepAwake. It resumes the 50 gate seeds.

   ```
   %PY% --round 0 --run-id distill_mouse %TEACHER% %HUMAN% --teacher-n 300
   ```

   Selection result: `r0\selection_t300.json`. **≥ 18/30 means it is the final model.**
5. **Only if below 18/30: round 0 at 600** (keeps the 300, adds 4300–4599, retrains and reselects under `_t600`):

   ```
   %PY% --round 0 --run-id distill_mouse %TEACHER% %HUMAN% --teacher-n 600
   ```

6. **Only if that is also below 18/30: DAgger round 1** (5200–5239, starts from `r0\selection.json`, which is then the
   600 one):

   ```
   %PY% --round 1 --run-id distill_mouse %TEACHER% %HUMAN%
   ```

   The final model is the one with the most selection successes, round 0 at 600 or round 1; a tie goes to round 1.
7. **The test, once, only after the lead's go.** Use the final model's checkpoint from its selection file, no
   inference flags, about 45 min:

   ```
   C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\eval_cells.py --run-id distill_mouse_final ^
     --checkpoint distill_final=<the final model's checkpoint> --seed0 5020 --n 40 ^
     --start-state data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 --start-pose dataset --trace
   ```

### Time estimates on the RTX 5080

These are measured where noted and are otherwise judgement.

| Phase | Estimate | Basis |
|---|---|---|
| Teacher rollouts, 600 scenes | 3.5–4.5 h | Eval env with cameras: 66–69 s per 30 s failing episode, 17–22 s per success (mouse/human10c evals, measured). A teacher episode of ~6–8 s sim ≈ 20 s plus PNG writes. 10% failures at ~70 s add ~1 h. |
| Export (assemble) | ~21 s per 1,000 frames | Measured: 31.5k frames in ~11 min (hx_mouse 164411). Round 0 is ≈ 250k frames (600 × ~350 teacher frames + human ×3), so ~1.5 h. Round 1 is ≈ 310k, so ~1.8 h. The biggest hidden cost; `--teacher-n 300` halves it. |
| Training, 60k steps (batch 8) | ~50–60 min | Measured 23–30 min per 30k steps, independent of dataset size. |
| Selection, 2 candidates × 30 seeds | ~45 min | ~45 s mean per episode at mixed success, plus server starts. |
| DAgger rollouts, 40 seeds | ~45–50 min | ~66 s per failing 30 s rollout plus ~3,000 PNGs. Shorter as the student improves. |
| Disk | ~5 GB raw episodes per 600 teacher rollouts | ~22 KB per frame (2 PNGs), measured. LeRobot video is ~1.2 KB per frame. Preflight wants 40 GB free. |

**Totals:**
- Round 0 ≈ 6.5–7.5 h (overnight).
- Round 1 ≈ 4–4.5 h.
- Round 2 ≈ 4.5–5 h.
- Test ≈ 45 min.

That fits the research note's Oct 25 (round 0) / Oct 26 (round 1) / Oct 27 (test) plan.

## Tests

- **`sim_eval/tests/test_teacher_ik.py` (6, added 2026-10-21).**
  - Isaac Lab's axis-angle pose error.
  - The tool-frame Jacobian vs finite differences of the tool point on a 3-joint spatial arm.
  - The damped pseudo-inverse.
  - Repeated substep IK converging.
  - Feed-forward clamping (1 m/s, 3 rad/s).
  - No feed-forward after a reset.
- **`sim_eval/tests/test_distill.py` (24).** All against a toy kinematic env, a stub teacher and a stub student.
  - **Added 2026-10-21:**
    - every teacher-executed step goes through `step_teacher`, and every student step through `step`;
    - round-0 labels are the last-substep target and DAgger labels the first (β-mixed steps follow whoever
      executed);
    - teacher episodes use replay's pairing (the observation after step k, the last step dropped), checked through
      the toy's images;
    - pairing can be chosen and is checked.
  - **Teacher interface:** check_action, the 8-vector round trip, load_teacher, and the no-hand-written-teacher guard.
  - **Teacher rollouts:** label = executed; stops at the first passing check.
  - **Student rollouts:** labels are the teacher's commands at the student's own states (the trajectory is the
    student's); beta mixing is deterministic.
  - **Segments and endings:** unlabelled steps split segments; an abstaining teacher can't drive; a broken teacher
    raises; student errors keep labels.
  - **Disagreement metrics.**
  - **Episodes:** written, with provenance, and assemble counts them as "teacher"; failed teacher rollouts are
    dropped; DAgger keeps every segment and needs the student checkpoint.
  - **Script helpers:** seed rules, resume rows, the done summary, and stale folders moved aside.
- **`sim_eval/tests/test_distill_round.py` (20).** A fake runner stands in for Isaac, LeRobot and eval_cells.
  - **Added 2026-10-21 (later):** the training-data guard refuses a `data\rl` folder, selection and test seeds in any
    source, teacher seeds outside the round's range or outside `r0\episodes`, DAgger seeds off the practice range,
    and episodes without `scene.json`; a round stops at grid on a selection-seed episode; `round.json` records
    `data_check`.
  - **Added 2026-10-21:**
    - round 0 at a larger `--teacher-n` keeps the old rollouts, then retrains and reselects under new names, with
      `selection.json` as the latest;
    - each round-0 grid takes only its own teacher seeds.
  - **Mixing:** repeats and shares, the cap, zero weights; `mix_cell` provenance and source checks.
  - **The stop rule.**
  - **Round 0** end to end, including the rerun skip, and its refusal when the teacher fails.
  - **Rounds 1 and 2:** relabel the previous round's chosen student and aggregate; a stopped round skips training;
    round 1 needs round 0.
  - **Rules and options:** the seed rules; inference and train option pass-through; `--stop-after` with a resumed
    larger run; the wrapper's dry run writes nothing.
- **`lerobot_tools/tests/test_assemble.py`:** unchanged and green with the new `sources` field.
- **Full suite** (`uv run --no-sync pytest -q` from the repo root): 2655 passed, 32 skipped, 0 failed (2026-10-21, with T3's ba9e664 merged as 957ec1e and the guard; 10 min 51 s).

## Unknowns only Isaac (and T3) can answer

1. **Does T3's teacher keep its success in our env?** Our env runs one IK solve per 20 ms step, with our gains,
   friction and soft floor. The 50-scene gate answers it in 20 min.
2. **`ik_label` has never run.** The IK and teacher-state code mirror replay.py and isaac_env.py line by line, but no
   Isaac process has executed them. The smoke test is the first real check.
3. **ACT chunks on relabelled episodes.** A DAgger episode's 100-step chunk is a sequence of the teacher's labels
   along the student's path, not the teacher's own plan from that state. That is standard practice for chunked
   DAgger, but it is a known approximation.
4. **Weights.** 0.25 / 0.5 / 0.25 is a judgement. Try a teacher-heavier mix if round 0 under-fits the grasp.

**Leftovers:** none (the dry runs wrote nothing; checked `data/distill` is absent).
