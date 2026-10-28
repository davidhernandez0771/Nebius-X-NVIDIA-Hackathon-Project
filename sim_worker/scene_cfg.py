"""Pick-place scene for Isaac Lab 3.0: Franka (high PD), red cube, blue open-top bin, table, two cameras.

Isaac Lab 3.0 config quaternions are (x, y, z, w); demo_pipeline uses (w, x, y, z). Convert at the boundary.

Contacts: PhysX filtered contact reporting needs ONE sensing body per environment, so the sensors sit
on the cube (filtered against the two fingers) and on the table and each bin wall (filtered against
the robot links), rather than on every robot link.
"""

from __future__ import annotations

import isaaclab.sim as sim_utils
from isaaclab.assets import AssetBaseCfg, RigidObjectCfg
from isaaclab.scene import InteractiveSceneCfg
from isaaclab.sensors import CameraCfg, ContactSensorCfg
from isaaclab.utils import configclass, replace

from isaaclab_assets import FRANKA_PANDA_HIGH_PD_CFG  # isort:skip
from isaaclab_assets.robots.flexiv import FLEXIV_RIZON4S_CFG, FLEXIV_RIZON4S_GRAV_GRIPPER_CFG  # isort:skip
from isaaclab_assets.robots.openarm import OPENARM_UNI_HIGH_PD_CFG  # isort:skip

from demo_pipeline.scene_geometry import BIN_INNER, BIN_WALL, CUBE_SIZE  # noqa: F401 (BIN_INNER, BIN_WALL: re-exported)

from .robots import robot_spec
# The scene's numbers live in scene_parts (no Isaac imports); re-exported here under their old names.
from .scene_parts import (  # noqa: F401
    ARM_CONTACT_SENSORS, BIN_PART_NAMES, BIN_PARTS, BIN_PRIMS, BIN_RIM_Z, BLUE, CUBE_MASS, CUBE_SPAWN_XY, FRONT_EYE,
    FRONT_TARGET, RED, TABLE_CENTER, TABLE_COLOR, TABLE_SIZE,
)

IMAGE_SIZE = 128

# The 3.0 Franka USD nests each body under its parent; PhysX filter patterns are globs, not regexes,
# so spell out full paths (probed on 2026-10-15).
_LINKS = ["panda_link0"]
for _i in range(1, 8):
    _LINKS.append(f"{_LINKS[-1]}/panda_link{_i}")
HAND = "{ENV_REGEX_NS}/Robot/Geometry/" + _LINKS[-1] + "/panda_hand"
FINGERS = [HAND + "/panda_leftfinger", HAND + "/panda_rightfinger"]
# Every moving robot body; panda_link0 is bolted to the world and excluded.
ARM_BODIES = ["{ENV_REGEX_NS}/Robot/Geometry/" + p for p in _LINKS[1:]] + [HAND] + FINGERS

# OpenArm unimanual bodies are flat under Robot/ (probed 2026-10-16); openarm_link0 is the fixed base.
OPENARM_HAND = "{ENV_REGEX_NS}/Robot/openarm_hand"
OPENARM_FINGERS = ["{ENV_REGEX_NS}/Robot/openarm_left_finger", "{ENV_REGEX_NS}/Robot/openarm_right_finger"]
OPENARM_ARM_BODIES = (
    [f"{{ENV_REGEX_NS}}/Robot/openarm_link{i}" for i in range(1, 8)] + [OPENARM_HAND] + OPENARM_FINGERS
)


def _kinematic_box(prim: str, size, pos, color) -> RigidObjectCfg:
    return RigidObjectCfg(
        prim_path="{ENV_REGEX_NS}/" + prim,
        spawn=sim_utils.CuboidCfg(
            size=size,
            rigid_props=sim_utils.UsdPhysicsRigidBodyCfg(kinematic_enabled=True),
            collision_props=sim_utils.UsdPhysicsCollisionCfg(),
            visual_material=sim_utils.PreviewSurfaceCfg(diffuse_color=color),
            activate_contact_sensors=True,
        ),
        init_state=RigidObjectCfg.InitialStateCfg(pos=pos),
    )


def _contacts(prim: str, filters: list[str]) -> ContactSensorCfg:
    return ContactSensorCfg(
        prim_path="{ENV_REGEX_NS}/" + prim, update_period=0.0, history_length=2, filter_prim_paths_expr=filters
    )


