"""The sim worker's executor: runs contract jobs (sim_worker.jobs) on this process's Isaac session.

Must be created and used on the main thread, inside launch_simulation(...).
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from demo_pipeline.schemas import Scene, Trajectory

from . import replay as _replay
from .jobs import run_multiply, run_replay
from .tracking import TrackingOptions


class IsaacExecutor:
    def __init__(self, *, robot: str, cameras: bool, root: Path, tracking: TrackingOptions | None = None):
        self.robot, self.cameras, self.root = robot, cameras, Path(root)
        self.tracking = tracking or TrackingOptions()

    def warm_up(self) -> None:
        _replay._session(self.cameras, self.robot)

    def _replay_fn(self, traj: Trajectory, scene: Scene, ep_dir: Path | None, record_cameras: bool):
        st: dict = {}
        result, signals = _replay.replay(traj, scene, ep_dir=ep_dir, record_cameras=record_cameras,
                                         tracking=self.tracking, stats=st)
        return result, signals, st["trajectory"]

    def execute(self, kind: str, request: BaseModel) -> BaseModel:
        common = dict(root=self.root, worker_robot=self.robot, worker_cameras=self.cameras)
        if kind == "replay":
            return run_replay(request, self._replay_fn, **common)
        if kind == "multiply":
            return run_multiply(request, self._replay_fn, **common)
        raise ValueError(f"unknown job kind {kind!r}")
