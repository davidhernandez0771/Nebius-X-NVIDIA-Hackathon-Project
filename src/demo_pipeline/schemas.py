"""The shared contract (spec section 7). Every track builds on these shapes.

Conventions: Isaac Lab world frame, Z-up, meters, seconds; quaternions are (w, x, y, z).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Literal, Union

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator

Vec3 = tuple[float, float, float]
Quat = tuple[float, float, float, float]  # (w, x, y, z)
RobotName = Literal["franka", "openarm", "so101", "flexiv"]

UNIT_QUAT_TOL = 1e-3
TIME_TOL = 1e-6


def _is_unit(q: Quat) -> bool:
    return abs(math.sqrt(sum(c * c for c in q)) - 1.0) <= UNIT_QUAT_TOL


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Pose(_Model):
    pos: Vec3
    quat_wxyz: Quat

    @field_validator("quat_wxyz")
    @classmethod
    def _unit(cls, q: Quat) -> Quat:
        if not _is_unit(q):
            raise ValueError("quat_wxyz must be a unit quaternion (w, x, y, z)")
        return q


class Trajectory(_Model):
    """The robot-independent hand path: end-effector target pose + gripper command per step."""

    t: list[float]
    ee_pos: list[Vec3]
    ee_quat: list[Quat]
    gripper: list[Literal[0, 1]]  # 0 = open, 1 = closed

    @model_validator(mode="after")
    def _consistent(self) -> "Trajectory":
        n = len(self.t)
        if n < 2:
            raise ValueError("a trajectory needs at least 2 steps")
        if not (len(self.ee_pos) == len(self.ee_quat) == len(self.gripper) == n):
            raise ValueError("t, ee_pos, ee_quat and gripper must have the same length")
        if self.t[0] < 0 or any(b <= a for a, b in zip(self.t, self.t[1:])):
            raise ValueError("t must start at >= 0 and be strictly increasing")
        if not all(_is_unit(q) for q in self.ee_quat):
            raise ValueError("every ee_quat must be a unit quaternion (w, x, y, z)")
        return self

    @property
    def duration(self) -> float:
        return self.t[-1] - self.t[0]

    def to_arrays(self) -> dict[str, np.ndarray]:
        return {
            "t": np.asarray(self.t, dtype=np.float64),
            "ee_pos": np.asarray(self.ee_pos, dtype=np.float64),
            "ee_quat": np.asarray(self.ee_quat, dtype=np.float64),
            "gripper": np.asarray(self.gripper, dtype=np.int8),
        }

    @classmethod
    def from_arrays(cls, t, ee_pos, ee_quat, gripper) -> "Trajectory":
        return cls(
            t=np.asarray(t, dtype=np.float64).tolist(),
            ee_pos=np.asarray(ee_pos, dtype=np.float64).tolist(),
            ee_quat=np.asarray(ee_quat, dtype=np.float64).tolist(),
            gripper=np.asarray(gripper).astype(int).tolist(),
        )


class Scene(_Model):
    cube_pose: Pose
    bin_pose: Pose
    robot: RobotName
    seed: int


class Demo(_Model):
    id: str = Field(min_length=1)
    source: Literal["human", "repaired", "variant"]
    parent_id: str | None = None
    trajectory: Trajectory  # what the tool did: for teleop, the pose the arm reached each step (what replay drives)
    # teleop only, for diagnostics: the hand target sent each step. The arm lags it, so replaying it is another motion.
    commanded: Trajectory | None = None
    scene: Scene
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    human_seconds: float = Field(ge=0)  # wall-clock human time; 0 for derived demos

    @model_validator(mode="after")
    def _lineage(self) -> "Demo":
        if self.source == "human" and self.parent_id is not None:
            raise ValueError("a human demo has no parent_id")
        if self.source != "human" and not self.parent_id:
            raise ValueError(f"a {self.source} demo needs a parent_id")
        if self.commanded is not None and self.commanded.t != self.trajectory.t:
            raise ValueError("commanded needs one target per trajectory step, at the same times")
        return self

    @model_serializer(mode="wrap")
    def _drop_absent_commanded(self, handler):
        # Demos without targets dump exactly as before the field existed (frozen sets hash their demo JSON).
        data = handler(self)
        if self.commanded is None:
            data.pop("commanded", None)
        return data


@dataclass(frozen=True)
class SimSignals:
    """Per-step simulator signals recorded during replay (sim worker -> measure). Same length as the Trajectory."""

    cube_pos: np.ndarray  # [N, 3] cube center, world frame
    contact_gripper_cube: np.ndarray  # [N] bool
    contact_arm_bin: np.ndarray  # [N] bool
    contact_arm_table: np.ndarray  # [N] bool
    max_contact_force: np.ndarray  # [N] float, N (newtons), max over arm-vs-bin/table contacts

    def __post_init__(self) -> None:
        if self.cube_pos.ndim != 2 or self.cube_pos.shape[1] != 3:
            raise ValueError(f"cube_pos must be [N, 3], got {self.cube_pos.shape}")
        n = self.cube_pos.shape[0]
        for name in ("contact_gripper_cube", "contact_arm_bin", "contact_arm_table", "max_contact_force"):
            if getattr(self, name).shape != (n,):
                raise ValueError(f"{name} must have shape ({n},), got {getattr(self, name).shape}")

    @property
    def n_steps(self) -> int:
        return int(self.cube_pos.shape[0])


class MetricsWindow(_Model):
    """Code-computed metrics for one 0.5 s window (spec 7, 'Metrics')."""

    t0: float
    t1: float
    speed: float  # m/s
    jerk_rms: float
    gripper: Literal[0, 1]
    dist_ee_cube: float  # m
    cube_height: float  # m
    contact_gripper_cube: bool
    contact_arm_bin: bool
    contact_arm_table: bool


# --- Diagnosis: Nemotron's output, validated before any repair runs -------------------------

SegmentName = Literal["approach", "grasp", "lift", "carry", "release", "retreat"]
IssueType = Literal[
    "pause", "jitter", "slow", "grasp_off_center", "wrong_object",
    "rim_contact", "bad_release", "drop", "idle_start_end", "other",
]


class _TimeRange(_Model):
    t0: float = Field(ge=0)
    t1: float

    @model_validator(mode="after")
    def _ordered(self):
        if self.t1 <= self.t0:
            raise ValueError("t1 must be greater than t0")
        return self


class Segment(_TimeRange):
    name: SegmentName


class Issue(_Model):
    type: IssueType
    evidence: str
    t: float | None = Field(default=None, ge=0)
    t0: float | None = Field(default=None, ge=0)
    t1: float | None = None

    @model_validator(mode="after")
    def _point_or_range(self) -> "Issue":
        has_point = self.t is not None
        has_range = self.t0 is not None and self.t1 is not None
        if has_point == has_range:
            raise ValueError("an issue needs either t, or both t0 and t1")
        if has_range and self.t1 <= self.t0:
            raise ValueError("t1 must be greater than t0")
        return self


class Trim(_TimeRange):
    op: Literal["trim"]


class RemovePause(_TimeRange):
    op: Literal["remove_pause"]


class Smooth(_TimeRange):
    op: Literal["smooth"]
    strength: Literal["low", "med", "high"] = "med"


class Retime(_TimeRange):
    op: Literal["retime"]
    target_speed: float = Field(gt=0)  # m/s


class RecenterGrasp(_Model):
    op: Literal["recenter_grasp"]
    t: float = Field(ge=0)


class ReplanTransit(_TimeRange):
    op: Literal["replan_transit"]


class Discard(_Model):
    op: Literal["discard"]


RepairOp = Annotated[
    Union[Trim, RemovePause, Smooth, Retime, RecenterGrasp, ReplanTransit, Discard],
    Field(discriminator="op"),
]

# Spec 8.4: repairs always run in this order, whatever order they were listed in.
REPAIR_ORDER: tuple[str, ...] = ("trim", "remove_pause", "recenter_grasp", "replan_transit", "smooth", "retime")


def _times(obj) -> list[float]:
    return [v for v in (getattr(obj, k, None) for k in ("t", "t0", "t1")) if v is not None]


class Diagnosis(_Model):
    segments: list[Segment]
    issues: list[Issue]
    repairs: list[RepairOp]
    decision: Literal["repair", "discard", "keep"]
    label: str = Field(min_length=1)

    def check_times(self, duration: float) -> None:
        """Raise ValueError if any time is past the demo or segments overlap. Needs the demo, so not a validator."""
        problems = []
        for kind, items in (("segment", self.segments), ("issue", self.issues), ("repair", self.repairs)):
            for item in items:
                if any(v > duration + TIME_TOL for v in _times(item)):
                    problems.append(f"{kind} {item.model_dump()} is past the demo end ({duration:.2f} s)")
        ordered = sorted(self.segments, key=lambda s: s.t0)
        for a, b in zip(ordered, ordered[1:]):
            if a.t1 > b.t0 + TIME_TOL:
                problems.append(f"segments {a.name} and {b.name} overlap")
        if problems:
            raise ValueError("; ".join(problems))


class VerificationResult(_Model):
    success: bool
    reasons: list[str] = Field(default_factory=list)
    duration: float
    path_length: float
    max_contact_force: float
    settle_time: float | None = None


class Passport(_Model):
    demo_id: str
    lineage: list[str] = Field(min_length=1)  # human demo id first, this demo last
    repairs_applied: list[RepairOp] = Field(default_factory=list)
    diagnosis_source: Literal["nemotron", "rules", "hybrid", "none"]  # hybrid = rules + Nemotron
    model_id: str | None = None
    variant_seed: int | None = None
    robot: RobotName
    verification: VerificationResult
    pipeline_version: str
