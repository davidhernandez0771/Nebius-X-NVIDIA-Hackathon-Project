"""Write GR00T's `meta/modality.json` for one of our exported LeRobot datasets.

GR00T N1.x reads LeRobot datasets plus this extra file, which names slices of `observation.state` and `action`,
maps video keys, and points the task annotation at `task_index`. Schema (NVIDIA Isaac-GR00T,
getting_started/data_preparation.md; sample demo_data/cube_to_bowl_5/meta/modality.json):

    {"state":  {"<part>": {"start": i, "end": j}, ...},        # zero-based, end-exclusive slices
     "action": {"<part>": {"start": i, "end": j}, ...},
     "video":  {"<name>": {"original_key": "observation.images.<name>"}, ...},
     "annotation": {"human.task_description": {"original_key": "task_index"}}}

Optional per-slice fields (rotation_type, absolute, dtype, range) are left out: the docs say to set them only when
they differ from the defaults, and ours are plain absolute joint positions.

GR00T's loader expects LeRobot v2.x; our exports are v3.0. Convert first with Isaac-GR00T's
scripts/lerobot_conversion/convert_v3_to_v2.py, then run this on the converted dataset (both versions keep
`features` in meta/info.json, so this works on either).

    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.gr00t_modality <dataset_root> [--robot franka]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

IMAGE_PREFIX = "observation.images."
Layout = dict[str, tuple[int, int]]

# Franka in Isaac Lab: panda_joint1..7, then panda_finger_joint1, panda_finger_joint2 (sim_worker/replay.py writes
# robot.data.joint_pos in Isaac's joint order; `action` is the same 9-joint target vector).
LAYOUTS: dict[str, Layout] = {
    "franka": {"arm": (0, 7), "gripper": (7, 9)},
}


def _check_layout(layout: Layout, dim: int, what: str) -> dict:
    parts = sorted(layout.items(), key=lambda kv: kv[1][0])
    for name, (start, end) in parts:
        if start < 0 or end <= start:
            raise ValueError(f"{what}: slice {name!r} [{start}:{end}] is empty or negative")
    pos = 0
    for name, (start, end) in parts:
        if start < pos:
            raise ValueError(f"{what}: slice {name!r} [{start}:{end}] overlaps the previous slice (ends at {pos})")
        if start > pos:
            raise ValueError(f"{what}: slices do not cover [{pos}:{start}] of the {dim}-D vector")
        pos = end
    if pos != dim:
        raise ValueError(f"{what}: slices do not cover the {dim}-D vector exactly (they end at {pos})")
    return {name: {"start": start, "end": end} for name, (start, end) in layout.items()}


def build_modality(info: dict, state_layout: Layout, action_layout: Layout | None = None) -> dict:
    """modality.json content from a dataset's meta/info.json. Raises ValueError if a layout doesn't fit."""
    feats = info["features"]
    state_dim = int(feats["observation.state"]["shape"][0])
    action_dim = int(feats["action"]["shape"][0])
    modality = {
        "state": _check_layout(state_layout, state_dim, "state"),
        "action": _check_layout(action_layout or state_layout, action_dim, "action"),
    }
    videos = {k[len(IMAGE_PREFIX):]: {"original_key": k}
              for k, ft in feats.items() if k.startswith(IMAGE_PREFIX) and ft.get("dtype") == "video"}
    if videos:
        modality["video"] = videos
    modality["annotation"] = {"human.task_description": {"original_key": "task_index"}}
    return modality


def write_modality(dataset_root: Path, robot: str = "franka") -> Path:
    if robot not in LAYOUTS:
        raise KeyError(f"unknown robot {robot!r}; known layouts: {sorted(LAYOUTS)}")
    meta = Path(dataset_root) / "meta"
    info = json.loads((meta / "info.json").read_text(encoding="utf-8"))
    out = meta / "modality.json"
    out.write_text(json.dumps(build_modality(info, LAYOUTS[robot]), indent=4), encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("dataset_root", type=Path)
    p.add_argument("--robot", default="franka", choices=sorted(LAYOUTS))
    args = p.parse_args(argv)
    print(write_modality(args.dataset_root, args.robot))
    return 0


if __name__ == "__main__":
    sys.exit(main())