@configclass
class PickPlaceSceneCfg(InteractiveSceneCfg):
    ground = AssetBaseCfg(
        prim_path="/World/defaultGroundPlane",
        spawn=sim_utils.GroundPlaneCfg(),
        init_state=AssetBaseCfg.InitialStateCfg(pos=(0.0, 0.0, -0.8)),
    )
    dome_light = AssetBaseCfg(
        prim_path="/World/Light", spawn=sim_utils.DomeLightCfg(intensity=3000.0, color=(0.75, 0.75, 0.75))
    )

    robot = replace(FRANKA_PANDA_HIGH_PD_CFG, prim_path="{ENV_REGEX_NS}/Robot")
    robot.spawn.variants["Physics"] = "physx"

    table = _kinematic_box("Table", TABLE_SIZE, TABLE_CENTER, TABLE_COLOR)
    cube = RigidObjectCfg(
        prim_path="{ENV_REGEX_NS}/Cube",
        spawn=sim_utils.CuboidCfg(
            size=(CUBE_SIZE,) * 3,
            rigid_props=sim_utils.UsdPhysicsRigidBodyCfg(),
            mass_props=sim_utils.MassPropertiesCfg(mass=CUBE_MASS),
            collision_props=sim_utils.UsdPhysicsCollisionCfg(),
            physics_material=sim_utils.RigidBodyMaterialCfg(static_friction=1.0, dynamic_friction=1.0),
            visual_material=sim_utils.PreviewSurfaceCfg(diffuse_color=RED),
            activate_contact_sensors=True,
        ),
        init_state=RigidObjectCfg.InitialStateCfg(pos=(*CUBE_SPAWN_XY, CUBE_SIZE / 2)),
    )
    bin_floor = _kinematic_box("BinFloor", *BIN_PARTS["bin_floor"], BLUE)
    bin_wall_px = _kinematic_box("BinWallPX", *BIN_PARTS["bin_wall_px"], BLUE)
    bin_wall_nx = _kinematic_box("BinWallNX", *BIN_PARTS["bin_wall_nx"], BLUE)
    bin_wall_py = _kinematic_box("BinWallPY", *BIN_PARTS["bin_wall_py"], BLUE)
    bin_wall_ny = _kinematic_box("BinWallNY", *BIN_PARTS["bin_wall_ny"], BLUE)

    cube_contact = _contacts("Cube", FINGERS)
    table_contact = _contacts("Table", ARM_BODIES)
    bin_floor_contact = _contacts("BinFloor", ARM_BODIES)
    bin_wall_px_contact = _contacts("BinWallPX", ARM_BODIES)
    bin_wall_nx_contact = _contacts("BinWallNX", ARM_BODIES)
    bin_wall_py_contact = _contacts("BinWallPY", ARM_BODIES)
    bin_wall_ny_contact = _contacts("BinWallNY", ARM_BODIES)

    front = CameraCfg(
        prim_path="{ENV_REGEX_NS}/front_cam",
        update_period=0.0,
        height=IMAGE_SIZE,
        width=IMAGE_SIZE,
        data_types=["rgb"],
        spawn=sim_utils.PinholeCameraCfg(
            focal_length=24.0, focus_distance=400.0, horizontal_aperture=20.955, clipping_range=(0.05, 10.0)
        ),
    )
    # copied from Isaac Lab 3.0's Franka stack visuomotor config
    wrist = CameraCfg(
        prim_path=HAND + "/wrist_cam",
        update_period=0.0,
        height=IMAGE_SIZE,
        width=IMAGE_SIZE,
        data_types=["rgb"],
        spawn=sim_utils.PinholeCameraCfg(
            focal_length=24.0, focus_distance=400.0, horizontal_aperture=20.955, clipping_range=(0.05, 2.0)
        ),
        offset=CameraCfg.OffsetCfg(pos=(0.13, 0.0, -0.15), rot=(0.03701, 0.03701, -0.70614, -0.70614), convention="ros"),
    )



# Flexiv Rizon 4s + Grav bodies (probed 2026-10-16): arm links flat under Robot/, gripper under Robot/Grav_gripper/.
_GRAV = "{ENV_REGEX_NS}/Robot/Grav_gripper/"
FLEXIV_FINGERS = [_GRAV + n for n in ("left_finger_tip", "right_finger_tip", "left_finger_mount", "right_finger_mount")]
FLEXIV_ARM_BODIES = (
    [f"{{ENV_REGEX_NS}}/Robot/link{i}" for i in range(1, 8)] + ["{ENV_REGEX_NS}/Robot/flange"]
    + [_GRAV + n for n in ("gripper_base", "left_outer_knuckle", "left_inner_knuckle", "right_inner_knuckle",
                           "right_outer_knuckle")] + FLEXIV_FINGERS
)


