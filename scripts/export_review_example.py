"""Export one raw -> perfected demo pair from a demo store as the Review page's recorded example.

Every value is copied unchanged from the store; only the sampling is thinned (the trajectory keeps
every --traj-every step, the front camera every --frame-every step) so the files stay small.

    python scripts/export_review_example.py --store C:\\dev\\pm-t4\\data\\demos \\
        --raw s1_0002 --perfected s1_0002_rules --out web/src/site/review/example

Needs Pillow (the system Python has it; the uv env does not).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def thin_trajectory(traj: dict, every: int) -> dict:
    n = len(traj["t"])
    keep = list(range(0, n, every))
    if keep[-1] != n - 1:
        keep.append(n - 1)  # keep the last step, so the length is exact
    return {k: [traj[k][i] for i in keep] for k in ("t", "ee_pos", "ee_quat", "gripper")}


def sprite(frames_dir: Path, every: int, cols: int, out: Path) -> dict:
    files = sorted(frames_dir.glob("*.png"))
    picked = files[::every]
    if picked[-1] != files[-1]:
        picked.append(files[-1])
    w, h = Image.open(picked[0]).size
    rows = -(-len(picked) // cols)
    sheet = Image.new("RGB", (cols * w, rows * h))
    for k, f in enumerate(picked):
        sheet.paste(Image.open(f).convert("RGB"), ((k % cols) * w, (k // cols) * h))
    sheet.save(out, quality=88)
    return {"file": out.name, "count": len(picked), "cols": cols, "w": w, "h": h, "steps": [int(f.stem) for f in picked]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", type=Path, required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--perfected", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--traj-every", type=int, default=5)
    ap.add_argument("--frame-every", type=int, default=10)
    ap.add_argument("--cols", type=int, default=12)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    example: dict = {"store": str(args.store), "trajEvery": args.traj_every, "frameEvery": args.frame_every}
    for role, demo_id in (("raw", args.raw), ("perfected", args.perfected)):
        d = args.store / demo_id
        demo = json.loads((d / "demo.json").read_text())
        demo["trajectory"] = thin_trajectory(demo["trajectory"], args.traj_every)
        episode = json.loads((d / "episode" / "episode.json").read_text())
        example[role] = {
            "demo": demo,
            "diagnosis": json.loads((d / "diagnosis.json").read_text()) if (d / "diagnosis.json").exists() else None,
            "passport": json.loads((d / "passport.json").read_text()),
            "fps": episode["fps"],
            "taskText": episode.get("task_text"),
            "frames": sprite(d / "episode" / "front", args.frame_every, args.cols, args.out / f"{role}_front.jpg"),
        }
    (args.out / "example.json").write_text(json.dumps(example, indent=1))
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
