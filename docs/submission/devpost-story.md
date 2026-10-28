## Inspiration

Robots learn by copying human demonstrations, and they need a lot of them. **Good demos are expensive:** teleop rigs,
trained operators, and 20–30% of takes thrown away. **Cheap demos are sloppy:** a mouse, a keyboard or a webcam gives
you pauses, shaky paths, off-centre grabs, and a gripper pressed into the bin. Tools like NVIDIA's Isaac Lab Mimic
multiply demos that already work. We asked about the step before that: **can a few sloppy human demos be turned into a
robot that works?**

## What it does

**SANT** (**S**imulate · **A**ugment · **N**eaten · **T**rain) turns a few cheap, sloppy human demos into a working
robot. Ten demos, recorded with a mouse: copied directly, the robot succeeds **0 times in 40** new scenes; through
SANT, it succeeds **30 times in 40**, on scenes it had never seen.

You record a pick-and-place demo in the browser: your keyboard, mouse or webcam drives a simulated Franka arm in
**NVIDIA Isaac Lab**, live. Then SANT:

1. **Checks it in physics.** Isaac Lab replays the demo with real contact forces, and code decides whether it worked:
   cube in the bin, gripper open, no hard collision, no drop.
2. **Repairs what fails,** with a menu of tested rules (trim, smooth, retime, recentre the grasp) or with **NVIDIA
   Nemotron** proposing small edits to the path. Code limits every edit, and physics checks it again.
3. **Multiplies what passes.** The cube and bin move to new places, every copy is replayed in physics, and only the
   copies that pass are kept.
4. **Teaches.** A reinforcement-learning teacher practises in Isaac Lab (4,096 arms at once), starting from the
   verified human demos. Its skill is distilled into a robot that sees only through cameras.
5. **Tests once,** on 40 scenes it has never seen, under rules written down before the run.

**NVIDIA Nemotron on Nebius Token Factory is SANT's language layer.** It labels demos, turns a sentence into a valid
scene ("cube near the left edge, bin far right"), turns plain-English repair requests into repair steps, and proposes
path repairs. **It never moves the robot:** code checks every answer, and physics decides.

## How we built it

- **NVIDIA Isaac Sim 6.2 + Isaac Lab 3.0, on Windows 11:** a pick-place scene with contact sensors and cameras, live
  teleop, physics replay, multiplying, RL training (rsl_rl PPO, 4,096 parallel envs) and evaluation. **Isaac Lab
  Mimic** also ran on SANT's demos.
- **NVIDIA Nemotron on Nebius Token Factory:** `Nemotron-3.5-Super-VL` reads camera frames, and
  `nemotron-3-super-120b-a12b` (thinking on) reasons about repairs and scenes. That's 483 calls for about $1.14, through
  the OpenAI-compatible API, with no GPU of ours spent on it: our one RTX 5080 ran Isaac Lab all day.
- **A pure-Python core** shared by the backend, the sim worker and the dataset exporter: the success check, the
  repairs, the multiply transform and the statistics.
- **LeRobot ACT** as the camera policy, trained on the teacher's physics-checked runs mixed with the verified human
  demos.
- **A FastAPI backend** with a WebSocket teleop relay, and a **React + three.js** site with a guided tour, a proof
  wall and a test track that replays all 40 real test runs.
- **Built tests-first:** 2,813 Python and 2,172 web tests, with every AI call mocked. **Every experiment was
  pre-registered:** seeds, rules and goals committed before anything ran.

## Challenges we ran into

- **Real hands fail physics, even when they "work".** All 10 webcam demos dropped the cube in the bin, and the
  physics check failed every one: the gripper pressed into the bin at up to 927 N against a 5 N limit.
- **Copying alone hit a ceiling (3/40).** The robots grabbed the cube, then dropped it. So we added an RL teacher. It
  took six reward designs before it learned the task, and every failed run is logged.
- **The teacher cheated physics.** Its first version moved at an impossible 1.7 m/s. Replayed through SANT's check,
  only 3 of 50 runs held up. Capped at 0.5 m/s: 50/50.
- **The student couldn't follow the teacher at first** (0/30), until the teacher trained with the student's own
  actuator.
- **Measuring our own AI honestly.** Nemotron's first repair win (5/10 vs 3/10) didn't replicate (2/10 vs 3/10), and
  code diagnosed demos slightly better than Nemotron. We published both and gave Nemotron the jobs it's good at.
- **One GPU for everything:** simulation, RL, training and the site all shared one 16 GB card.

## Accomplishments that we're proud of

| Robot, tested on 40 unseen scenes | Success |
|---|---|
| Copying the 10 raw mouse demos | 0/40 |
| Copying the SANT-verified demos | 3/40 |
| RL teacher → camera robot, v1 | 15/40 |
| **v2: same data, trained longer + a gripper fix** | **30/40 (75%, Wilson 60–86%)** |

- **A working robot from 10 sloppy mouse demos:** 30/40, pre-registered, run once, beating the ≥ 24/40 goal we set
  before the run. The comparisons between rows are descriptive: the 30/40 used fresh seeds.
- **Proof the human demos matter:** the same RL teacher, with the same code, budget and seed but no human demo
  starts, never lifted the cube: **0/128 vs 113/128** with them.
- **SANT checks everything, even the teacher and Mimic:** it caught the teacher's impossible speed, and it caught 9 of
  Isaac Lab Mimic's 100 self-reported successes as false.
- **Nemotron labeled demos 40/40** in a pre-registered test, and turned 34/34 plain-English repair requests into the
  right steps.
- **We published the results that went against us** too.

## What we learned

- **Physics is the judge.** Use language models for words (labels, scenes, proposals), and code plus physics for
  verdicts.
- **Verify every copy.** Multiplying only helps when each copy is checked.
- **Human demos and RL need each other.** Imitation alone stalled at 3/40, and RL alone learned nothing. Together:
  30/40.
- **Pre-register, then report.** Two of our favourite results didn't replicate, and we'd never have known otherwise.

## What's next for SANT

- **A real robot:** the same recipe on an SO-101 or a Franka arm, starting from webcam demos.
- **Fix the main failure:** all 10 test failures timed out, and every one of them dropped the cube at some point.
- **Nemotron as the failure analyst:** it reads why the robot failed and proposes the next training data, with code
  checking every claim.
- **More tasks and more robots,** and an ablation to credit v2's two changes separately.
- Everything so far is in simulation, and we say so.
