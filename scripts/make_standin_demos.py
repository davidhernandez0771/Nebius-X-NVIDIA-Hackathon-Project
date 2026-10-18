"""Write stand-in "human-like" demos (sim_worker.standin) into a DemoStore, as if recorded on the Record page.

    uv run python scripts/make_standin_demos.py --n 10 --prefix standin [--data-dir <DATA_DIR>] [--seed0 7000]

Demo i is standin_demo(seed0 + i) with id <prefix>_<i:02d>, source "human". The injected issues go to
<store>/demos/<id>/standin.json (ground truth, read by no diagnoser). Pure code, no sim: about a second for 10.
An id that is already stored is left alone unless --force. Then run the experiment on them with
--tag "<prefix>_*".
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # repo root, for `sim_worker`

from demo_pipeline.store import DemoStore, write_atomic  # noqa: E402
from sim_worker.standin import standin_demo  # noqa: E402


def make_standins(store: DemoStore, n: int, prefix: str, seed0: int = 7000, force: bool = False) -> list[dict]:
    rows = []
    for i in range(n):
        id = f"{prefix}_{i:02d}"
        if store.has_demo(id) and not force:
            rows.append({"id": id, "status": "kept"})
            continue
        demo, truth = standin_demo(seed0 + i, id=id)
        store.save_demo(demo)
        write_atomic(store.root / "demos" / id / "standin.json", json.dumps(truth, indent=1))
        rows.append({"id": id, "status": "written", "seed": seed0 + i, "steps": len(demo.trajectory.t),
                     "seconds": round(demo.trajectory.duration, 2)})
    return rows


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--n", type=int, default=10)
    p.add_argument("--prefix", default="standin")
    p.add_argument("--seed0", type=int, default=7000)
    p.add_argument("--data-dir", type=Path, default=None, help="DemoStore root (default DATA_DIR / data)")
    p.add_argument("--force", action="store_true", help="rewrite ids that already exist")
    args = p.parse_args(argv)
    if not 1 <= args.n <= 99:
        p.error("--n must be 1-99")
    rows = make_standins(DemoStore(args.data_dir), args.n, args.prefix, args.seed0, args.force)
    for r in rows:
        print(json.dumps(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
