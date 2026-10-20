# The scene creator's Isaac side (`pm/scene-isaac`, 2026-10-20)

**What it's for:** Nemotron's ScenePlans (`pm/scene-creator`: cubes, stacks, bins, ordered goals) built in Isaac.
Every cube is recorded for the goal checker, and a physics settle check feeds back into the Nemotron loop.

**Code only. Nothing here was run in Isaac or on the GPU:**
- the pure parts are unit-tested;
- the Isaac files are compile-checked (`py_compile`) and pyflakes-clean;
- the Isaac-only tests are written but skip outside Isaac's python.

**Branch:** `pm/live-11` at 7f5e7b6 (it already contained `pm/record-contact`, c766d8a), then merged with:
- `pm/scene-creator` (b82573e);
- `pm/goals` (bd98afe: `goals.py`, which the recording feeds).

Nothing pushed or merged into a shared branch.

## What's new

| Piece | File | Isaac? | Tested |
|---|---|---|---|
| Today's scene numbers, moved out of `scene_cfg.py` (re-exported there under the same names) | `sim_worker/scene_parts.py` | no | all 12 values equal the old definitions; the robota constants test now imports them |
| ScenePlan → bodies (names, prims, sizes, colours, masses, spawn points, poses, contact sensors) | `sim_worker/plan_layout.py` | no | `test_sim_plan_layout.py` (9) |
| The bodies → the scene config; placement; per-cube reads; the settle run | `sim_worker/plan_scene.py`, `placement.py` (`place_layout`, `place_bodies`) | yes | `test_sim_plan_scene.py` (Isaac only, skipped here) |
| Every cube recorded during a replay → goals.py's `SceneSignals`; `objects.npz` + `objects.json` | `sim_worker/object_record.py`, `replay.py` | recorder no, replay yes | `test_sim_object_record.py` (5) |
| The settle check: readable errors | `sim_worker/settle.py` | no (Isaac via a subprocess) | `test_sim_settle.py` (9) |
| The errors back into the Nemotron loop | `app/ai/scene_creator.py` (`check_fn`), `scripts/scene_from_text.py --settle` | no | `test_scene_creator.py` (+3) |
| One plan settled (and photographed) in Isaac | `sim_worker/scripts/settle_plan.py` | yes | compile only |
| The GPU smoke test: unit tests → replay regression → 3 plan settles, one lock | `sim_worker/scripts/scene_smoke.py`, `replay_regression.py`, `sim_worker/regression.py`, `sim_worker/scene_examples/*.json` | its children | `test_sim_scene_examples.py` (11), `test_sim_regression.py` (8), Isaac faked |

## 1. A ScenePlan into the Isaac scene

`plan_layout.layout_for_plan(plan)`:
- **Refuses** a plan that `validate_plan` rejects.
- **Positions:** takes every object's pose from `scene_plan.resolve`, stacks included.
- **Cubes:** each is one body with the plan's size and colour, and today's density, so mass goes with volume
  (`CUBE_MASS` at `CUBE_SIZE`).
- **Bins:** each is today's five kinematic boxes (`scene_parts.bin_parts(inner)`), at the bin's pose and size.
- **Contact sensors:**
  - each cube's sensor is filtered against the fingers;
  - each bin box's against the arm;
  - `arm_contact_sensors()` gives the replay's collision groups;
  - `containers()` gives goals.py its bins.

**Names:**
- one cube + one bin keep today's names (`cube`/`Cube`, `bin_floor`/`BinFloor`, …);
- other plans use `cube_<id>`/`Cube_<id>` and `bin_<id>_<part>`/`Bin_<id>_<Part>`;
- their bodies spawn where they will stand, so nothing overlaps before placement.

**`plan_scene.make_plan_scene_cfg(plan, cameras, robot)`:**
- starts from `make_scene_cfg` (robot, table, cameras, and that robot's finger and arm contact filters, read off its
  own config, so it works for every robot, uploaded ones included);
- swaps today's cube and bin for the plan's bodies;
- each cube is today's cube config, with only the size, mass, colour, prim and spawn changed.

**Today's plan gives today's config.** Checked two ways:
- **Pure:** for today's scene, `layout_for_plan(ScenePlan.from_scene(scene))` has `scene_cfg.py`'s exact names,
  prims, sizes, colours, mass, spawn points and contact sensors, and `placement.place_scene`'s exact poses. The poses
  match to 1e-12: the plan path goes through degrees and back.
- **In Isaac (to run):** `test_sim_plan_scene.py` asserts `make_plan_scene_cfg(today's plan) == make_scene_cfg()`
  for Franka, Flexiv and OpenArm, with and without cameras.

