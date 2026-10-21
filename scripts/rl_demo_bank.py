"""Build the RL teacher's demo-start bank (demo_pipeline.rl_demo_bank) from an experiment store. Reads the store only.

    uv run --no-sync python scripts/rl_demo_bank.py --store C:/dev/pm-t6/data/human_exp/mouse20261020/store \
        --out data/rl/bank_mouse20261020.npz [--stride 5] [--include-raw]

Writes <out> (the states) and <out>.json (the episodes they came from, the counts).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "src"), str(REPO)]

from demo_pipeline.rl_demo_bank import STRIDE, build_bank, save_bank  # noqa: E402
from demo_pipeline.store import DemoStore  # noqa: E402


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--store", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--stride", type=int, default=STRIDE)
    p.add_argument("--include-raw", action="store_true", help="also the verified raw takes, aligned (<id>_home)")
    args = p.parse_args(argv)
    bank, meta = build_bank(DemoStore(args.store), stride=args.stride, include_raw=args.include_raw)
    save_bank(args.out, bank, meta)
    print(json.dumps({k: v for k, v in meta.items() if k != "episodes"} | {"episodes": len(meta["episodes"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
