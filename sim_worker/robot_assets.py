"""The open robot descriptions downloaded to C:\\dev\\assets\\robots (see its SOURCES.md) as data for the site's robot
wall, the forest and the catalog: each robot's arm chain (joints, limits, axes), the meshes per link with their
offsets, scales, formats, triangle counts and sizes, a rest pose, and specs computed from the chain (DoF, reach).

Untrusted data: the files are read as text or bytes only. Nothing from them is executed or imported, xacro is never
run, and XML is only read with ElementTree (sim_worker.urdf_import) or regular expressions.

Plain URDFs (SO-101, PiPER, OpenArm's generated example) go through sim_worker.urdf_import.parse_urdf. For the
xacro-only robots (Franka, UR5e, xArm6) the chain is built from the YAML files their xacro loads (kinematics, joint
limits, visual parameters) plus the few literal values in the xacro that the YAML doesn't hold (axes, fixed frames,
the hand's mount, xArm's position limits), into the same Urdf dataclasses, so forward kinematics
(sim_worker.urdf_kin) is one code path for all.

Reach: the largest distance from the shoulder (the frame of the arm's second joint) to the flange (the last arm
link), over random joint configurations within the limits (fixed seed) refined by coordinate search. Vendors' own
brochure figures measure differently (UR quotes 850 mm for the UR5e; this gives 0.97 m to the flange), so only compare
reaches made the same way. Payload is never invented: none of the six repos states one.
"""

from __future__ import annotations

import functools
import json
import math
import os
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml

from .urdf_import import Geometry, Joint, Limits, Link, Mimic, Origin, Urdf, parse_urdf
from .urdf_kin import link_pose

ASSETS = Path(os.environ.get("SANT_ROBOT_ASSETS", r"C:\dev\assets\robots"))
SEED = 7
SAMPLES = 1500  # random starts; the coordinate search then climbs to the maximum
WALL_TRIS_PER_ROBOT = 15_000  # 7 arms x 15k = ~105k tris on the wall (target ~50-150k total)


# --- mesh files: format, triangles, unit, up axis ------------------------------------------------------------

def mesh_info(path: Path) -> dict:
    """Triangle count (STL binary/ASCII, Collada triangles/polylist/polygons), Collada unit and up axis, size."""
    path = Path(path)
    data = path.read_bytes()
    ext = path.suffix.lower().lstrip(".")
    info = {"format": ext, "bytes": len(data), "tris": 0, "unit_m": None, "up_axis": None}
    if ext == "stl":
        n = struct.unpack("<I", data[80:84])[0] if len(data) >= 84 else 0
        if len(data) == 84 + 50 * n:
            info["tris"] = n
        else:  # ASCII
            info["tris"] = data.lower().count(b"facet normal")
    elif ext == "dae":
        text = data.decode("utf-8", errors="replace")
        tris = sum(int(c) for c in re.findall(r"<triangles\b[^>]*\bcount=\"(\d+)\"", text))
        for block in re.findall(r"<(?:polylist|polygons)\b[^>]*>.*?</(?:polylist|polygons)>", text, re.S):
            vc = re.search(r"<vcount>([^<]*)</vcount>", block)
            if vc:
                tris += sum(max(0, int(v) - 2) for v in vc.group(1).split())
            else:  # <polygons>: one <p> per polygon, assumed triangles
                tris += len(re.findall(r"<p>", block))
        info["tris"] = tris
        unit = re.search(r"<unit\b[^>]*\bmeter=\"([0-9.eE+-]+)\"", text)
        info["unit_m"] = float(unit.group(1)) if unit else None
        up = re.search(r"<up_axis>\s*([XYZ]_UP)\s*</up_axis>", text)
        info["up_axis"] = up.group(1) if up else None
    return info


