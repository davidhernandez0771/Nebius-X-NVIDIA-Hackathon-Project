"""Multi-step goals: did a demo put each object in its container, in order, cleanly?

The scene creator's ScenePlan (pm/scene-creator, scene_plan.py) has objects and goals ("cube X into bin Y", done in
the plan's order). check_success (success.py) answers that for today's one cube and one bin; this module answers it
for any number of objects and containers, per goal, with timestamps:

- a goal is "done" (its object ends in its container), "not_done", "dropped" (not done, and the object fell out of
  the gripper off its container) or "out_of_order" (done, but before a goal listed earlier was done);
- the scene succeeds when every goal is done in order (or in any order, ordered=False) and nothing failed.

Reasons use check_success's names and thresholds, imported from success.py rather than copied: per goal not_in_bin,
not_settled, dropped and high_release; for the whole demo gripper_closed, too_slow, collision (> COLLISION_FORCE_N)
and unreachable; plus out_of_order. With one goal they come out exactly as check_success's list (tested on its
fixtures, a fuzz and real episodes), so the verdict is the same.

Signals: SceneSignals holds the per-step gripper command, each object's position and gripper contact, each
container's pose and size, and the arm's contacts and force. SceneSignals.single() builds it from today's
Trajectory + SimSignals; the sim worker records one cube only, so multi-object signals come from synthetic scenes
until it records more.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal

import numpy as np

from .robota import LIFT_M
from .scene_geometry import BIN_INNER
from .schemas import Pose, SimSignals, Trajectory
from .success import _EPS, COLLISION_FORCE_N, _longest_run_s, _settle_time, _to_bin_frame

GoalState = Literal["done", "not_done", "dropped", "out_of_order"]

# The order check_success lists its reasons in, then the one only several goals can have.
REASON_ORDER = ("not_in_bin", "gripper_closed", "not_settled", "too_slow", "collision", "dropped", "high_release",
                "unreachable", "out_of_order")


@dataclass(frozen=True)
class Goal:
    object: str
    container: str


def goals_from_plan(plan) -> list[Goal]:
    """A ScenePlan's goals (each has .object and .bin), in the plan's order."""
    return [Goal(g.object, g.bin) for g in plan.goals]


@dataclass(frozen=True)
class Container:
    id: str
    pose: Pose  # the frame's origin is the centre of the floor's underside (scene_geometry)
    inner: tuple[float, float, float] = BIN_INNER  # inside length (x), width (y), wall height, m


@dataclass(frozen=True)
class ObjectTrack:
    id: str
    pos: np.ndarray  # [N, 3] centre, world frame
    gripper_contact: np.ndarray  # [N] bool


@dataclass(frozen=True)
class SceneSignals:
    t: np.ndarray  # [N] s
    ee_pos: np.ndarray  # [N, 3]
    gripper: np.ndarray  # [N] commanded, 1 = closed
    objects: dict[str, ObjectTrack]
    containers: dict[str, Container]
    arm_contact: np.ndarray  # [N] bool: arm (incl. gripper) against a container or the table
    max_contact_force: np.ndarray  # [N] N, max over those contacts
    tcp_error: np.ndarray | None = None  # [N] m, commanded vs reached tool point (optional)

    def __post_init__(self) -> None:
        n = len(self.t)
        shapes = {"ee_pos": (n, 3), "gripper": (n,), "arm_contact": (n,), "max_contact_force": (n,)}
        if self.tcp_error is not None:
            shapes["tcp_error"] = (n,)
        for name, want in shapes.items():
            if np.shape(getattr(self, name)) != want:
                raise ValueError(f"{name} has shape {np.shape(getattr(self, name))}, want {want}")
        for o in self.objects.values():
            if np.shape(o.pos) != (n, 3) or np.shape(o.gripper_contact) != (n,):
                raise ValueError(f"object {o.id!r} has shapes {np.shape(o.pos)}, {np.shape(o.gripper_contact)}; want ({n}, 3), ({n},)")

    @property
    def duration(self) -> float:
        return float(self.t[-1] - self.t[0])

    @classmethod
    def single(cls, traj: Trajectory, sim: SimSignals, bin_pose: Pose, bin_inner=BIN_INNER, tcp_error=None,
               cube_id: str = "cube", bin_id: str = "bin") -> "SceneSignals":
        """Today's one cube and one bin, from the replay's Trajectory and SimSignals."""
        arr = traj.to_arrays()
        if sim.n_steps != len(arr["t"]):
            raise ValueError(f"SimSignals has {sim.n_steps} steps but the trajectory has {len(arr['t'])}")
        return cls(
            t=arr["t"], ee_pos=arr["ee_pos"], gripper=arr["gripper"],
            objects={cube_id: ObjectTrack(cube_id, sim.cube_pos, sim.contact_gripper_cube)},
            containers={bin_id: Container(bin_id, bin_pose, tuple(bin_inner))},
            arm_contact=sim.contact_arm_bin | sim.contact_arm_table,
            max_contact_force=sim.max_contact_force,
            tcp_error=None if tcp_error is None else np.asarray(tcp_error),
        )


@dataclass(frozen=True)
class ObjectSeries:
    """One object's per-step state, derived from the signals."""

    id: str
    pos: np.ndarray  # [N, 3]
    held: np.ndarray  # [N] bool: in gripper contact
    lifted: np.ndarray  # [N] bool: >= robota.LIFT_M above where it started
    over: dict[str, np.ndarray]  # container id -> [N] bool: inside the container's inner footprint (its frame)
    in_container: dict[str, np.ndarray]  # container id -> [N] bool: over it and between its floor and rim
    height_in: dict[str, np.ndarray]  # container id -> [N] height above the container's origin


