# Coverage report, workflow step 6 (2026-10-20, branch `pm/coverage-report`)

From `pm/live-12` (`eb3546a`). Code only; no GPU and no Isaac. Never pushed.

**What it answers.** Given a task's scene set (the Record page's ScenePlans, S1–S8) and an experiment store (raw takes,
repaired demos, variants):
- how well does the *verified* data cover the scenes and the eval distribution (seeds 5020–5059)?
- what should be recorded next?

It only reads the store, and a test checks the store's files are byte-identical afterwards.

## Parts

- **`src/demo_pipeline/coverage.py`** (pure; the module docstring has the definitions):
  - `scene_set(entries)`: per scene, the goal cube's place, yaw and size, the bin's place, yaw and walls, and extra
    objects, plus `in_eval` and `outside` (why not, e.g. "4 cm cube", "cube x 0.63 (eval 0.4 to 0.6)", "bin turned
    90 degrees"). Standard and S1 have the same plan, so they are one scene: S1, with "standard" as an alias.
  - `assign_scene(demo, scenes)`:
    - a take goes to its `scene_plan` ref;
    - a take from before the picker (no ref) goes to the today's-bodies scene whose cube and bin are within 1 cm and
      2° of its own;
    - otherwise it is unassigned.
  - `coverage_report(store, entries, eval_n=40, eval_seed0=5020, takes_per_scene=2)`:
    - **per scene:** takes, raw-verified, repaired-verified, verified takes (either), variants made and verified;
    - **grasp** (`grasp_retime`'s stats: swoops, frames in the last 3 cm, close speed), for the takes and for the
      verified episodes;
    - **spread** of the verified episodes' cube and bin places and cube yaw (wrapped to the nearest face).
  - **The pool** is what training can use: per take its verified repaired demo (else its verified raw take), plus
    every verified variant.
  - **The eval distribution** comes from `sample_scene` per seed, as `sim_eval.scenes.eval_scenes` makes it (a test
    pins them equal).
    - **Per-axis bins:** cube x, cube y, face yaw, bin x, bin y. A bin is a *gap* when it has eval scenes and no
      pool episode. It is *thin* when it has ≥ 5 eval scenes and its share of the pool is under ¼ of its share of
      the eval.
    - **Per eval scene:** the nearest pool episode; covered if within 5 cm (cube), 8 cm (bin) and 15° (face yaw).
  - **`requests()`**, by rules, most useful first:
    1. takes still missing per scene (eval-distribution scenes first; generalization scenes say why they are
       outside);
    2. swoop grasps (only while the verified episodes still swoop);
    3. axis gaps and thin bins;
    4. uncovered eval scenes;
    5. low variant yield (under half, of ≥ 3).
  - **`phrase_requests(..., chat_fn)`**: optional Nemotron wording (`super`, temperature 0, no thinking). A rewording
    is kept only if:
    - every number in it is one of the rule's, so it is a fact;
    - the rule's first number (what to do) is still there;
    - the scene name is there word for word.

    Otherwise that request keeps the rule's text. An API error or a bad reply keeps all of the rules' texts.
- **`scripts/coverage_report.py`**:
  - usage: `--store <…/store> --out <dir> [--scenes-dir <DATA_DIR>] [--eval-n 40 --eval-seed0 5020]
    [--takes-per-scene 2] [--nemotron]`;
  - it writes `coverage.json` and `coverage.md`;
  - with no `--scenes-dir`, the set is Standard + S1–S8.

## Runs (read-only on `C:\dev\pm-t6\data\human_exp\…\store`; outputs next to this note)

Both stores were recorded entirely in the standard scene, so all their takes are S1 and S2–S8 have none.

| | mouse20261020 | human10c |
|---|---|---|
| S1 takes / verified takes (raw, repaired) | 10 / 10 (10, 10) | 10 / 3 (0, 3) |
| variants verified | 100 / 100 (only verified ones are stored) | 24 / 30 |
| swoop takes, median close speed | 7 / 10, 0.14 m/s | 10 / 10, 0.23 m/s |
| pool (verified episodes) | 110 | 27 |
| eval scenes covered (5 cm / 8 cm / 15°) | **18 / 40** | **6 / 40** |
| thin bins | none | bin x 0.55–0.6 (1 of 27 episodes for 11 of 40 eval scenes), bin y 0.1–0.2 |

**Requests** (rules), mouse20261020:
1. Record 2 more takes in S6 Cube turned 35 degrees: 0 verified of 0 recorded. (S6 is the only scene besides S1
   inside the eval distribution.)
2. Record 2 more takes in S2–S5, S7 and S8, each marked "generalization only", with the reason.
3. In S1 Standard, 7 of 10 takes close while still moving (median 0.14 m/s, 7.5 frames in the last 3 cm): retake
   with a stop before closing, or repair with `--grasp-retime`.
4. 22 of 40 eval scenes have no verified episode within 5 cm / 8 cm / 15°, and it lists the seeds.

human10c adds the two thin-bin requests ("Only 1 of 27 verified episodes have the bin x between 0.55 and 0.6 m, where
11 of 40 eval scenes put it: add variants or takes there."). Its uncovered count is 34 of 40.

**Nemotron wording** (real calls, mouse20261020; about $0.0004 per pass, 3 passes in all):
- **First prompt:** it copied all 9 requests verbatim, so no help.
- **Second prompt** ("start with what to do, in your own words"): all 9 passed the number checks, but it invented a
  cause: "Record 2 more takes in S4 Small cube **because this is generalization only**". It also renamed "S3 Bin
  turned, other side" to "…on the other side", which led to the scene-name check.
- **Final run:** all 9 kept, the names verbatim. The numbers are facts, but the meaning is looser than the rules':
  it drops "0 verified of 0 recorded", and "because" is wrong.
- **So the rules' text is the default, and `--nemotron` is an opt-in.** The checks guarantee the facts, not the
  sense. The output is in `2026-10-20-coverage-report/mouse20261020_nemotron/`.

**Notes for the next run:**
- The variants' "100 / 100" for mouse is what the store holds. The experiment's multiply markers count attempts; the
  store keeps every replayed variant, and in that run all of them verified.
- Reach and success aren't judged here. "Covered" is geometric nearness of verified data to the eval scenes, not a
  prediction of success.

## Tests

`tests/test_dp_coverage.py` (12): scene set and reasons, assignment, per-scene counts, the pool, axis gaps and the
nearest coverage, the requests and their order, read-only, the markdown, the phrasing checks (numbers, count, scene
name, fallbacks), the number parser, and the eval scenes equal to sim_eval's.

Results: full Python suite **2522 passed, 30 skipped** (`uv run --no-sync pytest -q`).
