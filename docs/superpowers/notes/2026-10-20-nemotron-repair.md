# Nemotron as SANT's repairer: concrete trajectory edits, physics verifies (2026-10-20, branch `pm/nemotron-repair`)

Branched from `pm/live-11` at `cef4033`. No Isaac and no GPU were used: the GPU was training. The Nemotron calls
were real: text only, `super` tier, about $0.20 in all today.

## What it is

Before this, repairs were hand-written ops (`repair.py`). Either the rules chose them (including `release_above_bin`
and the rules-emitted `recenter_grasp`), or Nemotron picked from that fixed menu. Now Nemotron writes **concrete
edits to the tool path** for any failure, code checks them, and physics verifies the result.

- **`src/demo_pipeline/edit_plan.py`**: a small, strict edit language (pydantic, `extra="forbid"`), and
  `apply_edits(trajectory, edits) -> EditResult`, which is pure.
  - The edits:
    - `shift_segment(t0, t1, dx, dy, dz)`
    - `move_point(t, x, y, z)`
    - `insert_waypoints(t0, t1, points[{t, x, y, z}])`
    - `set_gripper(t, open|closed)`
    - `retime(t0, t1, factor)` (0.5–3)
    - `cut(t0, t1)`
  - Times are on the ORIGINAL demo's timeline; positions are world metres. Path and gripper edits apply first, then
    the timing edits, which map their times through earlier timing edits as `apply_repairs` does.
  - **Safety rules in code.** Any problem raises `EditError`, which lists every problem as a readable line; those
    lines go back to the model as they are.
    - **Repair budget:** no output step ends up more than 5 cm from where the original had the tool at that moment.
      Each step keeps its source time, so this also holds through cuts and retimes. dx, dy and dz are also capped at
      0.05 in the schema, which catches centimetres given by mistake.
    - **Workspace:** every moved step stays inside x 0.20–0.80, y −0.45–0.45, z 0.01–0.50 m.
    - **Smoothness:** every blend is a quintic min-jerk ramp, sized so one edit's own jerk peaks at 10 m/s³ (5 cm
      takes about 0.67 s). Two checks:
      - **A.** The edit field (new path − original at the source time) has jerk_rms ≤ 10 in every 0.5 s window.
        That is half the rules' 20 m/s³ jitter limit, so an edit never creates a jitter window on its own.
      - **B.** The tremor-free path (Gaussian σ = 0.1 s) stays at or under max(20, the demo's own worst window) +
        10. This catches cuts in mid-motion and fast retimes.
  - **What-changed report** (`EditReport`): max and mean cm moved, steps moved, where the largest move is, duration
    before and after, every timing change (span and seconds before and after), and every gripper change (from and
    to). `.text()` gives one line.
  - **`set_gripper` semantics**, fixed after the first real calls. If the gripper is not in that state at t, the
    next switch to it moves back to t (with none, one is added). If it is, the switch that put it there moves
    forward to t. So "open at 7.0" means release at 7.0, whether the recorded release was earlier or later. The
    first version moved the *nearest* switch. Nemotron's "closed at 5.94" ("keep holding") then moved a close from
    3.88 s and would have dropped the cube mid-carry.
- **`src/app/ai/nemotron_repair.py`**: `repair_with_nemotron(demo, verdict, signals, verify, ...)`.
  - **The prompt** (text only, about 4k tokens) has:
    - the step summary: reach/grasp/carry/place/release with times, from `robota.phases` on the replay;
    - the verdict, with every reason explained;
    - the signals: spans of arm contact above 5 N (peak, when, the tool there, gripper state), each grasp's offset
      from the cube's centre, cube lifted or not, each release (holding? the cube's centre above the bin origin,
      over the bin's inside?), regrasps, lost-while-closed, the final cube position;
    - the scene geometry from `scene_geometry` and the scene's poses (walls, rim top, floor, the high_release
      height);
    - a path table every 0.2 s.
  - **The loop.** It asks for JSON edits only, then validates and applies them. An invalid reply goes back with its
    errors. A failed verification goes back with the new verdict and the new replay's facts and path, mapped to the
    ORIGINAL timeline. Every round's edits apply to the original demo. The loop stops after `MAX_ROUNDS = 3` model
    calls; an invalid reply spends one.
  - **Give up:** `{"edits": []}` means "no edit within the rules can fix this". It ends the loop without a replay.
  - **Verifier, injected.** Tests use a toy one; production uses the sim worker's `/replay`, which is Isaac plus the
    unchanged `check_success`.
  - **Dry run:** `verify=None` stops at the first valid plan (status `unverified`).
  - **Model:** `super` tier with thinking on. Measured below: thinking reasons about the grasp, which no-think
    never did.
  - **Never shown to the model:** `release_above_bin`, any hand-written op, and the rules' diagnosis. A test checks
    every prompt.
