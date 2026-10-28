# Research: is the SANT vision feasible, and what to do in the last 9 days (2026-10-20)

Read-only research. Nothing was run on the GPU, Isaac was not started, nothing was installed or downloaded, and no
code was edited. Local facts come from reading files in `C:\dev\pm-t8`, the Isaac Lab 3.0 install at `C:\isaac\IsaacLab`
and the project memory notes. Everything else is from the web, with the URL next to the claim.

**Tags used throughout:**
- **[E]** evidenced: a source says it (URL given).
- **[L]** local: read from our own files or the local Isaac Lab install (path given).
- **[J]** my judgement or an estimate: plausible, not tested.

**One correction to the brief [L].** The brief says Isaac runs on an RTX 4060. The project memory says the Isaac PC
is an i9-14900KF, 64 GB RAM, **RTX 5080 16 GB**
(`memory/hackathon-sant-focus.md`, `memory/omniverse-learning-progress.md`). The RTX 4060 is the laptop used to view
the website (`memory/site-descent.md`). The estimates below assume the 5080. If Isaac really ran on an 8 GB 4060, RL
would be about 2–3× slower and capped at fewer parallel environments [J].

---

## Executive summary (plain language)

1. **The idea is real, and NVIDIA sells this exact pipeline.** Record a few demos, multiply them in simulation, keep
   only the copies physics accepts, then train. That is MimicGen, Isaac Lab Mimic and GR00T-Mimic [E]. SANT is a small
   version of it that uses a webcam, mouse or keyboard instead of a VR headset, with Nemotron as the coordinator.
2. **What the papers show:** 10 human demos plus about 1,000 generated copies take simple tasks from about 0–26% to
   50–100% in simulation (MimicGen: Pick-Place 0% → 51%, Stack 26% → 100%) [E]. That needs about 1,000 copies; we
   have trained on 110.
3. **What the papers also show:** copying demos (imitation) alone usually stops around 40–80% on a pick-place in sim.
   The 95–100% numbers come from adding trial and error (RL) on top: DemoStart 98–99%, ResiP 5–54% → 88–99% [E].
4. **The trial-and-error robot videos you saw are real, and they fit our task.** On one gaming GPU, a simple "pick
   up the cube" policy learns by trial and error in about 1 minute (ManiSkill), or 20–60 minutes (Isaac Lab's Franka
   lift) [E, J]. It learns from exact positions, not camera pictures.
5. **The standard recipe:** an RL "teacher" that sees exact positions gets precise, then teaches a "student" that only
   sees camera images. NVIDIA, DeepMind and MIT all use it [E]. Isaac Lab 3.0, already installed here, includes this
   distillation tool [L].
6. **Where your demos still matter:** they say *what* the task is (which object, which container, what counts as
   done), they give RL a starting point so it does not search blindly, and they carry the "style". RL is better at
   millimetre precision than people are. The pitch: "the human shows the intent, simulation earns the precision."
7. **Our failures are fixable engineering, not a dead end.** The policy never lifts the cube because of open-loop
   2-second plans, half-closed gripper commands, swoop grasps and small images. Those fixes are coded and get tested
   tomorrow.
8. **Cosmos cannot run on our PC.** It needs 32–65 GB of GPU memory; we have 16 GB [E]. It can run on Nebius H100/H200
   ($4.50 / $5.40 per GPU-hour on demand; preemptible from $0.79) or as a hosted trial on build.nvidia.com [E].
9. **Cosmos changes how the pictures look; it does not teach the robot to grasp.** NVIDIA's own test: Cosmos-augmented
   data made the policy far more robust to new lighting (11% → 62%), but slightly worse in the normal scene
   (96.6% → 86.6%) [E]. Our test scenes never change lighting, so Cosmos would not raise our headline number.
10. **DreamGen / GR00T-Dreams (robot videos imagined by AI) is out of reach.** Its big run took 1,500 GPUs for 54 hours,
    and the Franka gain was 23% → 37%, measured on 10 trials [E].
11. **Recommended plan:** human demos → SANT repair and multiply (as now) → an RL or expert teacher refines precision
    in Isaac Lab → a "DAgger" round distills it into the camera policy (the teacher corrects the student where the
    student actually goes) → pre-registered 40-seed test. Cosmos is optional, for a few demo clips in the video.
12. **A realistic target (pre-register it):**
    - camera policy at 20+/40 (50%) is good, and 28+/40 (70%) is excellent;
    - the RL teacher at 90%+ in sim;
    - against raw human demos at 0–3/40.
13. **The honest fallback, already built:** if the RL teacher is not at 90% in sim by day 4, use the scripted expert we
    already have as the teacher. It is hand-written, so it weakens the "no code per task" story; say that openly.
14. **Be blunt about one point:** for cube-in-bin, the scripted expert alone could produce the precise data. The human
    demo's honest value here is defining the task without code, plus the seed for RL. Claim that, not "the human's
    precision".
15. **Not realistic in 9 days:**
    - "anyone shows a robot once, and a real robot does it accurately";
    - any real-robot result;
    - DreamGen;
    - training Cosmos;
    - RL from camera pictures on one GPU;
    - moving Isaac to the cloud.

    The closest honest version: **"once in sim → accurate in sim, with a clear path to real."**
16. **Where to run things:**
    - Isaac, RL and training stay on the local RTX 5080.
    - Nemotron stays on Nebius Token Factory.
    - Cosmos, if used, runs on Nebius AI Cloud: one H100 for a few hours, about $10–$60.
    - Isaac on the cloud would need L40S or RTX PRO 6000; H100 has no RT cores, and NVIDIA says Isaac Sim does not
      support it [E].
17. **Check the rules first:** they say every runtime model call must go to an NVIDIA open model on Nebius Token
    Factory or Nebius AI Cloud ([L] `docs/HANDOFF.md`). A Cosmos call to build.nvidia.com may not qualify; Cosmos on
    Nebius AI Cloud does.
18. **Biggest risks:**
    - RL reward bugs ("reward hacking");
    - the RL environment not matching our eval environment;
    - GPU time: one heavy job at a time.

    Day-4 gate: RL teacher at 90%+ or switch to the fallback.
