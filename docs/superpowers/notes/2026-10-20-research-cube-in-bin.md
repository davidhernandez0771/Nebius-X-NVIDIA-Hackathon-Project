# Research: making "red cube → blue bin" train well from human demos (2026-10-20)

Read-only research. Nothing was run on the GPU, Isaac was not started, nothing was installed, and no code was edited.
All measurements below come from CPU-only numpy reads of existing files in `C:\dev\pm-t6\data` and `C:\dev\pm-t3\data`.
The scratch scripts are in this session's scratchpad and are not committed.

**Evidence tags used throughout:**
- **[M]** measured here from our own files (the path is given).
- **[L]** from the literature (the URL is given).
- **[G]** a guess or inference: plausible, but untested.

## Executive summary

1. **[M] The 10 mouse demos were all recorded in one scene.** Cube (0.50, 0.00, yaw 0), bin (0.50, 0.30); the
   teleop sink uses `base_scene()`. The eval samples 40 random scenes, so `raw_10` was tested on a distribution it
   never saw. Its 0/40 says little about the human data itself.
2. **[M] The SANT policy grasps from a 2-second-old plan made far from the cube.** Every 100-step ACT chunk runs
   open loop (`n_action_steps = 100`). The human demos close at frames 63–216, about 1.3–4.3 s in.
   - So the close is planned at t = 0 or t = 2 s, while the arm is still far away.
   - In 9 traced seeds the first close is 1–6 cm off in xy and **15–96 mm too high** (demos: about 5 mm).
   - At chunk boundaries the arm target jumps by a median of **0.24 rad**, against 0.010 rad within a chunk.
3. **[M] Half of the gripper commands are "half-closed".** 48% of the SANT policy's eval steps send a finger
   target of 5–35 mm. The scripted-data policies sent 4.5–9%, and every training label is exactly 0 or 40 mm.
   - The eval applies these targets as they are. A finger target under 25 mm is narrower than the 5 cm cube.
4. **[M] The human grasp is a "swoop".** The hand is in the last 3 cm above the grasp for a median of 7 frames
   (0.14 s), closes while still moving at 0.17 m/s, and lifts 14 frames later.
   - The scripted data that reached 17/40 instead stops (0.01 m/s), spends 16 frames in the last 3 cm and holds
     39 frames before lifting.
5. **[M] The multiplier gives look-alike cubes conflicting wrist labels.** It turns the wrist by the full cube yaw
   (±90°), while the scripted expert turns only to the nearest face (±45°).
   - Of 700 training pairs whose cubes look the same (yaw mod 90 within 5°), 324 have wrist turns more than 45°
     apart.
   - This is "action divergence" (Belkhale 2023). The scripted multiplied data had the same flaw, so it lowers the
     ceiling but is not the whole story.
6. **[M] Images are 128×128 AV1 video (crf 30), two cameras (front and wrist), with augmentation off.**
   - At 128 px, ResNet-18 gives a 4×4 feature map per camera. ACT used 480×640 from 4 cameras [L].
   - The cube is about 7 px wide in the front camera.
   - The earlier grasp-fix traces already showed about 2–3 cm aiming error as the residual failure.
7. **[M] Training recipe.** 30k steps × batch 8 is about 7.6 passes over the 31.5k-frame SANT set and 78 passes
   over `raw_10`. LeRobot's ACT reference runs about 32 passes (80k steps, 20k frames).
   - The checkpoint is always the last one. robomimic finds the last or lowest-loss checkpoint 10–100% worse than
     the best one [L].
8. **[L] The literature agrees on what matters.**
   - Consistent, decisive demos (Belkhale; LeRobot "consistent grasping behavior").
   - Scene diversity over raw count (Lin 2024: about 50 demos per environment-object pair).
   - About 50 demos at 10 per location (LeRobot).
   - Wrist camera plus shift augmentation (robomimic: −47% relative without shifts).
   - Corrections at the failure state beat equal-cost full demos (IWR 87% vs 77%; RaC about 10× data efficiency).
9. **Plan, cheapest first: test 4 inference-only changes on the existing checkpoint (practice seeds, no new data).**
   - Binarize the gripper.
   - `n_action_steps` 20 or 10.
   - Temporal ensembling (0.01).
   - Both combined.
10. **Then fix the data in SANT's Neaten/Multiply steps.** No re-recording is needed for these:
    - wrap the wrist yaw to the nearest face (±45°);
    - retime the grasp: slow the last 4 cm to ≤ 5 cm/s, dwell 0.4 s closed before lifting;
    - add the grasp-fix approach-misalignment and centering.
11. **Then train better.** Shift augmentation on; `replace_final_stride_with_dilation = true` (or 224 px renders);
    60–100k steps with checkpoint selection on practice seeds.
12. **Record about 24 new human demos in 12 listed scenes (2 each).**
    - Technique: hover, then a slow final descent, a stop, close, hold 0.5 s, and a straight lift.
    - Cube yaw 0: mouse mode has no wrist-yaw control (`yaw_rad: 0`).
    - Keep inside the eval distribution: no cube-size, bin-rotation or distractor variation for the headline.
    - The teleop sink needs a scene-list option first (it uses `base_scene()`).
13. **Correction round.** Run the policy on training-side seeds, rewind 1 s before each failure (`sim_worker/recovery.py`
    already restores mid-episode states), and have the human (or the scripted expert) finish. About 30–40 verified
    copies.
14. **Pre-register raw_24 vs SANT_24 on seeds 5020–5059, two-sided Fisher at α = 0.05.**
    - SANT needs ≥ 11/40 against a raw 3/40, and ≥ 6/40 against 0/40.
    - Pooled with fresh seeds 5400–5439 (n = 80), power is 0.95 for 7.5% → 30%.
    - Tune only on practice seeds 5300–5349.
15. **Honest expectation [G].** A significant gain over raw is likely if items 9–13 land. 50%+ is a stretch: the
    best policy so far, trained on scripted data, reached 20/40 (50%), and Isaac Lab Mimic reports about 40–60% for
    stacking from 1000 generated demos [L].

---

## Part 1: Literature, what makes few-demo pick-and-place imitation work

Each line says what the source shows, then "→ us" for what it means here. Claims whose numbers we could not verify
are marked UNVERIFIED.

### 1.1 Demo count vs diversity

