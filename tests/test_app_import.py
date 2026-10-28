"""The backend imports the way `uv run uvicorn app.main:app --app-dir src` imports it.

uvicorn puts only --app-dir (src) on sys.path, not the repo root, so the root's sim_worker package
(src/app/routers/robots.py imports it) must be found without PYTHONPATH and without pytest's pythonpath.
Live test #10 crashed here with ModuleNotFoundError: No module named 'sim_worker'.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# What uvicorn does for `app.main:app --app-dir src` (uvicorn/main.py, then uvicorn/importer.py).
UVICORN_IMPORT = """
import sys
sys.path.insert(0, sys.argv[1])
assert sys.argv[2] not in sys.path, "the repo root must not be on the path yet"
from uvicorn.importer import import_from_string
app = import_from_string("app.main:app")
import sim_worker
print(type(app).__name__)
print(sim_worker.__file__)
"""


def test_app_main_imports_with_only_src_on_the_path(tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env["DATA_DIR"] = str(tmp_path / "data")
    # -I: no PYTHONPATH, no user site, and neither the cwd nor the script's directory on sys.path.
    out = subprocess.run(
        [sys.executable, "-I", "-c", UVICORN_IMPORT, str(REPO / "src"), str(REPO)],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr
    kind, sim_worker_file = out.stdout.split()
    assert kind == "FastAPI"
    # this checkout's sim_worker, the one routers/robots.py runs robot_report.py from
    assert Path(sim_worker_file).resolve() == REPO / "sim_worker" / "__init__.py"
