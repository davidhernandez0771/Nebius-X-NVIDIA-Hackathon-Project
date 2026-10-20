# Nemotron as SANT's repairer: concrete trajectory edits, physics verifies (2026-10-20, branch `pm/nemotron-repair`)

**In plain words.** We ran the same pre-registered test twice on 10 webcam demos that all failed the physics check.
Nemotron was never shown our hand-written fix.
- **First run (repair_ab1):** Nemotron repaired 5 of 10 and the rules repaired 3 of 10 (p = 0.50, not
  significant). Nemotron fixed every demo the rules fixed, plus two the rules could not.
- **Re-run (repair_ab2):** the same setup plus one bug fix. Nemotron repaired 2 of 10 and the rules repaired 3
  of 10 (p = 1.0).
- **Across both runs:** Nemotron 7 of 20, rules 6 of 20. These are two runs side by side, not one pooled test.
- **The honest reading.** Nemotron can repair human demos on its own, with concrete edits, often ones the rules
  can't: 7b1f, 66bc and 87bd were never repaired by the rules. But it is not reliably better. The rules repaired the
  same 3 demos both times; Nemotron's plans, and so its results, change from run to run.
- **How it works.** For each demo, Nemotron reads what the simulator measured: where the arm hit the bin, how far off
  the grasp was, where the cube was let go. It then writes small, concrete changes to the hand's path, never more
  than 5 cm anywhere. Isaac Sim replays each change and judges it with the same success check as the rules.
- **For the pitch:** "Nemotron, never shown our hand-written fix, repairs failed human demos with concrete edits that
  physics verifies: 5/10 and 2/10 in two blind runs vs the rules' 3/10 and 3/10. Across the two runs it repaired 6
  different demos at least once, the rules 3."

Branched from `pm/live-11` at `cef4033`. Before the A/B, no Isaac and no GPU were used: the GPU was training. The
Nemotron calls were real: text only, `super` tier, about $0.20 in all for the dry runs.

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

Full suite: 1926 passed, 15 skipped (4.5 min); 1933 passed, 15 skipped after the token-cap fix.

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

## The token-cap fix and the repair_ab2 re-run (code; the run's results are in the next section)

**The fix.** In repair_ab1, 3 of 23 calls used the whole 16 000-token budget thinking and returned no JSON. 0576
lost 2 of its 3 rounds this way, and 3997 lost 1.
- **What happens now.** When a thinking reply ends with `finish_reason == "length"`, or has no JSON object at all,
  `repair_with_nemotron` asks the same round's prompt once more. The re-ask has thinking off and `RESCUE_SUFFIX`
  ("…ran out of room before its JSON. Reply now with the JSON object only") added.
- **Not a lost round.** The rescue doesn't count as a round: MAX_ROUNDS stays 3, so a demo can now make up to 6
  calls.
- **Limits.** One rescue per round. If the re-ask has no JSON either, the round is spent as before. Replies with
  JSON go back as usual, valid or not.
- **What triggers it, and what doesn't.** Schema errors, over-budget plans and failed verifications never trigger a
  rescue. Neither does a reply made with thinking already off.
