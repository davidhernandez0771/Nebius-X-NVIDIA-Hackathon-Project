"""sim_worker.plan_layout: a ScenePlan as the Isaac scene's bodies (pure; no Isaac).

Today's one cube + one bin plan gives exactly today's bodies: the names, prims, sizes, colours, mass, spawn points,
contact sensors and placement poses scene_cfg.py and placement.py use.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from demo_pipeline.goals import Container
from demo_pipeline.scene_geometry import BIN_INNER, BIN_WALL, CUBE_SIZE
from demo_pipeline.scene_plan import ScenePlan, validate_plan
from demo_pipeline.schemas import Pose, Scene
from sim_worker import scene_parts as P
from sim_worker.plan_layout import cube_mass, layout_for_plan, layout_for_scene

YAW = 0.4
SCENES = [
    Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=0),
    Scene(cube_pose=Pose(pos=(0.45, -0.1, 0.025), quat_wxyz=(math.cos(0.3), 0, 0, math.sin(0.3))),
          bin_pose=Pose(pos=(0.6, 0.2, 0.0), quat_wxyz=(math.cos(YAW / 2), 0, 0, math.sin(YAW / 2))), robot="franka", seed=3),
]


def _yaw_rotate(q, v):
    """placement.yaw_rotate (that module imports torch)."""
    w, x, y, z = q
    rot = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])
    return rot @ np.asarray(v, dtype=float)


@pytest.mark.parametrize("scene", SCENES)
def test_todays_plan_is_todays_scene(scene):
    lay = layout_for_plan(ScenePlan.from_scene(scene))
    assert lay.legacy
    # scene_cfg.py's bodies: the cube and the five bin boxes, with their prims.
    assert [b.name for b in lay.bodies] == ["cube", *P.BIN_PART_NAMES]
    assert [b.prim for b in lay.bodies] == ["Cube", *(P.BIN_PRIMS[n] for n in P.BIN_PART_NAMES)]
    cube = lay.body("cube")
    assert cube.size == (CUBE_SIZE,) * 3 and cube.color == P.RED and cube.mass == P.CUBE_MASS and cube.dynamic
    assert cube.spawn == (*P.CUBE_SPAWN_XY, CUBE_SIZE / 2)
    assert cube.contact == "cube_contact" and cube.contact_filter == "fingers"
    for n in P.BIN_PART_NAMES:
        b = lay.body(n)
        size, centre = P.BIN_PARTS[n]
        assert (b.size, b.spawn, b.color, b.dynamic, b.mass) == (size, centre, P.BLUE, False, None)
        assert (b.contact, b.contact_filter) == (f"{n}_contact", "arm")
    assert lay.arm_contact_sensors() == P.ARM_CONTACT_SENSORS
    # placement.py's poses at reset.
    assert cube.pos == pytest.approx(scene.cube_pose.pos) and cube.quat_wxyz == pytest.approx(scene.cube_pose.quat_wxyz)
    bp = scene.bin_pose
    for n in P.BIN_PART_NAMES:
        b = lay.body(n)
        assert b.pos == pytest.approx(tuple(np.asarray(bp.pos) + _yaw_rotate(bp.quat_wxyz, P.BIN_PARTS[n][1])))
        assert b.quat_wxyz == pytest.approx(bp.quat_wxyz)
    # The plan path goes through degrees and back: identical but for float rounding in the poses.
    direct = layout_for_scene(scene)
    assert lay.legacy == direct.legacy and len(lay.bodies) == len(direct.bodies)
    for a, b in zip(lay.bodies, direct.bodies):
        assert (a.name, a.prim, a.kind, a.size, a.color, a.mass, a.spawn, a.contact) == (b.name, b.prim, b.kind, b.size, b.color, b.mass, b.spawn, b.contact)
        assert a.pos == pytest.approx(b.pos, abs=1e-12) and a.quat_wxyz == pytest.approx(b.quat_wxyz, abs=1e-12)


def _three_two() -> ScenePlan:
    return ScenePlan.model_validate({
        "objects": [
            {"id": "red", "kind": "cube", "color": "red", "pose": {"x": 0.45, "y": -0.1}},
            {"id": "green", "kind": "cube", "color": "green", "size": 0.04, "on": "red"},
            {"id": "blue", "kind": "cube", "color": "blue", "size": 0.06, "pose": {"x": 0.55, "y": 0.05, "yaw_deg": 30}},
            {"id": "left_bin", "kind": "bin", "color": "yellow", "inner": [0.22, 0.18, 0.06], "pose": {"x": 0.5, "y": 0.28, "yaw_deg": 90}},
            {"id": "right_bin", "kind": "bin", "color": "purple", "pose": {"x": 0.5, "y": -0.28}},
        ],
        "goals": [{"object": "green", "bin": "left_bin"}, {"object": "red", "bin": "right_bin"}, {"object": "blue", "bin": "left_bin"}],
    })


def test_a_multi_object_plan_gets_a_body_per_cube_and_five_per_bin():
    lay = layout_for_plan(_three_two())
    assert not lay.legacy
    assert lay.cube_ids() == ["red", "green", "blue"]
    assert lay.bin_ids() == ["left_bin", "right_bin"]
    assert len(lay.bodies) == 3 + 2 * 5
    names = [b.name for b in lay.bodies]
    prims = [b.prim for b in lay.bodies]
    assert len(set(names)) == len(names) and len(set(prims)) == len(prims)
    assert all(n.isidentifier() for n in names)
    assert lay.body("cube_red").prim == "Cube_red"
    assert lay.body("bin_left_bin_floor").prim == "Bin_left_bin_Floor"


def test_stacks_sizes_colours_and_masses_follow_the_plan():
    lay = layout_for_plan(_three_two())
    red, green, blue = (lay.cube(i) for i in ("red", "green", "blue"))
    assert red.pos == pytest.approx((0.45, -0.1, 0.025))
    assert green.pos == pytest.approx((0.45, -0.1, 0.05 + 0.02))  # on red's top
    assert green.size == (0.04,) * 3 and green.color == pytest.approx((0.1, 0.7, 0.15))
    assert blue.quat_wxyz == pytest.approx((math.cos(math.radians(15)), 0, 0, math.sin(math.radians(15))))
    # Same density as today's cube: mass goes with the volume.
    assert cube_mass(CUBE_SIZE) == P.CUBE_MASS
    assert blue.mass == pytest.approx(P.CUBE_MASS * (0.06 / CUBE_SIZE) ** 3)
    # A plan's bodies spawn where they will stand, so nothing overlaps before placement.
    assert all(b.spawn == pytest.approx(b.pos) for b in lay.bodies)


def test_a_bins_boxes_follow_its_size_and_yaw():
    lay = layout_for_plan(_three_two())
    floor = lay.body("bin_left_bin_floor")
    assert floor.size == pytest.approx((0.22 + 2 * BIN_WALL, 0.18 + 2 * BIN_WALL, BIN_WALL))
    px = lay.body("bin_left_bin_wall_px")
    # +x wall of a bin turned 90 degrees: it ends up on the bin's +y side in the world.
    assert px.pos == pytest.approx((0.5, 0.28 + (0.22 + BIN_WALL) / 2, BIN_WALL + 0.06 / 2))
    assert px.size == pytest.approx((BIN_WALL, 0.18 + 2 * BIN_WALL, 0.06))


def test_contact_sensors_cover_every_cube_and_every_bin_box():
    lay = layout_for_plan(_three_two())
    assert [lay.cube(c).contact for c in lay.cube_ids()] == ["cube_red_contact", "cube_green_contact", "cube_blue_contact"]
    arm = lay.arm_contact_sensors()
    assert arm["table"] == ("table_contact",)
    assert len(arm["bin"]) == 10 and "bin_right_bin_wall_ny_contact" in arm["bin"]


def test_containers_for_the_goal_checker():
    lay = layout_for_plan(_three_two())
    c = lay.containers()
    assert set(c) == {"left_bin", "right_bin"}
    assert isinstance(c["left_bin"], Container) and c["left_bin"].inner == (0.22, 0.18, 0.06)
    assert c["left_bin"].pose.quat_wxyz == pytest.approx((math.cos(math.radians(45)), 0, 0, math.sin(math.radians(45))))
    assert layout_for_scene(SCENES[0]).containers()["bin"].inner == BIN_INNER


def test_the_example_plan_is_valid():
    assert validate_plan(_three_two()) == []


def test_a_plan_the_validator_rejects_is_not_built():
    data = _three_two().model_dump()
    data["objects"][2]["pose"] = {"x": 0.46, "y": -0.1, "yaw_deg": 0}  # blue on top of red's place
    with pytest.raises(ValueError, match="overlap"):
        layout_for_plan(ScenePlan.model_validate(data))
