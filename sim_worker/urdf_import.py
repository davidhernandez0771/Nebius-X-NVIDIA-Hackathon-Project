"""Bring your robot: read a URDF, suggest which parts are the base / arm / hand / gripper, validate the user's roles,
and build the RobotSpec the sim uses (the same shape as the hand-written ones in sim_worker.robots). Pure Python
(stdlib + numpy + pydantic); the API contract is docs/design/byor-api.md.

Every problem is an Issue with a code from the contract's table (section 8), a severity and a message that says what
to change. parse_urdf raises UrdfError for a file that cannot be used at all; the role checks return lists.
"""

from __future__ import annotations

import itertools
import math
import re
import struct
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from demo_pipeline.multiply import SCENE_RANGES

from .robots import RobotSpec, hand_from_tool
from .scripted import DOWN_WXYZ, HOME_TCP
from .urdf_kin import Chain, link_pose, matrix_to_quat, origin_matrix, quat_to_matrix, rpy_matrix

MIN_ARM_DOF = 5
JOINT_TYPES = ("revolute", "continuous", "prismatic", "fixed", "floating", "planar")
ARM_TYPES = ("revolute", "continuous", "prismatic")
XACRO_NS = "{http://www.ros.org/wiki/xacro}"
GRIPPER_NAME = re.compile(r"finger|gripper|jaw|claw|knuckle", re.IGNORECASE)


@dataclass(frozen=True)
class Issue:
    code: str
    severity: str  # "error" | "warning"
    message: str
    where: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def error(code: str, message: str, where: str | None = None) -> Issue:
    return Issue(code, "error", message, where)


def warning(code: str, message: str, where: str | None = None) -> Issue:
    return Issue(code, "warning", message, where)


class UrdfError(ValueError):
    def __init__(self, issue: Issue):
        super().__init__(issue.message)
        self.issue = issue


@dataclass(frozen=True)
class Origin:
    xyz: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rpy: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass(frozen=True)
class Geometry:
    kind: str  # box | cylinder | sphere | mesh
    origin: Origin
    size: tuple[float, float, float] | None = None  # box
    radius: float | None = None  # cylinder, sphere
    length: float | None = None  # cylinder
    filename: str | None = None  # mesh
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0)


@dataclass(frozen=True)
class Link:
    name: str
    visuals: tuple[Geometry, ...]
    collisions: tuple[Geometry, ...]
    has_inertial: bool

    @property
    def has_geometry(self) -> bool:
        return bool(self.visuals or self.collisions)


@dataclass(frozen=True)
class Limits:
    lower: float
    upper: float
    effort: float | None
    velocity: float | None


@dataclass(frozen=True)
class Mimic:
    joint: str
    multiplier: float = 1.0
    offset: float = 0.0


@dataclass(frozen=True)
class Joint:
    name: str
    type: str
    parent: str
    child: str
    origin: Origin
    axis: tuple[float, float, float]
    limits: Limits | None
    mimic: Mimic | None

    @property
    def moving(self) -> bool:
        return self.type != "fixed"


@dataclass(frozen=True)
class Urdf:
    name: str
    links: dict[str, Link]  # URDF order
    joints: dict[str, Joint]  # URDF order
    root: str

    def parent_joint(self, link: str) -> str | None:
        return next((j.name for j in self.joints.values() if j.child == link), None)

    def child_joints(self, link: str) -> list[str]:
        return [j.name for j in self.joints.values() if j.parent == link]

    def path(self, top: str, link: str) -> list[str] | None:
        """Joint names from link `top` down to `link`, or None if `link` is not below `top`."""
        out = []
        while link != top:
            j = self.parent_joint(link)
            if j is None:
                return None
            out.append(j)
            link = self.joints[j].parent
        return out[::-1]

    def subtree_joints(self, link: str) -> list[str]:
        """Every joint below `link`, in URDF order."""
        below, todo = set(), [link]
        while todo:
            for j in self.child_joints(todo.pop()):
                below.add(j)
                todo.append(self.joints[j].child)
        return [j for j in self.joints if j in below]


def _floats(text: str | None, n: int, default: tuple[float, ...], what: str) -> tuple[float, ...]:
    if text is None:
        return default
    try:
        vals = tuple(float(v) for v in text.split())
    except ValueError:
        vals = ()
    if len(vals) != n:
        raise UrdfError(error("urdf_parse", f"{what}: expected {n} numbers, got {text!r}"))
    return vals


def _num(el: ET.Element, attr: str, default: float | None, what: str) -> float | None:
    v = el.get(attr)
    if v is None:
        return default
    try:
        return float(v)
    except ValueError as e:
        raise UrdfError(error("urdf_parse", f"{what}: {attr}={v!r} is not a number")) from e


