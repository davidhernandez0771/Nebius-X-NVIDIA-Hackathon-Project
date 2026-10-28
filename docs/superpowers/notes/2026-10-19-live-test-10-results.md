# Live test #10 results (2026-10-19)

## Latest (19:45): `human10c` ran through grid: 3/10 demos perfected, 24/30 variants, grid written (no training)

- **Neaten now has repairs for the two failures these demos have** (`pm/achieved-path` `5363404`, tests first;
  1836 passed, 0 failed):
  - `release_above_bin`: rewrites the place to stop over the bin's inside, with the cube 2 cm above the rim, then
    open and lift. It is emitted by rules on a placing collision.
  - The existing `recenter_grasp`: emitted by rules on a dropped or never-lifted grasp that was off-centre.
  - Grid refuses an empty cell (exit 1).
  - The success check is unchanged.
- **human10c** (achieved path, lookahead 0):
  - raw 0/10;
  - Neaten **3/10 perfected** (9f47, c045, a029);
  - multiply **24/30** (6, 9, 9);
  - grid: raw 10 episodes, perfected_multiply 27. Details are in "Neaten for the human demos' failures" below.
- **Caveat: replay fidelity is still not there.**
  - The best replay reproduces 2–4/10 live outcomes, and the same replay can differ between runs on marginal
    grasps (see "Replay fidelity" below).
  - So a raw verdict here is partly the simulator's luck, and the raw arm's 10 training episodes are 10 failed
    replays.
- **Stopped before training,** as asked.

## Summary (16:10): stopped at the user's gate, 0/10 raw physics passes (needed ≥ 6)

- **The scene was fine** (code + frames). The first physics check replayed `demo.json`'s *commanded hand
  targets*, which the arm lagged by 2.5–5 cm. That gave 0/10 with the cube never in the bin, while all 10 put the
  cube in the bin live.
- **Fixed on `pm/achieved-path` (`2c766db`, from `pm/live-10`), tests first; 1818 passed, 0 failed:**
  - the recorder saves the reached tool path (targets kept as `Demo.commanded`);
  - the experiment replays the achieved path from each live `steps.npz`, in its own store copy (`human10a`).
- **Re-run, achieved path: still 0/10.** The arm now follows the live path to 0.5–0.6 cm.
  - 3 demos reproduce the live outcome (cube in the bin): 66bc, 9f47, c045. They fail only on what live also had:
    collision (+ dropped for 66bc).
  - 7 miss the grasp on replay. 4 were edge grasps live, and the replay closes ~0.5 cm short, one control step
    behind. In the other 3 the first close missed live too, and the regrasps diverge.
- **The gate can't be met with these demos under the pre-registered check, whatever the replay.** Scored with
  the same `check_success`, the *live* runs are **0/10**:
  - 9 collision: the gripper pressed into the bin while placing, 75–927 N against a 5 N limit;
  - 4 dropped: regrasps.
- **Stopped as instructed.** Nothing after physics ran (no repair, multiply, grid or training). The lock is free.

**Options (your call; none started):**
1. **Replay lookahead = 1** (`TrackingOptions.lookahead`) to remove the one-step lag. Then re-check how many replays
   match live; I'd expect the 4 edge grasps back.
2. **Decide whether gripper contact with the bin while placing is a failure.** Today it's "collision" > 5 N.
   Changing it now is post hoc: it needs a new pre-registration that says so.
3. **Re-record** with `pm/achieved-path`'s recorder, placing the cube without pressing into the bin, and grasping
   centred.

**Under test:** `pm/live-10` at `6992247`, worktree `C:\dev\pm-t6`. Servers ran from there and nothing was committed
there. Followed `docs/superpowers/notes/2026-10-19-live-test-10.md` on that branch.

**GPU lock:**
- At 14:23 the holder was not T5 but `pm-fix session (pm/site-perf), headless Chrome perf runs of /world`
  (since 14:19). I waited.
