# Import audit: which worktree's code did today's Isaac runs use? (`pm/import-guard`, 2026-10-20)

**Why this note exists:** the scene smoke test (19:44) found that Isaac's python imports `demo_pipeline` from
`C:\dev\pm-t2\src` unless the process puts its own `src` first. The lead asked for a read-only audit of today's
runs (no GPU, the venvs untouched), then a launcher fix plus a startup check.

**Branch:** `pm/import-guard`, from `pm/live-12` f43ae14. The smoke test's own fix is cherry-picked in
(701bbe0 → d5e1e61). Nothing pushed, merged or rebased; the `.pth` files are untouched.

**Answer:**
- **No Isaac run today produced a result from another worktree's code.**
- The only process that imported pm-t2's code was the scene smoke test's unit-test stage. It stopped at collection
  with an ImportError, so it produced no verdict.
- The risk is real, though:
  - 12 Isaac entry points and 3 LeRobot ones relied on their launcher to set `PYTHONPATH`;
  - `start-live.ps1` relied on the user typing the `PYTHONPATH` line it prints.

## 1. The editable installs

| Venv | File | Points at | Made |
|---|---|---|---|
| Isaac (`C:\isaac\env_isaaclab`) | `_editable_impl_nebius_hackathon.pth` (+ `nebius_hackathon-0.1.0.dist-info`, `direct_url` `file:///C:/dev/pm-t2`, pip) | `C:\dev\pm-t2\src` | 2026-10-15 16:56:50; unchanged since |
| LeRobot (`C:\venvs\lerobot`) | `_editable_impl_nebius_hackathon.pth` | `C:\dev\pm-t3\src` | 2026-10-15 16:59:40 |

**How the entry works:**
- Both are plain path entries, so they cover `src` only: `demo_pipeline`, `app`, `nebius_llm`. `sim_worker`,
  `sim_eval` and `lerobot_tools` come from the script's folder or the working directory.
- They come after the script folder, `PYTHONPATH` and any `sys.path` edit. So a process gets the other worktree's
  `demo_pipeline` only when nothing put its own `src` first.
- They point at a working tree, not a commit: what they import is whatever that worktree has checked out at that
  moment.

**Verified with Isaac's python** (CPU only):

| How it's started | `demo_pipeline` came from |
|---|---|
| bare | pm-t2 |
| `-m sim_worker.server` from pm-t7 with no `PYTHONPATH` | pm-t2 |
| with the experiment runner's `PYTHONPATH` | pm-t7 |
| with `run_eval`'s `sys.path[:0]` | its own checkout |

**What pm-t2 had checked out today** (its HEAD reflog, EDT):

| From | To | Checkout | `src` compared with live-11 (2abc94e) |
|---|---|---|---|
| (10-19 15:54) | 09:07 | `pm/live-start` f1818e0 | older |
| 09:07 | 12:23 | `pm/site-descent` 91b3ef8 (live-11 at 09:27) + web commits | older: 10 `src` files differ, `store.py` and `stats.py` among them |
| 12:23 | 15:05 | `pm/mimic-export` 0cc6e9d → 889fa4d | no `soft_floor.py`, no `Assist` label, + `mimic.py` |
| 15:05 | 17:03 | `pm/site-descent-2` 2abc94e | **identical** (web commits only) |
| 17:03 | now | `pm/data-showcase` → 14dc105 | `app` only (showcase router); `demo_pipeline` identical |

Uncommitted changes in pm-t2 at those times can't be recovered; it is clean now.

## 2. Today's Isaac-side runs: which code each process imported

| Run | Launched from | Isaac (and LeRobot) processes | Own `src` first? | Evidence |
|---|---|---|---|---|
| T3 repair_ab1 (10:27–11:20), repair_ab2 (12:38–13:34) | pm-t3 `run_repair_ab.py` → `hx.make_sim_session` | `-m sim_worker.server` | yes: `child_env` `PYTHONPATH={repo};{repo}\src` | worker log paths `C:\dev\pm-t3\sim_worker\…` |
| T4 human10c eval (11:50–12:37) | pm-t4 `run_human_demo_experiment.py` | `eval_cells` → `run_eval` (Isaac); policy server and training (LeRobot) | yes, twice: `child_env` and `eval_cells`/`run_eval`'s own `sys.path[:0]`; `start_server` sets it for the policy server | eval log paths `C:\dev\pm-t4\sim_eval\…` |
| T4 mouse20261020 sim stage (15:04–15:37) | pm-t7 `run_human_demo_experiment.py` | `-m sim_worker.server` | yes (`child_env`) | `C:\dev\pm-t7\sim_worker\placement.py` in the worker log |
| T4 mouse20261020 train + eval (16:44–19:19) | pm-t7 | training (LeRobot, `child_env`), `eval_cells` → `run_eval` | yes | `C:\dev\pm-t7\sim_eval\…` in the eval logs |
| T6 trace eval (~19:20–19:43) | pm-t6 `eval_cells.py --trace` | `eval_cells` → `run_eval` | yes: both scripts put their own `src` first however they're launched | `eval_cells.py`/`run_eval.py` line `sys.path[:0] = [src, repo]` |
| T2 Mimic smoke (13:07–13:54) | pm-t2 itself, on `pm/mimic-export` | generator + check | yes (and the `.pth` was pm-t2 itself) | `mimic_smoke.py` inserts its own `src`; `child_env` |
| T2 Mimic 10 + 100 (19:47–19:56) | pm-t2-mimic (889fa4d) | generator + check | yes: `mimic_smoke.py` inserts pm-t2-mimic's `src` at 0; the generator's `child_env` puts the repo and `src` first | `scripts/mimic_smoke.py` lines 29–32, 59–64 |
| Live Record, the mouse demos (14:37–14:43, `teleop_sink`) | pm-t7 per `start-live.ps1` | `teleop_sink.py` | only if the user typed the printed `$env:PYTHONPATH` line | all 10 demos carry `assist: {soft_floor: true, …}` and `input: mouse`; pm-t2's code then (889fa4d) had neither `soft_floor.py` nor `Assist`, so a sink on it would have crashed at import: **not pm-t2** |
| T5 scene smoke (19:44–19:47) | pm-t5 `scene_smoke.py` | pytest; `replay_regression` ×2; `settle_plan` ×3 | pytest **no**; the others yes | pytest: `No module named 'demo_pipeline.scene_plan'` from pm-t2's `src`; nothing ran, no verdict |
| `showcase-replay` (pm-t2/data) | not an Isaac run | — | — | its `run.log` is a copy of T4's mouse experiment log, used by T2's `replay_experiment_store.py` |