def _origin(el: ET.Element | None, what: str) -> Origin:
    if el is None:
        return Origin()
    return Origin(_floats(el.get("xyz"), 3, (0.0, 0.0, 0.0), f"{what} origin xyz"),
                  _floats(el.get("rpy"), 3, (0.0, 0.0, 0.0), f"{what} origin rpy"))


def _geometry(el: ET.Element, what: str) -> Geometry | None:
    g = el.find("geometry")
    shape = None if g is None else next(iter(g), None)
    if shape is None:
        return None
    origin = _origin(el.find("origin"), what)
    if shape.tag == "box":
        return Geometry("box", origin, size=_floats(shape.get("size"), 3, (0.0, 0.0, 0.0), f"{what} box size"))
    if shape.tag == "cylinder":
        return Geometry("cylinder", origin, radius=_num(shape, "radius", 0.0, what), length=_num(shape, "length", 0.0, what))
    if shape.tag == "sphere":
        return Geometry("sphere", origin, radius=_num(shape, "radius", 0.0, what))
    if shape.tag == "mesh":
        if not shape.get("filename"):
            raise UrdfError(error("urdf_parse", f"{what}: <mesh> without a filename"))
        return Geometry("mesh", origin, filename=shape.get("filename"),
                        scale=_floats(shape.get("scale"), 3, (1.0, 1.0, 1.0), f"{what} mesh scale"))
    return None


def _link(el: ET.Element) -> Link:
    name = el.get("name")
    if not name:
        raise UrdfError(error("urdf_parse", "a <link> has no name"))
    geoms = {}
    for tag in ("visual", "collision"):
        geoms[tag] = tuple(g for g in (_geometry(e, f"link {name} {tag}") for e in el.findall(tag)) if g is not None)
    return Link(name, geoms["visual"], geoms["collision"], el.find("inertial") is not None)


def _joint(el: ET.Element, links: dict[str, Link]) -> Joint:
    name = el.get("name")
    if not name:
        raise UrdfError(error("urdf_parse", "a <joint> has no name"))
    type_ = el.get("type")
    if type_ not in JOINT_TYPES:
        raise UrdfError(error("urdf_parse", f"joint {name} has type {type_!r}; URDF types are {', '.join(JOINT_TYPES)}"))
    ends = {}
    for tag in ("parent", "child"):
        e = el.find(tag)
        if e is None or not e.get("link"):
            raise UrdfError(error("urdf_parse", f"joint {name} has no <{tag} link=...>"))
        if e.get("link") not in links:
            raise UrdfError(error("urdf_parse", f"joint {name} names link {e.get('link')!r}, which is not in the URDF"))
        ends[tag] = e.get("link")
    axis_el = el.find("axis")
    axis = _floats(None if axis_el is None else axis_el.get("xyz"), 3, (1.0, 0.0, 0.0), f"joint {name} axis")
    lim_el = el.find("limit")
    limits = None
    if lim_el is not None:
        what = f"joint {name} limit"
        limits = Limits(_num(lim_el, "lower", 0.0, what), _num(lim_el, "upper", 0.0, what),
                        _num(lim_el, "effort", None, what), _num(lim_el, "velocity", None, what))
    mim_el = el.find("mimic")
    mimic = None
    if mim_el is not None:
        what = f"joint {name} mimic"
        mimic = Mimic(mim_el.get("joint", ""), _num(mim_el, "multiplier", 1.0, what), _num(mim_el, "offset", 0.0, what))
    return Joint(name, type_, ends["parent"], ends["child"], _origin(el.find("origin"), f"joint {name}"), axis,
                 limits, mimic)


