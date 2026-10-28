"""GET /corrections/queue: the human "retake from here" queue the practice-and-correct round fills
(sim_worker.corrections.RetakeQueue), for the Record page to open later."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_corrections import SCENE, missed_grasp  # noqa: E402

from sim_worker.corrections import RetakeQueue, correction_candidates, retake_item  # noqa: E402


@pytest.fixture
def queue_api(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    (cand,) = correction_candidates(missed_grasp(), SCENE, source="perfected_multiply_10")
    q = RetakeQueue(tmp_path / "data")
    q.add(retake_item(cand, SCENE, checkpoint="ckpt", trace_path="traces/seed_5203.npz", round_id="corr_r1"))
    return api, q


def test_the_queue_lists_open_retakes(queue_api):
    api, _ = queue_api
    body = api.get("/corrections/queue").json()
    (item,) = body["items"]
    assert item["name"] == "corr_5203_failed_grasp" and item["status"] == "open" and item["round_id"] == "corr_r1"
    assert item["failure"]["kind"] == "failed_grasp" and item["state"]["k"] == 150 and item["scene"]["seed"] == 5203
    assert body["counts"] == {"open": 1, "done": 0, "skipped": 0}


def test_the_queue_filters_by_status_and_reads_one_item(queue_api):
    api, q = queue_api
    q.mark("corr_5203_failed_grasp", "done", demo_id="human_x")
    assert api.get("/corrections/queue", params={"status": "open"}).json()["items"] == []
    assert api.get("/corrections/queue/corr_5203_failed_grasp").json()["demo_id"] == "human_x"
    assert api.get("/corrections/queue/nope").status_code == 404
    assert api.get("/corrections/queue", params={"status": "maybe"}).status_code == 422


def test_an_empty_queue_is_empty(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "empty"))
    assert api.get("/corrections/queue").json() == {"items": [], "counts": {"open": 0, "done": 0, "skipped": 0}}
