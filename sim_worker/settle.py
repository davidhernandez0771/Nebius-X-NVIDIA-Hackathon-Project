"""The settle check: once a ScenePlan is built in Isaac, let physics run SETTLE_S with nothing touching it, and report
every cube that moved, fell or tipped, as sentences for the scene creator's Nemotron loop (app.ai.scene_creator:
plan_from_text(check_fn=...)). validate_plan catches what geometry can; this catches what only physics shows (a
stack that slides off, a cube that rests on a bin's rim).

settle_errors() is pure: poses before and after. The Isaac run (plan_scene.settle_plan, inside
sim_worker/scripts/settle_plan.py) produces them; settle_in_isaac() runs that script in Isaac's python as a
subprocess, one plan per process (Isaac builds one scene per process), so the caller needs no Isaac.

Thresholds:
- MOVE_TOL_M 0.01 m: check_success (demo_pipeline.success) calls an object settled below 0.01 m/s, so over the 1 s
  check that is the drift it allows;
- TILT_TOL_DEG 10: a cube resting flat doesn't tilt at all; 10 degrees leaves room for contact jitter (new here);
- a cube whose centre ends below the table top has fallen off the table.
"""

from __future__ import annotations

import json
import math
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

import numpy as np

from demo_pipeline.scene_geometry import TABLE_TOP_Z
from demo_pipeline.scene_plan import ScenePlan, resolve

SETTLE_S = 1.0
MOVE_TOL_M = 0.01
TILT_TOL_DEG = 10.0
ISAAC_PYTHON = r"C:\isaac\env_isaaclab\Scripts\python.exe"
SCRIPT = Path(__file__).resolve().parent / "scripts" / "settle_plan.py"

PoseT = tuple[tuple[float, float, float], tuple[float, float, float, float]]  # position, (w, x, y, z)


class SettleUnavailable(RuntimeError):
    """The settle check couldn't run (Isaac failed or timed out): not the plan's fault."""


def _up(q) -> np.ndarray:
    """The body's +z axis in the world for a (w, x, y, z) quaternion."""
    w, x, y, z = q
    return np.array([2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)])


def tilt_deg(q0, q1) -> float:
    """How far a body's vertical axis turned between two orientations (a spin about the vertical is 0)."""
    c = float(np.clip(np.dot(_up(q0), _up(q1)) / (np.linalg.norm(_up(q0)) * np.linalg.norm(_up(q1))), -1.0, 1.0))
    return math.degrees(math.acos(c))


def settle_errors(plan: ScenePlan, before: dict[str, PoseT], after: dict[str, PoseT]) -> list[str]:
    """One sentence per cube that didn't stay where the plan put it; [] when the scene settled."""
    placed = resolve(plan)
    cubes = [o.id for o in plan.objects if o.kind == "cube"]
    missing = [c for c in cubes if c not in before or c not in after]
    if missing:
        raise ValueError(f"no pose before and after the settle for {', '.join(missing)}")
    sec = f"{SETTLE_S:.0f} s"
    errors = []
    for c in cubes:
        (p0, q0), (p1, q1) = before[c], after[c]
        p0, p1 = np.asarray(p0, dtype=float), np.asarray(p1, dtype=float)
        slid = float(np.linalg.norm(p1[:2] - p0[:2]))
        dropped = float(p0[2] - p1[2])
        moved = float(np.linalg.norm(p1 - p0))
        tilt = tilt_deg(q0, q1)
        support = placed[c].support
        if p1[2] < TABLE_TOP_Z:
            errors.append(f"{c} fell off the table in the {sec} settle check (its centre ended at z {p1[2]:.2f} m): "
                          "move it further in from the table's edge")
        elif support and dropped > MOVE_TOL_M:
            errors.append(f"{c} fell off {support}: it dropped {dropped * 100:.1f} cm and slid {slid * 100:.1f} cm in "
                          f"{sec} of physics; centre it on {support} or start it on the table")
        elif tilt > TILT_TOL_DEG:
            hint = f"; centre it on {support}" if support else "; give it flat table under its whole footprint"
            errors.append(f"{c} tipped over ({tilt:.0f} degrees in {sec} of physics){hint}")
        elif moved > MOVE_TOL_M:
            errors.append(f"{c} moved {moved * 100:.1f} cm in {sec} of physics, more than {MOVE_TOL_M * 100:.0f} cm: it "
                          "isn't resting where the plan puts it (is it on a bin's rim, or against another object?)")
    return errors


def settle_in_isaac(plan: ScenePlan, *, python: str = ISAAC_PYTHON, run: Callable = subprocess.run,
                    work_dir: Path | None = None, timeout_s: float = 900.0) -> list[str]:
    """Build the plan in Isaac (a subprocess of Isaac's python running scripts/settle_plan.py, which takes the
    shared GPU lock), settle it, and return settle_errors. Raises SettleUnavailable if the run fails."""
    with tempfile.TemporaryDirectory(dir=work_dir) as tmp:
        plan_path, out = Path(tmp) / "plan.json", Path(tmp) / "settle.json"
        plan_path.write_text(plan.model_dump_json(), encoding="utf-8")
        cmd = [python, str(SCRIPT), "--plan", str(plan_path), "--out", str(out)]
        try:
            res = run(cmd, capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired as e:
            raise SettleUnavailable(f"the settle check timed out after {timeout_s:.0f} s") from e
        if res.returncode != 0 or not out.exists():
            tail = (res.stderr or res.stdout or "").strip().splitlines()[-5:]
            raise SettleUnavailable(f"the settle check failed (exit {res.returncode}): " + " | ".join(tail))
        return list(json.loads(out.read_text(encoding="utf-8"))["errors"])
