# The Results page with the real demos, read from the experiment stores (2026-10-20, `pm/site-results-live`)

Branch `pm/site-results-live` in `C:\dev\pm-t8`, cut from `pm/live-11` at `2abc94e`. The name `pm/site-results` was
taken: T2's old Results-page branch, `52a31aa`. `C:\dev\pm-t7` was not touched while T4's `mouse20261020` run
used it. There was no GPU: headless Chrome ran on SwiftShader. Nothing was pushed.

## What it does

`/site/results` has a new **Real demos** section after the headline and its limits. It has three experiments,
each with its arms, tests, limits and sources:

| Experiment | What it shows | Read from |
|---|---|---|
| **Real webcam demos** | 0/10 pass as recorded (live, 9 pressed into the bin, up to 927 N) → rules 3/10 repaired → 24/30 copies verified → ACT on SANT's 27 episodes **3/40** (2.6–19.9%), 26 of 37 failures dropped. Stated as one arm, not a comparison; the scripted 17/40 is "for reference only", and the reading is that the number of repaired demos suggests a cause but doesn't show one | `human_exp/human10c`: physics markers, `results.json`, `evals/<run>/perfected_multiply_10.json` |
| **Blind repair A/B** | Run 1: rules 3/10 vs edits 5/10, McNemar p = 0.5. Run 2: 3/10 vs 2/10, p = 1.0. Both not significant. Repaired at least once over both runs: rules 3, edits 6. Cost $0.21 and $0.28 | `human_exp/repair_ab1`, `repair_ab2`: `ab_summary.json` (the union from the per-demo statuses) |
| **Tonight's mouse demos** | 10/10 pass live and 10/10 on replay; replay path within 1.6–4.6 mm on average (max 11 mm); peak contact 0.0 N; 10/10 cleaned up by the rules. **Raw vs SANT: Pending**, and it fills in from the run's own result | `human_exp/mouse20261020`: physics and repair markers, T4's results note (live pass, path error, contact), and `results.json` once it exists |

The scripted 3/40 vs 17/40 (p = 0.0005) stays as the page's headline, from `results.json` (T2's curated file).

Every number sits next to its source:
- **A note.** It is a link to the note on GitHub at its lines (`…/blob/perfect-then-multiply/docs/superpowers/notes/<note>.md#L379-L380`),
  with the path on hover.
- **Or a store file**, named in full ("Experiment store: human_exp/human10c/results.json").
- **The link base is `perfect-then-multiply`,** so the links 404 until the branch is pushed and merged there. One
  constant changes it: `REPO_BLOB` in `data.ts`.

### The intro reads the same numbers

`web/src/world/stations/intro/proof.ts` builds `PROOF` from the Results data:
- **The forest beat:** "9 of our 10 webcam demos … up to 927 N".
- **The proof beat:** 3/40 → 17/40, p = 0.0005, "10 webcam demos: 0/10 passed physics → 3 repaired → 24 verified
  variants", Nemotron labels 40/40.

`Story.tsx` no longer types any of them. Regenerating `stores.json` or editing `results.json` changes the story.

### The script: `scripts/build_site_results.py`

```
uv run --no-sync python scripts/build_site_results.py --data-dir C:\dev\pm-t6\data [--check] [--watch 300]
```

- **What it reads.** Stdlib only, and read only: it opens the stores and three notes, and writes nothing but `--out`
  (default `web/src/site/results/stores.json`). The output uses the page's schema (experiments → groups → arms,
  each count with a source).
- **The mouse slot.** It fills in from `human_exp/mouse20261020/results.json` when T4's run writes it, never from a
  smoke run. Then run the script again: `--watch 300` does that by itself, rebuilding every 5 min until the result is
  in.
- **Checking.** `--check` exits 1 when the file is out of date.
- **Citations.** Every citation names the text it quotes (`CITES`). A test checks each quote is on its cited lines,
  so a moved number fails a test, not the page.
