"""Isaac side of "Bring your robot": the uploaded URDF -> USD (Isaac Lab UrdfConverter, cached in the robot's usd/
folder) and the robot's part of the pick-place scene (articulation, contact sensors). Needs a running Isaac app.

The converter re-converts only when the URDF's bytes or the converter settings change (its .asset_hash record), so
the first evaluate of a robot pays for the conversion and later ones reuse it.
"""

from __future__ import annotations

import re
from pathlib import Path

import isaaclab.sim as sim_utils
from isaaclab.actuators import ImplicitActuatorCfg
from isaaclab.assets.articulation import ArticulationCfg
from isaaclab.sim.converters import UrdfConverter, UrdfConverterCfg
from isaaclab_physx.sim.schemas import PhysxArticulationCfg, PhysxRigidBodyCfg

from .byor_report import actuator_groups
from .robots import RobotSpec
from .urdf_import import parse_urdf

USD_NAME = "robot.usd"


def converter_cfg(spec: RobotSpec) -> UrdfConverterCfg:
    if spec.urdf_path is None or spec.usd_dir is None:
        raise ValueError(f"{spec.name} is not an uploaded robot (no urdf_path / usd_dir)")
    return UrdfConverterCfg(
        asset_path=str(spec.urdf_path),
        usd_dir=str(spec.usd_dir),
        usd_file_name=USD_NAME,
        fix_base=True,
        merge_fixed_joints=True,  # build_spec's ik_link assumes the hand is merged into the last arm link
        collision_type="Convex Hull",
        self_collision=False,
        ros_package_paths=[{"name": n, "path": p} for n, p in spec.ros_packages],
        physics_variant="physx",
    )


def convert(spec: RobotSpec) -> tuple[str, bool]:
    """(USD path, reused): converts the URDF unless the cached USD in spec.usd_dir is for the same bytes + settings."""
    cfg = converter_cfg(spec)
    record = Path(cfg.usd_dir) / ".asset_hash"
    before = record.read_bytes() if record.is_file() else None
    usd = UrdfConverter(cfg).usd_path
    return usd, before is not None and record.read_bytes() == before


def body_prims(usd_path: str, names) -> dict[str, str]:
    """Body name -> its prim path under the robot's root prim, read from the converted USD (rigid bodies only)."""
    from pxr import Usd, UsdPhysics

    stage = Usd.Stage.Open(usd_path)
    root = stage.GetDefaultPrim()
    vsets = root.GetVariantSets()
    if vsets.HasVariantSet("Physics"):
        vsets.GetVariantSet("Physics").SetVariantSelection("physx")
    found: dict[str, str] = {}
    for prim in Usd.PrimRange(root, Usd.TraverseInstanceProxies()):
        if prim.GetName() in names and prim.HasAPI(UsdPhysics.RigidBodyAPI):
            found.setdefault(prim.GetName(), str(prim.GetPath())[len(str(root.GetPath())) + 1:])
    missing = [n for n in names if n not in found]
    if missing:
        raise RuntimeError(f"bodies {', '.join(missing)} are not rigid bodies in {usd_path} "
                           f"(found: {', '.join(sorted(found)) or 'none'})")
    return found


def robot_cfg(spec: RobotSpec, usd_path: str) -> ArticulationCfg:
    u = parse_urdf(Path(spec.urdf_path).read_text(encoding="utf-8", errors="replace"))
    actuators = {}
    for name, g in actuator_groups(u, spec, list(spec.arm_joint_names)).items():
        actuators[name] = ImplicitActuatorCfg(
            joint_names_expr=[re.escape(j) for j in g["joints"]], stiffness=g["stiffness"], damping=g["damping"],
            joint_effort_limit=g["effort"], joint_velocity_limit=g["velocity"])
    return ArticulationCfg(
        prim_path="{ENV_REGEX_NS}/Robot",
        spawn=sim_utils.UsdFileCfg(
            usd_path=usd_path,
            activate_contact_sensors=False,
            rigid_props=PhysxRigidBodyCfg(disable_gravity=True, max_depenetration_velocity=5.0),
            articulation_props=[PhysxArticulationCfg(enabled_self_collisions=False, solver_position_iteration_count=8,
                                                     solver_velocity_iteration_count=0)],
        ),
        init_state=ArticulationCfg.InitialStateCfg(pos=tuple(spec.base_pos), joint_pos=dict(spec.init_joint_pos or {})),
        actuators=actuators,
        soft_joint_pos_limit_factor=1.0,
    )


def use_uploaded(cfg, spec: RobotSpec, contacts) -> None:
    """Put the uploaded robot into a PickPlaceSceneCfg: `contacts(prim, filters)` makes a contact sensor cfg."""
    from .scene_cfg import BIN_PARTS, BIN_PRIMS

    usd, _ = convert(spec)
    paths = body_prims(usd, list(dict.fromkeys(spec.arm_links + spec.finger_links)))
    cfg.robot = robot_cfg(spec, usd)
    prefix = "{ENV_REGEX_NS}/Robot/"
    fingers = [prefix + paths[n] for n in spec.finger_links]
    arm_bodies = [prefix + paths[n] for n in spec.arm_links]
    cfg.cube_contact = contacts("Cube", fingers)
    cfg.table_contact = contacts("Table", arm_bodies)
    for name in BIN_PARTS:
        setattr(cfg, f"{name}_contact", contacts(BIN_PRIMS[name], arm_bodies))
