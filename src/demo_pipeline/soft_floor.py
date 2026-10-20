"""The soft floor: a record-time safety limit on the teleop target (on by default; the Record page's "soft floor").

Live webcam demos pressed the gripper into the bin at 75-927 N (9 of 10): the person can't feel the arm push. So
while recording, the tool target the sim worker applies can't go lower than:
  - FLOOR_BELOW_RIM under the bin's rim inside the bin's footprint (widened by FOOTPRINT_MARGIN, so fingers that
    straddle a wall also stop at the rim), or
  - the table top everywhere else.
The heights come from scene_geometry and the scene's bin pose; nothing is per demo. The target is the tool point
(the fingertip centre, sim_worker.robots tcp_offset), in the env frame (metres, z up). A held cube can still be
placed: its centre is then ~1 cm under the rim, well below check_success's 0.18 m high-release limit.

Demos recorded with it carry Demo.assist (soft_floor, how many recorded steps it held the target, and the zones that
were active), so assisted demos stay labelled. Pure numpy: no Isaac.

Assist zones generalize it to any scene. A Zone is a footprint (centre, yaw, half-sizes) with the lowest tool z
allowed inside it; a point's floor is the highest floor of the zones that contain it, and the table top elsewhere.
- Geometry (always on): each bin's rim rule at its own size and yaw (bin_zone), and the top of a cube that is a
  placement target (cube_top_zone: the held cube rests on it). zones_for_scene() is today's one bin; zones_for_plan()
  a ScenePlan's bins.
- Semantic zones (demo_pipeline.assist_rules, from Nemotron or the rules fallback) only add floors, keep-outs and
  speed caps on top: they can raise a floor, never lower one.
floor_z() and clamp_to_floor() are today's single bin through the same zones (tests/test_assist_zones.py).
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Literal

import numpy as np

from .schemas import Pose
from .scene_geometry import BIN_INNER, BIN_WALL, TABLE_TOP_Z

if TYPE_CHECKING:
    from .scene_plan import ScenePlan

FLOOR_BELOW_RIM = 0.01  # m: the target may go this far under the rim inside the bin
FOOTPRINT_MARGIN = 0.02  # m: the finger pads' half width and a little more, around the bin's outside


def _rotation(quat_wxyz) -> np.ndarray:
    w, x, y, z = quat_wxyz
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


ZoneKind = Literal["bin", "cube_top", "release", "keep_out", "slow"]
ZoneSource = Literal["geometry", "rules", "nemotron"]


@dataclass(frozen=True)
class Zone:
    id: str  # geometry: "bin:<id>", "top:<id>"; rules: "release:<id>@<source>", "keep_out:<id>@<source>", "slow:<id>@<source>"
    kind: ZoneKind
    center: tuple[float, float]  # world x, y
    yaw: float  # rad about z
    half: tuple[float, float]  # footprint half-sizes in its own frame, margins included
    floor: float  # the lowest tool z inside (TABLE_TOP_Z for a zone that only caps speed)
    source: ZoneSource = "geometry"
    speed_cap: float | None = None  # m/s while the target is inside

    def contains(self, pos) -> bool:
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        dx, dy = float(pos[0]) - self.center[0], float(pos[1]) - self.center[1]
        lx, ly = c * dx + s * dy, -s * dx + c * dy  # world -> zone frame
        return abs(lx) <= self.half[0] and abs(ly) <= self.half[1]


@dataclass(frozen=True)
class AssistZones:
    zones: tuple[Zone, ...]
    source: ZoneSource = "geometry"  # the strongest source that added a zone
    table_z: float = TABLE_TOP_Z

    def zone(self, zone_id: str) -> Zone:
        return next(z for z in self.zones if z.id == zone_id)

    def floor_at(self, pos) -> float:
        """The lowest tool z allowed at this x, y (the z of `pos` is ignored)."""
        return max([self.table_z] + [z.floor for z in self.zones if z.contains(pos)])

    def clamp(self, pos) -> tuple[tuple[float, float, float], bool, str | None]:
        """The target raised to the floor if it is below it, whether it was, and the zone that held it."""
        p = (float(pos[0]), float(pos[1]), float(pos[2]))
        holding = [z for z in self.zones if z.contains(p) and z.floor > p[2]]
        if p[2] >= self.table_z and not holding:
            return p, False, None
        floor = self.floor_at(p)
        top = max(holding, key=lambda z: z.floor).id if holding and floor > self.table_z else None
        return (p[0], p[1], floor), True, top

    def speed_cap_at(self, pos) -> float | None:
        caps = [z.speed_cap for z in self.zones if z.speed_cap is not None and z.contains(pos)]
        return min(caps) if caps else None

    def to_dict(self) -> dict:
        return {"source": self.source, "table_z": self.table_z,
                "zones": [{**asdict(z), "center": list(z.center), "half": list(z.half)} for z in self.zones]}

    @classmethod
    def from_dict(cls, d: dict) -> "AssistZones":
        zones = tuple(Zone(**{**z, "center": tuple(z["center"]), "half": tuple(z["half"])}) for z in d["zones"])
        return cls(zones, d["source"], d["table_z"])


def _yaw_of(quat_wxyz) -> float:
    w, x, y, z = quat_wxyz
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def bin_zone(bin_id: str, bin_pose: Pose, inner=BIN_INNER) -> Zone:
    """A bin's rim rule: inside its outside footprint plus FOOTPRINT_MARGIN, FLOOR_BELOW_RIM under its rim."""
    rot = _rotation(bin_pose.quat_wxyz)
    origin = np.asarray(bin_pose.pos, dtype=float)
    rim = origin + rot @ np.array([0.0, 0.0, BIN_WALL + inner[2]])
    half = (inner[0] / 2 + BIN_WALL + FOOTPRINT_MARGIN, inner[1] / 2 + BIN_WALL + FOOTPRINT_MARGIN)
    return Zone(f"bin:{bin_id}", "bin", (float(origin[0]), float(origin[1])), _yaw_of(bin_pose.quat_wxyz), half,
                float(rim[2] - FLOOR_BELOW_RIM))


