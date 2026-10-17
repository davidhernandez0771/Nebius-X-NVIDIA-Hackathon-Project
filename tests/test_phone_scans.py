"""In-app phone room scanning (Reali3 integration). The real Reali3 client
functions are always mocked here -- no test in this file makes a real network
call or spends real money, matching every other AI-backed route's tests."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app import models
from app.ai.reali3 import Reali3Error

from conftest import db_session, make_room


def _photo_files(n: int) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files", (f"photo{i}.jpg", b"fake-bytes", "image/jpeg")) for i in range(n)]


@pytest.fixture
def room_id(api: TestClient) -> int:
    return make_room(api)


def test_too_few_photos_is_rejected(api: TestClient, room_id: int):
    r = api.post(f"/api/rooms/{room_id}/phone-scans", files=_photo_files(3))
    assert r.status_code == 400


def test_too_many_photos_is_rejected(api: TestClient, room_id: int):
    r = api.post(f"/api/rooms/{room_id}/phone-scans", files=_photo_files(41))
    assert r.status_code == 400


def test_a_second_job_while_one_is_in_progress_is_rejected(api: TestClient, room_id: int):
    with patch("app.routers.phone_scans.create_reconstruction", return_value="rec_1"):
        first = api.post(f"/api/rooms/{room_id}/phone-scans", files=_photo_files(8))
    assert first.status_code == 200

    with patch("app.routers.phone_scans.create_reconstruction", return_value="rec_2"):
        second = api.post(f"/api/rooms/{room_id}/phone-scans", files=_photo_files(8))
    assert second.status_code == 409


def test_full_lifecycle_materializes_a_real_scan(api: TestClient, room_id: int):
    with patch("app.routers.phone_scans.create_reconstruction", return_value="rec_1") as create_mock:
        submit = api.post(f"/api/rooms/{room_id}/phone-scans", files=_photo_files(10))
    assert submit.status_code == 200
    job_id = submit.json()["id"]
    assert submit.json()["status"] == "pending"
    # Photos are proxied straight through, not persisted -- confirm what was sent.
    assert len(create_mock.call_args.args[0]) == 10

    with patch("app.routers.phone_scans.get_status", return_value={"status": "processing", "progress": 40}):
        mid = api.get(f"/api/phone-scans/{job_id}/status")
    assert mid.json()["status"] == "processing"
    assert mid.json()["progress"] == 40
    assert mid.json()["scan_id"] is None

    with (
        patch("app.routers.phone_scans.get_status", return_value={"status": "completed", "progress": 100}),
        patch("app.routers.phone_scans.download_model", return_value=b"fake-glb-bytes") as download_mock,
    ):
        done = api.get(f"/api/phone-scans/{job_id}/status")
    assert done.status_code == 200
    assert done.json()["status"] == "completed"
    scan_id = done.json()["scan_id"]
    assert scan_id is not None
    download_mock.assert_called_once_with("rec_1", "glb")

    scans = api.get(f"/api/scans?room_id={room_id}").json()
    assert any(s["id"] == scan_id for s in scans)

    # A later poll must not call Reali3 again -- the job is already terminal.
    with patch("app.routers.phone_scans.get_status") as get_status_mock:
        again = api.get(f"/api/phone-scans/{job_id}/status")
    get_status_mock.assert_not_called()
    assert again.json()["status"] == "completed"


def test_a_failed_reconstruction_creates_no_scan(api: TestClient, room_id: int):
    with patch("app.routers.phone_scans.create_reconstruction", return_value="rec_1"):
        submit = api.post(f"/api/rooms/{room_id}/phone-scans", files=_photo_files(8))
    job_id = submit.json()["id"]

    with patch("app.routers.phone_scans.get_status", return_value={"status": "failed", "progress": 0}):
        r = api.get(f"/api/phone-scans/{job_id}/status")
    assert r.json()["status"] == "failed"
    assert r.json()["scan_id"] is None
    with db_session() as db:
        job = db.get(models.PhoneScanJob, job_id)
        assert job.status == "failed"
        assert job.scan_id is None


def test_reali3_error_on_submit_is_502(api: TestClient, room_id: int):
    with patch("app.routers.phone_scans.create_reconstruction", side_effect=Reali3Error("down")):
        r = api.post(f"/api/rooms/{room_id}/phone-scans", files=_photo_files(8))
    assert r.status_code == 502
