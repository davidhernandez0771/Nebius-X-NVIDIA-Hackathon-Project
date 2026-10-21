# SANT: Devpost submission draft, in the form's fields (2026-10-21)

<!-- For the user to paste into Devpost from Sunday 2026-10-25. The deadline is Fri 2026-10-30, 10:00 a.m. PDT.
     The structure follows the real form, field by field.
     Sources: docs/submission/description.md, feedback.md and video_script.md, the README and the dated notes. Each
     number cites its note in an HTML comment.
     Markers:
     - TODO (USER): only the user knows it;
     - TODO (RESULT): fill it when today's teacher and distillation runs land
       (docs/superpowers/notes/2026-10-21-distill-prereg.md);
     - SUGGESTED: a proposed answer with its evidence. The user decides. -->

---

# OVERVIEW

## Project name (â‰¤ 60 characters)

SANT: perfect one robot demo, then multiply it

<!-- 46 characters. Shorter alternative: "SANT: Perfect, then multiply" (28). -->

## Elevator pitch (â‰¤ 200 characters)

Record a sloppy robot demo with a webcam, keyboard or mouse. SANT checks it in NVIDIA Isaac Lab physics, repairs it
with code or Nemotron, and multiplies it into verified training data.

<!-- 185 characters, counted with Python (len) on the two lines joined by a space. -->

---

# DETAILS

## About the project (Markdown + LaTeX)

Paste everything between the two rules below.

---

**SANT** stands for **S**imulate Â· **A**ugment Â· **N**eaten Â· **T**rain. *Perfect one demo, then multiply it.*

### Inspiration

Robot policies learn by imitating human demonstrations, and they need a lot of them.
- **Collecting them is the expensive part.** Teleop rigs cost \$6kâ€“\$80k, operators cost \$25â€“\$50 an hour, and 20â€“30%
  of demos are thrown away (vendor estimates).
  <!-- src: docs/superpowers/specs/2026-10-15-perfect-then-multiply-design.md Â§2 -->
- **A webcam is almost free, but its demos are sloppy.** The hand pauses, shakes and grabs off centre, and it presses
  the gripper into the bin.
- **Existing multipliers start from good demos.** NVIDIA's Isaac Lab Mimic multiplies demos that already succeed, and
  its tutorial throws away any demo with a mistake.

We asked about the step before that: can a sloppy human demo be **checked in physics**, **repaired**, and only then
**multiplied** into many good ones?

### What it does

You record a pick-and-place demo in the browser. Your hand drives a simulated Franka arm in **NVIDIA Isaac Lab**, live,
through a webcam, the keyboard or the mouse. A 3D twin shows the arm from behind, the side and above. Then SANT runs:

1. **Physics check.** Isaac Lab replays the demo with real contact forces. Code decides success: the cube is in the
   bin, the gripper is open and the cube has settled, with no hard collision and no drop.
2. **Repair (Neaten).** A demo that fails is repaired, then checked again.
   - **The rules** pick from a fixed, tested menu: trim, remove pauses, smooth, retime, recentre the grasp, release
     above the bin.
   - **NVIDIA Nemotron** reads what the simulator measured and writes small edits to the hand's path. Code rejects
     any edit that is too large, leaves the workspace or isn't smooth. Physics checks every plan it accepts.
3. **Multiply.** A verified demo is moved to new cube and bin positions. Every copy is replayed, and only the copies
   that pass are kept.
4. **Train and test.** Only verified demos are exported, as a LeRobot dataset, each with a record of where it came
   from and every repair. An ACT policy trains on it, and Isaac Lab tests the policy on 40 scenes it has never seen.

**The rule:** the AI proposes, code checks, physics decides. The model never moves the robot, and it never overrules
the physics check.

We report each policy's success as $\hat p = k/n$ on $n = 40$ unseen scenes, with a Wilson 95% interval. Arms are
compared with a two-sided Fisher exact test. Every test is pre-registered: its seeds, rules and thresholds are
written down and committed before anything runs.

### How we built it

