# Sprint 3: First Real Numbers Implementation Plan

> **For agentic workers:** Execute ONLY your own track, in order.
> Required skills:
> - `test-driven-development` for code;
> - `systematic-debugging` for failures;
> - `verification-before-completion` before claims.
>
> Unattended: keep going until your list is done, or every remaining task is
> blocked.

**Goal:** wire the pieces into one runnable experiment, so the chart's first
real points can be produced:

1. A set of synthetic "webcam-like" human demos, with ground truth (T1).
2. A long-lived sim worker that replays and multiplies over HTTP (T2).
3. A backend pipeline that perfects demos through it (T4).
4. Policies trained and evaluated (T3).
5. Pages that show it all (T5).

**Spec:** `docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md`.
Read its **Changes** section; the 2026-10-16 measurements matter.

**Contract (new, lead-owned — do not edit):** `src/demo_pipeline/sim_protocol.py`

- `GET /health`
- `POST /replay`
- `POST /multiply`

The request/response models are in that file, with tests in
`tests/test_sim_protocol.py`. The default port is 8770.

## Global Constraints

**Start point.** Every worktree starts at `74d1011`. The suite is
**646 passed / 0 failed / 10 skipped**; keep 0 failed. Isaac's pure suites
pass 306.

**SANT-side environment.** `$env:UV_PROJECT_ENVIRONMENT="C:\venvs\pm-<track>"`
and `$env:UV_LINK_MODE="copy"`.

**Isaac side.** Use `C:\isaac\env_isaaclab\Scripts\python.exe`, with
`--noconftest -p no:cacheprovider` for tests. Its `demo_pipeline` is an
editable install from `C:\dev\pm-t2`.

**Isaac processes.** At most one Isaac process at a time. T2's server owns it
during this sprint.

- T3 may run its own Isaac eval only if `nvidia-smi` shows ≥ 8 GB free, and it
  must record that check.
- Before any long Isaac run, turn off nothing. Instead, note that Windows
  sleep can interrupt runs (T2 lost seeds once). Make every long run
  resumable by seed.

**Ownership.** Only your files. Never edit the contract, `tests/conftest.py`,
or another track's files.

**Git.** Commit after every green step. Never push, merge or rebase.

**Money.** No Token Factory calls, except T4 Task 5: at most 10 calls,
≤ $0.05.

**Progress.** Append a dated entry to your status note after every task and
commit it.

## Review Focus

1. **The sim worker receives a request while busy.** It answers 409 `busy`,
   never two sims at once (T2).
2. **The sim worker crashes or isn't running.** The backend job fails with a
   clear message, and the batch can resume (T4).
3. **Variants the second arm can't reach.** They are counted as failures with
   a reason, never a hang (T2).
4. **Training on a dataset whose episodes start far from the eval start
   pose.** The mismatch is detected and reported (T3).
5. **The web pages with an empty store or a backend that is down.** They show
   clear empty/error states, not a blank screen (T5).

---

## T1: experiment set + multiply handover fix

- **Worktree:** `C:\dev\pm-t1`
- **Owns:**
  - `src/demo_pipeline/{multiply,degrade,rules,refine,process,scoring,measure,repair}.py` and their tests;
  - `scripts/make_experiment_set.py`;
  - `tests/test_make_experiment_set.py`.

1. **Handover fix.** Change the fixed-time cube→bin frame handover in
   `transform_trajectory`, per T2's Task 4 finding in
   `docs/superpowers/notes/2026-10-15-t2-status.md`. Hand over at a
   kinematic event, e.g. after the lift reaches its height, not a fixed time.
   - Test: the old failing cases (reproduce them from T2's seeds as pure
     geometry) now keep the cube on its path.
2. **Per-robot sampling ranges.** `sample_scene(rng, robot, seed)` uses a
   per-robot range table. Franka keeps its current ranges (confirmed by T2).
   Add `openarm` and `flexiv` entries, initially equal to Franka, with a
   comment that T2 will tune them.
   - Test: the ranges are honored per robot.
3. **Experiment set builder.** `scripts/make_experiment_set.py --name <set> --n 60 --seed0 0`:
   - for each seed, `sample_scene` → `scripted_expert` → `degrade` (tremor,
     pauses and off-center grasps on mixed seeds; record the mix);
   - write `DATA_DIR/sets/<set>/<id>/demo.json` (`Demo`, `source="human"`,
     `human_seconds` = the degraded duration) and `truth.json`
     (`InjectedIssue`s plus `{"synthetic": true}`);
   - write a `manifest.json`.

   The output is pure (no sim). Test it on n = 3.

---

## T2: sim worker server + second arm

- **Worktree:** `C:\dev\pm-t2`
- **Owns:** `sim_worker/**`, `src/demo_pipeline/success.py`, `tests/test_sim_*.py`, `tests/test_dp_success.py`.

