"""First-frame joint positions of a LeRobot v3 dataset, for sim_eval's start-state check (Review Focus 4).

    C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.start_state <dataset root> [--write]

Prints sim_eval.start_state.check_start's report (the eval reset pose vs the dataset's mean start pose, and which
one the eval will use). --write saves <dataset root>/start_state.json, which sim_eval/scripts/run_eval.py reads;
lerobot_tools.assemble writes it for every cell it exports. Needs pyarrow (lerobot venv), not lerobot itself.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from sim_eval.start_state import check_start, save_starts

STATE_KEY = "observation.state"


def dataset_start_states(root: Path) -> np.ndarray:
    """(n_episodes, state_dim) observation.state at frame_index 0 of each episode, in episode_index order."""
    import pyarrow.parquet as pq

    files = sorted((Path(root) / "data").glob("chunk-*/file-*.parquet"))
    if not files:
        raise FileNotFoundError(f"no data/chunk-*/file-*.parquet under {root}")
    first: dict[int, np.ndarray] = {}
    episodes: set[int] = set()
    for f in files:
        t = pq.read_table(f, columns=[STATE_KEY, "episode_index", "frame_index"]).to_pydict()
        for state, ep, frame in zip(t[STATE_KEY], t["episode_index"], t["frame_index"]):
            episodes.add(int(ep))
            if frame == 0:
                first[int(ep)] = np.asarray(state, dtype=np.float64)
    missing = sorted(episodes - set(first))
    if missing:
        raise ValueError(f"{root}: episode {missing[0]} has no frame_index 0 ({len(missing)} episodes affected)")
    return np.stack([first[e] for e in sorted(first)])


def write_start_state(root: Path) -> Path:
    return save_starts(Path(root), dataset_start_states(root), source=f"{Path(root).resolve()} frame_index 0")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Compare a dataset's start poses with the sim_eval reset pose")
    p.add_argument("dataset", type=Path, help="LeRobot v3 dataset root")
    p.add_argument("--write", action="store_true", help="save start_state.json into the dataset root")
    args = p.parse_args(argv)
    starts = dataset_start_states(args.dataset)
    print(json.dumps(check_start(starts).model_dump(), indent=2))
    if args.write:
        save_starts(args.dataset, starts, source=f"{args.dataset.resolve()} frame_index 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
