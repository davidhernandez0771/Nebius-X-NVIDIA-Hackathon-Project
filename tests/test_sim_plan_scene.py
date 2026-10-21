"""sim_worker.plan_scene: a ScenePlan's Isaac scene config (Isaac's python without the app; skipped elsewhere).

Run where Isaac Lab imports, e.g.:
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe -m pytest --noconftest tests\\test_sim_plan_scene.py
"""

from __future__ import annotations

import pytest

pytest.importorskip("isaaclab")
pytest.importorskip("isaaclab_assets")

from demo_pipeline.scene_plan import ScenePlan  # noqa: E402
from demo_pipeline.schemas import Pose, Scene  # noqa: E402
from sim_worker.plan_scene import make_plan_scene_cfg  # noqa: E402
from sim_worker.scene_cfg import BIN_PART_NAMES, make_scene_cfg  # noqa: E402

TODAY = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot="franka", seed=0)


@pytest.mark.parametrize("robot", ["franka", "flexiv", "openarm"])
@pytest.mark.parametrize("cameras", [False, True])
def test_todays_plan_builds_exactly_todays_scene_config(robot, cameras):
    today = make_scene_cfg(cameras=cameras, robot=robot)
    built, lay = make_plan_scene_cfg(ScenePlan.from_scene(TODAY), cameras=cameras, robot=robot)
    assert lay.legacy
    for name in ("cube", "cube_contact", "table", "table_contact", *BIN_PART_NAMES, *(f"{n}_contact" for n in BIN_PART_NAMES)):
        assert getattr(built, name) == getattr(today, name), name
    assert vars(built).keys() == vars(today).keys()
    assert built == today


def test_a_multi_object_plan_has_a_body_and_a_sensor_per_cube_and_bin_box():
    plan = ScenePlan.model_validate({
        "objects": [
            {"id": "red", "kind": "cube", "color": "red", "pose": {"x": 0.45, "y": -0.1}},
            {"id": "green", "kind": "cube", "color": "green", "size": 0.04, "on": "red"},
            {"id": "left_bin", "kind": "bin", "color": "yellow", "pose": {"x": 0.5, "y": 0.25, "yaw_deg": 30}},
        ],
        "goals": [{"object": "green", "bin": "left_bin"}, {"object": "red", "bin": "left_bin"}],
    })
    cfg, lay = make_plan_scene_cfg(plan, cameras=False)
    today = make_scene_cfg(cameras=False)
    assert cfg.cube is None and cfg.bin_floor is None and cfg.cube_contact is None
    green = cfg.cube_green
    assert green.prim_path.endswith("/Cube_green") and green.spawn.size == (0.04, 0.04, 0.04)
    assert green.init_state.pos == pytest.approx(lay.cube("green").pos)
    assert cfg.cube_green_contact.filter_prim_paths_expr == today.cube_contact.filter_prim_paths_expr
    assert cfg.bin_left_bin_floor_contact.filter_prim_paths_expr == today.table_contact.filter_prim_paths_expr
    assert cfg.bin_left_bin_wall_px.spawn.rigid_props.kinematic_enabled