def xacro_number(text: str) -> float:
    """A xacro default like "${-2.0*pi}", "${pi}", "-2.059": numbers and pi only, never eval."""
    t = text.strip()
    if t.startswith("${") and t.endswith("}"):
        t = t[2:-1].strip()
    m = re.fullmatch(r"(-)?\s*(\d+(?:\.\d*)?|\.\d+)?\s*(\*\s*pi|pi)?(?:\s*/\s*(\d+(?:\.\d*)?))?", t)
    if not m or (m.group(2) is None and m.group(3) is None):
        raise ValueError(f"not a number xacro expression: {text!r}")
    v = float(m.group(2)) if m.group(2) else 1.0
    if m.group(3):
        v *= math.pi
    if m.group(4):
        v /= float(m.group(4))
    return -v if m.group(1) else v


class _Loader(yaml.SafeLoader):
    pass


_Loader.add_constructor("!degrees", lambda loader, node: math.radians(float(loader.construct_scalar(node))))


def _yaml(path: Path) -> dict:
    return yaml.load(path.read_text(encoding="utf-8"), Loader=_Loader)  # noqa: S506 (SafeLoader subclass)


# --- the model --------------------------------------------------------------------------------------------------

@dataclass
class RobotModel:
    name: str
    label: str
    folder: str  # under ASSETS
    urdf: Urdf
    base: str
    arm_joints: list[str]
    gripper_joints: list[str]
    tip: str  # the flange: the last arm link
    meshes: dict[str, list[dict]] = field(default_factory=dict)  # link -> [{file, origin, scale, ...}]
    rest: dict[str, float] = field(default_factory=dict)
    rest_source: str = ""
    payload: float | None = None  # kg; only if the repo states it (none does)
    notes: list[str] = field(default_factory=list)
    _reach: dict = field(default_factory=dict, repr=False, compare=False)

    @property
    def dof(self) -> int:
        return len(self.arm_joints)

    def reach(self, tip: str | None = None, samples: int = SAMPLES) -> float:
        """Max distance (m) from the shoulder (the arm's 2nd joint's frame) to the flange (or `tip`), over the joint
        limits."""
        end = tip or self.tip
        key = (end, samples)
        if key in self._reach:
            return self._reach[key]
        shoulder = self.urdf.joints[self.arm_joints[1]].child
        lims = [(self.urdf.joints[j].limits.lower, self.urdf.joints[j].limits.upper) for j in self.arm_joints]
        rng = np.random.default_rng(SEED)

        def dist(q):
            qd = dict(zip(self.arm_joints, q))
            a = link_pose(self.urdf, shoulder, qd, top=self.base)[:3, 3]
            b = link_pose(self.urdf, end, qd, top=self.base)[:3, 3]
            return float(np.linalg.norm(b - a))

        lo, hi = np.array([l for l, _ in lims]), np.array([h for _, h in lims])
        qs = lo + rng.random((samples, len(lims))) * (hi - lo)
        best_q = max(qs, key=dist)
        best = dist(best_q)
        step = (hi - lo) / 8
        while step.max() > 1e-4:  # coordinate search around the best sample
            improved = False
            for k in range(len(lims)):
                for s in (step[k], -step[k]):
                    q = best_q.copy()
                    q[k] = np.clip(q[k] + s, lo[k], hi[k])
                    d = dist(q)
                    if d > best + 1e-12:
                        best, best_q, improved = d, q, True
            if not improved:
                step = step / 2
        self._reach[key] = best
        return best


def _origin(d: dict) -> Origin:
    return Origin(xyz=(float(d.get("x", 0)), float(d.get("y", 0)), float(d.get("z", 0))),
                  rpy=(float(d.get("roll", 0)), float(d.get("pitch", 0)), float(d.get("yaw", 0))))


def _mesh(file: str, folder: str, origin: Origin = Origin(), scale=(1.0, 1.0, 1.0)) -> dict:
    path = ASSETS / folder / file
    out = {"file": file, "path": f"{folder}/{file}", "origin": {"xyz": list(origin.xyz), "rpy": list(origin.rpy)},
           "scale": list(scale)}
    if path.exists():
        out.update(mesh_info(path))
    else:
        out["missing"] = True
    return out


