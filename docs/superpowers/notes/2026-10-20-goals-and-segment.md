# Multi-step goals and demo segments (`pm/goals`, 2026-10-20)

**What it's for:** the Nemotron scene creator's ScenePlans (`pm/scene-creator`) have several objects and ordered
goals ("cube X into bin Y"), but `check_success` judges one cube and one bin.

**What this adds:** two pure modules, numpy only, no GPU and no Isaac:
- `goals.py` judges any number of goals;
- `segment.py` splits a demo into steps.

Branched from `pm/live-11` (0cc6e9d). Nothing pushed, merged or rebased. `sim_worker`, `scene_cfg.py` and the web
app are untouched.

## `demo_pipeline.goals`

```python
from demo_pipeline.goals import Goal, SceneSignals, Container, ObjectTrack, check_goals, goals_from_plan

sig = SceneSignals(t, ee_pos, gripper, objects={"red": ObjectTrack("red", pos, gripper_contact), ...},
                   containers={"left_bin": Container("left_bin", pose, inner), ...},
                   arm_contact=..., max_contact_force=..., tcp_error=None)
# or today's one cube + one bin:
sig = SceneSignals.single(traj, sim_signals, bin_pose, bin_inner, tcp_error)   # ids "cube", "bin"

report = check_goals(goals_from_plan(plan), sig, ordered=True)   # or [Goal("red", "left_bin"), ...]
report.success, report.reasons                      # ("not_in_bin", "dropped", "out_of_order"), ...
for g in report.goals:
    g.state         # "done" | "not_done" | "dropped" | "out_of_order"
    g.reasons       # this goal's: not_in_bin, not_settled, dropped, high_release
    g.grasped_at, g.released_at, g.done_at, g.dropped_at, g.settle_time
```

**Per goal:**
- **done:** the object ends in its container. The test is check_success's in-bin test: inside the inner footprint
  in the container's frame, between its floor and its rim.
