"""GET /results serves DATA_DIR/results/results.json (plan sprint 3b, T5 Task 1)."""
from __future__ import annotations

import json

import pytest

RESULTS = {
    "sample": False,
    "demos": [5, 10, 20],
    "series": [{"key": "raw", "label": "Raw human demos", "success": [0.1, None, None]}],
    "ablation": {"demos": 10, "bars": [{"key": "rules", "label": "Rules-only repair", "success": None}]},
    "multiply_yield": {"ours": 0.9, "mimicgen": [0.38, 0.74]},
}


@pytest.fixture
def results_api(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    return api


def _write(tmp_path, text: str) -> None:
    path = tmp_path / "data" / "results" / "results.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_returns_the_results_file_unchanged(results_api, tmp_path):
    _write(tmp_path, json.dumps(RESULTS))
    res = results_api.get("/results")
    assert res.status_code == 200
    assert res.json() == RESULTS


def test_missing_file_is_404_no_results_yet(results_api):
    res = results_api.get("/results")
    assert res.status_code == 404
    assert res.json() == {"detail": "no results yet"}


def test_missing_results_dir_is_also_404(results_api, tmp_path):
    (tmp_path / "data").mkdir()
    assert results_api.get("/results").status_code == 404


def test_corrupt_json_is_422_with_a_reason(results_api, tmp_path):
    _write(tmp_path, '{"sample": false, "demos": [5,')
    res = results_api.get("/results")
    assert res.status_code == 422
    assert "results.json" in res.json()["detail"]


def test_json_that_is_not_an_object_is_422(results_api, tmp_path):
    _write(tmp_path, "[1, 2, 3]")
    assert results_api.get("/results").status_code == 422


def test_reads_data_dir_on_every_request(results_api, monkeypatch, tmp_path):
    assert results_api.get("/results").status_code == 404
    other = tmp_path / "other"
    (other / "results").mkdir(parents=True)
    (other / "results" / "results.json").write_text(json.dumps(RESULTS), encoding="utf-8")
    monkeypatch.setenv("DATA_DIR", str(other))
    assert results_api.get("/results").json() == RESULTS
