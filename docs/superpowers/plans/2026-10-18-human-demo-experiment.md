# Human-Demo Experiment: One Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> This plan was executed natively by T4 on 2026-10-18 while the user was away (they asked for it to run the same
> night), so it was not reviewed before execution.

**Goal:** After the user records about 10 demos with the hand on the Record page, one command runs the whole
experiment, from the saved demos to a results JSON the Results page can read.

**Architecture:**
- One orchestrator, `scripts/run_human_demo_experiment.py` (SANT venv). It runs the stages in order, writes a
  done-marker per stage under `DATA_DIR/human_exp/<name>/`, and resumes from them.
- The GPU stages run as child processes it starts and stops itself:
  - the sim worker (Isaac venv) for the data stages;
  - `lerobot_tools.experiments` (lerobot venv) for training;
  - `sim_eval/scripts/eval_cells.py` (Isaac venv) for the serial eval.
- Each GPU stage holds `C:\dev\gpu.lock` and `KeepAwake`.
- The pure parts are in `sim_worker/human_exp.py`, next to `homeset.py`, the pure module behind sprint 6's
  home-start dataset; the stand-ins are in `sim_worker/standin.py`. Both are tested without Isaac.

**Tech Stack:** Python 3.14, pydantic, numpy, the existing `app.jobs` / `app.sim_client` / `demo_pipeline`; Isaac Lab 3.0
and LeRobot only in the child processes.

**Spec:** the user's request of 2026-10-18 (quoted in `docs/superpowers/notes/2026-10-18-human-demo-experiment.md`).

## Global Constraints

- The stages, in this order: physics check → repair/neaten → multiply 10×10 → LeRobot datasets → ACT on raw vs
  multiplied (30k steps) → serial eval on seeds 5020–5059 → Fisher's exact test + Wilson CIs → results JSON. The
  Nemotron verdict comes from T3's `review_verdict`.
- T3's `pm/nemotron-judge` files are copied **verbatim** (`git checkout pm/nemotron-judge -- <files>`) and never
  edited.
- **GPU lock:** read `C:\dev\gpu.lock` before any Isaac or training run.
  - If the PID in it is alive, wait and re-check every 5 min.
  - Otherwise write `T4 <PID> <task> <time>`, and delete the file when the run ends, even on failure.
- `sim_worker/keepawake.py` is held around every GPU stage. Never Blender.
- Smoke test: 2k ACT steps, 5 eval seeds, and no headline numbers (`"sample": true` in its results file).
- Never push, merge or rebase. Never print or commit `.env`. Commit after each task, with 0 failed tests.
- The user's DemoStore is read-only. The experiment copies `demo.json` into its own store, so the live
  recordings, their episodes and their diagnoses are never overwritten. (`app.jobs.record_raw` replaces the store
  episode.)

## Design decisions (fixed here, pre-registered in the note)

1. **The same start pose for both arms.** Teleop demos start wherever the hand was at Start. Every training
   episode, raw and multiplied, gets a min-jerk move from `HOME_TCP` to the demo's first pose:
   - `align_home(traj) = homeset.rehome(traj, 0)`, and `k` = the number of steps it adds;
   - variants are `rehome(transform_trajectory(aligned, scene, dst), k)`, exactly as `home_dataset.py` does.

   The eval starts both cells from the raw dataset's start state (`--start-pose dataset`), as in sprint 7.
2. **The arms:**
   - **raw** = every selected demo as recorded, start-aligned (`--raw-arm all`, the default; `verified` keeps only
     the demos that passed the physics check);
   - **multiplied** (`perfected_multiply`) = the rules-repaired demos that verified, start-aligned, plus their
     verified variants.
