"""The Record page's scene library (demo_pipeline.scene_library): stored ScenePlans under DATA_DIR/scenes, the plan
hash each demo saves, which plans need the Isaac settle check, and the 8 ready-made plans for the recording protocol."""

from __future__ import annotations

import json
import math

import pytest

from demo_pipeline.scene_geometry import BIN_INNER, CUBE_SIZE
from demo_pipeline.scene_library import (
    PROTOCOL_IDS,
    STANDARD_SCENE,
    STANDARD_ID,
    SceneEntry,
    SceneLibrary,
    needs_settle,
    plan_hash,
    protocol_entries,
    standard_plan,
)
from demo_pipeline.scene_plan import ScenePlan, resolve, robot_reach, validate_plan


def by_id():
    return {e.id: e for e in protocol_entries()}


# --- the 8 protocol plans --------------------------------------------------------------------------

def test_there_are_eight_and_every_one_passes_the_validator():
    entries = protocol_entries()
    assert [e.id for e in entries] == list(PROTOCOL_IDS) == ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]
    for e in entries:
        assert validate_plan(e.plan) == [], e.id
        assert e.name.startswith(e.id.upper() + " ")


def test_s1_is_todays_standard_scene():
    assert by_id()["s1"].plan == standard_plan() == ScenePlan.from_scene(STANDARD_SCENE)
    # the live sink's scene: where every recorded demo had the cube and the bin
    assert STANDARD_SCENE.cube_pose.pos == (0.5, 0.0, 0.025) and STANDARD_SCENE.bin_pose.pos == (0.5, 0.3, 0.0)


def test_s2_puts_the_cube_near_the_edge_of_reach():
    plan, reach = by_id()["s2"].plan, robot_reach("franka")
    cube = resolve(plan)["cube"].pos
    margin = min(cube[0] - reach.x[0], reach.x[1] - cube[0], cube[1] - reach.y[0], reach.y[1] - cube[1])
    assert margin <= 0.03  # within 3 cm of the envelope's edge


def test_s3_turns_the_bin_90_degrees_on_the_other_side():
    std, s3 = standard_plan().object("bin").pose, by_id()["s3"].plan.object("bin").pose
    assert abs(s3.yaw_deg) == 90 and math.copysign(1, s3.y) != math.copysign(1, std.y)


@pytest.mark.parametrize("sid, size", [("s4", 0.04), ("s5", 0.06)])
def test_s4_and_s5_change_the_cube_size(sid, size):
    assert by_id()[sid].plan.object("cube").size == size


def test_s6_yaws_the_cube_35_degrees():
    assert by_id()["s6"].plan.object("cube").pose.yaw_deg == 35


def test_s7_adds_a_yellow_distractor_and_the_goal_stays_red_into_the_bin():
    plan = by_id()["s7"].plan
    cubes = {o.id: o.color for o in plan.objects if o.kind == "cube"}
    assert cubes == {"cube": "red", "distractor": "yellow"}
    assert [(g.object, g.bin) for g in plan.goals] == [("cube", "bin")]
    gap = math.dist(resolve(plan)["cube"].pos[:2], resolve(plan)["distractor"].pos[:2])
    assert gap < 0.12  # next to it


def test_s8_has_a_taller_bin():
    inner = by_id()["s8"].plan.object("bin").inner
    assert inner[2] > BIN_INNER[2] and inner[:2] == BIN_INNER[:2]


def test_only_plans_with_new_bodies_need_the_settle_check():
    flags = {e.id: e.needs_settle for e in protocol_entries()}
    assert flags == {"s1": False, "s2": False, "s3": False, "s4": True, "s5": True, "s6": False, "s7": True, "s8": True}
    assert all(e.needs_settle == needs_settle(e.plan) for e in protocol_entries())


# --- the plan hash ---------------------------------------------------------------------------------

def test_the_hash_is_stable_and_follows_the_plan():
    a = standard_plan()
    b = ScenePlan.model_validate_json(json.dumps(json.loads(a.model_dump_json()), sort_keys=True))  # other key order
    assert plan_hash(a) == plan_hash(b) and len(plan_hash(a)) == 16
    moved = by_id()["s6"].plan
    assert plan_hash(moved) != plan_hash(a)


# --- the library on disk ---------------------------------------------------------------------------

def test_standard_is_always_there_first_and_seeding_writes_the_protocol(tmp_path):
    lib = SceneLibrary(tmp_path)
    assert [e.id for e in lib.list()] == [STANDARD_ID]
    assert lib.get(STANDARD_ID).plan == standard_plan() and not lib.get(STANDARD_ID).needs_settle
    assert lib.seed_protocol() == list(PROTOCOL_IDS)
    assert [e.id for e in lib.list()] == [STANDARD_ID, *PROTOCOL_IDS]
    assert (tmp_path / "scenes" / "s7.json").is_file()


def test_seeding_again_never_overwrites(tmp_path):
    lib = SceneLibrary(tmp_path)
    lib.seed_protocol()
    path = tmp_path / "scenes" / "s1.json"
    edited = json.loads(path.read_text(encoding="utf-8"))
    edited["description"] = "the user's own words"
    path.write_text(json.dumps(edited), encoding="utf-8")
    assert lib.seed_protocol() == []
    assert lib.get("s1").description == "the user's own words"


def test_save_a_new_plan_and_read_it_back(tmp_path):
    lib = SceneLibrary(tmp_path)
    plan = by_id()["s7"].plan
    entry = lib.save(name="Two cubes", description="from a sentence", plan=plan, source="nemotron")
    assert entry.id.startswith("two_cubes_") and entry.hash == plan_hash(plan) and entry.needs_settle
    assert lib.get(entry.id) == entry
    assert lib.save(name="Two cubes", description="again", plan=plan, source="nemotron").id == entry.id  # same plan


def test_save_refuses_a_plan_the_validator_fails(tmp_path):
    plan = by_id()["s7"].plan.model_copy(deep=True)
    plan.objects[1].pose.x = plan.objects[0].pose.x  # the distractor on top of the red cube's footprint
    plan.objects[1].pose.y = plan.objects[0].pose.y
    with pytest.raises(ValueError, match="overlap"):
        SceneLibrary(tmp_path).save(name="bad", description="", plan=plan, source="nemotron")


def test_unknown_or_unsafe_ids_are_not_found(tmp_path):
    lib = SceneLibrary(tmp_path)
    for bad in ("nope", "../x", "S1", ""):
        with pytest.raises(KeyError):
            lib.get(bad)


def test_the_settle_result_is_kept_with_the_entry(tmp_path):
    lib = SceneLibrary(tmp_path)
    lib.seed_protocol()
    lib.record_settle("s8", ok=False, errors=["cube moved 2.1 cm"])
    entry = lib.get("s8")
    assert entry.settle is not None and entry.settle.ok is False and entry.settle.errors == ["cube moved 2.1 cm"]
    assert entry.settle.hash == entry.hash  # for this exact plan


def test_an_entry_round_trips_as_json():
    e = by_id()["s5"]
    assert SceneEntry.model_validate_json(e.model_dump_json()) == e
    assert e.plan.object("cube").size == 0.06 and CUBE_SIZE == 0.05
