# Pre-registration: raw vs SANT on tonight's keyboard demos (written 2026-10-20, before any demo exists)

Written and committed before the keyboard demos are recorded. Nothing here changes after recording; the script also
freezes its own `preregistration.md` with every demo's hash at its `select` stage, before anything is trained.

## Amendment 1: input = mouse (2026-10-20 14:37 EDT, 18:37 UTC, before the first demo)

- **Change:** the demos are the user's **mouse** demos, selected with `--input mouse` instead of `--input keyboard`.
  Wherever "keyboard demos" appears below, read "mouse demos". Nothing else changes: the tag, the stores, `--min-demos
  5`, the arms, the recipe, the seeds, the test, the refusals and the assist reporting.
- **Reason:** the user's choice before recording; no data seen. Mouse goes through the same smoothed `TeleopSession`
  path as keyboard.
- **Check at amendment time:**
  - `C:\dev\pm-t6\data\demos` and `C:\dev\pm-t7\data\demos` held no `human_20261020*` / `human_20261021*` demo.
  - A CPU dry run of `select` with `--input mouse` on scratch stores froze 8 fake mouse demos (input mouse, min 5,
    rules, 10 variants, 30k, 40 seeds from 5020, Fisher, α 0.05, per-demo assist) and left out a camera demo and a
    discarded take. 4 mouse demos were refused (exit 1); `--input keyboard` on the same store matched nothing.
- **Experiment name:** `mouse20261020`, so the folder says what it holds.
- **Exact timeline (added after the commit, for honesty):**
  - The lead requested the amendment at about **14:35 EDT**, before any demo existed.
  - The "no demo" listing above ran at **14:37:05**.
  - The first mouse demo, `human_20261020183738_00ab`, was saved at **14:37:38**.
  - The amendment commit `c7f3710` landed at **14:37:48**, 10 s after that first demo.
  - No demo data was inspected by anyone before or during the amendment. The listing at 14:37:05 found nothing, and
    the timestamp check behind this line read folder names and times only.
  - The amendment changes only the input filter (`--input keyboard` → `--input mouse`).

## Question

Does a policy trained on the user's keyboard demos **perfected and multiplied by SANT** succeed more often than one
trained on **the same demos as recorded**?

## Demos

- **Which:** every saved human demo from tonight's session (live test #11) recorded with the keyboard. The ids are
  frozen with each `demo.json`'s SHA-256 (and each live `steps.npz`'s) at `select`.
  - The selection is `--tag "human_2026102[01]*" --input keyboard`, in `C:\dev\pm-t6\data`.
  - Demo ids carry the **UTC** time (`DemoStore.new_id`), and tonight's session runs past 20:00 EDT (00:00 UTC). The
    tag therefore covers ids from both 2026-10-20 and 2026-10-21 UTC.
  - On 2026-10-20 at 13:30 EDT, no demo with either date existed in that store, so the tag can only match takes from
    today on.
  - `--input keyboard` leaves out mouse and camera takes. Demos without an `input` never match.
- **Discarded takes never count.** Stop & discard saves nothing, and Delete last demo moves the folder to
  `demos/_discarded/`, which the store does not list.
  - Every other saved keyboard take counts, including checklist takes (e.g. the soft-floor-off test).
  - To keep a take out, delete it in /record **before** the run. Nothing is removed by hand afterwards.
- **Assist is reported, not filtered.** Demos recorded with the soft floor on carry `assist: {soft_floor,
  soft_floor_steps}`.
  - The script freezes each demo's record in `config.json` (`assist`).
  - The pre-registration states how many had the floor holding the target up, how many had it on without engaging,
    and how many have no record.
  - Both arms use every selected demo either way.

## Arms

Both arms use the same recipe: ACT, 30,000 steps, batch 8, the same seed, checkpoint every 2,500 steps, with the
30k checkpoint evaluated.

- **raw_N:** every selected demo as recorded, replayed on the path the arm actually reached (`replay_path =
  achieved`, lookahead 0) and start-aligned (a min-jerk move from home put in front). `raw_arm = all`: every demo,
  whether or not physics verified it.
- **perfected_multiply_N:**
  - Each demo is repaired by the **rules** repairer (`--repairer rules`) and verified in Isaac, then start-aligned.
  - Each verified repaired demo also gets **10 variants** in new scenes (seeds 3100 + 100·i + k). Each variant is
    kept only if it verifies.
  - A demo whose repair doesn't verify contributes nothing to this arm.

## Endpoint and test

- **Endpoint:** success as the eval's physics check decides it.
  - The scenes are the unseen seeds **5020–5059**, n = 40 per arm.
  - The eval is serial (`eval_cells.py`). Both cells start from the raw dataset's start state, with a 30 s limit and
    front and wrist cameras.
- **Test:** two-sided Fisher exact, **α = 0.05**, with a Wilson 95% CI per arm.
  - One test: no interim looks, no other endpoints, and n is fixed.
  - `sim_error` / `policy_error` episodes are re-run, never counted as failures.
- **Reported whatever it says:**
  - the counts, rates, CIs and p;
  - every demo's physics verdict (live and replayed);
  - repair outcomes, the multiply yield and the assist records.

## Refusals (decided now: refuse, don't improvise)

- **Fewer than 5 keyboard demos saved:** `--min-demos 5` refuses at `select`. It exits 1 and freezes nothing. No
  run, no lowering of the bar, no adding other inputs.
- **No demo matches:** `select` refuses and exits 1.
- **The multiplied cell is empty** (no repaired demo verifies), **or the raw cell is empty** (no demo
  start-aligns): `grid` refuses with exit 1 after the sim stage. Nothing is trained. The physics and repair verdicts
  are still written and reported.
- **Any of these:** the run stops there. A different design (another repairer, other inputs, a one-arm test) is a
  new pre-registration, not a change to this one.

## Known risk, stated in advance

- Live test #10's webcam demos replayed poorly: 0/10 passed physics on replay, and the achieved path reproduced only
  2–4/10 of the live outcomes. Keyboard demos have smoother targets and the soft floor, but their replay fidelity is
  unmeasured.
- If the raw arm replays mostly as failures, the comparison is raw-as-replayed vs SANT. That is what this
  pre-registration tests, and the physics verdicts are reported next to it.

## Not used

Nemotron (`--no-nemotron`): the labels and judgements never decide anything here, and `C:\dev\pm-t7` has no `.env`.

## Command

The exact command is in [live test #11 → After recording](2026-10-20-live-test-11.md#after-recording).
