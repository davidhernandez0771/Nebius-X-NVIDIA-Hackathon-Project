"""ScenePlan: a pick-place scene as data (cubes, bins, goals, the robot's reach), and the code check that it can be
built and done. Nemotron writes plans from a sentence (app.ai.scene_creator); validate_plan's errors go back to it.

World frame as in the Isaac scene: metres, the robot base at the origin facing +x, the table top at z = 0, +y is the
robot's left. A table object has a pose (x, y, yaw); a cube can instead sit "on" another cube, centred on it unless
it gives its own x, y. Heights are never written: they follow from the table and the stack.

Today's scene (one red CUBE_SIZE cube, one blue BIN_INNER bin) is ScenePlan.from_scene(scene), and to_scene()
turns it back into the Scene the sim worker builds. numpy + pydantic only.
"""

from __future__ import annotations

import math
from typing import Annotated, Literal, NamedTuple, Union

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .multiply import SCENE_RANGES
from .scene_geometry import BIN_INNER, BIN_WALL, CUBE_SIZE
from .schemas import Pose, RobotName, Scene

PLAN_VERSION = 1
# Named colours (RGB 0-1). Red and blue are the Isaac scene's cube and bin colours (sim_worker/scene_cfg.py).
COLORS: dict[str, tuple[float, float, float]] = {
    "red": (0.85, 0.05, 0.05), "blue": (0.05, 0.2, 0.85), "green": (0.1, 0.7, 0.15), "yellow": (0.95, 0.85, 0.1),
    "orange": (0.95, 0.45, 0.05), "purple": (0.5, 0.15, 0.7), "white": (0.95, 0.95, 0.95), "black": (0.05, 0.05, 0.05),
}
Color = Literal["red", "blue", "green", "yellow", "orange", "purple", "white", "black"]
ObjectId = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")]

CUBE_SIZE_RANGE = (0.03, 0.07)  # m; the Franka's fingers open to 0.08 m
BIN_SIDE_RANGE = (0.10, 0.30)  # m, inside length and width
BIN_HEIGHT_RANGE = (0.04, 0.12)  # m, inside wall height
MIN_GAP = 0.03  # m between table-level footprints: room for a finger beside a cube
GAP_TOL = 1e-6  # m; a layout at exactly MIN_GAP passes despite float error
STACK_CENTRE_FRAC = 0.2  # a stacked cube stands if its centre is within this fraction of the smaller cube's size
BIN_FIT_MARGIN = 0.01  # m of floor around each cube in a bin
Z_MAX = 0.25  # m, the highest a stack's top may be


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TablePose(_Model):
    x: float = Field(ge=-1.0, le=1.0)
    y: float = Field(ge=-1.0, le=1.0)
    yaw_deg: float = Field(0.0, ge=-180.0, le=180.0)


class CubeSpec(_Model):
    id: ObjectId
    kind: Literal["cube"]
    color: Color
    size: float = Field(CUBE_SIZE, ge=CUBE_SIZE_RANGE[0], le=CUBE_SIZE_RANGE[1])  # edge, m
    pose: TablePose | None = None  # on the table, or (with "on") the stacked cube's own x, y
    on: ObjectId | None = None  # the cube it sits on

    @model_validator(mode="after")
    def _placed(self) -> "CubeSpec":
        if self.pose is None and self.on is None:
            raise ValueError(f"cube {self.id!r} needs a pose (on the table) or 'on' (the cube it sits on)")
        return self


class BinSpec(_Model):
    id: ObjectId
    kind: Literal["bin"]
    color: Color
    inner: tuple[float, float, float] = BIN_INNER  # inside length (x), width (y), wall height, m
    pose: TablePose

    @field_validator("inner")
    @classmethod
    def _sane(cls, v):
        (lo, hi), (hlo, hhi) = BIN_SIDE_RANGE, BIN_HEIGHT_RANGE
        if not (lo <= v[0] <= hi and lo <= v[1] <= hi and hlo <= v[2] <= hhi):
            raise ValueError(f"bin inner size {v} is outside {lo}-{hi} m (sides) / {hlo}-{hhi} m (height)")
        return v


ObjectSpec = Annotated[Union[CubeSpec, BinSpec], Field(discriminator="kind")]


