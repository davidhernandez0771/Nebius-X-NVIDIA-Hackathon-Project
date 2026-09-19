"""App-level settings: DB path and upload directories, all overridable via env.

Paths are functions, not module-level constants, so tests (and anything else
that patches the environment at runtime) get a fresh value on every call
instead of one baked in at import time.
"""
from __future__ import annotations

import os
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
