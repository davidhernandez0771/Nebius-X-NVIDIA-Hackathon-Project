# Nemotron as the scene creator (2026-10-19, branch `pm/scene-creator` from `pm/achieved-path`)

**The idea:** you type a scene in words ("2 bins, 3 cubes stacked in a pile, put the red one in the left bin") and
get a scene to record demos in.

**Done tonight (no GPU):**
- the schema;
- the Nemotron loop;
- the code validator;
- the CLI;
- real calls on 5 sentences.

**Not done:** Isaac wasn't run. Below is the plan for the Isaac part.

## What's there

- **`src/demo_pipeline/scene_plan.py`** (pure: pydantic + numpy).
  - **`ScenePlan`** has `objects` (2–10 cubes and bins), `goals` (cube → bin, in order) and `reach`.
    - Cubes: an id, a colour from 8 names, and a size of 3–7 cm (the fingers open to 8 cm). A cube has either a
      table `pose` (x, y, yaw) or `"on": <cube id>`.
    - Bins: the inside length, width and height (10–30 cm sides, 4–12 cm walls) plus a pose.
    - Heights are never written. `resolve()` derives them from the table and the stacks.
    - The schema is strict: `extra="forbid"`, ids are lowercase, and every plan needs at least one goal.
  - **Today's scene round-trips.** `ScenePlan.from_scene(scene)` gives a red `CUBE_SIZE` cube "cube" and a blue
    `BIN_INNER` bin "bin", with the sizes taken from `scene_geometry`. `to_scene(seed)` gives back the same `Scene`.
    The test compares positions and quaternions to 1e-12.
  - **Reach comes from code**, never from the model: the box around the robot's tested `SCENE_RANGES` (Franka: x
    0.40–0.65, y −0.30–0.30), plus a 0.25 m stack-top limit.
  - **`validate_plan()`** returns readable errors. Each one gives numbers and a fix, because the errors go back to
    Nemotron:
    - **Reach:** every table object's centre is inside the envelope.
    - **Space:** footprints, including the bins' rotated outer walls, are at least 3 cm apart. An error gives both
      footprints' extents, plus the smallest single move that clears the gap and stays in reach. When one object
      clashes with two others, the hint moves the one with fewer clashes.
    - **Stacks:** cubes stack only on cubes, one per support, centred within 20 % of the smaller cube, with no
      loops or unknown ids. A tall stack's error says the largest cube size that keeps every cube.
    - **Goals:** each goal names a real cube and bin, each cube moves once, a cube's top is cleared first, every
      cube fits its bin, and no bin gets more cubes than it holds.