def _frame(pos: np.ndarray, c: Container) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """over, in, z: check_success's in-bin test (success.py), per step, for one container."""
    half_x, half_y, height = c.inner[0] / 2, c.inner[1] / 2, c.inner[2]
    b = _to_bin_frame(pos, c.pose)
    over = (np.abs(b[:, 0]) <= half_x + _EPS) & (np.abs(b[:, 1]) <= half_y + _EPS)
    inside = over & (-_EPS <= b[:, 2]) & (b[:, 2] <= height + _EPS)
    return over, inside, b[:, 2]


def object_series(sig: SceneSignals, obj_id: str) -> ObjectSeries:
    if obj_id not in sig.objects:
        raise ValueError(f"no object {obj_id!r} in the signals (have {sorted(sig.objects)})")
    o = sig.objects[obj_id]
    pos = np.asarray(o.pos, dtype=float)
    frames = {cid: _frame(pos, c) for cid, c in sig.containers.items()}
    return ObjectSeries(
        id=obj_id, pos=pos, held=np.asarray(o.gripper_contact, dtype=bool), lifted=pos[:, 2] - pos[0, 2] >= LIFT_M,
        over={k: f[0] for k, f in frames.items()}, in_container={k: f[1] for k, f in frames.items()},
        height_in={k: f[2] for k, f in frames.items()},
    )


@dataclass(frozen=True)
class GoalStatus:
    goal: Goal
    state: GoalState
    reasons: tuple[str, ...]  # this goal's: not_in_bin, not_settled, dropped, high_release
    grasped_at: float | None  # first step it is in the closed gripper
    released_at: float | None  # the last step it was still in the fingers before an opening over its container
    done_at: float | None  # first step of the final run in its container (None: not in it at the end)
    dropped_at: tuple[float, ...]  # each step it fell out of the closed gripper off its container
    settle_time: float  # s still at the end


@dataclass(frozen=True)
class GoalReport:
    goals: tuple[GoalStatus, ...]
    ordered: bool
    reasons: tuple[str, ...]  # every reason, once, in check_success's order (then out_of_order)
    success: bool
    duration: float
    max_contact_force: float
    path_length: float = field(default=0.0)


def _first(t: np.ndarray, mask: np.ndarray) -> float | None:
    i = np.flatnonzero(mask)
    return float(t[i[0]]) if i.size else None


