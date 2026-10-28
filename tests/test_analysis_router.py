"""The /analysis routes (app/routers/analysis.py): the committed big-test results read by id only, the cached Nemotron
run shown with what the code sent back, and the live run off unless SANT_ANALYST_LIVE=1, one at a time, once a
minute. Nemotron is faked."""
from __future__ import annotations

import json
import math
from types import SimpleNamespace as NS

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import analysis
from nebius_llm import TokenFactoryError

GOOD = json.dumps({"summary": "drops spread across the workspace", "regions": [], "uniform_share": 1.0})
CHANCE_REGION = json.dumps({
    "summary": "drops with the bin on the right", "uniform_share": 0.6,
    "hypotheses": [{"claim": "c", "evidence_seeds": [5400]}],
    "regions": [{"name": "right_bin", "targets": ["dropped"], "cube_x": [0.4, 0.6], "cube_y": [-0.2, 0.2],
                 "cube_yaw_deg": [-45, 45], "bin_x": [0.4, 0.65], "bin_y": [-0.3, -0.25], "share": 0.4,
                 "rationale": "r"}],
})


def fake_chat(*replies):
    calls = []

    def chat_fn(prompt, **kw):
        calls.append(kw)
        r = replies[min(len(calls), len(replies)) - 1]
        if isinstance(r, Exception):
            raise r
        return NS(text=r, est_cost_usd=0.01, model="nvidia/fake")

    chat_fn.calls = calls
    return chat_fn


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("SANT_ANALYST_LIVE", raising=False)
    monkeypatch.setitem(analysis._last_run, "t", -math.inf)
    monkeypatch.setattr(analysis, "SNAPSHOTS", tmp_path / "no_snapshots")  # each test sees only its own DATA_DIR
    app = FastAPI()
    app.include_router(analysis.router)
    c = TestClient(app)
    c.app_ref = app
    return c


def use_chat(client, chat_fn):
    client.app_ref.dependency_overrides[analysis.get_chat_fn] = lambda: chat_fn


def test_sources_list_the_committed_results_and_live_is_off_by_default(client):
    body = client.get("/analysis/sources").json()
    assert body["live_enabled"] is False
    final = next(s for s in body["sources"] if s["id"] == "bigtest_final")
    assert final["episodes"] == 69 and final["successes"] == 51 and final["post_hoc"] is True
    assert final["cached"] is False  # DATA_DIR is empty here
    a60 = next(s for s in body["sources"] if s["id"] == "stage_a_60k")
    assert a60["post_hoc"] is False and a60["episodes"] == 29


def test_an_analysis_reads_without_calling_the_model(client):
    use_chat(client, lambda *a, **k: pytest.fail("GET must not call Nemotron"))
    r = client.get("/analysis/bigtest_final").json()
    assert r["episodes"] == 69 and r["failures"] == 18 and r["untraced"] and r["post_hoc"]
    assert r["failure_counts"] == {"dropped": 17, "collision": 1}
    assert r["nemotron"] is None and r["rules"] is not None
    test_points = [p for p in r["points"] if p["test"]]
    assert len(test_points) == 40 and sum(p["success"] for p in test_points) == 30  # the big test's 30/40
    assert {"axis", "bin", "n", "successes", "failures"} <= set(r["failure_table"][0])
    json.dumps(r, allow_nan=False)


@pytest.mark.parametrize("bad", ["..", "..%2F..%2Fetc", "BIGTEST", "big-test", "a" * 65, "%2e%2e"])
def test_ids_that_are_not_names_are_refused(client, bad):
    assert client.get(f"/analysis/{bad}").status_code in (400, 404)


def test_an_unknown_id_is_not_found_and_nothing_names_a_path(client):
    r = client.get("/analysis/passwd")
    assert r.status_code == 404
    assert "/" not in r.json()["detail"]


def test_a_traversal_through_the_path_never_reaches_a_file(client):
    for url in ("/analysis/../../etc/passwd", "/analysis/%2e%2e/%2e%2e/etc/passwd", "/analysis/..%5c..%5cwin.ini"):
        r = client.get(url)
        assert r.status_code in (400, 404, 405)
        assert "root:" not in r.text


def test_a_cached_run_is_shown_with_what_the_code_sent_back(client, tmp_path):
    cache = tmp_path / "analysis" / "bigtest_final"
    cache.mkdir(parents=True)
    cache.joinpath("analysis.json").write_text(json.dumps({
        "k": 2, "calls": 3, "cost_usd": 0.02, "model": "nvidia/fake", "api_errors": 1, "agreement": None,
        "recipe": json.loads(GOOD), "candidates": [json.loads(GOOD)], "candidate_agreement": [None],
        "attempts": [
            {"sample": 0, "reply": CHANCE_REGION, "errors": ["region 'right_bin': likely chance (p = 0.4)"], "think": True},
            {"sample": 0, "reply": GOOD, "errors": [], "think": True},
            {"sample": 1, "reply": "", "errors": ["api_error: secret-key-123 at https://internal"], "think": True},
        ]}), encoding="utf-8")
    n = client.get("/analysis/bigtest_final").json()["nemotron"]
    first, ok, down = n["attempts"]
    assert not first["accepted"] and first["claimed"]["regions"] == ["right_bin"] and "likely chance" in first["errors"][0]
    assert first["excerpt"].startswith("{")
    assert ok["accepted"] and ok["excerpt"] is None
    assert down["errors"] == ["the model service did not answer"]
    assert "secret-key-123" not in json.dumps(n)
    assert client.get("/analysis/sources").json()["sources"][0]["cached"] is True