- **A pure-Python core** (`src/demo_pipeline`, numpy + pydantic). The backend, the Isaac worker and the dataset
  exporter all import it, so they share one contract. It holds:
  - the success check;
  - the repair ops;
  - the multiply transform;
  - the trajectory-edit language;
  - the statistics.
- **The sim worker** (Isaac Sim 6.2 + Isaac Lab 3.0, on Windows 11). It runs:
  - a pick-place scene with contact sensors and front and wrist cameras;
  - differential-IK replay with joint-velocity feed-forward;
  - a live teleop sink. The sink saves the path the arm actually took, not the hand's targets, which it lagged by
    2.5â€“5 cm.
- **NVIDIA Nemotron on Nebius Token Factory** (OpenAI-compatible API):
  - `nvidia/Nemotron-3.5-Super-VL` labels demos and judges intent from camera frames;
  - `nvidia/nemotron-3-super-120b-a12b`, with thinking on, is the trajectory repairer and the scene creator (a sentence
    â†’ a validated scene plan).
- **The backend and the web:** a FastAPI backend with a WebSocket teleop relay, a demo store and a pipeline API, and a
  React + three.js site.
- **The experiments:** one command per experiment.
  - It freezes every demo by content hash and writes the pre-registration before anything trains.
  - A GPU lock lets only one heavy job run at a time on our single 16 GB GPU.
