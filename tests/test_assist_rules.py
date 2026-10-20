"""demo_pipeline.assist_rules: the semantic assist rules (placement targets, release clearances, keep-outs, speed caps)
for a ScenePlan, validated by code, the rules-only fallback, and the zones they add on top of the geometric floor."""

from __future__ import annotations

import pytest

from demo_pipeline.assist_rules import (
    CLEARANCE_RANGE, FALLBACK_SPEED, KEEP_OUT_RANGE, SPEED_RANGE, AssistRules, parse_rules, rules_fallback, validate_rules, zones_from_rules,
)
from demo_pipeline.scene_plan import ScenePlan
from demo_pipeline.soft_floor import FOOTPRINT_MARGIN, zones_for_plan


def _plan() -> ScenePlan:
    return ScenePlan.model_validate({
        "objects": [
            {"id": "red", "kind": "cube", "color": "red", "pose": {"x": 0.45, "y": -0.1}},
            {"id": "green", "kind": "cube", "color": "green", "size": 0.04, "on": "red"},
            {"id": "white", "kind": "cube", "color": "white", "size": 0.04, "on": "green"},
            {"id": "blue", "kind": "cube", "color": "blue", "size": 0.06, "pose": {"x": 0.58, "y": 0.05}},
            {"id": "left_bin", "kind": "bin", "color": "yellow", "pose": {"x": 0.5, "y": 0.25}},
            {"id": "right_bin", "kind": "bin", "color": "purple", "pose": {"x": 0.5, "y": -0.28}},
        ],
        "goals": [{"object": "white", "bin": "left_bin"}, {"object": "green", "bin": "left_bin"}],
    })


def _rules(**kw) -> AssistRules:
    base = {"targets": [{"object": "left_bin", "release_clearance_m": 0.015}], "obstacles": []}
    base.update(kw)
    return AssistRules.model_validate(base)


def test_good_rules_pass():
    assert validate_rules(_plan(), _rules()) == []


def test_unknown_ids_and_wrong_kinds_are_named():
    errs = validate_rules(_plan(), _rules(targets=[{"object": "pink_bin"}, {"object": "left_bin"}], obstacles=[{"object": "ghost", "speed_cap_mps": 0.1}]))
    assert any("pink_bin" in e and "no object" in e for e in errs)
    assert any("ghost" in e and "no object" in e for e in errs)


def test_every_goal_bin_must_be_a_target():
    errs = validate_rules(_plan(), _rules(targets=[{"object": "right_bin"}]))
    assert any("goal 1 puts white into left_bin, but left_bin isn't a placement target" in e for e in errs)


@pytest.mark.parametrize("value", [-0.01, 0.2])
def test_clearances_must_be_sane(value):
    errs = validate_rules(_plan(), _rules(targets=[{"object": "left_bin", "release_clearance_m": value}]))
    assert any(f"{CLEARANCE_RANGE[0] * 100:.0f} to {CLEARANCE_RANGE[1] * 100:.0f} cm" in e for e in errs)


def test_a_negative_clearance_would_be_weaker_than_the_soft_floor():
    errs = validate_rules(_plan(), _rules(targets=[{"object": "left_bin", "release_clearance_m": -0.01}]))
    assert any("lower than the soft floor" in e for e in errs)


def test_a_release_clearance_must_not_force_a_high_release():
    # check_success fails a release with the cube's centre over 0.18 m above the bin origin (high_release).
    errs = validate_rules(_plan(), _rules(targets=[{"object": "left_bin", "release_clearance_m": 0.049}]))
    assert errs == []  # rim 0.09 + 0.049 + 0.02 (half of a 4 cm cube) = 0.159
    tall = ScenePlan.model_validate({**_plan().model_dump(), "objects": [
        *_plan().model_dump()["objects"][:4], {"id": "left_bin", "kind": "bin", "color": "yellow", "inner": [0.2, 0.2, 0.12], "pose": {"x": 0.5, "y": 0.25}},
        _plan().model_dump()["objects"][5]]})
    errs = validate_rules(tall, _rules(targets=[{"object": "left_bin", "release_clearance_m": 0.045}]))
    assert any("high release" in e for e in errs)


def test_a_cube_that_a_goal_moves_cannot_be_a_keep_out_or_a_target():
    errs = validate_rules(_plan(), _rules(obstacles=[{"object": "green", "keep_out_clearance_m": 0.02}]))
    assert any("green is moved by goal 2" in e for e in errs)
    errs = validate_rules(_plan(), _rules(targets=[{"object": "left_bin"}, {"object": "white"}]))
    assert any("white is moved by goal 1" in e for e in errs)