- **Lin et al. 2024, "Data Scaling Laws in Imitation Learning for Robotic Manipulation"**
  (https://arxiv.org/abs/2410.18647, https://arxiv.org/html/2410.18647)
  - Generalization follows a power law in the number of environments and objects. The number of demos per
    environment saturates instead: about 400, 800 and 1,600 demos for 8, 16 and 32 environment-object pairs.
  - Their recipe is about 50 demos per environment-object pair, in as many environments as possible. With
    32 × 50 they reach 85–92.5% in unseen environments.
  - → us: diversity matters more than count. Recording 10 demos in one scene is the worst case for the raw arm. SANT
    multiplication supplies diversity, but only around one human grasp style.
- **Gao et al. 2024** (https://arxiv.org/abs/2403.05110): a collection strategy that accounts for how factors
  compose reached 77.5% in new environments, against 2.5% for naive collection.
- **LeRobot docs** (https://huggingface.co/docs/lerobot/il_robots): "recording at least 50 episodes, with 10
  episodes per location"; "Avoid adding too much variation too quickly."
- **SmolVLA's SO-100 data** (https://arxiv.org/html/2506.01844): "10 trajectories for each of 5 distinct starting
  positions … 50 demonstrations per dataset."
- **robomimic** (https://arxiv.org/abs/2108.03298): with 20% of the 200 proficient-human demos (about 40), Lift and
  Can already reach 75–100%.
- No paper we found cleanly ablates N distinct initial states × M repeats for single-task pick-place.

### 1.2 Action quality and consistency

- **Belkhale, Cui, Sadigh 2023, "Data Quality in Imitation Learning"** (https://arxiv.org/abs/2306.02437)
  - Action divergence (inconsistent actions in similar states) hurts, especially with small data. State noise can
    help in the large-data regime.
  - On robomimic human data, success falls as action variance and horizon rise: Square PH 58% → "Worse" 2%, Can PH
    96% → "Worse" 22%. The "Worse" data also had multimodal grasp locations.
  - Their advice: "expert data should be curated to have more consistent actions." Pauses and noise raise
    divergence, and speed helps only if divergence does not rise.
  - → us: both the wrist-yaw relabelling and the "close while moving" timing are action divergence at the grasp.
- **robomimic** (https://ar5iv.labs.arxiv.org/html/2108.03298)
  - Multi-human data does worse than proficient-human data despite more demos.
  - Removing the wrist camera costs 9% relative on Square and 43% on Transport. Removing pixel-shift augmentation
    costs 47% and 35% relative.
  - Selecting the checkpoint by validation loss or taking the last one is "10% to 100%" worse than the best.

### 1.3 Speed, pauses, idle frames, multimodality at the grasp

- **ACT paper** (https://ar5iv.labs.arxiv.org/html/2304.13705)
  - Chunking helps with pauses that "are hard to model with Markovian single-step policies."
  - "Humans will also be more stochastic in regions where precision matters less"; human data is "a lot harder."
- **Diffusion Policy** (https://arxiv.org/html/2303.04137v5): single-step baselines "get stuck … when the idle
  actions are not explicitly removed."
- **openpi DROID notes**
  (https://github.com/Physical-Intelligence/openpi/blob/main/examples/droid/README_train.md): filtering idle chunks
  "can improve policy performance."
- **Isaac Lab Mimic tips**
  (https://isaac-sim.github.io/IsaacLab/main/source/features/imitation-learning/teleop_imitation.html)
  - "Keep demonstrations short"; "Take a direct path"; "Do not have extended pauses. Instead, perform smooth,
    continuous motions."
  - A SpaceMouse is better than a keyboard.
- **BID (Liu et al. 2024)** (https://arxiv.org/html/2408.17355v2)
  - With multimodal demos, closed-loop re-planning gives "jittery behavior when attempting to grasp."
  - Temporal averaging "can be detrimental when consecutive decisions fall into distinct modes."
- **Tension to resolve.** Isaac Lab says no long pauses. Our best data (scripted, 17–20/40) has a 0.5 s stationary
  grasp hold and a hover. Our reading [G]: a short, deterministic dwell tied to a visible state (fingers closing on
  the cube) is not an "idle pause". It gives the policy a consistent, observable grasp event. What hurts is
  *random* hesitation. No paper tests grasp dwell directly; this is unverified.

### 1.4 ACT specifics

| Item | ACT paper / repo | LeRobot default | Ours |
|---|---|---|---|
| Control rate | 50 Hz | (dataset fps) | 50 Hz |
| Chunk size k | 100 | 100 | 100 |
| Executed open loop | ensembled every step (paper) | `n_action_steps = 100` (whole chunk) | 100 (2 s) |
| Temporal ensemble coefficient | exp(−m·i); 0.01 per the LeRobot comment | None (off) | off |
| KL weight | 10 | 10 | 10 |
| Images | 480×640, 4 cameras (2 wrist) | — | 128×128, front + wrist |
| Learning rate, batch | 1e-5, 8 | 1e-5, 8 | 1e-5, 8 |
| Decoder layers | 7 (only the first used: bug) | 1 | 1 |
| Training | 2000 epochs; real data ≥ 5000 epochs or "3-4 times the length after the loss has plateaued" | about 80–100k steps | 30k |

Sources for the table:
- Paper: https://arxiv.org/abs/2304.13705.
- Repo: https://github.com/tonyzhaozh/act.
- LeRobot config:
  https://raw.githubusercontent.com/huggingface/lerobot/main/src/lerobot/policies/act/configuration_act.py.
- LeRobot docs: https://huggingface.co/docs/lerobot/act.

Notes:
- **What an ACT "epoch" is.** In the original repo it is not a pass over frames. `EpisodicDataset.__len__` returns
  the number of episodes, and each item samples one random timestep (https://github.com/tonyzhaozh/act, `utils.py`).
  So 2000 epochs × 40 training episodes / batch 8 is about **10k gradient steps**. Our 30k steps exceeds that.
  LeRobot's `act_aloha_sim_transfer_cube_human` used 80k steps
  (https://huggingface.co/lerobot/act_aloha_sim_transfer_cube_human): 83.0% vs 68.0% for the original-repo model.
- **Scripted vs human data in ACT** (paper Table I, sim transfer cube): lifted 90% vs 60%, transferred 86% vs 50%.
  - The CVAE matters with human data: removing it drops success from 35.3% to 2%.
  - Chunking: k = 1 gives 1%, k = 100 gives 44% (without ensembling).
  - Temporal ensembling adds 3.3% for ACT.
- **ACT repo tip:** "If your ACT policy is jerky or pauses in the middle of an episode, just train for longer!"
- **LeRobot ACT** "Often achieves high success rates with just 50 demonstrations"
  (https://huggingface.co/docs/lerobot/act).
- → us: we run the whole 2 s chunk open loop with no ensembling. The ACT paper's headline numbers come from a policy
  queried every step. With human data, open-loop chunks commit the grasp from a stale observation (section 2.3).

### 1.5 Diffusion Policy vs ACT with small data

- **Diffusion Policy** (https://arxiv.org/html/2303.04137v5)
  - Strong on robomimic proficient-human data (image Lift/Can about 1.00, Square 0.98 max).
  - Position control beats velocity control.
  - Execution horizon Ta = 8 is best; "Too long a horizon reduces performance."
  - Random crop is essential (84 → 76 px).
  - Trained for 3000–4500 epochs.
  - No ACT comparison.
- **Mobile ALOHA** (https://arxiv.org/html/2401.02117), co-trained / not: ACT Wipe Wine 95/50 vs DP 65/35; ACT
  Push Chairs 100/100 vs DP 100/80.
- **SmolVLA SO-100, about 50 demos** (https://arxiv.org/html/2506.01844): ACT pick-place 70%, π0 100%, SmolVLA 75%.
- **"Demystifying Action Space Design"** (https://arxiv.org/html/2602.23408v1): ACT progress scores EE-abs 63.4,
  EE-delta 78.4, joint-abs 71.2, joint-delta 79.7. Delta beats absolute; chunk-wise delta beats step-wise.
- **Verdict [G]:** no rigorous ACT-vs-DP comparison exists at about 10 demos. Switching policy class is a
  large-effort, uncertain change. Fixing the data and inference first is the better bet. DP (LeRobot `diffusion`,
  random crop on, n_action_steps 8) is a reasonable *second* arm if time allows.

### 1.6 Action space and gripper

- **Action space:**
  - Delta, chunk-relative actions beat absolute in a 13k-rollout study (above).
  - UMI (https://arxiv.org/html/2402.10329): relative trajectory 20/20, delta 16/20, absolute 5/20.
  - We use absolute joint targets. Switching is moderate effort (export plus inference rebasing). Medium priority.
- **Gripper:** no controlled study of binary vs continuous gripper actions in BC was found.
  - OpenVLA-OFT binarizes with `np.sign` at inference
    (https://huggingface.co/iMihayo/custom_robotwin/blame/main/policy/openvla_oft/robot_utils.py).
  - A VLA benchmark thresholds at 0.5 (https://arxiv.org/pdf/2411.05821).
  - MimicGen adds action noise "excluding gripper actuation" (https://ar5iv.labs.arxiv.org/html/2310.17596).
  - IL policies fail to notice failed grasps without a gripper-state signal (https://arxiv.org/abs/2503.23835).
    We already feed finger joint positions as state.
  - → us: our labels are binary and our eval applies continuous outputs, so thresholding is a natural zero-cost fix
    [G].

### 1.7 Augmentation and noise injection

- **DrQ** (https://ar5iv.labs.arxiv.org/html/2004.13649): ±4 px random shift is "the most effective technique."
- **robomimic:** no pixel shift costs 47% relative (Square).
- **MimicGen agents:** pixel shift up to 10%.
- **DART** (https://arxiv.org/abs/1703.09327): inject noise *during collection* so demos show corrections. Average
  62% improvement over BC in grasping in clutter.
- **Belkhale:** state noise helps; action noise in the labels hurts with small data.
- → us: LeRobot's built-in `image_transforms` (RandomAffine translate 0.05 plus color jitter) is off in our runs.
  SANT can do DART-style perturbation in sim for free, as the grasp fix's "approach misalignment" already did.

### 1.8 MimicGen-style generation and source quality

- **MimicGen** (https://arxiv.org/abs/2310.17596)
  - 10 human source demos → 1000 generated per task.
  - Image BC-RNN: Square D0 90.7%, D1 73.3%, D2 49.3%. Pick Place D0 50.7%, from 0% source-only.
  - Big gain from 200 → 1000 generated demos; little gain from 1000 → 5000.
  - Source count matters little (10 vs 50 vs 200: 2–21%).
  - Low-quality operators still reach about 90% on Square D0, but drop more on broader distributions.
  - Interpolation detail matters: Pick Place 50.7% → 11.3% when interpolation changed.
- **Isaac Lab Mimic, Franka stack** (docs link above): 10 demos → 1000 generated (about 40% generation success),
  BC-RNN policy about 40–60%. "The final epoch is not always optimal."
- → us: our x10 gives 110 episodes, far below MimicGen's 1000, and x30 did not help at a fixed 30k steps
  (sprint 8). [G] Larger x only helps if training scales with it. Broader scene distributions cost in-distribution
  success (D0 → D1), so keep generation inside the eval distribution for the headline.

### 1.9 Interactive corrections (DAgger family, "rewind and retake")

- **IWR** (https://ar5iv.labs.arxiv.org/html/2012.06733): start from 30 demos; each round adds intervention data of
  about 33% of the initial set.
  - Threading: IWR 87.3%, HG-DAgger 75.3%, more full demos 76.7%, base 58.0%.
  - Coffee: 87.5% / 69.6% / 64.9% / 52.0%.
- **RaC** (https://arxiv.org/html/2509.07953v1): rewind to a familiar in-distribution state, then correct.
  - Shirt hanging 78.3% from 5 h of data, against 75.0% from about 89 h.
  - Rules: pair each recovery with a correction, and end the episode after the intervention.
- **Sirius** (https://arxiv.org/abs/2211.08416): +8% in sim and +27% on real hardware.
- **ThriftyDAgger** (https://arxiv.org/abs/2109.08273).
- **HG-DAgger** (https://arxiv.org/abs/1810.02890): numbers UNVERIFIED.
- → us: a correction round at the observed failure states (high close, empty-gripper cycling at the bin) is the
  most evidence-backed way to add "what to do when off-nominal" data.

### 1.10 Co-training and typical reports

- **Mobile ALOHA co-training** (https://arxiv.org/html/2401.02117): Wipe Wine 95 vs 50; 35 demos co-trained beat
  50 demos alone.
  - → us: co-training human SANT data with the scripted 10×10 set is a cheap possible booster. It would confound a
    "human data" claim, so use it as a secondary arm only.
- **Reference successes:**
  - ALOHA sim transfer cube: about 90% scripted / 50% human (paper); LeRobot human model 83%.
  - SO-100 ACT pick-place with about 50 demos: 70%.
  - Isaac Lab Mimic stack: 40–60%.
  - LeIsaac SO-101 + ACT runs exist (https://wiki.seeedstudio.com/simulate_soarm101_by_leisaac/), but success
    numbers are UNVERIFIED.

### 1.11 Cameras and resolution

- **Hsu et al. 2022** (https://arxiv.org/abs/2203.12677): an eye-in-hand view "consistently improves training
  efficiency and out-of-distribution generalization." Numbers UNVERIFIED.
- **robomimic real Can:** 73.3% → 43.3% without the wrist camera.
- **Resolutions in use:** ACT 480×640; robomimic and MimicGen 84×84; Diffusion Policy 84–320×240. No controlled
  resolution sweep was found.
- **DETR, which ACT's image encoder descends from** (https://arxiv.org/abs/2005.12872): DC5 dilation "increases the
  resolution by a factor of two, thus improving performance for small objects." AP_S rises from 20.5 to 22.5 at
  about 2× FLOPs.
  - → us: LeRobot ACT exposes `replace_final_stride_with_dilation`, which gives 8×8 instead of 4×4 tokens at
    128 px.

---

## Part 2: Audit of our pipeline (C:\dev\pm-t8 on `pm/live-12`; data in C:\dev\pm-t6\data)

### 2.1 What is actually trained and evaluated [M]

| Item | Value | Where |
|---|---|---|
| Policy | LeRobot ACT, all defaults except steps and batch | `lerobot_tools/experiments.py:train_cell` |
| Saved config | chunk_size 100, **n_action_steps 100**, temporal_ensemble_coeff null, kl 10, dim 512, 4 enc / 1 dec layers, VAE on, ResNet-18 ImageNet, lr 1e-5, wd 1e-4, no scheduler | `pm-t6/data/experiments/hx_mouse20261020_20261020_164411/train/perfected_multiply_10/checkpoints/030000/pretrained_model/config.json` |
| Observations | `observation.state` = 9 joint positions (7 arm + 2 fingers); `observation.images.front` and `.wrist`, **3×128×128** | same, and `sim_worker/scene_cfg.py` (`IMAGE_SIZE = 128`) |
| Action | 9 **absolute joint position targets** (fingers 0.04 open / 0.0 closed in the labels) | `lerobot_tools/export.py`, `sim_eval/eval_policy.py` |
| Rate | 50 Hz record, replay, train and eval | `meta/info.json` fps 50 |
| Video storage | AV1, crf 30, g 2, yuv420p, 128 px | `meta/info.json` |
| Augmentation | `dataset.image_transforms.enable = false` | `train_config.json` |
| Steps / batch | 30,000 / 8; checkpoint every 2,500; **the last one is evaluated** | registry, results note |
| Training time | about 23 min for 30k steps (110 episodes) | results note |
| Eval | serial, seeds 5020–5059, 30 s, start = the raw dataset's first frame (home); finger targets applied **as output** (continuous) | `sim_eval/isaac_env.py:_apply` |
| Front camera | eye (1.35, 0.15, 0.65) → target (0.45, 0.15, 0.05); 24 mm focal, 20.955 mm aperture (about 47° horizontal field of view) | `sim_worker/scene_parts.py`, `scene_cfg.py` |
| Wrist camera | on panda_hand, offset (0.13, 0, −0.15) (copied from Isaac Lab's stack visuomotor config) | `scene_cfg.py` |

**Derived [M/G]:**
- The front camera is about 1.08 m from the table centre. 128 px across about 0.94 m is about **7.4 mm per pixel**,
  so the 5 cm cube is about 7 px wide.
- ResNet-18 has stride 32, so each camera gives a **4×4 token grid**. Each token covers about 24 cm of table in the
  front view.
- The grasp tolerance is about ±1.5 cm (the grasp-fix note: failures had > 15 mm closing-axis offsets). That is about
  2 px in the front image.

### 2.2 Training data, measured [M]

Script: `demos.py` / `scripted.py` (scratch). They read `steps.npz` and `signals.npz` per episode.

| Quantity | Human mouse, raw `_home` (10) | Human `_rules_home` + 100 variants | Scripted 10×10 (sprint 6/7, 17/40) |
|---|---|---|---|
| Recording scenes | **1** (cube 0.50, 0.00, yaw 0; bin 0.50, 0.30) | 1 source scene + 100 sampled | 10 sampled + 100 sampled |
| Episode length, median [range] | 270 [223–438] frames (5.4 s) | 283 [190–420] | 482 [446–522] (9.6 s) |
| Total frames | 3,057 | 31,536 | 53,170 |
| Close frame, median | 95 | 88 / 120 | 130 |
| Frames in the last 3 cm before the close | **7** [4–23] | 7 [4–24] | **16** [15–16] |
| Hand speed in the 0.1 s before the close | **0.17 m/s** [0.02–0.31] | 0.17 | **0.01 m/s** |
| Close → cube lifted 1 cm | **15 frames** [10–22] | 14 | **39 frames** |
| TCP − cube at the close, z / xy | 5 / 10 mm | 5 / 9 mm | −1.8 / 2.7 mm (grasp-fix note) |
| Gripper changes per episode | 2 (one close, one open) | 2 | 2 |
| Gripper label vs observation lag | 0 frames | 0 | 0 |
| Idle frames (< 1 cm/s) | 33 [11–134] | 12–19 | 78 [70–87] |
| First-frame joints | identical (home) | identical | identical |
| Wrist turn at the close vs the start | **0°** (mouse sends `yaw_rad: 0`, see (e)) | **−84…+89°** | −133…+170° (multiplied) / ±44° (sources) |

**Findings:**
- **(a) Single-scene recording.** `sim_worker/scripts/teleop_sink.py` builds `scene = base_scene()`, and all 40
  human episode folders hold the same `scene.json`. The raw arm therefore measures one-scene → 40-scene
  generalization. That is not a fair test of "raw human data".
- **(b) Grasp phase.**
  - The human grasp occupies about 22 frames (0.44 s) from 3 cm above to the cube lifted. The scripted grasp
    occupies about 55 frames (1.1 s).
  - The human closes while still descending at about 0.17 m/s. The scripted expert closes stationary and holds
    0.5 s.
  - The "repair" step's `remove_pause` and trim removed idle frames: idle went from 33 to 12–19 in the variants.
    That pushes in the opposite direction from the scripted data.
- **(c) Yaw relabelling.**
  - `demo_pipeline/multiply.py:transform_trajectory` carries the hand rigidly with the cube's full yaw change. The
    cube yaw is sampled in ±90° (`SCENE_RANGES`).
  - The scripted expert wraps yaw: "The cube looks the same every 90 degrees: turn the wrist at most 45"
    (`sim_worker/scripted.py`).
  - Measured: of 700 human-variant pairs with the same visible yaw (within 5° mod 90), **324 (46%)** have wrist
    turns more than 45° apart. In scripted multiplied data it is 398/627.
  - Caveat: the 10-18 grasp-fix note found success does not depend on |yaw mod 90| (p = 0.84). The effect may be
    small for scripted data; it is unproven either way.
- **(d) Labels are clean.** Binary finger labels, no gripper flicker, start state identical to the eval start, and
  (per the floor-labels note) no label more than 3.7 mm under the soft floor.
- **(e) Mouse and keyboard teleop has no wrist-yaw control.** `web/src/record/drive/drive.ts:driveMessage` always
  sends `yaw_rad: 0`. Only the webcam path maps hand yaw (`demo_pipeline/teleop.py`, ±90° limit).
  - So a human mouse demo can only grasp a cube at yaw ≈ 0 (mod 90). All wrist rotation in the training data comes
    from the multiplier.
  - This is fine *if* the multiplier wraps yaw (finding c). A human demo in a yawed scene would need a yaw control,
    for example Q/E keys or the scroll wheel.

### 2.3 What the SANT policy does, from the 10-20 traces [M]

Source: `pm-t6/data/trace_eval_20261020/evals/hx_mouse20261020_20261020_164411/trace_*_traces/seed_*.npz`. These are
9 SANT seeds (5031–5039) and 3 raw seeds. Scripts: `traces.py`, `traces2.py`, `traces3.py` (scratch).

- **The first close is near the cube but too high.**
  - The first close comes at steps 83–191: inside the first or second chunk, planned at t = 0 or t = 2 s.
  - xy error at that close is **8–58 mm**. The TCP is **15–96 mm above the cube centre**; the demos close at about
    5 mm.
  - Max cube lift across the 9 seeds is 0–10 mm. Finger-cube contact lasts 0–25 frames.
  - So the "dropped 26/40" in the results note is mostly "brushed it while closed", not "lifted and lost".
- **After the failed close the policy carries on with the demo script.**
  - Most later closes happen *closer to the bin than to the cube*: 6 of 9 seeds, e.g. 5031 "C2 B11 B5 B2 …", where
    C = near the cube and B = near the bin, in cm.
  - It cycles open/close 10–21 times per episode and touches the bin in 35–345 frames.
  - This matches the human demo's sequence (close → carry → open at the bin) running open loop without checking that
    the grasp succeeded. The caller's summary ("cycles … near the cube") is only true for 5037, and partly 5038/5039.
- **The chunk boundaries are discontinuous.** The arm-target jump at chunk starts (t mod 100 = 0) has a median of
  **0.244 rad** (p90 0.42), against 0.010 rad within a chunk. Raw_10: 0.044 against 0.008.
  - 28 of 283 gripper transitions fall exactly on a chunk boundary (about 1% expected by chance).
  - Each new 2 s plan disagrees sharply with where the previous one left the arm: low confidence and an
    off-distribution state.
- **Half-closed fingers.**
  - Of the SANT policy's steps, **48%** send a finger target of 5–35 mm (raw policy: 47%).
  - For comparison, the scripted-data policies sent 4.5% (grasp_diag, 20 traces) and 9.0% (centered, 40 traces):
    `pm-t3/data/evals/grasp_diag_20261018`, `grasp_fix_centered_20261018_141822`.
  - The training labels contain **0%** intermediate values.
  - The eval sends these straight to the finger PD. Below 25 mm per finger, the opening is narrower than the 5 cm
    cube.
- **Earlier scripted-data traces** (grasp-fix note, 10-18): the residual failure is aiming, 15–33 mm lateral at the
  hover and fingers landing on the cube top.
  - The yaw correction was learned; the position correction "barely."
  - That is consistent with a resolution and closed-loop limit, not only a data-quantity limit [G].

### 2.4 Mismatches with best practice, ranked by our estimate of impact

| # | Mismatch | Evidence | Expected impact | Effort |
|---|---|---|---|---|
| 1 | **Raw arm recorded in 1 scene, evaluated on 40 random scenes** (not fair to raw; also leaves SANT's variants with one source grasp style) | [M] scene.json; [L] Lin 2024, LeRobot 10/location | Large for the experiment's validity | Small code: scene list in the teleop sink, plus re-record |
| 2 | **Open-loop 2 s chunks**: the grasp is planned from a far-away view; boundaries jump 0.24 rad | [M] traces; [L] ACT ensembling, DP Ta = 8, Mobile ALOHA chunk 45 | Large [G] | Tiny: set `n_action_steps` / `temporal_ensemble_coeff` when loading the policy (inference only, no retrain) |
| 3 | **Continuous finger targets applied directly; 48% are half-closed** | [M] traces vs labels | Medium–large [G] | Tiny: threshold at 0.02 m with hysteresis in the policy server or eval env |
| 4 | **Swoop grasp**: 7 frames in the last 3 cm, closes at 0.17 m/s, lifts after 15 frames | [M]; [L] Belkhale consistency, LeRobot "consistent grasping" | Large [G]; it is the main data difference from the 17/40 scripted set | Small: a Neaten "grasp retime" repair; or re-record with the protocol in Part 3 |
| 5 | **Yaw relabelling ±90°** (46% of look-alike pairs conflict) | [M]; [L] Belkhale action divergence | Medium [G] (not detected in scripted data, p = 0.84) | Tiny: wrap dyaw so the grasp turn is the nearest face, ±45° |
| 6 | **128 px, 4×4 tokens, cube about 7 px** | [M]; [L] ACT 480×640, DETR-DC5 small objects | Medium [G] (explains 2–3 cm aiming error) | Tiny (`--policy.replace_final_stride_with_dilation=true`) or medium (`IMAGE_SIZE` 224 and re-render) |
| 7 | **Augmentation off** | [M]; [L] robomimic −47%, DrQ | Medium | Tiny: `--dataset.image_transforms.enable=true` (consider only the affine/translate transform) |
| 8 | **Last checkpoint, about 7.6 passes for the SANT set** | [M]; [L] robomimic checkpoint choice, ACT "train longer", LeRobot 80–100k | Medium | Small: raise `MAX_STEPS` from 60k to 100k; select on practice seeds |
| 9 | **No correction data** (never seen off-nominal states) | [M] grasp-fix; [L] IWR, RaC, DART | Medium–large | Medium: `sim_worker/recovery.py` exists (scripted continuation); human continuation needs UI |
| 10 | **AV1 crf 30 at 128 px** for training, raw renders at eval | [G] possible train/test gap; unmeasured | Unknown, probably small | Tiny check: decode one frame and compute PSNR against the PNG |
| 11 | **Absolute joint actions** | [L] delta beats absolute (+8 progress points for ACT) | Small–medium | Medium (export plus inference rebasing) |
| 12 | Only about 110 episodes | [L] MimicGen 1000; our own x30 = x10 at fixed steps | Unknown | Free in the sim (14 s per variant), but training must scale |

---

## Part 3: The plan

### (a) Recording protocol for the human (mouse)

**Before recording (code, not done here).** Let the teleop sink cycle a scene list instead of `base_scene()`, for
example a `--scenes scenes.json` argument and a "next scene" control. Each demo's `scene.json` then records its
scene. Use training-side seeds/poses only (< 5000).

**Technique: one consistent style, every take.**
1. **Start at home.** Move up and over the cube at a steady pace, about 0.2–0.3 m/s. Take a direct path.
2. **Hover** about 10 cm above the cube top (TCP z ≈ 0.15). Stop for about 0.3 s, centred over the cube in the
   Record HUD's top view.
   - Mouse mode cannot turn the wrist (`yaw_rad` is always 0), so the recorded scenes use cube yaw 0. The
     multiplier supplies yaw, wrapped to ±45°.
   - If a Q/E yaw control is added later, turn to the *nearest* face and never more than 45°. The yawed column of
     the scene table then applies.
3. **Descend slowly and straight down**, about 1 s for the last 5 cm (≤ 5 cm/s). Stop with the fingertip centre at
   the cube's mid-height (TCP z ≈ 0.025). The Record HUD's side view helps.
4. **Close, then stay still about 0.5 s.** Count "one-and". Do not start lifting while closing.
5. **Lift straight up** to about 0.20 m, at least 0.15 m to clear the 0.09 m rim with the cube. Only then move
   sideways.
6. **Carry** at a steady pace. Stop above the bin centre. Descend to about 0.10 m above the bin floor.
7. **Open, wait about 0.3 s, rise straight up** about 10 cm, then stop. End the take.
8. **Retakes:** if anything goes wrong (a re-grasp, a bump, a hesitation), *Stop & discard* before saving. No
   re-grasps inside a kept take: consistency is the point (Belkhale; LeRobot "maintain consistent grasping
   behavior").
9. **Target take length:** about 7–9 s, close to the scripted 9.6 s.
   - This deliberately contradicts "quick grasps". The dwell and slow descent give 2–3× more frames in the grasp
     phase, and a chunk boundary is likely to land during the hover.
10. **Soft floor:** on is fine; report it as before.

**How many.** **24 demos = 12 scenes × 2**, about 30–40 min including discards. Optionally record 12 more (scenes
1–12 once more) for a 36-demo arm if time allows. The literature anchor is about 50 total at 10 per location
(LeRobot), or 50 per environment (Lin). SANT multiplication is the stand-in for the remainder.

**Scene list.** All 12 are inside the eval sampler's ranges (cube x 0.40–0.60, y ±0.20, yaw ±90°; bin x 0.40–0.65,
y ±0.30, unrotated). All pass the 0.15 m edge-gap rule, checked with a re-implementation of `sample_scene`'s test.
The gap check used the yaws below; at yaw 0 every gap is equal or larger.

**With today's mouse mode, record every scene at cube yaw 0.** The yaw column applies only once a yaw control
exists.

| # | Cube x, y (m), yaw (only with a yaw control) | Bin x, y (m) | Why |
|---|---|---|---|
| 1 | 0.50, −0.10, 0° | 0.50, 0.25 | near the old scene, shifted |
| 2 | 0.42, −0.18, 30° | 0.60, 0.20 | near-left cube, long diagonal carry |
| 3 | 0.58, −0.15, −20° | 0.45, 0.22 | far cube, carry toward the robot |
| 4 | 0.45, 0.15, 15° | 0.55, −0.25 | bin on the −y side (reverse carry) |
| 5 | 0.58, 0.18, −40° | 0.42, −0.20 | far corner, near-45° yaw |
| 6 | 0.50, 0.05, 40° | 0.62, −0.28 | bin at the far −y reach edge |
| 7 | 0.42, 0.00, −10° | 0.62, 0.28 | bin at the far +y corner |
| 8 | 0.60, 0.00, 25° | 0.42, 0.30 | edge-gap 0.161 (tight) |
| 9 | 0.40, 0.20, −30° | 0.60, −0.15 | cube corner nearest the robot, +y |
| 10 | 0.60, −0.20, 10° | 0.45, 0.15 | cube at the far −y corner |
| 11 | 0.52, −0.05, 44° | 0.50, 0.28 | yaw at the ±45° face flip |
| 12 | 0.47, 0.12, −44° | 0.58, −0.25 | yaw at the flip, the other side |

**Variations deliberately *not* recorded for the headline:** cube sizes, bin rotation, rim height, distractors.
- None exist in the eval distribution (`sim_eval/scenes.py` uses `sample_scene`: a 5 cm cube, an unrotated bin, no
  distractor).
- MimicGen shows broader generation distributions lower in-distribution success (Square D0 90.7 → D1 73.3).
- Keep them for a separate, clearly labelled generalization demo: for example a 4 cm and 6 cm cube, bin yaw ±30°, one
  green distractor cube. That needs eval-side support first.

### (b) Multiplication axes, ranked

1. **Cube xy over the full eval range.** Already done. Keep it.
2. **Bin xy over the full eval range.** Already done. Keep it.
3. **Cube yaw with grasp-yaw wrapping (new).** Rotate the pre-grasp path by the source-to-target yaw *reduced mod 90°
   to [−45°, 45°]*, which is the same grasp on the cube's nearest face. Removes the 46% conflicting look-alike
   pairs. [M] and [L]; tiny effort.
4. **Grasp retiming (new Neaten op).** At the source's close event:
   - insert a 0.3 s hover about 10 cm above;
   - re-time the last 4 cm of descent to ≤ 5 cm/s (min-jerk);
   - hold the hand still with the gripper closed for 0.4 s;
   - lift straight up to 0.15 m before rejoining the carry.

   Verify every copy in physics as usual. This turns human swoops into the scripted-style grasp the 17–20/40
   policies saw, while keeping the human's own approach, carry and release. [G]; small effort.
5. **Approach misalignment, then centring.** Already built in the grasp fix (`homeset.rehome(approach_offset,
   approach_yaw)`): 3 cm disc, ±35°, 0.2 s hover, slow centring. Apply it to the human variants. It taught yaw
   correction before (wrist error at the close fell to 5°). Position correction was weak, so also raise the offset
   radius to about 4 cm, beyond the measured 33 mm failure offsets. [M]
6. **More copies per demo: x10 → x20**, but *only* if training steps scale (below). x30 showed no gain at a fixed
   30k steps.
7. **Not for the headline:** start-pose jitter (the eval always starts at home), lighting/texture/camera jitter (the
   eval renders are fixed), and cube size or mass.

### (c) Training and inference changes, ranked by impact ÷ effort

**Stage 0: inference-only, no new data, about 2–3 h of eval.**
- Use the existing `perfected_multiply_10` 30k checkpoint on *practice* seeds 5300–5329 (n = 30, fresh).
- Exploratory, not a claim.

| Variant | Exact setting |
|---|---|
| S0 baseline | as is (`n_action_steps = 100`) |
| S1 binarized gripper | finger target := 0.04 if mean(fingers) > 0.02, else 0.0 (eval-side, `GRIPPER_OPEN/CLOSED`); optional hysteresis: close below 0.015, reopen above 0.03 |
| S2 shorter execution | `n_action_steps = 20` (re-plan every 0.4 s), plus S1 |
| S3 temporal ensembling | `temporal_ensemble_coeff = 0.01`, `n_action_steps = 1` (query every step), plus S1 |

- **Implementation (code, not done here):** `PolicyRunner.__init__` could take overrides and set `cfg.n_action_steps`
  / `cfg.temporal_ensemble_coeff` after `PreTrainedConfig.from_pretrained`. These fields are not weights.
- **Watch for** the BID warning: with multimodal data, more re-planning can jitter. S3 averages; S2 does not.
- Whichever of S1–S3 wins becomes the inference setting for every later arm, frozen before the confirmatory run.

**Stage 1: training recipe for all new arms. The same recipe goes to every arm.**

| Rank | Change | Value | Basis |
|---|---|---|---|
| 1 | Shift/affine augmentation | `--dataset.image_transforms.enable=true`; ideally only `affine` (translate 0.05, ±5°) plus mild brightness/contrast, `max_num_transforms=2` | robomimic −47% without it [L] |
| 2 | Finer image tokens | `--policy.replace_final_stride_with_dilation=true` (8×8 tokens at 128 px). If budget allows, `IMAGE_SIZE = 224` and re-render (requires re-running the sim stage) | DETR-DC5 [L]; aiming error [M] |
| 3 | Longer training plus checkpoint selection | 80k steps (raise `MAX_STEPS` 60k → 100k), save every 10k. Evaluate 40k / 60k / 80k on practice seeds 5300–5329 (n = 30); most successes wins, a tie goes to the later checkpoint | robomimic, ACT repo, LeRobot 80–100k [L]; about 1 h of training at 128 px |
| 4 | Chunk size | keep `chunk_size = 100` for training (inference handles execution); optional ablation `chunk_size = 50` | Mobile ALOHA used 45 [L]; delta-action study prefers shorter execution |
| 5 | Keep the CVAE on (`use_vae`), KL 10, lr 1e-5, batch 8 | unchanged | ACT: the CVAE is essential with human data [L] |
| 6 | Delta (chunk-relative) joint actions | later, medium effort | +8 progress points for ACT [L] |
| 7 | Diffusion Policy arm | only if time remains: LeRobot `diffusion`, crop on, `n_action_steps = 8` | DP small-data strength [L]; no head-to-head at 10 demos |

### (d) Correction round: "rewind to the failure and retake"

Reuse `sim_worker/recovery.py` and the overnight runner (`sim_eval/scripts/overnight_recovery.py`). They already
restore a traced mid-episode state with zero velocities and verify the continuation in physics. They were built for
grasp-fix run 2 and never run on the GPU; `pm-t3/data/evals/recovery_run2` is empty.

1. **Rollouts.** Run the Stage-1 SANT policy, traced, on **training-side scenes**, e.g. 60 scenes from seeds
   4000–4059 (not eval seeds; the eval code refuses < 5000, so this needs the `scene_plan` training-scene path).
2. **Failure detection** (existing modes plus two new ones from section 2.3):
   - `hover` misaligned (> 10 mm or > 10°);
   - `on_top`;
   - `empty_closed`;
   - **`high_close`** (new): the gripper commanded closed with the TCP > 15 mm above the cube centre and no lift
     within 0.5 s;
   - **`empty_at_bin`** (new): closing or opening within 15 cm of the bin with no cube in the fingers.
3. **Rewind** 1.0 s (50 steps) before the detected step. Keep only states that restore faithfully (the existing
   rules: cube flat and still, hand slow).
4. **Retake.**
   - **4a, automatic (cheap):** the scripted continuation already in `recovery_trajectory`: reopen → rise → centre →
     grasp → lift → place.
   - **4b, human (SANT's story):** load the state into the Record page and let the human finish with the mouse using
     the protocol above. End the take once the cube is in the bin (RaC: end after the intervention).
5. **Verify** every copy with the unchanged `check_success`. Label the lineage `recovery-…` (`assemble` already
   excludes those from `n_human`), but **log the human minutes** for 4b.
6. **Size:** about 30–40 verified copies, which is about 30% of the base set (IWR's per-round size). Retrain from
   scratch on base + copies with the identical Stage-1 recipe. One round; a second only if time allows.
7. **Fair comparison** for the correction arm: equal *human time*, i.e. SANT + corrections vs SANT + the same minutes
   of extra full demos (multiplied). This is IWR's "more full demos" baseline.

### (e) Pre-registered experiment (fair, comparable with the existing 40-seed eval)

Write and commit this before any new demo is recorded.

- **Demos:** every saved mouse take in the 12-scene list from the new session (expected N ≈ 24). Same selection,
  freeze and assist-reporting rules as `2026-10-20-kb-raw-vs-sant-prereg.md`. Refusal if N < 12.
- **Arms** (identical Stage-1 recipe and the Stage-0-chosen inference setting):
  - **A, `raw_N`:** the N demos as recorded (achieved-path replay, start-aligned). Every demo, verified or not, as in
    the last pre-registration.
  - **B, `sant_N`:** rules repair + grasp retime + yaw wrap + approach misalignment/centring, then ×10 verified
    variants.
  - **C (secondary), `sant_N_corr`:** B plus one correction round (d), 4a or 4b, declared in advance.
  - **D (optional, secondary), `scripted_10x10` retrained** with the same recipe: an upper reference only, never part
    of the human-data claim.
- **Checkpoint selection, per arm:** 40k / 60k / 80k on practice seeds 5300–5329 (n = 30); most successes wins, a
  tie goes to the later checkpoint. Practice seeds are never reported as results.
- **Primary endpoint:** success on **seeds 5020–5059, n = 40 per arm**, serial `eval_cells`, 30 s, front + wrist,
  start = home.
  - **Test:** two-sided Fisher exact on B vs A, α = 0.05, Wilson 95% CIs.
  - Decision thresholds at n = 40, computed here: against A = 0/40, B needs ≥ 6/40; against 3/40, ≥ 11/40; against
    17/40, ≥ 27/40.
- **Pre-registered secondary:** the same chosen checkpoints on fresh seeds **5400–5439**. Report the pooled n = 80
  per arm (Fisher). This guards against having tuned on 5020–5059 over many runs.

  Power at α = 0.05, two-sided Fisher, computed here by exact enumeration:

  | True rates | n = 40 | n = 60 | n = 80 |
  |---|---|---|---|
  | 7.5% → 30% | 0.68 | 0.86 | 0.95 |
  | 20% → 50% | 0.75 | 0.91 | 0.98 |
  | 30% → 60% | 0.72 | 0.89 | 0.96 |
- **Other secondaries (descriptive):** C vs B; per-failure-mode counts (high close, drop, collision, empty at bin);
  the half-closed finger fraction; first-close height.
- **Training variance:** one training seed (1000) per arm is primary. If GPU time allows, a second seed (1001) per
  arm is reported descriptively.
- **Budget estimate:**
  - sim stage about 1 h per N = 24;
  - training about 1 h per arm at 80k and 128 px (about 2.5 h at 224 px);
  - practice selection 3 × 30 episodes ≈ 1.5 h per arm;
  - confirmatory 40 + 40 episodes ≈ 1.5 h per arm.

  About 5–6 h per arm, so A + B fit one long session, and C fits the next day. One heavy GPU job at a time, under
  `gpu.lock`, with sleep disabled.

### Order of work (suggested)

1. **Day 0, about 3 h GPU:** Stage 0 inference ablation on the existing checkpoint. It is cheap, needs no new data,
   and tells us whether chunking and the gripper are the bottleneck.
2. **Day 0, CPU:**
   - implement yaw wrap, the grasp-retime repair and the scene-list recording;
   - unit-test them;
   - run a decode-PSNR check of the AV1 frames.
3. **Day 1:** record about 24 demos (12 scenes × 2) with the protocol. Write the pre-registration first.
4. **Day 1–2:** run arms A and B.
5. **Day 2–3:** correction round and arm C.
6. **Day 3+:** optional 224 px re-render or DP arm, only if B is still under about 30%.

### What would change this plan

- **If Stage 0 shows S2/S3 + S1 lifting the existing checkpoint from about 3/40 to over 20% on practice seeds**,
  inference was the main bottleneck. Then grasp retime and corrections become refinements.
- **If Stage 0 changes nothing**, the data (swoop grasp, yaw conflict) and the resolution are the main suspects, and
  the re-recorded, retimed arm B is the critical test.
- **If raw_N (multi-scene) already does well**, for example over 10/40, SANT's value has to show as the B − A gap,
  which may be smaller than hoped. Report it as is.

---

## Appendix: sources of our own numbers

**Data read:**
- Mouse experiment:
  - `C:\dev\pm-t6\data\human_exp\mouse20261020\store\demos\*\episode\{steps.npz, signals.npz, scene.json, episode.json}`
  - `C:\dev\pm-t6\data\experiments\hx_mouse20261020_20261020_164411\` (datasets `meta/info.json`, `manifest.json`;
    the checkpoint's `config.json` and `train_config.json`)
  - `C:\dev\pm-t6\data\trace_eval_20261020\evals\hx_mouse20261020_20261020_164411\trace_*_traces\seed_*.npz`
- Scripted reference:
  - `C:\dev\pm-t3\data\experiments\sprint6_home_a_20261016_205725\datasets\{raw_10, raw_multiply_10}\manifest.json`
    → `C:\dev\pm-t2\data\episodes\*`
  - `C:\dev\pm-t3\data\evals\{grasp_diag_20261018, grasp_fix_centered_20261018_141822}\*_traces\*.npz`

**Code read:**
- `lerobot_tools/{train, experiments, export, assemble, start_state, policy_server}.py`
- `sim_eval/{scenes, eval_policy, isaac_env}.py`
- `sim_worker/{scene_cfg, scene_parts, scripted, recovery, robots, teleop_session}.py`
- `sim_worker/scripts/teleop_sink.py`
- `src/demo_pipeline/multiply.py`

**Notes read:** `2026-10-20-mouse20261020-results.md`, `2026-10-20-floor-labels.md`, `2026-10-20-kb-raw-vs-sant-prereg.md`,
`2026-10-18-t3-grasp-fix.md`.

**Scratch scripts** (not committed; this session's scratchpad): `traces.py`, `traces2.py`, `traces3.py`, `demos.py`,
`scripted.py`, `yaw.py`. They are pure numpy. The power and threshold numbers came from a short exact Fisher
enumeration in Python.
