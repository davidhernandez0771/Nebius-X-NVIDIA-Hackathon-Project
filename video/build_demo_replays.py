"""Turn the 10 mouse demos (and one webcam demo) behind the 30/40 result (human_exp/mouse20261020) into the test track's replay payload, so the
film can show a real recorded demo. Read-only on the data store; every pose is the one Isaac recorded at 50 Hz.

    python video/build_demo_replays.py [DATA_DIR]   (default C:/dev/pm-t6/data) -> video/data/demos/<id>.json
"""
import json
import sys
from pathlib import Path

import numpy as np

DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "C:/dev/pm-t6/data")
OUT = Path(__file__).parent / "data" / "demos"
OUT.mkdir(parents=True, exist_ok=True)
NAMES = [f"panda_joint{i}" for i in range(1, 8)] + ["panda_finger_joint1", "panda_finger_joint2"]

ids = json.loads((DATA / "human_exp/mouse20261020/config.json").read_text())["ids"]
# plus the webcam demo that pressed hardest into the bin (927 N against the 5 N limit, README "Physics check, as recorded")
ids += ["human_20261019185902_c045"]
summary = []
for i in ids:
    d = DATA / "demos" / i
    demo = json.loads((d / "demo.json").read_text())
    s, g = np.load(d / "episode/steps.npz"), np.load(d / "episode/signals.npz")
    n = len(s["joint_pos"])
    bp, bq = demo["scene"]["bin_pose"]["pos"], demo["scene"]["bin_pose"]["quat_wxyz"]
    hand = s["ee_pos"]
    path = float(np.linalg.norm(np.diff(hand, axis=0), axis=1).sum())
    speed = np.linalg.norm(np.diff(hand, axis=0), axis=1) * 50
    paused = float((speed < 0.01).mean())
    run = {
        "demo_id": i, "source": "human", "robot": "franka", "fps": 50, "n_steps": n, "joint_names": NAMES,
        "joint_pos": np.round(s["joint_pos"], 4).tolist(),
        "gripper": [int(x > 0.5) for x in s["gripper"]],
        "cube_pos": np.round(g["cube_pos"], 4).tolist(),
        "cube_quat": demo["scene"]["cube_pose"]["quat_wxyz"],
        "bin": [*bp, *bq], "base": [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
        "hand_pos": np.round(hand, 3).tolist(),
        "max_contact_n": np.round(g["max_contact_force"], 2).tolist(),
        "human_seconds": demo.get("human_seconds"), "input": demo.get("input", "webcam"),
    }
    (OUT / f"{i}.json").write_text(json.dumps(run, separators=(",", ":")))
    summary.append({"id": i, "n": n, "path_m": round(path, 3), "paused": round(paused, 2), "peak_n": round(float(g["max_contact_force"].max()), 1)})
(OUT / "index.json").write_text(json.dumps(summary, indent=1))
for row in summary:
    print(row)