- **dropped:** not done, and it left the closed gripper off its container (check_success's `dropped`).
- **not_done:** not done, with no drop.
- **out_of_order** (`ordered=True`, the plan's "done in this order"): done, but a goal listed before it was done
  later, or never.

**Times (seconds):**
- `grasped_at`: the first step held in the closed gripper;
- `released_at`: the last step still in the fingers before an opening over its container;
- `done_at`: the first step of the final run in the container, i.e. when it fell below the rim;
- `dropped_at`: each step it fell out off its container.

**Whole demo:**
- the reasons above, plus `gripper_closed`, `too_slow`, `collision` (arm contact with a container or the table at
  more than `COLLISION_FORCE_N` = 5 N) and `unreachable` (IK residual over 2 cm for more than 1 s);
- every reason appears once, in check_success's order, with `out_of_order` last;
- `success` means no reasons.

**No new thresholds.** The defaults are check_success's. `COLLISION_FORCE_N` and the frame, settle and run helpers
are imported from `success.py`; "lifted" is `robota.LIFT_M`.

**Today's case is exactly today's check.** With one goal, `report.reasons` equals `check_success(...).reasons` (same
list, same order), so the verdict is the same. Tested three ways:
1. every test in `test_dp_success.py`, including its parametrized cases, is re-run with `check_success` wrapped so
   each call is compared;
2. a 400-case fuzz of the clean demo: random cube noise, contact flips, arm contacts and forces around 5 N,
   gripper-closed ends, bin offsets and yaws, and IK runs around 1 s. It reaches every reason;
3. 9 real episodes, one per verdict seen in the data.

**The real episodes:** first, all 214 verified episodes under `C:\dev\pm-t6\data` were checked. check_success on
the inputs saved with each one (`trajectory.json`, `signals.npz`, `scene.json`, and the IK residual rebuilt as
|steps.ee_pos − trajectory ee_pos|) gives the stored `verification.json` reasons for all 214. Then
`scripts/make_goal_fixtures.py` copied the shortest episode of each verdict into `tests/data/goals/*.npz`
(232 KB, read only from pm-t6; each file names its source). The verdicts covered:
- success;
- collision; collision + dropped; collision + unreachable;
- not_in_bin; not_in_bin + collision; not_in_bin + dropped; not_in_bin + collision + dropped;
  not_in_bin + collision + unreachable.

No real episode has `high_release` or `too_slow`; the fixtures and the fuzz cover those.

## `demo_pipeline.segment`

```python
from demo_pipeline.segment import segments, step_labels, describe

segs = segments(sig)    # [Segment(kind, start, end, obj, container)], contiguous, covering the demo
describe(segs)          # "grasp red 1.0 s -> missed -> regrasp red 2.6 s -> place left bin 4.7 s"
describe(segs, names={"red": "the red cube"}, verbose=True)   # every segment with its span
step_labels(sig)        # one Label(kind, obj, container) per step
```

**Kinds:**
- `reach`, `grasp(obj)`, `regrasp(obj)` (an object touched, missed or dropped before), `carry(obj)`;
- `place(obj, container)`: held over a container's inner footprint;
- `missed(obj)`: closed on nothing (the nearest object is named), or a slip before the lift;
- `drop(obj)`: a lifted object fell out off any container;
- `release(obj, container)`: 0.5 s, then reach, or to the end if no close follows.

**Reuse of robota:**
- the footprint test is `robota.in_bin_footprint`, which now takes the container's inner size (the default is
  unchanged, so robota's callers are untouched);
- "lifted" is `robota.LIFT_M`.

On one cube and one bin with one clean hold, `step_labels` is exactly `robota.phases`, step for step. That was tested
on the clean synthetic demo and on the real fixtures that have a clean hold.

**Real episodes read like this:**

| Verdict | Reading |
|---|---|
| success | grasp cube 2.0 s -> place bin 3.1 s |
| not_in_bin | grasp cube 1.6 s -> missed -> regrasp cube 2.6 s -> regrasp cube 3.4 s -> missed |
| collision + dropped | grasp cube 2.1 s -> missed -> regrasp cube 2.7 s -> … -> regrasp cube 5.9 s -> place bin 7.7 s |

**Two meanings of "drop":**
- the goal checker's `dropped` is check_success's: any loss of contact while closed, off the bin;
- the segmenter splits that into `missed` (it slipped before it was lifted) and `drop` (it fell after the lift).

So one `not_in_bin + dropped` episode is goal state `dropped` and reads "grasp cube 3.1 s -> missed".

## Fixtures and tests

- **`tests/goal_scenes.py`:** a scripted 50 Hz hand with cubes that follow it while held and fall onto a bin floor
  or the table. Scenes:
  - two cubes in order;
  - two cubes reversed;
  - three cubes with one dropped;
  - a miss then a regrasp;
  - a drop then a regrasp;
  - the wrong bin.
- **`tests/test_dp_goals.py`:** 44 tests. **`tests/test_dp_segment.py`:** 19 tests.
- **Full Python suite:** `uv run pytest`: 2050 passed, 15 skipped, 0 failed. That is 2015 for everything else
  plus 35 for `tests/test_launch_health.py`, run on its own because it takes 5 minutes; it passes.

## Not done

- **The sim worker still records one cube** (`SimSignals`). Multi-object `SceneSignals` come only from synthetic
  scenes until the sim records each object's position and gripper contact. `SceneSignals` is the shape that
  recording should fill.
- **`goals.py` doesn't import `scene_plan.py`,** which isn't on `pm/live-11`. `goals_from_plan` takes anything with
  `.goals` of `.object` / `.bin`, so it works on a `ScenePlan` once both are merged.
- **Stacking goals** ("on" another cube) and distractors that must stay put aren't checked: ScenePlan goals are
  only cube-into-bin.
