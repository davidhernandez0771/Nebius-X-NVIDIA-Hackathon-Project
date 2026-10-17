"""Pure helpers for the batch runner (T2 Task 3): workspace-corner scenes and the summary.json body."""

from __future__ import annotations

import json
import math
import os
from collections import Counter
from pathlib import Path

from demo_pipeline.multiply import BIN_X, BIN_Y, BIN_Z, CUBE_X, CUBE_Y, CUBE_Z
from demo_pipeline.schemas import Pose, RobotName, Scene

_UNIT = (1.0, 0.0, 0.0, 0.0)


def _scene(cube_xy, bin_xy, robot: RobotName, seed: int) -> Scene:
    return Scene(
        cube_pose=Pose(pos=(*cube_xy, CUBE_Z), quat_wxyz=_UNIT),
        bin_pose=Pose(pos=(*bin_xy, BIN_Z), quat_wxyz=_UNIT),
        robot=robot,
        seed=seed,
    )


def corner_scenes(robot: RobotName) -> list[tuple[str, Scene]]:
    """Each corner of the cube range (bin mid-x on the far side) and of the bin range (cube on the far side)."""
    out = []
    bin_mid_x = (BIN_X[0] + BIN_X[1]) / 2
    cube_mid_x = (CUBE_X[0] + CUBE_X[1]) / 2
    for x in CUBE_X:
        for y in CUBE_Y:
            out.append((f"cube({x:.2f},{y:+.2f})", (x, y), (bin_mid_x, -math.copysign(BIN_Y[1], y))))
    for x in BIN_X:
        for y in BIN_Y:
            out.append((f"bin({x:.2f},{y:+.2f})", (cube_mid_x, -math.copysign(0.15, y)), (x, y)))
    return [(label, _scene(c, b, robot, seed=-1 - i)) for i, (label, c, b) in enumerate(out)]


def summarize(rows: list[dict], wall_s: float) -> dict:
    n = len(rows)
    successes = sum(bool(r["success"]) for r in rows)
    reasons = Counter(code for r in rows for code in r["reasons"])
    return {
        "n": n,
        "successes": successes,
        "success_rate": successes / n if n else 0.0,
        "reasons": dict(sorted(reasons.items())),
        "wall_time_s": wall_s,
        "wall_per_episode_s": wall_s / n if n else 0.0,
    }


def yield_report(rows: list[dict], wall_s: float) -> dict:
    """summarize() in multiplication terms: every variant replayed is an attempt."""
    s = summarize(rows, wall_s)
    return {"attempts": s["n"], "successes": s["successes"], "yield": s["success_rate"], "reasons": s["reasons"],
            "wall_time_s": s["wall_time_s"], "wall_per_attempt_s": s["wall_per_episode_s"]}


class RowStore:
    """One JSON row per finished episode in <out>/rows/<name>.json, so a batch interrupted (e.g. by Windows sleep)
    resumes by seed with --resume. Written atomically (temp file + os.replace) after the episode is complete."""

    def __init__(self, out: Path):
        self.dir = Path(out) / "rows"

    def get(self, name: str) -> dict | None:
        try:
            return json.loads((self.dir / f"{name}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def put(self, name: str, row: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / f"{name}.json.tmp"
        tmp.write_text(json.dumps(row), encoding="utf-8")
        os.replace(tmp, self.dir / f"{name}.json")

    def done(self) -> list[str]:
        return sorted(p.stem for p in self.dir.glob("*.json")) if self.dir.exists() else []