- **The RL teacher â†’ camera student** (today's work):
  - a PPO teacher trained in Isaac Lab (rsl_rl, 4,096 parallel envs), started from SANT-verified human demos;
  - the teacher distilled into the ACT camera policy, with DAgger rounds if needed.
- **The tests:** built tests-first, with every AI call mocked: 2,618 Python tests and 1,789 web tests pass.
  <!-- src: docs/superpowers/notes/2026-10-20-live-13-merge.md. TODO (RESULT): re-count on the submission commit. -->

### Results (measured; each one is in the repo's notes)

| What | Result |
|---|---|
| Scripted demos: 10 alone vs 10 + 100 verified copies | **3/40 vs 17/40**, Fisher **p = 0.0005** |
| The same with 300 copies, trained separately | **16/40** |
| 10 real webcam demos, physics as recorded | **0/10** pass (the gripper pressed into the bin, up to 927 N against a 5 N limit) |
| Rules repair â†’ multiply | 3/10 repaired â†’ **24/30** copies verified |
| Blind repair test: Nemotron edits vs rules | 5/10 vs 3/10 (p = 0.50), then **2/10 vs 3/10** in the re-run (p = 1.0). **Not significant, and it did not replicate** |
| 10 real mouse demos: raw vs SANT (pre-registered) | **0/40 vs 3/40**, p = 0.24. **Not significant** |
| Isaac Lab Mimic on SANT's repaired demos | SANT verified Mimic's output at the same rate as its own multiplier: 82% vs 80% (p = 0.79). It rejected 9 of Mimic's 100 self-reported successes |
| RL teacher â†’ distilled camera policy (pre-registered, goal â‰¥ 24/40) | **TODO (RESULT):** k/40, Wilson CI, Fisher p vs 3/40 and vs 0/40 |

<!-- src: 2026-10-15-t3-status.md (sprint 7â€“8); 2026-10-19-live-test-10-results.md; 2026-10-20-nemotron-repair.md;
     2026-10-20-mouse20261020-results.md; 2026-10-20-mimic-export.md; 2026-10-21-distill-prereg.md.
     For the last row: p < 0.05 needs â‰¥ 11/40 vs 3/40, or â‰¥ 6/40 vs 0/40. Scripted multiply's 17/40 is a reference only. -->

**Not shown yet:** that SANT's data trains a better policy from *human* demos. Our only two-arm human test is not
significant, and we say so. TODO (RESULT): update after the distillation test.

### Challenges we ran into

- **Real hands fail physics, even when they "work".**
  - All 10 live webcam demos put the cube in the bin, and the pre-registered check failed every one.
  - Our first replays were wrong too, because we had saved the hand's targets, not the arm's motion.
- **Replays aren't exact.** PhysX isn't deterministic, and human grasps are marginal. So a demo can pass or fail by
  luck, which is why every claim is pre-registered and reported whatever it says.
- **Letting a language model edit a robot path safely.**
  - Code caps every edit at 5 cm from where the tool was at that moment, keeps it in a workspace box, and runs two
    smoothness checks.
  - The first real calls exposed two bugs in our own checks.
- **Measuring our own AI honestly.**
  - In a pre-registered 32-demo test, code alone diagnosed demos better than rules + Nemotron (F1 0.90 vs 0.86).
  - So Nemotron now proposes repairs instead of judging.
- **Imitation hit a ceiling on human demos.** The policies grasp the cube, then drop it or push into the bin. So we
  added an RL teacher that learns in Isaac Lab, starting from SANT's verified demos.
- **The teacher took five failed runs before the sixth.** Each one is logged in the pre-registration, and the
  success check, gate and test never changed.
  - **v1:** absolute actions threw the arm across the workspace.
  - **v2:** random gripper exploration dropped the held cube.
  - **v3:** the entropy bonus outweighed a tiny reward. Isaac Lab multiplies every reward term by the timestep.
  - **v4:** it settled too early, with the gripper left open.
  - **v5:** it explored, but lift stayed near 1%.
  - **v6:** a stock-lift-style reward, calibrated on 196 recorded episodes. TODO (RESULT): its outcome.
- **One GPU, many jobs.** Simulation, RL, training and the site share one RTX 5080. Windows sleep once killed CUDA
  mid-batch, which looked like a bad demo.

### Accomplishments that we're proud of

- **Multiplying made a better robot:** 3/40 â†’ 17/40 (p = 0.0005), and a separate 300-copy set replicated it (16/40).
- **The full loop with a real person, twice:** webcam (0/10 â†’ repaired 3/10 â†’ 24/30 copies) and mouse (10/10 â†’
  100/100 copies).
- **Tests that tell on us.** We published pre-registered results that went against us:
  - Nemotron's repair win didn't replicate;
  - code tied or beat Nemotron as a judge;
  - raw vs SANT on human demos was not significant.
- **SANT and Isaac Lab Mimic work together,** and SANT's check caught Mimic's false successes.
- **Everything on one Windows PC:** Isaac Lab, Mimic, RL with 4,096 envs, LeRobot training and the 3D site.

### What we learned

- **Physics is the judge.** In every pre-registered test, a vision-language model never beat a code check at saying
  whether a demo worked. Its value is in words: describing demos, proposing edits, writing scenes.
- **Verify every copy.** Multiplication only helps when each copy is replayed and checked.
- **Human demos need more than imitation.** Repaired, multiplied human demos verify well, but imitation on them trains
  weak policies. An RL teacher that starts from them is the next lever.
- **Pre-register, then report.** Two of our favourite results didn't replicate. Without the pre-registration we
  wouldn't have known.

### What's next

- **A fair two-arm test** on demos recorded across many scenes, raw vs SANT, pre-registered.
- **The hybrid repairer:** the rules first, then Nemotron where they fail, on fresh demos.
- **More teacher rounds:** DAgger on the student's own mistakes, and the teacher without the human demos, to measure
  what they add. TODO (RESULT): adjust to today's outcome.
- **More robots and tasks** through "bring your robot". Deformables (cables) come later.

---

## Built with (â‰¤ 25 tags)

nvidia-isaac-sim, nvidia-isaac-lab, isaac-lab-mimic, nvidia-nemotron, nemotron-3.5-super-vl, nemotron-3-super,
nebius-token-factory, python, pytorch, rsl-rl, lerobot, act, numpy, pydantic, fastapi, websockets, react, three.js,
typescript, vite, mediapipe, blender, uv, openai-python-sdk

<!-- 24 tags. Devpost suggests tags as you type; use its spelling where it differs. -->

## "Try it out" links

- Public repo: TODO (USER), the GitHub URL.
- Demo URL: optional for Physical AI. TODO (USER): add one only if the site is hosted.
- Maybe the video, if the form allows it as a link.

## Image gallery (suggest â‰¤ 15, 3:2)

These already exist in the repo. Two caveats:
- **They are SwiftShader (software) renders at 1280Ã—720 (16:9).** For 3:2, crop to 1080Ã—720, or better, re-shoot at
  1800Ã—1200 on the real GPU after training day. The real GPU looks better than SwiftShader.
- **Set the site's quality tier to `?q=high`** before shooting.

| # | Shot | File (under `docs/superpowers/notes/`) |
|---|---|---|
| 1 | The tesseract hero | `2026-10-20-live-12-merge/round9b-hero-1920.jpg` |
| 2 | The forest with the real robot models | `2026-10-20-forest-robots/01-franka-so101.jpg` |
| 3 | The reactor | `2026-10-20-live-12-merge/d03-reactor.jpg` |
| 4 | The workshop hub | `2026-10-20-live-13-merge/hub-1280.jpg` |
| 5 | Dragging a cartridge to the machine | `2026-10-20-machine-v2/04-plug-insert.jpg` |
| 6 | The machine's hologram replaying a verified demo | `2026-10-20-machine-v2/05-projection.jpg` |
| 7 | The robot wall | `2026-10-20-site-robots-real/02-robots-view.jpg` |
| 8 | Record (hologram page, twin views) | `2026-10-20-live-12-merge/d17-record.jpg` |
| 9 | Data showcase: a mouse demo, live vs repaired | `2026-10-20-data-showcase/01-mouse-live-vs-repaired.jpg` |
| 10 | Data showcase: a webcam replay, failed vs repaired | `2026-10-20-data-showcase/05-webcam-replay-failed-vs-repaired.jpg` |
| 11 | Data showcase: multiplying, variants arriving | `2026-10-20-data-showcase/07-live-variants-arriving.jpg` |
| 12 | Results: the proof (3/40 â†’ 17/40) | `2026-10-20-site-results-live/d-i2-proof.jpg` |
| 13 | Results: the repair A/B (shown with its re-run) | `2026-10-20-site-results-live/d-r4-repair-ab.jpg` |
| 14 | The pipeline page: the teacher recipe | `2026-10-20-live-13-merge/pipeline-teacher-5173.jpg` |
| 15 | Raw vs perfected demo in Isaac Lab (GIF â†’ still) | `docs/media/s1_0002_raw_vs_perfected.gif` (outside `notes/`) |

TODO (RESULT): swap one shot for an Isaac Lab frame of the RL teacher or the distilled student succeeding, if one is
recorded.

## Demo video (â‰¤ 3 minutes reviewed)

The full shot list, with the rules for what can be on screen, is `docs/submission/video_script.md`. Update it on the day
of recording for:
- **The hero:** shot 1 is now the tesseract hero and the real loader, not the glass logo.
- **The teacher:** a new beat after the results, about 15 s. TODO (RESULT): "An RL teacher, trained in Isaac Lab from
  the verified human demos, is distilled into the camera policy: k/40." Show the Isaac Lab clip if there is one.
  Otherwise use a card.
- **Token Factory:** a mention in the Nemotron shot. "Every Nemotron call runs on Nebius Token Factory: about 480
  calls and about a dollar for the whole project." Confirm the number first (see the feedback below).
- **Time:** to stay under 3:00, cut shot 4 (the ring, 10 s) and shorten shot 5 (the robot wall) to 6 s.

The condensed plan:

| Time | Picture | Voice-over (gist) |
|---|---|---|
| 0:00â€“0:10 | Loader â†’ tesseract hero | "Robots learn by copying people." |
| 0:10â€“0:25 | Forest: real robots in the moss; "927 N vs 5 N" | "They need hundreds of demos. A webcam is free, but human demos are sloppy: nine of our ten pressed into the bin." |
| 0:25â€“0:45 | Reactor: SÂ·AÂ·NÂ·T, the proof slab 3/40 â†’ 17/40 | "SANT checks every demo in Isaac Lab, repairs what fails and multiplies what passes. On scripted demos: 3 â†’ 17 of 40." |
| 0:45â€“1:00 | Workshop â†’ robot wall â†’ drag a cartridge onto the machine â†’ hologram | "A cartridge is a job. The machine replays a real, physics-checked demo." |
| 1:00â€“1:30 | `/record`: keyboard or webcam, three twin views, grid, save | "Drive the simulated arm with your hand, keyboard or mouse." |
| 1:30â€“2:05 | Cards: 0/10 as recorded â†’ one Nemotron plan â†’ the A/B with its re-run | "Nemotron, on Nebius Token Factory, reads the simulator's measurements and writes path edits. Code caps them; physics decides. 5/10 vs 3/10, then 2/10 vs 3/10: it adds to the rules." |
| 2:05â€“2:35 | Results page: 3/40 vs 17/40, then the mouse result (not significant) | "Copies make better robots on scripted demos. On human demos, not yet significant." |
| 2:35â€“2:52 | Isaac Lab: the RL teacher, then the student | TODO (RESULT) |
| 2:52â€“3:00 | Back to the hero, repo URL | "Perfect one demo, then multiply it." |

---

# ADDITIONAL INFO

## Submitter type

TODO (USER): individual or team. README "Team and history" names David Hernandez Del Risco and Susana Rojas.

## Organization name

TODO (USER) (or "none").

## Country / Canada province

TODO (USER).

## Track

**Physical AI.**

<!-- docs/HANDOFF.md still says "Best Apps and Agents" from the room-organizer version. Physical AI is the lead's and
     the user's choice. -->

## New project, or existing before Aug 26, 2026?

**New.**
- **Verified:** the repo's first commit is `1b0f357` "Initial commit", 2026-09-13 (`git log --reverse`, all
  branches).