def parse_urdf(text: str) -> Urdf:
    try:
        root_el = ET.fromstring(text)
    except ET.ParseError as e:
        raise UrdfError(error("urdf_parse", f"the XML does not parse: {e}")) from e
    # xacro output keeps the xmlns:xacro attribute; only xacro elements or ${...} mean it still needs xacro
    if any(el.tag.startswith(XACRO_NS) for el in root_el.iter()) or "${" in text:
        raise UrdfError(error("xacro", "this is a xacro file: run `xacro robot.urdf.xacro > robot.urdf` and upload "
                                       "the .urdf it prints"))
    if root_el.tag != "robot":
        raise UrdfError(error("urdf_parse", f"no <robot> element (the top element is <{root_el.tag}>)"))
    links: dict[str, Link] = {}
    for el in root_el.findall("link"):
        link = _link(el)
        if link.name in links:
            raise UrdfError(error("urdf_parse", f"two links are named {link.name}"))
        links[link.name] = link
    joints: dict[str, Joint] = {}
    parents: dict[str, list[str]] = {}
    for el in root_el.findall("joint"):
        j = _joint(el, links)
        if j.name in joints:
            raise UrdfError(error("urdf_parse", f"two joints are named {j.name}"))
        joints[j.name] = j
        parents.setdefault(j.child, []).append(j.name)
    for link, js in parents.items():
        if len(js) > 1:
            raise UrdfError(error("urdf_parse", f"link {link} has two parent joints ({', '.join(js)})"))
    roots = [n for n in links if n not in parents]
    if not roots:
        raise UrdfError(error("cycle", "every link is some joint's child: the joints form a cycle"))
    if len(roots) > 1:
        raise UrdfError(error("multiple_roots", f"the URDF has {len(roots)} root links ({', '.join(roots)}); "
                                                "it must be one tree"))
    urdf = Urdf(root_el.get("name") or "robot", links, joints, roots[0])
    reached = {urdf.root} | {joints[j].child for j in urdf.subtree_joints(urdf.root)}
    if len(reached) != len(links):
        stray = [n for n in links if n not in reached]
        raise UrdfError(error("cycle", f"links {', '.join(stray)} are not below the root {urdf.root}: "
                                       "their joints form a cycle"))
    return urdf


# --- roles -------------------------------------------------------------------------------------------------------

class Mount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pos: tuple[float, float, float] = (0.0, 0.0, 0.0)


class Roles(BaseModel):
    """The PUT /robots/{id}/roles body (contract section 4)."""

    model_config = ConfigDict(extra="forbid")
    base: str
    arm_joints: list[str]
    hand: str
    gripper_joints: list[str]
    tcp_offset: tuple[float, float, float] | None = None  # hand frame
    gripper_open: float | dict[str, float] | None = None  # one value for every driven gripper joint, or per joint
    gripper_closed: float | dict[str, float] | None = None
    mount: Mount = Field(default_factory=Mount)
    start_joint_pos: dict[str, float] | None = None


@dataclass(frozen=True)
class Suggestion:
    roles: dict  # base, arm_joints, hand, gripper_joints (None where the rules found nothing)
    why: dict[str, str]
    issues: list[Issue]


def _is_arm_joint(j: Joint) -> bool:
    return j.type in ("revolute", "continuous") and j.mimic is None


def _is_gripper_joint(j: Joint) -> bool:
    return j.moving and (j.type == "prismatic" or j.mimic is not None or bool(GRIPPER_NAME.search(j.name)))


def _suggest_base(u: Urdf) -> str:
    base = u.root
    while not u.links[base].has_geometry and not u.links[base].has_inertial:
        kids = u.child_joints(base)
        if len(kids) != 1 or u.joints[kids[0]].type != "fixed":
            break
        base = u.joints[kids[0]].child
    return base


def _longest_arm(u: Urdf, link: str) -> list[str]:
    """The longest run of revolute/continuous joints down from `link`, through fixed joints (first one on ties)."""
    best: list[str] = []
    for jn in u.child_joints(link):
        j = u.joints[jn]
        if j.type == "fixed":
            run = _longest_arm(u, j.child)
        elif _is_arm_joint(j):
            run = [jn] + _longest_arm(u, j.child)
        else:
            continue
        if len(run) > len(best):
            best = run
    return best


def _follow_fixed(u: Urdf, link: str) -> str:
    while True:
        kids = u.child_joints(link)
        if len(kids) != 1 or u.joints[kids[0]].type != "fixed":
            return link
        link = u.joints[kids[0]].child


def _dedupe(issues: list[Issue]) -> list[Issue]:
    seen, out = set(), []
    for i in issues:
        if (i.code, i.message) not in seen:
            seen.add((i.code, i.message))
            out.append(i)
    return out