19. **What success looks like on Oct 30.** One table:

    | Arm | Example |
    |---|---|
    | raw human | 0–3/40 |
    | SANT-multiplied | about 10/40 |
    | SANT + teacher + DAgger | 20–28/40 |
    | teacher in sim | 90%+ |

    Each comes with a p-value, plus a video of the chain: human demo → copies → teacher → camera policy.
20. **Bottom line:** the vision is feasible in the form the field already uses (few demos + simulation + RL teacher).
    It is not feasible as "imitation only from one webcam demo". Build the first, and say clearly it is in simulation.

---

## Q1. Is the vision feasible? What literature and industry show

### 1.1 "Few demos → generated copies → policy" (the MimicGen family)

| Work | Source demos | Generated | Policy result | Eval | Source |
|---|---|---|---|---|---|
| **MimicGen** (sim, image BC-RNN) | 10 human | 1,000 per task | Stack 26.0% → 100%. Square 11.3% → 90.7% (D0), 73.3% (D1). **Pick Place 0% → 50.7%** (image), 58.7% (low-dim) | 3 training seeds; reports the **max** over checkpoints | [E] https://ar5iv.labs.arxiv.org/html/2310.17596 |
| MimicGen, real robot | 10 | — | Stack 0% → 36%; Coffee 0% → 14% | 50 trials | same |
| MimicGen, data generation rate | — | — | Pick Place D0 only 32.7% of attempts succeed | — | [E] https://arxiv.org/pdf/2310.17596 |
| **DexMimicGen** (Diffusion Policy) | 5–10 per task | 1,000 per task (21k total) | Piece Assembly 3.3% → 80.7%; Threading 1.3% → 69.3%; Can Sorting 0.7% → 97.3% | 3 seeds, max per seed | [E] https://arxiv.org/html/2410.24185v2 |
| DexMimicGen, real (GR1) | 4 source | 40 generated | 0% → 90% | 20 trials | same |
| **SkillMimicGen** | 60 human | 24k over 18 variants | Generation rate 75.4% vs MimicGen's 40.7% | — | [E] https://arxiv.org/pdf/2410.18907 |
| **Isaac Lab Mimic**, GR1 pick-place | 10 | 1,000 | Generation 65–80%; BC policy 75–86% | 50 rollouts | [E] https://isaac-sim.github.io/IsaacLab/release/3.0.0/source/features/imitation-learning/humanoids_imitation.html |
| Isaac Lab Mimic, Franka stack (from the 10-20 note) | 10 | 1,000 | BC-RNN about 40–60% | — | [E] via `2026-10-20-research-cube-in-bin.md` §1.8 |
| **GR00T-Mimic blueprint** (NVIDIA) | Vision Pro teleop | 780k trajectories in 11 h | +40% GR00T N1 performance vs real data only | — | [E] https://developer.nvidia.com/blog/building-a-synthetic-motion-generation-pipeline-for-humanoid-robot-learning, https://arxiv.org/pdf/2503.14734 |

**What it means [J]:**
- The core SANT claim, that multiplying a few demos with physics verification beats the raw demos, is one of the best
  replicated results in robot learning.
- Our scripted 10 → ×10 result (3/40 → 17/40, p = 0.0005) already reproduces it.
- Two caveats:
  1. The papers use **~1,000** copies, not 110.
  2. They report the **best** checkpoint over training, which is more generous than our pre-registered last-checkpoint
     eval.
- MimicGen's own limits [E, same URL]: quasi-static rigid objects, a known subtask sequence, object poses known at each
  subtask start, and linear interpolation that does not guarantee collision-free motion. Our task fits all of them.

### 1.2 Demos + trial and error (RL with demonstrations)

| Work | What | Result | Source |
|---|---|---|---|
| **DemoStart** (DeepMind) | Sparse reward plus 2–60 *sim* demos; RL episodes start from demo states (auto-curriculum); then distilled to a 4-camera, 80×80 vision policy by BC on teacher rollouts | Sim: plug lift 99.7%, cube reorientation 99.9%, plug insertion 99.6% (1,000 episodes each). Real zero-shot: plug lift 97%, cube reorientation 97%, insertion 64% (100 episodes) | [E] https://arxiv.org/html/2409.06613v2 |
| **ResiP** (MIT) | A per-step residual policy trained with PPO on top of a frozen, chunked Diffusion Policy BC from 50 demos; 1,024 envs | BC → ResiP: one_leg 54 → 98, round_table 12 → 94, lamp 7 → 97, peg-in-hole 5 → 99 (1,024 episodes) | [E] https://arxiv.org/html/2407.16677v4 |
| ResiP, distillation to images | State teacher → image student | 98% teacher → about 78–80% image student; 10k → 100k synthetic trajectories gave only +2 points ("the distillation itself" limits it) | same |
| ResiP, on open-loop chunks | Chunk-level correction is slower and saturates (92% vs 98%); under pushes, chunked methods lose 19–26 points vs 12 | — | same; this matches our open-loop-chunk finding |
| **DPPO** | PPO fine-tuning of a Diffusion Policy | Pixel Transport 0% → over 50%; One-leg sim-to-real 16/20 (80%) zero-shot | [E] https://arxiv.org/html/2409.00588v1 |
| **IBRL** | BC proposes actions; RL picks; 10–30 demos | Real Lift (10 demos): BC 50% → IBRL 100% in 8k steps (32 min). Hang: 65 → 85% | [E] https://arxiv.org/html/2311.02198v4 |
| **RLPD** | 50/50 offline/online replay | Up to 2.5× over prior methods (Adroit etc.) | [E] https://ar5iv.labs.arxiv.org/html/2302.02948 |
| **Human2Sim2Robot** (Stanford, CoRL 2025) | **One** RGB-D human video → object pose trajectory = reward, plus a pre-grasp hand pose as the RL start → PPO in Isaac Gym, 4,096 envs, 1 A100, 5–24 h → real | Beats replay by 67%, object-aware replay by 55%, and BC by 68% (10 rollouts per task, 7 tasks) | [E] https://arxiv.org/html/2504.12609v3 |
| **Video2Policy** | Internet videos → sim tasks; an LLM writes and refines rewards; RL | 100+ videos, 9 task types solved by RL | [E] https://arxiv.org/html/2502.09886v1 |
| **Eureka** | An LLM writes reward code for Isaac Gym | Beats expert-written rewards on about 83% of 29 tasks | [E] https://alphaxiv.org/overview/2310.12931v1 |

