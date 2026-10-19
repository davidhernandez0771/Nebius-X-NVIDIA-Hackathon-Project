# Merge plan, 2026-10-18 (trial on `pm/merge-trial`)

`pm/merge-trial` is a LOCAL scratch branch cut from `origin/perfect-then-multiply` (`e94d817`, PR #37). Every
branch below was trial-merged into it in PR order with `git merge --no-ff`, and the three checks ran after each
merge. Nothing was pushed, merged on GitHub or rebased. No GPU was used. The PC crashed partway through, during
the checks of the second `pm/web-record` merge (`3019edc`); this note was written after recovering, and those
checks were re-run.

**How to use it:** open the PRs into `perfect-then-multiply` in the order below, as merge commits (not squash),
like the earlier PRs. GitHub then sees the same conflicts as the trial, in the same order. Every conflict is a
plain content conflict, so GitHub's web editor can resolve it. The exact resolved file is in the trial branch:
`git show <trial merge commit>:<file>`.

## PR order

| # | Branch (head) | One-line summary | Conflicts on merge | Trial merge |
|---|---|---|---|---|
| 1 | `pm/byor-backend` (`73ddebd`) | Bring your robot, backend: URDF import + kinematics, robot store, `/robots` API (upload, parts, roles, evaluate, report), the Isaac report-card run (Franka 30/30, OpenArm 0/30) and an end-to-end test | none | `ea4be5f` |
| 2 | `pm/nemotron-judge` (`47cc4cd`) | Nemotron VL labeler and judge, with the pre-registered test (labeler 40/40 vs code 39/40, judge 59/60 vs code 60/60, no detectable difference) and the `review_verdict` composer | none | `99f2887` |
| 3 | `pm/human-demo-exp` (`5d02b18`) | One-command human-demo experiment (select → sim → repair → multiply → train → eval → stats → results JSON), T4's GPU lock `sim_worker/gpu_lock.py`, the Isaac gate | none (its copy of #2's intent files is byte-identical) | `998681a` |
| 4 | `pm/grasp-fix` (`e00893e`) | Per-step rollout traces, the centered-approach Neaten (20/40 vs 17/40, p = 0.65), recovery copies, T3's GPU lock `sim_worker/gpulock.py`, the run 2 overnight pipeline (not run) | `sim_worker/replay.py` (A) | `1079d54` |
| 5 | `pm/remove-room-organizer` (`e789382`) | Archive the old site under `/legacy` (old frontend in `web/src/legacy`, `/pm/*` → `/legacy/pm/*`, hand controls only on `/legacy`), `/` → `/site`; includes `pm/web-landing` | none | `9183f3d` |
| 6 | `pm/web-record` (`eb8a78b`) | The new `/record`, rebuilt as the approved hologram design; live Record code in `web/src/record`; `/pm/record` opens it. Includes `pm/web-record-hud`, `pm/hand-v4`, `pm/teleop-latency`, `pm/live-7` | none | `b41129c`, then `3019edc` for its 3 newer commits |
| 7 | `pm/latency-2` (`0b20f35`) | Teleop save writes camera PNGs on a thread pool (0.99 → 0.2 s after Stop, same bytes) | none | `e237f8a` |
| 8 | `pm/review-wiring` (`11f3f48`) | Review page `/review2` (includes `pm/web-review`) wired to real data via `GET /demos/{id}/review` | `src/app/main.py` (B), `web/src/App.tsx` (C) | `5abe6e3` |
| 9 | `pm/web-results` (`de9ca70`) | Results page at `/site/results` (cited facts, Wilson CIs, scene-by-scene replay) | `web/src/App.tsx` (C) | `892aa29` |
| 10 | `pm/web-robots` (`e803a66`) | The `/robots` shelf in react-three-fiber, with a perf pass for a shared GPU | `web/src/App.tsx` (C) | `8edcbac` |
| 11 | `pm/web-setup` (`c315b93`) | Robot setup page `/robots/setup` (upload, part tree, roles, 3D preview with urdf-loader, report card) on #1's backend | `web/src/App.tsx` (C) | `2826a82` |
| 12 | `pm/world-core` (`de8e24e`) | The `/world` journey: one persistent r3f canvas, scroll camera rail, station API; the Blender workshop (baked room, layout, camera stops, cartridge library) and quality tiers | `web/src/App.tsx` (D) | `7b7462b` (`360ae1c`), then `db44464` |
| 13 | `pm/hand-lock` (`d813919`) | Record locks onto one hand (0.3 s still, same label + nearest, 0.7 s hold, glitch filter); `HandLockChip` ready for T6 to place | `web/src/record/useRecordSession.ts` (E) | `e2386ff` |
| 14 | `pm/robot-twin` (`38163af`) | Robot twin: the sink streams joints, gripper and cube; `/twin/episodes` replays a saved episode; `RobotTwin` draws the Franka from its URDF (not mounted on `/record` yet) | `src/app/main.py` (B), `sim_worker/teleop_session.py` (F), `THIRD_PARTY_NOTICES.md` (G) | `18c1633` (`9b8bf63`), then `78eaa68` |
| — | `pm/live-view` (`1fb6be3`) | **HOLD, not in the trial.** Live view (studio look, quality options, ladder bench, WebRTC stream flag, Isaac view on `/record?stream=1`) plus the showcase replay | two non-trivial conflicts, see below | probe only |