def test_a_live_run_is_refused_unless_the_flag_is_set(client):
    use_chat(client, lambda *a, **k: pytest.fail("must not be called"))
    r = client.post("/analysis/bigtest_final/run", json={})
    assert r.status_code == 403 and "SANT_ANALYST_LIVE" in r.json()["detail"]


def test_a_live_run_asks_nemotron_caches_it_and_returns_the_analysis(client, monkeypatch, tmp_path):
    monkeypatch.setenv("SANT_ANALYST_LIVE", "1")
    chat = fake_chat(CHANCE_REGION, GOOD)
    use_chat(client, chat)
    r = client.post("/analysis/stage_a_60k/run", json={"k": 1})
    assert r.status_code == 200, r.text
    n = r.json()["nemotron"]
    assert n["calls"] == 2 and n["recipe"]["regions"] == [] and n["model"] == "nvidia/fake"
    assert [a["accepted"] for a in n["attempts"]] == [False, True]  # the chance region went back with its numbers
    assert chat.calls[0]["tier"] == "super"
    saved = json.loads((tmp_path / "analysis" / "stage_a_60k" / "analysis.json").read_text(encoding="utf-8"))
    assert saved["calls"] == 2 and saved["ran_at"]
    assert client.get("/analysis/stage_a_60k").json()["nemotron"]["calls"] == 2  # GET now shows the cache


def test_live_runs_are_capped_and_rate_limited(client, monkeypatch):
    monkeypatch.setenv("SANT_ANALYST_LIVE", "1")
    use_chat(client, fake_chat(GOOD))
    assert client.post("/analysis/stage_a_60k/run", json={"k": 4}).status_code == 422
    assert client.post("/analysis/stage_a_60k/run", json={"k": 1, "path": "/etc"}).status_code == 422
    assert client.post("/analysis/stage_a_60k/run", json={"k": 1}).status_code == 200
    r = client.post("/analysis/stage_a_60k/run", json={"k": 1})
    assert r.status_code == 429 and "a minute" in r.json()["detail"]


def test_a_run_already_in_progress_is_refused(client, monkeypatch):
    monkeypatch.setenv("SANT_ANALYST_LIVE", "1")
    use_chat(client, fake_chat(GOOD))
    assert analysis._run_lock.acquire(blocking=False)
    try:
        assert client.post("/analysis/stage_a_60k/run", json={"k": 1}).status_code == 409
    finally:
        analysis._run_lock.release()


def test_an_api_outage_never_leaks_the_error_text(client, monkeypatch):
    monkeypatch.setenv("SANT_ANALYST_LIVE", "1")
    use_chat(client, fake_chat(TokenFactoryError("401 bad key sk-live-abc")))
    r = client.post("/analysis/stage_a_60k/run", json={"k": 1})
    assert r.status_code == 200 and "sk-live-abc" not in r.text
    assert r.json()["nemotron"]["api_errors"] == 1 and r.json()["nemotron"]["recipe"] is None

    monkeypatch.setitem(analysis._last_run, "t", -math.inf)
    use_chat(client, fake_chat(RuntimeError("boom with sk-live-abc")))
    r = client.post("/analysis/stage_a_60k/run", json={"k": 1})
    assert r.status_code == 502 and "sk-live-abc" not in r.text


def test_a_symlinked_cache_folder_pointing_outside_is_refused(client, tmp_path):
    outside = tmp_path.parent / f"{tmp_path.name}_outside"
    outside.mkdir()
    (outside / "analysis.json").write_text(json.dumps({"attempts": []}), encoding="utf-8")
    (tmp_path / "analysis").mkdir()
    (tmp_path / "analysis" / "bigtest_final").symlink_to(outside, target_is_directory=True)
    assert client.get("/analysis/bigtest_final").status_code == 400


def test_reads_carry_an_etag_and_a_repeat_with_it_is_not_modified(client):
    for url in ("/analysis/sources", "/analysis/bigtest_final"):
        r = client.get(url)
        assert r.headers["cache-control"] == "no-cache" and r.headers["etag"]
        again = client.get(url, headers={"If-None-Match": r.headers["etag"]})
        assert again.status_code == 304 and again.content == b""


def test_a_live_run_invalidates_the_cached_read(client, monkeypatch):
    before = client.get("/analysis/stage_a_60k")
    assert before.json()["nemotron"] is None
    monkeypatch.setenv("SANT_ANALYST_LIVE", "1")
    use_chat(client, fake_chat(GOOD))
    assert client.post("/analysis/stage_a_60k/run", json={"k": 1}).status_code == 200
    after = client.get("/analysis/stage_a_60k", headers={"If-None-Match": before.headers["etag"]})
    assert after.status_code == 200 and after.json()["nemotron"]["calls"] == 1
    assert after.headers["etag"] != before.headers["etag"]


def test_a_server_with_no_cache_of_its_own_shows_the_committed_snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(analysis.router)
    c = TestClient(app)
    use = lambda *a, **k: pytest.fail("GET must not call Nemotron")  # noqa: E731
    app.dependency_overrides[analysis.get_chat_fn] = lambda: use
    sources = c.get("/analysis/sources").json()["sources"]
    assert all(s["cached"] for s in sources)  # every source ships with its Nemotron run
    n = c.get("/analysis/bigtest_final").json()["nemotron"]
    assert n is not None and n["model"].startswith("nvidia/") and n["recipe"] is not None
