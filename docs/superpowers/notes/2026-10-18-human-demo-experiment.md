# T4: one command for the human-demo experiment (2026-10-18)

**Branch:** `pm/human-demo-exp`, from `origin/perfect-then-multiply` at `e94d817`. Not pushed, merged or rebased.

**Plan:** `docs/superpowers/plans/2026-10-18-human-demo-experiment.md`. It was run natively the same night, so
nobody reviewed it first.

## The ask

> When the user records ~10 demos with hand control on Record, ONE command should run the whole experiment: physics
> check -> repair/neaten -> multiply 10x10 -> LeRobot datasets -> train ACT on raw vs multiplied (30k steps) ->
> serial eval on seeds 5020-5059 -> Fisher's exact test + Wilson CIs -> a results JSON the Results page can read.
> Also attach the Nemotron verdict from T3's review_verdict composer. Prove it end to end tonight on stand-in demos
> (smoke only: 2k ACT steps, 5 eval seeds; no headline numbers).

## When you get back: what to do

**Status:** the smoke test ran every stage end to end on real Isaac, LeRobot and Nemotron (17:06, exit 0;
"The smoke run" below). The suite has **1550 passed, 18 skipped, 0 failed**.

**Before step 1:** `C:\dev\pm-t4` is now on `pm/human-demo-exp`, no longer `pm/hand-v4` (that branch is unchanged,
at `ef539f7`). To record from your hand-v4 Record setup, run `git switch pm/hand-v4` in `C:\dev\pm-t4`, record,
then `git switch pm/human-demo-exp` to run the experiment. Demos are plain files under `DATA_DIR\demos`, so both
branches read them.

1. **Pick one `DATA_DIR`** and use it in every terminal, for example `$env:DATA_DIR = "C:\dev\pm-data"`. The
   teleop sink saves demos there, or pass `--data-dir`. The experiment reads them from the same place.
2. **Record about 10 demos** on the Record page (RUNBOOK §4), with the sink started as:

   ```
   C:\isaac\env_isaaclab\Scripts\python.exe sim_worker\scripts\teleop_sink.py --viz kit --data-dir $env:DATA_DIR
   ```

   - The sink is an Isaac process. Check `C:\dev\gpu.lock` first.
   - **Close the sink when you're done.** While it runs it holds a GPU context, so the experiment's Isaac gate
     would wait for it.
   - Each demo is saved as `human_<UTC yyyymmddHHMMSS>_<4 hex>`. **The date in the id is UTC.**
3. **Look at what you recorded:** `dir $env:DATA_DIR\demos`. Choose `--tag "human_20261019*"` (a UTC date
   prefix), or list the ids yourself with `--ids human_...,human_...`. Leave out any try you don't want.
4. **Freeze the pre-registration first** (no training yet, about 1 hour of Isaac):

   ```
   uv run --with pillow python scripts/run_human_demo_experiment.py --name human10 --tag "human_20261019*" --data-dir $env:DATA_DIR --until grid
   ```

   - Read `$env:DATA_DIR\human_exp\human10\preregistration.md`, and the grid's notes in `stages\grid.json`.
   - Then commit a copy into `docs/superpowers/notes/`, so the git timestamp proves it came before the result.
5. **Run the rest: the same command without `--until`.** It resumes, so nothing is redone. Expected times on this
   PC (from the smoke run and sprint 7):

   | Stage | Expected time |
   |---|---|
   | Data (step 4) | ~55 min |
   | Nemotron | ~1 min, ~$0.02 |
   | Training (30k steps × 2 cells) | ~1–1.5 h |
   | Serial eval (40 seeds × 2 cells) | ~1.5 h |
   | **Total** | **~3.5–4 h**, plus any wait for the GPU lock |

   KeepAwake is held throughout. Each GPU stage takes `C:\dev\gpu.lock` and releases it.
6. **If it stops:**
   - Exit 2 means a worker or child process failed. Re-run the same command and it resumes.
   - **Training restarts a cell from scratch.** `lerobot_tools.experiments` has no resume, so an interrupted
     cell loses up to ~40 min.
7. **Read the result** in `$env:DATA_DIR\human_exp\human10\results.json`, under `experiment.headline`: counts,
   successful seeds, Wilson CIs, Fisher p. Report it whatever it says.
8. **Put it on the Results page** (your call): re-run with `--publish-results`.
   - This **replaces** `$env:DATA_DIR\results\results.json`, which is what `/results` serves. The old file is kept
     as `.bak-<time>`. In `C:\dev\pm-data` that file is today's sprint-7 page.
   - It refuses a smoke run.