- **The perfect loop.** `app.jobs.perfect_stored_demo_edits` is the alternative repairer.
  - A raw replay that already passes is kept, with no model call.
  - Each plan is verified as `<id>_edits_v<k>`. A verified one becomes `<id>_edits` (source `repaired`) with its
    Passport and `edit_plan.json`.
  - `Passport.repairs_applied` stays `[]`, because edits are not menu ops. The plan lives in `edit_plan.json`.
  - The human demo gets `edit_repair.json` (every round) either way.
  - Errors: an infrastructure error fails the job, and a `sim_error` discards the demo.
  - **Behind a flag:** `scripts/run_human_demo_experiment.py --repairer rules|nemotron-edits`, frozen as
    `config.json` `repair`; the default is `rules`, as before.
- **`scripts/nemotron_repair_dryrun.py`**: real calls on stored, failed replays, with no simulator.
- **`scripts/run_repair_ab.py`**: the blind A/B for tonight (below).
- **`demo_pipeline.stats.mcnemar_exact`**: the paired test.

**Tests.** `tests/test_dp_edit_plan.py` (21), `tests/test_nemotron_repair.py` (13), `tests/test_app_jobs_edits.py`
(5) and `tests/test_run_repair_ab.py` (5), plus one each in `test_run_human_demo_experiment.py` and `test_stats.py`.
The model is mocked, and the replay is a toy cube that sticks to closed fingers, judged by the real `check_success`.
- A demo that presses the cube into the bin is fixed by a correct `shift_segment`.
- An over-budget edit is rejected and the error goes back; the simulator never sees it.
- Invalid JSON and a fenced reply are retried.
- A failed verification feeds back the new verdict, with times on the original timeline.
- The what-changed report.
- Max rounds, giving up, and the dry run.

Full suite: 1926 passed, 15 skipped (4.5 min).

## Real Nemotron calls on the 10 human demos' signals (no Isaac)

`scripts/nemotron_repair_dryrun.py` was run on the human10c store
(`C:\dev\pm-t6\data\human_exp\human10c\store`). Each run used the raw replay's verdict and signals, with no
simulator, so a plan is only **valid** (it passed the code rules), never verified. Four passes, about $0.20 in all; every reply is saved in
`2026-10-20-nemotron-repair-dryrun/` (v1 no-think and think, v2 fixed code, v3 final prompt on the give-ups).

- **Thinking off vs on (first prompt).**
  - **Thinking off:** 7 plans, $0.002 a demo, about 5 s a call. It only chased collisions: it nudged the place up
    or sideways and opened earlier. It never looked at the grasp, and two plans pushed dy to the 5 cm limit against
    a wall.
  - **Thinking on:** $0.008 a demo, about 40 s a call. It reads the grasp offsets and lifts. For example, on 3997
    it found "the reach missed the cube" and shifted the grasp by 4 cm.
  - **Kept: thinking on.**
- **Two flaws in my code, found by these calls and fixed:**
  - **Check B was too strict.** a029 and 9f47 were rejected for "23 m/s³ vs the demo's own worst 22": a tiny edit
    in an already jerky window. B now allows the demo's worst + 10 (the margin A gives an edit).
  - **`set_gripper` was "nearest switch"** (see above).
- **Thinking on, fixed code (v2):**
  - **Valid plans (6):** 66bc, 9f47, 87bd, c045, 3997 and 7b1f (7b1f after one over-budget rejection, 7.3 cm).
  - **Gave up (4):** 0576, a029, fb12, a67b. a029's give-up was wrong: the rules perfected a029 last night with
    `recenter_grasp`. Nemotron reasoned that "the hand pulls back 13 cm after reaching, so the tool can't stay over
    the cube".
