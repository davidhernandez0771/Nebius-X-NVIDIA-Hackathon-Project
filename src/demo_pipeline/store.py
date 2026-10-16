"""On-disk demo store: one folder per demo under <root>/demos/.

<root>/demos/<id>/demo.json        Demo
<root>/demos/<id>/diagnosis.json   {"source", "model_id", "diagnosis", "gated"}, optional
<root>/demos/<id>/passport.json    Passport, optional
<root>/demos/<id>/episode/         the recorded episode (episode_io format), optional

Every write goes to a temp file in the same folder, then os.replace, so a reader
never sees a half-written file. Ids are folder names, so only [A-Za-z0-9_-] is
allowed; any other id is "not found" on read and a ValueError on save.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .paths import data_dir
from .schemas import Demo, Diagnosis, Passport

log = logging.getLogger(__name__)

_SAFE_ID = re.compile(r"[A-Za-z0-9_-]+")

DiagnosisSource = Literal["nemotron", "rules", "none"]


class StoredDiagnosis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: DiagnosisSource
    model_id: str | None = None
    diagnosis: Diagnosis
    gated: list[str] = Field(default_factory=list)  # what app.ai.diagnose.gate_diagnosis dropped


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class DemoStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root) if root is not None else data_dir()

    # --- paths ---------------------------------------------------------------------

    def _dir(self, id: str) -> Path:
        """The demo's folder; KeyError for an id that could not be a folder name."""
        if not isinstance(id, str) or not _SAFE_ID.fullmatch(id):
            raise KeyError(id)
        return self.root / "demos" / id

    def _existing_dir(self, id: str) -> Path:
        d = self._dir(id)
        if not (d / "demo.json").is_file():
            raise KeyError(id)
        return d

    def episode_dir(self, id: str) -> Path:
        return self._dir(id) / "episode"

    # --- ids -----------------------------------------------------------------------

    @staticmethod
    def new_id(prefix: str) -> str:
        """<prefix>_<yyyymmddHHMMSS UTC>_<4 hex>."""
        return f"{prefix}_{datetime.now(timezone.utc):%Y%m%d%H%M%S}_{secrets.token_hex(2)}"

    # --- demos ---------------------------------------------------------------------

    def has_demo(self, id: str) -> bool:
        try:
            self._existing_dir(id)
        except KeyError:
            return False
        return True

    def save_demo(self, demo: Demo) -> Path:
        try:
            d = self._dir(demo.id)
        except KeyError:
            raise ValueError(f"demo id {demo.id!r} may only contain letters, digits, '_' and '-'") from None
        path = d / "demo.json"
        _write_atomic(path, demo.model_dump_json(indent=2))
        return path

    def get_demo(self, id: str) -> Demo:
        """KeyError if missing; ValueError (pydantic ValidationError) if demo.json is corrupt."""
        path = self._existing_dir(id) / "demo.json"
        return Demo.model_validate_json(path.read_text(encoding="utf-8"))

    def list_demos(self, source: str | None = None) -> list[Demo]:
        """Newest first (created_at, then id). Folders without a readable demo.json are skipped."""
        demos_root = self.root / "demos"
        if not demos_root.is_dir():
            return []
        demos = []
        for d in demos_root.iterdir():
            if not (d / "demo.json").is_file():
                continue
            try:
                demo = self.get_demo(d.name)
            except (KeyError, ValueError, OSError) as e:
                log.warning("skipping unreadable demo %s: %s", d.name, e)
                continue
            if source is None or demo.source == source:
                demos.append(demo)
        demos.sort(key=lambda demo: (demo.created_at, demo.id), reverse=True)
        return demos

    # --- diagnoses -----------------------------------------------------------------

    def save_diagnosis(self, id: str, diag: Diagnosis, source: str, model_id: str | None,
                       gated: list[str] = ()) -> Path:
        path = self._existing_dir(id) / "diagnosis.json"
        stored = StoredDiagnosis(source=source, model_id=model_id, diagnosis=diag, gated=list(gated))
        _write_atomic(path, stored.model_dump_json(indent=2))
        return path

    def get_stored_diagnosis(self, id: str) -> StoredDiagnosis | None:
        """None if not diagnosed yet; ValueError if diagnosis.json is corrupt. A file without `gated` reads as []."""
        path = self._existing_dir(id) / "diagnosis.json"
        if not path.is_file():
            return None
        return StoredDiagnosis.model_validate_json(path.read_text(encoding="utf-8"))

    def get_diagnosis(self, id: str) -> tuple[Diagnosis, str, str | None] | None:
        stored = self.get_stored_diagnosis(id)
        return None if stored is None else (stored.diagnosis, stored.source, stored.model_id)

    # --- passports -----------------------------------------------------------------

    def save_passport(self, id: str, passport: Passport) -> Path:
        path = self._existing_dir(id) / "passport.json"
        _write_atomic(path, passport.model_dump_json(indent=2))
        return path

    def get_passport(self, id: str) -> Passport | None:
        path = self._existing_dir(id) / "passport.json"
        if not path.is_file():
            return None
        return Passport.model_validate_json(path.read_text(encoding="utf-8"))

    # --- lineage -------------------------------------------------------------------

    def lineage(self, id: str) -> list[str]:
        """Ids from the human root to this demo (root first, `id` last), as Passport.lineage expects.

        KeyError if this demo or any ancestor is missing; ValueError on a parent_id cycle.
        """
        chain: list[str] = []
        current: str | None = id
        while current is not None:
            if current in chain:
                raise ValueError(f"parent_id cycle: {' -> '.join([*chain, current])}")
            chain.append(current)
            current = self.get_demo(current).parent_id
        return chain[::-1]