9. **Merge:** push `pm/human-demo-exp` and open a PR into `perfect-then-multiply`. Two things to flag in it:
   - it copies T3's intent files verbatim;
   - it changes T3's `sim_eval` gate (see "Found live" below). T3 should review that part.

## What was built

| Commit | What |
|---|---|
| `9b96a3c` | The plan |
| `1133ccb` | `sim_worker/gpu_lock.py`: the `C:\dev\gpu.lock` protocol |
| `629fadc` | `sim_worker/human_exp.py` (pure experiment logic), `sim_worker/standin.py` + `scripts/make_standin_demos.py` (stand-in demos) |
| `300542b` | T3's `src/demo_pipeline/intent.py`, `src/app/ai/intent.py` and their tests, **verbatim** from `pm/nemotron-judge` (`65ee726`) |
| `b489476` | `scripts/run_human_demo_experiment.py`: the one command |
| `4221713`, `781f217` | Isaac gate fix (`sim_eval/report.py`, `eval_cells.py`, `run_eval.py`): a deadlock under the lock protocol, found live |
| `49bc556` | Results fixes found by the smoke: per-arm eval details kept, one honest ablation bar |

**`gpu_lock.py` details:**
- It waits while the PID is alive (5-min re-check) and takes over a stale lock.
- It creates the file with `O_CREAT|O_EXCL`.
- It deletes the lock only while it still holds our line, also on failure.
- PID liveness uses Win32 `OpenProcess`. `os.kill(pid, 0)` would *terminate* the process on Windows.

**About the T3 copy:**
- The blobs are identical to T3's, so merging `pm/nemotron-judge` later is clean.
- They are not edited. That branch isn't merged yet, and the orchestrator needs `review_verdict`.

### The stages (`scripts/run_human_demo_experiment.py --help` has the same)

Every stage writes a marker under `DATA_DIR/human_exp/<name>/stages/`. A re-run resumes from the markers, and in
`multiply` from each variant.

1. **select**
   - The demos come from `--ids a,b,c` or `--tag "<fnmatch over human demo ids>"`.
   - The selection is frozen in `config.json` with each `demo.json`'s SHA-256 and every setting.
     `preregistration.md` is written from it.
   - A re-run with other settings is refused. Use a new `--name`.
   - **Your DemoStore is read-only.** Only `demo.json` is copied into the experiment's own store (`<exp>/store`).
     `app.jobs.record_raw` replaces a store episode, and it would have overwritten your live recording with a
     replay.
2. **sim:** one sim worker (Isaac, Franka, cameras), started and stopped by the script under the GPU lock and
   KeepAwake.
   - **physics:** replay each demo as recorded: Isaac's verdict.
   - **repair:** `app.jobs.perfect_stored_demo(..., "rules")` → `<id>_rules`, verified in Isaac.
   - **align:** see "Start alignment" below.
   - **multiply:** `--variants` (10) scenes per repaired demo, seeds `3100 + 100·i + k`. Each variant is replayed and
     kept only if it verifies.
3. **grid:** `raw_<n>` and `perfected_multiply_<n>`, checked with `lerobot_tools.assemble.build_manifest` (lineage
   ≤ n human roots, no repairs in raw).
4. **nemotron** (billed, capped by `--max-cost-usd`, default $0.10):
   - T3's labeler for every human demo (8 front frames from the raw replay, at 256 px, plus the summary);
   - T3's judge for `--judge-copies` (1) verified copies per demo;
   - `review_verdict()` cards, saved as `review_verdict.json` next to each `passport.json` in the experiment store.
   - Physics decides. A failed call is `unavailable` and the run goes on.
5. **train:** `lerobot_tools.experiments` on both cells (lerobot venv), `--steps` (30k), batch 8, under the GPU lock.
6. **eval:** `sim_eval/scripts/eval_cells.py` (serial), seeds `--eval-seed0`.. (5020–5059), with both cells from the
   raw dataset's start state (`--start-pose dataset`), under the GPU lock.
7. **results:** the counts on the registered seeds only.
   - An episode that ended in `sim_error` / `policy_error` counts as missing and is resumed; it is never a failure.
   - Wilson 95% CIs and the two-sided Fisher exact p.
   - `<exp>/results.json` uses `demo_pipeline.results.build_results`, so it has the shape
     `web/src/pm/results/results.ts` parses (`series`, `ablation`, `multiply_yield`, `comparisons`), plus an
     `experiment` block: the headline, the data stage, the grid, the Nemotron cards and the pre-registration path.
   - `--publish-results` copies it to `DATA_DIR/results/results.json`, the file the Results page reads, and keeps
     the old one as `.bak-<time>`.
   - It refuses a smoke run.

