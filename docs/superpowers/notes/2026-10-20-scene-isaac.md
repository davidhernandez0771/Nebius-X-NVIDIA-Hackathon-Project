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
| The GPU smoke test (3 example plans) | `sim_worker/scripts/scene_smoke.py`, `sim_worker/scene_examples/*.json` | its children | `test_sim_scene_examples.py` (7), Isaac faked |

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

## 4. The GPU smoke test (not run)

Run it with nothing else on the GPU: no Isaac, no Blender, and the GPU lock free. Each child waits on
`C:\dev\gpu.lock`. From `C:\dev\pm-t5`, in PowerShell:

```
C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\scene_smoke.py --out data\scene_smoke
```

**What it does:**
- it builds the three example plans (`sim_worker/scene_examples/`), one Isaac process each:
  - today's scene;
  - a 3-cube stack with 2 bins (the scene creator's test scene);
  - 3 cube sizes, one of them stacked, and 2 bins, one turned 90°;
- each one is settled for 1 s;
- the output, per plan, is `data\scene_smoke\<plan>.json` and `<plan>.png` (front camera), plus `summary.json`.

**How to read it:**
- exit 1 means an Isaac run failed;
- a plan that doesn't settle is listed, not a failure.

**Before it, the Isaac-only unit tests** (Isaac's python, no app, no GPU work):

```
C:\isaac\env_isaaclab\Scripts\python.exe -m pytest --noconftest tests\test_sim_plan_scene.py tests\test_sim_scene_cfg.py tests\test_sim_placement.py
```

## Checks

| Check | Result |
|---|---|
| `uv run pytest`, without `tests/test_launch_health.py` (35 tests, 5 min; it passed on `pm/goals` this morning, and this branch doesn't touch `scripts/launch`) | 2116 passed, 16 skipped, 0 failed |
| New pure tests | 30 (+3 in `test_scene_creator.py`) |
| `py_compile` on `plan_scene.py`, `replay.py`, `placement.py`, `scene_cfg.py`, `settle_plan.py`, `scene_smoke.py`, `test_sim_plan_scene.py` | OK |
| pyflakes on the new and changed files | clean (only `scene_cfg.py`'s deliberate re-exports) |

## Not done, or unknown until the smoke test

- **Nothing ran in Isaac**, so these are unverified:
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
