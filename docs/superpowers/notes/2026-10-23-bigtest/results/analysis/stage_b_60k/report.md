# Failure analysis

29 unseen-scene episodes, 16 succeeded, 13 failed.

> **No traces:** 29 episodes come from the eval's result rows only (scene, reason codes, where the cube ended). Their class comes from the reason codes, and there are no grasp or motion measurements, so the contrast table below is empty for them.

| first failure | episodes |
|---|---|
| dropped | 12 |
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

3 of 3 samples gave a valid recipe; the consensus one agrees with the others at 0.69 (0 = no overlap, 1 = identical). 4 calls, $0.0197, nvidia/nemotron-3-super-120b-a12b.

_Most failures are drops occurring when the bin is placed farther to the robot's right (bin_x > 0.48). No grasp or motion measurements are available, so no mechanism can be inferred._

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| right_bin_side | 18 | 11 / 13 | 85% | 0.61 vs 0.45 | 0.0289 |

- **Hypothesis:** drops cluster where the bin is at x > 0.48 m (seeds 5531, 5538, 5542)

| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| right_bin_side | dropped, collision | 0.50 | 0.40–0.60 | -0.20–0.20 | -45–45 | 0.48–0.65 | -0.30–0.30 |
| uniform | | 0.50 | full range | | | | |

- **right_bin_side:** Failure rate for dropped/collision is markedly higher when the bin is placed on the robot's right side.

## Rules baseline

_rules baseline: 12/29 episodes failed first by dropped_

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| rules_dropped | 26 | 12 / 12 | 100% | 0.46 vs 0.41 | 0.186 |


| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| rules_dropped | dropped | 0.70 | 0.40–0.60 | -0.18–0.20 | -45–41 | 0.40–0.65 | -0.30–0.30 |
| uniform | | 0.30 | full range | | | | |

- **rules_dropped:** bounding box (padded) of the 12 scenes whose first failure was dropped

## Next

Multiply the same source demos into scenes_nemotron, scenes_rules and scenes_uniform (MultiplyRequest.scenes), train one policy per arm with identical settings, and evaluate all three on the same unseen seeds that none of this analysis used.
