"""Synthetic multi-object pick-place signals for the goal checker and the segmenter (tests only).

A scripted end effector moves through keyframes at 50 Hz; closing within GRAB_M of a resting cube picks it up (it
then follows the hand), opening lets it fall straight down over 0.2 s onto whatever is below: a bin's floor or the
table. `miss_at` closes on nothing (the cube stays put), `drop_at` lets go while the gripper is still closed (the cube
falls, contact is lost). Bins are axis-aligned at z = 0 with the Isaac scene's sizes (scene_geometry).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from demo_pipeline.goals import Container, ObjectTrack, SceneSignals
from demo_pipeline.scene_geometry import BIN_INNER, BIN_WALL, CUBE_HALF
from demo_pipeline.schemas import Pose

DT = 0.02
GRAB_M = 0.01
FALL_S = 0.2


@dataclass
class Key:
    t: float
    ee: tuple[float, float, float]
    grip: int  # from this key on


@dataclass
class SceneScript:
    cubes: dict[str, tuple[float, float]]  # id -> table xy
    bins: dict[str, tuple[float, float]]  # id -> xy
    keys: list[Key]
    drop_at: dict[float, str] = field(default_factory=dict)  # time -> cube id let go while closed
    force: list[tuple[float, float, float]] = field(default_factory=list)  # (t0, t1, newtons) arm-vs-bin contact

    def containers(self) -> dict[str, Container]:
        return {b: Container(b, Pose(pos=(x, y, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), BIN_INNER) for b, (x, y) in self.bins.items()}


def _rest_z(xy, bins) -> float:
    """Where a falling cube's centre comes to rest: on a bin's floor if it is over one, else on the table."""
    for bx, by in bins.values():
        if abs(xy[0] - bx) <= BIN_INNER[0] / 2 and abs(xy[1] - by) <= BIN_INNER[1] / 2:
            return BIN_WALL + CUBE_HALF
    return CUBE_HALF


def build(script: SceneScript) -> SceneSignals:
    t = np.arange(0.0, script.keys[-1].t + 1e-9, DT)
    kt = [k.t for k in script.keys]
    ee = np.stack([np.interp(t, kt, [k.ee[i] for k in script.keys]) for i in range(3)], axis=1)
    grip = np.zeros(len(t), dtype=int)
    for k, nxt in zip(script.keys, script.keys[1:] + [None]):
        grip[(t >= k.t - 1e-9) & ((t < nxt.t - 1e-9) if nxt else True)] = k.grip
    pos = {c: np.zeros((len(t), 3)) for c in script.cubes}
    contact = {c: np.zeros(len(t), dtype=bool) for c in script.cubes}
    cur = {c: np.array([x, y, CUBE_HALF]) for c, (x, y) in script.cubes.items()}
    falling: dict[str, tuple[float, np.ndarray, np.ndarray]] = {}  # id -> (t0, from, to)
    held: str | None = None
    drops = {round(k / DT): c for k, c in script.drop_at.items()}
    for i, ti in enumerate(t):
        if i > 0 and grip[i] == 1 and grip[i - 1] == 0 and held is None:
            # A cube that has landed can be picked up again; one still in the air can't.
            near = [c for c in cur if (c not in falling or ti - falling[c][0] >= FALL_S) and np.linalg.norm(cur[c] - ee[i]) <= GRAB_M]
            held = near[0] if near else None
            if held is not None:
                falling.pop(held, None)
        let_go = held is not None and (grip[i] == 0 or drops.get(i) == held)
        if let_go:
            start = cur[held].copy()
            falling[held] = (ti, start, np.array([start[0], start[1], _rest_z(start, script.bins)]))
            held = None
        for c in cur:
            if c == held:
                cur[c] = ee[i].copy()
                contact[c][i] = True
            elif c in falling:
                t0, a, b = falling[c]
                f = min(1.0, (ti - t0) / FALL_S)
                cur[c] = a * (1 - f) + b * f
            pos[c][i] = cur[c]
    n = len(t)
    force = np.zeros(n)
    arm = np.zeros(n, dtype=bool)
    for t0, t1, f in script.force:
        on = (t >= t0 - 1e-9) & (t <= t1 + 1e-9)
        force[on] = f
        arm[on] = True
    return SceneSignals(
        t=t,
        ee_pos=ee,
        gripper=grip,
        objects={c: ObjectTrack(c, pos[c], contact[c]) for c in script.cubes},
        containers=script.containers(),
        arm_contact=arm,
        max_contact_force=force,
    )


ABOVE = 0.25  # carry height
CLOSE_Z = CUBE_HALF  # the fingertip centre at a resting cube's centre
PLACE_Z = 0.135  # opening height over a bin (the scripted expert's ~0.10 m above the floor)


def pick_place(t0: float, cube_xy, bin_xy, *, miss: float = 0.0) -> list[Key]:
    """Keys for one pick-place starting at t0 (5.5 s): reach, close (offset by `miss` m in y: a miss), lift,
    carry, open over the bin, rise."""
    cx, cy = cube_xy
    bx, by = bin_xy
    return [
        Key(t0, (cx, cy + miss, ABOVE), 0),
        Key(t0 + 1.0, (cx, cy + miss, CLOSE_Z), 1),
        Key(t0 + 2.0, (cx, cy + miss, ABOVE), 1),
        Key(t0 + 3.5, (bx, by, ABOVE), 1),
        Key(t0 + 4.5, (bx, by, PLACE_Z), 0),
        Key(t0 + 5.0, (bx, by, ABOVE), 0),
    ]


def end(t: float, xy) -> Key:
    return Key(t, (xy[0], xy[1], ABOVE), 0)


RED, BLUE, GREEN = (0.45, -0.15), (0.55, -0.05), (0.45, 0.05)
LEFT, RIGHT = (0.5, 0.25), (0.5, -0.35)


def two_in_order() -> SceneScript:
    """red -> left bin, then blue -> right bin."""
    return SceneScript(
        cubes={"red": RED, "blue": BLUE},
        bins={"left_bin": LEFT, "right_bin": RIGHT},
        keys=pick_place(0.0, RED, LEFT) + pick_place(5.5, BLUE, RIGHT) + [end(12.0, RIGHT)],
    )


def two_reversed() -> SceneScript:
    """blue -> right bin first, then red -> left bin."""
    return SceneScript(
        cubes={"red": RED, "blue": BLUE},
        bins={"left_bin": LEFT, "right_bin": RIGHT},
        keys=pick_place(0.0, BLUE, RIGHT) + pick_place(5.5, RED, LEFT) + [end(12.0, LEFT)],
    )


def three_with_drop() -> SceneScript:
    """red -> left, green dropped on the table mid-carry (never recovered), blue -> right."""
    return SceneScript(
        cubes={"red": RED, "green": GREEN, "blue": BLUE},
        bins={"left_bin": LEFT, "right_bin": RIGHT},
        keys=pick_place(0.0, RED, LEFT) + pick_place(5.5, GREEN, LEFT) + pick_place(11.0, BLUE, RIGHT) + [end(17.5, RIGHT)],
        drop_at={5.5 + 2.6: "green"},
    )


def miss_then_regrasp() -> SceneScript:
    """red: a close 3 cm beside it (missed), then a proper pick-place into the left bin."""
    return SceneScript(
        cubes={"red": RED},
        bins={"left_bin": LEFT},
        keys=[Key(0.0, (RED[0], RED[1] + 0.03, ABOVE), 0), Key(1.0, (RED[0], RED[1] + 0.03, CLOSE_Z), 1),
              Key(1.4, (RED[0], RED[1] + 0.03, ABOVE), 0)]
        + pick_place(1.6, RED, LEFT) + [end(7.5, LEFT)],
    )


def drop_then_regrasp() -> SceneScript:
    """red dropped on the table mid-carry, picked up again where it fell and placed in the left bin."""
    s = SceneScript(cubes={"red": RED}, bins={"left_bin": LEFT}, keys=[], drop_at={2.6: "red"})
    # The drop: at 2.6 s the hand is part way from red toward the bin at the carry height; red falls straight down.
    f = (2.6 - 2.0) / 1.5
    fell = (RED[0] + (LEFT[0] - RED[0]) * f, RED[1] + (LEFT[1] - RED[1]) * f)
    s.keys = pick_place(0.0, RED, LEFT)[:4] + [Key(3.6, (fell[0], fell[1], ABOVE), 0)] + pick_place(4.0, fell, LEFT) + [end(10.0, LEFT)]
    s.keys.sort(key=lambda k: k.t)
    return s


def wrong_bin() -> SceneScript:
    """red -> right bin (its goal is the left one), blue -> right bin."""
    return SceneScript(
        cubes={"red": RED, "blue": BLUE},
        bins={"left_bin": LEFT, "right_bin": RIGHT},
        keys=pick_place(0.0, RED, (RIGHT[0] + 0.05, RIGHT[1])) + pick_place(5.5, BLUE, (RIGHT[0] - 0.05, RIGHT[1])) + [end(12.0, RIGHT)],
    )
