"""Stand-in "human-like" demos: what a webcam teleop demo looks like, made from the scripted expert. Pure.

They stand in for the user's own recordings, so the whole experiment can be proven end to end before a person
records anything. Each is the scripted expert on the Record page's fixed scene (sim_worker/scripts/teleop_sink.py,
base_scene: cube at (0.5, 0), bin at (0.5, 0.3)), starting at home, then:
- a late close: the hand reaches the cube and waits, gripper still open, before it closes (late_close);
- demo_pipeline.degrade: hand jitter (low-passed tremor), one hesitation pause, an idle start and end, a small
  grasp offset and a slower pace.
They are saved as source "human" demos, so they go through exactly the path a recorded demo does. The truth dict
says what was injected; it is not shown to any diagnoser.
"""

from __future__ import annotations

import numpy as np

from demo_pipeline.degrade import degrade
from demo_pipeline.schemas import Demo, Pose, Scene, Trajectory
from sim_worker.scripted import scripted_expert

DT = 0.02
IDENTITY = (1.0, 0.0, 0.0, 0.0)
TELEOP_SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                     bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=0)


def late_close(traj: Trajectory, delay_s: float) -> Trajectory:
    """The hand holds at the grasp pose, gripper open, for delay_s before the first close; the rest is unchanged."""
    a = traj.to_arrays()
    closed = np.flatnonzero(a["gripper"] == 1)
    if closed.size == 0:
        raise ValueError("late_close: the demo never closes the gripper")
    i, n = int(closed[0]), int(round(delay_s / DT))
    ins = lambda x, v: np.concatenate([x[:i], np.repeat(v[None], n, axis=0), x[i:]])  # noqa: E731
    pos, quat = ins(a["ee_pos"], a["ee_pos"][i]), ins(a["ee_quat"], a["ee_quat"][i])
    grip = np.concatenate([a["gripper"][:i], np.zeros(n, dtype=int), a["gripper"][i:]])
    return Trajectory.from_arrays(np.arange(len(pos)) * DT, pos, quat, grip)


def standin_demo(seed: int, *, id: str) -> tuple[Demo, dict]:
    rng = np.random.default_rng(seed)
    params = {
        "late_close_s": round(float(rng.uniform(0.4, 1.0)), 3),
        "jitter_mm": round(float(rng.uniform(1.5, 3.0)), 3),
        "grasp_offset_mm": round(float(rng.uniform(0.0, 6.0)), 3),
        "slow_factor": round(float(rng.uniform(1.1, 1.5)), 3),
        "idle_start_s": round(float(rng.uniform(0.5, 1.5)), 3),
        "idle_end_s": round(float(rng.uniform(0.3, 1.0)), 3),
        "n_pauses": 1,
        "pause_s": [0.5, 1.2],
    }
    traj = late_close(scripted_expert(TELEOP_SCENE, home_start=True), params["late_close_s"])
    traj, issues = degrade(traj, rng, n_pauses=1, pause_s=tuple(params["pause_s"]), jitter_mm=params["jitter_mm"],
                           grasp_offset_mm=params["grasp_offset_mm"], slow_factor=params["slow_factor"],
                           idle_start_s=params["idle_start_s"], idle_end_s=params["idle_end_s"])
    demo = Demo(id=id, source="human", trajectory=traj, scene=TELEOP_SCENE, human_seconds=traj.duration)
    truth = {"seed": seed, "kind": "standin", **params, "issues": [i.model_dump() for i in issues]}
    return demo, truth