- It was released at 14:25:29. At 14:25:50 I took it as `T4-live10 42832 live-test-10-teleop-sink …`, created with
  `O_EXCL`. pid 42832 is a long-lived `sleep.exe` holder, so `gpu_lock.py` won't see a dead pid and take it over.

## Stage 1: does it work

| # | Check | Result |
|---|---|---|
| 1 | backend `/teleop/status` answers | **FAIL**: the backend does not start |
| 2–7 | /record console, camera, twin REPLAY→LIVE, hand lock, hold/V re-pick, pinch | not run (stopped at the first failure) |

Stages 2 and 3 were not run. No demos were recorded.

### Failure 1: the documented backend command crashes on import

Command, run from `C:\dev\pm-t6` as the note says (with `DATA_DIR=C:\dev\pm-data-live10`):

```
uv run uvicorn app.main:app --reload --app-dir src --port 8000
```

```
  File "C:\dev\pm-t6\src\app\main.py", line 14, in <module>
    from .routers import ask, candidates, ..., robots, rooms, scans, teleop, twin
  File "C:\dev\pm-t6\src\app\routers\robots.py", line 24, in <module>
    from sim_worker.byor_store import RobotStore, UploadError
ModuleNotFoundError: No module named 'sim_worker'
```

**Cause:**
- BYOR's `66d4a0a` ("robot store and /robots routes", on `pm/byor-backend`, now in `pm/merge-trial`,
  `pm/merge-trial-site-full`, `pm/site-results-2` and `pm/live-10`) makes an `app` router import the top-level
  `sim_worker` package.
- `sim_worker` is not in the wheel. `pyproject.toml` packages only `src/nebius_llm`, `src/app` and `src/demo_pipeline`.
- With `--app-dir src`, only `src` is on the path, and `uv run uvicorn` doesn't add the repo root.
- `src/app/routers/robots.py` is the only file under `src/app` that imports `sim_worker`.

**Why the suite didn't catch it:** `[tool.pytest.ini_options] pythonpath = ["."]` puts the repo root on the path for
every test. The branch's "1809 passed" can't see this, and the headless check of `/record` ran with no backend.

**Confirmed:**
- From `C:\dev\pm-t6\src`, with the pm-t6 venv, `import app.main` fails with the same error.
- With `PYTHONPATH=C:\dev\pm-t6` it imports OK, so the missing path is the whole cause.

**Fix options** (not applied; the test said no workarounds, and nothing is committed on `pm/live-10`):
1. **Doc-only:** start the backend with `$env:PYTHONPATH="C:\dev\pm-t6"` (the sink already sets
   `PYTHONPATH=...\src`). The RUNBOOK, ARCHITECTURE and HANDOFF commands all have the same gap.
2. **Code:** make the routes not need `sim_worker` at import. Move `byor_store` under `src/`, or import it lazily
   inside the handlers. Also add a test that imports `app.main` with only `src` on `sys.path`, in a subprocess
   without the pytest pythonpath, so this can't come back.
3. **Packaging:** add `sim_worker` to the wheel packages. It pulls Isaac-side modules into the SANT install, so this
   is probably not wanted.

Option 2 is the real fix, and option 1 is enough to continue the live test today. The call belongs to BYOR's owner
and the merge lead.

**What happened next.**
- You chose option 1, and the backend started with `PYTHONPATH=C:\dev\pm-t6` ("Application startup complete").
- The live test itself was then run in another session. The user recorded 10 demos there with the sink on
  `pm/live-10`, with no DATA_DIR, so they landed in `C:\dev\pm-t6\data\demos`.
- At 15:03 I stopped my backend and Vite (:5173), released `T4-live10`, and stopped its holder pid.
- `C:\dev\pm-data-live10` and `C:\dev\pm-data-human10` were never created.

# Human-demo experiment `human10`: step 4, `--until grid` (2026-10-19)

