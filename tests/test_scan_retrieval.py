"""Scan upload -> list -> file download, so the browser can render the GLB.
Temp DB and upload dir; no network, no spend."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import models
from app.db import _get_session_factory, init_db
from app.main import app
from app.storage import scan_path

GLB = b"glTF-fake-glb-bytes"


class ScanRetrievalTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._env_patch = patch.dict(
            os.environ,
            {
                "APP_DB_PATH": str(Path(self._tmpdir.name) / "test.db"),
                "APP_UPLOAD_DIR": str(Path(self._tmpdir.name) / "uploads"),
            },
        )
        self._env_patch.start()
        init_db()
        self.client = TestClient(app)

    def tearDown(self):
        self._env_patch.stop()
        self._tmpdir.cleanup()

    def _room(self) -> int:
        return self.client.post("/api/rooms", json={"name": "Bedroom"}).json()["id"]

    def _upload(self, room_id: int, data: bytes = GLB) -> dict:
        r = self.client.post(
            f"/api/scans?room_id={room_id}", files={"file": ("scan.glb", data, "model/gltf-binary")}
        )
        self.assertEqual(r.status_code, 200)
        return r.json()

    def _foreign_room(self) -> int:
        with _get_session_factory()() as db:
            room = models.Room(owner_id="someone-else", name="Not yours")
            db.add(room)
            db.commit()
            return room.id

    def test_uploaded_scan_can_be_downloaded_byte_for_byte(self):
        scan = self._upload(self._room())
        r = self.client.get(f"/api/scans/{scan['id']}/file")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, GLB)
        self.assertEqual(r.headers["content-type"], "model/gltf-binary")

    def test_list_returns_newest_first(self):
        room_id = self._room()
        first = self._upload(room_id)
        second = self._upload(room_id, b"glTF-second")
        ids = [s["id"] for s in self.client.get(f"/api/scans?room_id={room_id}").json()]
        self.assertEqual(ids, [second["id"], first["id"]])

    def test_list_is_empty_for_a_room_without_scans(self):
        self.assertEqual(self.client.get(f"/api/scans?room_id={self._room()}").json(), [])

    def test_list_for_missing_room_is_404(self):
        self.assertEqual(self.client.get("/api/scans?room_id=9999").status_code, 404)

    def test_other_owners_room_is_404_for_upload_and_list(self):
        foreign = self._foreign_room()
        self.assertEqual(self.client.get(f"/api/scans?room_id={foreign}").status_code, 404)
        r = self.client.post(f"/api/scans?room_id={foreign}", files={"file": ("s.glb", GLB, "model/gltf-binary")})
        self.assertEqual(r.status_code, 404)

    def test_other_owners_scan_file_is_404(self):
        foreign = self._foreign_room()
        with _get_session_factory()() as db:
            scan = models.Scan(room_id=foreign, storage_key="whatever.glb")
            db.add(scan)
            db.commit()
            scan_id = scan.id
        self.assertEqual(self.client.get(f"/api/scans/{scan_id}/file").status_code, 404)

    def test_missing_scan_is_404(self):
        self.assertEqual(self.client.get("/api/scans/9999/file").status_code, 404)

    def test_scan_row_whose_file_is_gone_is_404_not_500(self):
        scan = self._upload(self._room())
        scan_path(scan["storage_key"]).unlink()
        self.assertEqual(self.client.get(f"/api/scans/{scan['id']}/file").status_code, 404)

    def test_scan_path_refuses_keys_that_escape_the_directory(self):
        with self.assertRaises(ValueError):
            scan_path("../../etc/passwd")


if __name__ == "__main__":
    unittest.main()