- **The note facts.** The 9/10 and 927 N come from live test #10's note (no store records the forces). The mouse
  live pass, path error and contact are parsed from T4's per-demo table in its results note.

### Data model changes (`web/src/site/results/data.ts`)

- **Sources** are `{note, lines}` or `{file}`.
- **The merge.** `RESULTS` is `results.json` with `stores.json` merged in: its notes and facts are added, and its
  experiments replace curated ones of the same id. `fact(id)` and `noteUrl(source)` are new.
- **Removed:** the curated pending `human_demos` experiment (and its unused note), which the real experiments
  replace. Pending now holds only "Grasp fix, run 2".
- **Updated sentences:** the headline's "human demos come next" and the limit "No real person's demo has been
  recorded and verified yet" now point at the real demos further down.

### Also on this branch

- **`pm/site-results-2`** (`60ec45b`, T2): the results.json-driven Field Notes page, never on live-11. Merged in
  `8329e97`. One conflict, `web/src/App.tsx`: I kept live-11's `lazyPage` wrappers and took T2's `/pm/results` →
  `/site/results` redirect.
- **`pm/kb-prereg`** (`bdad196`, T4): the mouse results note and the pre-registration amendment. Merged in `93653d5`.
- **T3's A/B note at `pm/nemotron-repair` `079e454`.** Only the note file was taken, so the repair_ab2 lines can be
  cited. That commit's code (the hybrid repairer) is not on this branch. The note blob is identical to T3's, so a
  later merge of their branch won't conflict on it.

## Checks

| Check | Result |
|---|---|
| `tests/test_build_site_results.py` (written first; all 10 failed before the script) | 10 passed |
| Full `pytest` (pm-t7's venv read-only, `PYTHONPATH=src` so pm-t8's code is tested, `--no-sync`) | 2041 passed, 15 skipped, 0 failed |
| Web tests (new tests written first; they failed before the code) | 1463 passed, 1 skipped (162 files); 99 after the last `Cite` change (results + intro) |
| `tsc -b`, `npm run build` | clean, OK |
| Headless Chrome, SwiftShader, `vite preview`, 1280×720 and 390×844 @3× | `/site/results` and the intro beats, no console errors. The note links resolve to `…#L325`, `…#L434`, … |

**Found and fixed in the browser.** The long store path (`evals/hx_human10c_…/perfected_multiply_10.json`) didn't wrap,
which widened the page: 430 px at a 390 px viewport, and an 11 px sideways scroll at 1280. Store-file citations now
break anywhere (`.sant-cite--file`). Measured after: no sideways overflow at either width.

## Screenshots (`2026-10-20-site-results-live/`; `d-` 1280×720, `p-` 390×844)

| Shot | What |
|---|---|
| `*-r1-top` | the page's headline (scripted 3/40 vs 17/40), unchanged |
| `*-r2-real-demos` | the new section's header |
| `*-r3-webcam` | the webcam pipeline: 0/10, 3/10, 24/30, 3/40 with its CI and drops |
| `*-r4-repair-ab` | both A/B runs with their McNemar p, and the at-least-once union |
| `*-r5-mouse` | the mouse demos: 10/10 live and replay with the path error, the policies Pending |
| `*-i1-forest`, `*-i2-proof` | the intro's forest and proof beats, from the data |

## Not done, or unverified

- **The mouse result isn't in yet.** When `results.json` lands, run the script (or leave `--watch` running), check
  the diff and commit `stores.json`. After that, T4's note's section 4 should be cited for the counts instead of the
  store file. That is one `CITES` entry.
- **The cartridge texts in `world/scene/items.ts`** still type their numbers (3/40, 17/40, 40/40, …). Only the intro
  beats were moved to the data, as asked.
- **Not on a real GPU.** It was SwiftShader only.
- **The note links** point at `perfect-then-multiply` and won't resolve until that branch has the notes.
