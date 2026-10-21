# Coverage: `C:\dev\pm-t6\data\human_exp\mouse20261020\store`

| scene | in eval | takes | raw verified | repaired verified | verified takes | variants verified | swoops (takes) | frames in last 3 cm (takes -> verified) |
|---|---|---|---|---|---|---|---|---|
| S1 Standard | yes | 10 | 10 | 10 | 10 | 100 / 100 | 7 / 10 | 7.5 -> 7.5 |
| S2 Cube at the edge of reach | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S3 Bin turned, other side | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S4 Small cube | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S5 Large cube | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S6 Cube turned 35 degrees | yes | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S7 Yellow distractor | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S8 Taller bin | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |

**Eval distribution** (seeds 5020-5059, 40 scenes; pool 110 verified episodes): 18 of 40 eval scenes have a verified episode within 5 cm (cube), 8 cm (bin) and 15 degrees (cube yaw).

| axis | bins: eval scenes / verified episodes |
|---|---|
| cube x (m) | 0.4..0.45: 11/18, 0.45..0.5: 9/27, 0.5..0.55: 11/38, 0.55..0.6: 9/27 |
| cube y (m) | -0.2..-0.1: 11/28, -0.1..0: 3/13, 0..0.1: 9/26, 0.1..0.2: 17/43 |
| cube yaw (to its nearest face) (deg) | -45..-30: 4/19, -30..-15: 4/12, -15..0: 9/23, 0..15: 7/19, 15..30: 9/16, 30..45: 7/21 |
| bin x (m) | 0.4..0.45: 8/16, 0.45..0.5: 7/17, 0.5..0.55: 8/30, 0.55..0.6: 11/19, 0.6..0.65: 6/28 |
| bin y (m) | -0.3..-0.2: 20/40, -0.2..-0.1: 6/19, -0.1..0: 0/0, 0..0.1: 0/0, 0.1..0.2: 6/11, 0.2..0.3: 8/40 |

**Requests**

1. Record 2 more takes in S6 Cube turned 35 degrees.
2. Record 2 more takes in S2 Cube at the edge of reach because this is generalization only and not in the eval distribution.
3. Record 2 more takes in S3 Bin turned, other side because this is generalization only and not in the eval distribution.
4. Record 2 more takes in S4 Small cube because this is generalization only and not in the eval distribution.
5. Record 2 more takes in S5 Large cube because this is generalization only and not in the eval distribution.
6. Record 2 more takes in S7 Yellow distractor because this is generalization only and not in the eval distribution.
7. Record 2 more takes in S8 Taller bin because this is generalization only and not in the eval distribution.
8. Retake with a stop before closing or repair with --grasp-retime in S1 Standard where 7 of 10 takes close while still moving.
9. Address the 22 of 40 eval scenes that have no verified episode within 5 cm (cube), 8 cm (bin) and 15 degrees (cube yaw) using the listed seeds.
