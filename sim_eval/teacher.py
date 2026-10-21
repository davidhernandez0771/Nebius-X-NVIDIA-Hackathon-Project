"""The teacher interface for teacher -> student distillation (sim_eval.distill). Pure: no Isaac, no torch.

A teacher is a state-based policy with privileged information (the cube's and the bin's exact poses): T3's RL teacher
(pm/rl-teacher), trained on the reward with SANT-verified human demo states as starts. The camera policy (ACT, the
student) learns from it. There is deliberately no hand-written teacher here: the user rules a scripted expert out as
a teacher (it would bypass the human demos).

    teacher = load_teacher("rl_teacher.policy:make_teacher", checkpoint="...", device="cuda:0")
    teacher.reset(scene)
    action = teacher.act(state)   # TeacherAction, or None: "no label at this state"

Its action is an absolute tool target + a binary gripper, world (env) frame, quaternions wxyz. The Isaac distill env
turns it into the student's 9-joint target with one differential-IK step from the visited state, the same IK the
replayed training episodes were recorded with (sim_eval.isaac_distill_env). None is allowed (a state the teacher
won't label, e.g. the cube knocked over); those steps get no label and split the episode (distill.label_segments).
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import numpy as np

from demo_pipeline.schemas import Scene


@dataclass(frozen=True)
class TeacherState:
    """What the teacher sees at one control step, before that step's action. Env frame (the robot base at the
    origin, as in every sim_worker scene), metres and seconds, quaternions wxyz."""

    seed: int
    k: int  # control step (50 Hz)
    joint_pos: np.ndarray  # (9,) panda_joint1..7, then the two fingers
    joint_vel: np.ndarray  # (9,)
    tcp_pos: np.ndarray  # (3,) fingertip center
    tcp_quat_wxyz: np.ndarray  # (4,)
    gripper: int  # the last commanded gripper, 0 open / 1 closed (0 before the first step)
    cube_pos: np.ndarray  # (3,)
    cube_quat_wxyz: np.ndarray  # (4,)
    cube_lin_vel: np.ndarray  # (3,)
    bin_pos: np.ndarray  # (3,)
    bin_quat_wxyz: np.ndarray  # (4,)
    contact_gripper_cube: bool
    extra: dict = field(default_factory=dict)  # anything an env adds; teachers must not need it

    @property
    def t(self) -> float:
        return self.k / 50.0


@dataclass(frozen=True)
class TeacherAction:
    ee_pos: np.ndarray  # (3,) the tool (fingertip center) target, absolute
    ee_quat_wxyz: np.ndarray  # (4,)
    gripper: int  # 0 open / 1 closed

    def as_array(self) -> np.ndarray:
        """(8,): x, y, z, qw, qx, qy, qz, gripper (the episodes' teacher_ee column)."""
        return np.concatenate([self.ee_pos, self.ee_quat_wxyz, [float(self.gripper)]]).astype(np.float64)

    @classmethod
    def from_array(cls, a) -> "TeacherAction":
        a = np.asarray(a, dtype=np.float64)
        return cls(ee_pos=a[:3], ee_quat_wxyz=a[3:7], gripper=int(round(a[7])))


@runtime_checkable
class Teacher(Protocol):
    name: str  # recorded in every episode's lineage ("teacher-<name>") and provenance

    def reset(self, scene: Scene) -> None: ...
    def act(self, state: TeacherState) -> TeacherAction | None: ...


def check_action(a: TeacherAction | None) -> TeacherAction | None:
    """Validate a teacher's output: finite, shapes, a unit-length quaternion (normalised if within 10%), gripper 0/1.
    Raises ValueError on anything else; a broken teacher must never write labels."""
    if a is None:
        return None
    pos, q = np.asarray(a.ee_pos, dtype=np.float64), np.asarray(a.ee_quat_wxyz, dtype=np.float64)
    if pos.shape != (3,) or q.shape != (4,):
        raise ValueError(f"teacher action shapes {pos.shape}, {q.shape}; expected (3,), (4,)")
    if not (np.isfinite(pos).all() and np.isfinite(q).all()):
        raise ValueError(f"teacher action is not finite: {pos.tolist()} {q.tolist()}")
    norm = float(np.linalg.norm(q))
    if abs(norm - 1.0) > 0.1:
        raise ValueError(f"teacher quaternion {q.tolist()} has norm {norm:.3f}, expected 1")
    if a.gripper not in (0, 1):
        raise ValueError(f"teacher gripper {a.gripper!r}, expected 0 or 1")
    return TeacherAction(ee_pos=pos, ee_quat_wxyz=q / norm, gripper=int(a.gripper))


def load_teacher(spec: str, **kwargs) -> Teacher:
    """`spec` is "package.module:factory"; factory(**kwargs) returns the teacher (T3's adapter around its trained RL
    policy). Refuses anything that isn't a Teacher."""
    module_name, sep, attr = spec.partition(":")
    if not sep or not module_name or not attr:
        raise ValueError(f"teacher spec {spec!r}: expected 'package.module:factory'")
    factory = getattr(importlib.import_module(module_name), attr)
    teacher = factory(**kwargs)
    if not isinstance(teacher, Teacher) or not isinstance(getattr(teacher, "name", None), str) or not teacher.name:
        raise TypeError(f"{spec} returned {type(teacher).__name__}, not a Teacher (name, reset(scene), act(state))")
    return teacher