**What it means [J]:**
- The closest existing match to the founder's vision is **Human2Sim2Robot plus DemoStart**: one or a few human demos
  define the goal and the start states, RL in sim gets the precision, and a vision student is distilled.
- That is the realistic, evidenced form of "show it once".
- Nemotron writing or tuning the reward from a sentence is an Eureka-style role, which is evidenced too.

### 1.3 Human video → robot (no teleop)

| Work | Result | Source |
|---|---|---|
| **Phantom** | Robot policies from human video only (hand inpainted, robot overlaid); up to 92% on real tasks, zero-shot. Co-training sweeping: robot-only 0% in a new scene → 80% with human video (25 rollouts) | [E] https://arxiv.org/pdf/2503.00779 |
| **EgoMimic** | Human egocentric data adds 34–228% over robot-only. 2 h robot + 1 h human beats 3 h robot (128 vs 74 points). 1 h of human data gives about 1,400 demos vs 135 by teleop | [E] https://arxiv.org/pdf/2410.24221 |
| **MimicPlay** | Human play data trains the high-level plan; a few robot demos train low-level control | [E] https://arxiv.org/html/2302.12422v2 |
| **DexMV** | Human video → 3D hand/object pose → robot demos for dexterous RL in sim; "solves tasks RL alone cannot" | [E] https://arxiv.org/abs/2108.05877 |
| **R+X** | A VLM retrieves clips from everyday human video; in-context imitation (KAT) executes them; 12 tasks on a Sawyer | [E] https://arxiv.org/pdf/2407.12957 (numbers not retrieved) |
| ViViDex | 1–3 human videos → 99% seen / 50% unseen objects, in sim | [E] https://alphaxiv.org/overview/2404.15709v3 (secondary summary) |

**What it means [J]:**
- Human video is valuable as cheap, diverse intent and trajectory data.
- Nobody gets millimetre-precise grasps from webcam hand tracking alone.
- Every working system adds either robot data or sim RL for the contact-rich part.
- Our measured replay fidelity of 2–4/10 for webcam demos (`memory/human-demo-experiment.md`) matches this.

### 1.4 NVIDIA's own physical-AI data story

- **GR00T-Mimic** [E, URLs above]:
  - teleop in a simulated digital twin (Apple Vision Pro);
  - Isaac Lab Mimic multiplies the demos;
  - GR00T-Gen / Cosmos Transfer adds visual variety;
  - train;
  - 780k trajectories in 11 h; +40% over real data only.
- **GR00T-Dreams / DreamGen** [E] https://research.nvidia.com/labs/gear/dreamgen, https://arxiv.org/html/2505.12705v2:
  - Fine-tune a video model on robot data; generate videos of new tasks; label the actions with an inverse-dynamics
    model; train.
  - 22 new verbs in 10 new environments.
  - Franka (10 demos per task, 10 rollouts per checkpoint): average 23% → 37%; GR00T N1 pick-place 40% → 60%.
  - Compute: 240k RoboCasa samples took **54 h on 1,500 L40s**.
- **Physical AI Data Factory Blueprint** (GTC, March 2026) [E]
  https://aibusiness.com/robotics/nvidia-intros-data-factory-robotics-models-for-physical-ai,
  https://www.automate.org/ai/industry-insights/nvidia-declares-big-bang-of-physical-ai-at-gtc-2026:
  - Cosmos + OSMO orchestrator to turn real scenarios into many synthetic variants.
  - Nebius is named as a launch cloud partner in one (non-English) report: UNVERIFIED.
- **Cosmos 3** (June 2026) [E]
  https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Launches-Cosmos-3-the-Open-Frontier-Foundation-Model-for-Physical-AI/default.aspx:
  - Super and Nano are available; Edge is coming.
  - One model for vision reasoning, world generation and action prediction.
  - Nebius is a listed partner cloud.

**Pitch framing [J].** "SANT is the GR00T-Mimic pattern for people without a VR rig or a robot. A webcam, mouse or
keyboard replaces the Vision Pro, and Nemotron is the agent that builds scenes, coaches, repairs and labels." That puts
the project inside NVIDIA's own story rather than against it.

### 1.5 Feasibility verdict

- **Feasible, and evidenced [E]:**
  - few demos → physics-verified multiplication → large gains over raw;
  - RL in sim to near-perfect for single-object pick tasks;
  - distillation to a camera policy at a cost of about 20 points.
- **Feasible but unproven for us [J]:**
  - human mouse or webcam demos as the seed, because their swoop grasps and one-scene recording need SANT's repairs;
  - Nemotron writing goals and reward weights.
- **Not feasible in 9 days [J]:**
  - real-robot transfer;
  - learning precision from human video alone;
  - DreamGen-style generated robot videos;
  - a general system for any task (one task done well is the realistic scope).

---

## Q2. Trial and error (RL) in Isaac Lab for our task

### 2.1 What Isaac Lab ships, read from our local install [L]

`C:\isaac\IsaacLab` is version 3.0.0 (`VERSION`).
- **`IsaacContrib-Lift-Cube-Franka`** is the classic "Isaac-Lift-Cube-Franka-v0", renamed in 3.0.
  - Registered in `source/isaaclab_tasks/isaaclab_tasks/contrib/lift/config/franka/__init__.py`.
  - Also IK-Abs and IK-Rel variants, the latter with a robomimic BC config.
  - Env (`contrib/lift/lift_env_cfg.py`):
    - 4,096 envs;
    - 5 s episodes;
    - sim dt 0.01 with decimation 2, so a **50 Hz policy, the same as ours**.
  - Rewards:
    - `reaching_object` (std 0.1, weight 1);
    - `lifting_object` (minimal_height 0.04, weight 15);
    - `object_goal_tracking` (std 0.3, weight 16, success threshold 0.05);
    - fine-grained goal tracking (std 0.05, weight 5);
    - action-rate and joint-velocity penalties (−1e-4, raised later by a curriculum).
  - PPO (`.../agents/rsl_rl_ppo_cfg.py`): 24 steps per env, **1,500 iterations**, MLP [256, 128, 64], lr 1e-4.
  - 1,500 × 24 × 4,096 ≈ **147M env steps**.