- **Logged** per round (`rescue: {reason, first_reply}`), per demo (`RepairResult.rescues`, and `rescues` in
  `perfect_stored_demo_edits`' summary and the dry-run output), and per run. `ab_summary.json` gets `model_calls`
  and `rescues: {total, length, no_json, demos}`, and the printed table ends with them.
- **Tests first.** 6 new tests in `tests/test_nemotron_repair.py`, all failing before the change, plus summary,
  pre-registration and refusal checks in `tests/test_run_repair_ab.py`.
  - The re-ask happens in the same round, without thinking, and the prompt keeps its prefix.
  - "no_json" is rescued too.
  - One rescue per round; a failed rescue spends the round.
  - No rescue for schema errors, or when thinking is already off.
  - `before_call` (the spend cap) runs before a rescue as well.
- **Real check.** One call on c045 with the budget forced down to 1 200 tokens: the thinking call ended `length`.
  The rescue answered in 1.2 s with a valid plan (place +2 cm, open at 7.85), so the round was not lost. $0.004.
- **The new settings are frozen.** `ab_config.json` now records `rescue` and `rescue_suffix_sha256`. A resume of an
  older run (repair_ab1's config) is refused; a test checks this. So the re-run needs a new `--name`.

### Pre-registration draft: `repair_ab2` (the script writes the frozen copy)

Everything is as in repair_ab1 (above), except the rescue.
- **Question.** The same: on the 10 `human_20261019*` demos, does Nemotron's trajectory editing repair as many demos
  to a physics pass as the hand-written rules?
  - Nemotron is shown no hand-written op and no `release_above_bin`.
  - The rules include `release_above_bin` and the rules' `recenter_grasp`.
- **Demos.** The same 10, frozen by demo.json and steps.npz hashes. They replay the achieved path with lookahead 0.
  Each demo gets a **new** raw replay in this run, and both arms share it.
- **Arms.** The same, with the first arm alternating by index.
  - **rules:** `perfect_stored_demo(..., "rules")`, with up to 3 verifications.
  - **nemotron-edits:** `perfect_stored_demo_edits`.
    - `super`, thinking on, 3 rounds, the 5 cm budget, the same prompt (sha256 `836b5291…`).
    - **New:** the one-time rescue per round described above.
- **Metric (primary).** Repaired demos that pass physics (status `perfected` or `kept`), per arm, out of 10. The
  verdict is the sim worker's replay and the unchanged `check_success`.
- **Test.** Exact two-sided McNemar on the paired outcomes, α = 0.05, with a Wilson 95% CI per arm.
  - One test, no interim looks, n = 10 fixed.
  - The counts and the paired table are reported whatever they say.
- **Secondary, descriptive:**
  - the number of rescues (at the cap / no JSON) and whether any round was still lost to having no answer;
  - per-demo agreement with repair_ab1 for each arm. This is the stability of a non-deterministic simulator, and of
    5 vs 3.
- **Not counted.** A worker, API or spend-cap stop is redone on resume and never counted for either arm.
- **Caveat.** Physics is not deterministic. repair_ab1 and repair_ab2 are two separate runs, not a pooled n = 20,
  and they are reported side by side.

**Command** (when T4's training is done and the GPU is free; from `C:\dev\pm-t3`, PowerShell; the script takes
gpu.lock itself):

```
cd C:\dev\pm-t3
uv run --env-file C:/Users/dhrce/OneDrive/DOCUME~1/HACKAT~1/NEBIUS~1/.env python scripts/run_repair_ab.py --name repair_ab2 --tag "human_20261019*" --data-dir C:\dev\pm-t6\data --max-cost-usd 1.0
```

- **Time and cost.** About 55 min, like repair_ab1. Spend should be about $0.25: a rescue costs one short extra
  call.
- **Prerequisite.** Commit first, so `ab_config.json` has no `+dirty`.
- **Clean early stop.** Create `C:\dev\pm-t6\data\human_exp\repair_ab2\STOP`. The demo in progress finishes,
  then the worker stops and gpu.lock is released. The same command later clears the file and resumes.
- **Output** goes to `C:\dev\pm-t6\data\human_exp\repair_ab2\`.

## Result: repair_ab2, run 2026-10-20 12:38–13:34 (the re-run with the rescue)

- **How it ran.** Started when T4 messaged "GPU free", from commit `ac8a694` (clean): the command above, unchanged.
  Exit 0 after 56 min, well before the 17:30 limit. The STOP watcher was not needed.
- **GPU handover.** gpu.lock was released at 13:34 and Isaac exited; pm-t2-63 was told "GPU free: run the Mimic
  smoke test."
- **Settings.** Frozen in `ab_config.json`: prompt sha256 `836b5291…` (the same as repair_ab1), rescue suffix
  `cb87bcb9…`.
- **Raw physics:** 0/10, as before.

**Headline: rules 3/10 (Wilson 95% 0.11–0.60) vs Nemotron edits 2/10 (0.06–0.51).**
- Paired: both 1 (9f47), only rules 2 (a029, c045), only edits 1 (7b1f), neither 6. Exact McNemar **p = 1.0**.
- Nemotron: **$0.278**, 30 calls.

**Rescues** (the fix): 4 calls hit the token cap: a029 round 2, a67b round 3, and 3997 rounds 1 and 2. All 4
re-asks returned JSON, so no round was lost to an empty answer (repair_ab1 lost 3). But 2 of the 4 answers (3997)
were over budget, and the rest failed physics. The fix did what it was meant to; it didn't add a pass.

**Side by side** (P = repaired and passes physics, – = discarded):

| demo | rules ab1 | rules ab2 | edits ab1 | edits ab2 | edits ab2: plans (what changed → verdict) | ab2 calls / rescues / $ |
|---|---|---|---|---|---|---|
| 7b1f | – | – | – | **P** | r1 2.4 cm: close 3.00 (was 3.52), carry 8–9 s −1/+2/+1 cm, open 8.80 (was 8.54) → **pass** | 1 / 0 / 0.009 |
| 66bc | – | – | **P** | – | r1 rejected (5.1 cm); r2 2.4 cm, reach re-aimed + place lifted 2 cm → not_in_bin, collision; r3 rejected (dx > 0.05) | 3 / 0 / 0.025 |
| 9f47 | **P** | **P** | **P** | **P** | r1 5.0 cm: release segment +5 cm, open 5.20 → **pass** | 1 / 0 / 0.004 |
| 0576 | – | – | – | – | r1 rejected (7.5 cm); r2 1.3 cm, hold closed across regrasps + a close added at 8.12 → not_in_bin, gripper_closed, not_settled; r3 3.0 cm, same holds, open 7.50 → not_in_bin, dropped | 3 / 0 / 0.036 |
| a029 | **P** | **P** | **P** | – | r1 2.5 cm, grasp shift (as ab1) + close 2.50 + a move_point on the lift → not_in_bin; r2 (rescued) + release lifted, open 6.20 → not_in_bin; r3 1.9 cm, grasp shift only → collision | 4 / 1 / 0.042 |
| 87bd | – | – | **P** | – | r1 4.7 cm, grasp re-aimed + carry +2 cm → not_in_bin, dropped; r2 retime ×1.1 → not_in_bin, collision, dropped; r3 rejected (6.2 cm) | 3 / 0 / 0.018 |
| fb12 | – | – | – | – | r1, r2 rejected (5.3, 5.4 cm); r3 3.2 cm, grasp +3 cm x, post-release −2 cm → not_in_bin, dropped | 3 / 0 / 0.026 |
| a67b | – | – | – | – | r1 rejected (7.6 cm); r2 3.8 cm → not_in_bin, collision; r3 (rescued) 3.6 cm, every hold +2 cm y, open 14.50 → not_in_bin, collision, dropped | 4 / 1 / 0.043 |
| c045 | **P** | **P** | **P** | – | r1 1.0 cm (+1 cm y), r2 1.8 cm (+1.5 y, +1 z, open 8.10), r3 2.8 cm (+2 y, +2 z): all → collision | 3 / 0 / 0.019 |
| 3997 | – | – | – | – | r1 5.0 cm (−5 cm y, open 12.40) → not_in_bin, collision; r2, r3 (rescued) rejected (8.0 cm) | 5 / 2 / 0.056 |
| **total** | **3** | **3** | **5** | **2** | | **30 / 4 / $0.278** |

**What the two runs say:**
- **Rules: perfectly stable.** The same 3 demos passed in both runs, with the same ops. PhysX noise didn't change a
  single rules outcome.
- **Nemotron: not stable.** It agreed with itself on only 5 of 10 demos: both pass 9f47; both fail 0576, fb12, a67b
  and 3997.
  - The flips came mostly from different **plans**, not physics noise. On c045, ab1's first plan was "the place
    +5 cm" and passed; ab2 tried small +y/+z shifts three times and kept colliding. On a029, ab2 added a close and
    a `move_point` on top of ab1's grasp shift.
  - The model runs at temperature 0.2 with thinking, so it explores. The rules are deterministic.
- **Over two runs:** Nemotron passed 7/20 demo-runs, the rules 6/20. Demos repaired at least once: Nemotron 6
  (7b1f, 66bc, 9f47, a029, 87bd, c045), rules 3 (9f47, a029, c045). The rules never repaired a demo Nemotron didn't
  repair at least once.
- **Lost rounds.** Over-budget plans cost far more rounds than the token cap did: 9 rounds were rejected in
  repair_ab2, all for going past the 5 cm limit (8 by the step budget, 1 by the dx cap). The model keeps wanting
  moves of 5–8 cm.
- **Ideas for next time** (each would need a new pre-registration):
  - Give the budget as a hint in the facts, for example the largest shift that still fits around each grasp.
  - Let the model see its own earlier passing plan, so it doesn't drift.
  - Sample at temperature 0.
  - Run both repairers and keep whichever passes: across the two runs that union is 6 of 10.

## The hybrid repairer, less plan variance, and the next A/B on fresh keyboard demos (code only; no GPU)

The lead asked for this after repair_ab2. Every change below was written tests-first and is frozen into
`ab_config.json`.

- **Hybrid repairer** (`app.jobs.perfect_stored_demo_hybrid`; `--repairer hybrid` in
  `run_human_demo_experiment.py`). This is the product candidate.
  - **Order.** `perfect_stored_demo(..., "rules")` runs first. Only if the rules discard the demo does
    `perfect_stored_demo_edits` run, on the same raw replay.
  - **Blind.** The edits' prompt comes from the raw replay alone, never from the rules' diagnosis or attempts.
    `release_above_bin` stays unseen; a test checks the prompt.
  - **Output.** The winning stage's demo (`<id>_rules` or `<id>_edits`). The summary keeps both stages' summaries and
    `stage`.
- **Less plan variance**, in `app.ai.nemotron_repair`:
  - **Temperature 0** (`TEMPERATURE`), on every call, rescues included.
  - **A budget hint** in the facts: `repair_budget: "max 5 cm per step from where the original had the tool at that
    moment, all edits together; plans over budget are rejected"`. In repair_ab2, 9 rounds were lost to over-budget
    plans.
  - **The best plan so far.** After a failed verification, the next round also gets "Your best plan so far is round
    k (failed: …). Its edits: … Keep what worked and change what the new facts show is wrong." "Best" means the
    fewest failure reasons, the earlier round on a tie; invalid replies never count.
  - **Fingerprint.** `prompt_fingerprint()` hashes the system prompt, the budget hint, the rescue and best-plan
    texts, the temperature, tier, thinking and token cap (`8e62711f…` now). `ab_config.json` freezes it with
    `temperature`.
- **Real check of temperature 0** (2 runs × 2 demos, no Isaac, $0.03). The API accepts 0 with thinking on, but the
  plans were still **not** repeatable:
  - **c045:** "+1.5 cm y, +1 cm z" in one run; "the place +2 cm, the release −2 cm x, open 8.10" in the other.
  - **a029:** a 4.6 cm forward shift in one run; a give-up in the other.
  - So temperature 0 reduces the variance at best: the thinking path or the server stays non-deterministic. That is
    why the hybrid, not temperature, is the main lever.
- **The A/B script** (`run_repair_ab.py`) now reports three arms.
  - **Derived hybrid.** The hybrid is derived per demo: the rules' result when it passes, else the edits'. The edits
    arm never sees the rules, so its run on a demo the rules discard is exactly what
    `perfect_stored_demo_hybrid` would run there. No extra replays.
  - **Comparisons.** Primary: rules vs hybrid. Secondary: rules vs edits alone.
  - **`--input`** is passed to `Experiment.select` only when given. On a checkout whose select has no `input`
    (this branch, before it is merged with pm/live-11), it refuses cleanly.

### Pre-registration draft: `repair_kb1` (fresh keyboard demos; the script writes the frozen copy)

- **Question.** On human demos the rules were never written for, does the hybrid repairer repair more demos to a
  physics pass than the rules alone? The hybrid runs the rules first, then Nemotron's blind trajectory edits for any
  demo the rules discard.
  - The rules' two failure-specific ops, `release_above_bin` and `recenter_grasp`, were written for the 10 camera
    demos of live test #10. These keyboard demos are new to both.
- **Demos.** Every saved human demo from live test #11 recorded with the keyboard: `--tag "human_2026102[01]*"
  --input keyboard` in `C:\dev\pm-t6\data`.
  - This is the same selection as T4's pre-registration (`pm/kb-prereg`); `[01]` also catches takes after midnight.
  - The ids and demo/steps hashes are frozen at select.
  - Achieved path, lookahead 0. Demos without an `input` never match.
  - n = however many were saved. With fewer than 6 demos the primary test cannot reach significance (see below),
    and the result is then descriptive only.
- **Arms**, all on each demo's one raw replay, with the first arm alternating by index:
  - **rules:** `perfect_stored_demo(..., "rules")`, up to 3 verifications.
  - **nemotron-edits:** `perfect_stored_demo_edits`.
    - `super`, thinking on, 3 rounds, the 5 cm budget, the same system prompt (sha256 `836b5291…`).
    - The rescue.
    - **New:** temperature 0, the budget hint in the facts, and the best failed plan each round (fingerprint
      `8e62711f…`).
  - **hybrid (derived):** the rules' result when it passes, else the nemotron-edits result. No replay of its own.
- **Metric.** Repaired demos that pass physics (status `perfected` or `kept`), per arm, out of n. The verdict is the
  sim worker's replay and the unchanged `check_success`.
- **Test.**
  - **Primary:** rules vs hybrid, exact two-sided McNemar, α = 0.05, with a Wilson 95% CI per arm.
    - The hybrid can only add passes (only_rules = 0 by construction).
    - So this is a sign test on the demos the rules discard and Nemotron repairs. It reaches p < 0.05 only with 6 or
      more of them.
  - **Secondary** (reported, not confirmatory): rules vs nemotron-edits alone, exact McNemar. Descriptive: rescues,
    rounds lost to the budget, model calls, spend.
- **Not counted.** A worker, API or spend-cap stop is redone on resume and never counted for any arm.
- **Caveats.**
  - The rules arm also produces the hybrid's first stage, so the two share its PhysX noise. That is by design: the
    question is what the edits add.
  - The keyboard demos' replay fidelity on achieved paths is unknown until tonight's physics step.

**Run it from `C:\dev\pm-t3`.** This branch now has pm/live-11 merged in (`d92c559`, merging `2abc94e`, with the
user's OK), so it has `Demo.input` and the `--input` filter.
- The one conflict was in `tests/test_run_human_demo_experiment.py`, where both sides had appended tests; both were
  kept.
- The suite on the merged tree: 2043 passed, 15 skipped (`uv run --no-sync pytest -q`).
- Leave `C:\dev\pm-t7` alone: the live test and T4's runs use it.
- When to run: after T4's keyboard run has finished and freed the GPU.
- Commit first, so `ab_config.json` has no `+dirty`.
- The script takes gpu.lock itself.

```
cd C:\dev\pm-t3
uv run --env-file C:/Users/dhrce/OneDrive/DOCUME~1/HACKAT~1/NEBIUS~1/.env python scripts/run_repair_ab.py --name repair_kb1 --tag "human_2026102[01]*" --input keyboard --data-dir C:\dev\pm-t6\data --max-cost-usd 1.0
```

- **Time:** about 2 min of Isaac start, plus 5–6 min per demo, as in repair_ab1 and repair_ab2.
- **Spend:** about $0.03 per demo; capped at $1.
- **Clean stop:** create `C:\dev\pm-t6\data\human_exp\repair_kb1\STOP`. The demo in progress finishes and the GPU is
  freed; the same command resumes.

## Open

- **Grasp edits are the weak spot.** Nemotron often moves the grasp by a few cm, but only physics can say whether a
  re-aimed approach still closes on the cube. The rules' `recenter_grasp` aims at the scene's cube pose, and the
  model can do the same with `move_point`/`shift_segment` from the facts it gets.
- **Edits on top of the rules' smoothing** (rules first, then Nemotron edits) is a possible third arm. It was not
  built.
- **The API and the UI** (`/perfect` with `diagnoser`) don't offer `nemotron-edits` yet. Only the experiment flag
  and the A/B script do.