def cube_top_zone(cube_id: str, center, yaw: float, size: float, top_z: float, held_size: float) -> Zone:
    """A cube that is a placement target: over its top (plus FOOTPRINT_MARGIN), the held cube (held_size) rests on it,
    so the tool (the held cube's centre) stops half held_size above the top."""
    return Zone(f"top:{cube_id}", "cube_top", (float(center[0]), float(center[1])), yaw,
                (size / 2 + FOOTPRINT_MARGIN, size / 2 + FOOTPRINT_MARGIN), top_z + held_size / 2)


def zones_for_scene(scene) -> AssistZones:
    """Today's scene: its one BIN_INNER bin; the table everywhere else."""
    return AssistZones((bin_zone("bin", scene.bin_pose),))


def zones_for_plan(plan: "ScenePlan", cube_targets=()) -> AssistZones:
    """A ScenePlan's geometric zones: every bin's rim rule, and the top of each cube in cube_targets (the largest
    cube a goal moves rests on it)."""
    from .scene_plan import resolve

    placed = resolve(plan)
    by_id = {o.id: o for o in plan.objects}
    zones = []
    for o in plan.objects:
        if o.kind == "bin":
            p = placed[o.id]
            pose = Pose(pos=p.pos, quat_wxyz=(math.cos(math.radians(p.yaw_deg) / 2), 0.0, 0.0, math.sin(math.radians(p.yaw_deg) / 2)))
            zones.append(bin_zone(o.id, pose, tuple(o.inner)))
    # The cube that will rest on a target: the largest one a goal moves (any cube if no goal moves one).
    moved = {g.object for g in plan.goals}
    biggest = max((o.size for o in plan.objects if o.kind == "cube" and o.id in moved), default=0.0) or max(
        (o.size for o in plan.objects if o.kind == "cube"), default=0.0)
    for cid in cube_targets:
        o = by_id.get(cid)
        if o is None or o.kind != "cube":
            raise ValueError(f"{cid!r} is not a cube in the plan")
        p = placed[cid]
        zones.append(cube_top_zone(cid, p.pos[:2], math.radians(p.yaw_deg), o.size, p.top_z, biggest))
    return AssistZones(tuple(zones))


def floor_z(pos, bin_pose: Pose) -> float:
    """The lowest target z allowed at this x, y for today's single bin (the z of `pos` is ignored)."""
    return AssistZones((bin_zone("bin", bin_pose),)).floor_at(pos)


def clamp_to_floor(pos, bin_pose: Pose) -> tuple[tuple[float, float, float], bool]:
    """The target raised to the floor if it is below it, and whether it was (today's single bin)."""
    pos, held, _zone = AssistZones((bin_zone("bin", bin_pose),)).clamp(pos)
    return pos, held
