"""demo_pipeline.scene_plan: the ScenePlan schema (a scene in words -> objects, goals, reach) and its code validator."""
from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from demo_pipeline import scene_geometry as geo
from demo_pipeline import scene_plan as sp
from demo_pipeline.multiply import SCENE_RANGES
from demo_pipeline.schemas import Pose, Scene


def _yaw_q(deg):
    r = math.radians(deg)
    return (math.cos(r / 2), 0.0, 0.0, math.sin(r / 2))


def _plan(objects, goals, **kw):
    return sp.ScenePlan.model_validate({"objects": objects, "goals": goals, **kw})


def _cube(id, x=None, y=None, on=None, color="red", size=0.05, yaw=0.0):
    d = {"id": id, "kind": "cube", "color": color, "size": size}
    if x is not None:
        d["pose"] = {"x": x, "y": y, "yaw_deg": yaw}
    if on is not None:
        d["on"] = on
    return d


def _bin(id, x, y, color="blue", inner=(0.2, 0.2, 0.08), yaw=0.0):
    return {"id": id, "kind": "bin", "color": color, "inner": list(inner), "pose": {"x": x, "y": y, "yaw_deg": yaw}}


TWO_BINS_PILE = [
    _bin("bin_left", 0.55, 0.20), _bin("bin_right", 0.55, -0.20, color="green"),
    _cube("cube_blue", 0.45, 0.0, color="blue"), _cube("cube_green", on="cube_blue", color="green"),
    _cube("cube_red", on="cube_green", color="red"),
]


# --- today's scene ---------------------------------------------------------------------------------

def test_todays_scene_round_trips_through_a_plan():
    scene = Scene(cube_pose=Pose(pos=(0.46, 0.13, geo.CUBE_HALF), quat_wxyz=_yaw_q(-81.0)),
                  bin_pose=Pose(pos=(0.41, -0.23, 0.0), quat_wxyz=_yaw_q(12.0)), robot="franka", seed=3000)
    plan = sp.ScenePlan.from_scene(scene)
    cube, box = plan.object("cube"), plan.object("bin")
    assert (cube.size, cube.color) == (geo.CUBE_SIZE, "red")
    assert (tuple(box.inner), box.color) == (geo.BIN_INNER, "blue")
    assert plan.goals == [sp.Goal(object="cube", bin="bin")]
    assert sp.validate_plan(plan) == []
    back = plan.to_scene(seed=3000)
    assert back.robot == "franka" and back.seed == 3000
    for got, want in ((back.cube_pose, scene.cube_pose), (back.bin_pose, scene.bin_pose)):
        assert got.pos == pytest.approx(want.pos, abs=1e-12)
        assert got.quat_wxyz == pytest.approx(want.quat_wxyz, abs=1e-12)


def test_the_default_plan_uses_the_scene_geometry_numbers_and_the_franka_ranges():
    plan = sp.ScenePlan.default()
    placed = sp.resolve(plan)
    assert placed["cube"].pos[2] == pytest.approx(geo.CUBE_HALF) and placed["bin"].pos[2] == 0.0
    r = SCENE_RANGES["franka"]
    assert plan.reach.x == (min(r.cube_x[0], r.bin_x[0]), max(r.cube_x[1], r.bin_x[1]))
    assert plan.reach.y == (min(r.cube_y[0], r.bin_y[0]), max(r.cube_y[1], r.bin_y[1]))
    assert sp.validate_plan(plan) == []


def test_to_scene_needs_exactly_one_cube_and_one_bin():
    with pytest.raises(ValueError, match="one cube and one bin"):
        _plan(TWO_BINS_PILE, [{"object": "cube_red", "bin": "bin_left"}]).to_scene(seed=0)


def test_from_scene_refuses_a_tilted_cube():
    tilted = Scene(cube_pose=Pose(pos=(0.5, 0, 0.025), quat_wxyz=(0.9238795, 0.3826834, 0, 0)),
                   bin_pose=Pose(pos=(0.5, -0.25, 0), quat_wxyz=(1, 0, 0, 0)), robot="franka", seed=0)
    with pytest.raises(ValueError, match="yaw"):
        sp.ScenePlan.from_scene(tilted)


# --- schema --------------------------------------------------------------------------------------

def test_schema_rejects_insane_sizes_unknown_fields_and_bad_ids():
    with pytest.raises(ValidationError):
        _plan([_cube("c", 0.5, 0.0, size=0.2), _bin("b", 0.5, -0.25)], [{"object": "c", "bin": "b"}])
    with pytest.raises(ValidationError):
        _plan([_bin("b", 0.5, -0.25, inner=(0.2, 0.2, 0.5)), _cube("c", 0.5, 0.0)], [{"object": "c", "bin": "b"}])
    with pytest.raises(ValidationError):
        _plan([{**_cube("c", 0.5, 0.0), "mass": 3}, _bin("b", 0.5, -0.25)], [{"object": "c", "bin": "b"}])
    with pytest.raises(ValidationError):
        _plan([_cube("Big Cube", 0.5, 0.0), _bin("b", 0.5, -0.25)], [{"object": "Big Cube", "bin": "b"}])
    with pytest.raises(ValidationError):
        _plan([_cube("c", 0.5, 0.0, color="chartreuse"), _bin("b", 0.5, -0.25)], [{"object": "c", "bin": "b"}])


