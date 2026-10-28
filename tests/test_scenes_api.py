"""/scenes: the Record page's scene picker (demo_pipeline.scene_library) and its "describe a scene" box
(app.ai.scene_creator, Nemotron; faked here)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.ai.scene_creator import PlanResult
from demo_pipeline.scene_library import PROTOCOL_IDS, protocol_entries, standard_plan
from nebius_llm import TokenFactoryError


@pytest.fixture
def scenes_api(api, monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    return api


def test_the_list_has_standard_then_the_protocol(scenes_api, tmp_path):
    r = scenes_api.get("/scenes")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["scenes"]]
    assert ids == ["standard", *PROTOCOL_IDS]  # the protocol is seeded on first use
    s7 = r.json()["scenes"][7]
    assert s7["name"] == "S7 Yellow distractor" and s7["needs_settle"] is True and len(s7["hash"]) == 16
    assert {o["id"] for o in s7["plan"]["objects"]} == {"cube", "distractor", "bin"}
    assert (tmp_path / "data" / "scenes" / "s7.json").is_file()


def test_one_scene_and_a_missing_one(scenes_api):
    assert scenes_api.get("/scenes/s4").json()["plan"]["objects"][0]["size"] == 0.04
    assert scenes_api.get("/scenes/standard").json()["plan"] == standard_plan().model_dump(mode="json")
    assert scenes_api.get("/scenes/nope").status_code == 404
    assert scenes_api.get("/scenes/..%2Fx").status_code == 404


def _result(plan=None, errors=()):
    return PlanResult(plan=plan, errors=list(errors), calls=2, cost=0.001, model="nemotron-test")


def test_describe_a_scene_returns_a_plan_to_preview_and_saves_nothing(scenes_api, tmp_path):
    plan = protocol_entries()[6].plan
    with patch("app.routers.scenes.plan_from_text", return_value=_result(plan)) as make:
        r = scenes_api.post("/scenes/create", json={"text": "a yellow cube next to the red one"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["errors"] == [] and body["needs_settle"] is True
    assert body["plan"] == plan.model_dump(mode="json") and body["calls"] == 2 and body["model"] == "nemotron-test"
    assert make.call_args.args[0] == "a yellow cube next to the red one"
    saved = {p.stem for p in (tmp_path / "data" / "scenes").glob("*.json")}
    assert saved <= set(PROTOCOL_IDS)  # no new scene until the page saves it


def test_a_description_nemotron_cant_make_valid_says_why(scenes_api):
    with patch("app.routers.scenes.plan_from_text", return_value=_result(None, ["bin is out of reach"])):
        body = scenes_api.post("/scenes/create", json={"text": "a bin on the moon"}).json()
    assert body["ok"] is False and body["plan"] is None and body["errors"] == ["bin is out of reach"]


def test_nemotron_unavailable_is_503(scenes_api):
    with patch("app.routers.scenes.plan_from_text", side_effect=TokenFactoryError("no key")):
        assert scenes_api.post("/scenes/create", json={"text": "two cubes"}).status_code == 503


@pytest.mark.parametrize("text", ["", "   ", "x" * 501])
def test_a_description_must_be_a_sentence(scenes_api, text):
    assert scenes_api.post("/scenes/create", json={"text": text}).status_code == 422


def test_saving_a_plan_makes_a_scene_the_sink_can_load(scenes_api):
    plan = protocol_entries()[6].plan.model_dump(mode="json")
    r = scenes_api.post("/scenes", json={"name": "Two cubes", "description": "from a sentence", "plan": plan})
    assert r.status_code == 201
    entry = r.json()
    assert entry["id"].startswith("two_cubes_") and entry["source"] == "nemotron"
    assert scenes_api.get(f"/scenes/{entry['id']}").json()["plan"] == plan
    assert entry["id"] in [s["id"] for s in scenes_api.get("/scenes").json()["scenes"]]


def test_saving_a_plan_the_validator_fails_is_422(scenes_api):
    plan = protocol_entries()[6].plan.model_dump(mode="json")
    plan["objects"][2]["pose"] = dict(plan["objects"][0]["pose"])  # the distractor on the red cube
    r = scenes_api.post("/scenes", json={"name": "bad", "plan": plan})
    assert r.status_code == 422 and "overlap" in r.json()["detail"]