- **`Isaac-Lift-Franka`** (core): a newer multi-shape lift with contact sensors, 15,000 iterations. It is heavier and
  not needed.
- **`Isaac-Lift-KukaAllegro-Camera`**: PPO directly from 64/128/256 px RGB or depth with a spatial-softmax CNN. This is
  the "RL from pictures" example (`core/lift/config/kuka_allegro/`).
- **Distillation**: `source/isaaclab_rl/isaaclab_rl/rsl_rl/distillation_cfg.py` defines the student/teacher config.
  Isaac Lab's docs: "train a state-based policy and distill it to a vision-based one" [E]
  https://isaac-sim.github.io/IsaacLab/main/_modules/isaaclab_rl/rsl_rl/distillation_cfg.html.
- **Our repo has no RL code yet** (grep for rsl_rl/PPO in `C:\dev\pm-t8` is empty) [L].

### 2.2 How long, on one consumer GPU

| Evidence | Number | Source |
|---|---|---|
| ManiSkill3 PickCube, PPO, state, RTX 4090, 4,096 envs | about **1 min** to near 100% | [E] https://arxiv.org/pdf/2410.00425, ManiSkill gallery docs |
| ManiSkill3 PickCube, PPO, **vision**, RTX 4090, 1,024 envs | about **10 min** | same |
| Isaac Lab Franka lift, DGX Spark, 2,048 envs | log: iteration 902/2650 with ETA 23 min, so about 0.8 s per iteration and about 20 min for the default 1,500 | [E] https://learn.arm.com/learning-paths/laptops-and-desktops/dgx_spark_isaac_robotics2/1_7dof_robot_arm/ |
| Isaac Lab Arena Franka lift, A6000, 512 envs, 12,000 iterations | about 6 h | [E] https://isaac-sim.github.io/IsaacLab-Arena/release/0.3.1/pages/example_workflows/reinforcement_learning/index.html |
| Tampere thesis | Franka cube lift "in two minutes" with 2,000+ envs | [E] https://trepo.tuni.fi/handle/10024/232306 |
| Isaac Lab benchmarks, RTX 4090 | Shadow-hand repose with 8,192 envs: 170k steps/s including training | [E] https://isaac-sim.github.io/IsaacLab/main/source/overview/reinforcement-learning/performance_benchmarks.html |
| Tiled cameras | "512 cameras on RTX 4090-class" recommended | [E] https://docs.nvidia.com/learning/physical-ai/getting-started-with-isaac-lab/latest/an-introduction-to-robot-learning-and-isaac-lab/03-available-robots-and-environments/03-tiled-rendering.html |
| A failure mode | 64 envs: "arm barely moved" (too few envs/iterations) | [E] https://forums.developer.nvidia.com/t/trying-to-train-isaac-lift-cube-franka-v0-example-task/320388 |

**Estimates for our RTX 5080 16 GB [J]:**
- **Stock Franka lift, state:** 2,048–4,096 envs, about 20–60 min for 1,500 iterations. Run it first, as a calibration
  that the install and GPU work.
- **Our pick → carry → place-in-bin, state, with demo-state resets:** a longer horizon (about 10–15 s instead of 5 s)
  and more stages. Budget **1–3 h per run** and **3–6 runs** of reward debugging, so 1.5–3 days of calendar time
  including engineering.
- **RL from pixels (PPO + CNN) for our task:** do not. It is 10× more expensive, our policy is ACT and not an rsl_rl
  CNN, and 16 GB limits camera envs.

### 2.3 How to combine RL with our human demos (ranked by fit for 9 days)

1. **Demo-state resets plus a goal reward (DemoStart-style)** [E: DemoStart, Human2Sim2Robot] [J for our fit]
   - Start a share of RL episodes (for example 50%) from states recorded along verified SANT copies: pre-grasp hover,
     grasped, over the bin. Start the rest from home. That is the auto-curriculum: the policy first learns the end of
     the task, then earlier parts.
   - Reward, computed per step on the GPU: reach (ee → cube, tanh), grasp (both finger contacts), lifted (cube z ≥
     table + 4 cm, like Isaac Lab), carry (cube xy → bin xy), placed (cube inside the bin volume, gripper open,
     settled), with penalties for arm–bin/table contact above 5 N and for action rate.
     - These mirror `src/demo_pipeline/success.py` and `goals.py` (not_in_bin, dropped, high_release, collision)
       [L], but must be rewritten as torch terms. `goals.py` is a post-hoc checker over whole trajectories, not a
       per-step reward.
   - **Always judge final success with the unchanged `check_success`**, never with the reward. Eureka-style rewards
     get hacked [J].
   - **Nemotron's role (optional, Eureka-like):** from the sentence and the ScenePlan, emit the goal list and reward
     weights. Keep a human-checked default.
2. **Residual RL on a state-based BC policy (ResiP-style)** [E: ResiP]
   - Train a small state BC policy (joints + cube + bin → action chunk) on the SANT-multiplied human data. This is
     cheap: no images.
   - Train a per-step residual with PPO, kept small (for example ±2 cm / ±0.1 rad).
   - It keeps the human's style and lets RL fix the grasp. It is attractive for the story ("RL only nudges what the
     human did"), but it is more code: the base policy must run inside the vectorised env.
   - A good second choice if (1) explores oddly.
3. **BC-initialised PPO fine-tuning.** Not recommended: DPPO reports Gaussian/MLP fine-tuning collapsing and failing
   sim-to-real [E] https://arxiv.org/html/2409.00588v1.
