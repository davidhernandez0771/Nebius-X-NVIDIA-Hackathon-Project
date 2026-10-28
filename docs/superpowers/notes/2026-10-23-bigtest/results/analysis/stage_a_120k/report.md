# Failure analysis

29 unseen-scene episodes, 17 succeeded, 12 failed.

> **No traces:** 29 episodes come from the eval's result rows only (scene, reason codes, where the cube ended). Their class comes from the reason codes, and there are no grasp or motion measurements, so the contrast table below is empty for them.

| first failure | episodes |
|---|---|
| dropped | 12 |

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

2 of 3 samples gave a valid recipe; the consensus one agrees with the others at 1.00 (0 = no overlap, 1 = identical). 6 calls, $0.0358, nvidia/nemotron-3-super-120b-a12b.

_Most failures are drops that happen when the cube is on the robot's left side (+y) and the bin is on the robot's right side (‑y), with the cube positioned roughly in the middle of the workspace in x._

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| left_cube_right_bin | 5 | 5 / 12 | 42% | 1.00 vs 0.41 | 0.00667 |

- **Hypothesis:** Drops cluster where the cube is in the middle x range (0.467‑0.533 m), left of center in y (0.067‑0.2 m), and the bin is on the robot's right side (‑0.3 to ‑0.1 m) (seeds 5502, 5507, 5508, 5517, 5522)

| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| left_cube_right_bin | dropped | 0.60 | 0.47–0.53 | 0.07–0.20 | -45–45 | 0.40–0.65 | -0.30–-0.10 |
| uniform | | 0.40 | full range | | | | |

- **left_cube_right_bin:** Failure rate is markedly higher in this region (5/5 episodes failed) compared to the rest of the data (7/24 failed).

## Rules baseline

_rules baseline: 12/29 episodes failed first by dropped_

| region | episodes inside | its target failures inside | coverage | rate inside vs overall | p |
|---|---|---|---|---|---|
| rules_dropped | 24 | 12 / 12 | 100% | 0.50 vs 0.41 | 0.0521 |


| region | targets | share | cube x | cube y | yaw (deg) | bin x | bin y |
|---|---|---|---|---|---|---|---|
| rules_dropped | dropped | 0.70 | 0.42–0.59 | -0.20–0.20 | -45–39 | 0.41–0.60 | -0.30–0.30 |
| uniform | | 0.30 | full range | | | | |

- **rules_dropped:** bounding box (padded) of the 12 scenes whose first failure was dropped

## Next

Multiply the same source demos into scenes_nemotron, scenes_rules and scenes_uniform (MultiplyRequest.scenes), train one policy per arm with identical settings, and evaluate all three on the same unseen seeds that none of this analysis used.
