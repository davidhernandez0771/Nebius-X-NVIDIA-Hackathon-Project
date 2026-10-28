**SANT** (**S**imulate · **A**ugment · **N**eaten · **T**rain) turns a few cheap, sloppy human demos into a robot that
works.

## The look

Ten sloppy demos, recorded with a mouse. We gave them to two robots:
- **Copy them directly:** the robot succeeds **0 times in 40** new scenes.
- **Put them through SANT:** it succeeds **30 times in 40** (75%), on scenes it had never seen, in a test we
  registered before we ran it.

## Inspiration

Robots learn by copying human demonstrations, and they need a lot of them. **Good demos are expensive:** teleop rigs,
trained operators, and 20–30% of takes thrown away. **Cheap demos are sloppy:** a mouse, a keyboard or a webcam gives
you pauses, shaky paths, off-centre grabs, and a gripper pressed into the bin. Tools like NVIDIA's Isaac Lab Mimic
multiply demos that already work. We asked about the step before that: **can sloppy human demos be made useful?**

## What it does

You record a pick-and-place demo in the browser: your keyboard, mouse or webcam drives a simulated Franka arm in
**NVIDIA Isaac Lab**, live. Then SANT:

1. **Checks it in physics.** Isaac Lab replays the demo with real contact forces, and code decides whether it worked:
   cube in the bin, gripper open, no hard collision, no drop.
2. **Repairs what fails.** A fixed menu of tested rules (trim, smooth, retime, recentre the grasp), or **NVIDIA
   Nemotron** proposing small edits to the path. Code limits every edit, and physics checks it again.
3. **Multiplies what passes.** The cube and bin move to new places; every copy is replayed in physics, and only the
   copies that pass are kept.
4. **Teaches.** A reinforcement-learning teacher practises in Isaac Lab (4,096 arms at once), starting from the
   verified human demos. Its skill is distilled into a robot that sees only through cameras.
5. **Tests once.** The camera robot is tested on 40 scenes it has never seen, under rules written down beforehand.

**NVIDIA Nemotron on Nebius Token Factory is SANT's language layer.** It labels demos (40/40 correct in a
pre-registered test), turns a sentence into a valid scene ("cube near the left edge, bin far right"), turns
plain-English repair requests into repair steps, and proposes path repairs. **It never moves the robot:** code checks
every answer, and physics decides.

## The proof

| | Success on 40 unseen scenes |
|---|---|
| Copying the 10 raw mouse demos | 0/40 |
| Copying the SANT-verified demos | 3/40 |
| RL teacher → camera robot, v1 | 15/40 |
| **v2: same data, trained longer + a gripper fix** | **30/40 (75%, Wilson 60–86%)**. Goal ≥ 24/40: **met** |

- **The human demos matter.** The same RL teacher, with the same code, budget and seed but no human demo starts,
  never lifted the cube: **0/128 vs 113/128** with them.
- **SANT checks the teacher too.** Its first version learned to move at an impossible 1.7 m/s. Replayed through
  SANT's physics check, only 3 of 50 runs held up. Capped at a realistic 0.5 m/s: 50/50.
- **Every test was pre-registered:** seeds, rules and the goal were committed before anything ran. The comparisons
  between rows are descriptive: the 30/40 used fresh seeds.

## How we built it

- **Isaac Sim 6.2 + Isaac Lab 3.0 on Windows 11:** the pick-place scene with contact sensors and cameras, live
  teleop, physics replay, multiplying, RL (rsl_rl PPO) and evaluation. **Isaac Lab Mimic** ran on SANT's demos, and
  SANT's check caught 9 of Mimic's 100 self-reported successes as false.
- **Nemotron on Nebius Token Factory:** `Nemotron-3.5-Super-VL` reads camera frames, and
  `nemotron-3-super-120b-a12b` (thinking on) reasons about repairs and scenes. That's 483 calls for about $1.14, with
  no GPU of our own spent on it: our one RTX 5080 ran Isaac Lab all day.
- **A pure-Python core** shared by the backend, the sim worker and the exporter: the success check, the repairs, the
  multiply transform and the statistics. **LeRobot ACT** is the camera policy, and a **FastAPI** backend serves a
  **React + three.js** site.
- **Built tests-first:** 2,813 Python and 2,172 web tests, with every AI call mocked.

## Challenges

- **Real hands fail physics, even when they "work".** All 10 webcam demos dropped the cube in the bin, and the
  physics check failed every one: the gripper pressed into the bin at up to 927 N against a 5 N limit.
- **Copying alone hit a ceiling (3/40).** The robots grabbed the cube, then dropped it. So we added an RL teacher. It
  took six reward designs to learn the task, and every failed run is logged.
- **The teacher cheated physics,** and the student couldn't execute its commands at first (0/30) until the teacher
  trained with the student's own actuator.
- **Measuring our own AI honestly.** Nemotron's first repair win (5/10 vs 3/10) didn't replicate (2/10 vs 3/10), and
  code diagnosed demos slightly better than Nemotron. We published both and gave Nemotron the jobs it's good at.

## What we learned

- **Physics is the judge.** Use models for words (labels, scenes, proposals) and code plus physics for verdicts.
- **Verify every copy.** Multiplying only helps when each copy is checked.
- **Human demos and RL need each other.** Imitation alone stalled; RL alone learned nothing; together, 30/40.
- **Pre-register, then report.** Two of our favourite results didn't replicate. We'd never have known otherwise.

## What's next

- **A real robot:** the same recipe on an SO-101 or a Franka, starting from webcam demos.
- **Fix the main failure:** all 10 test failures timed out, and every one of them dropped the cube at some point.
- **More tasks and robots,** and an ablation of v2's two changes.
- Everything so far is in simulation, and we say so.