4. **RLPD / IBRL (off-policy, demos in the replay buffer).** Strong sample efficiency [E], but they are not built into
   Isaac Lab and are more custom code. Skip [J].

### 2.4 Teacher → student: distilling into the camera policy

- **Evidence:**
  - DemoStart distils by BC on successful teacher rollouts (4 cameras at 80×80) [E].
  - ResiP: state 98% → image about 78–80% [E].
  - The Genesis tutorial does the same for a Franka grasp (privileged state → 64×64 stereo, BC with a DAgger-style
    safeguard; rendering limits it to about 10 envs) [E]
    https://genesis-world.readthedocs.io/en/latest/user_guide/policy_training/examples/manipulation.html.
- **For us [J]: keep LeRobot ACT as the student; do not port to the rsl_rl student.** The data path already exists:
  export → LeRobot dataset → train → `sim_eval`.
  - **Round 0 (BC):** render about 500–1,000 teacher episodes with our cameras.
    - That is about 2–4 h of GPU: 14 s per variant (10-20 note), with up to a 2.4× gain from 4 parallel envs
      (`memory/multi-env-ground-checker.md`).
    - Mix them with the SANT human copies.
  - **Rounds 1–2 (DAgger):** run the student in random training-side scenes and record its states. Have the teacher
    label the action it would take at each visited state; add those, retrain.
    - This is the textbook fix for "the policy drifts and never recovers", which is our failure mode.
    - `sim_worker/recovery.py` already restores mid-episode states and generates expert continuations [L], so a
      scripted-expert labeller exists today.
- **The teacher can be the RL policy (general) or the scripted expert (`sim_worker/scripted.py`, hand-written for this
  task) [L].** The scripted one is the de-risked fallback.

### 2.5 Where human demos still add value, and where RL does better [J, grounded in the papers]

| Human demos are better at | RL / expert is better at |
|---|---|
| Saying *what* to do: which object, which container, the order, "done" (the task spec; Nemotron turns it into goals) | Millimetre aiming, closing at the right height, holding before lifting |
| Seeding exploration: the start states and pre-grasp poses (DemoStart, Human2Sim2Robot) [E] | Recovering from off-nominal states (DAgger / IWR evidence in the 10-20 note) |
| Multimodal or stylistic choices: approach side, where in the bin, carry path (EgoMimic / MimicPlay: humans give cheap diversity) [E] | Thousands of consistent repetitions, with no "swoop", no hesitation and no yaw conflict |
| New tasks where nobody wants to write a reward or script | Tasks with a clear success test (we have one: `check_success`) |

**Blunt point [J].**
- For cube-in-bin, a 100-line scripted expert already exists and is better than the human at precision.
- The scientifically honest claim is not "human demos are more precise". It is:
  - a non-expert can define the task and seed it without writing code;
  - SANT plus a teacher turns that into a policy that works.
- To show the human's contribution, include an RL arm **with** demo-seeded resets vs **without** (pure from home).
  DemoStart and Human2Sim2Robot both show that demos help exploration [E]. Whether it holds for our easy task is
  unknown [J].

---

## Q3. Cosmos: what exists, what it is for, and whether we can use it

### 3.1 Models

| Model | Purpose | Size / memory | Source |
|---|---|---|---|
| **Cosmos-Transfer2.5-2B** | Video → video: re-skins a sim or real video under control signals (depth, edge, segmentation, blur) and a text prompt. Visual augmentation of sim data | **65.4 GB VRAM**, 1 GPU min; NIM says Hopper+ with **80 GB** | [E] https://docs.nvidia.com/cosmos/latest/transfer2.5/model_matrix.html, https://docs.nvidia.com/nim/cosmos/latest/support-matrix.html |
| Transfer timing | 93 frames at 720p/16 FPS: **264 s (H100 PCIe)** in one table vs 870 s (H100 PCIe, "Transfer2-2B") in another; B200 286 s. A 121-frame input takes about 534 s end to end on H100 PCIe | docs conflict | [E] https://docs.nvidia.com/cosmos/latest/transfer2.5/quickstart_guide.html, model matrix |
| **Cosmos-Predict2 / 2.5** | Image/video → future video (world model). Basis of DreamGen and GR00T-Dreams | Predict2-2B Video2World: **32.5 GB** at 480p; 82 s on RTX PRO 6000, 31 s on B200 | [E] https://docs.nvidia.com/cosmos/latest/predict2/model_matrix.html |
| **Cosmos-Reason2 (2B / 8B)** | Video VLM for physical reasoning, planning and judging | 8B BF16 needs > 56 GB; FP8 on H100 80 GB | [E] https://build.nvidia.com/nvidia/cosmos-reason2-8b/modelcard, https://docs.nvidia.com/nim/vision-language-models/1.7.0/support-matrix.html |
| **Cosmos 3 (Super, Nano; Edge coming)** | One model for reasoning, generation and action prediction | sizes UNVERIFIED (one source: Super 32B, Nano 8B) | [E] press release above; https://datanorth.ai/news/nvidia-launches-cosmos-3 |

### 3.2 What Cosmos is used for in robot data

- **Visual augmentation of sim demos (GR00T-Mimic / Isaac Lab "Augmented Imitation")** [E]
  https://isaac-sim.github.io/IsaacLab/develop/source/features/imitation-learning/augmented_imitation.html:
  - Franka stack: 1,000 Mimic demos plus 1,000 Cosmos-Transfer1-augmented copies.

  | Setting | Mimic 2k | Cosmos-Mimic 2k |
  |---|---|---|
  | Vanilla | 96.6% | **86.6%** (lower) |
  | Light intensity | 20% | 62% |
  | Light colour | 30% | 78% |
  | Background | 20% | 69% |
  | Table texture | 0% | 20% |

  - Cosmos buys **robustness to visual change**, not accuracy in the training look.
- **New tasks or environments from generated videos (DreamGen)** [E]: needs a fine-tuned video model, an inverse
  dynamics model and huge compute. The gains are moderate (Franka 23 → 37%, n = 10 rollouts).