- **Prompt fix.** Two lines were added; both are physical facts and a cost fact, not a hand-written op:
  - "once the fingers close on the cube it moves with the tool, so what makes a grasp is where the tool is as the
    fingers close";
  - "a failed try costs only a replay; when unsure, send your best edits".
- **Re-asked on the 4 give-ups (v3, final prompt):**
  - **a029:** shifts the grasp by exactly the measured offset (+18 / −4.5 / −13.5 mm).
  - **fb12:** re-aims the second grasp by 4.5 cm and lifts the place 2 cm.
  - **0576:** re-aims the first grasp by 3.6 cm and keeps the gripper closed across the regrasps until 8.0 s.
  - **a67b:** still gives up ("the cube must move 0.2 m in y"), which is plausible: the cube was never held.
  - Rejections the model then fixed itself: over-budget (5.7 cm), workspace (z 0.01), and "already closed" at the
    exact switch time. That last one is now a no-op instead of an error.
- **Per demo, the final prompt's plans (v2 for the 6 that were already valid, v3 for the 4 re-asked):**

| demo | raw verdict | Nemotron's plan (dry run) | moved |
|---|---|---|---|
| 7b1f | not_in_bin, collision, dropped | nudge the early carry toward the cube +2 cm up; carry 2 cm in x; place 3 cm higher; release at 9.0 | 4.5 cm |
| 66bc | collision, dropped | place 2 cm higher (9.0–10.8) | 2.0 cm |
| 9f47 | collision | clear the bin's wall and rim (+1/−3 cm x, +1.5 cm z) | 3.6 cm |
| 0576 | not_in_bin, dropped | re-aim the first grasp 3.6 cm; hold closed across regrasps; release at 8.0 | 3.6 cm |
| a029 | not_in_bin, dropped | grasp on the cube's centre (the measured offset) | 2.3 cm |
| 87bd | not_in_bin, collision | `move_point` the third grasp onto the cube; carry and release 2 cm higher | 4.8 cm |
| fb12 | not_in_bin, collision | re-aim the second grasp 4.5 cm; place 2 cm higher | 4.5 cm |
| a67b | not_in_bin, collision, dropped | gave up (cube never held; 20 cm away) | — |
| c045 | collision | place 2 cm higher; open at 7.7 instead of 7.9 | 2.0 cm |
| 3997 | not_in_bin, collision | re-aim the grasp +4 cm x, close at 5.6; lower the place 2+2 cm; open at 12.0 | 4.0 cm |

**What this shows:**
- **Sensible.** The edits are concrete, the moves land in the right places, and the "why" matches the facts.
- **Self-correcting.** Nemotron repairs its own rule violations from the error lines.
- **Not yet shown.** Whether the edits pass physics. Tonight's test decides that.
- **One worry.** 3997 *lowers* the place by 4 cm. Its why says the cube was "too high", but the collision facts say
  the arm hit the wall. Physics will tell.

## Result: the blind A/B, run 2026-10-20 10:27–11:20 (`repair_ab1`)

The lead's session ran it while the user was at college, with the command below. Exit 0.
- Frozen at commit `1718f5f` (clean, no `+dirty`), prompt sha256 `836b5291…`.
- 53 min, not the 25–30 estimated: later rounds' calls took 50–110 s with thinking.
- Nemotron cost **$0.207** (cap $1). gpu.lock was released at 11:20, and pm-t4-06 was told the GPU is free.
- Raw physics: **0/10** pass, the same reasons as human10c.

**Headline: rules 3/10 (Wilson 95% 0.11–0.60) vs Nemotron edits 5/10 (0.24–0.76).**
- Paired: both 3, only rules **0**, only edits **2** (66bc, 87bd), neither 5.
- Exact McNemar **p = 0.50**, not significant: as pre-registered, n = 10 can't show this.
- Nemotron repaired every demo the rules repaired, plus two the rules couldn't. It never saw `release_above_bin` or
  any hand-written op.

