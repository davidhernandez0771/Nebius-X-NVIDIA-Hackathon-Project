"""The pick-place scene's bodies as plain numbers: the bin's five boxes, the colours, the cube's mass, the table and
the front camera. No Isaac imports, so the plan layout (plan_layout.py) and its tests use exactly what scene_cfg.py
builds today; scene_cfg.py imports these names from here.
"""

from __future__ import annotations

from demo_pipeline.scene_geometry import BIN_INNER, BIN_WALL, TABLE_TOP_Z

CUBE_MASS = 0.1  # kg, the CUBE_SIZE cube
RED = (0.85, 0.05, 0.05)
BLUE = (0.05, 0.2, 0.85)
TABLE_COLOR = (0.6, 0.6, 0.6)

Box = tuple[tuple[float, float, float], tuple[float, float, float]]  # (size, centre in the bin frame)


def bin_parts(inner: tuple[float, float, float] = BIN_INNER, wall: float = BIN_WALL) -> dict[str, Box]:
    """A bin's floor and four walls, keyed floor / wall_px / wall_nx / wall_py / wall_ny: (size, centre in the bin
    frame). The bin frame's origin is the centre of the floor's underside."""
    ix, iy, iz = inner
    ox, oy = ix + 2 * wall, iy + 2 * wall
    wall_z = wall + iz / 2
    return {
        "floor": ((ox, oy, wall), (0.0, 0.0, wall / 2)),
        "wall_px": ((wall, oy, iz), ((ix + wall) / 2, 0.0, wall_z)),
        "wall_nx": ((wall, oy, iz), (-(ix + wall) / 2, 0.0, wall_z)),
        "wall_py": ((ix, wall, iz), (0.0, (iy + wall) / 2, wall_z)),
        "wall_ny": ((ix, wall, iz), (0.0, -(iy + wall) / 2, wall_z)),
    }


# Today's one bin: name -> (size, center in the bin frame), and its prims.
BIN_PARTS: dict[str, Box] = {f"bin_{k}": v for k, v in bin_parts().items()}
BIN_RIM_Z = BIN_WALL + BIN_INNER[2]  # rim height above the bin origin
BIN_PRIMS = {"bin_floor": "BinFloor", "bin_wall_px": "BinWallPX", "bin_wall_nx": "BinWallNX",
             "bin_wall_py": "BinWallPY", "bin_wall_ny": "BinWallNY"}
BIN_PART_NAMES = tuple(BIN_PARTS)

# Table top at TABLE_TOP_Z; it starts in front of the robot base so panda_link0 never touches it.
TABLE_SIZE = (0.85, 1.2, 0.05)
TABLE_CENTER = (0.575, 0.0, TABLE_TOP_Z - TABLE_SIZE[2] / 2)  # top at TABLE_TOP_Z (-0.025 centre)

FRONT_EYE = (1.35, 0.15, 0.65)
FRONT_TARGET = (0.45, 0.15, 0.05)

# Where today's cube spawns (centre xy; z is half its size) before placement.py poses it at reset.
CUBE_SPAWN_XY = (0.5, 0.0)
ARM_CONTACT_SENSORS = {"table": ("table_contact",), "bin": tuple(f"{n}_contact" for n in BIN_PART_NAMES)}