- **Judging and reasoning (Cosmos Reason)**: could check demo intent. Our own pre-registered test found a VLM judge only
  ties simple code rules (59/60 vs 60/60; `docs/submission/README.md`) [L]. No reason to add another judge.

### 3.3 Can we run it without a big GPU?

- **Locally:** no. 32–65 GB is needed; the RTX 5080 has 16 GB [E/L].
- **build.nvidia.com hosted:**
  - `cosmos-transfer2.5-2b` is listed as an endpoint under the "API Trial Terms of Service" [E]
    https://build.nvidia.com/nvidia/cosmos-transfer2_5-2b. Its model page states:
    - inputs: a prompt under 300 words plus up to 4 control videos, at 1280×720;
    - best lengths are multiples of 93 frames;
    - output at 16 FPS.
  - `cosmos3-nano` and `cosmos3-nano-reasoner` are also listed [E] https://build.nvidia.com/models?q=cosmos.
  - Free-tier limits: about 40 requests per minute, from community and forum posts. Credits are reported both as
    phased out and as about 1,000 [E, conflicting]
    https://forums.developer.nvidia.com/t/credit-rate-limit-increase-request-1-000-5-000-credits-40-200-rpm/379108.
  - Fine for **a handful of showcase clips**, not for a dataset.
- **Nebius AI Cloud** [E] https://nebius.com/prices:

  | GPU | On demand, per hour | Preemptible, per hour |
  |---|---|---|
  | H100 | $4.50 | from $0.79 |
  | H200 | $5.40 | from $0.79 |
  | B200 | $8.50 | from $0.99 |
  | RTX PRO 6000 | $1.80 | from $0.79 |
  | L40S | from $1.55 | from $0.74 |

  - Nebius raised on-demand prices on Oct 1, 2026 [E] https://spheron.network/blog/nebius-h100-h200-pricing-2026.
  - **For Cosmos-Transfer2.5-2B:** H100, H200 or B200 (≥ 65 GB) [J]. RTX PRO 6000 (96 GB) should fit, but its timing
    is unknown. L40S (48 GB) does not fit [J from the VRAM numbers].
  - **For Isaac Sim on the cloud, if ever:** only RT-core GPUs (L40S, RTX PRO 6000). "GPUs without RT Cores (A100,
    H100) are not supported" [E] https://docs.isaacsim.omniverse.nvidia.com/latest/installation/requirements.html.
- **Brev:** I found no verified Brev price or Isaac Launchable page in this search (UNVERIFIED). Third-party L40S
  prices run $0.61–$1.95/h [E] https://www.thundercompute.com/blog/nvidia-l40-pricing.

### 3.4 Cost and time estimate for us [J, from the numbers above]

**Per episode:**
- About 10 s of our episode is about 160 frames at 16 FPS, so 2 Transfer chunks.
- At 264–870 s per chunk on one H100 (docs conflict), that is **9–29 min per episode per camera**.
- At $4.50/h, that is about **$0.65–$2.20 per episode per camera**.
- We have 2 cameras (front + wrist) that must be augmented consistently. Transfer works one video at a time, so the
  lighting may not match between views. That is a real risk for a two-camera policy.

**Totals:**

| Use | GPU hours | Cost (on demand) | Setup |
|---|---|---|---|
| 5 showcase clips for the video | about 1–3 | **$5–$15** | plus about 0.5–1 day: Linux VM, container/weights (tens of GB), NGC/HF access, our video-to-control conversion |
| 100 augmented training episodes (2 cameras) | **30–100** | **$135–$450** (preemptible about 5× cheaper, but it can be interrupted) | — |

**Data plumbing [J]:**
- Output is 720p at 16 FPS; our policy uses 128 px at 50 Hz.
- That means resampling and re-aligning actions to frames; we would also need depth and segmentation export from Isaac
  per camera.

### 3.5 Is it worth it within 9 days?

- **For the headline number: no [J].** Our eval scenes have fixed lighting and textures. NVIDIA's own data shows
  Cosmos copies lower in-distribution success (96.6% → 86.6%) [E].
- **For the story: maybe, as a small, clearly labelled extra [J].** Show one verified SANT copy re-skinned into 3
  looks ("same physics-checked motion, new kitchen") as the "path to real" step. The budget is $10–$30 and about 1 day,
  only after the main result is in.
- **Rules check [L].** `docs/HANDOFF.md` says runtime model calls must go to NVIDIA open models on Nebius Token
  Factory or Nebius AI Cloud. Running Cosmos on a Nebius AI Cloud VM complies. build.nvidia.com may not; ask the
  organisers or treat it as offline tooling and say so.

---

## Q4. Recommended approach for Oct 21–29 (submission Oct 30, 10:00 PDT)

### 4.1 The shape: the closest realistic version of the vision

```
human demo(s) (mouse / keyboard / webcam), in several scenes
  -> SANT: physics check, rule + Nemotron repair (grasp retime, yaw wrap), multiply -> verified copies     [exists]
  -> Teacher (precision): RL in Isaac Lab, seeded by those copies (demo-state resets + goal reward)        [new]
        fallback teacher: the scripted expert                                                               [exists]
  -> Student (camera policy, ACT): BC on human-SANT copies + teacher rollouts, then 1-2 DAgger rounds       [mostly exists]
  -> Pre-registered 40-seed eval (+ fresh 40), Fisher tests                                                [exists]
  (optional) Cosmos-Transfer: re-skin a few verified episodes for the video, on Nebius AI Cloud            [optional]
```

Nemotron stays the orchestrator:
- **scene from a sentence** (exists);
- **coach and repair** (exists);
- **label** (exists);
- **new:** emits the goal list and reward weights the RL teacher trains on, as a human-checked Eureka-style role.

### 4.2 Day by day [J]