def _link(name: str) -> Link:
    return Link(name, (), (), False)


def _rev(name, parent, child, origin, lower, upper, effort=None, velocity=None, axis=(0.0, 0.0, 1.0), kind="revolute") -> Joint:
    return Joint(name, kind, parent, child, origin, axis, Limits(lower, upper, effort, velocity), None)


def _fixed(name, parent, child, origin=Origin()) -> Joint:
    return Joint(name, "fixed", parent, child, origin, (0.0, 0.0, 1.0), None, None)


def _urdf(name: str, root: str, joints: list[Joint]) -> Urdf:
    links = {root: _link(root)}
    for j in joints:
        links.setdefault(j.child, _link(j.child))
    return Urdf(name, links, {j.name: j for j in joints}, root)


# --- per robot ----------------------------------------------------------------------------------------------------

# Isaac Lab's Franka start pose (web/src/twin/model.ts FRANKA.rest: FRANKA_PANDA_LEGACY_CFG.init_state), the pose SANT
# replays from: the one repo-sourced rest pose for a Franka.
PANDA_REST = {"joint1": 0.0, "joint2": -0.569, "joint3": 0.0, "joint4": -2.81, "joint5": 0.0, "joint6": 3.037,
              "joint7": 0.741, "finger_joint1": 0.04, "finger_joint2": 0.04}


def _franka(variant: str) -> RobotModel:
    folder = "franka"
    root = ASSETS / folder
    kin = _yaml(root / "robots" / variant / "kinematics.yaml")
    lim = _yaml(root / "robots" / variant / "joint_limits.yaml")
    xacro = (root / "robots" / variant / f"{variant}.urdf.xacro").read_text(encoding="utf-8")
    m = re.search(r'name="rpy_ee"\s+default="([^"]*)"', xacro)
    rpy_ee = tuple(xacro_number(v) for v in m.group(1).split()) if m else (0.0, 0.0, 0.0)
    joints = []
    for i in range(1, 8):
        k, l_ = kin[f"joint{i}"]["kinematic"], lim[f"joint{i}"]["limit"]
        joints.append(_rev(f"joint{i}", f"link{i - 1}", f"link{i}", _origin(k), l_["lower"], l_["upper"], l_.get("effort"), l_.get("velocity")))
    joints.append(_fixed("joint8", "link7", "link8", _origin(kin["joint8"]["kinematic"])))
    joints.append(_fixed("hand_joint", "link8", "hand", Origin(rpy=rpy_ee)))
    # franka_hand.xacro: fingers 0.0584 m above the hand, sliding along y 0-0.04 m; the right one turned pi, mimicking.
    joints.append(_rev("finger_joint1", "hand", "leftfinger", Origin(xyz=(0, 0, 0.0584)), 0.0, 0.04, 100.0, 0.2, (0.0, 1.0, 0.0), "prismatic"))
    j2 = _rev("finger_joint2", "hand", "rightfinger", Origin(xyz=(0, 0, 0.0584), rpy=(0, 0, math.pi)), 0.0, 0.04, 100.0, 0.2, (0.0, 1.0, 0.0), "prismatic")
    joints.append(Joint(j2.name, j2.type, j2.parent, j2.child, j2.origin, j2.axis, j2.limits, Mimic("finger_joint1")))
    u = _urdf(f"franka_{variant}", "link0", joints)
    meshes = {f"link{i}": [_mesh(f"meshes/robots/{variant}/visual/link{i}.dae", folder)] for i in range(8)}
    meshes["hand"] = [_mesh("meshes/robot_ee/franka_hand_white/visual/hand.dae", folder)]
    meshes["leftfinger"] = [_mesh("meshes/robot_ee/franka_hand_white/visual/finger.dae", folder)]
    meshes["rightfinger"] = [_mesh("meshes/robot_ee/franka_hand_white/visual/finger.dae", folder)]
    label = {"fer": "Franka Panda (FER)", "fr3": "Franka Research 3"}[variant]
    rest, src = (PANDA_REST, "Isaac Lab's Franka start pose (web/src/twin/model.ts)") if variant == "fer" else (
        _nearest_zero(u, [f"joint{i}" for i in range(1, 8)]), "none in the repo: each joint at the value nearest 0 within its limits")
    return RobotModel("franka" if variant == "fer" else "fr3", label, folder, u, "link0", [f"joint{i}" for i in range(1, 8)],
                      ["finger_joint1", "finger_joint2"], "link8", meshes, rest, src)


