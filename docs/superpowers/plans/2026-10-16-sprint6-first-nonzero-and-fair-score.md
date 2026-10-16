# Sprint 6: First Non-Zero Robot, and the Fair Nemotron Score

> Sprint 3's Global Constraints apply: ownership, 0 failed, no
> push/merge/rebase, and a progress entry after every task.
> Required skills: `test-driven-development`, `systematic-debugging`,
> `verification-before-completion`.

**Start point:** sprint 5 merged: set v2 frozen, `--home-start`,
`high_release`, the pre-registered ablation, and T3's eval results (raw_5,
raw_10 and raw_13 all 0/20).

## Why this sprint

| Finding | What it means |
|---|---|
| ACT on 5–13 clean demos scored 0/20 on new scenes | That is the baseline the project must beat. |
| Open-loop, the policies reproduce their training actions (~0.02 rad) | The pipeline looks fine, but this is not yet proven closed-loop. |
| Every old demo starts above *its own* cube | That leaks the cube position into the start state. `--home-start` fixes it. |
| Set v2 is frozen but not rendered | Nobody can score Nemotron fairly yet. |

## The GPU queue (one Isaac process at a time)

Each step starts only when the previous owner's note records **"GPU
released"** and no Isaac python is running.

1. **T3, Task A:** ≤ 20 min.
2. **T2, Tasks 1 and 2:** ~1 h.
3. **T3, Task B:** training can overlap with T4; eval is ~25 min per cell.

T4 needs no Isaac and starts as soon as v2 is rendered. Poll every
10 minutes, for up to 4 hours. Never launch while another Isaac python is
alive.

---

## T3 (`C:\dev\pm-t3`)

**Owns:** `lerobot_tools/**`, `sim_eval/**`, their tests.

### Task A: is the 0 a bug or too little data? (GPU first)

Evaluate the `raw_13` checkpoint on **5 of its own training scenes**, using
each demo's cube and bin pose plus its own start pose, and also on 5 unseen
scenes. Record eval video, or frames, for 2 seeds.

| Training scenes | Unseen scenes | Diagnosis |
|---|---|---|
| succeed | fail | generalization (too little data) |
| fail | fail | a closed-loop bug: find it with systematic-debugging before Task B |

Write the result and **"GPU released"** in your note.

### Task B: the thesis run (after T2's dataset exists)

Train ACT, with equal steps per cell, on T2's home-start dataset:

| Cell | Training data |
|---|---|
| `raw_10` | the 10 source demos |
| `mult_10x10` | the 10 sources + their 100 multiplied variants |

Add `raw_5` / `mult_5x10` if time allows.

Eval each cell on 20 unseen home-start scenes (seed0 5000). Report success
with sources, honestly, including 0.

---

## T2 (`C:\dev\pm-t2`)

**Owns:** `sim_worker/**` except `teleop_*`, and `tests/test_sim_*.py`.

### Task 1: render set v2 (after T3 Task A)

- Run `render_set` on T1's frozen set v2 (`C:\dev\pm-t1`, with the manifest
  SHA in T1's note), with cameras.
- Tabulate verification per type. Drop and bad_release must fail
  verification; clean and timing-only must pass.
- Put the path in your note for T4.

### Task 2: home-start multiply dataset

1. Render **10** scripted-expert source demos with `--home-start` and
   cameras.
2. Multiply each ×10 (seeds recorded) with cameras, which gives ~100
   variants.
3. Record the yield, and list the episode directories, in a manifest that
   T3 can read.
4. Write **"GPU released"** in your note.
5. Restart `python -m sim_worker.server --port 8770 --robot franka --cameras`
   **only after** T3 Task B's eval is done. Until then, leave the server off.

---

## T4 (`C:\dev\pm-t4`)

**Owns:** `src/app/ai/diagnose.py`, `scripts/ablation_diagnosis.py`, their tests.

### Task 1: run the pre-registered ablation on rendered v2

- Run all arms: `rules`, `rules_grasp_metric`, `code_all`, `hybrid`,
  `hybrid_blind`.
- **Budget:** ≤ 80 calls, ≤ $0.15. Never print `.env`.
- Change **nothing** in the pre-registration after seeing the results. Any
  deviation is reported as a deviation.
- Report per type, the negatives' false positives, the R1 bar pass/fail,
  and the cost.
- Say plainly what this means for Nemotron's role. Use T7's roles note for
  the options; **the user decides.**

---

## T1 (`C:\dev\pm-t1`)

**Owns:** the results and media scripts.

### Task 1: refresh results with the real numbers so far

1. Run `build_results_json.py --input-root` against T3's registry and evals
   (the 0/20s are real numbers now, not pending) and T2's yields.
2. Then run `render_charts.py`.
3. Commit the curated outputs under `docs/media/charts/`.
4. Re-run after T3 Task B and T4 Task 1 if they finish while you are active;
   poll every 15 minutes, for up to 4 hours.

No Isaac.
