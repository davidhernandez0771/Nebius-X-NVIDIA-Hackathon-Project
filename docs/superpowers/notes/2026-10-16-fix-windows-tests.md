# Fix Windows-only test failures (2026-10-16)

Branch: `pm/fix-windows-tests`. Env: `UV_PROJECT_ENVIRONMENT=C:\venvs\pm-fix`, `uv sync --all-extras`.

## Before / after

| | failed | passed | skipped |
|---|---|---|---|
| Before (`uv run pytest -q`) | 54 | 284 | 1 |
| After, run 1 | 0 | 338 | 1 |
| After, run 2 | 0 | 338 | 1 |

## Root cause 1 — SQLite file held open at temp-dir cleanup (53 tests)

`tests/test_app_api.py` (18), `tests/test_chat_actions.py` (26), `tests/test_scan_retrieval.py` (9)
failed in `tearDown` with `PermissionError [WinError 32]` on `...\tmpXXXX\test.db`.

Confirmed with a probe script: after one request through `TestClient`, `app.db._engine` is a
`QueuePool` holding 1 idle connection. Deleting `test.db` then raises WinError 32; immediately
after `_engine.dispose()` the delete succeeds. The module-global engine is only disposed lazily
when the *next* test calls `_get_session_factory()` with a new path — after the previous test's
`TemporaryDirectory.cleanup()` has already failed. POSIX allows unlinking open files, so this
only shows on Windows.

Fix (tests only, no app change):
- `tests/conftest.py`: new `close_db()` helper that disposes `app.db._engine`.
- The three unittest-style `tearDown`s call `close_db()` before `self._tmpdir.cleanup()`
  (`test_chat_actions` already closes its own session first, which dispose requires).

Choice recorded: an autouse pytest fixture in conftest would *not* work — pytest tears down
fixtures after a unittest `tearDown`, which is too late. `src/app/db.py` was left untouched; the
app's engine lifecycle is fine for a running server.

## Root cause 2 — `~` expands via USERPROFILE on Windows (1 test)

`tests/test_usage.py::test_tilde_in_log_path_is_expanded_to_home` patched only `HOME`.
Confirmed: with only `HOME` set, `os.path.expanduser("~")` still returns `C:\Users\dhrce`;
setting `USERPROFILE` redirects it. Fix: patch both `HOME` and `USERPROFILE`.

Side effect found: before the fix this test wrote to the **real** `C:\Users\dhrce\shared.jsonl`
on every Windows run. That file has 37 lines of test entries (`{"tier": "nano", "est_cost_usd": 0.5}`,
dated 2026-09-23 to 2026-10-16). Verified it stayed at 37 lines across both post-fix runs.
I did **not** delete it (outside allowed scope) — safe to remove by hand.

## Other notes

- The `python` on PATH in Git Bash is a broken uv trampoline (points at the OneDrive `.venv`);
  use `uv run python` with `UV_PROJECT_ENVIRONMENT` set, and unset `VIRTUAL_ENV` to silence uv's
  mismatch warning.

---

# Follow-up task (2026-10-16): submission document drafts

Branch `pm/fix-windows-tests`, starting at `851e919`. Only `README.md` and `docs/submission/**`
were changed, plus this note.

## Written (one commit each)

| Document | Commit |
|---|---|
| `README.md`: rewritten for perfect-then-multiply | `f67ddfa` |
| `docs/submission/description.md`: Devpost description | `0cb220d` |
| `docs/submission/feedback.md`: tool feedback | `b985aa3` |
| `docs/submission/video_script.md`: 3-minute script | `e90e7ef`, fix `b21805b` |

## Verification

- **Test output cited by the README and the description** (fresh run at `851e919`,
  `uv run pytest -q` in `C:\venvs\pm-fix`): **407 passed, 1 skipped, 0 failed**, exit 0.
- **Backend command checked:** `uv run uvicorn app.main:app --app-dir src` (port 8011, temp
  `APP_DB_PATH`/`DATA_DIR`) answered `GET /api/health` → `{"status":"ok"}`, `GET /teleop/status`
  → all false / 0, and `GET /demos` → `[]`. The server was then stopped.
- **Number audit:** every number in the four docs (outside HTML comments) was grepped against the
  notes, the spec, the plans and the test output above. The only ones not found are a GitHub
  username fragment and port 8000 (from the old README), git hash `8072315` (from `git log`), and
  Isaac Sim `6.2.0.0` (from the task brief, annotated as such). The audit caught one rounded
  number ("about 21 steps/s" → 20.7) and one arithmetic slip in the video script; both are fixed.

## Decisions

- **Spec numbers are cited to the spec.** The vendor cost estimates, MimicGen's 38–74%, ISR's
  +25% and the experiment design appear only in the spec, not in a note.
- **Isaac Sim / Isaac Lab install commands are not given.** No note or plan records them. The
  README states the versions that work (pip 6.2.0.0, Python 3.12, Isaac Lab `release/3.0.0`; the
  first and last come from the task brief) and marks the install steps as unverified. It points
  to NVIDIA's official pip guide without a URL, so no link is invented.
- **Commands marked unverified:** `--viz kit` on `smoke_replay.py` (it was only run headless) and
  `scripts/smoke_test.py` (carried over from the old README, not re-run). `npm --prefix web ci/test`
  come from T4's note, where vitest gave 80 passed; they were not re-run here, since that would
  install node_modules.
- **Placeholders kept in commands:** `C:\venvs\pm-<name>` and `<path-to-this-repo>`. The
  plans' worktree paths (`C:\dev\pm-t2`, `C:\dev\pm-t3`) were generalized.
- **Status is stated honestly.** A "Pipeline status" table lists what is not built: the
  sim-side webcam teleop, multiply in sim, OpenArm, the eval harness, and the
  Record/Review/Dataset/Results pages. The chart, the ablation and the yield are PENDING.
- **"Would we build with it again"** answers in `feedback.md` are marked *Draft* for the team to
  confirm, since they are opinions, not measurements.
- **The submission-period dates** in `description.md` come from git history (repo started
  2026-09-13 as SANT; spec `8072315` on 2026-10-15). A comment says to check them against the
  official dates.

## For the human

- `LICENSE` still reads `Copyright (c) 2026 [copyright holder]`. Fill it in before submitting.
  It was outside this task's allowed files.
- The video's 2:10–2:35 chart slot, and the README/description Results sections, need the
  measured experiment results.