| Day | GPU (one heavy job at a time, `gpu.lock`, sleep off) | CPU / code |
|---|---|---|
| **Oct 21** | Planned Stage-0 test: inference fixes (binarised gripper, n_action_steps 10–20 / temporal ensembling) on the existing checkpoint, practice seeds. **Then** a 30–60 min smoke run of the stock `IsaacContrib-Lift-Cube-Franka` PPO to calibrate time per iteration on the 5080 | Start the RL env: copy the contrib lift env; add our bin (static), our table and cube sizes, our 50 Hz joint-position action space; scene sampler = `sample_scene` ranges, training seeds < 5000 |
| **Oct 22** | Record about 24 human demos in 12 scenes (protocol in the 10-20 note); SANT repair and multiply (the planned arm B). First pick-place RL runs from demo-state resets | Torch reward terms mirroring `check_success`; a one-to-one check that the RL env's success equals `check_success` on 20 replayed episodes |
| **Oct 23** | RL runs 2–4 (reward fixes); train arm A (raw) and B (SANT) per the 10-20 pre-registration | Teacher-rollout exporter: RL policy actions → our Trajectory → replay with cameras → LeRobot. Write the pre-registration for arm C |
| **Oct 24 — GATE** | **Teacher ≥ 90% success on 200 random training-side scenes, judged by `check_success` in our eval env?** Yes: RL teacher. No: scripted expert as teacher; report RL as "in progress" | DAgger loop script (student rollouts → states → teacher labels → append) |
| **Oct 25** | Render 500–1,000 teacher episodes (2–4 h); train student C0 = SANT human + teacher BC | — |
| **Oct 26** | DAgger round 1 (≈ 200 student episodes labelled) → retrain C1; practice-seed checkpoint pick | Optional: the "RL without demo resets" ablation for the human-value claim |
| **Oct 27** | Confirmatory eval: arms A, B, C on seeds 5020–5059, plus fresh 5400–5439 | Optional Cosmos: one Nebius H100 VM, 3–5 showcase clips |
| **Oct 28–29** | Buffer for one rerun; video, README results table, honest-limits section | — |

### 4.3 Success, in numbers (to pre-register) [J, anchored on the cited papers]

| Arm | Expected | Strong | Anchor |
|---|---|---|---|
| A: raw human (multi-scene, about 24 demos) | 0–6/40 | — | our 0/40 and 3/40 |
| B: SANT-multiplied human | 6–14/40 | ≥ 11/40 (p < 0.05 vs 3/40) | our 17/40 with scripted 10×10; MimicGen 0 → 51% Pick-Place with 1,000 copies |
| C: B + teacher BC + 1 DAgger round | 16–28/40 | ≥ 28/40 (70%) | ResiP's student about 78–80% of a 98% teacher; DemoStart 97% real after distillation |
| Teacher in sim (state) | 85–99% | ≥ 95% | DemoStart 98–99.7%; ManiSkill PickCube near 100% |

The headline sentence, if C lands: "From about 24 mouse demos by a non-expert, SANT plus a sim teacher produced a
camera policy at X/40 vs Y/40 for the raw demos (p = …), in simulation."

### 4.4 Risks and mitigations [J]

1. **RL reward hacking or no learning.**
   - Start from Isaac Lab's working lift rewards; add stages one at a time; watch videos of 4 envs every run.
   - Day-4 gate → scripted teacher.
2. **The RL env differs from the eval env** (gains, friction, soft floor, cube mass, control rate): a 95% teacher
   could score far lower under replay in `sim_eval`.
   - Validate the teacher **in the eval env** by replaying its actions as trajectories.
   - Use identical robot configs (`sim_worker/robots.py`).
3. **Distillation gap** (ResiP: about 20 points).
   - DAgger, shift augmentation, and 224 px or the dilation option (10-20 note).
4. **GPU time.**
   - RL (no cameras) and eval (cameras) cannot overlap safely (`memory/gpu-one-heavy-renderer.md`).
   - Schedule RL overnight; keep the PC from sleeping (`memory/pc-sleeps-during-unattended-runs.md`); keep Isaac in
     the foreground or opt out of EcoQoS (`memory/windows-throttles-background-isaac.md`).
5. **Attribution confusion.**
   - Label every arm's data sources (human / SANT copies / teacher).
   - Never call teacher data "human".
6. **Isaac Lab 3.0 API churn.**
   - The contrib task names changed from v2 (local registry above).
   - Copy the local files, not online v2 tutorials.

### 4.5 What NOT to do in these 9 days [J]