def _nearest_zero(u: Urdf, joints: list[str]) -> dict[str, float]:
    return {j: float(min(max(0.0, u.joints[j].limits.lower), u.joints[j].limits.upper)) for j in joints}


def _ur5e() -> RobotModel:
    folder = "ur5e"
    root = ASSETS / folder
    kin = _yaml(root / "config/ur5e/default_kinematics.yaml")["kinematics"]
    lim = _yaml(root / "config/ur5e/joint_limits.yaml")["joint_limits"]
    vis = _yaml(root / "config/ur5e/visual_parameters.yaml")["mesh_files"]
    rest = _yaml(root / "config/initial_positions.yaml")
    names = [("shoulder_pan_joint", "shoulder", "base_link_inertia", "shoulder_link"),
             ("shoulder_lift_joint", "upper_arm", "shoulder_link", "upper_arm_link"),
             ("elbow_joint", "forearm", "upper_arm_link", "forearm_link"),
             ("wrist_1_joint", "wrist_1", "forearm_link", "wrist_1_link"),
             ("wrist_2_joint", "wrist_2", "wrist_1_link", "wrist_2_link"),
             ("wrist_3_joint", "wrist_3", "wrist_2_link", "wrist_3_link")]
    # ur_macro.xacro: base_link -> base_link_inertia turned pi about z; wrist_3 -> flange (0, -pi/2, -pi/2).
    joints = [_fixed("base_link-base_link_inertia", "base_link", "base_link_inertia", Origin(rpy=(0, 0, math.pi)))]
    for jn, key, parent, child in names:
        l_ = lim[jn]
        joints.append(_rev(jn, parent, child, _origin(kin[key]), l_["min_position"], l_["max_position"], l_.get("max_effort"), l_.get("max_velocity")))
    joints.append(_fixed("wrist_3-flange", "wrist_3_link", "flange", Origin(rpy=(0, -math.pi / 2, -math.pi / 2))))
    u = _urdf("ur5e", "base_link", joints)
    links = {"base": "base_link_inertia", "shoulder": "shoulder_link", "upper_arm": "upper_arm_link", "forearm": "forearm_link",
             "wrist_1": "wrist_1_link", "wrist_2": "wrist_2_link", "wrist_3": "wrist_3_link"}
    meshes = {link: [_mesh(vis[key]["visual"]["mesh"]["path"], folder, _origin(vis[key].get("mesh_offset", {})))] for key, link in links.items()}
    return RobotModel("ur5e", "Universal Robots UR5e", folder, u, "base_link", [n[0] for n in names], [], "flange", meshes,
                      {k: float(v) for k, v in rest.items()}, "config/initial_positions.yaml")