def grav_gripper_joints(finger: float) -> dict[str, float]:
    """All 6 Grav joints for one finger_joint value (mimic gearing as in Isaac Lab's Rizon gear-assembly task)."""
    joints = {n: finger for n in ("finger_joint", "left_inner_knuckle_joint", "right_inner_knuckle_joint",
                                  "right_outer_knuckle_joint")}
    joints.update({n: -finger for n in ("left_outer_finger_joint", "right_outer_finger_joint")})
    return joints


def _use_flexiv(cfg: PickPlaceSceneCfg) -> None:
    spec = robot_spec("flexiv")
    init = FLEXIV_RIZON4S_GRAV_GRIPPER_CFG.init_state
    cfg.robot = replace(
        FLEXIV_RIZON4S_GRAV_GRIPPER_CFG,
        prim_path="{ENV_REGEX_NS}/Robot",
        init_state=replace(init, pos=spec.base_pos, joint_pos={**init.joint_pos, **grav_gripper_joints(spec.gripper_open)}),
    )
    # like the *_HIGH_PD configs used for diff-IK: no gravity sag on the arm (the cube keeps its gravity)
    cfg.robot.spawn.rigid_props.disable_gravity = True
    # Measured (T2 note, sprint 3 Task 3): with the gripper variant's soft arm gains the arm lags 21 mm (max 73)
    # while holding the cube (the Grav finger bodies weigh ~0.1 g, so the grip contact is solver-stiff and drags);
    # the asset's own bare-arm gains cut that to 4.0 mm (max 18.6) on the base scene.
    for group in ("shoulder", "elbow", "wrist"):
        cfg.robot.actuators[group] = replace(cfg.robot.actuators[group],
                                             stiffness=FLEXIV_RIZON4S_CFG.actuators[group].stiffness,
                                             damping=FLEXIV_RIZON4S_CFG.actuators[group].damping)
    cfg.cube_contact = _contacts("Cube", FLEXIV_FINGERS)
    cfg.table_contact = _contacts("Table", FLEXIV_ARM_BODIES)
    for name in BIN_PARTS:
        setattr(cfg, f"{name}_contact", _contacts(BIN_PRIMS[name], FLEXIV_ARM_BODIES))
    if cfg.wrist is not None:  # Franka's offset, on link7; not checked visually
        cfg.wrist = replace(cfg.wrist, prim_path="{ENV_REGEX_NS}/Robot/link7/wrist_cam")


def _use_openarm(cfg: PickPlaceSceneCfg) -> None:
    spec = robot_spec("openarm")
    init = OPENARM_UNI_HIGH_PD_CFG.init_state
    cfg.robot = replace(
        OPENARM_UNI_HIGH_PD_CFG,
        prim_path="{ENV_REGEX_NS}/Robot",
        init_state=replace(init, pos=spec.base_pos, joint_pos=spec.init_joint_pos or init.joint_pos),
    )
    cfg.cube_contact = _contacts("Cube", OPENARM_FINGERS)
    cfg.table_contact = _contacts("Table", OPENARM_ARM_BODIES)
    for name in BIN_PARTS:
        setattr(cfg, f"{name}_contact", _contacts(BIN_PRIMS[name], OPENARM_ARM_BODIES))
    if cfg.wrist is not None:
        cfg.wrist = replace(cfg.wrist, prim_path=OPENARM_HAND + "/wrist_cam")


def make_scene_cfg(cameras: bool, robot: str = "franka") -> PickPlaceSceneCfg:
    cfg = PickPlaceSceneCfg(num_envs=1, env_spacing=3.0)
    if robot == "openarm":
        _use_openarm(cfg)
    elif robot == "flexiv":
        _use_flexiv(cfg)
    elif robot != "franka":
        try:
            spec = robot_spec(robot)
        except KeyError:
            raise ValueError(f"no sim scene for robot {robot!r}") from None
        from .byor_scene import use_uploaded  # an uploaded URDF ("Bring your robot"), registered by the caller

        use_uploaded(cfg, spec, _contacts)
    if not cameras:
        cfg.front = None
        cfg.wrist = None
    return cfg
