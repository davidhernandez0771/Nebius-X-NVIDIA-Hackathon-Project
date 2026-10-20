# SANT → Isaac Lab Mimic export (`pm/mimic-export`, 2026-10-20)

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
| `initial_state` | robot (base at the origin, first joint positions), `cube`, `bin` root poses, zero velocities |
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

## Tests

- **SANT venv** (`uv run pytest tests/test_dp_mimic.py tests/test_export_mimic.py`): 16 passed, 5 skipped. The
  skipped tests need h5py.
- **Isaac Lab's Python, CPU only:**
  ```
  set PYTHONPATH=src
  C:\isaac\env_isaaclab\Scripts\python.exe -m pytest --noconftest -p no:cacheprovider tests\test_dp_mimic.py tests\test_export_mimic.py
  ```
  Result: **21 passed**. `--noconftest` because tests/conftest.py needs FastAPI.
  - Isaac Lab's own `HDF5DatasetFileHandler` reads the file: env name, 2 demos, not the legacy quaternion
    format, `success`, the datagen_info keys.
  - Mimic's own `DataGenInfoPool` gets the subtask boundaries we expect. `isaaclab_mimic` isn't installed in
    that Python; the test adds `C:\isaac\IsaacLab\source\isaaclab_mimic` to the path (`ISAACLAB_MIMIC_SRC`
    overrides it).
  - The pool's env is a stub with the two things it calls: the subtask configs and
    `actions_to_gripper_actions`. Nothing else of the env is exercised.

## Later, on the GPU (not run)

No annotation step: the file is already annotated. Once a SANT Mimic env is registered (below):

```
cd C:\isaac\IsaacLab
isaaclab.bat -p scripts\imitation_learning\isaaclab_mimic\generate_dataset.py ^
  --device cpu --num_envs 10 --generation_num_trials 100 ^
  --input_file C:\dev\pm-t2\data\exports\mimic\human10c_sources.hdf5 ^
  --output_file C:\dev\pm-t2\data\exports\mimic\human10c_mimic_100.hdf5 ^
  --external_callback <module>.<register function> --headless
```

- `--task` defaults to the file's env name, `SANT-PickPlace-Franka-IK-Abs-Mimic-v0`.
- `--external_callback` imports a function that registers the gym id. The env isn't in Isaac Lab, so this is
  how it gets in.
- `--device cpu` runs physics on the CPU, as the docs' example does, but Isaac Sim still starts: take the
  GPU lock.
- To check our annotation against Mimic's own auto-annotation, if the env implements
  `get_subtask_term_signals`:
  ```
  isaaclab.bat -p scripts\imitation_learning\isaaclab_mimic\annotate_demos.py --auto --task SANT-PickPlace-Franka-IK-Abs-Mimic-v0 --input_file ...sources.hdf5 --output_file ...reannotated.hdf5 --headless
  ```
  It replays the actions from `initial_state`.
- **Then the loop the pitch needs:** run SANT's own physics check (5 N contact, cube in bin) over Mimic's output.
  Mimic only checks the env's `success` term.

## What the SANT Mimic env needs (not written yet: the honest gap)

A `ManagerBasedRLMimicEnv` + `MimicEnvCfg` on SANT's scene (`sim_worker/scene_cfg.py`: Franka high PD, cube,
the five-box bin, table), registered as `SANT-PickPlace-Franka-IK-Abs-Mimic-v0`:

1. **Action:** `DifferentialInverseKinematicsActionCfg(body_name="panda_hand", controller=pose, use_relative_mode=False,
   body_offset=(0, 0, 0.1034))` plus a `BinaryJointPositionActionCfg` for the fingers (open 0.04, close 0.0).
   - Isaac's own IK-abs stack env has **no** body offset (it drives `panda_hand` itself). With our tool-frame
     actions that would land 10 cm off.
   - It must step at 50 Hz (physics dt 0.01, decimation 2), SANT's rate.
2. **Mimic methods:**
   - `get_robot_eef_pose`: the tool frame as 4×4 (xyzw).
   - `action_to_target_eef_pose` / `target_eef_pose_to_action`: [pos, quat xyzw] + gripper, as in
     `FrankaCubeStackIKAbsMimicEnv`.
   - `actions_to_gripper_actions`: the last column.
   - `get_object_poses`: must return `cube` and `bin`. The base class lists rigid objects, and SANT's bin is
     five boxes with other names, so override it to return the bin frame.
   - `get_subtask_term_signals`: only for `annotate_demos --auto`. `grasp` = closed and the cube ≥ 1 cm up.
3. **Config:**
   - `subtask_configs["franka"]` from `mimic.SUBTASKS`.
   - `datagen_config` as `FrankaCubeStackIKAbsMimicEnvCfg`'s.
   - A `success` termination: the cube in the bin, like SANT's check.
   - Reset events: randomize the cube (and bin) in SANT's ranges; robot at the home joints, whose tool pose
     is `HOME_TCP`.
4. **`initial_state`** names `robot`, `cube` and `bin`. Only annotation's replay (`reset_to`) uses it, so a
   five-box bin needs a rename or a one-body bin there. Generation doesn't read it.

## Other gaps, honestly

- **Nothing has run in Isaac:** no generation, no annotation, no env. The file is checked only by Isaac Lab's
  reader and Mimic's pool.
- **Approximations:**
  - The cube's rotation is its start rotation throughout. Mimic reads it at the grasp's start, where it is
    true. The place subtask references the bin.
  - Step 0's eef pose is the commanded start, not a measured reset pose. It's within 1 cm by the home check.
- **No camera images** are exported (SANT has front/wrist PNGs). Mimic's generated demos record whatever the
  env observes.
- **Only 3 sources.** Isaac Lab's docs generate from "a handful of annotated demonstrations" (their humanoid
  examples record 5, SkillGen's 10). Whether 3 is enough for this task is untested.