def suggest_roles(u: Urdf) -> Suggestion:
    issues: list[Issue] = []
    why: dict[str, str] = {}
    base = _suggest_base(u)
    why["base"] = "the root link (no parent joint)" if base == u.root else \
        f"the root {u.root} has no geometry; {base} is bolted to it by fixed joints"
    arm = _longest_arm(u, base)
    trailing = []
    while arm and GRIPPER_NAME.search(arm[-1]):
        trailing.insert(0, arm.pop())
    roles: dict = {"base": base, "arm_joints": arm or None, "hand": None, "gripper_joints": None}
    if not arm:
        issues.append(error("no_arm", "no revolute joints: the task needs an arm", "arm_joints"))
    else:
        why["arm_joints"] = f"the longest chain of revolute joints from the root ({len(arm)})" + (
            f"; {', '.join(trailing)} at its end {'is' if len(trailing) == 1 else 'are'} named like a gripper"
            if trailing else "")
        hand = _follow_fixed(u, u.joints[arm[-1]].child)
        roles["hand"] = hand
        why["hand"] = "the last arm link, followed through fixed joints to where the gripper joints start"
        gripper = [j for j in u.subtree_joints(hand) if _is_gripper_joint(u.joints[j])]
        if gripper:
            roles["gripper_joints"] = gripper
            kinds = [f"{j} mimics {u.joints[j].mimic.joint}" for j in gripper if u.joints[j].mimic]
            why["gripper_joints"] = (f"the prismatic, mimic and finger/gripper/jaw-named joints after the hand "
                                     f"({len(gripper)}" + (f"; {', '.join(kinds)}" if kinds else "") + ")")
        else:
            issues.append(error("no_gripper", f"no gripper: no prismatic, mimic or finger/gripper/jaw joints below "
                                              f"the hand ({hand})", "gripper_joints"))
    if all(roles[k] is not None for k in ("arm_joints", "hand", "gripper_joints")):
        issues += validate_roles(u, Roles(**roles))
    elif arm and len(arm) < MIN_ARM_DOF:
        issues.append(_too_short(arm))
    for link in u.links.values():
        if link.has_geometry and not link.has_inertial:
            issues.append(warning("no_inertial", f"link {link.name} has geometry but no <inertial>; the importer gives "
                                                 "it a default mass", link.name))
    return Suggestion(roles, why, _dedupe(issues))


def _too_short(arm: list[str]) -> Issue:
    return error("arm_too_short", f"the arm has {len(arm)} DOF ({', '.join(arm)}); the task needs at least "
                                  f"{MIN_ARM_DOF}", "arm_joints")


def validate_roles(u: Urdf, roles: Roles) -> list[Issue]:
    issues: list[Issue] = []
    for role in ("base", "hand"):
        name = getattr(roles, role)
        if name not in u.links:
            issues.append(error("unknown_link", f"{role} {name!r} is not a link in the URDF", role))
    for role in ("arm_joints", "gripper_joints"):
        for name in getattr(roles, role):
            if name not in u.joints:
                issues.append(error("unknown_joint", f"{name!r} ({role}) is not a joint in the URDF", role))
    if issues:
        return issues

    for name in sorted(set(roles.arm_joints) & set(roles.gripper_joints)):
        issues.append(error("role_overlap", f"{name} is both an arm joint and a gripper joint", "gripper_joints"))
    if len(roles.arm_joints) < MIN_ARM_DOF:
        issues.append(_too_short(roles.arm_joints))
    for name in roles.arm_joints:
        if u.joints[name].type not in ARM_TYPES:
            issues.append(error("unsupported_joint", f"arm joint {name} is {u.joints[name].type}; list only the moving "
                                                     "joints (revolute, continuous or prismatic)", "arm_joints"))
    above = u.path(u.root, roles.base) or []
    loose = [j for j in above if u.joints[j].moving]
    if loose:
        issues.append(error("arm_not_chain", f"the base ({roles.base}) must be bolted to the root ({u.root}): "
                                             f"{', '.join(loose)} {'is a moving joint' if len(loose) == 1 else 'are moving joints'}",
                            "base"))
    path = u.path(roles.base, roles.hand)
    if path is None:
        issues.append(error("arm_not_chain", f"the hand ({roles.hand}) is not below the base ({roles.base})", "hand"))
    else:
        expected = [j for j in path if u.joints[j].moving]
        if roles.arm_joints != expected:
            issues.append(error("arm_not_chain",
                                f"the arm joints must be the moving joints on the path from the base ({roles.base}) "
                                f"to the hand ({roles.hand}), listed from the base outwards: {', '.join(expected) or 'none'}",
                                "arm_joints"))

    if not roles.gripper_joints:
        issues.append(error("no_gripper", "no gripper joints: the task needs a gripper (give the joints that open "
                                          "and close it)", "gripper_joints"))
    allowed = set(roles.gripper_joints)
    for name in roles.gripper_joints:
        j = u.joints[name]
        if not j.moving or j.type in ("floating", "planar"):
            issues.append(error("no_gripper" if not j.moving else "unsupported_joint",
                                f"{name} is {j.type}: a gripper joint must be prismatic, revolute or continuous",
                                "gripper_joints"))
            continue
        down = u.path(roles.hand, j.child)
        between = None if down is None else [k for k in down[:-1] if u.joints[k].moving and k not in allowed]
        if down is None or between:
            extra = f": {', '.join(between)} {'is' if len(between) == 1 else 'are'} in between" if between else ""
            issues.append(error("no_gripper", f"{name} is not below the hand ({roles.hand}) through fixed or gripper "
                                              f"joints only{extra}", "gripper_joints"))
    for role in ("arm_joints", "gripper_joints"):
        for name in getattr(roles, role):
            j = u.joints[name]
            if j.type in ("revolute", "prismatic") and j.limits is None and not (role == "gripper_joints" and j.mimic):
                issues.append(error("joint_no_limits", f"{name} is {j.type} but has no <limit>", role))
    return _dedupe(issues)


