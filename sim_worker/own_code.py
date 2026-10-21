"""This checkout's code first, in every process.

The Isaac venv and the LeRobot venv each have an editable install of the project (pip install -e, 2026-10-15) whose
.pth points at one fixed worktree's src: C:\\dev\\pm-t2\\src and C:\\dev\\pm-t3\\src. A process started from any other
worktree therefore imports that worktree's demo_pipeline, silently, unless its own src comes first on sys.path.

Every entry point (sim_worker.server, sim_worker/scripts, sim_eval/scripts, the LeRobot entry modules) calls
put_own_code_first() before importing project code, and check_own_code() at the start of main(), which logs where
demo_pipeline came from and stops if it isn't this checkout. Stdlib only: it runs before any of our code is
importable.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Callable

REPO = Path(__file__).resolve().parents[1]


def put_own_code_first(repo: Path = REPO) -> None:
    """This checkout's src, then its root, at the front of sys.path (moved there if they are already on it)."""
    first = [str(repo / "src"), str(repo)]
    sys.path[:] = first + [p for p in sys.path if p not in first]


def _stderr(line: str) -> None:
    print(line, file=sys.stderr, flush=True)  # stderr: some entry points print JSON on stdout


def check_own_code(repo: Path = REPO, *, log: Callable[[str], None] = _stderr) -> Path:
    """Log where demo_pipeline was imported from (stderr); raise ImportError if it isn't this checkout's src."""
    import demo_pipeline

    got = Path(demo_pipeline.__file__).resolve().parent
    want = (repo / "src" / "demo_pipeline").resolve()
    log(f"[imports] demo_pipeline from {got}")
    if os.path.normcase(str(got)) != os.path.normcase(str(want)):
        raise ImportError(f"demo_pipeline came from {got}, not this checkout's {want}: an editable install in this venv "
                          f"points at another worktree. Call sim_worker.own_code.put_own_code_first() (or put "
                          f"{repo / 'src'} first on PYTHONPATH) before importing project code.")
    return got
