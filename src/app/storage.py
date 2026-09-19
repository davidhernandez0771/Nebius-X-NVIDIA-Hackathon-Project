"""Local file storage for uploaded photos/scans.

Dev-only: a git-ignored directory on disk. docs/ARCHITECTURE.md §5/§9 call for
private object storage and EXIF-stripping before any real deployment -- neither
is implemented here yet; this is the local dev path only.
"""
from __future__ import annotations

import uuid

from . import config


def save_photo(data: bytes, *, suffix: str = ".jpg") -> str:
    directory = config.photos_dir()
    directory.mkdir(parents=True, exist_ok=True)
    key = f"{uuid.uuid4().hex}{suffix}"
    (directory / key).write_bytes(data)
    return key


def save_scan(data: bytes, *, suffix: str = ".glb") -> str:
    directory = config.scans_dir()
    directory.mkdir(parents=True, exist_ok=True)
    key = f"{uuid.uuid4().hex}{suffix}"
    (directory / key).write_bytes(data)
    return key


def read_photo(key: str) -> bytes:
    return (config.photos_dir() / key).read_bytes()