| demo | raw | rules (verifications; last ops) | Nemotron edits (calls/verifications) | each plan's what-changed → verdict |
|---|---|---|---|---|
| 7b1f | not_in_bin, collision, dropped | discarded (3) | discarded (3/2, $0.024) | r1 3.0 cm, retime [8,9] 1.00→0.90 s, close 3.70 (was 3.52), open 9.00 (was 8.54) → not_in_bin, collision; r2 3.4 cm, retime [6,8.5] 2.50→2.94 s, close 2.90, open 8.50 → not_in_bin, collision, dropped; r3 rejected (9.0 cm over budget) |
| 66bc | collision, dropped | discarded (3) | **perfected** (3/3, $0.024) | r1 5.0 cm, open 9.00 (was 10.12) → not_in_bin, collision, dropped; r2 2.8 cm, first grasp re-aimed +2.6/−1.1 cm, gripper held closed across the 5 regrasps → collision; r3 3.0 cm, same plus the tail +3 cm from 8.18 s → **pass** |
| 9f47 | collision | perfected (1; trim, smooth, release_above_bin) | perfected (1/1, $0.004) | r1 3.9 cm (carry +1.5 cm x +1 cm z, place +1 cm x +2 cm z) → **pass** |
| 0576 | not_in_bin, dropped | discarded (3) | discarded (3/0, $0.045) | r1 rejected (34.5 cm over budget, not smooth); r2, r3 no answer: hit the 16k-token cap while thinking |
| a029 | not_in_bin, dropped | perfected (2; recenter_grasp, then release_above_bin) | perfected (2/2, $0.010) | r1 2.3 cm, grasp onto the cube's centre (+1.8/−0.5/−1.3 cm) → collision; r2 3.0 cm, + the release +3 cm, open 6.20 (was 6.00) → **pass** |
| 87bd | not_in_bin, collision | discarded (3) | **perfected** (2/2, $0.010) | r1 3.9 cm, third grasp re-aimed (−3/−2.5 cm) → collision; r2 4.0 cm, + carry and place +2 cm → **pass** |
| fb12 | not_in_bin, collision | discarded (3) | discarded (3/3, $0.030) | r1 2.1 cm, grasp +2 cm x → not_in_bin, collision, dropped; r2 4.9 cm, grasp +4.5 cm x, place moved → same; r3 5.0 cm, grasp +4.7 cm x, close 3.70 → same |
| a67b | not_in_bin, collision, dropped | discarded (3) | discarded (3/2, $0.023) | r1 rejected (6.5 cm); r2 4.0 cm, first grasp lowered 3 cm, tail +4 cm → not_in_bin; r3 2.2 cm, open 14.70 (was 15.16) → not_in_bin, collision, dropped |
| c045 | collision | perfected (1; remove_pause, smooth, release_above_bin) | perfected (1/1, $0.003) | r1 5.0 cm (the place +5 cm) → **pass** |
| 3997 | not_in_bin, collision | discarded (3) | discarded (3/1, $0.034) | r1 5.0 cm (carry +3 cm x, place −4 cm z) → not_in_bin, collision; r2 rejected (6.0 cm); r3 no answer: hit the token cap |

**What it says:**
- **The feedback loop is the point.**
  - Only 2 of the 5 passes came on the first try (9f47, c045). The other 3 needed the new verdict: a029 and 87bd
    were fixed in round 2, 66bc in round 3.
  - In each of those 3, Nemotron read the new collision facts and added a lift. The re-aimed grasps (a029, 87bd, 66bc)
    are concrete fixes of the measured offset.
- **Losses to fix next.** 3 of 23 calls ran out of the 16 000-token budget while thinking and returned no JSON:
  0576 lost 2 rounds, 3997 lost 1.
  - Fix: on `finish_reason == "length"`, re-ask once with thinking off and "answer now". Or raise MAX_TOKENS.
  - Either is a code change, so it needs a new pre-registration.
  - 3997's r1 again *lowered* the place (the worry from the dry run), and it failed.
- **Caveat.** One run each, and PhysX is not deterministic: the two edits-only wins could flip on a re-run. A
  repeat (`--name repair_ab2`) would show how stable the 5 vs 3 is.
- **Files.** Every round's reply, plan, report and verdict is in
  `C:\dev\pm-t6\data\human_exp\repair_ab1\ab\<id>.json`; the verified edited demos are stored as `<id>_edits`
  in that experiment's store.

## The blind test's command (Isaac; run 2026-10-20, results above)

Run from `C:\dev\pm-t3`, in PowerShell. The script takes `C:\dev\gpu.lock` itself; don't hold it by hand.

