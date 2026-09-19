"""SQLite engine/session.

No migration tool yet (see docs/ARCHITECTURE.md §5) -- models.py is the single
source of truth; init_db() creates whatever tables don't exist. Add Alembic
when schema changes need to preserve existing data across a deploy, not before.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from . import config

_engine = None
_session_factory = None


def _get_session_factory():
    global _engine, _session_factory
    path = config.db_path()
    if _engine is None or _engine.url.database != str(path):
        if _engine is not None:
            _engine.dispose()
        _engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        _session_factory = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _session_factory


def init_db() -> None:
    from . import models  # noqa: F401  (registers tables on Base.metadata)

    _get_session_factory()
    models.Base.metadata.create_all(_engine)


def get_db() -> Iterator[Session]:
    session_factory = _get_session_factory()
    db = session_factory()
    try:
        yield db
    finally:
        db.close()
