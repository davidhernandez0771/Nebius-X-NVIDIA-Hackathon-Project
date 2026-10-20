"""app.ai.scene_creator + scripts/scene_from_text.py: a sentence -> a validated ScenePlan, Nemotron faked."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from app.ai import scene_creator as sc
from demo_pipeline.scene_plan import ScenePlan, validate_plan

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "scene_from_text.py"

GOOD = {
    "objects": [
        {"id": "bin_left", "kind": "bin", "color": "blue", "pose": {"x": 0.55, "y": 0.2}},
        {"id": "bin_right", "kind": "bin", "color": "green", "pose": {"x": 0.55, "y": -0.2}},
        {"id": "cube_blue", "kind": "cube", "color": "blue", "pose": {"x": 0.45, "y": 0.0}},
        {"id": "cube_green", "kind": "cube", "color": "green", "on": "cube_blue"},
        {"id": "cube_red", "kind": "cube", "color": "red", "on": "cube_green"},
    ],
    "goals": [{"object": "cube_red", "bin": "bin_left"}],
}
OUT_OF_REACH = json.loads(json.dumps(GOOD))
OUT_OF_REACH["objects"][0]["pose"]["y"] = 0.5


def _fake(*replies):
    calls = []

    def chat_fn(prompt, **kw):
        calls.append({"prompt": prompt, **kw})
        return NS(text=replies[len(calls) - 1], est_cost_usd=0.001)

    chat_fn.calls = calls
    return chat_fn


def test_a_good_first_reply_is_one_call():
    fake = _fake("Here you go:\n```json\n" + json.dumps(GOOD) + "\n```")
    res = sc.plan_from_text("2 bins, 3 cubes in a pile, red one in the left bin", chat_fn=fake)
    assert res.ok and res.calls == 1 and res.errors == []
    assert res.plan.goals[0].object == "cube_red" and validate_plan(res.plan) == []
    assert "2 bins, 3 cubes" in fake.calls[0]["prompt"] and fake.calls[0]["system"] == sc.SYSTEM_PROMPT
    assert res.cost == pytest.approx(0.001)


def test_validator_errors_go_back_to_the_model_and_it_can_fix_them():
    fake = _fake(json.dumps(OUT_OF_REACH), json.dumps(GOOD))
    res = sc.plan_from_text("two bins", chat_fn=fake)
    assert res.ok and res.calls == 2
    second = fake.calls[1]["prompt"]
    assert "bin_left" in second and "out of reach" in second and '"y": 0.5' in second
    assert res.attempts[0]["errors"] and res.attempts[1]["errors"] == []


def test_schema_errors_and_non_json_also_go_back():
    bad_schema = json.loads(json.dumps(GOOD))
    bad_schema["objects"][2]["size"] = 0.5
    fake = _fake("I can't do JSON today", json.dumps(bad_schema), json.dumps(GOOD))
    res = sc.plan_from_text("x", chat_fn=fake)
    assert res.ok and res.calls == 3
    assert "no JSON object" in fake.calls[1]["prompt"]
    assert "objects.2" in fake.calls[2]["prompt"] and "size" in fake.calls[2]["prompt"]


def test_gives_up_after_three_retries_with_the_last_errors():
    fake = _fake(*[json.dumps(OUT_OF_REACH)] * 5)
    res = sc.plan_from_text("x", chat_fn=fake)
    assert not res.ok and res.plan is None and res.calls == 4  # the first try + 3 retries
    assert any("out of reach" in e for e in res.errors)


def test_the_model_cannot_widen_the_robots_reach():
    wide = dict(GOOD, reach={"x": [0.0, 2.0], "y": [-2.0, 2.0], "z_max": 0.6})
    res = sc.plan_from_text("x", chat_fn=_fake(json.dumps(wide)))
    assert res.ok and res.plan.reach == ScenePlan.model_validate(GOOD).reach


def test_the_system_prompt_states_the_rules_the_validator_checks():
    p = sc.SYSTEM_PROMPT
    for needle in ("0.40", "0.65", "-0.30", "3 cm", '"on"', "left", "+y", "JSON"):
        assert needle in p


# --- the CLI -----------------------------------------------------------------------------------

def _script():
    spec = importlib.util.spec_from_file_location("scene_from_text", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_cli_prints_and_saves_a_valid_plan(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    mod = _script()
    code = mod.main(["2 bins, 3 cubes stacked", "--tier", "super"], chat_fn=_fake(json.dumps(GOOD)))
    out = capsys.readouterr().out
    assert code == 0 and "valid" in out and "cube_red" in out
    saved = list((tmp_path / "scenes").glob("*.json"))
    assert len(saved) == 1
    doc = json.loads(saved[0].read_text(encoding="utf-8"))
    assert doc["text"] == "2 bins, 3 cubes stacked" and doc["id"] == saved[0].stem
    assert ScenePlan.model_validate(doc["plan"]).goals[0].bin == "bin_left"


def test_cli_saves_nothing_when_the_plan_never_validates(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    code = _script().main(["x"], chat_fn=_fake(*[json.dumps(OUT_OF_REACH)] * 4))
    assert code == 1 and "out of reach" in capsys.readouterr().out
    assert not (tmp_path / "scenes").exists()


def test_cli_checks_a_plan_file_without_the_model(tmp_path, capsys):
    path = tmp_path / "p.json"
    path.write_text(json.dumps(OUT_OF_REACH), encoding="utf-8")
    assert _script().main(["--check", str(path)], chat_fn=None) == 1
    assert "out of reach" in capsys.readouterr().out


# --- the physics check (sim_worker.settle) after the validator ----------------------------------------

def test_a_physics_check_runs_after_the_validator_and_its_problems_go_back_too():
    seen = []

    def settle(plan):
        seen.append(plan)
        return ["cube_red fell off cube_green: it dropped 4.0 cm ..."] if len(seen) == 1 else []

    fake = _fake(json.dumps(OUT_OF_REACH), json.dumps(GOOD), json.dumps(GOOD))
    res = sc.plan_from_text("x", chat_fn=fake, check_fn=settle)
    assert res.ok and res.calls == 3
    # Not run on a plan the validator rejects (no Isaac time on it).
    assert len(seen) == 2
    assert "fell off cube_green" in fake.calls[2]["prompt"]
    assert res.attempts[1]["errors"] == ["cube_red fell off cube_green: it dropped 4.0 cm ..."]


def test_without_a_physics_check_nothing_changes():
    res = sc.plan_from_text("x", chat_fn=_fake(json.dumps(GOOD)))
    assert res.ok and res.calls == 1


def test_cli_settle_flag_runs_the_physics_check(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    mod = _script()
    called = []
    monkeypatch.setattr(mod, "settle_check", lambda plan: called.append(plan) or [])
    assert mod.main(["x", "--settle"], chat_fn=_fake(json.dumps(GOOD))) == 0
    assert len(called) == 1
