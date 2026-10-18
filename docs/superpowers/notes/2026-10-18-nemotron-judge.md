# Nemotron as labeler and judge: physics says if it works, Nemotron says what was done (2026-10-18)

- **Branch:** `pm/nemotron-judge`, from `origin/perfect-then-multiply` at `e94d817`. Not pushed.
- **The role:**
  - **Physics** (Isaac Lab replay) judges whether a demo *works*.
  - **Nemotron 3.5 Super VL** (`nvidia/Nemotron-3.5-Super-VL`, Nebius Token Factory) says what the person *did*
    (labeler), and whether a physics-checked copy still does what the person intended (judge).
- **Code:**
  - `src/demo_pipeline/intent.py`: schemas, trajectory summary, perturbations, code baselines and scoring.
  - `src/app/ai/intent.py`: the two Nemotron calls, the spend cap and the per-call log.
  - `scripts/intent_eval.py`: the sets, the runner and the report.
- **The schema for the Review verdict card:** `docs/design/nemotron-judge.md`.

## Pre-registration (written and committed before any Nemotron call in this track)

Everything below was fixed at the commit that adds this section. The item lists are
`docs/superpowers/notes/2026-10-18-nemotron-judge/sets.json`, sha256
`78ead6a213c4d01c438bddb9b73320d2490576dfc15387ef42d0bc9a3a065366`, built by `intent_eval.py build` from T2's
episode store (`C:\dev\pm-t2\data\episodes`, read only).

### The recordings, and what they are

- **"Human" demos:** `s1_0000_raw` … `s1_0004_raw` and `degraded_0000` … `degraded_0004`. These are **synthetic**:
  the scripted expert with tremor, pauses and slowness added (docs/media/README.md; claims audit V4).
  - No real person's demo exists yet (`2026-10-16-web-pages.md:436`).
  - `home_src_3000` … `3008` are scripted-expert source demos.
- **Physics-checked copies:** `s1_000k[_rules|_nemotron]_mx_*` and `home_src_30xx_3yyy`. Each is the source re-planned
  for a new cube and bin position and replayed in Isaac Lab. `verification.json` holds the physics result.
