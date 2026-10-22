"""App-level settings: DB path and upload directories, all overridable via env.

Paths are functions, not module-level constants, so tests (and anything else
that patches the environment at runtime) get a fresh value on every call
instead of one baked in at import time.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Single-owner development mode (see docs/ARCHITECTURE.md §5): no auth yet,
# every record belongs to this fixed owner until real auth is added.
DEV_OWNER_ID = "local-owner"


def db_path() -> Path:
    return Path(os.environ.get("APP_DB_PATH") or REPO_ROOT / "app.db")


def upload_dir() -> Path:
    return Path(os.environ.get("APP_UPLOAD_DIR") or REPO_ROOT / "uploads")


def photos_dir() -> Path:
    return upload_dir() / "photos"


def scans_dir() -> Path:
    return upload_dir() / "scans"


_LOCAL_ORIGIN = re.compile(r"http://(localhost|127\.0\.0\.1):\d{2,5}")


def cors_origins() -> list[str]:
    """The browser origins the API answers: the Vite dev server (5173), plus SANT_CORS_ORIGINS (comma-separated) for a
    dev server on another port. Only this machine's http origins are taken; anything else in the variable is ignored."""
    out = ["http://localhost:5173", "http://127.0.0.1:5173"]
    for o in os.environ.get("SANT_CORS_ORIGINS", "").split(","):
        o = o.strip()
        if _LOCAL_ORIGIN.fullmatch(o) and o not in out:
            out.append(o)
    return out


def pipeline_enabled() -> bool:
    """Whether the site may start, cancel or resume pipeline runs (app/routers/pipeline.py): off unless SANT_PIPELINE=1,
    so a public deployment can't start GPU jobs. Reading runs and downloading their artifacts is always allowed."""
    return os.environ.get("SANT_PIPELINE", "").strip().lower() in ("1", "true", "yes", "on")