```
cd C:\dev\pm-t3
uv run --env-file C:/Users/dhrce/OneDrive/DOCUME~1/HACKAT~1/NEBIUS~1/.env python scripts/run_repair_ab.py --name repair_ab1 --tag "human_20261019*" --data-dir C:\dev\pm-t6\data
```

- **Time:** about 25–30 min.
  - Isaac start: about 2 min.
  - Physics: about 3 min.
  - Rules arm: about 7 min (human10c took 6.5).
  - Edits arm: up to 3 model calls of about 40 s plus up to 3 replays per demo.
- **Spend cap:** `--max-cost-usd 1.0`. Expect about $0.10–0.30.
- **Resuming.** A re-run with the same `--name` resumes, and a demo cut off mid-way is redone from its raw replay.
  Exit codes: 2 means stopped (re-run), 1 means refused.
- **Output** goes to `C:\dev\pm-t6\data\human_exp\repair_ab1\`:
  - `preregistration.md`: the A/B's own, written before any repair;
  - `ab_config.json`: the commit and the prompt's SHA-256;
  - `ab/<id>.json`: both arms' full summaries per demo;
  - `ab_summary.json`, and the table printed at the end.

**Commit first.** `ab_config.json` records `git rev-parse HEAD` (with `+dirty` if there are uncommitted changes).

### Pre-registration (draft; the script writes the frozen copy)

- **Question.** On the same 10 human demos, does Nemotron's trajectory editing repair as many demos to a physics pass
  as the hand-written rules?
  - Nemotron is shown no hand-written op and no `release_above_bin`.
  - The rules include `release_above_bin` and the rules' `recenter_grasp`.
- **Demos.** The 10 `human_20261019*` demos from live test #10, frozen by demo.json and steps.npz hashes. They replay
  the achieved path (the arm's reached pose) with lookahead 0, as in human10c.
- **Arms.** Both arms run on each demo's one raw replay, in one sim worker. The arm that goes first alternates: even
  index rules first, odd index edits first.
  - **rules:** `perfect_stored_demo(..., "rules")`, with up to 3 verifications (perfect_demo's re-diagnosis).
  - **nemotron-edits:** `perfect_stored_demo_edits`.
    - Nemotron `super` with thinking, at most 3 model calls.
    - The edits stay within the 5 cm per-step budget, the workspace and the smoothness rules.
    - Each valid plan is verified (so up to 3 verifications).
- **Metric (primary).** The number of demos whose repaired output passes physics (status `perfected` or `kept`),
  per arm, out of 10.
  - The verdict is the sim worker's replay and the unchanged `check_success`, for both arms.
- **Test.** Exact two-sided McNemar on the paired outcomes, α = 0.05, with a Wilson 95% CI per arm.
  - One test, no interim looks, and n is fixed at 10.
  - With 10 demos, only a large difference can be significant. Even 0 vs 5 discordant gives p = 0.0625.
  - So the headline is the counts and the paired table, reported whatever they say.
- **Not counted.**
  - A worker failure or a Nemotron API failure stops the run; the demo is redone on resume.
  - A spend-cap stop does the same.
  - None of these counts as a failure for either arm.
- **Reported whatever it says:**
  - per arm: the passes, the Wilson CI and the status per demo;
  - the paired table (both / only rules / only edits / neither) and the McNemar p;
  - for the edits arm: rounds, rejected plans, the what-changed report, and Nemotron's cost.
- **Known caveat.** PhysX is not deterministic, and the live grasps were marginal. Replay fidelity was 2–4/10 in
  human10c. The two arms share the raw replay but not their verification replays, so a demo can pass or fail by
  luck in either arm.

## Open

- **Grasp edits are the weak spot.** Nemotron often moves the grasp by a few cm, but only physics can say whether a
  re-aimed approach still closes on the cube. The rules' `recenter_grasp` aims at the scene's cube pose, and the
  model can do the same with `move_point`/`shift_segment` from the facts it gets.
- **Edits on top of the rules' smoothing** (rules first, then Nemotron edits) is a possible third arm. It was not
  built.
- **The API and the UI** (`/perfect` with `diagnoser`) don't offer `nemotron-edits` yet. Only the experiment flag
  and the A/B script do.
