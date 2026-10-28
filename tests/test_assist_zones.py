"""demo_pipeline.soft_floor's assist zones: the soft floor for every support surface of a scene (the table, each bin's
rim rule at its own size and yaw, the top of a cube that is a placement target), and today's single bin + table giving
exactly today's soft floor."""

from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.scene_geometry import BIN_INNER, BIN_WALL, TABLE_TOP_Z
from demo_pipeline.scene_plan import ScenePlan
from demo_pipeline.schemas import Pose, Scene
from demo_pipeline.soft_floor import (
    FLOOR_BELOW_RIM, FOOTPRINT_MARGIN, AssistZones, Zone, clamp_to_floor, floor_z, zones_for_plan, zones_for_scene,
)

IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _yaw(rad):
    return (math.cos(rad / 2), 0.0, 0.0, math.sin(rad / 2))


@pytest.mark.parametrize("bin_pose", [Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), Pose(pos=(0.55, -0.2, 0.0), quat_wxyz=_yaw(0.6))])
def test_todays_bin_and_table_give_exactly_todays_soft_floor(bin_pose):
    scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY), bin_pose=bin_pose, robot="franka", seed=0)
    zones = zones_for_scene(scene)
    rng = np.random.default_rng(3)
    pts = np.column_stack([rng.uniform(0.2, 0.8, 600), rng.uniform(-0.5, 0.5, 600), rng.uniform(-0.05, 0.2, 600)])
    for p in pts:
        assert zones.floor_at(p) == floor_z(p, bin_pose)
        pos, held, _zone = zones.clamp(p)
        assert (pos, held) == clamp_to_floor(p, bin_pose)


def _plan() -> ScenePlan:
    return ScenePlan.model_validate({
        "objects": [
            {"id": "red", "kind": "cube", "color": "red", "pose": {"x": 0.45, "y": -0.1}},
            {"id": "green", "kind": "cube", "color": "green", "size": 0.04, "on": "red"},
            {"id": "blue", "kind": "cube", "color": "blue", "size": 0.06, "pose": {"x": 0.55, "y": 0.05}},
            {"id": "left_bin", "kind": "bin", "color": "yellow", "inner": [0.22, 0.18, 0.06], "pose": {"x": 0.5, "y": 0.28, "yaw_deg": 90}},
            {"id": "right_bin", "kind": "bin", "color": "purple", "pose": {"x": 0.5, "y": -0.28}},
        ],
        "goals": [{"object": "green", "bin": "left_bin"}, {"object": "red", "bin": "right_bin"}],
    })


def test_a_plan_gets_the_table_and_every_bins_rim_rule_at_its_own_size_and_yaw():
    zones = zones_for_plan(_plan())
    assert [z.id for z in zones.zones] == ["bin:left_bin", "bin:right_bin"]
    left = zones.zone("bin:left_bin")
    assert left.floor == pytest.approx(BIN_WALL + 0.06 - FLOOR_BELOW_RIM)
    # Turned 90 degrees: its 0.22 m side runs along world y.
    assert left.half == pytest.approx((0.22 / 2 + BIN_WALL + FOOTPRINT_MARGIN, 0.18 / 2 + BIN_WALL + FOOTPRINT_MARGIN))
    assert zones.floor_at((0.5, 0.28 + 0.12, 0.0)) == pytest.approx(left.floor)  # along the long side, still inside
    assert zones.floor_at((0.5 + 0.125, 0.28, 0.0)) == TABLE_TOP_Z  # across the short side, outside
    right = zones.zone("bin:right_bin")
    assert right.floor == pytest.approx(BIN_WALL + BIN_INNER[2] - FLOOR_BELOW_RIM)
    assert zones.floor_at((0.3, 0.0, 0.0)) == TABLE_TOP_Z


def test_a_cube_that_is_a_placement_target_gets_a_floor_on_its_top():
    zones = zones_for_plan(_plan(), cube_targets=["blue"])
    top = zones.zone("top:blue")
    # The held cube rests on it: the tool (the held cube's centre) stops half the largest moved cube (red, 5 cm) above
    # blue's top.
    assert top.floor == pytest.approx(0.06 + 0.05 / 2)
    assert top.half == pytest.approx((0.03 + FOOTPRINT_MARGIN,) * 2)
    assert zones.floor_at((0.55, 0.05, 0.0)) == pytest.approx(top.floor)
    with pytest.raises(ValueError, match="not a cube"):
        zones_for_plan(_plan(), cube_targets=["left_bin"])


def test_floors_combine_by_the_highest_and_clamp_says_which_zone_held():
    a = Zone("a", "bin", (0.0, 0.0), 0.0, (0.1, 0.1), 0.05)
    b = Zone("b", "keep_out", (0.05, 0.0), 0.0, (0.1, 0.1), 0.12, source="nemotron")
    zones = AssistZones((a, b), source="nemotron")
    assert zones.floor_at((0.0, 0.0, 0.0)) == 0.12 and zones.floor_at((-0.08, 0.0, 0.0)) == 0.05
    pos, held, zone = zones.clamp((0.0, 0.0, 0.01))
    assert held and pos == (0.0, 0.0, 0.12) and zone == "b"
    assert zones.clamp((0.0, 0.0, 0.3)) == ((0.0, 0.0, 0.3), False, None)


def test_speed_caps_are_the_slowest_zone_covering_the_point():
    slow = Zone("s", "slow", (0.0, 0.0), 0.0, (0.1, 0.1), TABLE_TOP_Z, speed_cap=0.1)
    slower = Zone("t", "slow", (0.05, 0.0), 0.0, (0.05, 0.05), TABLE_TOP_Z, speed_cap=0.05)
    zones = AssistZones((slow, slower))
    assert zones.speed_cap_at((-0.05, 0.0, 0.1)) == 0.1 and zones.speed_cap_at((0.06, 0.0, 0.1)) == 0.05
    assert zones.speed_cap_at((0.5, 0.5, 0.1)) is None


def test_zones_serialize_for_the_demo_label():
    d = zones_for_plan(_plan()).to_dict()
    assert d["source"] == "geometry" and d["table_z"] == TABLE_TOP_Z
    assert d["zones"][0] == {"id": "bin:left_bin", "kind": "bin", "center": [0.5, 0.28], "yaw": pytest.approx(math.pi / 2),
                             "half": [pytest.approx(0.14), pytest.approx(0.12)], "floor": pytest.approx(0.06), "source": "geometry",
                             "speed_cap": None}
    assert AssistZones.from_dict(d) == zones_for_plan(_plan())
