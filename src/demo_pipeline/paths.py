"""Where pipeline data lives on disk (git-ignored)."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    """DATA_DIR env var if set, else <repo>/data. Holds raw/, repaired/, variants/, datasets/, runs/."""
    override = os.environ.get("DATA_DIR")
    return Path(override) if override else REPO_ROOT / "data"
