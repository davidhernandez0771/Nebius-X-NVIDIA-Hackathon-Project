# Record: the take review coach (2026-10-20, pm/take-review)

The branch comes from pm/live-11 (2abc94e). It's code only and uses no GPU. It was checked end to end on the
user's real takes with a stand-in sim (below). Nemotron was never called live: its path is tested with fake replies.

## What it does

### 1. The backend

- **Module.** `src/demo_pipeline/take_review.py`. It is pure and has no Isaac.
- **Route.** `GET /demos/{id}/take-review?phrasing=rules|nemotron` returns
  `{demo_id, verdict: PASS|FAIL, lines, source, rejected, facts}`.
  - 404 if there's no such demo; 409 without `episode/signals.npz`; 422 if a file is corrupt or the steps don't add up.

**The facts.** All come from what the sim saved.
- **The verdict:** the live `check_success`, recomputed exactly as `make_store_saver` ran it at save time: the
  same trajectory and signals, and the reached-vs-commanded residual as the reach signal.
- **The peak:** the largest arm force on the bin or table, when it happened, and against which.
- **The soft floor:** on or off, how long it held the target up (its recorded steps × 0.02 s, one decimal), and in how
  many separate dips. Dips are runs of held steps, counted by the sim from this commit as `Assist.soft_floor_dips`.
  Older takes have no dip count, so their line gives only the time, and their demo.json stays byte-identical
  (checked: 20/20 real demos re-serialize unchanged).
- **Each close:**
  - The tool point's horizontal offset from the cube centre, in mm.
  - Whether it was caught, meaning the gripper is still closed and holding the cube 0.5 s later. A finger brushing
    the cube as it closes is not a catch.
- **Each release of the held cube:** the cube's bottom over the rim in mm (negative = under it), and whether it was
  over the bin.
- **Also:** regrasps (closes after the first) and the duration.

**Where the grab offset comes from.** It uses the reached path from `episode/steps.npz`. The 10-19 takes stored
the hand targets as their trajectory, up to 12 cm from where the arm was. With the targets, the 927 N take's grab
reads 76 mm off; with the reached path it's 1 mm.

**The lines (rules, always work).** There are 2–4 lines: the verdict, the pushing (plus the floor), the grab (plus
regrasps and grabs that didn't hold), and the release. They give tips past 8 mm off-centre, or more than 50 mm over
the rim.

**Nemotron (optional, `phrasing=nemotron`).** It uses the nano tier through the existing `nebius_llm.chat`, with
the facts and the rules' lines as the prompt. Its reply is used only if:
- it's a JSON list of 2–4 lines, each under 120 characters, and
- every number in it is one of the facts' numbers as shown, or the check's own limits (5 N, 30 s, 1 s).

Otherwise it falls back to the rules, and `rejected` says why ("40 in '…' is not one of the take's numbers"). Any
error also falls back.

### 2. /record

After a save (the sim's `demo_id`), the page fetches the rules' review. The bottom strip's wide cell, where the
live trace is, then shows:
- `take review · <id>` with PASS (teal) or FAIL (orange);
- the lines, each with its full text on hover.

The next recording brings the trace back. "Delete last demo" removes the review with the take. "Stop & discard"
asks for no review. While the review is loading the cell says "reviewing…"; if it fails, "no review" plus the
reason.

### 3. Fixtures

Five real takes are in `tests/fixtures/takes/*.json`, as JSON because the repo ignores `*.npz`; see the README
there. They are 2 clean mouse takes (floor held 39 steps; floor never needed), the 927 N press, a drop outside the
bin, and 531 N with 5 regrasps. A test checks that the rounded fixtures give the same facts as the originals in
`data/demos` when those are present; they are here, and it passes.

## Every real take, by the rules

| take | verdict | lines (abridged) |
|---|---|---|
| 10-20 mouse ×10 | PASS all | "No pushing; the floor held you for 0.5–2.7 s" (9/10; dc3e never needed it; no dip count: recorded before it), grabs 2–14 mm off-centre, let go 34–52 mm below the rim |
| 10-19 webcam ×10 | FAIL all | 9 collisions at 379–927 N (3 also dropped), 1 drop only; c045: "Pushed 927 N into the bin at 7.8 s (the limit is 5 N): ease off when it touches." |

The 10-20 rows match the lead's live report: 10/10 pass at 0 N, the floor held in 9/10.

## Checked end to end, no GPU

- Backend on port 8011 with `DATA_DIR=data` (read only).
- Vite on 5173.
- A stand-in sim on the relay sent one `sim_status` naming `human_20261019185902_c045`.
- Headless Chrome ran CPU-only (`--disable-gpu`, SwiftShader), because Blender and T4's training were on the GPU.

The cell showed FAIL and all four lines inside its 96 px (the list ends at 696 px, the cell at 708). "Delete last
demo" was in the top bar.

## Check tonight

1. Save a take. Within about a second the bottom-left cell should switch from the trace to "take review · <id>",
   PASS or FAIL, plus the lines.
2. Record again: the trace should come back. Stop: the new take's review should appear.
3. Stop & discard should give no review. Delete last demo should make the review go away.
4. Read the lines against what you did. Is the grab offset believable? Does "the floor held you for 0.8 s over 3 dips"
   match the take? This needs the sink restarted from this branch, which counts dips; the time is total held time.
5. Optional, costs a few tokens: `curl "http://127.0.0.1:8000/demos/<id>/take-review?phrasing=nemotron"`. Check
   `source` and, if it fell back, `rejected`. The page doesn't ask for Nemotron yet.

## Tests

- **Full suite** (`uv run --no-sync pytest -q` from the repo root): 2065 passed, 15 skipped at 0750190.
  After the wording change: 2072 passed, 1 failed, 15 skipped. The failure is the pre-existing flake
  `test_dp_store::test_new_ids_are_unique`: 50 ids from a seconds timestamp + 4 hex digits collide ~1.9% of the time.
  It passed 3/3 on re-run, and store.py is untouched. Web: 1438 passed, `tsc -b` clean.
- **Python:** `tests/test_take_review.py`, 34 tests. They cover the facts on the real takes, the lines, the number
  check (good, wrong number, invented precision, too few or many lines, too long, not JSON, a failing call), and the
  route (200, the reached path, nemotron used or rejected, 404/409/422).
- **Web:** `RecordConsole.test.tsx` covers PASS and lines after a save, the trace back while recording, FAIL,
  reviewing and errors, Delete last demo with the review gone, and Stop & discard asking for none.

## Wording change (lead, 2026-10-20)

The floor is no longer counted as "times", which were 20 ms steps. The line now says the held time, plus the number
of separate dips when the take has it:
- "No pushing; the floor held you for 0.8 s over 3 dips."
- "…for 0.8 s." on takes from before dips were counted.
- "…for under 0.1 s…" when it held for under 0.1 s.

Nemotron's number check no longer accepts the raw step count; the seconds and the dip count are allowed.

**Why the dips come from the sim.** I tried recovering dips from the saved commanded targets: the steps that sit
exactly on the floor. That doesn't work for mouse or keyboard. The floor clamps the hand target before smoothing,
so the saved command almost never sits on the floor: 0 matching steps in 8 of the 9 assisted takes. So the sim
counts them as it records (`teleop_session`, tests in `tests/test_soft_floor.py`).
