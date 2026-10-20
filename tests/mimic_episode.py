"""A tiny SANT pick-and-place episode for the Isaac Lab Mimic export tests (test_dp_mimic, test_export_mimic).

60 steps: from the home tool pose down to the cube, close at step 20, lift from step 25, over the bin from step 38,
release at step 45. So robota.phases gives reach 0-19, grasp 20-24, carry 25-37, place 38-44, release 45-59.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

N = 60
CLOSE, LIFT, OVER_BIN, RELEASE = 20, 25, 38, 45
HOME = np.array([0.45, 0.0, 0.35])
DOWN_WXYZ = np.array([0.0, 1.0, 0.0, 0.0])
CUBE0 = np.array([0.5, 0.0, 0.025])
BIN = np.array([0.5, 0.3, 0.0])
CUBE_QUAT = [0.9659258, 0.0, 0.0, 0.2588190]  # 30 deg about z, wxyz
TASK = "pick up the red cube and place it in the blue bin"


def arrays(start=HOME) -> dict[str, np.ndarray]:
    """steps.npz arrays, the commanded trajectory and the cube track, all N long."""
    above_bin = BIN + [0.0, 0.0, 0.15]
    keys = [(0, np.asarray(start, float)), (CLOSE, CUBE0 + [0, 0, 0.0]), (LIFT, CUBE0 + [0, 0, 0.005]),
            (OVER_BIN, above_bin), (N - 1, above_bin + [0, 0, 0.05])]
    t = np.arange(N)
    cmd = np.stack([np.interp(t, [k for k, _ in keys], [p[i] for _, p in keys]) for i in range(3)], axis=1)
    quat = np.tile(DOWN_WXYZ, (N, 1))
    grip = np.zeros(N, dtype=np.int8)
    grip[CLOSE:RELEASE] = 1
    # The arm lags its command a little, as the real one does.
    achieved = cmd + 0.002
    cube = np.tile(CUBE0, (N, 1))
    cube[LIFT:RELEASE] = achieved[LIFT:RELEASE] - [0, 0, 0.0]
    cube[LIFT:RELEASE, 2] = np.maximum(cube[LIFT:RELEASE, 2], CUBE0[2] + 0.02)
    cube[RELEASE:] = BIN + [0.0, 0.0, 0.035]
    joints = np.linspace(0, 1, N * 9, dtype=np.float32).reshape(N, 9)
    return {
        "steps": {"joint_pos": joints, "action": joints + 0.01, "ee_pos": achieved.astype(np.float32),
                  "ee_quat": quat.astype(np.float32), "gripper": grip},
        "trajectory": {"t": (t / 50.0).tolist(), "ee_pos": cmd.tolist(), "ee_quat": quat.tolist(), "gripper": grip.tolist()},
        "cube_pos": cube,
        "scene": {"cube_pose": {"pos": CUBE0.tolist(), "quat_wxyz": CUBE_QUAT},
                  "bin_pose": {"pos": BIN.tolist(), "quat_wxyz": [1.0, 0.0, 0.0, 0.0]}, "robot": "franka", "seed": 7},
    }


def write_demo(store: Path, demo_id: str, *, success=True, variant_seed=None, start=HOME,
               lineage: list[str] | None = None) -> Path:
    """One demo in a SANT store: demos/<id>/passport.json and demos/<id>/episode/ (no camera images)."""
    from demo_pipeline.episode_io import EpisodeMeta, save_episode, save_signals
    from demo_pipeline.schemas import SimSignals

    a = arrays(start)
    d = Path(store) / "demos" / demo_id
    passport = {"demo_id": demo_id, "lineage": lineage or [demo_id], "repairs_applied": [{"op": "trim", "t0": 0.1, "t1": 1.0}],
                "diagnosis_source": "rules", "model_id": None, "variant_seed": variant_seed, "robot": "franka",
                "verification": {"success": success, "reasons": [] if success else ["collision"], "duration": N / 50,
                                 "path_length": 1.0, "max_contact_force": 0.0},
                "pipeline_version": "0.1.0"}
    meta = EpisodeMeta(demo_id=demo_id, robot="franka", task_text=TASK, fps=50, n_steps=N, cameras=[], passport=passport)
    ep = d / "episode"
    save_episode(ep, meta, a["steps"])
    g = a["steps"]["gripper"].astype(bool)
    save_signals(ep, SimSignals(cube_pos=a["cube_pos"], contact_gripper_cube=g, contact_arm_bin=np.zeros(N, bool),
                                contact_arm_table=np.zeros(N, bool), max_contact_force=np.zeros(N)))
    (ep / "scene.json").write_text(json.dumps(a["scene"]), encoding="utf-8")
    (ep / "trajectory.json").write_text(json.dumps(a["trajectory"]), encoding="utf-8")
    (ep / "verification.json").write_text(json.dumps(passport["verification"]), encoding="utf-8")
    (d / "passport.json").write_text(json.dumps(passport), encoding="utf-8")
    return d
