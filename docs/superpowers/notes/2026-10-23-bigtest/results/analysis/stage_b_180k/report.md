# Failure analysis

29 unseen-scene episodes, 8 succeeded, 21 failed.

> **No traces:** 29 episodes come from the eval's result rows only (scene, reason codes, where the cube ended). Their class comes from the reason codes, and there are no grasp or motion measurements, so the contrast table below is empty for them.

| first failure | episodes |
|---|---|
| dropped | 20 |
| collision | 1 |

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

3 of 3 samples gave a valid recipe; the consensus one agrees with the others at 0.89 (0 = no overlap, 1 = identical). 4 calls, $0.0220, nvidia/nemotron-3-super-120b-a12b.

_Failures are mostly drops when the cube is on the robot's left side (positive y) and the bin is on the robot's right side (negative y), indicating difficulty with cross-body carries._

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| cross_body_left_cube_right_bin | 14 | 12 / 20 | 60% | 0.86 vs 0.69 | 0.068 |

- **Hypothesis:** Drops cluster where cube_y > 0.067 and bin_y < -0.1 (cross-body configuration) (seeds 5530, 5533, 5535)

| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| cross_body_left_cube_right_bin | dropped | 0.50 | 0.40–0.60 | 0.07–0.20 | -45–45 | 0.40–0.65 | -0.30–-0.10 |
| uniform | | 0.50 | full range | | | | |

- **cross_body_left_cube_right_bin:** Dropped episodes occur much more often when the cube is left of centre and the bin right of centre.

## Rules baseline

_rules baseline: 20/29 episodes failed first by dropped_

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| rules_dropped | 29 | 20 / 20 | 100% | 0.69 vs 0.69 | 1 |


| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| rules_dropped | dropped | 0.70 | 0.40–0.60 | -0.20–0.20 | -45–45 | 0.40–0.65 | -0.30–0.30 |
| uniform | | 0.30 | full range | | | | |

- **rules_dropped:** bounding box (padded) of the 20 scenes whose first failure was dropped

## Next

Multiply the same source demos into scenes_nemotron, scenes_rules and scenes_uniform (MultiplyRequest.scenes), train one policy per arm with identical settings, and evaluate all three on the same unseen seeds that none of this analysis used.