class Goal(_Model):
    object: ObjectId  # a cube
    bin: ObjectId


class ReachEnvelope(_Model):
    """Where object centres may be (world xy box) and how high a stack may reach."""

    x: tuple[float, float]
    y: tuple[float, float]
    z_max: float = Field(Z_MAX, gt=0.0, le=0.6)

    @field_validator("x", "y")
    @classmethod
    def _ordered(cls, v):
        if not v[0] < v[1]:
            raise ValueError(f"range {v} must go from low to high")
        return v


def robot_reach(robot: RobotName) -> ReachEnvelope:
    """The robot's tested scene ranges (multiply.SCENE_RANGES): the box around its cube and bin ranges."""
    r = SCENE_RANGES[robot]
    return ReachEnvelope(x=(min(r.cube_x[0], r.bin_x[0]), max(r.cube_x[1], r.bin_x[1])),
                         y=(min(r.cube_y[0], r.bin_y[0]), max(r.cube_y[1], r.bin_y[1])))


class ScenePlan(_Model):
    version: Literal[1] = PLAN_VERSION
    robot: RobotName = "franka"
    objects: list[ObjectSpec] = Field(min_length=2, max_length=10)
    goals: list[Goal] = Field(min_length=1, max_length=8)  # done in this order
    reach: ReachEnvelope | None = None  # None = the robot's own (robot_reach)

    @model_validator(mode="after")
    def _unique_ids(self) -> "ScenePlan":
        ids = [o.id for o in self.objects]
        dup = sorted({i for i in ids if ids.count(i) > 1})
        if dup:
            raise ValueError(f"object ids must be unique; repeated: {dup}")
        if self.reach is None:
            self.reach = robot_reach(self.robot)
        return self

    def object(self, obj_id: str) -> CubeSpec | BinSpec:
        return next(o for o in self.objects if o.id == obj_id)

    @classmethod
    def from_scene(cls, scene: Scene) -> "ScenePlan":
        """Today's one-cube, one-bin Scene as a plan: a red CUBE_SIZE cube "cube" goes into a blue BIN_INNER bin "bin"."""
        cube_yaw, bin_yaw = _yaw_deg(scene.cube_pose.quat_wxyz), _yaw_deg(scene.bin_pose.quat_wxyz)
        if abs(scene.cube_pose.pos[2] - CUBE_SIZE / 2) > 1e-3 or abs(scene.bin_pose.pos[2]) > 1e-3:
            raise ValueError("the cube must rest on the table and the bin stand on it")
        cx, cy, _ = scene.cube_pose.pos
        bx, by, _ = scene.bin_pose.pos
        return cls(robot=scene.robot, objects=[
            CubeSpec(id="cube", kind="cube", color="red", size=CUBE_SIZE, pose=TablePose(x=cx, y=cy, yaw_deg=cube_yaw)),
            BinSpec(id="bin", kind="bin", color="blue", inner=BIN_INNER, pose=TablePose(x=bx, y=by, yaw_deg=bin_yaw)),
        ], goals=[Goal(object="cube", bin="bin")])

    @classmethod
    def default(cls) -> "ScenePlan":
        """Today's scene with the cube and bin at the middle of the Franka's sampling ranges."""
        return cls.from_scene(Scene(cube_pose=Pose(pos=(0.50, 0.10, CUBE_SIZE / 2), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                                    bin_pose=Pose(pos=(0.55, -0.20, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)),
                                    robot="franka", seed=0))

    def to_scene(self, seed: int) -> Scene:
        """The Scene the sim worker builds today. Only for one table cube of CUBE_SIZE and one BIN_INNER bin."""
        cubes = [o for o in self.objects if o.kind == "cube"]
        bins = [o for o in self.objects if o.kind == "bin"]
        if len(cubes) != 1 or len(bins) != 1:
            raise ValueError(f"today's sim scene has one cube and one bin; this plan has {len(cubes)} and {len(bins)}")
        cube, box = cubes[0], bins[0]
        if cube.on is not None or cube.size != CUBE_SIZE or tuple(box.inner) != BIN_INNER:
            raise ValueError("today's sim scene has a table cube of CUBE_SIZE and a BIN_INNER bin")
        return Scene(cube_pose=Pose(pos=(cube.pose.x, cube.pose.y, CUBE_SIZE / 2), quat_wxyz=_yaw_quat(cube.pose.yaw_deg)),
                     bin_pose=Pose(pos=(box.pose.x, box.pose.y, 0.0), quat_wxyz=_yaw_quat(box.pose.yaw_deg)),
                     robot=self.robot, seed=seed)


def _yaw_deg(q) -> float:
    w, x, y, z = q
    if abs(x) > 1e-6 or abs(y) > 1e-6:
        raise ValueError(f"quaternion {tuple(q)} is not a pure yaw")
    return math.degrees(math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))


