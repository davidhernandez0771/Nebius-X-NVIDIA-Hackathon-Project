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

**The bridge:** `IsaacDistillEnv.ik_label()` turns the teacher's tool target into the student's 9 joint targets.
- It takes one damped-least-squares step from the visited joints, using the same Isaac Lab
  `DifferentialIKController` ("dls", same limit gain) that replay records episodes with.
- The finger targets are open or closed.
- So the student keeps its action space and nothing downstream changes (export, training, eval).
- **Difference from replay:** replay re-solves the IK at both physics substeps; here it's solved once per control
  step and held. That is exactly how the student's own action is executed at test time.
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

**Inference options:** the `lerobot_tools.inference` flags from the Stage-0 test (`--binarize-gripper`,
`--n-action-steps`, `--temporal-ensemble`) pass through `--inference-args` to the DAgger student and the selection.
The training options (`--augment shift`, `--dilation`) pass through `--train-args`.

### `sim_eval/isaac_distill_env.py` + `sim_eval/scripts/distill_rollouts.py` (Isaac; **never run**)

**`IsaacDistillEnv(IsaacEvalEnv)`** has the same scene, cameras, physics, start pose and stepping, plus
`teacher_state()` and `ik_label()`.

**`distill_rollouts.py`:**
- **DAgger mode:** starts the student's policy server (eval_cells' own helpers) on port 8766.
- **Teacher:** loaded in-process after the app is up.
- **Output:** episodes plus one row per seed, resumable.
- **Shutdown:** the server is stopped inside the sim context (closing the app ends the process).

## The GPU commands (after T3's teacher is trained)

Set these once (cmd). The teacher spec and checkpoint are T3's; the placeholders below are not real paths yet.

```
cd C:\dev\pm-t6
set TEACHER=--teacher <t3_package.module:factory> --teacher-checkpoint <T3 checkpoint>
set HUMAN=--human-grid data\human_exp\mouse20261020\grid.json --human-cell perfected_multiply_10 --start-state data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10
set PY=C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\distill_round.py
```

1. **Dry run** (writes nothing):

   ```
   %PY% --round 0 --run-id distill_mouse %TEACHER% %HUMAN% --dry-run
   ```

2. **Teacher gate on 50 scenes, about 20 min:**

   ```
   %PY% --round 0 --run-id distill_mouse %TEACHER% %HUMAN% --teacher-n 50 --stop-after rollouts
   ```

   Read `data\distill\distill_mouse\r0\rollouts_done.json`:
   - `successes / attempted` should be ≥ 0.9;
   - check `ended_by`;
   - look at 2–3 episodes' `front/` frames.

   If it is far below 0.9, the RL env differs from ours (gains, control rate, friction). Fix that with T3 before
   rendering 600.
3. **Round 0, about 6.5–7.5 h:**

   ```
   %PY% --round 0 --run-id distill_mouse %TEACHER% %HUMAN%
   ```

   It resumes the 50 seeds and goes on to 600.
4. **Round 1, about 4–4.5 h:**

   ```
   %PY% --round 1 --run-id distill_mouse %TEACHER% %HUMAN%
   ```

5. **Round 2** (same command with `--round 2`, about 4.5–5 h) runs only if round 1's `decision.json` says continue.
6. **The test, once, after pre-registering the arm.** Use the last round's chosen checkpoint from
   `data\distill\distill_mouse\r<k>\selection.json`, with the same inference flags as the selection, about 45 min:

   ```
   C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\eval_cells.py --run-id distill_mouse_final ^
     --checkpoint distill_r<k>=<selection.json checkpoint> --seed0 5020 --n 40 ^
     --start-state data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 --start-pose dataset --trace
   ```

**Options:**
- Add `--inference-args "--binarize-gripper --n-action-steps 20"` (or whatever the Stage-0 test picks) to every round.
- Add `--train-args "--augment shift"` if Stage 1 says so.

**Smoke test** of the whole chain, about 30 min:

```
%PY% --round 0 --run-id distill_smoke %TEACHER% %HUMAN% --teacher-n 4 --min-teacher 1 --steps 200 --save-freq 100 --candidates 100 200 --select-n 2
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

- **`sim_eval/tests/test_distill.py` (21).** All against a toy kinematic env, a stub teacher and a stub student.
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
- **`sim_eval/tests/test_distill_round.py` (14).** A fake runner stands in for Isaac, LeRobot and eval_cells.
  - **Mixing:** repeats and shares, the cap, zero weights; `mix_cell` provenance and source checks.
  - **The stop rule.**
  - **Round 0** end to end, including the rerun skip, and its refusal when the teacher fails.
  - **Rounds 1 and 2:** relabel the previous round's chosen student and aggregate; a stopped round skips training;
    round 1 needs round 0.
  - **Rules and options:** the seed rules; inference and train option pass-through; `--stop-after` with a resumed
    larger run; the wrapper's dry run writes nothing.
- **`lerobot_tools/tests/test_assemble.py`:** unchanged and green with the new `sources` field.
- **Full suite** (`uv run --no-sync pytest -q` from the repo root): 2599 passed, 28 skipped, 0 failed.

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