def test_schema_needs_a_pose_or_a_support_and_unique_ids():
    with pytest.raises(ValidationError, match="pose"):
        _plan([_cube("c"), _bin("b", 0.5, -0.25)], [{"object": "c", "bin": "b"}])
    with pytest.raises(ValidationError, match="unique"):
        _plan([_cube("c", 0.5, 0.0), _cube("c", 0.4, 0.1), _bin("b", 0.5, -0.25)], [{"object": "c", "bin": "b"}])
    with pytest.raises(ValidationError):
        _plan([_cube("c", 0.5, 0.0), _bin("b", 0.5, -0.25)], [])  # a scene needs a task


# --- resolve -------------------------------------------------------------------------------------

def test_a_pile_stacks_up_from_the_table():
    placed = sp.resolve(_plan(TWO_BINS_PILE, [{"object": "cube_red", "bin": "bin_left"}]))
    assert placed["cube_blue"].pos == pytest.approx((0.45, 0.0, 0.025))
    assert placed["cube_green"].pos == pytest.approx((0.45, 0.0, 0.075))
    assert placed["cube_red"].pos == pytest.approx((0.45, 0.0, 0.125))
    assert placed["cube_red"].support == "cube_green" and placed["cube_blue"].support is None


# --- validator -----------------------------------------------------------------------------------

def _errors(objects, goals):
    return sp.validate_plan(_plan(objects, goals))


def test_the_example_sentence_scene_is_valid():
    assert _errors(TWO_BINS_PILE, [{"object": "cube_red", "bin": "bin_left"}]) == []


def test_out_of_reach_is_named_with_the_limits():
    errs = _errors([_cube("c", 0.5, 0.0), _bin("b", 0.55, -0.45)], [{"object": "c", "bin": "b"}])
    assert len(errs) == 1 and "b" in errs[0] and "reach" in errs[0] and "-0.45" in errs[0]


def test_overlaps_and_tight_gaps_are_errors():
    errs = _errors([_cube("c", 0.55, -0.10), _bin("b", 0.55, -0.20)], [{"object": "c", "bin": "b"}])
    assert any("overlap" in e for e in errs)
    # the bin's outside edge is at y -0.09; a cube edge at -0.075 leaves 1.5 cm, under the 3 cm finger room
    errs = _errors([_cube("c", 0.55, -0.05), _bin("b", 0.55, -0.20)], [{"object": "c", "bin": "b"}])
    assert any("1.5 cm apart" in e for e in errs)
    assert _errors([_cube("c", 0.55, -0.03), _bin("b", 0.55, -0.20)], [{"object": "c", "bin": "b"}]) == []


def test_overlap_errors_say_where_each_footprint_is():
    # what Nemotron needs to move things apart: each footprint's extent on the table
    errs = _errors([_cube("c", 0.55, -0.10), _bin("b", 0.55, -0.20)], [{"object": "c", "bin": "b"}])
    assert "c covers x 0.525 to 0.575, y -0.125 to -0.075" in errs[0]
    assert "b covers x 0.440 to 0.660, y -0.310 to -0.090" in errs[0]


def test_overlap_errors_suggest_the_smallest_move_that_stays_in_reach():
    # Nemotron's failed 3-bin row: the cube can't go nearer the robot (x >= 0.40) or past the bin's side (y >= -0.30),
    # so the fix is the bin, 6.5 cm farther out
    objects = [_bin("bin_red", 0.50, -0.25), _cube("cube_red", 0.40, -0.30)]
    errs = _errors(objects, [{"object": "cube_red", "bin": "bin_red"}])
    assert len(errs) == 1 and "smallest fix: move bin_red to x 0.565 (+6.5 cm)" in errs[0]
    objects = [_cube("c", 0.55, -0.05), _bin("b", 0.55, -0.20)]  # 1.5 cm apart: move the cube 1.5 cm left
    assert "smallest fix: move c to y -0.035 (+1.5 cm)" in _errors(objects, [{"object": "c", "bin": "b"}])[0]
    fixed = [_bin("bin_red", 0.565, -0.25), _cube("cube_red", 0.40, -0.30)]
    assert _errors(fixed, [{"object": "cube_red", "bin": "bin_red"}]) == []


def test_a_squeezed_row_moves_the_outer_objects_out():
    # Nemotron's 3-bin row 20 cm apart: the middle bin clashes with both, so the hints move the outer ones
    row = [_bin("bin_red", 0.615, -0.2), _bin("bin_green", 0.615, 0.0), _bin("bin_blue", 0.615, 0.2)]
    cubes = [_cube("c", 0.45, 0.0)]
    errs = _errors(row + cubes, [{"object": "c", "bin": "bin_green"}])
    assert len(errs) == 2
    assert "smallest fix: move bin_red to y -0.250 (-5.0 cm)" in errs[0]
    assert "smallest fix: move bin_blue to y 0.250 (+5.0 cm)" in errs[1]


