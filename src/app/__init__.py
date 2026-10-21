"""FastAPI backend for the room assistant. See docs/ARCHITECTURE.md."""
import os
import sys
from pathlib import Path

# routers/robots.py imports the repo's top-level sim_worker package, which isn't installed with the app (most of
# it needs Isaac). `uvicorn app.main:app --app-dir src` puts only src/ on the path, so put this checkout's root
# there too: the backend then imports the same sim_worker that robots.py runs robot_report.py from.
_ROOT = str(Path(__file__).resolve().parents[2])
if os.path.normcase(_ROOT) not in {os.path.normcase(os.path.abspath(p)) for p in sys.path if p}:
    sys.path.append(_ROOT)