## 3. Runs that imported pm-t2's code, and what differed

**Only the smoke test's pytest stage did.** It collected nothing, so no verdict depends on it. Every other
verdict today (repair A/B, both T4 evals, the trace eval, Mimic, the smoke test's regression and settles) came
from the intended worktree's `demo_pipeline`. No diffs to report.

**The exposure if something had been mis-launched:**
- 15:05–17:03, pm-t2's `src` was identical to live-11.
- From 17:03 its `demo_pipeline` is still live-11's.
- Against live-12, though, it differs in 10 files and about 2,000 lines (`soft_floor`, `schemas`, `store`,
  `scene_plan`, `segment`, `take_review`, `robota`, …). From now on a mis-launched live-12 run would silently mix
  versions.

## 4. The fix (this branch)

**`sim_worker/own_code.py`** (stdlib only):
- `put_own_code_first()` moves this checkout's `src` and root to the front of `sys.path`.
- `check_own_code()`:
  - logs `[imports] demo_pipeline from <path>`;
  - raises ImportError if that path isn't this checkout's `src`;
  - the message names both paths and the fix.

**Every entry point now:**
- puts its own `src` first before any project import (`put_own_code_first()`, or the existing
  `sys.path[:0] = [src, root]`);
- calls `check_own_code()` first thing in `main()`.

**Which files:**
- Isaac side: `sim_worker/server.py`, all 15 `sim_worker/scripts` that import project code, `sim_eval/scripts`
  (3), `sim_eval/parallel/scripts` (2).
- LeRobot side: `lerobot_tools/experiments.py`, `start_state.py`, `train_smoke.py`.
- `replay_regression.py` checks `--code` rather than its own checkout. It also checks `sim_worker`, because the
  base vs branch comparison depends on both. The check is inline, because the base export predates `own_code`.
- `teleop_sink.py` now needs no `PYTHONPATH`, so `start-live.ps1`'s printed line is optional.

**`tests/test_own_code.py`** (29):
- the helper itself;
- a subprocess with another worktree's `src` on `PYTHONPATH`, the way the `.pth` puts it. It imports this
  checkout with the fix, and the other one without it.
- a guard: every entry point under those folders is parsed, and fails unless it puts its own `src` first before
  its first project import and calls `check_own_code()` in `main()`. A new script that forgets fails the suite.

**Checked in both venvs, CPU only, from pm-t5 with no `PYTHONPATH`:**
- `-m sim_worker.server --help` (Isaac, `.pth` → pm-t2) logs `[imports] demo_pipeline from C:\dev\pm-t5\src\demo_pipeline`;
- `-m lerobot_tools.experiments --help` (LeRobot, `.pth` → pm-t3) logs the same.

**Not changed:** the `.pth` files. The clean end state is to remove them, or point them at a neutral checkout,
which needs the user's OK. With the guard in, they no longer matter to any entry point.

**Outside the guard:** `scripts/*.py` run with Isaac's python, i.e. `scripts/mimic_smoke.py` and
`scripts/export_mimic.py` on `pm/mimic-export`. They already put their own `src` first. Add `check_own_code()` to
them when that branch merges.

## Checks

- **New tests:** `tests/test_own_code.py`, 29 passed. pyflakes clean on every changed file.
- **The full suite:** `tests` (without `test_launch_health.py`): 2121 passed, 19 skipped. `lerobot_tools`/`sim_eval` tests: 235
  passed, 10 skipped.
- **Found and fixed on the way:** three `lerobot_tools` tests parse `main()`'s stdout as JSON, so the log line goes
  to stderr; the launchers merge stderr into their logs.
