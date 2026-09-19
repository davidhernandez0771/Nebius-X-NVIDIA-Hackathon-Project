"""Shared test setup.

Two guarantees for every test in this directory:
  * The real Nebius client can never be built, so an un-mocked AI call fails
    loudly instead of spending money.
  * Usage logging goes to a temp file, so tests never write to the real
    usage_log.jsonl that tracks spend.

Also provides the `api` fixture (a TestClient on a throwaway SQLite DB) and
small helpers for seeding data and faking Nemotron replies.
"""
from __future__ import annotations

import json
from types import SimpleNamespace as NS
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import nebius_llm.client as client_module
from app import models
from app.db import _get_session_factory, init_db
from app.main import app


@pytest.fixture(autouse=True)
def _no_network_no_real_usage_log(monkeypatch, tmp_path):
    def _blocked(*args, **kwargs):
        raise AssertionError("A test tried to build the real Nebius client. Mock the AI call.")

    monkeypatch.setattr(client_module, "_client", None)
    monkeypatch.setattr(client_module.openai, "OpenAI", _blocked)
    monkeypatch.setenv("USAGE_LOG_PATH", str(tmp_path / "usage_log.jsonl"))


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("APP_UPLOAD_DIR", str(tmp_path / "uploads"))
    init_db()
    return TestClient(app)


def db_session():
    return _get_session_factory()()


def make_room(api: TestClient, name: str = "Bedroom") -> int:
    return api.post("/api/rooms", json={"name": name}).json()["id"]


def make_location(api: TestClient, room_id: int, name: str = "Desk") -> int:
    return api.post(f"/api/rooms/{room_id}/locations", json={"name": name}).json()["id"]


def make_item(room_id: int, location_id: int, name: str, *, status: str = "active") -> int:
    """Insert an Item directly. Real items only come from a confirmed review;
    tests seed them directly to keep each test about one behavior."""
    with db_session() as db:
        item = models.Item(room_id=room_id, location_id=location_id, name=name, status=status)
        db.add(item)
        db.commit()
        return item.id


def get_item(item_id: int) -> models.Item:
    with db_session() as db:
        return db.get(models.Item, item_id)


def say(api: TestClient, text: str, room_id: int, model_reply: dict | str):
    """POST /api/chat with Nemotron mocked to return `model_reply`.

    A dict is sent as JSON; a str is sent verbatim (to simulate bad output).
    Returns the raw response so callers can check status codes too.
    """
    reply_text = model_reply if isinstance(model_reply, str) else json.dumps(model_reply)
    with patch("app.ai.commands.chat") as chat_mock:
        chat_mock.return_value = NS(text=reply_text, est_cost_usd=0.00003)
        return api.post("/api/chat", json={"text": text, "room_id": room_id})
