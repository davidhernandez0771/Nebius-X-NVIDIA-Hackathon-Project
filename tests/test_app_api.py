"""End-to-end API checks against a temp-file SQLite DB, with every
Nemotron/vision call mocked -- no network, no spend.
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db import init_db
from app.main import app


class AppApiTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "test.db"
        upload_dir = Path(self._tmpdir.name) / "uploads"
        self._env_patch = patch.dict(
            os.environ, {"APP_DB_PATH": str(db_path), "APP_UPLOAD_DIR": str(upload_dir)}
        )
        self._env_patch.start()
        init_db()
        self.client = TestClient(app)

    def tearDown(self):
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _make_room_and_location(self) -> tuple[int, int]:
        room = self.client.post("/api/rooms", json={"name": "Bedroom"}).json()
        location = self.client.post(f"/api/rooms/{room['id']}/locations", json={"name": "Desk"}).json()
        return room["id"], location["id"]

    def _upload_and_analyze(self, location_id: int, vision_text: str) -> dict:
        with patch("app.ai.vision.chat_vision") as vision_mock:
            vision_mock.return_value = NS(text=vision_text, est_cost_usd=0.0001)
            photo = self.client.post(
                f"/api/photos?location_id={location_id}",
                files={"file": ("shelf.jpg", b"fake-bytes", "image/jpeg")},
            ).json()
            return self.client.post(f"/api/photos/{photo['id']}/analyze").json()

    def test_health(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"status": "ok"})

    def test_room_and_location_crud(self):
        room = self.client.post("/api/rooms", json={"name": "Bedroom"}).json()
        self.assertEqual(room["name"], "Bedroom")
        location = self.client.post(f"/api/rooms/{room['id']}/locations", json={"name": "Desk"}).json()
        self.assertEqual(location["room_id"], room["id"])
        locations = self.client.get(f"/api/rooms/{room['id']}/locations").json()
        self.assertEqual(len(locations), 1)

    def test_unknown_room_is_404(self):
        r = self.client.get("/api/rooms/999")
        self.assertEqual(r.status_code, 404)

    def test_photo_upload_and_analyze(self):
        _, location_id = self._make_room_and_location()
        analysis = self._upload_and_analyze(
            location_id, '[{"label": "lamp", "category": "electronics", "count": 1, "uncertainty_note": ""}]'
        )
        self.assertEqual(len(analysis["candidates"]), 1)
        self.assertEqual(analysis["candidates"][0]["label"], "lamp")
        self.assertEqual(analysis["candidates"][0]["status"], "pending")

    def test_analyze_on_unparsable_reply_yields_no_candidates_not_an_error(self):
        _, location_id = self._make_room_and_location()
        analysis = self._upload_and_analyze(location_id, "sorry, I can't see anything clearly")
        self.assertEqual(analysis["candidates"], [])

    def test_review_organize_creates_item(self):
        room_id, location_id = self._make_room_and_location()
        analysis = self._upload_and_analyze(
            location_id, '[{"label": "cable", "category": "electronics", "count": 2, "uncertainty_note": ""}]'
        )
        candidate_id = analysis["candidates"][0]["id"]

        item = self.client.post(f"/api/candidates/{candidate_id}/review", json={"status": "organize"}).json()
        self.assertEqual(item["name"], "cable")
        self.assertEqual(item["quantity"], 2)

        items = self.client.get(f"/api/items?room_id={room_id}").json()
        self.assertEqual(len(items), 1)

    def test_review_trash_does_not_create_item(self):
        _, location_id = self._make_room_and_location()
        analysis = self._upload_and_analyze(
            location_id, '[{"label": "broken pen", "category": "office", "count": 1, "uncertainty_note": ""}]'
        )
        candidate_id = analysis["candidates"][0]["id"]

        r = self.client.post(f"/api/candidates/{candidate_id}/review", json={"status": "trash"})
        self.assertIsNone(r.json())

    def test_item_move(self):
        room_id, location_id = self._make_room_and_location()
        other_location = self.client.post(f"/api/rooms/{room_id}/locations", json={"name": "Shelf"}).json()
        analysis = self._upload_and_analyze(
            location_id, '[{"label": "book", "category": "misc", "count": 1, "uncertainty_note": ""}]'
        )
        item = self.client.post(
            f"/api/candidates/{analysis['candidates'][0]['id']}/review", json={"status": "organize"}
        ).json()

        move = self.client.post(
            f"/api/items/{item['id']}/moves", json={"new_location_id": other_location["id"]}
        ).json()
        self.assertEqual(move["new_location_id"], other_location["id"])
        self.assertEqual(move["previous_location_id"], location_id)

    @patch("app.ai.organize.chat")
    def test_organize_grounds_on_active_items_only(self, chat_mock):
        room_id, location_id = self._make_room_and_location()
        analysis = self._upload_and_analyze(
            location_id, '[{"label": "lamp", "category": "electronics", "count": 1, "uncertainty_note": ""}]'
        )
        self.client.post(f"/api/candidates/{analysis['candidates'][0]['id']}/review", json={"status": "organize"})

        self.client.post(f"/api/rooms/{room_id}/locations", json={"name": "Shelf"})
        chat_mock.return_value = NS(text="- lamp -> Shelf: easier to reach.", est_cost_usd=0.00002)
        result = self.client.post("/api/organize", json={"room_id": room_id}).json()

        self.assertIn("lamp", chat_mock.call_args.args[0])
        self.assertEqual(result["suggestion"], "- lamp → Shelf: easier to reach.")

    def test_chat_trash_command_end_to_end(self):
        room_id, location_id = self._make_room_and_location()
        analysis = self._upload_and_analyze(
            location_id, '[{"label": "lamp", "category": "electronics", "count": 1, "uncertainty_note": ""}]'
        )
        self.client.post(f"/api/candidates/{analysis['candidates'][0]['id']}/review", json={"status": "organize"})

        with patch("app.ai.commands.chat") as chat_mock:
            chat_mock.return_value = NS(
                text='{"action": "trash", "item_name": "lamp", "location_name": null, "question": null}',
                est_cost_usd=0.00003,
            )
            reply = self.client.post("/api/chat", json={"text": "send the lamp to trash", "room_id": room_id}).json()
        self.assertEqual(reply["action"], "trash")

        active = self.client.get(f"/api/items?room_id={room_id}").json()
        self.assertEqual(active, [])
        everything = self.client.get(f"/api/items?room_id={room_id}&include_trash=true").json()
        self.assertEqual(everything[0]["status"], "trash")

    def test_chat_command_that_does_not_parse_is_unknown_not_an_error(self):
        room_id, _ = self._make_room_and_location()
        with patch("app.ai.commands.chat") as chat_mock:
            chat_mock.return_value = NS(text="not json at all", est_cost_usd=0.00001)
            reply = self.client.post("/api/chat", json={"text": "asdkfjasldkf", "room_id": room_id}).json()
        self.assertEqual(reply["action"], "unknown")

    def test_scan_upload_rejects_non_glb(self):
        room_id, _ = self._make_room_and_location()
        r = self.client.post(
            f"/api/scans?room_id={room_id}", files={"file": ("scan.zip", b"not-a-scan", "application/zip")}
        )
        self.assertEqual(r.status_code, 400)

    def test_scan_upload_accepts_glb(self):
        room_id, _ = self._make_room_and_location()
        r = self.client.post(
            f"/api/scans?room_id={room_id}", files={"file": ("scan.glb", b"fake-glb-bytes", "model/gltf-binary")}
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["room_id"], room_id)


if __name__ == "__main__":
    unittest.main()
