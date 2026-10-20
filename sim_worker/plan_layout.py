"""A ScenePlan (demo_pipeline.scene_plan) as the Isaac scene's bodies: every cube and every bin's five boxes, with
their scene names and prims, sizes, colours, masses, spawn points, poses and contact sensors. Pure (no Isaac):
plan_scene.py turns a layout into the Isaac scene config and places it; replay.py records every cube from it.

Today's one cube + one bin keeps today's names ("cube" / "Cube", "bin_floor" / "BinFloor", ...; scene_parts.py), so
its layout is exactly what scene_cfg.py builds and placement.py places (tests/test_sim_plan_layout.py). Other plans
name each cube "cube_<id>" ("Cube_<id>") and each bin's boxes "bin_<id>_<part>" ("Bin_<id>_<Part>"), spawn every
body where the plan puts it (so nothing overlaps before placement), and give each cube today's density.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np

from demo_pipeline.goals import Container
from demo_pipeline.scene_geometry import BIN_INNER, CUBE_SIZE
from demo_pipeline.scene_plan import COLORS, ScenePlan, resolve, validate_plan
from demo_pipeline.schemas import Pose, Scene

from . import scene_parts as P

Vec3 = tuple[float, float, float]


@dataclass(frozen=True)
class Body:
    name: str  # the scene entity (scene config attribute, scene["<name>"])
    prim: str  # under {ENV_REGEX_NS}/
    object_id: str  # the plan's cube or bin
    kind: Literal["cube", "bin_part"]
    size: Vec3  # box edges, m, in the body's frame
    color: Vec3
    mass: float | None  # kg (cubes); bins are kinematic
    spawn: Vec3  # init_state position in the scene config
    pos: Vec3  # placed position, env frame (placement at reset)
    quat_wxyz: tuple[float, float, float, float]
    contact: str  # its contact sensor's scene name
    contact_filter: Literal["fingers", "arm"]  # what the sensor is filtered against

    @property
    def dynamic(self) -> bool:
        return self.kind == "cube"


@dataclass(frozen=True)
class SceneLayout:
    bodies: tuple[Body, ...]
    legacy: bool  # today's names (one cube, one bin)
    bins: tuple[tuple[str, Pose, tuple[float, float, float]], ...]  # (bin id, pose of its frame, inner size)

    def body(self, name: str) -> Body:
        for b in self.bodies:
            if b.name == name:
                return b
        raise KeyError(f"no body {name!r} in the layout")

    def cube(self, obj_id: str) -> Body:
        for b in self.bodies:
            if b.kind == "cube" and b.object_id == obj_id:
                return b
        raise KeyError(f"no cube {obj_id!r} in the layout")

    def cube_ids(self) -> list[str]:
        return [b.object_id for b in self.bodies if b.kind == "cube"]

    def bin_ids(self) -> list[str]:
        return [b[0] for b in self.bins]

    def arm_contact_sensors(self) -> dict[str, tuple[str, ...]]:
        """The sensors whose force on the arm counts as a collision (replay's ARM_CONTACT_SENSORS)."""
        return {"table": ("table_contact",), "bin": tuple(b.contact for b in self.bodies if b.kind == "bin_part")}

    def containers(self) -> dict[str, Container]:
        """The bins, for demo_pipeline.goals."""
        return {bid: Container(bid, pose, inner) for bid, pose, inner in self.bins}


def _yaw_quat(deg: float) -> tuple[float, float, float, float]:
    r = math.radians(deg)
    return (math.cos(r / 2), 0.0, 0.0, math.sin(r / 2))


def _rotate(q, v) -> np.ndarray:
    """v rotated by the (w, x, y, z) quaternion (placement.yaw_rotate, without its torch import)."""
    w, x, y, z = q
    rot = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])
    return rot @ np.asarray(v, dtype=float)


def _vec(v) -> Vec3:
    return (float(v[0]), float(v[1]), float(v[2]))


def cube_mass(size: float) -> float:
    """Today's cube's density (CUBE_MASS for a CUBE_SIZE cube) at another size."""
    return P.CUBE_MASS if size == CUBE_SIZE else P.CUBE_MASS * (size / CUBE_SIZE) ** 3


def _bin_bodies(bin_id: str, pose: Pose, inner, color, legacy: bool) -> list[Body]:
    out = []
    for part, (size, centre) in P.bin_parts(tuple(inner)).items():
        name = f"bin_{part}" if legacy else f"bin_{bin_id}_{part}"
        prim = P.BIN_PRIMS[name] if legacy else f"Bin_{bin_id}_{_part_prim(part)}"
        pos = _vec(np.asarray(pose.pos) + _rotate(pose.quat_wxyz, centre))
        out.append(Body(name, prim, bin_id, "bin_part", _vec(size), _vec(color), None,
                        _vec(centre) if legacy else pos, pos, tuple(pose.quat_wxyz), f"{name}_contact", "arm"))
    return out


def _part_prim(part: str) -> str:
    """floor -> Floor, wall_px -> WallPX (today's prim spelling, BinWallPX)."""
    if part == "floor":
        return "Floor"
    return "Wall" + part.split("_")[1].upper()


def layout_for_plan(plan: ScenePlan) -> SceneLayout:
    errors = validate_plan(plan)
    if errors:
        raise ValueError("the plan can't be built: " + "; ".join(errors))
    placed = resolve(plan)
    cubes = [o for o in plan.objects if o.kind == "cube"]
    bins = [o for o in plan.objects if o.kind == "bin"]
    legacy = len(cubes) == 1 and len(bins) == 1 and cubes[0].on is None
    bodies: list[Body] = []
    for c in cubes:
        p = placed[c.id]
        name, prim = ("cube", "Cube") if legacy else (f"cube_{c.id}", f"Cube_{c.id}")
        size = (float(c.size),) * 3
        spawn = (*P.CUBE_SPAWN_XY, c.size / 2) if legacy else _vec(p.pos)
        bodies.append(Body(name, prim, c.id, "cube", size, _vec(COLORS[c.color]), cube_mass(c.size), _vec(spawn),
                           _vec(p.pos), _yaw_quat(p.yaw_deg), f"{name}_contact", "fingers"))
    bin_rows = []
    for b in bins:
        p = placed[b.id]
        pose = Pose(pos=_vec(p.pos), quat_wxyz=_yaw_quat(p.yaw_deg))
        bodies.extend(_bin_bodies(b.id, pose, b.inner, COLORS[b.color], legacy))
        bin_rows.append((b.id, pose, tuple(float(v) for v in b.inner)))
    return SceneLayout(tuple(bodies), legacy, tuple(bin_rows))


def layout_for_scene(scene: Scene) -> SceneLayout:
    """Today's Scene (one CUBE_SIZE red cube "cube", one BIN_INNER blue bin "bin"), straight from its poses."""
    cube = Body("cube", "Cube", "cube", "cube", (CUBE_SIZE,) * 3, P.RED, P.CUBE_MASS, (*P.CUBE_SPAWN_XY, CUBE_SIZE / 2),
                _vec(scene.cube_pose.pos), tuple(scene.cube_pose.quat_wxyz), "cube_contact", "fingers")
    bp = Pose(pos=_vec(scene.bin_pose.pos), quat_wxyz=tuple(scene.bin_pose.quat_wxyz))
    return SceneLayout((cube, *_bin_bodies("bin", bp, BIN_INNER, P.BLUE, legacy=True)), True, (("bin", bp, BIN_INNER),))
