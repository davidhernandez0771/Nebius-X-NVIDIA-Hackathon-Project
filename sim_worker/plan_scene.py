"""A ScenePlan's scene in Isaac Lab 3.0: its cubes and bins (plan_layout.SceneLayout) in the pick-place scene config,
placed at reset, and the settle check's physics run. Needs Isaac (inside launch_simulation, like replay.py).

make_plan_scene_cfg() starts from make_scene_cfg() (the robot, table, cameras and, per robot, the finger and arm
contact filters) and puts the plan's bodies in place of today's cube and bin. Each cube is today's cube config with
its own size, colour, mass and prim; each bin box is today's kinematic box. Today's one cube + one bin plan keeps
today's names and values, so its config is today's (tests/test_sim_plan_scene.py, run in Isaac's python).
"""

from __future__ import annotations

import numpy as np

import isaaclab.sim as sim_utils
from isaaclab.utils import instantiate, replace

from demo_pipeline.scene_plan import ScenePlan

from .placement import place_layout, xyzw
from .plan_layout import SceneLayout, layout_for_plan
from .scene_cfg import BIN_PART_NAMES, PickPlaceSceneCfg, _contacts, _kinematic_box, make_scene_cfg
from .settle import SETTLE_S, settle_errors


def _wxyz(q_xyzw) -> tuple[float, float, float, float]:
    x, y, z, w = (float(v) for v in q_xyzw)
    return (w, x, y, z)


def make_plan_scene_cfg(plan: ScenePlan, cameras: bool, robot: str = "franka") -> tuple[PickPlaceSceneCfg, SceneLayout]:
    """The scene config for a plan, and its layout (for placement and recording)."""
    lay = layout_for_plan(plan)
    cfg = make_scene_cfg(cameras=cameras, robot=robot)
    fingers = list(cfg.cube_contact.filter_prim_paths_expr)  # this robot's fingers
    arm = list(cfg.table_contact.filter_prim_paths_expr)  # this robot's moving bodies
    template = cfg.cube
    # Today's cube and bin go; the plan's bodies take their place (the same names when it is today's scene).
    for name in ("cube", *BIN_PART_NAMES):
        setattr(cfg, name, None)
        setattr(cfg, f"{name}_contact", None)
    for b in lay.bodies:
        if b.kind == "cube":
            spawn = replace(
                template.spawn, size=b.size, mass_props=replace(template.spawn.mass_props, mass=b.mass),
                visual_material=replace(template.spawn.visual_material, diffuse_color=b.color),
            )
            init = replace(template.init_state, pos=b.spawn)
            if not lay.legacy:
                init = replace(init, rot=tuple(xyzw(b.quat_wxyz)))
            setattr(cfg, b.name, replace(template, prim_path="{ENV_REGEX_NS}/" + b.prim, spawn=spawn, init_state=init))
            setattr(cfg, b.contact, _contacts(b.prim, fingers))
        else:
            box = _kinematic_box(b.prim, b.size, b.spawn, b.color)
            if not lay.legacy:
                box = replace(box, init_state=replace(box.init_state, rot=tuple(xyzw(b.quat_wxyz))))
            setattr(cfg, b.name, box)
            setattr(cfg, b.contact, _contacts(b.prim, arm))
    return cfg, lay


def read_cube_poses(sim_scene, lay: SceneLayout) -> dict[str, tuple]:
    """Every cube's pose now: plan id -> (position in the env frame, wxyz)."""
    origin = sim_scene.env_origins[0].cpu().numpy().astype(np.float64)
    out = {}
    for c in lay.cube_ids():
        pose = sim_scene[lay.cube(c).name].data.root_pose_w.torch[0].cpu().numpy().astype(np.float64)
        out[c] = (tuple(pose[0:3] - origin), _wxyz(pose[3:7]))
    return out


def settle_plan(plan: ScenePlan, *, robot: str = "franka", physics_dt: float = 0.01, screenshot: bool = False,
                device: str = "cuda:0") -> dict:
    """Build the plan, place it, hold the robot at its default pose and let physics run SETTLE_S. Returns
    {"errors": settle_errors(...), "moved": {id: metres}, "before", "after", "image" (front camera, RGB uint8,
    when screenshot)}. One plan per process: Isaac builds one scene per SimulationContext."""
    sim = sim_utils.SimulationContext(sim_utils.SimulationCfg(dt=physics_dt, device=device))
    cfg, lay = make_plan_scene_cfg(plan, cameras=screenshot, robot=robot)
    scene = instantiate(cfg)
    sim.reset()
    place_layout(scene, lay, aim_front_camera=screenshot)
    before = {c: (lay.cube(c).pos, lay.cube(c).quat_wxyz) for c in lay.cube_ids()}
    robot_ = scene["robot"]
    hold = robot_.data.default_joint_pos.torch.clone()
    for _ in range(int(round(SETTLE_S / physics_dt))):
        robot_.set_joint_position_target_index(target=hold)
        scene.write_data_to_sim()
        sim.step()
        scene.update(physics_dt)
    after = read_cube_poses(scene, lay)
    out = {
        "errors": settle_errors(plan, before, after),
        "moved": {c: float(np.linalg.norm(np.asarray(after[c][0]) - np.asarray(before[c][0]))) for c in before},
        "before": {c: [list(p), list(q)] for c, (p, q) in before.items()},
        "after": {c: [list(p), list(q)] for c, (p, q) in after.items()},
    }
    if screenshot:
        for _ in range(5):  # the camera needs a few rendered frames (replay.CAMERA_WARMUP_STEPS)
            robot_.set_joint_position_target_index(target=hold)
            scene.write_data_to_sim()
            sim.step()
            scene.update(physics_dt)
        out["image"] = scene["front"].data.output["rgb"].torch[0, ..., :3].cpu().numpy().astype(np.uint8)
    return out