- It started as a room organizer for this hackathon and became SANT on 2026-10-15.

TODO (USER): confirm no earlier private repo or prototype existed.

## Public repo URL, and what the repo must have

TODO (USER): the URL.

**Requirements checked on `pm/live-13`:**
- **An OSI license:** `LICENSE` is MIT. âœ“
- **A README with setup:** "Run it" points to `docs/RUNBOOK.md` Â§2, which covers a fresh Windows setup: the SANT
  venv, Isaac Sim + Isaac Lab, LeRobot, Node, the MediaPipe files and `DATA_DIR`. `.env` is set up from
  `.env.example` with `NEBIUS_API_KEY`. âœ“
- **The README must highlight Nemotron/NVIDIA models, where Token Factory accelerated the workflow, and any other
  Nebius tools.** Partly; see the gaps below.

**README gaps** (to fix before submitting):
1. **There is no "where Token Factory accelerated the workflow" text.** README Â§"Where NVIDIA Nemotron fits" has one
   line ("runs on Nebius Token Factory â€¦ well under 1 cent per call") and nothing on how it helped. Suggested points:
   - a 120B model and a VL model with no GPU of our own, while our one GPU ran Isaac Lab all day;
   - the OpenAI-compatible SDK, so no new client;
   - the free `/v1/models?verbose=true` listing as our price source;
   - `usage` on every reply, which powers our spend cap;
   - about 480 logged calls for about $1.14.