3. **Variant seeds:** `3100 + 100·i + k` (source *i*, variant *k* < 100), all below 5000.
4. **Nemotron is shown, never decides.**
   - It labels every human demo (from the raw replay's front frames).
   - It judges `--judge-copies` (default 1) verified copies per demo against the human demo.
   - The `ReviewVerdict` is saved next to each demo's `passport.json` in the experiment store.
   - It has a spend cap. A failed call shows `unavailable`.

## Review Focus

- **A demo that never closes the gripper, or starts with it closed:** that demo's multiply/align records an
  error; the rest go on (`test_align_rejects_closed_start`, `test_multiply_skips_source_without_grasp`).
- **A re-run with different demos or settings:** refused, with the differing keys, unless `--force-config`
  (`test_config_change_refused`).
- **A stale lock** (dead PID, or garbage in the file): taken over. A live one is waited on and never deleted
  (`test_lock_*`).
- **A crash mid-stage:** the lock is released, the child processes are stopped, and the next run resumes
  (`test_lock_released_on_error`, `test_resume_skips_done_variants`).
- **An eval file with more seeds than pre-registered:** only seeds 5020…5020+n−1 are counted
  (`test_headline_counts_only_registered_seeds`).

---

### Task 1: GPU lock (`sim_worker/gpu_lock.py`)

**Files:** Create `sim_worker/gpu_lock.py`, `tests/test_sim_gpu_lock.py`.

**Interfaces:** Produces:
- `parse_lock(text) -> LockInfo | None`;
- `format_lock(owner, pid, task, when) -> str`;
- `pid_alive(pid) -> bool` (Win32 `OpenProcess` + `GetExitCodeProcess`; never `os.kill`, which terminates the
  process on Windows);
- `GpuLock(path, task, *, owner="T4", pid=None, alive=pid_alive, sleep=time.sleep, poll_s=300, log=print)`, a
  context manager that creates the file with `O_CREAT|O_EXCL`, takes over a stale lock, and deletes the file
  only if it is still its own.

**Tests** (`test_lock_*`):
- acquire writes `T4 <pid> <task> <iso time>`;
- the exit removes it, also on an exception;
- a live foreign lock makes it sleep 300 s and re-check until the PID dies;
- a dead or unparseable lock is taken over;
- it never deletes a lock that another process rewrote.

### Task 2: Pure experiment logic (`sim_worker/human_exp.py`) + stand-ins (`sim_worker/standin.py`)

**Interfaces:** Produces:
- `select_ids(store, ids=None, tag=None) -> list[str]` (`tag` is an fnmatch pattern over human demo ids, sorted);
- `demo_sha256(store, id) -> str`;
- `align_home(traj) -> tuple[Trajectory, int]`;
- `variant_seed(i, k) -> int`;
- `variant_trajectory(aligned, k, src_scene, dst_scene) -> Trajectory`;
- `cells(raw_dirs, mult_dirs, n_human) -> list[dict]`;
- `headline(episodes, seed0, n) -> dict`;
- `compare(raw, mult) -> dict` (Wilson + Fisher via `demo_pipeline.stats`);
- `config_diff(old, new) -> list[str]`.

`standin.py` produces:
- `late_close(traj, delay_s) -> Trajectory` (holds open at the grasp pose for `delay_s`, then closes);
- `standin_demo(seed, *, id) -> tuple[Demo, dict]`: the teleop base scene, `scripted_expert(home_start=True)` →
  `late_close` → `degrade` (jitter, a pause, an idle start, a small grasp offset, a slow factor), with the truth
  dict.

`scripts/make_standin_demos.py --n 10 --prefix standin` writes them into a DemoStore.

**Tests:**
- the aligned trajectory starts at `HOME_TCP` and ends exactly like the input;
- `k` = the added steps;
- the variant at step `k` equals the transformed aligned trajectory at `k`;
- seeds are distinct and below 5000;
- a seed with k ≥ 100 raises;
- late close keeps the gripper open `delay_s` longer at the same pose;
- stand-ins are `source="human"`, deterministic per seed, and pass the Demo schema;
- the headline counts only the registered seeds and ignores `sim_error` / `policy_error`;
- `compare` matches `fisher_exact` / `wilson_ci`.

### Task 3: Copy T3's intent files verbatim

`git checkout pm/nemotron-judge -- src/demo_pipeline/intent.py src/app/ai/intent.py tests/test_intent.py tests/test_intent_ai.py`.
Run the suite, then commit with a message saying they are verbatim from `65ee726`.

### Task 4: Orchestrator (`scripts/run_human_demo_experiment.py`)

**Stages** (each with a marker under `<data>/human_exp/<name>/stages/`):
1. `select`;
2. `sim` (physics → repair → align → multiply, through one sim worker);
3. `grid`;
4. `nemotron`;
5. `train`;
6. `eval`;
7. `results`.

**Injected:** the sim client factory, the process runner and starter, the lock factory and the Nemotron caller,
so `tests/test_run_human_demo_experiment.py` runs every stage with `FakeSim`, fake subprocesses and a fake judge.

**Tests:**
- a full fake run writes a grid that `load_grid` + `build_manifest` accept (raw cell without repairs,
  ≤ n_human roots);
- the results JSON parses as `results.ts` expects: `sample`, `demos`, `series`, `ablation`, `multiply_yield`;
- `--smoke` gives `"sample": true`, 2000 steps and n = 5;
- a resume skips finished replays;
- the user's store is unchanged (its files are byte-identical);
- the Nemotron failure path gives `unavailable` cards and the run still finishes;
- the GPU stages each take the lock.

### Task 5: Smoke run + status note

- Make 10 stand-ins in a smoke `DATA_DIR`, then run `--smoke` end to end and record every stage's output.
- Write `docs/superpowers/notes/2026-10-18-human-demo-experiment.md`: the pre-registration template, the smoke
  results (labelled smoke), and exactly what the user runs when they get back.