def test_a_gap_of_exactly_the_minimum_passes():
    # three 22 cm bins 25 cm apart leave exactly 3 cm between them (float error must not fail it)
    row = [_bin(f"b{i}", 0.60, y, color=c) for i, (y, c) in enumerate(((-0.25, "red"), (0.0, "green"), (0.25, "blue")))]
    cubes = [_cube(f"c{i}", 0.42, y, color=c) for i, (y, c) in enumerate(((-0.25, "red"), (0.0, "green"), (0.25, "blue")))]
    assert _errors(row + cubes, [{"object": f"c{i}", "bin": f"b{i}"} for i in range(3)]) == []


def test_rotated_footprints_are_checked_as_rotated():
    # a 45-degree bin's corner reaches sqrt(2) * 0.11 = 0.156 m from its centre along y
    objects = [_cube("c", 0.55, -0.02), _bin("b", 0.55, -0.20, yaw=45.0)]
    assert any("c" in e and "b" in e for e in _errors(objects, [{"object": "c", "bin": "b"}]))
    assert _errors([_cube("c", 0.55, -0.02), _bin("b", 0.55, -0.20)], [{"object": "c", "bin": "b"}]) == []


def test_stacks_must_be_centred_supported_by_cubes_and_short_enough():
    off = [_bin("b", 0.55, -0.2), _cube("c1", 0.45, 0.05), {**_cube("c2", 0.47, 0.05), "on": "c1"}]
    errs = _errors(off, [{"object": "c2", "bin": "b"}])
    assert any("2.0 cm off the centre of c1" in e for e in errs)
    on_bin = [_bin("b", 0.55, -0.2), _cube("c", on="b")]
    assert any("only on cubes" in e for e in _errors(on_bin, [{"object": "c", "bin": "b"}]))
    ghost = [_bin("b", 0.55, -0.2), _cube("c", on="nothing")]
    assert any("nothing" in e and "no object" in e for e in _errors(ghost, [{"object": "c", "bin": "b"}]))
    loop = [_bin("b", 0.55, -0.2), _cube("c1", on="c2"), _cube("c2", on="c1")]
    assert any("loop" in e for e in _errors(loop, [{"object": "c1", "bin": "b"}]))
    tower = [_bin("b", 0.55, -0.2), _cube("c0", 0.45, 0.05)] + [_cube(f"c{i}", on=f"c{i - 1}") for i in range(1, 6)]
    tall = [e for e in _errors(tower, [{"object": "c5", "bin": "b"}]) if "too tall" in e]
    assert len(tall) == 1 and "under c5" in tall[0] and "its 6 cubes" in tall[0]
    assert "to keep all 6 cubes, make each at most 4.1 cm" in tall[0]  # 0.25 m / 6 = 4.17 cm, floored to the mm
    two_on_one = [_bin("b", 0.55, -0.2), _cube("c0", 0.45, 0.05), _cube("c1", on="c0"), _cube("c2", on="c0")]
    assert any("c1 and c2 both sit on c0" in e for e in _errors(two_on_one, [{"object": "c1", "bin": "b"}]))


def test_goals_must_name_real_cubes_and_bins_in_a_doable_order():
    base = [_bin("b", 0.55, -0.2), _cube("c", 0.45, 0.1)]
    assert any("no object 'x'" in e for e in _errors(base, [{"object": "x", "bin": "b"}]))
    assert any("not a bin" in e for e in _errors(base, [{"object": "c", "bin": "c"}]))
    assert any("not a cube" in e for e in _errors(base, [{"object": "b", "bin": "b"}]))
    assert any("more than once" in e for e in _errors(base, [{"object": "c", "bin": "b"}] * 2))
    pile = TWO_BINS_PILE
    errs = _errors(pile, [{"object": "cube_blue", "bin": "bin_left"}])
    assert any("cube_green is still on top" in e for e in errs)
    assert _errors(pile, [{"object": "cube_red", "bin": "bin_left"}, {"object": "cube_green", "bin": "bin_right"},
                          {"object": "cube_blue", "bin": "bin_left"}]) == []


def test_a_cube_must_fit_the_bin():
    small_bin = [_bin("b", 0.55, -0.2, inner=(0.10, 0.10, 0.08)), _cube("c", 0.45, 0.1, size=0.07)]
    assert _errors(small_bin, [{"object": "c", "bin": "b"}]) == []
    tiny = [_bin("b", 0.55, -0.2, inner=(0.10, 0.10, 0.08))] + [_cube(f"c{i}", 0.42, 0.06 * i - 0.05, size=0.05)
                                                                 for i in range(3)]
    errs = _errors(tiny, [{"object": f"c{i}", "bin": "b"} for i in range(3)])
    assert any("3 cubes" in e and "holds 1" in e for e in errs)