2. **No other Nebius tools are mentioned.** Say plainly: "We used only Nebius Token Factory; we did not use Nebius AI
   Cloud (all simulation and training ran on one local RTX 5080)."
3. **The model list is incomplete and dated.**
   - The README names `Nemotron-3.5-Super-VL` and `nemotron-3-super-120b-a12b`, but not their roles as repairer and
     scene creator, or why those sizes (see "Which models" below).
   - It doesn't mention the nano tier (`Nemotron-3_5-Lightning`), configured for Ask SANT.
   - "Status (2026-10-20)" predates the RL teacher and distillation, the Mimic result and the pipeline pages.
4. **NVIDIA software isn't summed up in one place.** Isaac Sim 6.2, Isaac Lab 3.0, Isaac Lab Mimic and Isaac Lab RL
   (rsl_rl PPO) appear across sections. A short "NVIDIA stack" list would help judges.
5. **The run commands mention `/pm/record` and `/pm/review`.** `/pm/record` redirects to `/record`, so it works, but
   the current page is `/record`. I didn't check `/pm/review`.

## Working demo URL

Not required for Physical AI. TODO (USER): add one only if the site is hosted.

## Which models, and why that size or variant

**Called, per our usage logs** (`usage_log.jsonl` in worktrees pm-t3, pm-t4, pm-t5 and pm-t7, 2026-10-15 â†’ 10-21; the
cost is our estimate from our price config and each reply's token counts):

| Model (Token Factory) | Calls | Est. spend | What for | Why this variant |
|---|---|---|---|---|
| `nvidia/Nemotron-3.5-Super-VL` | 249 | â‰ˆ $0.31 | Demo diagnosis (sprints 2â€“6), the labeler and the intent judge (pre-registered 40/40 and 59/60) | The only Nemotron that takes images: it reads 7 front frames + 1 wrist frame. A 1M context, and about $0.0013 a call |
| `nvidia/nemotron-3-super-120b-a12b`, thinking on | 234 | â‰ˆ $0.84 | The trajectory repairer (blind A/B), the scene creator, repair-request translation | A text task that needs multi-step reasoning about forces and geometry. The 120B mixture-of-experts (12B active) model with thinking is cheap enough for this, and we needed the reasoning more than the speed |
| **Total** | **483** | **â‰ˆ $1.14** | | |

**Configured but not in the logs:**
- **`nvidia/Nemotron-3_5-Lightning` (the nano tier):**
  - It is wired to the site's Ask SANT box, the command and query helpers, and `scripts/hello.py`.
  - It was called during the September scaffold. A code comment notes that it answers in 6 tokens with thinking off.
  - No logged call was found.
- **`nvidia/Nemotron-3-Ultra-550b-a55b`:** configured, and never called by any code path.

TODO (USER): check against the Token Factory billing page. Other machines or checkouts may have logged more.

## Nemotron quality, 1â€“10, and what worked or fell short

**SUGGESTED: 6/10.** The user decides.

**What worked:**
- **Strict JSON, almost always:** 0 retries in 42 ablation calls, and 4 in 68.
- **Pre-registered results:** labels **40/40** and intent **59/60**.
- **Repair requests in plain English:** 34/34 turned into the right ops, against 31/34 for a keyword parser.
- **Path edits that physics verified:** 5/10 vs the rules' 3/10 in the first blind test.
- **Real sentences into valid scene plans:** 4/5.
- **It uses feedback:** 3 of its 5 repairs passed only after it read a failed replay.

**What fell short:**
- **The repair didn't replicate:** 2/10 vs 3/10 in the re-run. Its plans vary from run to run.
- **It added nothing over code as a diagnoser:** F1 0.86 vs code's 0.90.
- **It never reported a drop.**
- **It didn't read grasp centring from a 128Ã—128 wrist frame.**
- **Calibration was a seesaw:** after calibration it missed all 9 real issues.
- **Thinking overran the budget:** 3 of 23 thinking calls used up the 16,000-token cap (thinking + answer;
  `MAX_TOKENS = 16000` in `nemotron_repair.py`) and returned no answer. A one-time re-ask with thinking off rescues
  them.

<!-- src: docs/submission/feedback.md Â§2; 2026-10-18-nemotron-judge.md; 2026-10-20-nemotron-repair.md;
     2026-10-15-t4-status.md; 2026-10-19-scene-creator.md -->

## Fine-tuned, prompt-engineered, or out of the box?

**Prompt-engineered, no fine-tuning.** We used:
- schema-generated system prompts with strict JSON replies;
- calibration text (normal metric ranges, "a clean demo is common");
- code validators whose readable errors go back to the model;
- multi-round feedback from physics replays.

Thinking is on for the repairer and off for the VL calls. Every Nemotron role is checked against a zero-cost code
baseline.

## Compared with other models?

**SUGGESTED answer:** we didn't benchmark other LLMs head to head. Our comparisons were Nemotron against code
baselines (rules, keyword parsers, metric checks). In those, Nemotron tied code as a judge, lost as a diagnoser, and
helped where words or open-ended edits are needed. TODO (USER): add any personal impression.

## Most valuable Nebius capabilities

**SUGGESTED:**
- **How we ran Nemotron:** through the Token Factory API only, with no GPU instances. That left our one GPU free for
  Isaac Lab all day, and gave us a 120B model with no setup.
- **What helped most:**
  - the OpenAI-compatible endpoint;
  - the free, detailed `/v1/models?verbose=true` listing (context, rate limits, prices);
  - `usage` on every reply, for a hard spend cap;
  - the price: the whole project cost about a dollar.

## Would you recommend it? (1â€“10)

**SUGGESTED: 8/10.** Easy to integrate and cheap. It loses points for missing metadata:
- the 8-image limit isn't in the listing;
- `pricing.image = "0"` although images are billed as tokens;
- the sampling-parameter list is empty but parameters work;
- video input works but isn't listed.

TODO (USER).

## Experience vs other environments (1â€“10)

**SUGGESTED: 8/10**, for the same OpenAI-SDK flow as other providers, with better metadata on prices and limits.
TODO (USER): compare with the platforms you've used.

## Features you'd want

**SUGGESTED:**
- `max_images_per_prompt` and video support in `/v1/models?verbose=true`;
- image tokens reported separately in `usage`;
- an honest `supported_sampling_parameters`;
- a documented thinking toggle and thinking budget per model (we hit the cap 3/23 times);
- a per-key spend cap on the server side.

## What you hope from the Nemotron team

**SUGGESTED:**
- **More consistent plans** from one run to the next for structured tasks, through a seed or deterministic sampling.
- **Better fine visual detail** in small frames: grasp centring, and spotting drops.
- **A thinking-budget parameter**, so thinking can't use up the answer's tokens.
- **A VL model tuned for robot manipulation video.**

## Tavily

**Not used.** There is no runtime Tavily call in the code.

## Builders & Brews city

TODO (USER).

## Age / eligibility checkboxes

TODO (USER).

## AI tools used to build it

**SUGGESTED:** Claude Code (Anthropic's Claude Opus models). 732 of the repo's 845 commits are co-authored with it: code, tests,
notes, parallel worktrees. NVIDIA Nemotron runs inside the product. TODO (USER): add any others you used.

## Learning level

TODO (USER).

## How valuable for your AI career

TODO (USER).

---

# FEEDBACK DETAILS (if the form asks for them in long form)

`docs/submission/feedback.md` has the long version for Token Factory, Nemotron VL, Isaac Sim / Isaac Lab and LeRobot.

**New since that file:**
- **Isaac Lab RL:**
  - every reward term is multiplied by dt, so a small reward was swamped by PPO's entropy bonus;
  - `env.yaml` holds `!!python/tuple` tags, which `yaml.safe_load` rejects;
  - importing an env class before Isaac Sim starts loads the pip USD build, whose `omni.usd` has no `get_context`;
  - leaving `launch_simulation` ends the process, so writes after it never run.
- **Isaac Lab Mimic:** it ran on Windows on SANT's demos. SANT's check rejected 9 of its 100 self-reported
  successes.
- **Hydra overrides worked well:** they record each RL run as one exact command line.
- **Nebius AI Cloud:** not used. We priced an H100 for Cosmos showcase clips (about $10â€“$60) and didn't run it.
- **NVIDIA Cosmos:** not used in SANT. In the earlier room-organizer version, NVIDIA's hosted Cosmos vision API returned
  HTTP 404 for every model ID, and NVIDIA staff confirmed it was disabled. So we removed it.

ðŸ¤– Generated with [Claude Code](https://claude.com/claude-code)