def _xarm6() -> RobotModel:
    folder = "xarm6"
    root = ASSETS / folder / "xarm_description"
    kin = _yaml(root / "config/kinematics/default/xarm6_default_kinematics.yaml")["kinematics"]
    eff = _yaml(root / "config/xarm6/joint_limits.yaml")["joint_limits"]
    xacro = (root / "urdf/xarm6/xarm6.urdf.xacro").read_text(encoding="utf-8")
    lims = {}
    for i in range(1, 7):
        lo = re.search(rf"joint{i}_lower_limit:=(\$\{{[^}}]*\}}|[-0-9.]+)", xacro)
        hi = re.search(rf"joint{i}_upper_limit:=(\$\{{[^}}]*\}}|[-0-9.]+)", xacro)
        lims[i] = (xacro_number(lo.group(1)), xacro_number(hi.group(1)))
    joints = []
    for i in range(1, 7):
        parent = "link_base" if i == 1 else f"link{i - 1}"
        joints.append(_rev(f"joint{i}", parent, f"link{i}", _origin(kin[f"joint{i}"]), *lims[i], eff[f"joint{i}"].get("max_effort")))
    u = _urdf("xarm6", "link_base", joints)
    meshes = {"link_base": [_mesh("xarm_description/meshes/xarm6/visual/link_base.stl", folder)]}
    for i in range(1, 7):
        meshes[f"link{i}"] = [_mesh(f"xarm_description/meshes/xarm6/visual/link{i}.stl", folder)]
    # The xArm gripper mounts on link6's flange (its macro's default attach origin is zero); its fingers are posed by
    # the gripper xacro's linkage, not resolved here: listed as parts.
    meshes["link6"].append(_mesh("xarm_description/meshes/gripper/xarm/base_link.stl", folder))
    model = RobotModel("xarm6", "UFACTORY xArm 6 + xArm gripper", folder, u, "link_base", [f"joint{i}" for i in range(1, 7)], [],
                       "link6", meshes, _nearest_zero(u, [f"joint{i}" for i in range(1, 7)]),
                       "none in the repo: each joint at the value nearest 0 within its limits")
    model.notes.append("gripper fingers (meshes/gripper/xarm/*finger*, *knuckle*) are parts: the linkage that poses them "
                       "is in the gripper's xacro and isn't resolved here")
    return model


def _from_urdf(name, label, folder, urdf_file, mesh_root, package, base, arm, gripper, tip) -> RobotModel:
    # XML comments go first: OpenArm's generated example keeps xacro text (${...}) in comments, which parse_urdf
    # would take for an unexpanded xacro.
    text = re.sub(r"<!--.*?-->", "", (ASSETS / folder / urdf_file).read_text(encoding="utf-8"), flags=re.S)
    u = parse_urdf(text)
    sub = {base} | {u.joints[j].child for j in u.subtree_joints(base)}
    meshes: dict[str, list[dict]] = {}
    for lname in sorted(sub, key=list(u.links).index):
        for g in u.links[lname].visuals:
            if g.kind != "mesh" or not g.filename:
                continue
            f = g.filename
            f = f[len(package):] if package and f.startswith(package) else f
            meshes.setdefault(lname, []).append(_mesh(f"{mesh_root}{f}", folder, g.origin, g.scale))
    return RobotModel(name, label, folder, u, base, arm, gripper, tip, meshes, _nearest_zero(u, arm),
                      "none in the repo: each joint at the value nearest 0 within its limits")


