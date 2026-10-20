"""Read-only: how far below the soft floor do a set of demos' training labels put the tool?

For every demo folder (demo.json + episode/steps.npz) in the given stores, against the soft floor at each step's
x, y (demo_pipeline.soft_floor.floor_z, with that demo's own scene bin pose):
  - traj      demo.trajectory (for teleop demos: the path the arm reached; for replays: what was replayed)
  - commanded demo.commanded (teleop: the clamped, smoothed command the arm was sent)
  - label     forward kinematics of steps.npz "action", the 9 joint targets LeRobot trains on (lerobot_tools.export)
  - reached   steps.npz ee_pos, where the arm actually went
Each as (min mm under/over the floor, frames more than 1 mm under it, frames). fk_check_mm: FK of the recorded joint
positions vs the recorded ee_pos (should be ~0: the FK matches the sim). Franka only; numpy only, no Isaac.

    uv run --no-sync python scripts/check_floor_labels.py data/demos data/human_exp/<name>/store/demos --tag "human_2026*"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "src"), str(ROOT)]

from demo_pipeline.schemas import Demo  # noqa: E402
from demo_pipeline.soft_floor import floor_z  # noqa: E402
from sim_worker.urdf_import import parse_urdf  # noqa: E402
from sim_worker.urdf_kin import link_pose  # noqa: E402

URDF_PATH = ROOT / "web/public/robots/franka_description/robots/panda_arm_hand.urdf"
TCP = np.array([0.0, 0.0, 0.1034, 1.0])  # sim_worker.robots franka tcp_offset, in the hand frame
ARM = [f"panda_joint{i}" for i in range(1, 8)]
TOL = 0.001


def fk_tcp(urdf, q9) -> np.ndarray:
    q = {n: float(v) for n, v in zip(ARM, q9[:7])}
    q["panda_finger_joint1"] = float(q9[7])
    return (link_pose(urdf, "panda_hand", q) @ TCP)[:3]


def under_floor(pos: np.ndarray, demo: Demo) -> list:
    floors = np.array([floor_z(p, demo.scene.bin_pose) for p in pos])
    d = np.asarray(pos)[:, 2] - floors
    return [round(float(d.min()) * 1000, 1), int((d < -TOL).sum()), len(d)]


def check(urdf, folder: Path) -> dict:
    demo = Demo.model_validate_json((folder / "demo.json").read_text(encoding="utf-8"))
    out = {"demo": folder.name, "traj": under_floor(np.asarray(demo.trajectory.ee_pos), demo)}
    if demo.commanded is not None:
        out["commanded"] = under_floor(np.asarray(demo.commanded.ee_pos), demo)
    steps = folder / "episode" / "steps.npz"
    if steps.is_file():
        with np.load(steps) as npz:
            arr = {k: npz[k] for k in ("action", "ee_pos", "joint_pos")}
        out["label"] = under_floor(np.array([fk_tcp(urdf, a) for a in arr["action"]]), demo)
        out["reached"] = under_floor(np.asarray(arr["ee_pos"], dtype=float), demo)
        idx = slice(None, None, max(1, len(arr["joint_pos"]) // 20))
        fk = np.array([fk_tcp(urdf, q) for q in arr["joint_pos"][idx]])
        out["fk_check_mm"] = round(float(np.abs(fk - arr["ee_pos"][idx]).max()) * 1000, 2)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("stores", nargs="+", type=Path, help="folders holding demo folders (e.g. data/demos)")
    ap.add_argument("--tag", default="*", help="fnmatch pattern for demo folder names")
    args = ap.parse_args(argv)
    urdf = parse_urdf(URDF_PATH.read_text(encoding="utf-8"))
    rows = [check(urdf, d) for store in args.stores for d in sorted(store.glob(args.tag)) if (d / "demo.json").is_file()]
    json.dump(rows, sys.stdout, indent=1)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
