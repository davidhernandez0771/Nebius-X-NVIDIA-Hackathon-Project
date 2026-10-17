# Sprint 5: A Fair Test for Nemotron, Plus Setup Gaps

> Sprint 3's Global Constraints apply: ownership, 0 failed, no
> push/merge/rebase, at most one Isaac process (check before launching), and
> a progress entry after every task.
> Required skills: `test-driven-development`, `systematic-debugging`,
> `verification-before-completion`.

**Start point:** `68e4e68`, with PRs #2–#7 merged.

**GPU:** T3 owns Isaac for its ~2 h eval
(`sim_eval\scripts\eval_cells.py --run-id sprint3_clean_expert_20261016_144514`).
Nobody launches Isaac until that process has exited **and** T3's note
records the result.

## Why this sprint

Sprint 4's ablation could not tell whether Nemotron adds anything (T4's
note):

- **Every degraded demo had an off-center grasp,** so "always say off-center"
  scored perfectly. There were no negatives.
- **There were no real drops or bad releases,** so Nemotron's 10
  `bad_release` claims could only be false positives.
- **The gate was tuned after seeing the scores.**

The user decides Nemotron's role after the numbers are in. This sprint
produces fair numbers, and lists alternative roles (T7).

**Out of scope:** `wrong_object`. `Scene` has a single cube.

---

## T1 (`C:\dev\pm-t1`): measurement set v2 (pure)

**Owns:**

- `src/demo_pipeline/degrade.py` and its tests;
- new `scripts/make_measurement_set_v2.py` and its test.

### 1. New injections in `degrade.py`

Pure trajectory edits, each recorded as `InjectedIssue` truth:

- **`drop`:** the gripper opens mid-carry, at least 5 cm away from the bin
  footprint and at least 5 cm above the table.
- **`bad_release`:** the release happens clearly outside the bin footprint,
  or more than 12 cm above the bin.
- **`grasp_off_center` becomes optional,** so a demo can have timing issues
  and a centered grasp. These are the negatives.

### 2. Set v2 builder

`make_measurement_set_v2.py --n 32 --seed 2000 --out <DATA_DIR>/sets/v2`
writes, from the scripted expert's trajectory (as T2's `render_degraded`
does today), a balanced, pre-registered mix:

| Count | Demo type | Truth |
|---|---|---|
| 8 | timing issues + off-center grasp | off-center grasp |
| 8 | timing issues + centered grasp (negatives) | no grasp issue |
| 6 | drop | drop |
| 6 | bad_release | bad_release |
| 4 | clean | none |

- **Files:** `demo.json`, `truth.json`, and a `manifest.json` listing the
  ids, the type of each and the seed.
- **No rendering;** T2 renders the set.
- **Freeze it.** Write the manifest's SHA-256 into your note before anyone
  scores anything.

---

## T2 (`C:\dev\pm-t2`): sim support + render v2

**Owns:** `sim_worker/**` except the `teleop_*` files, and `tests/test_sim_*.py`.

### 1. Home start pose

Fix the start-state leak from T3's note: every demo starts 15 cm above *its
own* cube.

- Add a `--home-start` option to the scripted expert and `render_degraded`:
  every demo starts from one fixed home pose.
- Pure tests only; do not launch Isaac before the GPU rule allows it.

### 2. Verification must see drops and bad releases

Check that `verify` / `success.py` mark them as failed: the cube is not in
the bin. You may read `success.py` but not edit it unless it's needed.

### 3. Render set v2

Once Isaac is free (poll every 10 min, for up to 3 h):

- Render T1's set v2 with cameras.
- Each episode gets front/wrist frames, `signals.npz` and `truth.json`, as
  for `degraded_*`.
- Record per-type verification outcomes. Drop and bad_release episodes
  must fail verification; if they don't, fix the injection with T1 (through
  the notes).

Then restart `python -m sim_worker.server --port 8770 --robot franka --cameras`
and leave it running.

---

## T4 (`C:\dev\pm-t4`): ablation v2, pre-registered

**Owns:** `src/app/ai/diagnose.py`, `scripts/ablation_diagnosis.py` and their tests.

### 1. Pre-register before seeing any v2 result

Write into your note, and commit, **before** running anything on v2:

- **The `bad_release` gate:** drop the claim when the replay verified
  success. Also give the model the measured release height and xy distance
  to the bin.
- **The prompt change:** stop leaking the measured grasp offset into the
  prompt for one arm, `hybrid_blind`, so we can see whether the model reads
  the wrist frame by itself.
- **The arms:** `rules`, `rules_grasp_metric` (zero calls), `hybrid`,
  `hybrid_blind`.

Tests with fakes.

### 2. Run on v2 once T2 has rendered it

- Report P/R/F1 per type, including the negatives' false-positive rate per
  type.
- **Budget:** ≤ 80 calls, ≤ $0.15. Never print `.env`.
- Report honestly: say plainly where code alone matches or beats the model.

---

## T6 (`C:\dev\pm-t6`): close the setup gaps

**Owns:** `scripts/launch/**`, `docs/RUNBOOK.md`, `tests/test_launch_*.py`.

1. **`scripts/launch/fetch_mediapipe.ps1`:**
   - copies `web/node_modules/@mediapipe/tasks-vision/wasm/` to
     `web/public/mediapipe/wasm/`;
   - downloads `hand_landmarker.task` (the official
     storage.googleapis.com URL from `HAND_INTERACTION_PLAN.md`) to
     `web/public/models/`, unless it already exists.

   Test it with a fake download. **Do not run the real download.** The user
   runs it.
2. **One `DATA_DIR` proposal.** List every terminal's data that a final run
   needs (from the notes), and propose one folder plus the copy commands.
   Write the commands in the RUNBOOK, but **do not move or copy any data.**

---

## T7 (`C:\dev\pm-t7`): where could Nemotron really help? (research note)

**Output:** `docs/superpowers/notes/2026-10-16-nemotron-roles.md`.

**Read:**

- the spec;
- T4's ablation notes;
- the hackathon rules in the spec and notes;
- the official Nemotron 3.5 Super VL model card and blog.

Web search is allowed.

**List 4–6 concrete roles** where a vision-language model could beat code
in *this* project. Candidates to evaluate, not to assume:

- judging webcam-only human demos, where no sim signals exist;
- explaining failed policy rollouts, to choose which demos to collect next;
- turning a task sentence into a scene config and a success check;
- writing language annotations for the LeRobot dataset;
- reading the wrist frame without measured hints (T4's `hybrid_blind`).

**For each role, give:**

- why code can't do it;
- the evidence it would need: the test and the metric;
- the effort before Oct 30;
- the prior art.

Rank them. **Do not decide; the user decides.**

**Budget:** ≤ 10 probe calls, ≤ $0.02, and only if they are needed to show
feasibility. Commit on `pm/t7-audit`.
