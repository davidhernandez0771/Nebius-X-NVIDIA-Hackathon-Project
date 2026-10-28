# Failure analysis

69 unseen-scene episodes, 51 succeeded, 18 failed.

> **Post-hoc:** 40 of these are pre-registered test seeds (5400–5439). This is a diagnosis of a finished test. Any change it suggests must be judged on fresh seeds, never on these.

> **No traces:** 69 episodes come from the eval's result rows only (scene, reason codes, where the cube ended). Their class comes from the reason codes, and there are no grasp or motion measurements, so the contrast table below is empty for them.

| first failure | episodes |
|---|---|
| dropped | 17 |
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

3 of 3 samples gave a valid recipe; the consensus one agrees with the others at 0.83 (0 = no overlap, 1 = identical). 5 calls, $0.0425, nvidia/nemotron-3-super-120b-a12b.

_Most failures are drops when the cube is left of center and the bin is on the robot's right side._

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| left_cube_right_bin | 29 | 10 / 17 | 59% | 0.34 vs 0.25 | 0.0918 |

- **Hypothesis:** drops occur more often when cube_y > 0.067 and bin_y < -0.1 (seeds 5400, 5402, 5417)

| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| left_cube_right_bin | dropped | 0.40 | 0.40–0.60 | 0.07–0.20 | -45–45 | 0.40–0.65 | -0.30–-0.10 |
| uniform | | 0.60 | full range | | | | |

- **left_cube_right_bin:** failure rate in this region is ~0.42 vs ~0.16 elsewhere

## Rules baseline

_rules baseline: 17/69 episodes failed first by dropped_

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| rules_dropped | 56 | 17 / 17 | 100% | 0.30 vs 0.25 | 0.0164 |


| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| rules_dropped | dropped | 0.70 | 0.40–0.60 | -0.17–0.20 | -42–45 | 0.40–0.64 | -0.30–0.30 |
| uniform | | 0.30 | full range | | | | |

- **rules_dropped:** bounding box (padded) of the 17 scenes whose first failure was dropped

## Next

Multiply the same source demos into scenes_nemotron, scenes_rules and scenes_uniform (MultiplyRequest.scenes), train one policy per arm with identical settings, and evaluate all three on the same unseen seeds that none of this analysis used.