# --- spec ---------------------------------------------------------------------------------------------------------

PAD_INSET = 0.009  # m from the fingertips to the grasp point: Franka's documented TCP is 0.0089 m above its fingertips
TCP_NAME = re.compile(r"(^|_)(tcp|tool\w*|grasp\w*|ee|eef|end_?effector|gripper_frame)(_|$)", re.IGNORECASE)
WORKSPACE = SCENE_RANGES["franka"]  # the task's cube and bin ranges (spec 8.6): the same task for every robot
_AXES = ("x", "y", "z")

MeshLoader = Callable[[str], "np.ndarray | None"]  # URDF mesh filename -> vertices (mesh units), or None


def mesh_vertices(path) -> np.ndarray:
    """The vertices of an STL (binary or ASCII), OBJ or DAE mesh: in metres for DAE (its <unit>), else file units."""
    p = Path(path)
    data, ext = p.read_bytes(), p.suffix.lower()
    if ext == ".stl":
        if len(data) >= 84:
            n = struct.unpack("<I", data[80:84])[0]
            if 84 + 50 * n == len(data):
                rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]),
                                    count=n, offset=84)
                return rec["v"].reshape(-1, 3).astype(float)
        found = re.findall(r"vertex\s+(\S+)\s+(\S+)\s+(\S+)", data.decode("ascii", errors="replace"))
        return np.array(found, dtype=float).reshape(-1, 3)
    if ext == ".obj":
        rows = [ln.split()[1:4] for ln in data.decode(errors="replace").splitlines() if ln.startswith("v ")]
        return np.array(rows, dtype=float).reshape(-1, 3)
    if ext == ".dae":
        root = ET.fromstring(data)
        ns = root.tag[: root.tag.index("}") + 1] if root.tag.startswith("{") else ""
        unit = root.find(f"{ns}asset/{ns}unit")
        scale = float(unit.get("meter", 1.0)) if unit is not None else 1.0
        sources = {el.get("id"): el for el in root.iter(f"{ns}source")}
        pts = []
        for inp in root.iter(f"{ns}input"):
            src = sources.get((inp.get("source") or "").lstrip("#")) if inp.get("semantic") == "POSITION" else None
            arr = None if src is None else src.find(f"{ns}float_array")
            if arr is not None and arr.text:
                pts.append(np.array(arr.text.split(), dtype=float).reshape(-1, 3))
        return (np.concatenate(pts) if pts else np.zeros((0, 3))) * scale
    raise ValueError(f"{p.name} is not an STL, OBJ or DAE mesh")


def _geometry_points(g: Geometry, mesh_loader: MeshLoader | None) -> np.ndarray | None:
    """Points that bound the geometry, in its link's frame."""
    if g.kind == "box":
        pts = np.array(list(itertools.product(*[(-v / 2, v / 2) for v in g.size])))
    elif g.kind == "cylinder":
        a = np.linspace(0, 2 * math.pi, 16, endpoint=False)
        ring = np.stack([g.radius * np.cos(a), g.radius * np.sin(a)], axis=1)
        pts = np.concatenate([np.c_[ring, np.full(16, z)] for z in (-g.length / 2, g.length / 2)])
    elif g.kind == "sphere":
        pts = g.radius * np.concatenate([np.eye(3), -np.eye(3)])
    else:
        v = mesh_loader(g.filename) if mesh_loader is not None else None
        if v is None or len(v) == 0:
            return None
        pts = np.asarray(v, dtype=float) * np.asarray(g.scale)
    return pts @ rpy_matrix(g.origin.rpy).T + np.asarray(g.origin.xyz)


def _link_points(link: Link, mesh_loader: MeshLoader | None) -> np.ndarray | None:
    for geoms in (link.collisions, link.visuals):
        pts = [p for p in (_geometry_points(g, mesh_loader) for g in geoms) if p is not None]
        if pts:
            return np.concatenate(pts)
    return None


