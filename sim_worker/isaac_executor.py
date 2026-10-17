"""The sim worker's executor: runs contract jobs (sim_worker.jobs) on this process's Isaac session.

Must be created and used on the main thread, inside launch_simulation(...).
"""

from __future__ import annotations

import time
from pathlib import Path

from pydantic import BaseModel

from demo_pipeline.schemas import Scene, Trajectory

from . import replay as _replay
from .jobs import run_multiply, run_replay
from .tracking import TrackingOptions


class IsaacExecutor:
    def __init__(self, *, robot: str, cameras: bool, root: Path, tracking: TrackingOptions | None = None,
                 recover_wait_s: float = 300.0, recover_poll_s: float = 5.0):
        self.robot, self.cameras, self.root = robot, cameras, Path(root)
        self.tracking = tracking or TrackingOptions()
        self.recover_wait_s, self.recover_poll_s = recover_wait_s, recover_poll_s

    def recover(self, exc: BaseException) -> bool:
        """After a sim exception, wait until the GPU answers again (measured: after a Windows sleep the process
        recovers, but CUDA keeps failing for a few seconds after resume). True = retry the replay once."""
        import torch

        deadline = time.time() + self.recover_wait_s
        while True:
            try:
                x = torch.ones(8, device="cuda:0")
                torch.cuda.synchronize()
                if float(x.sum().item()) == 8.0:
                    print(f"[executor] GPU answers again after {exc!r}", flush=True)
                    return True
            except Exception as probe_exc:  # noqa: BLE001
                print(f"[executor] GPU not ready: {probe_exc!r}", flush=True)
            if time.time() >= deadline:
                return False
            time.sleep(self.recover_poll_s)

    def warm_up(self) -> None:
        _replay._session(self.cameras, self.robot)

    def _replay_fn(self, traj: Trajectory, scene: Scene, ep_dir: Path | None, record_cameras: bool):
        st: dict = {}
        result, signals = _replay.replay(traj, scene, ep_dir=ep_dir, record_cameras=record_cameras,
                                         tracking=self.tracking, stats=st)
        return result, signals, st["trajectory"]

    def execute(self, kind: str, request: BaseModel) -> BaseModel:
        common = dict(root=self.root, worker_robot=self.robot, worker_cameras=self.cameras, recover=self.recover)
        if kind == "replay":
            return run_replay(request, self._replay_fn, **common)
        if kind == "multiply":
            return run_multiply(request, self._replay_fn, **common)
        raise ValueError(f"unknown job kind {kind!r}")