def _so101() -> RobotModel:
    return _from_urdf("so101", "SO-101 (TheRobotStudio)", "so101", "Simulation/SO101/so101_new_calib.urdf", "Simulation/SO101/", "",
                      "base_link", ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"], ["gripper"], "gripper_link")


def _piper() -> RobotModel:
    return _from_urdf("piper", "AgileX PiPER", "piper", "src/piper_description/urdf/piper_description.urdf", "src/piper_description/",
                      "package://piper_description/", "base_link", [f"joint{i}" for i in range(1, 7)], ["joint7", "joint8"], "link6")


def _openarm() -> RobotModel:
    # The generated example is bimanual; one arm (right) is the unimanual OpenArm SANT ran in Isaac.
    return _from_urdf("openarm", "OpenArm v1.0 (Enactic)", "openarm", "assets/robot/openarm_v1.0/urdf/example/v1.urdf", "",
                      "package://openarm_description/", "openarm_right_link0", [f"openarm_right_joint{i}" for i in range(1, 8)],
                      ["openarm_right_finger_joint1", "openarm_right_finger_joint2"], "openarm_right_link7")


ROBOTS = {"franka": lambda: _franka("fer"), "fr3": lambda: _franka("fr3"), "ur5e": _ur5e, "xarm6": _xarm6,
          "so101": _so101, "piper": _piper, "openarm": _openarm}


@functools.cache
def build(name: str) -> RobotModel:
    """One model per robot per process (the reach search is the slow part; it is cached on the model)."""
    return ROBOTS[name]()


# --- the manifest ---------------------------------------------------------------------------------------------------

def _licence_of(text: str) -> str:
    if "Apache License" in text and "Version 2.0" in text:
        return "Apache-2.0"
    if "MIT License" in text or "Permission is hereby granted, free of charge" in text:
        return "MIT"
    if "Redistribution and use in source and binary forms" in text:
        return "BSD-3-Clause" if "Neither the name" in text else "BSD-2-Clause"
    return "unknown"


def _r(x, n=6):
    return round(float(x), n)


def robot_manifest(m: RobotModel, fetch: dict) -> dict:
    src = fetch[m.folder]
    lic_file = next((ASSETS / m.folder / p for p in ("LICENSE", "LICENSE.txt") if (ASSETS / m.folder / p).exists()), None)
    licence = _licence_of(lic_file.read_text(encoding="utf-8", errors="replace")) if lic_file else "no licence file"
    joints = []
    for j in m.arm_joints + m.gripper_joints:
        jt = m.urdf.joints[j]
        joints.append({"name": j, "type": jt.type, "parent": jt.parent, "child": jt.child,
                       "origin": {"xyz": [_r(v) for v in jt.origin.xyz], "rpy": [_r(v) for v in jt.origin.rpy]},
                       "axis": [_r(v) for v in jt.axis],
                       "lower": _r(jt.limits.lower) if jt.limits else None, "upper": _r(jt.limits.upper) if jt.limits else None,
                       "velocity": None if not jt.limits or jt.limits.velocity is None else _r(jt.limits.velocity),
                       "effort": None if not jt.limits or jt.limits.effort is None else _r(jt.limits.effort),
                       "mimic": jt.mimic.joint if jt.mimic else None})
    meshes = {k: [{**{kk: vv for kk, vv in d.items() if kk != "missing"}, **({"missing": True} if d.get("missing") else {})}
                  for d in v] for k, v in m.meshes.items()}
    tris = sum(d.get("tris", 0) for v in m.meshes.values() for d in v)
    size = sum(d.get("bytes", 0) for v in m.meshes.values() for d in v)
    out = {
        "label": m.label,
        "source": {"repo": src["repo"], "commit": src["commit"], "licence": licence, "github_licence": src["github_license"],
                   "folder": m.folder},
        "base": m.base, "flange": m.tip,
        "dof": m.dof,
        "reach_m": _r(m.reach(), 3),
        "reach_definition": "max distance from the shoulder (2nd arm joint's frame) to the flange over the joint limits",
        "payload_kg": m.payload,
        "payload_note": "not stated in the repo",
        "joints": joints,
        "rest": {"values": {k: _r(v) for k, v in m.rest.items()}, "source": m.rest_source},
        "meshes": meshes,
        "mesh_totals": {"files": sum(len(v) for v in m.meshes.values()), "tris": tris, "bytes": size},
        "blender": {"target_tris": WALL_TRIS_PER_ROBOT, "decimate_ratio": _r(min(1.0, WALL_TRIS_PER_ROBOT / tris), 4) if tris else None},
        "notes": m.notes,
    }
    return out


def manifest(root: Path | None = None) -> dict:
    fetch = json.loads(((root or ASSETS) / "fetch_manifest.json").read_text(encoding="utf-8"))
    robots = {name: robot_manifest(build(name), fetch) for name in ROBOTS}
    return {"version": 1, "assets_root": "C:/dev/assets/robots (see its SOURCES.md)",
            "wall_target_tris": WALL_TRIS_PER_ROBOT * len(robots), "robots": robots}