def _yaw_quat(deg: float) -> tuple[float, float, float, float]:
    r = math.radians(deg)
    return (math.cos(r / 2), 0.0, 0.0, math.sin(r / 2))


# --- where everything ends up --------------------------------------------------------------------------

class Placed(NamedTuple):
    pos: tuple[float, float, float]  # cube: centre; bin: centre of the floor's underside
    yaw_deg: float
    half_xy: tuple[float, float]  # footprint half-sizes in the object's own frame
    top_z: float
    support: str | None  # the cube it sits on, None on the table


class StackError(ValueError):
    pass


def _footprint(o: CubeSpec | BinSpec) -> tuple[float, float]:
    if o.kind == "cube":
        return o.size / 2, o.size / 2
    return o.inner[0] / 2 + BIN_WALL, o.inner[1] / 2 + BIN_WALL


def resolve(plan: ScenePlan) -> dict[str, Placed]:
    """Every object's world pose. Raises StackError for a stack that can't be built (unknown support, a bin as
    support, a loop); validate_plan reports those as errors instead."""
    by_id = {o.id: o for o in plan.objects}
    out: dict[str, Placed] = {}

    def place(oid: str, chain: tuple[str, ...]) -> Placed:
        if oid in out:
            return out[oid]
        o = by_id[oid]
        if o.kind == "bin":
            p = Placed((o.pose.x, o.pose.y, 0.0), o.pose.yaw_deg, _footprint(o), BIN_WALL + o.inner[2], None)
        elif o.on is None:
            p = Placed((o.pose.x, o.pose.y, o.size / 2), o.pose.yaw_deg, _footprint(o), o.size, None)
        else:
            if o.on in chain:
                raise StackError(f"the stack {' -> '.join(chain + (o.on,))} is a loop")
            if o.on not in by_id:
                raise StackError(f"{oid} sits on {o.on!r}, but there is no object {o.on!r}")
            if by_id[o.on].kind != "cube":
                raise StackError(f"{oid} sits on {o.on}, a bin; cubes stack only on cubes "
                                 "(to start a cube inside a bin, that isn't supported yet)")
            s = place(o.on, chain + (oid,))
            x, y = (o.pose.x, o.pose.y) if o.pose else s.pos[:2]
            yaw = o.pose.yaw_deg if o.pose else s.yaw_deg
            p = Placed((x, y, s.top_z + o.size / 2), yaw, _footprint(o), s.top_z + o.size, o.on)
        out[oid] = p
        return p

    for o in plan.objects:
        place(o.id, (o.id,))
    return out


# --- footprint geometry ---------------------------------------------------------------------------------

def _corners(p: Placed) -> np.ndarray:
    c, s = math.cos(math.radians(p.yaw_deg)), math.sin(math.radians(p.yaw_deg))
    hx, hy = p.half_xy
    local = np.array([[hx, hy], [-hx, hy], [-hx, -hy], [hx, -hy]])
    return local @ np.array([[c, s], [-s, c]]) + np.asarray(p.pos[:2])


def _overlap(a: np.ndarray, b: np.ndarray) -> bool:
    """Separating-axis test for two convex polygons [K, 2]."""
    for poly in (a, b):
        for i in range(len(poly)):
            edge = poly[(i + 1) % len(poly)] - poly[i]
            axis = np.array([-edge[1], edge[0]])
            pa, pb = a @ axis, b @ axis
            if pa.max() < pb.min() or pb.max() < pa.min():
                return False
    return True


