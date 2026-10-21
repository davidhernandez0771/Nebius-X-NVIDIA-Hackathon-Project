# The practice-and-correct loop (2026-10-20, pm/practice-correct)

This is step 9 of the research note (`pm-t8 docs/superpowers/notes/2026-10-20-research-cube-in-bin.md`, section
(d), after IWR and RaC): run the policy on practice scenes, find where each rollout went wrong, rewind about 1 s, and
let the scripted expert or a person finish from there. Every correction is verified with the unchanged check and
added to a new dataset cell.

The branch comes from pm/live-12 (eb3546a). It's code only and Isaac was never started: stub traces and a fake
runner stand in. The exact GPU command is below.

## What it reuses and what is new

**Reused unchanged:**
- `sim_eval/scripts/eval_cells.py --trace` saves every control step of every rollout. Joints, tool, cube pose and
  contacts are saved per step, so any step is a restorable checkpoint.
- `sim_worker/recovery.py` restores a mid-episode state with zero velocities, and its `recovery_trajectory` is the
  scripted expert's way out: reopen, rise, re-centre, then the usual pick and place.
- `sim_worker/scripts/recovery_dataset.py` + `run_recovery` replay each continuation with cameras, verify it with
  `check_success`, and stamp a passport with lineage `recovery-<policy cell>`. `lerobot_tools.assemble` keeps those
  out of `n_human`.
- The overnight runner's phase machinery and seed rules (`sim_eval/overnight.py`).

**One refactor in `recovery.py`.** The restorable-state rules moved out of a closure into `_restorer()`, plus
`state_at()` and a "rewind" hand-speed limit (0.15 m/s). Behaviour is unchanged: the existing 40 recovery and
overnight tests pass.

### New: `sim_worker/corrections.py` (pure)

**`failure_moments(trace, scene)`** gives the first of each kind, from the verdict's own signals:

| kind | rule |
|---|---|
| `failed_grasp` | a close that isn't holding the cube 0.5 s later |
| `high_close` | such a close with the tool > 15 mm above the cube centre and no lift within 0.5 s |
| `drop` | the fingers lose the cube with the gripper closed, off the bin (`check_success`'s "dropped") |
| `rim_hit` | the arm on the bin above 5 N (tonight's traced failures were all this, empty-handed) |
| `empty_at_bin` | closing or opening within 15 cm of the bin's footprint with nothing held |

**`correction_candidates()`** rewinds from each failure:
- **The rewind:** it takes the state 1 s before (`--rewind-s`). When that state can't be restored (hand moving,
  cube in the hand, in the bin, or tilted), it steps back further, up to 3 s.
- **Skipped failures:** a failure with no restorable state in that window is skipped and the reason is written.
  An example is a drop when the cube was in the hand the whole time: such states can't be restored faithfully, so
  they are reported, not forced.
- **Shared states:** two failures that land on the same state give one candidate.

**`RetakeQueue`** writes `DATA_DIR/corrections/queue/<name>.json`, one item per candidate:
- **Contents:** the restored state, its scene, the failure, the rollout trace, the checkpoint and the round.
- **Status:** open, done or skipped, plus the human demo that retook it.
- **Routes:** `GET /corrections/queue?status=` and `GET /corrections/queue/{name}`.
- **Not built yet:** the Record page doesn't open these items. Doing so needs the sink to start from a state.

**`corrections_grid()`** builds cell `corrections_<k>`: the base cell (by label, or `<condition>_<n_human>` as the
experiment grids name them) plus every verified correction. **`provenance_rows()`** gives, per correction, its
failure, the rewind, the rollout (seed, trace, checkpoint), the verdict and the round. It's written to
`provenance.json` and as `correction.json` inside each episode.

### New: `sim_eval/correction_round.py` + `sim_eval/scripts/correction_round.py`

One resumable GPU command. It takes `C:\dev\gpu.lock`, keeps the PC awake, and releases the lock on any exit.

1. **practice:** the policy on **practice seeds 5200–5279 only**. It refuses anything else, so the test seeds
   5020–5059 are never touched. Serial and traced, into `data/evals/<run>/practice_<cell>_traces/`.
2. **candidates:** writes `candidates.json` (every failure moment, rewind or skip reason), `correction_states.json`,
   and the queue items (with `--retake human|both`).
3. **corrections:** the scripted retakes are replayed and verified into a fresh `DATA_DIR` (`data/corrections_<run>/`).
4. **provenance:** `provenance.json` plus `correction.json` in each episode.
5. **grid:** `data/experiments/grids/<run>.json` with cell `corrections_<k>`. It stops if fewer than
   `--min-corrections` are verified (default 10).

`--retake human` stops after the queue.

## The GPU command for tomorrow (after T5 / T2 free the GPU; about 1.5 h: 60 rollouts at ~70 s, then ~40 replays)

```
cd C:\dev\pm-t6
C:\isaac\env_isaaclab\Scripts\python.exe sim_eval\scripts\correction_round.py --run-id corr_mouse_r1 ^
  --checkpoint data\experiments\hx_mouse20261020_20261020_164411\train\perfected_multiply_10\checkpoints\030000\pretrained_model ^
  --source-cell perfected_multiply_10 --base-grid data\human_exp\mouse20261020\grid.json ^
  --start-state data\experiments\hx_mouse20261020_20261020_164411\datasets\raw_10 --retake both
```

- **Check first:** add `--dry-run` to see the phases. I checked it against the real inputs: all six phases planned.
- **Smoke run first:** `--practice-n 2 --min-corrections 1 --run-id corr_smoke`.
- **Train the cell after** (not part of the round; pre-register the correction arm first, research note (e)):
  `C:\venvs\lerobot\Scripts\python.exe -m lerobot_tools.experiments --grid data\experiments\grids\corr_mouse_r1.json --steps 30000 --batch-size 8 --save-freq 2500`

**What to check after the run:**
- `candidates.json`: how many failure moments per kind, and how many were restorable.
- `correction_manifest.json`: the yield. The research note expects 30–40 verified from about 60 rollouts.
- Open 2–3 `episodes/corr_*` front frames: the expert should finish from the rollout's state.
- `GET /corrections/queue` lists the human retakes.

**Unknowns only Isaac can answer:**
- Do restored states look like the rollout? Recovery copies have never run on the GPU (`recovery_run2` is empty).
- Today's failures are mostly empty-handed rim clips. Rewinding 1 s before a rim hit usually lands mid-air at the
  rim height with the cube still on the table, which should restore; the yield will tell.

## Tests

- **`tests/test_corrections.py` (18):** every failure kind; first of each kind; the 1 s rewind; stepping back past
  a moving hand; the skip with a reason; one candidate per shared state; the expert continuation from a candidate;
  the queue (add once, list, mark); the cell (by label and by `<condition>_<n_human>`); provenance.
- **`sim_eval/tests/test_correction_round.py` (7):** the phases end to end with a fake runner (practice command,
  replay `DATA_DIR`, candidates, provenance, grid); `--retake both` and `human`; reruns skip finished phases; too few
  verified stops before the grid; the practice-seed guard; preflight.
- **`tests/test_corrections_api.py` (3):** the queue route.
- **Full suite** (`uv run --no-sync pytest -q` from the repo root): 2541 passed, 28 skipped, 0 failed.

**Leftover:** an empty folder `data/evals/corr_dryrun_check/`, made by the first dry-run before I moved its `mkdir`
past the dry-run check. It's safe to delete by hand.
