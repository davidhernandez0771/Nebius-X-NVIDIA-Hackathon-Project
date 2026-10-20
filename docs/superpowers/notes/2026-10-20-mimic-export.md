# SANT → Isaac Lab Mimic: the export and the env (`pm/mimic-export`, 2026-10-20)

From `pm/live-11` (`0cc6e9d`). Code only, no GPU: Isaac never started. Not pushed or merged.

**The pitch:** Mimic (the engine of NVIDIA's GR00T-Mimic blueprint) multiplies *good* teleop demos; SANT makes
*bad* human demos good first. This exporter is the hand-off: SANT's verified, perfected demos written as a Mimic
source dataset.

## What Mimic reads (learned from the code on disk, no downloads)

Read in `C:\isaac\IsaacLab`: git `6bfde8760`, repo VERSION 3.0.0, `isaaclab_mimic` 2.0.12.
- `isaaclab/utils/datasets/hdf5_dataset_file_handler.py`, `episode_data.py`: the file layout.
- `scripts/imitation_learning/isaaclab_mimic/annotate_demos.py`: what annotation adds.
- `isaaclab_mimic/datagen/datagen_info_pool.py`, `datagen_info.py`, `data_generator.py`: what generation reads.
- `isaaclab_mimic/envs/franka_stack_ik_{rel,abs}_mimic_env*.py`: the Franka examples.
- `isaaclab/envs/manager_based_rl_mimic_env.py`.

**The file:** Isaac Lab's HDF5 dataset.
- Root attribute `format_version = 1`, meaning **xyzw quaternions**. This checkout reads every quaternion
  as (x, y, z, w) (`isaaclab.utils.math`). Some docstrings in the Mimic envs still say w, x, y, z; the code
  is xyzw.
- `data/` has `total` and `env_args` (`{"env_name": <gym id>, "type": 2}`).
- One `data/demo_N` per demo, with `num_samples`, `success` and `seed`.

**Per demo:** `actions [N, A]`, `initial_state/...` (InteractiveScene.get_state at reset), `obs/...`, and the
annotation that `annotate_demos.py` records before each step:

| `obs/datagen_info/…` | shape | meaning |
|---|---|---|
| `eef_pose/<eef>` | [N, 4, 4] | the end effector before each step |
| `target_eef_pose/<eef>` | [N, 4, 4] | the pose each action asks for (`env.action_to_target_eef_pose`) |
| `object_pose/<object>` | [N, 4, 4] | each object before each step, env frame |
| `subtask_term_signals/<signal>` | [N] bool | 0 until that subtask is done, 1 after |

`DataGenInfoPool` cuts each demo at the first 0→1 edge of each subtask's term signal: the end is that index
+ 1, and the last subtask runs to the end. It checks that a subtask's end plus its largest offset falls before the
next subtask's end. Generation reads an object's pose only at a subtask's start, and the gripper from
`env.actions_to_gripper_actions`.

## What SANT writes

`annotate_demos.py` replays each demo in the Mimic env to record the table above. SANT already has all of it for
a verified episode, so the export writes the **annotated** file directly (no annotation pass is needed).

| Mimic | from SANT |
|---|---|
| `actions` [N, 8] | `trajectory.json` (the commanded tool path): tool pos (3), tool quat **xyzw** (4), gripper **+1 open / −1 close** (Isaac's BinaryJointPositionAction closes on < 0) |
| `target_eef_pose/franka` | the same commanded poses, 4×4 |
| `eef_pose/franka` | `steps.npz` reached tool pose, shifted one step so it's *before* each step (the commanded start for step 0) |
| `object_pose/cube` | `signals.npz` cube track; rotation held at `scene.json`'s start rotation (SANT tracks position only) |
| `object_pose/bin` | `scene.json` bin pose, constant |
| `subtask_term_signals/grasp` | on from the first step `robota.phases` says the cube is lifted (carry or place) |
| `subtask_term_signals/place` | on from the first release after that (exported for completeness; the last subtask needs none) |
| `initial_state` | robot (base at the origin, first joint positions) and every rigid object of SANT's Franka scene (`cube`, `table`, the five bin boxes, posed round the bin frame), zero velocities: `reset_to` needs them all |
| `obs/{eef_pos, eef_quat, joint_pos, cube_pos}` | low-dimensional observations, before each step |
| attributes `sant_demo_id`, `sant_lineage`, `sant_repairs`, `sant_verification` | provenance (Isaac's reader ignores them) |

- **Subtasks** (`demo_pipeline.mimic.SUBTASKS`, also in the file's `data.attrs["sant"]`):
  1. `grasp`, relative to `cube`, term signal `grasp`, offsets (10, 20);
  2. `place`, relative to `bin`, no term signal.
- **Frame.** The "tool" is SANT's fingertip centre: `panda_hand` + 0.1034 m along z, not rotated for the
  Franka. That is the same point as the Isaac stack task's `end_effector` frame.
- **Which demos** (`--select sources`, the default): verified, not one of SANT's multiplied variants, and the
  commanded path starts at the robot's home tool pose (within 1 cm and 0.05 rad; `sim_worker.scripted.HOME_TCP`).
  Mimic resets the robot there. `--select all` adds SANT's verified variants.

**Code:**
- `src/demo_pipeline/mimic.py`: the conversion and `check()`, pure numpy.
- `scripts/export_mimic.py`: picks the demos from a store and writes the file.
- Tests: `tests/test_dp_mimic.py`, `tests/test_export_mimic.py` (fixture: `tests/mimic_episode.py`).

## Run it

```
C:\isaac\env_isaaclab\Scripts\python.exe scripts\export_mimic.py --store C:\dev\pm-t6\data\human_exp\human10c\store --out data\exports\mimic\human10c_sources.hdf5
```

It needs **h5py**. SANT's venv doesn't have it, and adding it would be a new dependency (needs an OK), so it runs
with Isaac Lab's Python. That Python has h5py, numpy and pydantic; nothing starts and the GPU is untouched.

**Result on human10c** (output gitignored under `data/exports/mimic/`):

| select | demos | steps | grasp → place boundary |
|---|---|---|---|
| sources | **3**: the 3 repaired human demos (9f47, a029, c045), each re-homed (`_rules_home`) | 1,219 | 194/368, 213/416, 224/435 |
| all | 27 (the 3 + SANT's **24** verified variants) | 11,313 | |

Spot checks on the 3 sources:
- At the grasp flag the gripper is closed, the cube is 1.1–1.2 cm off the table, and the tool is 1.6–2.0 cm
  from the cube's centre.
- Commanded vs reached tool: 0.38–0.39 cm on average, 1.7 cm at most.
- All 3 start at (0.45, 0, 0.35).
- Mimic's `DataGenInfoPool` loads both files and splits every demo into grasp then place.

## What the export's tests check

- Isaac Lab's own `HDF5DatasetFileHandler` reads the file: env name, demos, not the legacy quaternion format,
  `success`, the datagen_info keys.
- Mimic's own `DataGenInfoPool` gets the subtask boundaries we expect. `isaaclab_mimic` isn't installed in
  Isaac's Python; the test adds `C:isaacIsaacLabsourceisaaclab_mimic` to the path (`ISAACLAB_MIMIC_SRC`
  overrides it).
- The pool's env is a stub with the two things it calls: the subtask configs and `actions_to_gripper_actions`.
- `--noconftest` under Isaac's Python, because tests/conftest.py needs FastAPI.
- Commands and counts for every test: "Tests", below.

## Does Mimic run on Windows? (checked on disk, 2026-10-20, no GPU)

**Short answer:** NVIDIA supports it on Linux only. Nothing in the path SANT uses is Linux-only, though: every
module the generator needs imports on this PC. Only a GPU smoke test will prove it runs.

- **What says "Linux-only":**
  - `docs/source/features/imitation-learning/teleop_imitation.rst`: "Isaac Lab Mimic is only supported on
    Linux."
  - `humanoids_imitation.rst`: Mimic and Pink IK tasks are Linux-only, because "Pink IK and its dependencies are
    not available on Windows". That's the humanoid (GR1T2) path, not ours.
  - So T7's README is right about the support statement. It is not a statement that the code breaks on Windows.
- **What the code says:**
  - Mimic's changelog 1.0.7: GR1T2 was moved out "to prevent import of pinocchio when not needed. This allows
    use of IsaacLab Mimic in windows."
  - Changelog 1.2.4 pins h5py 3.15.1 "to prevent package import errors on Windows with version 3.16.0". This
    PC's Isaac venv has h5py 3.16.0, and it writes and reads our files fine, so that error didn't show here.
- **The installer:**
  - `pyproject.toml`'s `mimic` extra installs `isaaclab-mimic` and `isaaclab-teleop` on every platform.
  - Only these are gated to Linux:
    - `robomimic` (policy *training*, not generation);
    - `isaacteleop` (XR);
    - `dex-retargeting`;
    - Pink IK / pinocchio.
  - cuRobo is only imported with `--use_skillgen`.
- **The generation path:** `generate_dataset.py`, `datagen/generation.py`, `data_generator.py` and
  `waypoint.py` use only asyncio, torch, gymnasium and h5py. There is no fork, no POSIX signals and no `/dev` path.
- **Tried here (CPU, no app), in `C:\isaac\env_isaaclab`:** all of these import fine:
  - `isaaclab_mimic` (with its warp shim);
  - `ManagerBasedRLMimicEnv`, `MimicEnvCfg`;
  - `isaaclab_mimic.datagen.generation`;
  - Mimic's env registrations;
  - SANT's `scene_cfg`;
  - this env's config.
- **What would break on this PC as it stands:**
  - **`isaaclab_mimic` is not installed** in `env_isaaclab`, so `generate_dataset.py` would fail on
    `import isaaclab_mimic`.
    - Workaround with no install: put `C:\isaac\IsaacLab\source\isaaclab_mimic` on `PYTHONPATH`; it is pure
      Python. Shown to work above.
    - The proper fix: `isaaclab.bat -i mimic`. That's an install (it also brings `isaaclab_teleop` and
      ipywidgets), so it needs the user's OK.
  - **`--headless` doesn't exist** in this Isaac Lab (headless is the default; `--viz kit` opens a window).
    With our callback returning None, an unknown flag is a hard error. The command in this note's first draft
    had it; it's fixed below.
- **If the smoke test fails for a Windows reason:**
  - WSL2 with Ubuntu, Isaac Lab installed there, using the same exported file;
  - or Docker (Isaac Lab ships `docker/`);
  - or compare our multiplier to Mimic's method on paper. Both transform source segments by the object's pose
    change. Mimic also interpolates between segments, picks a source per subtask by nearest object pose, and
    adds action noise. SANT re-verifies each variant with physics.

## The SANT Mimic env (built; not run)

`sim_worker/mimic_env.py`, registered by `sim_worker/mimic_register.py` (`--external_callback
sim_worker.mimic_register.register`; it registers by name only, so nothing heavy loads before the app).
`SANT-PickPlace-Franka-IK-Abs-Mimic-v0` (`demo_pipeline.mimic.ENV_NAME`, also the export's env name):

- **Scene:** `make_scene_cfg(cameras=False)`: Franka high PD, cube, the five bin boxes, table. Its rigid
  objects are exactly the export's `initial_state` names (tested), so `annotate_demos` can `reset_to` our files.
  The export now writes all seven: cube, table, five bin boxes, posed from the bin frame.
- **Action:** `DifferentialInverseKinematicsActionCfg(body_name="panda_hand", pose, absolute,
  body_offset=(0, 0, 0.1034))` + `BinaryJointPositionActionCfg` (fingers 0.04 open / 0.0 closed).
  50 Hz: dt 0.01, decimation 2. Episodes are 30 s (check_success's limit).
- **Observations:**
  - `policy`: `eef_pos`/`eef_quat` (the tool centre: the hand pose plus the offset, env frame), `joint_pos`,
    `cube_pos`, `actions`.
  - `subtask_terms`: `grasp`.
- **Mimic methods:**
  - `get_robot_eef_pose` (from the tool observations);
  - `target_eef_pose_to_action` / `action_to_target_eef_pose` ([pos, quat xyzw, gripper]). Noise jitters the
    position and turns the target by a small random rotation, so quaternions stay unit;
  - `actions_to_gripper_actions` (the last column);
  - `get_object_poses` → `cube` and `bin` (the bin frame from the floor box);
  - `get_subtask_term_signals` → `grasp`.
- **Success, per step** (`sant_success` → `mimic.placed`, shared with SANT and tested against `check_success` on
  40 random cube positions): the cube's centre in the bin's inner box, the cube slower than 0.01 m/s, and the
  last gripper command open.
  - Mimic counts a generated demo as a success at the first step this holds.
  - check_success's **history** checks can't be one step's state: collision > 5 N, drops, high release,
    unreachable.
  - So **re-verify Mimic's output with SANT** before calling any of it verified.
- **Reset:** `reset_scene_to_default` (robot at its default joints), then `reset_sant_scene`, which samples the
  cube and bin as SANT does (`multiply.sample_scene`: SANT's Franka ranges, 0.15 m apart) and places the bin
  boxes round the bin.
- **Datagen:**
  - as Isaac's Franka IK-abs stack task: select a source per subtask, `nearest_neighbor_object` (k = 3);
  - action noise 0.01;
  - 5 interpolation steps;
  - keep failed demos (in a separate file).

## GPU smoke test (later; not run). Take the GPU lock first

Read `C:\dev\gpu.lock`, as `sim_worker/gpu_lock.py` describes: wait while it names a live process, then write your
own line and delete it when done. PowerShell, from anywhere:

```
$env:PYTHONPATH = "C:\dev\pm-t2;C:\dev\pm-t2\src;C:\isaac\IsaacLab\source\isaaclab_mimic"
C:\isaac\env_isaaclab\Scripts\python.exe C:\isaac\IsaacLab\scripts\imitation_learning\isaaclab_mimic\generate_dataset.py `
  --device cpu --num_envs 1 --generation_num_trials 10 --max_num_failures 30 `
  --input_file C:\dev\pm-t2\data\exports\mimic\human10c_sources.hdf5 `
  --output_file C:\dev\pm-t2\data\exports\mimic\smoke_10.hdf5 `
  --external_callback sim_worker.mimic_register.register
```

- `--task` defaults to the file's env name.
- `--max_num_failures` bounds the run if nothing succeeds: generation guarantee is on, so otherwise it would
  try forever.
- Add `--viz kit` to watch.
- **Pass:** it prints "10/N successful demos generated". `smoke_10.hdf5` holds the successes; the failures go
  to a separate file (`generation_keep_failed`).
- **Then:** replay them through SANT's verifier.
- **Optional cross-check of our annotation against Mimic's auto mode:** same `PYTHONPATH`, then
  `...\annotate_demos.py --auto --task SANT-PickPlace-Franka-IK-Abs-Mimic-v0 --input_file ...sources.hdf5
  --output_file ...reannotated.hdf5 --external_callback sim_worker.mimic_register.register`.
  - It replays our actions from `initial_state` and records Mimic's own `grasp` flags.
  - It fails a demo if the env's success never holds.

## Tests (the export and the env)

| where | command | result |
|---|---|---|
| SANT venv | `uv run pytest tests/test_dp_mimic.py tests/test_export_mimic.py tests/test_mimic_env.py` | 21 passed, 6 skipped (h5py; the env file needs Isaac Lab) |
| Isaac Lab's Python, CPU, no app | `set PYTHONPATH=.;src;C:\isaac\IsaacLab\source\isaaclab_mimic` then `C:\isaac\env_isaaclab\Scripts\python.exe -m pytest --noconftest -p no:cacheprovider tests\test_mimic_env.py tests\test_dp_mimic.py tests\test_export_mimic.py` | **44 passed** |

`test_mimic_env.py` (18 tests):
- **The config:**
  - action and offset;
  - 50 Hz and 30 s;
  - the scene's rigid objects equal the export's;
  - the export's bin and table poses equal `scene_cfg`'s;
  - subtasks;
  - terms.
- **The registration:** gym spec, and the config loads through `load_cfg_from_registry`.
- **Methods and terms on stand-in tensors:**
  - the tool pose from the hand pose;
  - action ↔ target round trip;
  - eef pose;
  - object poses;
  - success in 5 cases (placed / beside / above the rim / still falling / still held);
  - the grasp signal;
  - the reset sampler's ranges.

Nothing builds a simulation, so the IK, the physics, the events' writes to the sim and the managers' wiring are
**unverified until the smoke test**.

## Other gaps, honestly

- **Nothing has run in Isaac:** no generation, no annotation, no env instance.
- **The default joints:**
  - The robot resets to the Franka config's default joints, as SANT's replay does. Its tool pose may differ from
    `HOME_TCP`, which the sources start from.
  - Mimic interpolates from wherever the robot is to the first segment (5 steps), so a small gap is fine. A
    large one would show in the smoke test.
- **Approximations:**
  - The cube's rotation is its start rotation throughout. Mimic reads it at the grasp's start, where it is
    true. The place subtask references the bin.
  - Step 0's eef pose is the commanded start, not a measured reset pose. It's within 1 cm by the home check.
- **No camera images** are exported or observed (cameras off). Add them to the env if a visuomotor dataset is
  wanted.
- **Only 3 sources.** Isaac Lab's docs generate from "a handful of annotated demonstrations" (their humanoid
  examples record 5, SkillGen's 10). Whether 3 is enough for this task is untested.