def test_obstacle_bounds_and_duplicates():
    errs = validate_rules(_plan(), _rules(obstacles=[{"object": "blue", "speed_cap_mps": 5.0}, {"object": "blue", "keep_out_clearance_m": 0.5}]))
    assert any(f"{SPEED_RANGE[0]} to {SPEED_RANGE[1]} m/s" in e for e in errs)
    assert any(f"0 to {KEEP_OUT_RANGE[1] * 100:.0f} cm" in e for e in errs)
    assert any("blue is listed twice" in e for e in errs)
    errs = validate_rules(_plan(), _rules(obstacles=[{"object": "blue"}]))
    assert any("blue: an obstacle needs a keep-out clearance, a speed cap, or both" in e for e in errs)


def test_parse_takes_the_outermost_json_and_reports_schema_errors():
    rules = parse_rules('Here: {"targets": [{"object": "left_bin"}], "obstacles": []} done')
    assert rules.targets[0].object == "left_bin"
    with pytest.raises(ValueError, match="no JSON"):
        parse_rules("nothing here")
    with pytest.raises(ValueError, match="targets"):
        parse_rules('{"obstacles": []}')


def test_the_rules_fallback_targets_the_goal_bins_and_slows_near_tall_stacks():
    rules = rules_fallback(_plan())
    assert [t.object for t in rules.targets] == ["left_bin"]
    assert rules.targets[0].release_clearance_m is None  # geometry only: today's rim rule
    # red + green + white stand 0.13 m tall: a speed cap near the stack, no keep-out (its cubes are moved).
    assert [(o.object, o.speed_cap_mps, o.keep_out_clearance_m) for o in rules.obstacles] == [("red", 0.1, None)]
    assert validate_rules(_plan(), rules) == []


def test_rules_only_add_to_the_geometric_floor():
    plan = _plan()
    geo = zones_for_plan(plan)
    zones = zones_from_rules(plan, _rules(obstacles=[{"object": "blue", "keep_out_clearance_m": 0.02, "speed_cap_mps": 0.1}]), source="nemotron")
    assert zones.source == "nemotron"
    # Every geometric zone is still there, unchanged; semantic ones come on top.
    assert set(geo.zones) <= set(zones.zones)
    release = zones.zone("release:left_bin@nemotron")
    assert release.floor == pytest.approx(0.09 + 0.015 + 0.02)  # rim + clearance + half the largest cube going in
    keep = zones.zone("keep_out:blue@nemotron")
    assert keep.floor == pytest.approx(0.06 + 0.02) and keep.half == pytest.approx((0.03 + FOOTPRINT_MARGIN,) * 2)
    assert zones.speed_cap_at((0.58, 0.05, 0.1)) == 0.1
    for x in (0.4, 0.45, 0.5, 0.58):
        for y in (-0.28, -0.1, 0.05, 0.25):
            assert zones.floor_at((x, y, 0)) >= geo.floor_at((x, y, 0))


def test_a_cube_target_gets_its_top_floor():
    zones = zones_from_rules(_plan(), _rules(targets=[{"object": "left_bin"}, {"object": "blue", "release_clearance_m": 0.005}]), source="rules")
    assert zones.zone("top:blue").floor == pytest.approx(0.06 + 0.04 / 2)  # rests on it: the largest cube is 6 cm, held ones 4 cm
    assert zones.zone("release:blue@rules").floor == pytest.approx(0.06 + 0.005 + 0.02)


def test_the_rules_floor_stays_under_nemotrons_rules():
    # Nemotron's rules leave out the tall stack's speed cap; the rules' protections are a floor under them, not a fallback.
    plan, floor = _plan(), rules_fallback(_plan())
    zones = zones_from_rules(plan, _rules(), source="nemotron", floor=floor)
    slow = zones.zone("slow:red@rules")
    assert slow.source == "rules" and slow.speed_cap == FALLBACK_SPEED
    assert zones.speed_cap_at((0.45, -0.1, 0.2)) == FALLBACK_SPEED
    assert zones.zone("release:left_bin@nemotron").source == "nemotron" and zones.source == "nemotron"
    # Both layers go into the label, each zone with its source.
    sources = {z["id"]: z["source"] for z in zones.to_dict()["zones"]}
    assert sources["slow:red@rules"] == "rules" and sources["release:left_bin@nemotron"] == "nemotron"
    assert sources["bin:left_bin"] == "geometry"


@pytest.mark.parametrize("cap, active", [(0.3, FALLBACK_SPEED), (0.05, 0.05)])
def test_nemotron_can_only_tighten_the_rules_floor(cap, active):
    plan = _plan()
    zones = zones_from_rules(plan, _rules(obstacles=[{"object": "red", "speed_cap_mps": cap}]), source="nemotron",
                             floor=rules_fallback(plan))
    assert zones.speed_cap_at((0.45, -0.1, 0.2)) == active
    without_floor = zones_from_rules(plan, _rules(obstacles=[{"object": "red", "speed_cap_mps": cap}]), source="nemotron")
    for x in (0.4, 0.45, 0.5, 0.58):
        for y in (-0.28, -0.1, 0.05, 0.25):
            assert zones.floor_at((x, y, 0)) >= without_floor.floor_at((x, y, 0))
