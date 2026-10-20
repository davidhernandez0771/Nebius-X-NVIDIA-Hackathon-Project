"""On-disk demo store: one folder per demo under <root>/demos/.

<root>/demos/<id>/demo.json        Demo
<root>/demos/<id>/diagnosis.json   {"source", "model_id", "diagnosis", "gated"}, optional
<root>/demos/<id>/passport.json    Passport, optional
<root>/demos/<id>/review_verdict.json  the Review card's ReviewVerdict (docs/design/nemotron-judge.md), optional
<root>/demos/<id>/episode/         the recorded episode (episode_io format), optional
<root>/demos/<id>/camera.webm      the Record page's webcam video of the take ("Save camera video"), optional
<root>/demos/<id>/camera.json      CameraTiming: how camera.webm lines up with the hand messages, with camera.webm
<root>/demos/_discarded/<id>/      a demo thrown away on the Record page: moved here, never deleted (discard())

Every write goes to a temp file in the same folder, then os.replace, so a reader
never sees a half-written file. Ids are folder names, so only [A-Za-z0-9_-] is
allowed; any other id is "not found" on read and a ValueError on save. "_discarded" is the discard folder,
never a demo id, so the list and every lookup skip what was thrown away.
"""

from __future__ import annotations

import json
import logging
import os
import re
import secrets
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .paths import data_dir
from .schemas import Demo, Diagnosis, Passport

log = logging.getLogger(__name__)

REVIEW_VERDICT = "review_verdict.json"
DISCARDED = "_discarded"
CAMERA_VIDEO = "camera.webm"
CAMERA_TIMING = "camera.json"
WEBM_MAGIC = b"\x1a\x45\xdf\xa3"  # every webm (Matroska/EBML) file starts with these four bytes
VIDEO_ALIGN_TOL_S = 0.001  # video_s must be (t_ms - start_ms) / 1000 to within this

_SAFE_ID = re.compile(r"[A-Za-z0-9_-]+")

DiagnosisSource = Literal["nemotron", "rules", "hybrid", "none"]  # hybrid = rules + Nemotron (app.ai.diagnose)


class StoredDiagnosis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: DiagnosisSource
    model_id: str | None = None
    diagnosis: Diagnosis
    gated: list[str] = Field(default_factory=list)  # what app.ai.diagnose.gate_diagnosis dropped