## 2. Every cube recorded

`replay()`'s per-step recording now goes through `ObjectRecorder` and the scene's layout.

**Without a plan,** the layout is today's single cube `cube` / `cube_contact` and today's arm sensors. The SimSignals
are built from the same reads in the same order, so `signals.npz` and the verdict are unchanged. Every episode now
also gets `objects.npz` + `objects.json`.

**With `replay(..., plan=plan)`:**
- the session builds the plan's scene (one scene per process; a different plan raises);
- every cube is recorded;
- the verdict is `check_goals` over the plan's goals, written to `goals.json` with the plan;
- `signals.npz` and the duration, path and force numbers follow the first goal's cube and bin.

"Lifted" and "in a container" aren't stored: `goals.object_series` derives them from the positions. So goals.py and
segment.py read a real multi-object episode with `object_record.load_scene_signals(ep_dir)`.

## 3. The settle check

`settle_plan(plan)` (Isaac):
1. builds and places the plan;
2. holds the robot at its default pose and steps physics `SETTLE_S` = 1 s;
3. reads every cube's pose.

`settle_errors()` (pure) turns the before and after poses into sentences, for example:
- "green fell off red: it dropped 4.0 cm and slid 5.0 cm in 1 s of physics; centre it on red or start it on the
  table";
- "blue tipped over (30 degrees in 1 s of physics); give it flat table under its whole footprint";
- "blue moved 3.0 cm in 1 s of physics, more than 1 cm: it isn't resting where the plan puts it (is it on a bin's
  rim, or against another object?)";
- "blue fell off the table …".

**Thresholds:**
- **Moved more than 1 cm:** check_success calls an object settled below 0.01 m/s, so over the 1 s check that is
  the drift it allows.
- **Tilted more than 10°:** new here; it leaves room for contact jitter.
- **Fell off the table:** a centre below the table top.

**Into the Nemotron loop:**
- `plan_from_text(..., check_fn=...)` runs the check only on plans the validator passed; its errors go back to the
  model like validator errors.
- `scripts/scene_from_text.py --settle "..."` wires in `settle_in_isaac`. That runs `settle_plan.py` in Isaac's
  python as a subprocess, which takes the GPU lock.
- If Isaac itself fails, that raises `SettleUnavailable` and is not blamed on the plan.

## 4. The GPU smoke test (run 2026-10-20, results in 4a): one command, one lock

Run it with nothing else on the GPU (no Isaac, no Blender). From `C:\dev\pm-t5`, in PowerShell:

```
C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\scene_smoke.py --out data\scene_smoke
```

**The lock:** `scene_smoke.py` takes `C:\dev\gpu.lock` once (`sim_worker.gpulock`: O_EXCL, waits while it is held
or the GPU is busy). It releases the lock on any exit: success, failure, an exception, Ctrl+C. A killed process
leaves a lock with a dead PID, which the next taker replaces. Every child runs with `--no-lock`.

**Stages, in order:**
1. **Isaac-only unit tests** (Isaac's python, no app): `tests/test_sim_plan_scene.py` (today's plan config ==
   `make_scene_cfg`), `test_sim_scene_cfg.py`, `test_sim_placement.py`.
2. **Replay regression.** `replay()` changed, and everything uses it. Five stored episodes with known verdicts
   (each verdict reproduces from its saved inputs) are replayed:
   - three of live test #10's webcam demos on the achieved path, from `C:\dev\pm-t6\data\episodes`: a success, a
     collision, and a not_in_bin + dropped;
   - two scripted-expert Franka successes from `C:\dev\pm-t2\data\batch_franka`, because pm-t6 has no scripted
     episodes.

   **How each one replays:** with its own `trajectory.json` and `scene.json`, default tracking (lookahead 0, no
   gate: what made them), from the default start, without cameras.

   **The comparison:**
   - each episode is replayed twice by the **base code** (this branch's merge-base with `pm/live-11`, exported into
     `regression/base_code` with `git archive`, read only) and twice by **this branch**
     (`sim_worker/scripts/replay_regression.py`, one process per code version);
   - `sim_worker.regression` compares the reasons, the cube's path, the gripper and arm contacts, the forces, the
     reached tool path and the joints:
     - base vs base and branch vs branch is PhysX's run-to-run noise, measured on the spot;
     - base vs branch is the regression.

   **The verdicts** (`regression.md` has the exact numbers):
   - *identical*: bit for bit;
   - *within noise*: no base-vs-branch difference larger than the noise, and only reason sets the base also gave;
   - *DIFFERS*.

   The stored episodes, recorded earlier with cameras and older code, are compared too, for the record. Those
   human demos are marginal (replay fidelity was 2–4/10), so their stored verdicts aren't the pass mark; the base
   is.
