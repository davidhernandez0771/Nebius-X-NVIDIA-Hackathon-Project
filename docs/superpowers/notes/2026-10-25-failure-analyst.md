# Nemotron as the failure analyst, and the label-execution check (2026-10-25, branch `susana/nemotron-analyst`)

Built on a Mac, tests first where it mattered, no GPU. Nothing here has run on Isaac.

**Update 2026-10-26: merged with David's 10-25 push (pm/live-13 2b7e138, pm/bigtest c6bae0a, pm/held-human ac6a8c1),
not committed.** The big test scored **30/40** (Wilson 0.60–0.86, seeds 5400–5439). Nemotron has now run on that model's
real results (section 1b). The label-execution question in section 2 is answered by David's held-human run.

## 1. The failure analyst

**What it is for.** The README's own finding: Nemotron as a judge lost to code, and as a repairer it was not
significantly better than the rules. This gives it a job where code supplies the numbers and the model supplies the
pattern: read how a trained policy failed, and decide what data to make next. Every claim it makes is checked against
the measurements, and problems go back to it with the numbers (the scene creator's loop).

**Pipeline.**
1. `demo_pipeline/failure_features.py`: one episode's step trace (`run_eval --trace`) → measurements (reach, grasp
   offset and height, lift, closes, carry speed, hold time, forces) and a failure class by rules: missed_reach,
   missed_grasp, no_lift, dropped, collision_table, collision_bin, release_outside, high_release, stuck. The primary
   class is the earliest event.
2. `demo_pipeline/data_recipe.py`: what Nemotron writes and how code checks it:
   - **regions** (scene boxes with a share of the new scenes). Each must hold ≥ 3 of its target failures at a rate
     clearly higher than outside it (one-sided Fisher p ≤ 0.1), so a box drawn around chance is rejected;
   - **mechanism** claims (a measured feature, higher or lower in failures). Each must match the contrast table
     (Mann–Whitney, |rank-biserial| ≥ 0.2);
   - **fixes** from a fixed menu: `filter_training`, `recenter_grasp`, `slow_carry`, each acting on a claimed
     mechanism, with settings in range;
   - a uniform share ≥ 0.2, so a wrong diagnosis can't take the whole dataset;
   - plus a code-only baseline (`rules_recipe`, `rules_mechanism`) to compare Nemotron against.
3. `app/ai/failure_analyst.py`: `analyse()` asks k = 3 times independently and keeps the recipe the others agree with
   most. That answers the run-to-run variance seen in the repair A/B. An API outage costs one sample, not the run.
4. `scripts/analyze_failures.py`: eval results (`.json` or `.episodes.jsonl`) + traces → features, contrast table,
   both recipes, `scenes_{nemotron,rules,uniform}.json`, `report.md`. It refuses the test seeds 5020–5059 unless
   `--protect none`, and then marks the report post-hoc.
5. `scripts/run_human_demo_experiment.py --scene-recipe <recipe.json>`: variant scenes from the recipe for the same
   seeds (`recipe_scene`). The recipe is frozen in `config.json` with its sha256 and stated in `preregistration.md`.
   `MultiplyRequest.scenes` does the same for the sim worker's `/multiply`.

**Live runs (Nemotron 3 Super via Token Factory, synthetic traces).**

| Planted pattern | Before the checks | After the checks |
|---|---|---|
| Drops iff bin y < −0.1 (13/30) | One region holding **1 of 13** drops; evidence seeds copied from the prompt's example | 2 of 3 samples: bin y −0.3 to −0.1, **13/13** drops; the third (3/13) lost the consensus. $0.015 |
| Drops depend on carry speed, not the scene (14/40, overlapping) | All 3 samples added a chance scene region | Chosen recipe: no region, mechanism `carry_speed_max` higher in failures, fix `slow_carry` 0.4 m/s; one chance region (p = 0.22) sent back and dropped. $0.026 |

### 1b. On real results: the big test's final model (2026-10-26)

The final model's traces (`bigtest_final_traces`) are on David's machine, not in git. `--results-only` builds each
episode from its committed result row instead: the scene, check_success's reasons, and where the cube ended. The grasp
and motion measurements are missing, so only scene regions can be checked, and "keep the data as it is" is now a valid
answer (`validate_recipe(allow_no_change=True)`).

```
uv run python scripts/analyze_failures.py --results-only --protect none --out data/analysis/bigtest_final \
  --eval docs/superpowers/notes/2026-10-23-bigtest/results/stageA_selection/distill_r0_s180000.episodes.jsonl \
  --eval docs/superpowers/notes/2026-10-23-bigtest/results/final_test/bigtest_final.episodes.jsonl
```

- **Input:** 69 episodes of the one final model (Stage A 180k): selection 5500–5528 and the test 5400–5439, post-hoc.
  51 succeeded. The 18 failures are 17 dropped and 1 collision.