1. **`sim_worker/server.py`** implements the contract.
   - Isaac must run on the main thread. A stdlib `ThreadingHTTPServer` thread
     validates requests with the contract models and puts jobs on a queue; the
     main loop executes them.
   - One job at a time: answer 409 `busy` otherwise.
   - `/multiply` uses `transform_trajectory` + `sample_scene(robot=...)` and
     replays each variant.
   - Episodes go to `DATA_DIR/episodes/<out_name>/`.
   - CLI: `--port 8770 --robot franka --cameras`.
   - Unit-test request handling and queueing with a fake executor (pure).
   - Then run a live smoke test: `/health`, one `/replay`, one `/multiply` with
     n = 3, all from `curl` or a Python stdlib client.
2. **Public placement.** Expose scene placement as a public function (for
   example `place_scene(...)`) so `sim_eval` can stop mirroring it (T3's
   note). Keep `replay` behavior identical.
3. **Second-arm trial: Flexiv Rizon 4s + Grav gripper**
   (`FLEXIV_RIZON4S_GRAV_GRIPPER_CFG`).
   - Add `robot="flexiv"`.
   - Run the scripted expert, then `multiply_run --robot flexiv --n 30`.
   - Compare with OpenArm (0/30). Write a recommendation (flexiv vs openarm
     with per-robot ranges) with numbers, plus tuned ranges for both.
4. **Stretch: rendered degraded demos.** Once T1's set exists after a lead
   merge, or by building a small set directly with `degrade`, replay 20
   degraded demos with cameras to `DATA_DIR/episodes/degraded_*`. This gives
   the first real frames of imperfect demos, for measuring Nemotron's recall.

---

## T3: first training runs + eval readiness

- **Worktree:** `C:\dev\pm-t3`
- **Owns:** `lerobot_tools/**`, `sim_eval/**`.

1. **Keep-alive.** HTTP/1.1 persistent connections in `policy_server` +
   `policy_client`, per your own recommendation. Measure the latency
   before/after.
2. **Start-state check (Review Focus 4).**
   - A tool that reads a dataset's first-frame joint positions and compares
     them with `sim_eval`'s reset pose.
   - `sim_eval` resets to the dataset's mean start pose when they differ by
     more than a threshold you justify.
   - Tests.
3. **First scaling runs on real sim episodes.**
   - Source: T2's camera episodes at `C:\dev\pm-t2\data\batch_franka_cam`
     (read-only, 20 episodes).
   - Cells: n = 5, 10, 20, clean expert demos, all cameras.
   - Train ACT at ≤ 10,000 steps, batch ≤ 8, with `lerobot_tools.train` and
     `experiments.py`, one cell at a time.
   - Record the loss curves and checkpoints in the registry.
4. **Eval** each checkpoint with `sim_eval` (n = 20, seeds 5000+), ONLY when
   no other Isaac process is running and ≥ 8 GB of GPU memory is free. If
   Isaac stays busy, leave `eval_success` null and say so.

---

## T4: backend pipeline through the sim worker

- **Worktree:** `C:\dev\pm-t4`
- **Owns:**
  - `src/demo_pipeline/store.py`
  - `src/app/{sim_client,jobs}.py`
  - `src/app/routers/demos.py`
  - `src/app/main.py`
  - `scripts/run_pipeline_batch.py`
  - their tests

1. **Store cleanup.** Gated list → `StoredDiagnosis.gated` (default `[]`);
   remove the `gated.json` sidecar and the private import.
2. **`SimWorkerClient`** built against the contract (httpx, timeouts,
   `SIM_WORKER_URL`, default `http://127.0.0.1:8770`).
   - Raises `SimWorkerUnavailable` / `SimWorkerBusy`.
   - Tests with `httpx.MockTransport`.
3. **Jobs + `POST /demos/{id}/perfect` + `GET /jobs/{id}`.**
   - `perfect_demo` with:
     - `diagnose_fn` = `diagnose_gated` (frames from the replay episode), or
       `detect_rules` when `?diagnoser=rules`;
     - `verify_fn` = the client's `/replay`.
   - Store the repaired demo (`source="repaired"`), its diagnosis and its
     Passport.
   - 202 + job id; 503 when the worker is down.
   - Tests use fake clients only.
4. **`scripts/run_pipeline_batch.py --set <DATA_DIR/sets/name> --diagnoser rules|nemotron --resume`**
   - For each demo: `/replay` raw (record the episode), then perfect, then
     store.
   - Resumable by demo id. Writes a summary JSON.
   - Tests with fakes.
5. **Live checks.** When T2's server is up (`/health` ok), run the batch on
   3 demos with `--diagnoser rules`, then 3 with `--diagnoser nemotron`
   (≤ 10 calls, ≤ $0.05). Record what happened.

---

## T5: web pages (skip if Susana is building them)

- **Worktree:** `C:\dev\pm-fix`
- **Owns:** `web/src/pm/**`, plus only the route/nav registration lines in
  existing files.

Build Record / Review / Dataset / Results as in the previous T5 prompt
(spec 8.9, `frontend-design` skill, SAMPLE DATA banner on Results). Add
clear empty/error states (Review Focus 5). Also show the new `perfect` job:
a "Perfect" button plus job status polling via `/jobs/{id}`; mock it if the
route isn't merged yet.

`npm --prefix web test` and `npm --prefix web run build` must both pass.