3. **The three example plans** (`sim_worker/scene_examples/`), one Isaac process each, settled for 1 s and
   photographed:
   - today's scene;
   - a 3-cube stack with 2 bins (the scene creator's test scene);
   - 3 cube sizes, one stacked, and 2 bins, one turned 90°.

**Output in `data\scene_smoke`:**
- `unit_tests.log`;
- `regression.md` and `regression/` (base and branch runs as episode folders);
- `<plan>.json` and `<plan>.png` for each plan;
- `summary.json`.

**Exit 1 when:**
- a stage failed to run;
- the unit tests failed;
- an episode DIFFERS.

A plan that doesn't settle is reported, not a failure.

**Time:** estimated at 10–15 minutes; the real run took about 3 (lock taken 19:44:03, summary at 19:47:09).

## 4a. The smoke test's result (2026-10-20 19:44, after T4's training; Blender open and idle, GPU lock held throughout)

| Stage | Result |
|---|---|
| 1. Isaac-only unit tests | **Didn't run in the smoke test** (pytest exit 2, a collection error), then **20 passed** run directly with the fix below |
| 2. Replay regression (base = `7f5e7b6`) | 3 webcam demos **identical** bit for bit (success; collision; not_in_bin + dropped); 2 scripted Franka **within noise** (cube 0.7 / 0.6 mm, the same as base vs base); every verdict as stored |
| 3. Plan settles | all 3 **settled**, no errors; largest move 0.71 mm (today), 0.05 mm (3-stack), 0.01 mm (3 sizes) |

**Why stage 1 failed:**
- Isaac's venv has an editable install of the project (`_editable_impl_nebius_hackathon.pth`). It points at
  `C:\dev\pm-t2\src`, another worktree whose branch has no `scene_plan`.
- The pytest stage didn't put this checkout first, so collection stopped at
  `No module named 'demo_pipeline.scene_plan'`.
- The settle and replay children were not affected. Both put their own code first on `sys.path` before importing;
  the settle couldn't have imported `scene_plan` from pm-t2.

**The fix:**
- `scene_smoke.py` now runs pytest with `PYTHONPATH=<this checkout>\src;<this checkout>` and writes the
  `unit_tests.log` the docstring promised. A test checks both.
- The same three test files then ran in Isaac's python with this checkout first: 20 passed in 2.3 s. They don't
  start the app.
- The whole smoke test wasn't rerun: the GPU had passed to T2. Stage 1 is the only part that changed.

**The screenshots** (128×128, the policy's front camera): every object is in frame in all three plans, including
the 2-bin layouts and the bin turned 90°.

**What this settles from "Not done" below:**
- Isaac Lab takes the plan's extra scene attributes.
- The spawn rotations are right: the turned cube in plan 3 stays put.
- The front camera frames the three example scenes.

## Checks

| Check | Result |
|---|---|
| `uv run pytest`, without `tests/test_launch_health.py` (35 tests, 5 min; it passed on `pm/goals` this morning, and this branch doesn't touch `scripts/launch`) | 2128 passed, 16 skipped, 0 failed |
| New pure tests | 42 (+3 in `test_scene_creator.py`) |
| `py_compile` on `plan_scene.py`, `replay.py`, `placement.py`, `scene_cfg.py`, `settle_plan.py`, `scene_smoke.py`, `test_sim_plan_scene.py` | OK |
| pyflakes on the new and changed files | clean (only `scene_cfg.py`'s deliberate re-exports) |

## Not done, or unknown until the smoke test

- **Now verified in Isaac (4a):** the plan's extra scene attributes, the spawn rotations, the front camera on the
  three examples, and real settle results. The list below was written before the run:
  - that Isaac Lab takes the extra scene-config attributes the plan adds (`cube_<id>`, …) the way it takes today's;
  - that `None` drops an entity: `scene_cfg` already does this for cameras;
  - the spawn rotations (`init_state.rot`, xyzw);
  - the front-camera warm-up;
  - real settle results.

  Run the Isaac-only tests first, then the smoke test.
- **Record (teleop) still builds today's one cube and bin.** Recording a demo in a multi-object scene needs
  `teleop_isaac` to take a plan too. This change covers the replay and verify side only.
- **Cubes inside a bin at the start,** and stacking goals, aren't supported: ScenePlan doesn't have them.
- **The front camera's fixed view** may not frame wide scenes; the smoke screenshots will show.
