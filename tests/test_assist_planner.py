"""app.ai.assist_planner: Nemotron proposes the semantic assist rules for a sentence + ScenePlan; code validates them
and sends problems back (at most 3 calls); the rules fallback takes over when Nemotron is off or never validates.
Nemotron is faked."""

from __future__ import annotations

import json
from types import SimpleNamespace as NS

import pytest

from app.ai import assist_planner as ap
from demo_pipeline.scene_plan import ScenePlan

PLAN = ScenePlan.model_validate({
    "objects": [
        {"id": "red", "kind": "cube", "color": "red", "pose": {"x": 0.45, "y": -0.1}},
        {"id": "green", "kind": "cube", "color": "green", "size": 0.04, "on": "red"},
        {"id": "blue", "kind": "cube", "color": "blue", "size": 0.06, "pose": {"x": 0.58, "y": 0.05}},
        {"id": "left_bin", "kind": "bin", "color": "yellow", "pose": {"x": 0.5, "y": 0.25}},
    ],
    "goals": [{"object": "green", "bin": "left_bin"}],
})
GOOD = {"targets": [{"object": "left_bin", "release_clearance_m": 0.015}],
        "obstacles": [{"object": "blue", "keep_out_clearance_m": 0.02, "speed_cap_mps": 0.1}], "notes": "blue is in the way"}
BAD = {"targets": [{"object": "pink_bin"}], "obstacles": []}


def _fake(*replies, raises=None):
    calls = []

    def chat_fn(prompt, **kw):
        calls.append({"prompt": prompt, **kw})
        if raises:
            raise raises
        return NS(text=replies[len(calls) - 1], est_cost_usd=0.001, model="nemotron-test")

    chat_fn.calls = calls
    return chat_fn


def test_good_rules_on_the_first_call():
    fake = _fake(json.dumps(GOOD))
    res = ap.plan_assist("put the green cube in the yellow bin; mind the blue one", PLAN, chat_fn=fake)
    assert res.source == "nemotron" and res.calls == 1 and res.errors == []
    assert res.zones.zone("release:left_bin@nemotron").floor == pytest.approx(0.09 + 0.015 + 0.02)
    assert res.zones.zone("keep_out:blue@nemotron").floor == pytest.approx(0.06 + 0.02)
    prompt = fake.calls[0]["prompt"]
    assert "put the green cube" in prompt and "left_bin" in prompt and "blue" in prompt
    assert fake.calls[0]["system"] == ap.SYSTEM_PROMPT


def test_problems_go_back_and_the_model_can_fix_them():
    fake = _fake(json.dumps(BAD), json.dumps(GOOD))
    res = ap.plan_assist("x", PLAN, chat_fn=fake)
    assert res.source == "nemotron" and res.calls == 2
    second = fake.calls[1]["prompt"]
    assert "pink_bin" in second and "no object" in second and "isn't a placement target" in second
    assert res.attempts[0]["errors"] and res.attempts[1]["errors"] == []


def test_three_failed_calls_fall_back_to_the_rules_and_keep_the_errors():
    fake = _fake(*[json.dumps(BAD)] * 3)
    res = ap.plan_assist("x", PLAN, chat_fn=fake)
    assert res.calls == 3 and res.source == "rules"
    assert res.rules.notes == "rules fallback (no Nemotron)"
    assert "never validated" in res.fallback_reason and res.errors
    assert res.zones.source == "geometry"  # the fallback here adds no floors: a 9 cm stack is under TALL_STACK_M


def test_nemotron_errors_and_nemotron_off_use_the_rules():
    res = ap.plan_assist("x", PLAN, chat_fn=_fake(raises=RuntimeError("connection refused")))
    assert res.source == "rules" and "RuntimeError" in res.fallback_reason and res.calls == 1
    off = ap.plan_assist("x", PLAN, chat_fn=None)
    assert off.source == "rules" and off.calls == 0 and "off" in off.fallback_reason


def test_the_system_prompt_states_the_bounds_the_validator_checks():
    for needle in ("release_clearance_m", "keep_out_clearance_m", "speed_cap_mps", "0 to 5 cm", "0.02 to 0.5", "0.18", "JSON"):
        assert needle in ap.SYSTEM_PROMPT


def test_a_nemotron_plan_without_the_tall_stack_cap_still_gets_it():
    tall = ScenePlan.model_validate({**json.loads(PLAN.model_dump_json()), "objects": [
        *json.loads(PLAN.model_dump_json())["objects"],
        {"id": "white", "kind": "cube", "color": "white", "size": 0.04, "on": "green"}]})
    res = ap.plan_assist("put the green cube in the yellow bin; careful with the tall pile", tall,
                         chat_fn=_fake(json.dumps({"targets": [{"object": "left_bin", "release_clearance_m": 0.015}]})))
    assert res.source == "nemotron" and res.calls == 1
    slow = res.zones.zone("slow:red@rules")  # red + green + white = 13 cm: the rules' cap, under Nemotron's rules
    assert slow.speed_cap == 0.1 and slow.source == "rules"
    assert [o.object for o in res.floor_rules.obstacles] == ["red"]


# --- the CLI ---------------------------------------------------------------------------------------------

def _script():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "assist_zones.py"
    spec = importlib.util.spec_from_file_location("assist_zones", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_cli_plans_zones_for_a_plan_file_and_saves_them(tmp_path, capsys):
    plan = tmp_path / "p.json"
    plan.write_text(PLAN.model_dump_json(), encoding="utf-8")
    out = tmp_path / "zones.json"
    assert _script().main([str(plan), "--text", "green into the yellow bin", "--out", str(out)], chat_fn=_fake(json.dumps(GOOD))) == 0
    printed = capsys.readouterr().out
    assert "source: nemotron" in printed and "release:left_bin" in printed
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert saved["zones"]["source"] == "nemotron" and saved["rules"]["targets"][0]["object"] == "left_bin"


def test_cli_rules_only_and_a_scene_creator_file(tmp_path, capsys):
    doc = tmp_path / "scene.json"
    doc.write_text(json.dumps({"id": "s", "text": "a stack and a bin", "plan": json.loads(PLAN.model_dump_json())}), encoding="utf-8")
    assert _script().main([str(doc), "--rules-only"], chat_fn=None) == 0
    printed = capsys.readouterr().out
    assert "source: rules" in printed and "bin:left_bin" in printed