class CameraTiming(BaseModel):
    """camera.json (web/src/record/cameraTake.ts): hand frame i, the HandPoseMsg with t_ms[i], is at video_s[i] =
    (t_ms[i] - start_ms) / 1000 seconds into camera.webm. Every *_ms is the page's performance.now(), the t_ms clock;
    start_ms is the recorder's start (video time 0), record_start_ms / record_stop_ms when the page sent them."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    version: Literal[1]
    clock: Literal["performance.now"]
    mime: str
    start_ms: float
    stop_ms: float
    record_start_ms: float
    record_stop_ms: float
    frame_w: int | None = None
    frame_h: int | None = None
    t_ms: list[float]
    video_s: list[float]

    @model_validator(mode="after")
    def _lines_up(self) -> "CameraTiming":
        if self.stop_ms < self.start_ms:
            raise ValueError(f"stop_ms {self.stop_ms} is before start_ms {self.start_ms}")
        if len(self.t_ms) != len(self.video_s):
            raise ValueError(f"{len(self.t_ms)} t_ms but {len(self.video_s)} video_s")
        if any(b < a for a, b in zip(self.t_ms, self.t_ms[1:])):
            raise ValueError("t_ms must not go backwards")
        for i, (t, v) in enumerate(zip(self.t_ms, self.video_s)):
            if not self.start_ms <= t <= self.stop_ms:
                raise ValueError(f"t_ms[{i}] = {t} is outside the video ({self.start_ms}..{self.stop_ms})")
            if abs(v - (t - self.start_ms) / 1000) > VIDEO_ALIGN_TOL_S:
                raise ValueError(f"video_s[{i}] = {v} doesn't match t_ms[{i}]: expected {(t - self.start_ms) / 1000:.4f}")
        return self


class VideoTooLarge(ValueError):
    pass


def write_atomic(path: Path, text: str) -> None:
    """Write to a temp file in the same folder, then os.replace: readers never see half a file, and a
    hard-linked file at `path` is replaced, never modified in place."""
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
        if not isinstance(id, str) or not _SAFE_ID.fullmatch(id) or id == DISCARDED:
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
        write_atomic(path, demo.model_dump_json(indent=2))
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

    def discard(self, id: str) -> Path:
        """Move the demo's whole folder to <root>/demos/_discarded/<id> (a suffix if that is taken; nothing is
        overwritten or deleted) and return where it went. KeyError if there is no such demo."""
        src = self._existing_dir(id)
        bin_ = self.root / "demos" / DISCARDED
        bin_.mkdir(parents=True, exist_ok=True)
        dst, n = bin_ / id, 1
        while dst.exists():
            n += 1
            dst = bin_ / f"{id}_{n}"
        shutil.move(src, dst)
        return dst

    # --- camera video ---------------------------------------------------------------

    def save_camera(self, id: str, video: BinaryIO, timing: CameraTiming, max_bytes: int) -> int:
        """Write the take's webcam video (camera.webm) and its timing (camera.json), replacing any earlier pair, and
        return the video's size. KeyError if there is no such demo; ValueError if it isn't webm or is empty;
        VideoTooLarge past max_bytes. The video is copied to a temp file first, so a failed upload leaves nothing."""
        d = self._existing_dir(id)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=f".{CAMERA_VIDEO}.", suffix=".tmp")
        size = 0
        try:
            with os.fdopen(fd, "wb") as f:
                head = video.read(len(WEBM_MAGIC))
                if head != WEBM_MAGIC:
                    raise ValueError("the video is empty" if not head else "the video isn't a webm file")
                f.write(head)
                size = len(head)
                while chunk := video.read(1 << 20):
                    size += len(chunk)
                    if size > max_bytes:
                        raise VideoTooLarge(f"the video is over {max_bytes} bytes")
                    f.write(chunk)
            os.replace(tmp, d / CAMERA_VIDEO)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        write_atomic(d / CAMERA_TIMING, timing.model_dump_json(indent=1))
        return size

    # --- diagnoses -----------------------------------------------------------------

    def save_diagnosis(self, id: str, diag: Diagnosis, source: str, model_id: str | None,
                       gated: list[str] = ()) -> Path:
        path = self._existing_dir(id) / "diagnosis.json"
        stored = StoredDiagnosis(source=source, model_id=model_id, diagnosis=diag, gated=list(gated))
        write_atomic(path, stored.model_dump_json(indent=2))
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
        write_atomic(path, passport.model_dump_json(indent=2))
        return path

    def get_passport(self, id: str) -> Passport | None:
        path = self._existing_dir(id) / "passport.json"
        if not path.is_file():
            return None
        return Passport.model_validate_json(path.read_text(encoding="utf-8"))

    # --- the Review card's Nemotron verdict --------------------------------------------

    def save_review_verdict(self, id: str, verdict: dict) -> Path:
        path = self._existing_dir(id) / REVIEW_VERDICT
        write_atomic(path, json.dumps(verdict, indent=2))
        return path

    def get_review_verdict(self, id: str) -> dict | None:
        """None if there is none yet; ValueError if the file isn't a JSON object. The shape is checked by the reader."""
        path = self._existing_dir(id) / REVIEW_VERDICT
        if not path.is_file():
            return None
        verdict = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(verdict, dict):
            raise ValueError(f"{REVIEW_VERDICT} must be a JSON object, got {type(verdict).__name__}")
        return verdict

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
