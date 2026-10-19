"""The cube and bin sizes: one copy, used by the Isaac scene (sim_worker/scene_cfg.py builds the bodies from it)
and by everything on the SANT side that reasons about the bin (repairs, rules, diagnosis, jobs). No Isaac imports.

The bin frame's origin is the centre of the floor's underside; the floor is BIN_WALL thick, so the rim is
BIN_WALL + BIN_INNER[2] above it.
"""

from __future__ import annotations

CUBE_SIZE = 0.05  # m, edge
BIN_INNER = (0.20, 0.20, 0.08)  # m, inside length, width, wall height above the floor
BIN_WALL = 0.01  # m, wall and floor thickness

CUBE_HALF = CUBE_SIZE / 2
BIN_RIM_HEIGHT = BIN_WALL + BIN_INNER[2]  # rim above the bin origin
BIN_FOOTPRINT_HALF = BIN_INNER[0] / 2 + BIN_WALL  # half the outside width (the bin is square)

# release_above_bin: the held cube's bottom stops this far above the rim before the gripper opens. It must clear
# the rim with room for tracking error (the replay follows the tool to ~5 mm), and the drop from there must stay a
# placement, not a throw: check_success's high_release limit is the cube centre 0.18 m above the bin origin.
RELEASE_CLEARANCE = 0.02  # m