**Run from** `C:\dev\pm-t4` on `pm/human-demo-exp` (`5d02b18`, an ancestor of `pm/live-10`; the demo schema is
identical):

```
uv run --with pillow python scripts/run_human_demo_experiment.py --name human10 --tag "human_20261019*" --data-dir C:\dev\pm-t6\data --until grid
```

- 15:03:44 to 15:20:28. The script took and released `C:\dev\gpu.lock` itself (`T4 52064 human-exp:human10:sim`).
  Holding it by hand would have deadlocked its own acquire.
- **It stopped at `grid`** with an uncaught `ValueError: a cell is empty: raw 10 episodes, multiplied 0`
  (`sim_worker/human_exp.py:81`). That's a traceback, not the script's exit-1 "Refused".
- No training, Nemotron call or eval ran. Everything is under `C:\dev\pm-t6\data\human_exp\human10\` (git-ignored).

## 1. Physics check of each raw demo: 0/10 pass on replay, but 10/10 put the cube in the bin live

The bin is at (0.5, 0.3). Its inner box is 0.20 m (`BIN_INNER`), with 1 cm walls.

| Demo | Replay verdict | Replay: what the cube did | Live (`demos/<id>/episode`): cube at the end |
|---|---|---|---|
| 7b1f | not_in_bin, collision, dropped, unreachable | barely lifted (max z 0.026), left at (0.564, −0.004) | inside the bin (0.568, 0.244), lifted to 0.159 |
| 66bc | not_in_bin, collision, unreachable | pushed to (0.577, 0.024), max z 0.027 | inside (0.495, 0.287) |
| 9f47 | not_in_bin, collision | lifted to 0.056, then dropped at (0.566, 0.016) | inside (0.437, 0.291) |
| 0576 | not_in_bin, dropped | pushed off to (0.884, 0.026) | inside (0.523, 0.247) |
| a029 | not_in_bin, collision | **never touched**, stayed at (0.501, 0.000) | inside (0.523, 0.305) |
| 87bd | not_in_bin, collision | pushed to (0.608, 0.003) | inside (0.540, 0.289) |
| fb12 | not_in_bin, collision, unreachable | pushed to (0.569, −0.010) | inside (0.567, 0.309) |
| a67b | not_in_bin, collision | lifted to 0.046, dropped at (0.591, −0.041) | inside (0.551, 0.291) |
| c045 | not_in_bin, collision | **never touched**, stayed at (0.501, 0.000) | inside (0.543, 0.300) |
| 3997 | not_in_bin, collision | pushed off to (0.852, −0.098) | inside (0.506, 0.309) |

- In replay the cube never reaches the bin. "Collision" is the arm against the bin at 390–2021 N.
- Live, every demo ends with the cube resting inside the bin (z 0.035) after a 15–23 cm lift.

**The lead's over-reach check.** Taken from `demo.json`:
- 7 demos release at x 0.643–0.691, 4–9 cm past the far inner edge (0.60).
- a029 releases at 0.603, on the wall.
- 9f47 (0.537) and 0576 (0.583, from z 0.18) release over the bin.
- 5 demos close the gripper 3–6 times (66bc 6, a67b 6, 0576 4, 87bd 3, 3997 3).

**But `demo.json` holds the commanded hand target, not where the arm went.** `teleop_session.py:15`: "the
Trajectory is the commanded target per recorded step". At the gripper events (target / live arm / live cube):

| Demo, event | target x | live arm x | live cube x |
|---|---|---|---|
| 9f47 close | 0.410 | 0.495 | 0.500 |
| 9f47 open | 0.537 | 0.439 | 0.437 |
| c045 close | 0.425 | 0.499 | 0.500 |
| c045 open | 0.683 | 0.543 | 0.546 |
| fb12 final open | 0.660 | 0.566 | 0.544 |

- The live arm trails the target like a low-pass filter. Its mean lag is 2.5–5.1 cm, against 1.2–2.5 cm for the
  replay.
- The person steered that lagging arm by eye. So the targets close short of the cube (about 8 cm) and release
  past the bin, while the arm itself grasped and released correctly.
- The replay tracks the same targets about twice as tightly. It closes short and pushes the cube, every time.
- **Cause of the different tracking** (from the code, not yet measured A/B):
  - The webcam target is jittery: 10–18% of steps jump more than 2 cm, up to 11 cm in one step.
  - The live driver (`teleop_isaac.py`) feeds velocity forward from the previous command, and drops it when a
    step is over `MAX_FF_STEP_M` = 2 cm.
  - The replay (`replay.py:232`) feeds forward toward the next recorded target, always. `tracking.py` notes
    that feed-forward takes mean TCP error from 26.8 mm to 2.1 mm.
  - So "raw fails physics" here is **a recording/replay mismatch**. The demos are not bad.

## 2. Neaten (rules repair): 10/10 discarded, 0 perfected

Each demo got 3 rounds (repair → verify → re-diagnose), and each was discarded.

| Demo | ops applied (all rounds) | last verdict |
|---|---|---|
| 7b1f | smooth ×9, remove_pause ×2 | not_in_bin, collision, dropped, unreachable |
| 66bc | smooth ×13 | not_in_bin, collision, unreachable |
| 9f47 | smooth ×6, trim ×1 | not_in_bin, collision |
| 0576 | smooth ×7, remove_pause ×2 | not_in_bin |
| a029 | smooth ×6 | not_in_bin, collision |
| 87bd | smooth ×6 | not_in_bin, collision |
| fb12 | smooth ×7 | not_in_bin, collision |
| a67b | smooth ×13 | not_in_bin, collision |
| c045 | smooth ×10, remove_pause ×1 | not_in_bin, collision |
| 3997 | smooth ×9, remove_pause ×1 | not_in_bin, collision |

- **It did not move a release over the bin, and it couldn't.**
  - The rules diagnoser (`src/demo_pipeline/rules.py`) only emits trim, remove_pause and smooth (the jitter rule:
    jerk_rms > 20 m/s³), plus discard.
  - `recenter_grasp` and `replan_transit` exist in `repair.py`, but rules never emits them.
  - No op anywhere moves a release point.
- Smoothing only filters the targets, so a short grasp stays short.

## 3. Multiply grid: no grid

- **multiply:** every demo's marker says `"no verified repaired demo to multiply"`. 0 variants were tried.
- **align:** all 10 start-aligned raw replays fail too. They are the same targets.
- **grid:** `raw_10` would have 10 episodes and `perfected_multiply_10` 0, so the cell check raised. No
  `grid.json` was written.
- **Also:** `raw_10` would have trained on those 10 *failed replays*, where the cube never reaches the bin.

## 4. preregistration.md

It was written at select (frozen 2026-10-19T19:03:44Z), at
`C:\dev\pm-t6\data\human_exp\human10\preregistration.md`:
- 10 demos by sha256;
- ACT 30k, batch 8;
- raw_10 (`raw_arm = all`) vs perfected_multiply_10;
- start alignment;
- seeds 5020–5059 (n = 40 per arm), serial eval, two-sided Fisher, α = 0.05.

**Not committed.** As frozen, the design can't run: the multiplied arm is empty, and the raw arm would be failed
replays. Committing it as a pre-registration would freeze a test we already know is broken.

## What I'd do next (needs your call; nothing started)

1. **Record what the arm did, or replay the way the live arm moved.**
   - (a) Save the live tool path (`StepState.ee_pos`, already in `demos/<id>/episode/steps.npz`) as the demo
     trajectory, keeping the target as a side channel.
   - (b) Or give replay the live driver's tracking (feed-forward from the previous command, with the 2 cm cutoff).
   - Then check that replaying the saved demo reproduces the live outcome (10/10 here) before any experiment.
     These 10 demos can be re-derived from their `steps.npz` without re-recording.
2. **Rules Neaten needs a grasp/release op**, if raw demos are to fail for a real reason (like the over-reach, had it
   been real): `recenter_grasp` from rules, and a "release over the bin" op.
3. **`grid` should refuse cleanly** (exit 1, `Refused`) on an empty cell, not raise a traceback.

## State left behind

- No servers are running from `C:\dev\pm-t6` or `C:\dev\pm-t4`. `C:\dev\gpu.lock` is free (the script released it at
  15:20:28), and no Isaac process holds the GPU.
- `C:\dev\pm-t4` is now on `pm/human-demo-exp`, not `pm/hand-lock`. This note is untracked, not committed.

# Achieved-path fix and the physics re-run (2026-10-19, 15:25–16:10)

**User's correction:** the scene is fine; the cause is what gets replayed. I checked all three of the lead's
questions.

**(a) Scene.**
- `teleop_sink.base_scene()` builds one Scene: cube (0.5, 0, 0.025), bin `bin_pose_for(0.5, 0.3)`.
- It is placed by the same `_replay._place_scene` the replay uses, and that same object goes into each Demo.
- All 10 `demo.json` scenes match.
- The live and replay front frames show the bin in the same place.

**(b) What is replayed.**
- Before the fix: `demo.json`'s commanded `ee_pos`/`ee_quat`, not `steps.npz`.
- Timing matches: 536 steps × `CONTROL_DT` 0.02 = 10.7 s = `TELEOP_DT`.

**(c) "collision".** `check_success` flags any arm (incl. gripper) contact with the bin or table above 5 N
(`success.py:91`).

**Hypothesis test (one Isaac run, 9f47, scratch DATA_DIR, own lock):**

| 9f47 replayed from | verdict | cube final |
|---|---|---|
| commanded targets | not_in_bin, collision | (0.598, 0.010): on the table |
| achieved path (live steps.npz) | collision | (0.458, 0.297): in the bin, lifted 0.167 like live |
| live | (scores "collision") | (0.437, 0.291) |

## The fix (`pm/achieved-path` at `2c766db`, branched from `pm/live-10` at `5ebd30f`; not pushed)

Tests were written first and failed for the right reasons. Then:

- **`Demo.commanded: Trajectory | None`:**
  - It holds the teleop hand targets; `trajectory` is what the tool did.
  - It must match the trajectory's times.
  - When absent, it is dropped from the JSON. The first full run caught a frozen-set hash change
    (`test_set_v2_is_frozen`) from `"commanded": null`.
- **`teleop_session`:**
  - The trajectory is the reached tool pose per step (`StepState.ee_pos/ee_quat`), and `commanded` keeps the
    targets.
  - The store saver's "unreachable" residual is measured against the targets. Against the trajectory it would
    always be 0.
- **`human_exp.achieved_demo(demo, ee_pos, ee_quat)`:** rebuilds an old demo from its live episode. A demo that
  already has `commanded` is returned unchanged.
- **`run_human_demo_experiment.py`:**
  - `--replay-path achieved` is the default (commanded with `--smoke`). It writes the achieved demo into
    `<exp>/store` with `replay_path.json`: why, the source, and the steps and user-demo hashes.
  - A demo without a live episode is refused.
  - `config.json` freezes `replay_path` and `steps_sha256`, and the pre-registration states what is replayed.
  - `--sim-until physics|repair|align` stops before multiply.
- **Fixture:** `tests/data/human_9f47/`, which has `demo.json` and `live.json` (the reached tool pose and cube track,
  JSON because `*.npz` is git-ignored).
- **Tests:** 1818 passed, 20 skipped, 0 failed (the full suite). No new ruff findings in the touched files.
- **Web not type-checked:** `web/src/pm/types.ts` got an optional `commanded?` field, but pm-t4's
  `web/node_modules` is empty and I didn't install anything.
- **The user's demos were not touched.** They are read-only, and the experiment writes only its own store copy.

## Re-run: `human10a`, physics only

```
uv run --with pillow python scripts/run_human_demo_experiment.py --name human10a --tag "human_20261019*" --data-dir C:\dev\pm-t6\data --until sim --sim-until physics
```

- It ran 15:58:43–16:05:27 under its own `C:\dev\gpu.lock` + KeepAwake, released at the end.
- Everything is in `C:\dev\pm-t6\data\human_exp\human10a\`. `human10` (commanded) is kept as it was.

| Demo | Replay verdict (achieved) | Replay cube end | Live cube end | Live, same check | At the first close: live / replay |
|---|---|---|---|---|---|
| 7b1f | not_in_bin, collision, dropped | table (0.408, 0.017) | bin (0.568, 0.244) | collision | edge grasp held live; replay closed on air |
| 66bc | collision, dropped | **bin** (0.511, 0.319) | bin | collision, dropped | both missed, regrasped; same outcome |
| 9f47 | collision | **bin** (0.458, 0.297) | bin | collision | both held |
| 0576 | not_in_bin, dropped | table (0.644, 0.007) | bin | dropped | edge grasp held live; replay missed |
| a029 | not_in_bin, dropped | table (0.487, −0.011) | bin | collision | edge grasp held live; replay closed on air |
| 87bd | not_in_bin, collision | table (0.617, 0.010) | bin | collision | both missed; regrasps diverged |
| fb12 | not_in_bin, collision | table (0.585, 0.024) | bin | collision, dropped | both missed; regrasps diverged |
| a67b | not_in_bin, collision, dropped | table (0.542, −0.014) | bin | collision, dropped | edge grasp held live; replay closed on air |
| c045 | collision | **bin** (0.549, 0.314) | bin | collision | both held |
| 3997 | not_in_bin, collision | table (0.681, 0.015) | bin | collision | both missed; regrasps diverged |

**Totals:**
- **Raw physics passes: 0/10.**
- Cube in the bin on replay: 3/10. Live: 10/10.
- Live, under the same check: 0/10.

**Replay fidelity.**
- The replay's tool point follows the live path to 0.5–0.6 cm mean (1.8–2.9 cm max). Before the fix it was 2–4 cm
  mean and up to 28 cm.
- At every first close, the replay is ~0.5 cm behind the live arm along the motion and ~2 mm higher. It commands
  pose k at step k, so it reaches it one step late.
- Live grasps that held on the cube's edge become misses: the fingers close fully, gap 0.0000.
- `TrackingOptions.lookahead = 1` is the obvious next test. Not done: it changes the replay for every pipeline, so
  it needs a decision.

**Why fewer than 6 (the user's gate), honestly:**
1. With the commanded path, the replay was the wrong motion. Fixed.
2. With the achieved path, the replay is one step late on marginal grasps. Fixable, but untested.
3. **Decisive:** the demos fail the pre-registered check *as they actually happened* (0/10 live). The
   gripper pressed into the bin while placing (9/10, up to 927 N), and some regrasps dropped the cube. A perfect
   replay can reproduce at most what live did, and live passes 0/10. The ≥ 6 gate can't be met with these demos
   and this check.

**Not done (stopped at the gate):** repair, align, multiply, grid, Nemotron, training and eval. `human10a`'s
`preregistration.md` is frozen in its data dir. It is not committed, since nothing was trained.

# Replay fidelity: lookahead and joint-space probes (2026-10-19, 16:40–19:10)

**Lookahead 1 (option 1), as `human10b`, physics only:** it is worse.

| | Best time shift vs live tool path | Mean error at shift 0 | Live outcomes reproduced |
|---|---|---|---|
| lookahead 0 (`human10a`) | 0 (all 10) | 4.9–6.4 mm | 3/10 |
| lookahead 1 (`human10b`) | +1: it leads (all 10) | 9.6–12 mm | 2/10 |

- My "one step behind" was wrong. The 0.5 cm at the grasps is non-systematic scatter.
- `replay_lookahead` stays a frozen experiment setting with default 0 (`9634c22`). Other pipelines were never
  changed.

**Joint-space probe** (the user's choice). A standalone Isaac script ran 3 replays per demo in one session, no
cameras, scored with the same `check_success`. "Reproduces" means cube in bin and lifted, as live.

| Mode | Reproduces live |
|---|---|
| C: achieved tool path, ee tracking, default start (today) | 2/10 (it was 3/10 in `human10a`: 66bc flipped between runs) |
| A: same, from the live run's first joint state | 4/10 |
| B: the live run's stored joint targets (`action`), with achieved joint velocity | 2/10; the tool drifts 16–34 mm (live also had per-substep IK and velocity targets that aren't stored) |

**Conclusion:**
- No replay mode reproduces these runs reliably.
- The live grasps were marginal (edge grasps, regrasps, cubes pushed before the grasp), and PhysX here runs
  without enhanced determinism, so the same replay can land differently.
- **Fidelity is limited by the demos' marginal contacts as much as by the replay.**
- Not built into the pipeline: no joint-space mode was added.

# Neaten for the human demos' failures + `human10c` (2026-10-19, 19:10–19:45)

**Code** (`pm/achieved-path` `5363404`; tests written first and failing first; full suite 1836 passed, 20
skipped, 0 failed):

- **`demo_pipeline.scene_geometry`:** the one copy of the cube/bin sizes.
  - `sim_worker/scene_cfg.py` now builds the Isaac bodies from it.
  - `app.jobs` and `app.ai.diagnose` read it (same values).
  - The sim worker started fine with it in this run.
- **`release_above_bin(t)`** (new op, runs last):
  - From where the tool nears the bin after the final grasp (footprint + 5 cm), it rises if low, crosses over,
    and stops at the person's release point clamped to the bin's inside (cube half + 1 cm from the walls).
  - The held cube's bottom stops `RELEASE_CLEARANCE` = 2 cm above the rim, i.e. a TCP z of 0.135 m. That is under
    the success check's 0.18 m `high_release` limit.
  - Then it holds closed 0.2 s, opens and holds 0.5 s, lifts 10 cm, and holds 0.5 s.
  - Sizes come from `scene_geometry` and the scene's bin pose. It is tested with a moved, 90°-turned bin too.
    Nothing is per demo.
- **Rules** (`detect_rules(..., reasons=, signals=, scene=)`):
  - **`release_above_bin`:** emitted when the verdict has `collision` and the success check's own predicate (arm or
    gripper contact with the bin or table above 5 N) fires after the final grasp.
  - **`recenter_grasp`:** emitted when the verdict has `dropped`, or `not_in_bin` with the cube never lifted, at each
    close more than 3.3 mm (the IK tracking error) off the cube's centre while the cube still sat within 1 cm of
    its scene pose. That pose is what the existing op aims at.
  - Without those arguments the rules behave as before.
- **`perfect_stored_demo`:** gives the rules the verdict, the replay signals and the scene. In round 1 the rules
  see the raw replay's verdict.
  - Nemotron/hybrid rounds are unchanged.
  - `release_above_bin` is rules-only, left out of the model's op menu, so the diagnose prompt is byte-identical.
- **Grid:** an empty cell is `Refused: empty cell ...` (exit 1), not a traceback.
- **`success.py`:** `COLLISION_FORCE_N` names the existing 5 N. The check is unchanged.

**Run:**

```
uv run --with pillow python scripts/run_human_demo_experiment.py --name human10c --tag "human_20261019*" --data-dir C:\dev\pm-t6\data --until grid
```

- It ran 19:22:59–19:45:05 under the script's own `gpu.lock` + KeepAwake, released at the end.
- Frozen config: `replay_path=achieved`, `replay_lookahead=0`, 10 variants, `raw_arm=all`.
- Everything is in `C:\dev\pm-t6\data\human_exp\human10c\`. `preregistration.md` is frozen there, not committed.

| Demo | Raw (achieved path) | Neaten rounds: ops → verdict | Repair | Multiply |
|---|---|---|---|---|
| 7b1f | not_in_bin, collision, dropped | 1: remove_pause, smooth, **release_above_bin** → not_in_bin, dropped · 2: trim, smooth → same · 3: smooth ×3 → same | discarded | — |
| 66bc | collision, dropped | 1: smooth, **release_above_bin**, **recenter_grasp** → not_in_bin · 2: trim, smooth ×4, recenter_grasp → not_in_bin, dropped · 3: smooth ×5, recenter_grasp → same | discarded | — |
| 9f47 | collision | 1: trim, smooth, **release_above_bin** → **PASS** | **perfected** | **6/10** |
| 0576 | not_in_bin, dropped | 1: remove_pause, smooth → not_in_bin, dropped · 2: smooth ×3 → not_in_bin · 3: smooth ×4 → not_in_bin | discarded | — |
| a029 | not_in_bin, dropped | 1: smooth, **recenter_grasp** → collision · 2: smooth ×3, **release_above_bin** → **PASS** | **perfected** | **9/10** |
| 87bd | not_in_bin, collision | 1: smooth, release_above_bin, recenter_grasp → not_in_bin, dropped · 2: trim, smooth ×2, recenter_grasp → not_in_bin · 3: smooth → not_in_bin | discarded | — |
| fb12 | not_in_bin, collision | 1: smooth, release_above_bin → dropped · 2: trim, smooth ×2, recenter_grasp → not_in_bin, dropped · 3: smooth ×2 → same | discarded | — |
| a67b | not_in_bin, collision, dropped | 1: smooth, release_above_bin, recenter_grasp → not_in_bin, collision · 2: trim, smooth ×6 → not_in_bin, collision, dropped · 3: smooth ×9 → same | discarded | — |
| c045 | collision | 1: remove_pause, smooth, **release_above_bin** → **PASS** | **perfected** | **9/10** |
| 3997 | not_in_bin, collision | 1: remove_pause, smooth, release_above_bin → not_in_bin, dropped · 2: trim, smooth ×4 → same · 3: smooth ×3 → same | discarded | — |

**Totals:**
- Raw: 0/10.
- Perfected: **3/10**. All 3 also verify start-aligned from home.
- Multiply yield: **24/30 = 0.80**.
- **Grid written:** `raw_10` 10 episodes / 5,809 frames (10 human roots); `perfected_multiply_10` 27 episodes /
  11,313 frames (3 human roots).

**What the ops did:**
- **`release_above_bin` removed the collision every time it ran in round 1** (8 demos: no `collision` in the next
  verdict, except a67b).
  - Alone, it fixed the 2 demos whose only failure was the placing collision (9f47, c045).
  - With `recenter_grasp` first, it fixed a029: the recentre made it grasp and carry, and the release then cleared
    the rim.
- **`recenter_grasp` fixed 1 of the 5 demos it ran on** (a029). The others still drop or never lift the cube.
  - Their replays pushed the cube before the close, or regrasped after it moved. Then the rule rightly skips those
    closes, because the existing op aims at the scene's cube pose, not at where the cube is.
- **7 discarded demos** fail on grasping (not_in_bin/dropped), not placing.
  - That is where the replay itself is least faithful (see fidelity above).
  - The next generic op would recentre onto the cube's *measured* position at the close. That needs a cube-xy
    field on `recenter_grasp`, which the Nemotron menu would then also see; not done.

**Before training (for the user's go), honestly:**
- The two arms differ in more than the method.
  - `raw_10` is 10 *failed* replays (`raw_arm=all`).
  - `perfected_multiply_10` is 27 verified episodes from **3** of the 10 people's demos.
- A raw-vs-multiplied difference would mostly measure "trained on successes vs on failures", with n = 3 human roots
  behind the multiplied arm.
- That is the pre-registered design. I flag it rather than change it.
