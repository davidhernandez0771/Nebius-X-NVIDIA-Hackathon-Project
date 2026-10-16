"""A fake sim worker for T4's tests: same methods as app.sim_client.SimWorkerClient, no HTTP, no Isaac.

replay() records the request, writes an episode in the episode_io format under `root` (frames are
small byte strings, so tests can see which frames reached the diagnoser), and answers with the
next scripted VerificationResult. Errors can be scripted per replay call.
"""
from __future__ import annotations

from concurrent.futures import Executor, Future
from pathlib import Path

import numpy as np

from demo_pipeline.episode_io import EpisodeMeta, image_path, save_episode, save_signals
from demo_pipeline.rules import TASK_TEXT
from demo_pipeline.schemas import SimSignals, VerificationResult
from demo_pipeline.sim_protocol import HealthResponse, ReplayRequest, ReplayResponse, SignalsPayload


class InlineExecutor(Executor):
    """Runs each job at submit time, so a test sees the finished job right away."""

    def submit(self, fn, /, *args, **kwargs):
        f = Future()
        try:
            f.set_result(fn(*args, **kwargs))
        except BaseException as e:  # noqa: BLE001 - mirrors a real executor
            f.set_exception(e)
        return f


def verification(success=True, reasons=None, duration=2.0):
    return VerificationResult(success=success, reasons=reasons if reasons is not None else ([] if success else
                              ["not_in_bin"]), duration=duration, path_length=0.5, max_contact_force=0.0)


def frame_bytes(out_name: str, camera: str, step: int) -> bytes:
    return f"PNG {out_name} {camera} {step}".encode()


class FakeSim:
    def __init__(self, root: Path, *, results=None, errors=None, cameras=True, robots=("franka",), ok=True,
                 health_error=None, extra_steps=0):
        self.root = Path(root)
        self.results = list(results or [verification()])
        self.errors = dict(errors or {})  # replay call index -> exception to raise
        self.cameras, self.robots, self.ok = cameras, list(robots), ok
        self.health_error = health_error
        self.extra_steps = extra_steps  # the worker's gripper gate can lengthen the executed trajectory
        self.requests: list[ReplayRequest] = []
        self.closed = False

    def health(self) -> HealthResponse:
        if self.health_error is not None:
            raise self.health_error
        return HealthResponse(ok=self.ok, robots=self.robots, cameras=self.cameras, busy=False)

    def replay(self, req: ReplayRequest) -> ReplayResponse:
        k = len(self.requests)
        self.requests.append(req)
        if k in self.errors:
            raise self.errors[k]
        result = self.results[min(k, len(self.results) - 1)]
        traj = req.trajectory.to_arrays()
        n = len(req.trajectory.t) + self.extra_steps
        idx = np.minimum(np.arange(n), len(req.trajectory.t) - 1)
        grip = traj["gripper"][idx]
        signals = SimSignals(cube_pos=np.tile([0.5, 0.0, 0.025], (n, 1)),
                             contact_gripper_cube=grip.astype(bool), contact_arm_bin=np.zeros(n, dtype=bool),
                             contact_arm_table=np.zeros(n, dtype=bool), max_contact_force=np.zeros(n))
        ep_dir = None
        if req.save_episode:
            ep = self.root / "episodes" / req.out_name
            cams = ["front", "wrist"] if req.record_cameras else []
            meta = EpisodeMeta(demo_id=req.out_name, robot=req.scene.robot, task_text=TASK_TEXT, fps=50,
                               n_steps=n, cameras=cams)
            save_episode(ep, meta, {"joint_pos": np.zeros((n, 9)), "action": np.zeros((n, 9)),
                                    "ee_pos": traj["ee_pos"][idx], "ee_quat": traj["ee_quat"][idx], "gripper": grip})
            for cam in cams:
                for i in range(n):
                    image_path(ep, cam, i).write_bytes(frame_bytes(req.out_name, cam, i))
            save_signals(ep, signals)
            ep_dir = str(ep.resolve())
        return ReplayResponse(verification=result, signals=SignalsPayload.from_signals(signals), ep_dir=ep_dir,
                              n_steps=n, wall_s=0.1)

    def close(self) -> None:
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
