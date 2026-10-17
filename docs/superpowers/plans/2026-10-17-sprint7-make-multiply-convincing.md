# Sprint 7: Make the Multiply Result Convincing (Unattended, ~3 h)

> Sprint 3's Global Constraints apply: ownership, 0 failed, no
> push/merge/rebase, and a progress entry after every task.
> Required skills: `test-driven-development`, `systematic-debugging`,
> `verification-before-completion`.

**Start point:** `origin/perfect-then-multiply` after PRs #19–#22 and this
plan's PR are merged.

**First step for every terminal:**

```
git fetch origin
git merge --ff-only origin/perfect-then-multiply
```

Then confirm this file exists. The user is away for about 3 hours; nobody
asks questions.

**Where we are (2026-10-16 notes):**

- ACT, 20 unseen home-start scenes: `raw_10` scores **2/20** and
  `raw_multiply_10` (10 + 100 variants, same 10k steps) scores **3/20**. The
  difference is not significant (p = 1.0).
- The multiplied policy reaches and grasps more often, but drops the cube.
- The multiplied dataset is 11× bigger but got the same 10k steps, so it is
  probably undertrained.
- Grid B (`raw_5` / `raw_multiply_5`) is paused. The resume commands are in
  T3's note.
- Nemotron as a diagnoser lost to code on the fair v2 set (T4 note). Its
  role is the user's decision. T4 builds a **prototype** of T7's top
  alternative (R6), so the user can decide with evidence.

**GPU:** T3 owns Isaac for this whole sprint. Nobody else launches Isaac.
T2 starts only when T3's note says **"GPU released (sprint 7)"**. Use
`sim_worker.keepawake.KeepAwake` around every long run.

---

## T3 (`C:\dev\pm-t3`): the evidence (GPU owner)

Do these in order, overlapping training with evals where possible:

1. **Finish grid B** with the resume commands in your note:
   - finish `raw_multiply_5`'s training (7.5k → 10k steps);
   - eval `raw_5`;
   - eval `raw_multiply_5`.

   Use n = 20 and seeds 5000+.
2. **Equal-epoch training.** Continue both `raw_10` and `raw_multiply_10` to
   **30k steps** (resume from their 10k checkpoints, same hyperparameters).
   - Eval both on n = 20 (seeds 5000–5019).
   - Report 10k vs 30k for each.
3. **More episodes.** Read T1's power note
   (`docs/superpowers/notes/2026-10-17-power.md` in `C:\dev\pm-t1`). For
   the best raw/multiplied pair, extend the eval to the n it recommends
   (seeds continue from 5020), as far as time allows.
4. **After every cell:**
   - record successes with their source files;
   - record failure reasons;
   - record whether the multiplied policy still grasps and then drops.

   Report honestly, including when there is no difference.
5. When done, write **"GPU released (sprint 7)"** and commit.

---

## T1 (`C:\dev\pm-t1`): statistics and live charts (no Isaac)

1. **`demo_pipeline/stats.py` (pure, TDD):**
   - Wilson 95% CI for a success rate;
   - Fisher's exact test (two-sided) for two cells;
   - a power / sample-size helper (n per arm to detect p1 vs p2 at
     α = 0.05, power 0.8).
2. **`docs/superpowers/notes/2026-10-17-power.md`:** how many episodes per
   arm are needed to detect 10% vs 20%, 10% vs 30% and 10% vs 40%, and what
   the current 2/20 vs 3/20 can and cannot say. Commit this early: **T3
   reads it.**
3. **Charts and results:**
   - error bars (Wilson CI) on `success.svg`;
   - a CI field on each success point in `results.json`;
   - tests.
4. Poll T3's evals every 15 min, for up to 4 h, and refresh `results.json`
   and the charts when new cells land.

---

## T2 (`C:\dev\pm-t2`): faster evals + the next dataset