- **Nemotron** (3 samples, 5 calls, $0.043, agreement 0.83):
  - Two samples gave one region: cube y 0.07–0.20 (left), bin y −0.30 to −0.10 (right), a cross-body carry.
    It holds 10 of the 17 drops, a rate of 0.34 inside vs 0.18 outside, **p = 0.092**, just under the 0.1 bar.
  - The third sample had two regions sent back (p = 0.175 and 3 drops short). It then answered "no clear
    scene-dependent pattern".
  - The rationale text's "~0.42 vs ~0.16" is the model's own figure and is wrong. The checked numbers are above.
- **Held-out check** (scratch script, not in the repo): the five other checkpoints' selection evals, which the
  analysis never saw. Inside the region the drop rate was 41/66 (0.62), outside 40/79 (0.51). The direction holds in
  4 of 5 checkpoints, p = 0.11. Those evals reuse the same 58 seeds, so even that p is optimistic.
- **Verdict:** a weak lead, not a finding. It agrees with the distill note that no scene feature clearly predicts
  success. The rules baseline's box holds 56 of 69 scenes, so it says nothing either. What causes the drops (grasp,
  carry speed, release) needs the traces.

**Not built yet:** applying the fixes. `slow_carry`, `recenter_grasp` and `filter_training` are diagnosed and checked
but not applied by any pipeline. Only the scene regions reach the data today.

## 2. The label-execution check (the research report's top hypothesis)

**Answered by David's held-human run (2026-10-23, `2026-10-23-held-human.md`); the GPU run below is no longer needed.**
- Re-executing the 110 SANT mouse episodes through the held executor kept 0/110, and the k = 2 pilot with a grasp
  wait kept 0/22.
- A held step closes only about 9% of the tool-to-target gap, so the human paths run far ahead of the tool.
- So the SANT human labels do not execute under the policy's executor. That is the mismatch this check was built to
  find.
- `check_label_execution.py` stays as a tool. For example, it can check a k = 5 held-human set before training on it.

`sim_worker/replay.py` verifies a demo with IK at each substep plus velocity feed-forward (`vel_ff`, "26.8 → 2.1 mm").
The exported label is the last substep's joint target, and `sim_eval/isaac_env.py` holds it with no feed-forward.
The RL teacher's labels failed exactly this way (10/10 tracking vs 0/10 held). The SANT human cell has not been
checked. `sim_eval/label_check.py` plus `sim_eval/scripts/check_label_execution.py` replay an episode's own labels,
open loop, in the eval env from its own start pose, and score them with the eval's `check_success`. They also report
the fingertip drift from the verified path (mean, max, at the first close).

## Commands for the GPU machine

```powershell
# (a) optional now (section 2 is answered): do a cell's labels execute under the policy's executor?
C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\check_label_execution.py --headless `
    --episodes "<the perfected_multiply_10 cell's episode folders>\*" --out C:\dev\pm-data\label_check\mouse_pm10.json
#     --limit 10 first for a quick look. The verdict line says whether the executor is the problem.

# (b) on any machine, no GPU: the big test's 10 failures with their traces (its 30/40 stands as run)
uv run python scripts/analyze_failures.py --protect none --out data\analysis\bigtest_traced `
    --eval <evals dir>\distill_r0_s180000.episodes.jsonl --eval <evals dir>\bigtest_final.episodes.jsonl
#     each needs its <name>_traces\ folder next to it. Any change it suggests is judged on fresh seeds.

# (c) the A/B, judged on fresh seeds: never sim_eval.distill_round.EVAL_ONLY_SEEDS (5020-5059, 5300-5439,
#     5500-5557) and not the DAgger seeds 5210-5249:
uv run python scripts/run_human_demo_experiment.py --name mouse_recipe --tag "<the mouse demos>" --input mouse `
    --scene-recipe data\analysis\<run>\recipe_nemotron.json --eval-seed0 <fresh seeds> ...
#     against the same command without --scene-recipe (the uniform control), the same seeds and settings.
```

## Checks

- 72 new tests: `tests/test_failure_analyst.py` 61, `sim_eval/tests/test_label_check.py` 9, and 2 in
  `tests/test_run_human_demo_experiment.py`. The script refuses both test sets by default (5020–5059 and 5400–5439). Mann–Whitney and Fisher are checked against scipy values, and Wilson
  against the distill note's 0.242–0.530.
- Full suite on macOS after the merge: 2824 passed, 72 skipped, 6 failed. The 6 failures also fail without these changes:
  `test_launch_health` ×2 and `test_set_v2_is_frozen` need the Windows machine and its data, and `test_sim_homeset`
  ×3 compare floats bit-for-bit, which differ in the last digit on Apple silicon.
