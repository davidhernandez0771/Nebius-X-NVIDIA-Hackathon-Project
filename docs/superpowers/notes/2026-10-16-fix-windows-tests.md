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