def _apply(t: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return pts @ t[:3, :3].T + t[:3, 3]


def _snap(v, exclude: int | None = None) -> np.ndarray:
    """The nearest of +-x, +-y, +-z (never the `exclude` axis)."""
    v = np.asarray(v, dtype=float).copy()
    if exclude is not None:
        v[exclude] = 0.0
    i = int(np.argmax(np.abs(v)))
    out = np.zeros(3)
    out[i] = 1.0 if v[i] >= 0 else -1.0
    return out


def _axis_name(a: np.ndarray) -> str:
    i = int(np.argmax(np.abs(a)))
    return ("+" if a[i] > 0 else "-") + _AXES[i]


def _fixed_subtree(u: Urdf, link: str) -> list[str]:
    """Joints below `link` reached through fixed joints only, breadth first."""
    out, todo = [], [link]
    while todo:
        nxt = []
        for lk in todo:
            for j in u.child_joints(lk):
                if u.joints[j].type == "fixed":
                    out.append(j)
                    nxt.append(u.joints[j].child)
        todo = nxt
    return out


def _one(values: list[float]):
    return values[0] if len(set(values)) == 1 else tuple(values)


@dataclass(frozen=True)
class Resolved:
    """What build_spec made: the spec, where each derived value came from, the derived values and the warnings."""

    spec: RobotSpec
    sources: dict[str, str]
    derived: dict
    issues: list[Issue] = field(default_factory=list)


@dataclass(frozen=True)
class _Fingers:
    drivers: list[str]
    passive: list[str]
    links: list[str]  # the gripper joints' children: the bodies after the importer merges fixed joints
    leaves: list[str]  # the links at the ends of the fingers
    q0: dict[str, float]  # the drivers at 0, clipped to their limits
    points: dict[str, np.ndarray]  # leaf -> geometry points in its own frame
    in_hand: dict[str, np.ndarray]  # leaf -> the same points in the hand frame at q0


def _fingers(u: Urdf, roles: Roles, mesh_loader: MeshLoader | None) -> _Fingers:
    grip = list(roles.gripper_joints)
    passive = [j for j in grip if u.joints[j].mimic is not None and u.joints[j].mimic.joint in grip]
    drivers = [j for j in grip if j not in passive]
    links = list(dict.fromkeys(u.joints[j].child for j in grip))
    parts = list(dict.fromkeys(links + [u.joints[j].child for f in links for j in u.subtree_joints(f)]))
    leaves = [p for p in parts if not u.child_joints(p)]
    q0 = {}
    for d in drivers:
        lim = u.joints[d].limits
        q0[d] = float(np.clip(0.0, lim.lower, lim.upper)) if lim is not None else 0.0
    points = {leaf: pts for leaf in leaves if (pts := _link_points(u.links[leaf], mesh_loader)) is not None}
    in_hand = {leaf: _apply(link_pose(u, leaf, q0, top=roles.hand), pts) for leaf, pts in points.items()}
    return _Fingers(drivers, passive, links, leaves, q0, points, in_hand)


def _tool_point(u: Urdf, hand: str, f: _Fingers, issues: list[Issue]) -> tuple[np.ndarray, np.ndarray, str]:
    """(grasp point, approach axis, source), in the hand frame."""
    origins = np.array([link_pose(u, link, f.q0, top=hand)[:3, 3] for link in f.links])
    tcp_link = next((u.joints[j].child for j in _fixed_subtree(u, hand) if TCP_NAME.search(u.joints[j].child)), None)
    if tcp_link is not None:
        t = link_pose(u, tcp_link, {}, top=hand)
        approach = _snap(t[:3, 3] if np.linalg.norm(t[:3, 3]) > 1e-6 else t[:3, 2])
        return t[:3, 3], approach, f"link {tcp_link}: a fixed child of the hand named like a tool point"
    allpts = np.concatenate(list(f.in_hand.values())) if f.in_hand else None
    centroid = (allpts if allpts is not None else origins).mean(axis=0)
    approach = _snap(centroid) if np.linalg.norm(centroid) > 1e-9 else np.array([0.0, 0.0, 1.0])
    if allpts is None:
        issues.append(warning("tcp_estimated", "no tool-point link and no finger geometry: the grasp point is the "
                                               "gripper joints' midpoint; set tcp_offset", "tcp_offset"))
        return origins.mean(axis=0), approach, "the gripper joints' origins (no tool-point link, no finger geometry)"
    depth = float((allpts @ approach).max())
    tips = [pts[pts @ approach >= (pts @ approach).max() - 1e-3].mean(axis=0) for pts in f.in_hand.values()]  # tip faces
    lateral = np.zeros(3)
    if len(tips) >= 2:
        lateral = np.mean(tips, axis=0)
        lateral -= (lateral @ approach) * approach
    else:
        issues.append(warning("tcp_estimated", "one finger and no tool-point link: the grasp point is assumed on the "
                                               "hand's axis; set tcp_offset if it is not", "tcp_offset"))
    source = (f"finger geometry: the fingertips are {depth:.4f} m along the hand's {_axis_name(approach)}; the grasp "
              f"point sits {PAD_INSET} m above them (Franka's documented TCP is 0.0089 m above its fingertips)")
    return lateral + approach * (depth - PAD_INSET), approach, source


def _closing_axis(u: Urdf, hand: str, f: _Fingers, approach: np.ndarray) -> np.ndarray:
    """The hand axis the first driven finger moves along (perpendicular to the approach)."""
    d = u.joints[f.drivers[0]]
    tj = link_pose(u, d.parent, f.q0, top=hand) @ origin_matrix(d)
    axis = tj[:3, :3] @ (np.asarray(d.axis, dtype=float) / np.linalg.norm(d.axis))
    if d.type == "prismatic":
        close = axis
    else:
        below = {d.child} | {u.joints[j].child for j in u.subtree_joints(d.child)}
        moving = [pts for leaf, pts in f.in_hand.items() if leaf in below]
        tip = (max(np.concatenate(moving), key=lambda p: float(np.linalg.norm(p - tj[:3, 3]))) if moving
               else link_pose(u, d.child, f.q0, top=hand)[:3, 3])
        close = np.cross(axis, tip - tj[:3, 3])
        if np.linalg.norm(close) < 1e-9:
            close = np.cross(axis, approach)
    return _snap(close - (close @ approach) * approach, exclude=int(np.argmax(np.abs(approach))))


def _gripper_values(u: Urdf, hand: str, f: _Fingers, tcp: np.ndarray) -> tuple[dict, dict, str]:
    """Per driven joint: the limit with the fingers farther apart (one finger: farther from the grasp point) is open."""
    tip_local = {leaf: pts[int(np.argmax(np.linalg.norm(pts, axis=1)))] for leaf, pts in f.points.items()}
    opened, closed = {}, {}
    for d in f.drivers:
        lim = u.joints[d].limits

        def gap(v: float) -> float:
            q = {**f.q0, d: v}
            tips = [_apply(link_pose(u, leaf, q, top=hand), tip_local.get(leaf, np.zeros(3))[None])[0]
                    for leaf in f.leaves]
            if len(tips) >= 2:
                return max(float(np.linalg.norm(a - b)) for a, b in itertools.combinations(tips, 2))
            return float(np.linalg.norm(tips[0] - tcp)) if tips else 0.0

        upper_open = gap(lim.upper) >= gap(lim.lower)
        opened[d], closed[d] = (lim.upper, lim.lower) if upper_open else (lim.lower, lim.upper)
    what = "the fingers farther apart" if len(f.leaves) >= 2 else "the finger farther from the grasp point"
    listed = ", ".join(f"{d} {opened[d]}" for d in f.drivers)
    return opened, closed, f"the limit with {what} is open ({listed}); the other limit is closed"


def build_spec(u: Urdf, roles: Roles, robot_id: str, *, mesh_loader: MeshLoader | None = None,
               urdf_path: str | None = None, ros_packages: tuple[tuple[str, str], ...] = ()) -> Resolved:
    """Roles -> RobotSpec. Raises ValueError (naming each error's code) if the roles do not validate."""
    found = validate_roles(u, roles)
    errs = [i for i in found if i.severity == "error"]
    if errs:
        raise ValueError("; ".join(f"{i.code}: {i.message}" for i in errs))
    issues, sources, hand = list(found), {}, roles.hand

    ik = hand  # the importer merges links joined by fixed joints into the one above
    while (pj := u.parent_joint(ik)) is not None and u.joints[pj].type == "fixed":
        ik = u.joints[pj].parent
    sources["ik_link"] = (f"{hand} is the last arm link" if ik == hand else
                          f"{hand} is joined to {ik} by fixed joints, which the URDF importer merges "
                          f"(merge_fixed_joints); IK drives {ik}")

    f = _fingers(u, roles, mesh_loader)
    tcp, approach, tcp_source = _tool_point(u, hand, f, issues)
    derived_tcp = {"link": hand, "offset": [round(float(v), 6) for v in tcp],
                   "approach_axis": [int(v) for v in approach], "source": tcp_source}
    sources["tcp_offset"] = tcp_source
    if roles.tcp_offset is not None:
        tcp, sources["tcp_offset"] = np.asarray(roles.tcp_offset, dtype=float), "roles.tcp_offset (in the hand frame)"

    # tool frame (z = approach, the fingers along y) in the hand frame, then both moved into the IK link's frame
    close = _closing_axis(u, hand, f, approach)
    r_hand_tool = np.column_stack([np.cross(close, approach), close, approach])
    t_ik_hand = link_pose(u, hand, {}, top=ik)
    tcp_ik = t_ik_hand[:3, :3] @ tcp + t_ik_hand[:3, 3]
    hand_in_tool = matrix_to_quat((t_ik_hand[:3, :3] @ r_hand_tool).T)

    opened, closed, gripper_source = _gripper_values(u, hand, f, tcp)
    derived_gripper = {"open": _one(list(opened.values())), "closed": _one(list(closed.values())),
                       "source": gripper_source}
    sources["gripper"] = gripper_source
    for given, values in ((roles.gripper_open, opened), (roles.gripper_closed, closed)):
        if given is not None:
            values.update(given if isinstance(given, dict) else {d: given for d in f.drivers})
            sources["gripper"] = "roles.gripper_open / roles.gripper_closed"

    spec = RobotSpec(
        name=robot_id, arm_joints="|".join(re.escape(j) for j in roles.arm_joints), hand_body=ik,
        finger_joints=tuple(f.drivers), gripper_open=_one([opened[d] for d in f.drivers]),
        gripper_closed=_one([closed[d] for d in f.drivers]), tcp_offset=tuple(round(float(v), 6) for v in tcp_ik),
        hand_in_tool_wxyz=tuple(float(v) for v in hand_in_tool), base_pos=tuple(float(v) for v in roles.mount.pos),
        urdf_path=urdf_path, ros_packages=tuple(ros_packages), passive_finger_joints=tuple(f.passive),
        arm_links=tuple(u.joints[j].child for j in roles.arm_joints) + tuple(f.links), finger_links=tuple(f.links),
    )

    chain = Chain(u, u.root, ik, roles.arm_joints)
    if roles.start_joint_pos is not None:
        arm_q = chain.clip(np.array([roles.start_joint_pos.get(j, 0.0) for j in roles.arm_joints], dtype=float))
        sources["start_joint_pos"] = "roles.start_joint_pos (joints left out start at 0, clipped to their limits)"
    else:
        pos, quat = hand_from_tool(spec, HOME_TCP - np.asarray(roles.mount.pos), DOWN_WXYZ)
        target = np.eye(4)
        target[:3, :3], target[:3, 3] = quat_to_matrix(quat), pos
        sol = chain.solve_best(target, chain.seeds())
        arm_q = sol.q
        x, y, z = HOME_TCP
        sources["start_joint_pos"] = (f"IK for the tool at ({x:g}, {y:g}, {z:g}) pointing down, from the middle of "
                                      f"each joint's range: residual {sol.pos_err * 1000:.1f} mm, {sol.rot_err:.3f} rad")
        if not sol.ok:
            issues.append(warning("start_pose_unsolved", f"the start pose did not converge ({sol.pos_err * 1000:.0f} "
                                                         f"mm, {sol.rot_err:.2f} rad off); set start_joint_pos",
                                  "start_joint_pos"))
    fingers = dict(opened)
    for j in f.passive:
        m = u.joints[j].mimic
        fingers[j] = m.multiplier * fingers[m.joint] + m.offset
    start = {j: float(v) for j, v in zip(roles.arm_joints, arm_q)} | {j: float(v) for j, v in fingers.items()}
    spec = RobotSpec(**{**spec.__dict__, "init_joint_pos": start})

    first = u.joints[roles.arm_joints[0]]
    reach = float(sum(np.linalg.norm(u.joints[j].origin.xyz) for j in (u.path(first.child, ik) or []))
                  + np.linalg.norm(tcp_ik))
    shoulder = (link_pose(u, first.parent, {}) @ origin_matrix(first))[:3, 3] + np.asarray(roles.mount.pos)
    xs = (min(WORKSPACE.cube_x[0], WORKSPACE.bin_x[0]), max(WORKSPACE.cube_x[1], WORKSPACE.bin_x[1]))
    ys = (min(WORKSPACE.cube_y[0], WORKSPACE.bin_y[0]), max(WORKSPACE.cube_y[1], WORKSPACE.bin_y[1]))
    far = max(float(np.linalg.norm(np.array([x, y, 0.025]) - shoulder)) for x in xs for y in ys)
    if reach < far:
        issues.append(warning("reach_short", f"the arm reaches about {reach:.2f} m from its first joint, but the far "
                                             f"corner of the workspace is {far:.2f} m away; move the mount closer",
                              "mount"))
    derived = {
        "dof": len(roles.arm_joints),
        "reach_m": {"value": round(reach, 3),
                    "source": "sum of joint-origin distances from the first arm joint to the tool point"},
        "tcp": derived_tcp,
        "gripper": derived_gripper,
    }
    return Resolved(spec, sources, derived, _dedupe(issues))
