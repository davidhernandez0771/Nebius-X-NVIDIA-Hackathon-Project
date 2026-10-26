"""HTTP contract between the backend (client, SANT venv) and the Isaac sim worker (server, Isaac venv).

The sim worker is one long-lived Isaac process (one sim session per process) that serves:
  GET  /health    -> HealthResponse
  POST /replay    ReplayRequest   -> ReplayResponse   (replay + verify one trajectory, optionally record)
  POST /multiply  MultiplyRequest -> MultiplyResponse (transform to sampled scenes, replay + verify each)
Errors: HTTP 4xx/5xx with ErrorResponse JSON. 409 when busy (one job at a time), 422 for invalid bodies.
"""

from __future__ import annotations

import re
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .schemas import RobotName, Scene, SimSignals, Trajectory, VerificationResult

DEFAULT_PORT = 8770
PATHS = {"health": "/health", "replay": "/replay", "multiply": "/multiply"}

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _safe_name(v: str) -> str:
    if not _SAFE_NAME.match(v):
        raise ValueError("must be 1-80 characters of letters, digits, '_' or '-' (a single folder name)")
    return v


class SignalsPayload(_Model):
    """SimSignals as JSON lists."""

    cube_pos: list[tuple[float, float, float]]
    contact_gripper_cube: list[bool]
    contact_arm_bin: list[bool]
    contact_arm_table: list[bool]
    max_contact_force: list[float]

    @model_validator(mode="after")
    def _same_length(self) -> "SignalsPayload":
        n = len(self.cube_pos)
        if any(len(getattr(self, k)) != n for k in ("contact_gripper_cube", "contact_arm_bin",
                                                     "contact_arm_table", "max_contact_force")):
            raise ValueError("all signal lists must have the same length")
        return self

    @property
    def n_steps(self) -> int:
        return len(self.cube_pos)

    @classmethod
    def from_signals(cls, s: SimSignals) -> "SignalsPayload":
        return cls(cube_pos=np.asarray(s.cube_pos, dtype=float).tolist(),
                   contact_gripper_cube=np.asarray(s.contact_gripper_cube, dtype=bool).tolist(),
                   contact_arm_bin=np.asarray(s.contact_arm_bin, dtype=bool).tolist(),
                   contact_arm_table=np.asarray(s.contact_arm_table, dtype=bool).tolist(),
                   max_contact_force=np.asarray(s.max_contact_force, dtype=float).tolist())

    def to_signals(self) -> SimSignals:
        return SimSignals(cube_pos=np.asarray(self.cube_pos, dtype=float).reshape(-1, 3),
                          contact_gripper_cube=np.asarray(self.contact_gripper_cube, dtype=bool),
                          contact_arm_bin=np.asarray(self.contact_arm_bin, dtype=bool),
                          contact_arm_table=np.asarray(self.contact_arm_table, dtype=bool),
                          max_contact_force=np.asarray(self.max_contact_force, dtype=float))


class HealthResponse(_Model):
    ok: bool
    robots: list[RobotName]
    cameras: bool  # whether this worker's session was built with cameras
    busy: bool


class ReplayRequest(_Model):
    trajectory: Trajectory
    scene: Scene
    record_cameras: bool = False
    out_name: str  # episode folder name under the worker's DATA_DIR/episodes/
    save_episode: bool = True

    _check_name = field_validator("out_name")(classmethod(lambda cls, v: _safe_name(v)))


class ReplayResponse(_Model):
    verification: VerificationResult
    signals: SignalsPayload
    ep_dir: str | None  # absolute path on the shared disk, None when save_episode was False
    n_steps: int = Field(gt=0)
    wall_s: float = Field(ge=0)

    @model_validator(mode="after")
    def _signals_match(self) -> "ReplayResponse":
        if self.signals.n_steps != self.n_steps:
            raise ValueError(f"signals have {self.signals.n_steps} steps, n_steps is {self.n_steps}")
        return self


class MultiplyRequest(_Model):
    trajectory: Trajectory  # the perfected source demo
    scene: Scene  # the scene it was recorded in
    robot: RobotName  # robot for the variants (may differ from scene.robot)
    n: int = Field(ge=1, le=200)
    seed0: int
    record_cameras: bool = False
    out_prefix: str
    # Optional: the exact scenes to multiply into (e.g. a failure analyst's recipe, demo_pipeline.data_recipe).
    # Without it the variants are sample_scene(seed) for seeds seed0..seed0+n-1, as always. With it, n must equal
    # len(scenes) and each variant takes its scene's seed (unique).
    scenes: list[Scene] | None = None

    _check_prefix = field_validator("out_prefix")(classmethod(lambda cls, v: _safe_name(v)))

    @model_validator(mode="after")
    def _check_scenes(self) -> "MultiplyRequest":
        if self.scenes is None:
            return self
        if len(self.scenes) != self.n:
            raise ValueError(f"n is {self.n} but {len(self.scenes)} scenes were given")
        seeds = [s.seed for s in self.scenes]
        if len(set(seeds)) != len(seeds):
            raise ValueError("the given scenes' seeds must be unique (they name the variant folders)")
        if any(s.robot != self.robot for s in self.scenes):
            raise ValueError(f"every given scene must be for robot {self.robot!r}")
        return self


class MultiplyVariant(_Model):
    seed: int
    scene: Scene
    trajectory: Trajectory
    verification: VerificationResult
    ep_dir: str | None


class MultiplyResponse(_Model):
    attempts: int = Field(ge=0)
    successes: int = Field(ge=0)
    variants: list[MultiplyVariant]  # every attempt, successful or not
    wall_s: float = Field(ge=0)

    @model_validator(mode="after")
    def _counts(self) -> "MultiplyResponse":
        if self.attempts != len(self.variants):
            raise ValueError("attempts must equal the number of variants")
        if self.successes != sum(v.verification.success for v in self.variants):
            raise ValueError("successes must equal the number of successful variants")
        return self


class ErrorResponse(_Model):
    error: Literal["busy", "invalid", "sim_error", "not_found"]
    detail: str