`--smoke` sets 2000 steps and 5 eval seeds, and `"sample": true`, so the Results page shows SAMPLE DATA.

**Start alignment.** A teleop demo starts wherever your hand was when you pressed Start. Each demo would then start
somewhere else, and that start pose leaks information to the policy (the sprint 3 problem).
- **Every training episode, in both arms,** gets a min-jerk move from the home pose to the demo's first pose:
  `homeset.rehome(traj, 0)`, T2's function, unchanged.
- **Variants** are `rehome(transform_trajectory(aligned), k)`, exactly like sprint 6's home-start variants.
- **The eval** starts both cells from the same home start, as in sprint 7.

## Found live: the Isaac gate deadlocked the GPU lock

**What happened.** My first smoke launch (13:26) took the lock, then waited in the Isaac-free gate on T2's
`gpu_run.py`.
- That process was itself waiting **for my lock**.
- `sim_eval.report.isaac_gate` counted any python whose *command line* contains "isaac". T2's wrapper (a plain
  `pm-t2\.venv` python) has `C:/isaac/...python.exe` in its arguments.
- `eval_cells` / `run_eval` use the same gate, so the eval stage would have hung the same way.

**What I did:**
- I stopped my run and deleted my own stale lock (its PID was dead). T2's export then ran (it finished at 13:32).
- Then I fixed the gate, tests first:
  1. **Only an Isaac *executable* counts** (the command line's first token), not its arguments.
  2. **With nvidia-smi's process list** (`gpu_pids()`), an Isaac python counts only if it, or a child, holds a GPU
     context. T3's `gpulock_run.py` runs *from* Isaac's python while it waits, so rule 1 alone still blocks on it.
     Under rule 2 it is listed as `idle_isaac`.
  3. Without the list, the old rule holds.

`eval_cells.py` and `run_eval.py` now pass `gpu_pids()`. **For T3:** these are your files: 2 lines each, plus
`report.py`, with tests in `sim_eval/tests/test_sim_eval_report.py`.

## Pre-registration template (fill at `select`; the script writes the same text into `<exp>/preregistration.md`)

```
# Pre-registration: human-demo experiment `<name>`
Frozen at <UTC time>, before any training or evaluation, from config.json.

Question. Does a policy trained on the <n> human demos perfected and multiplied succeed more often than one
trained on the same <n> demos as recorded?

Demos (<n>, frozen by content hash):
  - `<id>` sha256 `<hash>`   (one line per demo)

Arms. Both arms use ACT, 30000 steps, batch 8, the same recipe and seed.
- raw_<n>: every demo as recorded, start-aligned (raw_arm = all: whether or not physics verified it).
- perfected_multiply_<n>: each demo rules-repaired and verified in Isaac, then start-aligned, plus 10 variants
  in new scenes, each kept only if it verifies. A demo whose repair does not verify contributes nothing to this arm.
- Start alignment (both arms): a min-jerk move from the home pose to the demo's first pose, in front of every
  training episode.

Primary endpoint. Success, as the eval's physics check decides it, on the unseen scenes with seeds 5020-5059
(n = 40 per arm). Serial eval (eval_cells.py); both cells start from the raw dataset's start state; 30 s limit,
front and wrist cameras.

Test. Two-sided Fisher exact test, alpha = 0.05, with a Wilson 95% CI for each arm.
- One test: no interim looks and no other endpoints.
- n is fixed in advance; it is not extended or cut on the result.
- An episode that ends in sim_error / policy_error is re-run (eval_cells resume); it is never counted as a failure.

Reported whatever it says: the counts, rates, CIs and p; the physics verdicts and repair outcomes; the multiply
yield; Nemotron's labels and matches (shown, never deciding).
```

**Power** (`demo_pipeline.stats.fisher_power`, two-sided α = 0.05, computed 2026-10-18), at n = 40 per arm:

| Effect | Power at n = 40 | n per arm for 80% |
|---|---|---|
| 7.5% vs 42.5% (sprint 7's effect) | 0.95 | 29 |
| 10% vs 40% | 0.85 | 38 |
| 10% vs 30% | 0.53 | 72 |

So 40 per arm is enough for a sprint-7-sized effect, not for a 20-point one. Pick n before you look, and write it
down: `--eval-n`.

## The smoke run (stand-ins, NOT a result)

**Data:** 10 stand-ins (`scripts/make_standin_demos.py --n 10`, seeds 7000–7009) in a separate data dir,
`C:\dev\pm-t4\data\smoke_human`.
- Each is the scripted expert on the Record page's scene, starting at home, then:
  - a late close (0.4–1.0 s holding open at the cube);
  - `degrade`: 1.5–3 mm tremor, one 0.5–1.2 s hesitation, an idle start and end, a 0–6 mm grasp offset, and
    1.1–1.5× slower.
- They run 13.4–16.0 s each.

**Command:**

```
uv run --with pillow python scripts/run_human_demo_experiment.py --name smoke_standin --tag "standin_*" --data-dir C:\dev\pm-t4\data\smoke_human --smoke
```

- It waited for the GPU lock from 13:42 to 15:37 (T3's regen, then its 30k training, then its eval).
- It then ran from 15:37 to 17:06 and exited 0.
- A second run of the same command resumed every stage from its marker and rebuilt only `results.json` (2 s, no
  GPU, no lock).

| Stage | Result | Time |
|---|---|---|
| sim worker start | healthy after 14 s | 15:37:37 |
| physics | 10/10 verified as recorded | 5.2 min (~31 s each) |
| repair (rules) | 10/10 perfected, 3–5 repairs each, each verified on the 1st replay | 3.6 min |
| align | 20/20 start-aligned episodes verified (raw + repaired) | 8.7 min |
| multiply 10 × 10 | **100/100** variants verified (yield 1.00) | 38.3 min (~23 s each) |
| grid | `raw_10`: 10 episodes / 7,624 frames; `perfected_multiply_10`: 110 / 65,892 | — |
| nemotron | 20 calls, all valid on the 1st try; labels 10/10 ok, matches 10/10 yes, 0 conflicts; **$0.0198**, ~1.75 s/call | 30 s |
| train (ACT, 2,000 steps, batch 8) | run `hx_smoke_standin_20261018_163418`; final loss raw 1.102, mult 1.218 | 17.5 min, incl. dataset export |
| eval (serial, seeds 5020–5024) | `raw_10` **0/5**, `perfected_multiply_10` **1/5** (seed 5023, 13.48 s sim) | 14.3 min |
| results | Fisher p = 1.0; Wilson CIs 0–43% vs 4–62%; `"sample": true` | — |

- The data stage's yield and the 2k-step eval say **nothing** about the method. Stand-ins aren't people, 2k steps
  is an undertrained ACT, and n = 5. **Do not cite any number from this table.**
- `results.json` passes the web page's own `parseResults` (`web/src/pm/results/results.ts`, bundled with esbuild
  and run on the file). It is shown as SAMPLE.
- **A Nemotron card** (standin_03):
  - Label: "The robot picks up a red cube and places it into a blue bin."
  - Copy match reason: "Both demos move a red cube into the same blue container, picking it up before placing it,
    and the copy's final frame shows the cube inside the container."

**Where everything is** (`data/` is git-ignored):
- **Experiment:** `C:\dev\pm-t4\data\smoke_human\human_exp\smoke_standin\`, which has `config.json`,
  `preregistration.md`, `run.log`, `stages\`, `grid.json`, `results.json`, `logs\` and `store\`.
- **Training run:** `...\smoke_human\experiments\hx_smoke_standin_20261018_163418\`.
- **Evals:** `...\smoke_human\evals\hx_smoke_standin_20261018_163418\`.
- **Nemotron calls:** `stages\nemotron\calls.jsonl`.

**Bugs the smoke found, fixed tests-first in `49bc556`:**
1. The headline dropped each arm's seeds and file: `compare()` overwrote them.
2. `build_results`' ablation bar "Rules + Nemotron repair" would have shown the multiplied cell. In this experiment
   Nemotron does not repair; it labels and judges. The file now has one bar, "Rules repair + multiply (this run)".

**Not checked or known limits:**
- The stand-in repairs all came out "perfected". Real webcam demos may be discarded or need re-diagnosis; that path
  is tested with fakes only.
- The `raw_multiply` series stays pending, because this design has no unrepaired-multiplied arm.
- **Lock handoffs.** A 5-min poll loses the handoff to a terminal that chains jobs. T3's regen released the lock at
  14:17:42, and T3's training took it 40 s later.
- **Blender** (pid 38132, not ours) was open the whole run. Nothing here used it. Your note says never to *render*
  in it while Isaac runs.