1. **No GPU (prototype, new files only):** parallel evaluation.
   - Eval takes ~77 s per episode, one env at a time, and that is now the
     bottleneck.
   - Design and build a multi-env eval path: N envs in one Isaac process,
     and the policy queried per env.
   - Build it in **new files only** (`sim_eval/parallel/**`). Do not edit
     T3's existing `sim_eval` files.
   - Make the pure parts testable without Isaac. Write the design and the
     expected speedup in your note.
2. **GPU (only after T3 writes "GPU released (sprint 7)"):**
   - a ≤ 10-min smoke run of the parallel eval against an existing
     checkpoint, compared with the serial result on the same seeds;
   - then render a **10 × 30** home-start multiply dataset (same 10
     sources), with a manifest for T3.

   If the GPU isn't released before you'd have to stop, record that and
   stop.

---

## T4 (`C:\dev\pm-t4`): prototype of Nemotron role R6 (for the user's decision)

**R6:** turn a plain-language repair request ("the pause at the start is fine
but center the grasp") into repair ops from the fixed menu, validated by the
existing pydantic `RepairOp` union. Code then applies them, and the sim
verifies.

1. **Write the eval set first.** Commit **≥ 30** requests with their
   expected ops (`tests/data/repair_requests.jsonl` or similar) **before**
   any model call. Cover:
   - paraphrases;
   - negations ("don't trim the end");
   - multi-op requests;
   - requests that should map to no op.
2. **Build:**
   - `src/app/ai/repair_request.py`, using the Nemotron text tier
     (`nvidia/Nemotron-3.5-Super-VL` or whatever `config.py` names for
     text);
   - output validated against the menu;
   - an invalid output is retried once, then becomes an empty op list;
   - tests with fakes.
3. **Baseline:** a keyword / regex parser.
4. **Measure:** exact-match and per-op F1, model vs baseline.
   - **Budget:** ≤ 40 calls, ≤ $0.03. Never print `.env`.
5. **Do not** wire it into the UI or the README. It's a prototype for the
   user to judge.

---

## T5 (`C:\dev\pm-fix`): submission story with the real numbers

**Owns:** `README.md` and `docs/submission/**`.

1. Rewrite `docs/submission/video_script.md` as a shot list that uses
   `docs/media/*` and today's real results. Include:
   - the raw vs multiplied comparison, as it stands;
   - the 100/100 multiply yield;
   - the honest Nemotron ablation.

   Mark the shots that need the live hand-teleop session; the user does
   that one.
2. Read T7's claims audit
   (`C:\dev\pm-t7\docs\superpowers\notes\2026-10-17-claims-audit.md`) when
   it lands (poll every 15 min) and fix every README and submission finding
   it lists.

---

## T6 (`C:\dev\pm-t6`): CI on GitHub

1. Add `.github/workflows/ci.yml`. On pull requests and on pushes to
   `perfect-then-multiply`, it runs:
   - `uv sync` + `uv run pytest -q` (Python 3.14, the SANT deps; Isaac,
     torch and lerobot tests already skip);
   - `npm ci`, `npm test` and `npm run build` in `web/`.
2. **Verify locally** by running the exact workflow commands in a fresh
   clone in a temp folder, from the local repo, not GitHub. Record the
   output.
3. Document it in the RUNBOOK.

---

## T7 (`C:\dev\pm-t7`): claims audit (report only)

Write `docs/superpowers/notes/2026-10-17-claims-audit.md`. Check every
number and claim in:

- `README.md`;
- `docs/submission/**`;
- `docs/media/README.md`.

**For each, record:**

- that it traces to a note, with the line;
- that the value matches;
- that the wording is honest. In particular:
  - Nemotron's role after the v2 ablation;
  - "first" or novelty claims (the spec says "to our knowledge…");
  - n and significance on the success numbers.

Produce a findings table with: file:line, claim, source, verdict, and the
exact fix. **Do not edit those files;** T5 applies the fixes.
