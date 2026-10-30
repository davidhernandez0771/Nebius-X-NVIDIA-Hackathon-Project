# Failure analysis

29 unseen-scene episodes, 13 succeeded, 16 failed.

> **No traces:** 29 episodes come from the eval's result rows only (scene, reason codes, where the cube ended). Their class comes from the reason codes, and there are no grasp or motion measurements, so the contrast table below is empty for them.

| first failure | episodes |
|---|---|
| dropped | 16 |

## Failed vs successful episodes (measured)

| feature | median, failures | median, successes | effect (+ = higher in failures) | p | n fail / ok |
|---|---|---|---|---|---|
| grasp_offset_xy | – | – | – | – | 0 / 0 |
| grasp_height | – | – | – | – | 0 / 0 |
| n_closes | – | – | – | – | 0 / 0 |
| carry_speed_median | – | – | – | – | 0 / 0 |
| carry_speed_max | – | – | – | – | 0 / 0 |
| max_lift | – | – | – | – | 0 / 0 |
| held_s | – | – | – | – | 0 / 0 |
| t_first_close | – | – | – | – | 0 / 0 |
| min_reach_dist | – | – | – | – | 0 / 0 |

Code alone (p ≤ 0.05, |effect| ≥ 0.2): no measured difference is that clear.

## Nemotron's recipe

3 of 3 samples gave a valid recipe; the consensus one agrees with the others at 1.00 (0 = no overlap, 1 = identical). 3 calls, $0.0187, nvidia/nemotron-3-super-120b-a12b.

_Most failures are drops occurring when the cube is on the robot's right side (negative cube_y) and the bin is on the robot's left side (positive bin_y)._

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| right_cube_left_bin | 10 | 8 / 16 | 50% | 0.80 vs 0.55 | 0.0579 |

- **Hypothesis:** Drops cluster where cube_y < -0.067 m and bin_y > 0.1 m (seeds 5505, 5512, 5514)

| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| right_cube_left_bin | dropped | 0.40 | 0.40–0.60 | -0.20–-0.07 | -45–45 | 0.40–0.65 | 0.10–0.30 |
| uniform | | 0.60 | full range | | | | |

- **right_cube_left_bin:** This region contains 11 of the 16 dropped episodes versus only 3 successes, showing a significantly higher failure rate.

## Rules baseline

_rules baseline: 16/29 episodes failed first by dropped_

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| rules_dropped | 29 | 16 / 16 | 100% | 0.55 vs 0.55 | 1 |


| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| rules_dropped | dropped | 0.70 | 0.40–0.60 | -0.20–0.20 | -45–45 | 0.40–0.64 | -0.30–0.30 |
| uniform | | 0.30 | full range | | | | |

- **rules_dropped:** bounding box (padded) of the 16 scenes whose first failure was dropped

## Next

Multiply the same source demos into scenes_nemotron, scenes_rules and scenes_uniform (MultiplyRequest.scenes), train one policy per arm with identical settings, and evaluate all three on the same unseen seeds that none of this analysis used.
