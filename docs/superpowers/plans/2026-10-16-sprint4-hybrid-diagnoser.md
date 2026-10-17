# Sprint 4 (T1, T2, T4): Rules + Nemotron, and Fixing the Multiply Yield

> Sprint 3's Global Constraints apply: ownership, 0 failed, no
> push/merge/rebase, at most one Isaac job at a time per process (check before
> launching), and a progress entry after every task.
> Required skills: `test-driven-development`, `systematic-debugging`,
> `verification-before-completion`.

**Start point:** `3614784` — 927 Python + 410 Isaac-pure + 163 web tests pass.
T3 (eval) and T5 (teleop) may still be running; never edit their files.

## Why this sprint

T4's live run (n = 3) found that the calibrated Nemotron keeps every degraded
demo, catching 0 of 9 real issues, while the rules found them. The spec's
ablation is **rules-only vs rules + Nemotron**, but the code currently uses
Nemotron *instead of* the rules.

**Fix:** a hybrid diagnosis.

- The rules own the timing issues (pause, jitter, idle_start_end), with
  measured F1 0.97–0.99 under tremor.
- Nemotron adds what the rules never name: `grasp_off_center` (wrist frame),
  `bad_release`, `drop`, `wrong_object`, plus its segmentation. Gate it with
  the metrics.

Also, multiply yield on degraded or perfected demos was 40–48% (mostly
`unreachable`), against 90% on the clean expert. The running sim worker
predates T1's handover fix and per-robot ranges.

**Measurement set:** T2's 20 rendered degraded episodes at
`C:\dev\pm-t2\data\episodes\degraded_0000..0019`. Each has front/wrist
frames, `signals.npz`, `demo.json` and `truth.json`. Clean reference:
`C:\dev\pm-t2\data\smoke_cam`.

---

## T4 (`C:\dev\pm-t4`): the hybrid diagnoser + a fair ablation

**Owns:**

- `src/app/ai/diagnose.py`
- `src/app/routers/demos.py`
- `src/app/jobs.py`
- `scripts/run_pipeline_batch.py`, `scripts/run_experiment.py`
- new `scripts/ablation_diagnosis.py`
- their tests

### 1. `diagnose_hybrid`

`diagnose_hybrid(frames, wrist_frame, windows, traj, task_text, replay_success, duration) -> (Diagnosis, list[str])`:

1. Run `detect_rules` → the timing issues.
2. Call Nemotron with a NEW prompt that says the timing issues are already
   handled by code (list them) and asks only for:
   - grasp quality from the wrist frame;
   - release quality;
   - drops;
   - wrong object;
   - segmentation.
3. Remove the "when in doubt, leave it out" bias. Keep "contacts are ground
   truth".
4. Gate Nemotron's issues with the metrics, as before.
5. Merge: the rules' issues and repairs, plus Nemotron's issues and repairs
   for the types it owns (de-duplicate overlapping repairs), plus Nemotron's
   segments when valid.
6. The decision follows from the merged issues.

`diagnosis_source = "hybrid"`. Extend the source `Literal`s **only if needed,
by asking the lead in your note**: the schemas are lead-owned. Until then,
map hybrid to `"nemotron"` and record `hybrid: true` in the note/route output.

### 2. Wiring

- `?diagnoser=rules|nemotron|hybrid` for the perfect route and both batch
  scripts.
- `hybrid` becomes the default for `nemotron` runs.
- Tests with fakes.

### 3. Ablation script (live)

`scripts/ablation_diagnosis.py --episodes <glob> --diagnosers rules,hybrid --clean <smoke_cam>`:

- runs each diagnoser on the 20 degraded episodes and the clean one;
- scores against `truth.json` with `demo_pipeline.scoring.score_diagnosis`;
- writes `data/ablation/<ts>/scores.json`, plus a table:
  - P/R/F1 per issue type;
  - false positives on the clean episode;
  - calls and cost.

**Budget:** ≤ 50 real calls, ≤ $0.10. Never print or commit `.env`.

Report honestly, including when hybrid does not beat rules on a type.

---

## T2 (`C:\dev\pm-t2`): restart on current code, then fix yield and sim_error

**Owns:** `sim_worker/**` except T5's `teleop_*` files, `src/demo_pipeline/success.py`, and `tests/test_sim_*.py` except T5's.

### 1. Restart the sim worker on current code

Your worktree was fast-forwarded to `3614784`. It includes T1's
gripper-event handover and the fitted `SCENE_RANGES`.

1. Stop the running server (yours).
2. Re-run `client_smoke.py`.
3. Record the multiply yield on the clean expert source again: Franka n = 30,
   seeds 100+. T1 predicts ~30/30.

### 2. sim_error on `s1_0004_rules` variants

Use T4's data: `C:\dev\pm-t4\data\sets\s1\` and the worker logs. Reproduce
one variant directly through `replay()`, find the root cause, and fix it in
`sim_worker`. If the cause is a repaired trajectory property, record it for
T1.

### 3. Multiply yield on degraded and perfected sources

1. Re-run T4's s1 multiply (5 sources × 5 variants, raw and rules) through
   the restarted worker.
2. Classify the failures: unreachable where, and why.
3. Fix what is sim-side.
4. Record the numbers before and after.

### 4. Leave the server running for the others

At the end, start `python -m sim_worker.server --port 8770 --robot franka --cameras`
and leave it running. Record that in your note.

---

## T1 (`C:\dev\pm-t1`): why degraded variants fail, plus real media

**Owns:**

- `src/demo_pipeline/{multiply,repair,degrade,rules,refine,process,scoring,results,media}.py` and their tests;
- `scripts/{render_charts,make_media,build_results_json,score_pipeline_run,make_experiment_set}.py`;
- `docs/media/**` (new).

### 1. Pure geometry analysis of the 40–48% yield

Use T4's s1 variant folders (`scene.json`, `trajectory.json`,
`verification.json`, read-only) under `C:\dev\pm-t4\data\sets\s1\`, plus
`DATA_DIR` episodes. Find which transformed targets leave the reachable
envelope, and why: for example the degrade grasp offset, longer human paths,
pauses or ranges. Fix it in `multiply.py`/`repair.py` if it is pipeline-side.

**Tests:** reproduce the bad cases as pure geometry. Coordinate through your
note with T2, who looks at the sim side.

### 2. Media for the README and video

- Run `make_media.py` on the s1 pairs (raw vs rules-perfected, the same
  demo) and on one degraded episode with its diagnosis timeline.
- Run `build_results_json.py` + `render_charts.py` on whatever real results
  exist; pending values stay pending.
- Save curated outputs in `docs/media/`, each file ≤ 5 MB, with a short
  `docs/media/README.md` saying what each file shows and its source.
