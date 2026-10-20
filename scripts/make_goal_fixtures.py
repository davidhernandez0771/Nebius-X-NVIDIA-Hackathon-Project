"""Extract real episodes' verifier inputs into tests/data/goals/*.npz (the goal checker's real-data fixtures).

Reads, never writes, a data folder of replayed episodes (each with trajectory.json, signals.npz, steps.npz,
scene.json and verification.json, as sim_worker.jobs writes them) and keeps, per chosen episode, what check_success
was given: the executed trajectory, the SimSignals, the bin pose, the IK residual (|reached - commanded| tool
point, sim_worker/replay.py's tcp_error) and the stored reasons. It first checks that check_success on those
inputs gives the stored reasons, and refuses an episode that doesn't.

    uv run python scripts/make_goal_fixtures.py C:\\dev\\pm-t6\\data tests/data/goals
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from demo_pipeline.episode_io import load_signals
from demo_pipeline.scene_geometry import BIN_INNER
from demo_pipeline.schemas import Scene, Trajectory
from demo_pipeline.success import check_success

# One per verdict seen in the data (the shortest episode of each), so every reason that occurs is covered.
WANT = ["", "not_in_bin", "collision", "not_in_bin,collision", "not_in_bin,dropped", "collision,dropped",
        "not_in_bin,collision,dropped", "collision,unreachable", "not_in_bin,collision,unreachable"]


def inputs(ep: Path):
    traj = Trajectory.model_validate_json((ep / "trajectory.json").read_text("utf-8"))
    scene = Scene.model_validate_json((ep / "scene.json").read_text("utf-8"))
    sim = load_signals(ep)
    with np.load(ep / "steps.npz") as s:
        tcp = np.linalg.norm(s["ee_pos"] - traj.to_arrays()["ee_pos"], axis=1)
    return traj, scene, sim, tcp


def main(src: Path, out: Path) -> None:
    best: dict[str, tuple[int, Path]] = {}
    for v in sorted(src.rglob("verification.json")):
        ep = v.parent
        if not all((ep / f).exists() for f in ("trajectory.json", "signals.npz", "steps.npz", "scene.json")):
            continue
        key = ",".join(json.loads(v.read_text("utf-8"))["reasons"])
        if key in WANT:
            n = len(Trajectory.model_validate_json((ep / "trajectory.json").read_text("utf-8")).t)
            if key not in best or n < best[key][0]:
                best[key] = (n, ep)
    out.mkdir(parents=True, exist_ok=True)
    for key, (n, ep) in sorted(best.items()):
        traj, scene, sim, tcp = inputs(ep)
        stored = json.loads((ep / "verification.json").read_text("utf-8"))["reasons"]
        got = check_success(traj, sim, scene.bin_pose, bin_inner=BIN_INNER, tcp_error=tcp).reasons
        if sorted(got) != sorted(stored):
            raise SystemExit(f"{ep}: check_success gives {got}, the episode stored {stored}")
        arr = traj.to_arrays()
        name = f"{key.replace(',', '+') or 'success'}__{ep.name}.npz"
        np.savez_compressed(
            out / name, t=arr["t"], ee_pos=arr["ee_pos"], ee_quat=arr["ee_quat"], gripper=arr["gripper"],
            cube_pos=sim.cube_pos, contact_gripper_cube=sim.contact_gripper_cube, contact_arm_bin=sim.contact_arm_bin,
            contact_arm_table=sim.contact_arm_table, max_contact_force=sim.max_contact_force, tcp_error=tcp,
            bin_pos=np.asarray(scene.bin_pose.pos), bin_quat_wxyz=np.asarray(scene.bin_pose.quat_wxyz),
            reasons=np.asarray(stored, dtype=str), source=np.asarray(str(ep.relative_to(src))),
        )
        print(f"{name}: {n} steps, reasons {stored or 'none'}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