Three branches (6, 12, 14) gained commits after their first trial merge, so each was merged a second time.

## Already contained in others: no PR

| Branch | Contained in | Note |
|---|---|---|
| `pm/web-landing` | `pm/remove-room-organizer` (#5), and everything after it | The archive was cut from it |
| `pm/web-record-hud` | `pm/web-record` (#6) | |
| `pm/web-review` | `pm/review-wiring` (#8) | |
| `pm/teleop-latency`, `pm/hand-v4`, `pm/live-7` | `pm/web-record` (#6) and `pm/latency-2` (#7) | |
| `pm/live-9` | `pm/live-view` | |
| `pm/showcase` | `pm/live-view` | Cherry-picked there (`c813227`, `d744e62`, `a179f95`); the first pick was adapted to live-9's teleop driver |
| `pm/live-8`, `pm/art-v3`, `pm/site-preview`, `-2`, `-3` | the trial (every patch) | `git cherry`: no patch missing; only their own merge commits differ. Preview branches, not PRs |

`pm/remove-room-organizer` is also contained in `pm/web-record`. It gets its own PR (#5) anyway, so the
archive can be reviewed on its own; after it merges, the #6 PR shows only Record's commits.

## Not in this plan

- **`pm/docs-headline`** (3 commits: README rewrite for the new pitch, Devpost description and video script
  with the real results, personal paths). It was not on the list, so it was not trial-merged. Dry run
  (`git merge-tree`) against the trial: one conflict, `sim_eval/tests/test_sim_eval_driver.py`, where it and #4
  each append one test at the end of the file. Keep both. It could be PR 15.
- **`pm/cleanup-audit`** (1 commit, the audit note). Dry run: no conflict.
- **Old sprint 8 branches** `pm/t2-sim`, `pm/t4-diagnoser`, `pm/t6-runbook`, `pm/t7-audit`, `pm/t7-hand-art`
  still have commits that are not in the trial. They predate PRs #33–#38 and were not checked.

## Conflicts and how they were solved

Only trivial conflicts were resolved: both sides added something independent, and both were kept.

- **A. `sim_worker/replay.py` (#4).** #1 added `robot: str | None = None` to `replay()`, #4 added
  `start_joint_pos=None`. The result keeps both parameters, both docstring sentences, and
  `_session(record_cameras, robot or scene.robot)` + `_place_scene(s, scene, start_joint_pos)`.
- **B. `src/app/main.py` (#8, #14).** Each branch adds one router to the same import line and one
  `include_router` line. The result is `... results, review, robots, rooms, scans, teleop, twin` and
  `include_router` for `review`, `robots` and `twin`. Paths don't clash (`/demos/{id}/review`, `/robots/...`,
  `/twin/...`). The backend's `/robots` doesn't clash with the web page `/robots` either: there is no Vite
  proxy; the client calls the API base URL.
- **C. `web/src/App.tsx` (#8 to #11).** Each page branch adds one `lazy(...)` import and one `<Route>` next to
  the previous branch's. Both hunks keep both sides, in merge order.
- **D. `web/src/App.tsx` (#12).** The lazy import hunk keeps both (`World` after `RobotsPage`). In the second
  hunk, world-core hid the hand controls on `/world` (`onSite = siteModeOf(path) !== null || /^\/world/`). The
  archive (#5) had already replaced that logic: the hand controls show only on `/legacy/...`, so `/world` is
  covered. Kept the archive's `onLegacy` and dropped world-core's line. The `/world` route itself auto-merged.
- **E. `web/src/record/useRecordSession.ts` (#13), 4 hunks.** #6 added an fps readout, #13 the hand lock.
  Resolved as `docs/superpowers/notes/2026-10-18-hand-lock.md` ("Merging with T6") says: `PoseUi` keeps both
  `fps?` and `lock?`; `drawStage(..., lock)` plus `framesSinceUi++`; the `lockChanged` lines plus the
  `elapsed`/`fps` lines inside `if (uiTick || reset.event || lockChanged)`; `setPose({ ..., landmarks, fps, lock })`.
- **F. `sim_worker/teleop_session.py` (#14).** Constants: #7's `PNG_WRITERS = 8` and #14's `TWIN_HZ`,
  `TWIN_DECIMALS`. Kept all three.
- **G. `THIRD_PARTY_NOTICES.md` (#14).** Both #11 and #14 rewrote the urdf-loader row. Took #14's, which names
  both users (the robot twin and `/robots/setup`). The two `franka_description` rows (the BYOR test fixture
  and the twin's `web/public/robots/`) are separate copies and both stay.

## `pm/live-view`: on hold

Merging it into the trial gives six conflicts. Two are trivial:

- `sim_worker/replay.py`: live-view adds `on_step: Callable[[int], None] | None = None` → keep `robot`,
  `start_joint_pos` and `on_step`, with all three docstring sentences.
- `sim_worker/teleop_session.py` imports: `from .robots import ROBOTS` and `from .showcase import refuse_in_live_teleop`
  → keep both.

Two need an owner's decision, so the merge was aborted and is **not** on `pm/merge-trial`:

1. **GPU lock, add/add in `sim_worker/gpu_lock.py` and `tests/test_sim_gpu_lock.py`.** The showcase added its
   own `GpuLock(path, owner, task)` under the same filename as #3's `GpuLock(path=LOCK_PATH, task="gpu", *, owner=...)`.
   live-view's callers (`sim_worker/scripts/showcase_replay.py`, `sim_worker/scripts/live_look_bench.py`) pass
   `(path, owner, task)` positionally; with #3's class that would put the owner into `task`. Suggested fix on
   `pm/live-view` (T2): drop its `gpu_lock.py` and test, and call #3's class with keywords
   (`GpuLock(path, task=..., owner=...)`). All three implementations (#3, #4's `gpulock.py`, live-view's) write
   the same `<owner> <PID> <task> <time>` line to `C:\dev\gpu.lock` and wait on a live PID, so they already
   interlock. Folding them into one module is a later cleanup.
2. **`/record`: content conflict in `web/src/site/record/RecordConsole.tsx` and modify/delete in
   `record-console.css`.** live-view mounts `IsaacView` in the old Volt `RecordConsole` and styles it in
   `record-console.css`. #6 replaced that page with the hologram design and deleted the CSS file. `IsaacView`
   (with its `?stream=1` gate) has to be placed in the hologram `/record`, by T2 or T6. GitHub's web editor
   can't resolve a modify/delete conflict, so this has to be done on the branch.

**Probe** (detached `fc30b53`, not on any branch): the two trivial fixes above, plus HEAD's side for the GPU lock
and `RecordConsole.tsx`, and the CSS file deleted. Results: web **1076 passed, 1 failed** (109 files; the failure
is live-view's own `/record > shows the Isaac view only when the page asks for the stream`, expected because
the mount was left out), build OK, pytest **1864 passed, 0 failed, 22 skipped**. Apart from those two decisions,
live-view merges cleanly.

## Test results

Run after each merge: `npm --prefix web test`, `npm --prefix web run build` (`tsc -b && vite build`),
`uv run pytest -q`. Before #11's checks, `npm --prefix web install` installed the lockfile-pinned
`urdf-loader` 0.13.1 into `web/node_modules`; no tracked file changed.

| After | Trial commit | Web tests (files) | Build | pytest |
|---|---|---|---|---|
| #1 byor-backend | `ea4be5f` | 455 passed (36) | OK | 1593 passed, 18 skipped |
| #2 nemotron-judge | `99f2887` | 455 passed (36) | OK | 1615 passed, 18 skipped |
| #3 human-demo-exp | `998681a` | 455 passed (36) | OK | 1653 passed, 18 skipped |
| #4 grasp-fix | `1079d54` | 455 passed (36) | OK | 1717 passed, 18 skipped |
| #5 archive | `9183f3d` | 513 passed (41) | OK | 1717 passed, 18 skipped |
| #6 web-record | `b41129c` | 738 passed (60) | OK | 1761 passed, 18 skipped |
| #7 latency-2 | `e237f8a` | 738 passed (60) | OK | 1761 passed, 20 skipped |
| #8 review-wiring | `5abe6e3` | 775 passed (64) | OK | 1784 passed, 20 skipped |
| #9 web-results | `892aa29` | 799 passed | OK | 1784 passed, 20 skipped |
| #10 web-robots | `8edcbac` | 865 passed (76) | OK | 1784 passed, 20 skipped |
| #11 web-setup | `2826a82` | 951 passed (90) | OK | 1784 passed, 20 skipped |
| #12 world-core | `7b7462b` | 990 passed (96) | OK | 1784 passed, 20 skipped |
| #6 web-record, 2nd | `3019edc` | 1002 passed (97) | OK | 1784 passed, 20 skipped |
| #13 hand-lock | `e2386ff` | 1031 passed (100) | OK | 1784 passed, 20 skipped |
| #14 robot-twin | `18c1633` | 1062 passed (105) | OK | 1802 passed, 20 skipped |
| #14 robot-twin, 2nd | `78eaa68` | 1062 passed (105) | OK | 1802 passed, 20 skipped |
| #12 world-core, 2nd | `db44464` | 1089 passed (111) | OK | 1st run: 1 failed, 1801 passed; 2 reruns: 1802 passed, 0 failed (see below) |
| live-view probe | `fc30b53` | 1076 passed, 1 failed (109) | OK | 1864 passed, 22 skipped |

Every trial merge: 0 failed, except one flaky pytest failure at `db44464`. That merge changed only `web/`; the two full reruns on the same commit passed with 1802, 0 failed. The first run printed only the count, so the test is not known; the known ~4% localhost connection resets (WinError 10054) are a likely cause. Skips: the 18 need lerobot, torch, Isaac or a GPU, or are opt-in. #7 adds 2 that
need PIL (`test_sim_teleop_session.py`, camera-frame saves; PIL is not in the uv env). The probe adds 2
Isaac-only USD tests (`test_sim_live_look_usd.py`, `test_sim_showcase_usd.py`).

## Still moving

When this was written, `pm/world-core` (`C:\dev\pm-fix`) was still committing (5 commits between 20:08 and 20:27, merged as `db44464`). It then committed step 6, `c9da5dc` (20:35, the plug-in sequence), which is NOT in the
trial; a dry run (`git merge-tree`) shows no conflict. If it,
or any branch above, gains commits before its PR is opened, re-run its trial merge.