- **`src/app/ai/scene_creator.py`** has `plan_from_text(text)`.
  - It uses the existing `nebius_llm.chat` on the `super` tier.
  - The system prompt states the conventions (+y = the robot's left) and the same numbers the validator checks.
  - The model's reply is parsed as JSON and checked by the schema and the validator. Any problem goes back with
    the model's own reply, up to 3 retries (4 calls).
  - `robot` and `reach` are stripped from the reply, so the model can't widen the reach.
- **`scripts/scene_from_text.py "<sentence>"`** prints the plan, where each object ends up, and the validation.
  - A valid plan is saved to `DATA_DIR/scenes/<UTC time>_<slug>.json` as `{id, text, created, model, calls,
    est_cost_usd, plan}`.
  - `--check <plan.json>` validates a file without calling the model.
- **Tests:**
  - `tests/test_dp_scene_plan.py` (17) and `tests/test_scene_creator.py` (10, with Nemotron faked).
  - The full suite: `uv run pytest -q` → 1882 passed, 15 skipped, 0 failed.

## Real calls (`nemotron-3-super-120b-a12b`, ≈ $0.037 over all 4 runs)

**The key.** This worktree has no `.env`. I ran `uv run --env-file <main checkout>/.env` (its 8.3 short path,
because uv splits the path at the space). The key was never printed or copied.

**Run history.** I changed the error messages twice from what the runs showed, so the runs aren't comparable.

| run | validator feedback | valid plans (of 5) | the failures |
|---|---|---|---|
| 1 | plain errors | 3 | 3 bins in a row (overlaps); tower of 6 (too tall) |
| 2 | + each footprint's extent | 4 | 3 bins in a row; the tower passed by dropping to 5 cubes |
| 3 | + "smallest fix" move | 4 | 3 bins: the middle bin got contradictory hints |
| 4 (final) | + move the object with fewer clashes, size hint for stacks | **4** | 3 bins: down to 1 problem, out of retries |

**Final run, per sentence** (plans saved in this worktree's `data/scenes/`, gitignored):

| sentence | calls | result |
|---|---|---|
| 2 bins, 3 cubes stacked in a pile, put the red one in the left bin | 3 | valid: pile at (0.50, 0), bins at y ±0.165, red on top → left (+y) bin |
| one red cube and one blue bin; put the cube in the bin | 2 | valid |
| a green cube on the right and a yellow cube on the left; both go into one big bin far from the robot | 2 | valid: green at y −0.215 (right), yellow at +0.215, a 30 cm bin at x 0.60 |
| three bins in a row (red, green, blue) and a cube of each colour in front of them; sort every cube… | 4 | **invalid**: 5 → 4 → 1 problems; it fixes one hint at a time and makes a new clash |
| a tower of 6 cubes next to a bin; move the whole tower into the bin, top cube first | 2 | valid: 6 cubes of 4.1 cm (top 0.246 m), goals top-down |

**What I read from it:**
- Left and right are followed correctly.
- Nemotron uses the numeric hints well: every 1–2-problem plan was fixed in one retry.
- It's weak at fitting many objects at once. The 3-bin row is feasible: a test lays it out at 3 cm gaps, with bins
  at x 0.60, y −0.25 / 0 / 0.25 and cubes at x 0.42.
- **Options for the row case** (not done): more retries, `think=True` on retries, or a code-side nudger that
  applies the suggested moves itself and only asks the model when the moves conflict.
- **Watch for silent changes.** Run 2's tower dropped a cube, which changes what the user asked for. The size
  hint fixed this case, but nothing checks that the plan keeps the sentence's counts. Nemotron could be asked to
  confirm the counts, or the CLI could print them for the user to approve.

## Plan for the Isaac part (not run tonight)

### 1. `sim_worker/scene_cfg.py` for N cubes and M bins

- **Bin parts.** `BIN_PARTS` is a module constant for one `BIN_INNER` bin. Make it `bin_parts(inner, wall)`, and
  keep the constant as `bin_parts(BIN_INNER, BIN_WALL)` for today's callers.
- **Build from a plan.** Add `make_scene_cfg(cameras, robot, plan: ScenePlan | None = None)`. With a plan, `setattr`
  one entry per object on the cfg instance; `_use_flexiv` and `_use_openarm` already add contact sensors this way.
  - **Cubes:** a `RigidObjectCfg` per cube at `{ENV_REGEX_NS}/Cube_<id>`, `size=(s,)*3`, colour from
    `scene_plan.COLORS`. Use mass `0.1 * (s / 0.05)**3` (today's density) and the same friction 1.0.
  - **Bins:** 5 kinematic boxes per bin, named `bin_<id>_floor`, `bin_<id>_wall_px`, and so on.
  - **Default.** With no plan, keep today's `cube` and `bin_*` names, so replay, teleop, eval and the
    parallel env don't change. A one-cube plan goes through `to_scene()` as now.
- **Contacts.** PhysX filtered contacts need one sensing body per sensor.
  - Per cube: a sensor against the fingers.
  - Per bin: 5 sensors against the arm bodies, so 5·M bin sensors.
  - `ARM_CONTACT_SENSORS` becomes a function of the plan.
  - If 5·M sensors gets slow, try a bin as one rigid body with 5 collision shapes (untested).
- **Robots.** `_use_flexiv` and `_use_openarm` rebuild `cube_contact` and the bin contacts by name. They need to
  loop over the plan's objects instead.

### 2. Placement

- **`place_scene`.** Today it puts the robot, `"cube"` and the 5 bin parts. Generalize it to place every object at
  `resolve(plan)` poses, with yaw quats converted to Isaac's xyzw at the boundary as now.
- **Stacked cubes.** Spawn them 0.5 mm above their support so they don't start interpenetrating. The settle step
  drops them that last 0.5 mm.

### 3. The settle check, with feedback to Nemotron

- **New `sim_worker/settle.py`:**
  - build the scene headless, with no cameras;
  - place everything, with the robot at its start pose and its gripper open;
  - step 1 s of physics;
  - read every cube's root pose before and after.
- **New pure `demo_pipeline.scene_plan.settle_problems(plan, before, after)`**, unit-testable without Isaac. It
  returns readable lines like "cube_red slid 12 mm and tilted 31° in 1 s: the stack under it isn't stable" or
  "cube_b fell off cube_a (dropped 48 mm)". Draft thresholds, to tune on the first runs:
  - moved > 5 mm;
  - tilted > 5°;
  - z dropped by more than half the cube's size: "fell".
- **Feedback.** Add an optional `extra_check: Callable[[ScenePlan], list[str]]` to `plan_from_text`. It runs after
  `validate_plan` passes, and its lines go back to Nemotron in the same retry loop. The CLI gets `--settle`, which
  calls the sim worker over HTTP like the other sim jobs.
- **GPU rules.**
  - Take `gpu.lock`.
  - Never run it alongside another renderer.
  - Disable sleep for long batches.
- **Startup cost.** Isaac takes tens of seconds to start, so keep one settle worker alive across retries instead
  of starting it per call.

### 4. After that (out of scope for the first Isaac run)

- **`SimSignals`.** Its `cube_pos` is one track. It becomes one track per cube, and `check_success` checks each
  goal's cube in its own bin.
- **Recording.** Teleop and record would load a saved plan (`DATA_DIR/scenes/<id>.json`) and record one demo per
  goal or one demo for all goals. Decide which before building.
- **Cameras.** The front camera's aim (`FRONT_EYE` / `FRONT_TARGET`) may need to see three bins across y ±0.36 m.
  Check one render.
