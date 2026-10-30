## Inspiration

Robots learn new tasks by copying people. Someone shows the robot what to do, a few hundred times, and a model learns
from those recordings. The problem is that good recordings are expensive. You need a teleoperation rig and someone
trained to use it, and a lot of takes still get thrown out.

Cheap recordings are easy to get. Anyone can drive a robot with a mouse or a keyboard, or just move their hand in
front of a webcam. But those demos are sloppy: the hand pauses, wobbles, grabs the cube off centre, and sometimes
shoves the gripper straight into the bin. When we trained a robot to copy ten of our own mouse demos, it failed every
single test.

NVIDIA already has great tools for multiplying demos that work, like Isaac Lab Mimic. We wanted to know about the step
before that: can you take a handful of sloppy human demos and still end up with a robot that works?

## What it does

SANT (Simulate, Augment, Neaten, Train) is a pipeline that turns a few cheap human demos into a working robot.

You record a demo in the browser. Your keyboard, mouse or webcam drives a simulated Franka arm in NVIDIA Isaac Lab,
live, and the job is to pick up a cube and drop it in a bin. Then SANT takes over:

1. It replays your demo in Isaac Lab with real physics and checks whether it actually worked. Did the cube end up in
   the bin? Did anything slam into the table?
2. If the demo failed, it tries to repair it, either with simple tested rules (trim, smooth, re-centre the grasp) or
   with NVIDIA Nemotron suggesting small fixes to the path. Every fix gets checked in physics again.
3. It multiplies the demos that pass by moving the cube and bin around and replaying each copy. Only copies that
   still work are kept.
4. A reinforcement-learning "teacher" practises the task in Isaac Lab, thousands of arms at once, starting from the
   human demos. What it learns is then passed on to a robot that only sees through cameras.

**The result:** our ten sloppy mouse demos became a robot that succeeds 30 out of 40 times on scenes it had never
seen. Copying the same demos directly got 0 out of 40.

Nemotron, running on Nebius Token Factory, handles the language side. It labels demos, turns a sentence like "put
the cube near the left edge and the bin on the far right" into a scene, and suggests repairs. It never controls the
robot, though. Code checks everything it says, and physics has the final word.

## How we built it

The simulation side runs on NVIDIA Isaac Sim 6.2 and Isaac Lab 3.0, on a single Windows PC with one RTX 5080. Isaac
Lab does the live teleop, the physics checks, the multiplying, the RL training (PPO with 4,096 parallel environments)
and the final tests. We also ran Isaac Lab Mimic on our demos to compare against it.

Nemotron runs on Nebius Token Factory. We used Nemotron 3.5 Super VL to look at camera frames and Nemotron 3 Super
120B (with thinking on) for repairs and scenes. Because Token Factory hosts the models, our one GPU stayed free for
Isaac Lab all day. The whole project took 483 calls and cost about $1.14.

The camera robot is a LeRobot ACT policy, trained on the teacher's runs mixed with our verified human demos. Around
it there's a Python core that holds the success check, the repairs and the statistics, a FastAPI backend, and a
React and three.js website where you can record demos, run SANT, and replay all 40 real test runs.

We wrote down every test before running it: which scenes, what counts as success, and what score we were aiming for.
That way we couldn't fool ourselves after the fact.

## Challenges we ran into

Our real human demos failed physics even when they looked fine. All ten webcam demos put the cube in the bin, and
SANT's check rejected every one of them, because the gripper was pushing into the bin with up to 927 N of force
(the limit is 5 N).

Copying demos only got us so far. Even with clean, verified demos, the robot would grab the cube and then drop it,
topping out at 3 out of 40. That's why we added the RL teacher, which took six different reward designs before it
learned the task.

Then the teacher cheated. Its first good version moved at 1.7 m/s, which no real arm should do. When we ran it
through SANT's own physics check, only 3 of 50 runs held up. Capping its speed fixed it, and all 50 passed.

We also had to be honest about our own AI. Nemotron's first repair result looked great (5 out of 10 fixed, against
3 for the rules), but when we ran it again it got 2. We published both results and moved Nemotron to the jobs it's
actually good at.

## Accomplishments that we're proud of

The main one: a robot that works from ten sloppy mouse demos, 30 out of 40 on new scenes, in a test we set up before
running it. Our goal was 24, and we beat it.

We also showed the human demos really matter. The same RL teacher, with the same code and the same budget but
without the human demos to start from, never lifted the cube once (0 out of 128, against 113 out of 128 with them).

SANT ended up catching problems everywhere we pointed it. It caught our teacher cheating, and it flagged 9 of Isaac
Lab Mimic's 100 self-reported successes as actually failing.

And we're proud that we published the results that didn't go our way, too.

## What we learned

Physics should be the judge. Language models are great at words, like labelling a demo or describing a scene, but
when the question is "did this actually work?", a physics check beats them every time.

Multiplying demos only helps if you check every copy. Human demos and RL need each other: copying alone stalled, RL
alone learned nothing, and together they got to 30 out of 40.

And writing the test down before running it saved us more than once. Two of our favourite early results didn't hold
up when we checked them again.

## What's next for SANT

The big one is a real robot. Everything so far is in simulation, and the next step is running the same recipe on an
SO-101 or a Franka arm, starting from webcam demos.

We also want to fix the main failure. In the final test, every one of the 10 failures involved the robot dropping the
cube at some point. We're working on having Nemotron read those failures and suggest what training data to make next,
with code checking every claim. After that: more tasks and more robots.