def _goal(sig: SceneSignals, goal: Goal, settle_speed: float, settle_s: float, release_height_max: float) -> GoalStatus:
    if goal.container not in sig.containers:
        raise ValueError(f"no container {goal.container!r} in the signals (have {sorted(sig.containers)})")
    s = object_series(sig, goal.object)
    t, grip = sig.t, np.asarray(sig.gripper)
    over, inside, z = s.over[goal.container], s.in_container[goal.container], s.height_in[goal.container]
    # check_success's drop, release and high-release tests, against this goal's container.
    lost = s.held[:-1] & ~s.held[1:]
    dropped = lost & (grip[1:] == 1) & ~over[1:]
    released = (grip[:-1] == 1) & (grip[1:] == 0) & s.held[:-1]
    high = released & over[:-1] & (z[:-1] > release_height_max + _EPS)
    settle = _settle_time(t, s.pos, settle_speed)

    done = bool(inside[-1])
    reasons = []
    if not done:
        reasons.append("not_in_bin")
    if settle < settle_s - _EPS:
        reasons.append("not_settled")
    if dropped.any():
        reasons.append("dropped")
    if high.any():
        reasons.append("high_release")
    done_at = None
    if done:
        outside = np.flatnonzero(~inside)
        done_at = float(t[outside[-1] + 1]) if outside.size else float(t[0])
    rel = np.flatnonzero(released & over[:-1])
    return GoalStatus(
        goal=goal,
        state="done" if done else "dropped" if dropped.any() else "not_done",
        reasons=tuple(reasons),
        grasped_at=_first(t, s.held & (grip == 1)),
        released_at=float(t[rel[-1]]) if rel.size else None,
        done_at=done_at,
        dropped_at=tuple(float(t[i + 1]) for i in np.flatnonzero(dropped)),
        settle_time=settle,
    )


def check_goals(
    goals: list[Goal],
    sig: SceneSignals,
    ordered: bool = True,
    time_limit: float = 30.0,
    settle_speed: float = 0.01,
    settle_s: float = 0.5,
    force_limit: float = COLLISION_FORCE_N,
    unreachable_tol: float = 0.02,
    unreachable_s: float = 1.0,
    release_height_max: float = 0.18,
) -> GoalReport:
    """Per-goal status and the scene's verdict. The keyword defaults are check_success's."""
    if not goals:
        raise ValueError("no goals to check")
    statuses = [_goal(sig, g, settle_speed, settle_s, release_height_max) for g in goals]
    if ordered:
        # A done goal is out of order if any goal listed before it was not done by then (done later, or never).
        for k, st in enumerate(statuses):
            if st.state != "done":
                continue
            if any(p.done_at is None or p.done_at > st.done_at for p in statuses[:k]):
                statuses[k] = replace(st, state="out_of_order")

    reasons = {r for st in statuses for r in st.reasons}
    if np.asarray(sig.gripper)[-1] != 0:
        reasons.add("gripper_closed")
    if sig.duration > time_limit + _EPS:
        reasons.add("too_slow")
    if np.any(np.asarray(sig.arm_contact) & (np.asarray(sig.max_contact_force) > force_limit)):
        reasons.add("collision")
    if sig.tcp_error is not None and _longest_run_s(sig.t, np.asarray(sig.tcp_error) > unreachable_tol) > unreachable_s + _EPS:
        reasons.add("unreachable")
    if any(st.state == "out_of_order" for st in statuses):
        reasons.add("out_of_order")
    ordered_reasons = tuple(r for r in REASON_ORDER if r in reasons)
    return GoalReport(
        goals=tuple(statuses),
        ordered=ordered,
        reasons=ordered_reasons,
        success=not ordered_reasons,
        duration=sig.duration,
        max_contact_force=float(np.asarray(sig.max_contact_force).max(initial=0.0)),
        path_length=float(np.linalg.norm(np.diff(sig.ee_pos, axis=0), axis=1).sum()),
    )