- **Camera:** the front camera at 128 × 128, 50 fps; one cube (red) and one bin (blue) per scene. Frames are
  upscaled to 256 × 256 for the model (as T4's diagnoser did). The code baselines read the 128 px originals.

### The deliberately wrong cases

Each is built from an existing recording.
- **Different object** (`+recolor`): the copy's red cube turned green. Only the red pixels change: their red and
  green channels are swapped. Everything else is untouched.
- **Different goal** (`+reverse`): the copy played backwards, frames and trajectory both. The cube now starts in the bin
  and ends on the table where the original picked it up, so the goal and the order are both reversed.
- **Failed demo labelled as success** (`failed`): a copy whose physics check **failed with `not_in_bin`**. It is
  given to the judge with the label "physics check: passed".
  - Copies that failed only on `unreachable` (a tracking error, with the cube often still in the bin) are excluded,
    because the frames can't show that failure.

### Labeler test: 40 clips

| Group | Clips | Truth |
|---|---|---|
| Recorded demos | `s1_000{0-4}_raw`, `degraded_000{0-4}` (10) | red cube, ends in the bin |
| Physics-checked copies | 5 `s1` copies, 5 `home_src` copies (10) | red cube, bin |
| Recoloured copies | 10 `home_src` copies `+recolor` | **green** cube, bin |
| Reversed copies | 10 `home_src` copies `+reverse` | red cube, ends **on the table** |

- **Input:**
  - 8 evenly spaced frames, first and last included, each captioned with its frame number and time;
  - the trajectory summary: gripper close and open frames, hand start and end, heights, path length.
  - **No task text, object name or colour is in the prompt** (a test checks this).
- **Scoring, per clip:**
  - **task** (primary): the object colour **and** the destination are both right;
  - **color** and **destination**: each on its own;
  - **steps**: the four steps are in order, and the grasp and release start frames are within **±0.5 s** of
    the true first gripper close and the open after it.
- **A reply still invalid after 2 attempts** counts as wrong on every measure.

### Judge test: 60 pairs

- **30 matching:**
  - 19 are `s1_000k_raw` with one of its successful copies (raw, `_rules` or `_nemotron` lineage);
  - 11 are `home_src_30xx` with one of its copies.
- **30 wrong, 10 of each kind:**
  - **object:** 5 `s1` and 5 `home_src` pairs, `+recolor`;
  - **goal:** 5 + 5, `+reverse`;
  - **failed:** 10 `s1` pairs with a `not_in_bin` copy labelled as passed.
- **Every copy is used once.**
- **Input:**
  - 4 frames of the human demo and 4 of the copy, each captioned;
  - both trajectory summaries;
  - the claimed label "physics check: passed", for every pair.
- **Output** (the Verdict): `same_object`, `same_goal`, `same_order`, `copy_completes`, `matches` (yes/no), `reason`
  and `confidence`. `matches` must be "yes" exactly when all four checks are true.
- **Scoring:**
  - **primary:** `matches` equals the truth (yes for matching pairs, no for wrong ones);
  - **secondary:** balanced accuracy and accuracy per kind.
- **A reply still invalid after 2 attempts** counts as wrong.

### The code baselines (fixed now, tuned only on the dev set)

They get the same information as the model: the same sampled frames and the same summaries, and no sim state.
- **Labeler (`code_label`):**
  - the cube colour: red or green pixels, counted over the 8 frames;
  - the destination: whether the cube's pixel centroid is inside the box of blue pixels in the last frame;
  - the steps: from the gripper close and open frames in the summary.
- **Judge (`code_judge`):** "yes" only if all of these hold:
  - the same cube colour in both clips;
  - the same destination in both last frames;
  - the same sign of (hand height at the close − height at the open);
  - the copy's cube ends in the bin.
- **Known bias, stated now:**
  - The rules were written by someone who knows the scene: a red cube and a blue bin, against a grey and
    white background.
  - They were written knowing the three wrong-case types. So were the prompts, which name the four checks.
  - Neither would transfer as-is to a webcam scene with other objects.
  - The code steps read the gripper events that the summary also gives the model. So on steps, the code is
    exact by construction.
- **Trivial baselines, for scale:**
  - the labeler's constant "red cube → bin" scores **20/40** on task by construction;
  - the judge's "always yes" scores **30/60**.

### Analysis (fixed now)

- **Each measure:** k/n with Wilson 95% CIs (`demo_pipeline.stats.wilson_ci`).
- **Nemotron vs code:** on the same items, an exact two-sided sign test (McNemar) on the discordant items, α = 0.05.
  - "**Beats**" is used only when p < 0.05. Otherwise the wording is "no detectable difference", with the
    counts.
  - This applies to each sub-task: task, colour, destination and steps (labeler), and matches (judge).
- **Independence caveat:** the items are not fully independent.
  - The `s1` copies of one source share its demo.
  - The three lineages of a seed (raw, `_rules`, `_nemotron`) can look alike. For example, the `failed` pairs
    include `s1_0000_mx_100000` and its `_rules` and `_nemotron` versions.
  - The CIs treat the items as independent, so they are somewhat optimistic.
- **Settings:** temperature 0.2, thinking off, `max_tokens` 1024, retry once with the validation error.

### Procedure and budget

1. **Dev:** at most 20 calls, on dev items only. Dev uses `home_src_3009` and its copies, `degraded_0018`, and
   `v2_2000` as a failed "copy"; the test never uses them.
   - Prompt edits are allowed only to fix format or validity problems seen in dev, never to tune toward the
     wrong-case types.
   - Any edit is listed in this note, and the frozen commit is recorded before the test starts.
2. **Test:** one pass over the 100 test items, model and code side by side. If interrupted, it resumes and skips
   finished items. No item is asked twice, and nothing is re-run because of its result.
3. **Report:** everything above, plus the invalid-reply count, the latency and the cost.
4. **Money:**
   - Cap $5 for the task. The runner refuses a call once the spend across all phases + $0.01 would pass
     **$4.50**.
   - Expected: about 110 calls at about $0.0015, so about $0.2.
   - Every call is logged, with its item, tokens, estimated USD, latency and the running total, in
     `data/intent_eval/<phase>/calls.jsonl` and `data/intent_eval/usage_log.jsonl` (both git-ignored).
   - The key is read from `C:\dev\pm-t4\.env` and never printed.

### Dev run and freeze (before the test)

- **Dev:** 8 calls on the 8 dev items, **$0.0079** (2,809–2,941 prompt tokens, 94–183 completion tokens per call),
  median latency 1.7 s.
  - Every reply was valid on the first attempt.
  - Nemotron and code were both right on all 4 label clips and all 4 judge pairs.
- **Prompt edits:** none.
- **Frozen at `72434d4`** for the prompts, the code baselines and the runner. The test runs with that code, unchanged.

## Results (test, run once at `72434d4`; 2026-10-18)

- **The run:** 100 calls, every reply valid on the first attempt, est. **$0.0985**. The median latency was 1.5 s.
- **Total spend:** **$0.1064** over 108 calls, against the $5 cap.
- **Where the evidence is**, in `2026-10-18-nemotron-judge/`:
  - `report.txt` holds the report;
  - `outcomes.jsonl` holds every item's truth, the model's reply and its score, and the code's answer;
  - `misses.png` shows the frames behind the two disagreements.

### Labeler (40 clips)

| Measure | Nemotron | Code | Only Nemotron right / only code right | Sign test p |
|---|---|---|---|---|
| **Task** (colour + destination) | **40/40** = 100% (91.2–100%) | 39/40 = 97.5% (87.1–99.6%) | 1 / 0 | 1.0 |
| Colour | 40/40 (91.2–100%) | 40/40 (91.2–100%) | 0 / 0 | 1.0 |
| Destination | 40/40 (91.2–100%) | 39/40 (87.1–99.6%) | 1 / 0 | 1.0 |
| Steps (±0.5 s) | 40/40 (91.2–100%) | 40/40 (91.2–100%) | 0 / 0 | 1.0 |

- **By group:** recorded demos and copies 20/20 for both; recoloured 10/10 for both; reversed: Nemotron 10/10,
  code 9/10.
- **The trivial constant label** ("red cube → bin") would score 20/40.
- **The code's miss** (`home_src_3008_3181+reverse`): a few stray blue pixels at the top of the last frame stretched
  the rule's "bin box" over the whole table, so a cube on the table counted as in the bin. That is a brittle pixel
  rule, not a hard case.
- **Nemotron wrote readable task sentences.** Two examples:
  - "The robot picks up a red cube and places it inside a blue bin."
  - For a reversed clip: "The robot picks up a red cube from a blue bin and places it on the table."
- **Steps: Nemotron copied the summary.** In all 40 clips, its grasp and release start frames are *exactly* the
  gripper events the summary gives it. So on steps it adds nothing over code, which is exact by construction.

### Judge (60 pairs: 30 matching, 30 wrong)

| Kind | Nemotron | Code |
|---|---|---|
| **All** | **59/60** = 98.3% (91.1–99.7%) | **60/60** = 100% (94.0–100%) |
| Matching (says yes) | 30/30 (88.6–100%) | 30/30 |
| Different object (says no) | 10/10 (72.2–100%) | 10/10 |
| Different goal (says no) | 10/10 (72.2–100%) | 10/10 |
| Failed copy labelled as passed (says no) | **9/10** (59.6–98.2%) | **10/10** |
| Balanced accuracy | 0.983 | 1.000 |

- **Head to head:** only Nemotron right 0, only code right 1; exact sign test p = 1.0.
- **Nemotron named the right check:**
  - all 10 object pairs had `same_object` false, and no other check false;
  - all 10 goal pairs had `same_goal` and `same_order` false. The reversal changes both, so that is right;
  - in 9 of the 10 failed pairs, `copy_completes` was false.
- **Its reasons are specific and checkable.** For example: "the copy starts with the cube already in the box,
  removes it, and leaves it on the table, reversing the goal and order."
- **Its miss** (`failed:s1_0001_raw|s1_0001_rules_mx_101001`; physics: `not_in_bin, collision, dropped, unreachable`):
  - In the copy's last frame the bin is empty: the cube was knocked out of view.
  - Nemotron answered "matches: yes", saying the copy's final frame "shows the cube inside the container", with
    **confidence 0.95**.
  - That is a hallucinated success, trusting the "physics check: passed" label over the image. It is the
    "leans toward success" failure that FailBench reports for VLM success detectors.

### What this says, honestly

- **On this set, a simple code rule did as well as Nemotron.**
  - Neither beats the other on any sub-task: every sign test gives p = 1.0, with at most 1 discordant item.
  - **On the judge, the code rule scored higher** (60/60 vs 59/60, and 10/10 vs 9/10 on mislabelled failures). The
    difference is not significant, but the one wrong verdict was Nemotron's, and it was confidently wrong.
  - On the labeler, Nemotron was the one to get every clip right (40/40 vs 39/40). That is also not significant.
- **Both are near the ceiling because the set is easy for both:**
  - one red cube, one blue bin, a clean background;
  - perturbations a pixel rule can see;
  - a gripper log that gives the steps away.
  - The code rules were written for exactly this scene and these three wrong kinds. They would break on a real
    webcam scene with other objects, while Nemotron's prompt names no object or colour.
  - That transfer is the argument for the model, but **it is not measured here**. No real-person or webcam demo
    exists yet.
- **What Nemotron adds that code doesn't, here:**
  - a natural-language task label and a checkable reason for each verdict;
  - with no scene-specific rules, it still named the right failed check on 29 of 30 wrong pairs.
- **What it does not add:**
  - **Step timing:** it copies the gripper log.
  - **Confidence:** 0.95–0.98 on nearly everything, including its wrong verdict, so the confidence carries no
    signal.
- **For the product:**
  - **Physics stays the judge of success.** Nemotron's `copy_completes` must never override a failed physics check.
    Its single error was exactly that kind of case, made the other way.
  - The Review card should show the physics result and Nemotron's verdict side by side.
  - Use Nemotron for the label and the intent match, where its reasons help a person. Do not use it as a success
    detector.
- **Cost:** about $0.001 per call (2.8–2.9k prompt tokens with 8 images at 256 px, about 100–180 completion
  tokens), about 1.5 s each.

### Limits

- The frames are synthetic sim renders at 128 px, not webcam video.
- The "human" demos are scripted demos with added noise.
- The wrong cases are deliberate edits of real recordings.
- The items are not fully independent (seeds shared across lineages).
- n = 40 and 60, so the CIs are wide for a 1-item difference.
- Each item was run once at temperature 0.2, so run-to-run variance is not measured.
