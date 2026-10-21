# Coverage: `C:\dev\pm-t6\data\human_exp\human10c\store`

| scene | in eval | takes | raw verified | repaired verified | verified takes | variants verified | swoops (takes) | frames in last 3 cm (takes -> verified) |
|---|---|---|---|---|---|---|---|---|
| S1 Standard | yes | 10 | 0 | 3 | 3 | 24 / 30 | 10 / 10 | 12.5 -> 12 |
| S2 Cube at the edge of reach | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S3 Bin turned, other side | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S4 Small cube | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S5 Large cube | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S6 Cube turned 35 degrees | yes | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S7 Yellow distractor | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |
| S8 Taller bin | no | 0 | 0 | 0 | 0 | 0 / 0 | 0 / 0 | - |

**Eval distribution** (seeds 5020-5059, 40 scenes; pool 27 verified episodes): 6 of 40 eval scenes have a verified episode within 5 cm (cube), 8 cm (bin) and 15 degrees (cube yaw).

| axis | bins: eval scenes / verified episodes |
|---|---|
| cube x (m) | 0.4..0.45: 11/3, 0.45..0.5: 9/6, 0.5..0.55: 11/13, 0.55..0.6: 9/5 |
| cube y (m) | -0.2..-0.1: 11/6, -0.1..0: 3/3, 0..0.1: 9/9, 0.1..0.2: 17/9 |
| cube yaw (to its nearest face) (deg) | -45..-30: 4/4, -30..-15: 4/3, -15..0: 9/8, 0..15: 7/6, 15..30: 9/2, 30..45: 7/4 |
| bin x (m) | 0.4..0.45: 8/3, 0.45..0.5: 7/3, 0.5..0.55: 8/9, 0.55..0.6: 11/1 thin, 0.6..0.65: 6/11 |
| bin y (m) | -0.3..-0.2: 20/13, -0.2..-0.1: 6/2, -0.1..0: 0/0, 0..0.1: 0/0, 0.1..0.2: 6/1 thin, 0.2..0.3: 8/11 |

**Requests**

1. Record 2 more takes in S6 Cube turned 35 degrees: 0 verified of 0 recorded.
2. Record 2 more takes in S2 Cube at the edge of reach: 0 verified of 0 recorded. Generalization only, not in the eval distribution (cube x 0.63 (eval 0.4 to 0.6); cube y -0.26 (eval -0.2 to 0.2)).
3. Record 2 more takes in S3 Bin turned, other side: 0 verified of 0 recorded. Generalization only, not in the eval distribution (bin turned 90 degrees).
4. Record 2 more takes in S4 Small cube: 0 verified of 0 recorded. Generalization only, not in the eval distribution (4 cm cube).
5. Record 2 more takes in S5 Large cube: 0 verified of 0 recorded. Generalization only, not in the eval distribution (6 cm cube).
6. Record 2 more takes in S7 Yellow distractor: 0 verified of 0 recorded. Generalization only, not in the eval distribution (1 more object).
7. Record 2 more takes in S8 Taller bin: 0 verified of 0 recorded. Generalization only, not in the eval distribution (bin walls 11 cm (eval 8 cm)).
8. In S1 Standard, 10 of 10 takes close while still moving (median 0.23 m/s, 12.5 frames in the last 3 cm; the scripted grasp stops and spends 16): retake with a stop before closing, or repair with --grasp-retime.
9. Only 1 of 27 verified episodes have the bin x between 0.55 and 0.6 m, where 11 of 40 eval scenes put it: add variants or takes there.
10. Only 1 of 27 verified episodes have the bin y between 0.1 and 0.2 m, where 6 of 40 eval scenes put it: add variants or takes there.
11. 34 of 40 eval scenes have no verified episode within 5 cm (cube), 8 cm (bin) and 15 degrees (cube yaw): seeds 5020, 5021, 5022, 5026, 5027, 5028, 5029, 5030, 5031, 5032, 5033, 5034 and 22 more.