def _point_segment(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    ab = b - a
    t = np.clip((p - a) @ ab / (ab @ ab), 0.0, 1.0)
    return float(np.linalg.norm(p - (a + t * ab)))


def _extent(p: Placed) -> str:
    c = _corners(p)
    (x0, y0), (x1, y1) = c.min(axis=0), c.max(axis=0)
    return f"x {x0:.3f} to {x1:.3f}, y {y0:.3f} to {y1:.3f}"


def separation_fix(placed: dict[str, Placed], a: str, b: str, reach: ReachEnvelope,
                   conflicts: dict[str, int] | None = None) -> str | None:
    """The smallest single move along x or y that leaves MIN_GAP between a's and b's bounding boxes and keeps the
    moved centre in reach, as "move <id> to x 0.565 (+6.5 cm)"; None if no such move exists. With `conflicts`
    (object -> how many objects it is too close to), the one with fewer conflicts moves when it can: in a squeezed
    row the outer objects move out, instead of the middle one being told to go both ways."""
    order = [(a, b), (b, a)]
    if conflicts and conflicts.get(b, 0) < conflicts.get(a, 0):
        order.reverse()
    if conflicts and conflicts.get(a, 0) != conflicts.get(b, 0):
        for pair in order:
            fix = _best_move(placed, *pair, reach)
            if fix:
                return fix
        return None
    moves = [m for m in (_best_move(placed, *pair, reach, raw=True) for pair in order) if m]
    if not moves:
        return None
    shift, mover, name, target = min(moves, key=lambda m: abs(m[0]))
    return f"move {mover} to {name} {target:.3f} ({shift * 100:+.1f} cm)"


def _best_move(placed: dict[str, Placed], mover: str, other: str, reach: ReachEnvelope, raw: bool = False):
    """The smallest in-reach move of `mover` alone that clears `other` (a tuple when raw, else the sentence)."""
    best = None
    m, o = _corners(placed[mover]), _corners(placed[other])
    for axis, name, (lo, hi) in ((0, "x", reach.x), (1, "y", reach.y)):
        for shift in (o[:, axis].max() + MIN_GAP - m[:, axis].min(), o[:, axis].min() - MIN_GAP - m[:, axis].max()):
            target = placed[mover].pos[axis] + shift
            if lo <= target <= hi and (best is None or abs(shift) < abs(best[0])):
                best = (shift, mover, name, target)
    if best is None or raw:
        return best
    shift, mover, name, target = best
    return f"move {mover} to {name} {target:.3f} ({shift * 100:+.1f} cm)"


def footprint_gap(a: Placed, b: Placed) -> float:
    """Distance between two footprints on the table (0 when they overlap)."""
    ca, cb = _corners(a), _corners(b)
    if _overlap(ca, cb):
        return 0.0
    return min(_point_segment(p, poly[i], poly[(i + 1) % 4])
               for pts, poly in ((ca, cb), (cb, ca)) for p in pts for i in range(4))


# --- the validator --------------------------------------------------------------------------------------

def _stack_count(placed: dict[str, Placed], top: str) -> int:
    n, oid = 1, top
    while placed[oid].support is not None:
        n, oid = n + 1, placed[oid].support
    return n


def _bin_capacity(box: BinSpec, size: float) -> int:
    per = size + BIN_FIT_MARGIN
    return math.floor(box.inner[0] / per + 1e-9) * math.floor(box.inner[1] / per + 1e-9)


def validate_plan(plan: ScenePlan) -> list[str]:
    """Readable problems that would stop the scene being built or the task being done; [] = fine.

    Checks: object centres inside the reach envelope; table footprints at least MIN_GAP apart; stacks on cubes,
    centred, one cube per support, below z_max; goals naming a real cube and bin, each cube once, a cube's
    top cleared before it moves, and every cube fitting its bin.
    """
    errors: list[str] = []
    by_id = {o.id: o for o in plan.objects}
    reach = plan.reach
    try:
        placed = resolve(plan)
    except StackError as e:
        errors.append(str(e))
        placed = {}
    on_any = {p.support for p in placed.values() if p.support}  # cubes with something on top

    for oid, p in placed.items():
        x, y, _ = p.pos
        if p.support is None and not (reach.x[0] <= x <= reach.x[1] and reach.y[0] <= y <= reach.y[1]):
            errors.append(f"{oid} is at x {x:.2f}, y {y:.2f} m, out of reach: the {plan.robot} reaches x "
                          f"{reach.x[0]:.2f} to {reach.x[1]:.2f} m and y {reach.y[0]:.2f} to {reach.y[1]:.2f} m")
        if p.top_z > reach.z_max and oid not in on_any:
            n = _stack_count(placed, oid)
            fits = math.floor(reach.z_max / n * 1000) / 1000  # the largest cube edge, to the mm, that keeps all n
            keep = (f"to keep all {n} cubes, make each at most {fits * 100:.1f} cm"
                    if fits >= CUBE_SIZE_RANGE[0] else f"{n} cubes don't fit even at {CUBE_SIZE_RANGE[0] * 100:.0f} cm")
            errors.append(f"the stack under {oid} is too tall: its {n} cubes reach {p.top_z:.2f} m, the limit is "
                          f"{reach.z_max:.2f} m; {keep}")

    table = [oid for oid, p in placed.items() if p.support is None]
    pairs = [(a, b) for i, a in enumerate(table) for b in table[i + 1:]]
    gaps = {(a, b): footprint_gap(placed[a], placed[b]) for a, b in pairs}
    conflicts = {oid: sum(oid in pair for pair, g in gaps.items() if g < MIN_GAP - GAP_TOL) for oid in table}
    for a, b in pairs:
        gap = gaps[(a, b)]
        if gap >= MIN_GAP - GAP_TOL:
            continue
        where = f" ({a} covers {_extent(placed[a])}; {b} covers {_extent(placed[b])})"
        fix = separation_fix(placed, a, b, reach, conflicts)
        where += f"; smallest fix: {fix}" if fix else "; no single move within reach separates them"
        if gap == 0.0:
            errors.append(f"{a} and {b} overlap on the table{where}")
        else:
            errors.append(f"{a} and {b} are {gap * 100:.1f} cm apart; leave at least {MIN_GAP * 100:.0f} cm so "
                          f"the fingers fit{where}")

    on_top: dict[str, list[str]] = {}
    for oid, p in placed.items():
        if p.support is not None:
            on_top.setdefault(p.support, []).append(oid)
            s = placed[p.support]
            off = math.dist(p.pos[:2], s.pos[:2])
            limit = STACK_CENTRE_FRAC * min(by_id[oid].size, by_id[p.support].size)
            if off > limit:
                errors.append(f"{oid} sits {off * 100:.1f} cm off the centre of {p.support}; a stack stands reliably "
                              f"only within {limit * 100:.1f} cm")
    for support, tops in on_top.items():
        if len(tops) > 1:
            errors.append(f"{' and '.join(tops)} both sit on {support}; only one cube fits on top of another")

    seen: set[str] = set()
    into: dict[str, list[str]] = {}
    moved: set[str] = set()
    for n, g in enumerate(plan.goals, start=1):
        bad = False
        for name, want in ((g.object, "cube"), (g.bin, "bin")):
            if name not in by_id:
                errors.append(f"goal {n} names {name!r}, but there is no object {name!r}")
                bad = True
            elif by_id[name].kind != want:
                errors.append(f"goal {n} uses {name!r} as a {want}, but it is not a {want}")
                bad = True
        if g.object in seen:
            errors.append(f"goal {n} moves {g.object} more than once")
            bad = True
        seen.add(g.object)
        if bad:
            continue
        for top in on_top.get(g.object, []):
            if top not in moved:
                errors.append(f"goal {n} moves {g.object}, but {top} is still on top of it; move {top} first")
        moved.add(g.object)
        cube, box = by_id[g.object], by_id[g.bin]
        if cube.size + 2 * BIN_FIT_MARGIN > min(box.inner[:2]):
            errors.append(f"{g.object} ({cube.size * 100:.0f} cm) doesn't fit in {g.bin} "
                          f"({box.inner[0] * 100:.0f} x {box.inner[1] * 100:.0f} cm inside)")
        into.setdefault(g.bin, []).append(g.object)
    for bin_id, cubes in into.items():
        cap = _bin_capacity(by_id[bin_id], max(by_id[c].size for c in cubes))
        if len(cubes) > cap:
            errors.append(f"{len(cubes)} cubes go into {bin_id}, which holds {cap} side by side")
    return errors
