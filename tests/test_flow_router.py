"""GET /flow (app/routers/flow.py): the whole pipeline in one summary, each stage with its real headline number and
where it comes from, built only from committed files and DATA_DIR caches. Every cited number must still be in the
note it cites; missing caches degrade to the cited numbers; no filesystem path ever reaches the response."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import flow
from demo_pipeline.paths import REPO_ROOT

PAGE_STAGES = ["record", "measure", "repair", "verify", "multiply", "teach", "train", "evaluate", "analyse", "recipe"]


@pytest.fixture
def data(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client(data) -> TestClient:
    app = FastAPI()
    app.include_router(flow.router)
    return TestClient(app)


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


def assert_no_paths(body, *roots: Path):
    for s in strings(body):
        for r in roots:
            assert str(r) not in s, s
        assert "C:\\" not in s and not s.startswith("/Users") and not s.startswith("/home"), s


def test_every_stage_is_present_in_order_with_a_metric_and_a_source(client):
    body = client.get("/flow").json()
    assert [s["id"] for s in body["stages"]] == PAGE_STAGES
    for s in body["stages"]:
        assert s["title"] and s["does"] and s["link"].startswith("/")
        assert s["metric"]["headline"], s["id"]
        assert s["source"]["label"], s["id"]
    assert body["loop_back"] == {"from": "recipe", "to": "multiply"}


def test_the_headline_numbers_are_the_measured_ones(client):
    by = {s["id"]: s for s in client.get("/flow").json()["stages"]}
    assert by["record"]["metric"]["value"] == 10
    assert by["repair"]["metric"]["headline"].startswith("3/10")
    assert by["multiply"]["metric"]["before"] == {"k": 3, "n": 40, "ci": [0.026, 0.199]}
    assert by["multiply"]["metric"]["after"]["k"] == 17
    assert by["teach"]["metric"]["after"]["k"] == 113 and by["teach"]["metric"]["before"]["k"] == 0
    assert by["train"]["metric"]["before"]["k"] == 15 and by["train"]["metric"]["after"] == {
        "k": 30, "n": 40, "ci": [0.598, 0.858]}
    assert by["evaluate"]["metric"]["runs"] == 40 and by["evaluate"]["metric"]["after"]["k"] == 30


def test_every_cited_number_is_in_its_note():
    for key, c in flow.CITED.items():
        path = REPO_ROOT / c.note
        assert path.is_file(), (key, c.note)
        text = path.read_text(encoding="utf-8")
        for needle in c.needles:
            assert needle in text, (key, c.note, needle)


def test_no_filesystem_path_is_returned(client, data):
    body = client.get("/flow").json()
    assert_no_paths(body, REPO_ROOT, data)


def test_missing_caches_degrade_to_the_cited_numbers(client):
    body = client.get("/flow").json()
    analyse = next(s for s in body["stages"] if s["id"] == "analyse")
    assert analyse["source"]["kind"] == "note"
    assert "0.092" in analyse["metric"]["headline"] or "0.092" in analyse["metric"]["detail"]
    assert body["loop"]["status"] == "none"


def test_a_cached_analysis_is_used(client, data):
    cache = data / "analysis" / "bigtest_final"
    cache.mkdir(parents=True)
    (cache / "analysis.json").write_text(json.dumps({
        "k": 3, "calls": 5, "cost_usd": 0.042488, "model": "nvidia/nemotron-3-super-120b-a12b", "agreement": 0.8333,
        "recipe": {"summary": "s", "regions": [{"name": "left_cube_right_bin"}], "fixes": [], "uniform_share": 0.6},
        "support": [{"region": "left_cube_right_bin", "target_failures_inside": 10, "target_failures_total": 17,
                     "p_value": 0.091774}]}), encoding="utf-8")
    analyse = next(s for s in client.get("/flow").json()["stages"] if s["id"] == "analyse")
    assert analyse["source"]["kind"] == "cache"
    assert analyse["metric"]["agreement"] == pytest.approx(0.8333)
    assert analyse["metric"]["cost_usd"] == pytest.approx(0.042488)
    assert analyse["metric"]["p_value"] == pytest.approx(0.091774)


def test_an_unreadable_cache_degrades(client, data):
    cache = data / "analysis" / "bigtest_final"
    cache.mkdir(parents=True)
    (cache / "analysis.json").write_text("{not json", encoding="utf-8")
    analyse = next(s for s in client.get("/flow").json()["stages"] if s["id"] == "analyse")
    assert analyse["source"]["kind"] == "note"


def write_loop(data: Path, name: str, stages: dict, result=None, seeds=(5680, 40)):
    folder = data / "loops" / name
    folder.mkdir(parents=True)
    st = {s: {"status": "pending"} for s in flow.LOOP_STAGES}
    st.update({k: {"status": v, "command": ["SECRET_CMD", str(data)], "started": "2026-10-28T01:00:00+00:00",
                   "ended": "2026-10-28T02:00:00+00:00", "outputs": {"x": str(folder / "x.json")}}
               for k, v in stages.items()})
    (folder / "loop.json").write_text(json.dumps({
        "name": name, "seeds": {"seed0": seeds[0], "n": seeds[1], "range": [seeds[0], seeds[0] + seeds[1] - 1]},
        "stages": st, "result": result}), encoding="utf-8")
    return folder


def test_the_latest_loop_is_summarised_without_commands_or_paths(client, data):
    write_loop(data, "loop_a", {"diagnose": "done", "freeze": "done", "train_recipe": "running"})
    body = client.get("/flow").json()
    loop = body["loop"]
    assert loop["status"] == "running" and loop["name"] == "loop_a"
    assert loop["current"] == "train_recipe"
    assert [s["id"] for s in loop["stages"]] == list(flow.LOOP_STAGES)
    assert loop["seeds"] == [5680, 5719]
    assert "SECRET_CMD" not in json.dumps(body)
    assert_no_paths(body, REPO_ROOT, data)


def test_a_finished_loop_carries_its_result(client, data):
    result = {"recipe": {"successes": 30, "n": 40, "rate": 0.75, "ci": [0.598, 0.858]},
              "control": {"successes": 18, "n": 40, "rate": 0.45, "ci": [0.31, 0.6]},
              "p_one_sided": 0.006, "p_two_sided": 0.012, "decision": "recipe_better", "sample": False}
    write_loop(data, "loop_b", {s: "done" for s in flow.LOOP_STAGES}, result=result)
    body = client.get("/flow").json()
    assert body["loop"]["status"] == "done"
    assert body["loop"]["result"]["decision"] == "recipe_better"
    assert body["loop"]["result"]["recipe"]["successes"] == 30
    recipe = next(s for s in body["stages"] if s["id"] == "recipe")
    assert "30/40" in recipe["metric"]["headline"]


def test_a_loop_folder_with_a_bad_name_or_bad_json_is_ignored(client, data):
    bad = data / "loops" / "Bad Name"
    bad.mkdir(parents=True)
    (bad / "loop.json").write_text(json.dumps({"stages": {}}), encoding="utf-8")
    broken = data / "loops" / "broken"
    broken.mkdir(parents=True)
    (broken / "loop.json").write_text("{nope", encoding="utf-8")
    assert client.get("/flow").json()["loop"]["status"] == "none"


def test_the_summary_carries_an_etag_and_a_repeat_with_it_is_not_modified(client):
    r = client.get("/flow")
    assert r.headers["cache-control"] == "no-cache" and r.headers["etag"]
    again = client.get("/flow", headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304 and again.content == b""
