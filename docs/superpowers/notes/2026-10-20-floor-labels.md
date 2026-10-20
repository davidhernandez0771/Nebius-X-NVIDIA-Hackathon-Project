# Did the soft floor poison tonight's training labels? No (2026-10-20, pm/floor-labels)

**The question** (from the lead). In mouse20261020, raw_10 got 0/40 and perfected_multiply_10 got 3/40 (Fisher
p = 0.24). The SANT policy's failures were collision 27/40, dropped 26, gripper_closed 10 and not_in_bin 37; the
raw policy failed only not_in_bin (collision 2).

The hypothesis: the 10 demos were recorded with the soft floor holding the target up (27–135 steps each). If the
LeRobot `action` labels were the *unclamped* targets, below the floor, while the arm stayed above it, the policy would
learn to command into the bin or table and collide at eval, where there is no floor.

**Answer: no.** No training label in either dataset goes more than 3.7 mm under the soft floor. Neither label set
holds anything from before the clamp. The unclamped hand target is not stored anywhere. The collisions have another
cause; see "What next".

It was read-only on `data/` and used no GPU. Method: forward kinematics of the joint labels, with
`sim_worker.urdf_kin` and the Franka URDF the twin uses. Checked against the recorded joint positions → ee_pos it
matches to under 0.01 mm. Re-run it with `scripts/check_floor_labels.py` (added here, read-only).

## 1. What a teleop demo with the floor on stores

Code: `sim_worker/teleop_session.py` `step()`, and `teleop_isaac.py` `apply`/`read_state`.

- **The clamp.** The hand target is clamped to the floor, then smoothed for mouse and keyboard, then the smoothed
  command is clamped again. That clamped command is what `driver.apply()` gets.
- **`Demo.commanded`:** that clamped (smoothed) command, each step.
- **`Demo.trajectory`:** the pose the arm reached (`StepState.ee_pos`).
- **`steps.npz` `action`:** the joint targets the driver sent this step, which is the IK of the clamped command.
- **`steps.npz` `ee_pos`:** where the arm reached.
- **The unclamped hand target:** not saved anywhere.

Measured on the 10 live mouse takes (`data/demos/human_20261020*`), as mm relative to the floor:

| | min | frames > 1 mm under the floor |
|---|---|---|
| `commanded` (clamped command) | 0.0 | 0 in every take |
| FK of the live `action` | 0.0 | 0 in every take |
| reached (`trajectory` = `ee_pos`) | −2.5 to −3.7 | 15–23 per take; dc3e never touched the floor (+7.7) |

So the arm sags ~3 mm past the floor, but the command never does.

## 2. What the datasets train on

The training episodes are not the live recordings. `run_human_demo_experiment` replays each demo in the sim.
- **Which path it replays:** with `--replay-path achieved`, the default, it replays the **reached** path from the
  live `steps.npz`.
- **The episodes:** `align` makes `<id>_home` (raw) and `<id>_rules_home` (repaired). `multiply` makes
  `<id>_rules_home_m<seed>`.
- **The datasets:** raw_10 = the 10 `_home` episodes. perfected_multiply_10 = 10 `_rules_home` + the 100 variants.
  Checked from `manifest.json`.
- **The label** (`lerobot_tools/export.py`): `action` = the replayed episode's `steps.npz` `action`, the 9 joint
  targets. Verified: the parquet `action` equals `steps.npz` `action` exactly (max difference 0.0) for all 120
  episodes.

## 3. How far below the floor the labels go

Each episode is measured against its own scene's floor; variants have their own bin pose. Values are mm relative to
the floor.

| set (trained on) | episodes | min label (FK of `action`) | episodes with a label > 1 mm under | worst frames | min reached in the replay |
|---|---|---|---|---|---|
| `_home` (raw_10) | 10 | −3.7 | 9 | 23 | −9.0 |
| `_rules_home` (perfected) | 10 | −3.7 | 9 | 21 | −9.0 |
| variants `_m<seed>` (perfected) | 100 | −3.7 | 90 | 21 | −11.9 (7 episodes under −10) |

- **The labels:** they follow the replayed path, which is the live reached path. It already sits ≤ 3.7 mm under the
  floor.
- **The replay's own arm** dips a little deeper (up to 12 mm) as it tracks. That's tracking, not the label.
- **In the bin:** the floor is 1 cm under the rim (z 0.08). The lowest label is z ≈ 0.076, which puts the
  fingertip centre ~6.6 cm above the bin floor (0.01). No label commands into the bin or the table.

## 4. Do the 100 variants inherit it?

Only the same 3.7 mm, and nothing deeper: 90/100 have a few frames ≤ 3.7 mm under their own floor. Variants are
re-scened copies of the repaired paths, and the heights carry over.

## The minimal fix

None is needed for labels: "record the clamped command as the action" is already how both the live recorder and the
replay datasets work.

If a strict guarantee is wanted, the cheapest change is in `run_human_demo_experiment`'s achieved-path step: raise
the reached path to the floor before replaying, so no frame sits under it. That would move at most 3.7 mm on 15–23
frames per demo. I don't expect it to change tonight's result.

## What next (the real cause is still open)

- **What tonight's eval shows.** The SANT policy **grasps**: "dropped" on 26/40 means it held the cube and lost it.
  The raw policy never got that far, with 0 drops and 2 collisions. The collisions come with the reaching,
  grasping and regrasping, over a 30 s rollout.
- **Why it can't say more.** The eval kept only per-rollout reasons. There's no per-step contact, and no "against
  what" or "when".
- **The cheapest discriminating run** (GPU, so for T3/T4's slot): re-evaluate perfected_multiply_10 with
  `sim_eval/scripts/eval_cells.py --trace` on ~10 of the collision seeds. The traces hold per-step `contact_arm_bin` /
  `contact_arm_table`, `max_contact_force` and the tool path. They show whether the hits are the table during grasp attempts, the bin
  walls while carrying, or a push into the bin at release. `scripts/check_floor_labels.py`-style FK can then
  compare the policy's commands with the demo labels.
- **A floor-related effect worth one look.** With the floor on, every demo hovers at the rim floor for 0.5–2.7 s
  before releasing. The labels are near-constant there, against a pushing arm. A policy that learned "go to the
  rim and wait" would sit there harmlessly, so I don't think it explains collisions. But it's a distribution quirk
  the eval traces would show.