- Do not train Cosmos or DreamGen / GR00T-Dreams models. The compute is far beyond reach (1,500 L40s × 54 h for
  DreamGen's big run) [E].
- Do not use Cosmos-augmented data in the headline arms. It lowers in-distribution success [E].
- Do not do PPO from camera pixels for the main teacher, and do not port the student to rsl_rl. Use state RL and keep
  ACT.
- Do not move Isaac to the cloud. H100 is unsupported; L40S or RTX PRO 6000 would need a full Linux re-setup [E/J].
- Do not switch policy class (Diffusion Policy, VLA, GR00T N1) mid-sprint.
- Do not add multi-object scenes, distractors, deformables, or a second robot to the headline.
- Do not use Nemotron or Cosmos Reason as the success judge: physics decides (our own pre-registered result).
- Do not claim real-robot capability, or "learned from one demo", unless the arm actually used one demo.
- Do not report best-of-many checkpoints on the confirmatory seeds. Select on practice seeds only.

### 4.6 Where each piece runs

| Piece | Where | Why |
|---|---|---|
| Isaac sim, SANT multiply, RL teacher, ACT training, eval | Local RTX 5080 16 GB | Works today; Isaac needs RT cores; no setup cost |
| Nemotron (scene creator, coach, repair, labels, reward weights) | Nebius Token Factory | Hackathon rule; about $0.001 per call measured (`docs/submission/README.md`) |
| Cosmos-Transfer showcase (optional) | Nebius AI Cloud, 1× H100/H200, a few hours | Needs ≥ 65 GB; complies with the rules; $10–$30 |
| Extra parallel eval or rendering (only if desperate) | Nebius L40S / RTX PRO 6000 VM ($1.55–$1.82/h) | RT cores; but 0.5–1 day of setup: probably not worth it |

---

## Sources (all accessed 2026-10-20)

**Generation and imitation:**
- MimicGen: https://ar5iv.labs.arxiv.org/html/2310.17596, https://arxiv.org/pdf/2310.17596
- DexMimicGen: https://arxiv.org/html/2410.24185v2
- SkillMimicGen: https://arxiv.org/pdf/2410.18907
- DemoGen: https://arxiv.org/abs/2502.16932 (numbers not retrieved)
- Isaac Lab Mimic (humanoids): https://isaac-sim.github.io/IsaacLab/release/3.0.0/source/features/imitation-learning/humanoids_imitation.html
- Isaac Lab augmented imitation (Cosmos): https://isaac-sim.github.io/IsaacLab/develop/source/features/imitation-learning/augmented_imitation.html

**NVIDIA pipeline:**
- GR00T-Mimic blog: https://developer.nvidia.com/blog/building-a-synthetic-motion-generation-pipeline-for-humanoid-robot-learning
- GR00T N1: https://arxiv.org/pdf/2503.14734
- DreamGen: https://research.nvidia.com/labs/gear/dreamgen, https://arxiv.org/html/2505.12705v2
- R2D2 blog: https://developer.nvidia.com/blog/r2d2-training-generalist-robots-with-nvidia-research-workflows-and-world-foundation-models/
- Data Factory Blueprint: https://aibusiness.com/robotics/nvidia-intros-data-factory-robotics-models-for-physical-ai, https://www.automate.org/ai/industry-insights/nvidia-declares-big-bang-of-physical-ai-at-gtc-2026
- Cosmos 3: https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Launches-Cosmos-3-the-Open-Frontier-Foundation-Model-for-Physical-AI/default.aspx

**RL with demos:**
- DemoStart: https://arxiv.org/html/2409.06613v2
- ResiP: https://arxiv.org/html/2407.16677v4
- DPPO: https://arxiv.org/html/2409.00588v1
- IBRL: https://arxiv.org/html/2311.02198v4
- RLPD: https://ar5iv.labs.arxiv.org/html/2302.02948
- Human2Sim2Robot: https://arxiv.org/html/2504.12609v3
- Video2Policy: https://arxiv.org/html/2502.09886v1
- Eureka: https://alphaxiv.org/overview/2310.12931v1
- DrEureka: https://arxiv.org/html/2406.01967v1

**Human video:**
- Phantom: https://arxiv.org/pdf/2503.00779
- EgoMimic: https://arxiv.org/pdf/2410.24221
- MimicPlay: https://arxiv.org/html/2302.12422v2
- DexMV: https://arxiv.org/abs/2108.05877
- R+X: https://arxiv.org/pdf/2407.12957
- ViViDex: https://alphaxiv.org/overview/2404.15709v3

**Isaac Lab and RL timing:**
- Distillation config: https://isaac-sim.github.io/IsaacLab/main/_modules/isaaclab_rl/rsl_rl/distillation_cfg.html
- Performance benchmarks: https://isaac-sim.github.io/IsaacLab/main/source/overview/reinforcement-learning/performance_benchmarks.html
- Tiled rendering: https://docs.nvidia.com/learning/physical-ai/getting-started-with-isaac-lab/latest/an-introduction-to-robot-learning-and-isaac-lab/03-available-robots-and-environments/03-tiled-rendering.html
- Arm learning path: https://learn.arm.com/learning-paths/laptops-and-desktops/dgx_spark_isaac_robotics2/1_7dof_robot_arm/
- Isaac Lab Arena: https://isaac-sim.github.io/IsaacLab-Arena/release/0.3.1/pages/example_workflows/reinforcement_learning/index.html
- NVIDIA forum thread: https://forums.developer.nvidia.com/t/trying-to-train-isaac-lift-cube-franka-v0-example-task/320388
- Tampere thesis: https://trepo.tuni.fi/handle/10024/232306
- ManiSkill3: https://arxiv.org/pdf/2410.00425
- Genesis tutorial: https://genesis-world.readthedocs.io/en/latest/user_guide/policy_training/examples/manipulation.html
- Isaac Sim requirements: https://docs.isaacsim.omniverse.nvidia.com/latest/installation/requirements.html

**Cosmos and clouds:**
- Transfer2.5 model matrix: https://docs.nvidia.com/cosmos/latest/transfer2.5/model_matrix.html
- Transfer2.5 quickstart: https://docs.nvidia.com/cosmos/latest/transfer2.5/quickstart_guide.html
- Cosmos NIM support matrix: https://docs.nvidia.com/nim/cosmos/latest/support-matrix.html
- Predict2 model matrix: https://docs.nvidia.com/cosmos/latest/predict2/model_matrix.html
- Cosmos-Reason2-8B: https://build.nvidia.com/nvidia/cosmos-reason2-8b/modelcard
- build.nvidia.com Cosmos listing: https://build.nvidia.com/models?q=cosmos
- Cosmos-Transfer2.5-2B endpoint: https://build.nvidia.com/nvidia/cosmos-transfer2_5-2b
- NVIDIA forum on credits and rate limits: https://forums.developer.nvidia.com/t/credit-rate-limit-increase-request-1-000-5-000-credits-40-200-rpm/379108
- Nebius prices: https://nebius.com/prices
- Nebius price change: https://spheron.network/blog/nebius-h100-h200-pricing-2026
- L40S prices: https://www.thundercompute.com/blog/nvidia-l40-pricing

**Local files read:**
- `C:\isaac\IsaacLab\VERSION`
- `C:\isaac\IsaacLab\source\isaaclab_tasks\isaaclab_tasks\contrib\lift\**`
- `C:\isaac\IsaacLab\source\isaaclab_tasks\isaaclab_tasks\core\lift\config\{franka,kuka_allegro}\**`
- `C:\isaac\IsaacLab\source\isaaclab_rl\isaaclab_rl\rsl_rl\distillation_cfg.py` (existence)
- `C:\dev\pm-t8\src\demo_pipeline\{success,goals}.py`
- `C:\dev\pm-t8\sim_worker\{scripted,recovery}.py` (signatures)
- `C:\dev\pm-t8\docs\HANDOFF.md`
- `C:\dev\pm-t8\docs\superpowers\notes\2026-10-20-research-cube-in-bin.md`
- project memory notes as cited
