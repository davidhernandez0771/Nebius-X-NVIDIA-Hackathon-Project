"""Every cube's signals during a replay: the replay reads each cube of its SceneLayout (plan_layout.py) once per
control step and feeds them here. Out come demo_pipeline.goals.SceneSignals (every cube and every bin, for
check_goals and segment) and, for the primary cube, today's SimSignals (check_success, signals.npz). "Lifted" and
"in a container" aren't recorded: goals.object_series derives them from the positions.

Saved beside an episode as objects.npz (the arrays) and objects.json (the ids and the bins' poses and sizes). Pure:
numpy only.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from demo_pipeline.goals import Container, ObjectTrack, SceneSignals
from demo_pipeline.schemas import Pose, SimSignals

from .plan_layout import SceneLayout

OBJECTS_NPZ = "objects.npz"
OBJECTS_JSON = "objects.json"


class ObjectRecorder:
    def __init__(self, layout: SceneLayout):
        self.layout = layout
        self.cube_ids = layout.cube_ids()
        self.pos: dict[str, list] = {c: [] for c in self.cube_ids}
        self.contact: dict[str, list] = {c: [] for c in self.cube_ids}
        self.arm_bin: list[bool] = []
        self.arm_table: list[bool] = []
        self.force: list[float] = []

    def add(self, cubes: dict[str, tuple], *, arm_bin: bool, arm_table: bool, force: float) -> None:
        """One control step: cube id -> (position in the env frame, in gripper contact), and the arm's contacts."""
        if set(cubes) != set(self.cube_ids):
            raise ValueError(f"readings for {sorted(cubes)}, but the layout's cubes are {sorted(self.cube_ids)}")
        for c, (pos, touching) in cubes.items():
            self.pos[c].append(np.asarray(pos, dtype=np.float64))
            self.contact[c].append(bool(touching))
        self.arm_bin.append(bool(arm_bin))
        self.arm_table.append(bool(arm_table))
        self.force.append(float(force))

    def sim_signals(self, cube_id: str) -> SimSignals:
        """Today's SimSignals, for one cube (the replay's primary: today's only cube, or the plan's first goal's)."""
        return SimSignals(
            cube_pos=np.asarray(self.pos[cube_id], dtype=np.float64).reshape(-1, 3),
            contact_gripper_cube=np.asarray(self.contact[cube_id], dtype=bool),
            contact_arm_bin=np.asarray(self.arm_bin, dtype=bool),
            contact_arm_table=np.asarray(self.arm_table, dtype=bool),
            max_contact_force=np.asarray(self.force, dtype=np.float64),
        )

    def scene_signals(self, t, ee_pos, gripper, tcp_error=None) -> SceneSignals:
        return SceneSignals(
            t=np.asarray(t, dtype=np.float64),
            ee_pos=np.asarray(ee_pos, dtype=np.float64),
            gripper=np.asarray(gripper),
            objects={c: ObjectTrack(c, np.asarray(self.pos[c], dtype=np.float64).reshape(-1, 3),
                                    np.asarray(self.contact[c], dtype=bool)) for c in self.cube_ids},
            containers=self.layout.containers(),
            arm_contact=np.asarray(self.arm_bin, dtype=bool) | np.asarray(self.arm_table, dtype=bool),
            max_contact_force=np.asarray(self.force, dtype=np.float64),
            tcp_error=None if tcp_error is None else np.asarray(tcp_error, dtype=np.float64),
        )


def save_scene_signals(ep_dir: Path, sig: SceneSignals) -> None:
    ep_dir = Path(ep_dir)
    ep_dir.mkdir(parents=True, exist_ok=True)
    ids = list(sig.objects)
    arrays = {"t": sig.t, "ee_pos": sig.ee_pos, "gripper": sig.gripper, "arm_contact": sig.arm_contact,
              "max_contact_force": sig.max_contact_force}
    if sig.tcp_error is not None:
        arrays["tcp_error"] = sig.tcp_error
    for i, c in enumerate(ids):
        arrays[f"pos_{i}"] = sig.objects[c].pos
        arrays[f"contact_{i}"] = sig.objects[c].gripper_contact
    np.savez(ep_dir / OBJECTS_NPZ, **arrays)
    meta = {"objects": ids, "containers": [{"id": k, "pos": list(v.pose.pos), "quat_wxyz": list(v.pose.quat_wxyz),
                                            "inner": list(v.inner)} for k, v in sig.containers.items()]}
    (ep_dir / OBJECTS_JSON).write_text(json.dumps(meta, indent=1), encoding="utf-8")


def load_scene_signals(ep_dir: Path) -> SceneSignals | None:
    """An episode's objects.npz + objects.json, or None if it has none (recorded before per-object signals)."""
    ep_dir = Path(ep_dir)
    if not (ep_dir / OBJECTS_NPZ).exists() or not (ep_dir / OBJECTS_JSON).exists():
        return None
    meta = json.loads((ep_dir / OBJECTS_JSON).read_text(encoding="utf-8"))
    with np.load(ep_dir / OBJECTS_NPZ) as z:
        a = {k: z[k] for k in z.files}
    return SceneSignals(
        t=a["t"], ee_pos=a["ee_pos"], gripper=a["gripper"],
        objects={c: ObjectTrack(c, a[f"pos_{i}"], a[f"contact_{i}"]) for i, c in enumerate(meta["objects"])},
        containers={c["id"]: Container(c["id"], Pose(pos=tuple(c["pos"]), quat_wxyz=tuple(c["quat_wxyz"])), tuple(c["inner"]))
                    for c in meta["containers"]},
        arm_contact=a["arm_contact"], max_contact_force=a["max_contact_force"], tcp_error=a.get("tcp_error"),
    )
