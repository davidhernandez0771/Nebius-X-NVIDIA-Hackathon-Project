"""Ask Nemotron for repair edits on stored, failed replays, without a simulator (app.ai.nemotron_repair dry run).

    uv run --env-file <.env> python scripts/nemotron_repair_dryrun.py --store <DemoStore root> [--tag "human_2026*"] ^
        [--ids a,b] [--out results.json] [--tier super] [--no-think] [--max-rounds 3]

Each demo needs demo.json, passport.json (the raw replay's verdict) and episode/ (its signals), as the human-demo
experiment's store holds them (DATA_DIR/human_exp/<name>/store). Prints, per demo, the verdict and the first valid
plan (or the errors), and writes everything, prompts' replies included, to --out. Nothing is replayed or stored.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import sys
from pathlib import Path

from app.ai import nemotron_repair as nr
from app.jobs import align_signals
from demo_pipeline.episode_io import load_signals
from demo_pipeline.store import DemoStore


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--store", required=True, type=Path)
    ap.add_argument("--tag", default="human_*")
    ap.add_argument("--ids", default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--tier", default=nr.TIER)
    ap.add_argument("--no-think", action="store_true")
    ap.add_argument("--max-rounds", type=int, default=nr.MAX_ROUNDS)
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # the model writes symbols like "≈"

    store = DemoStore(args.store)
    names = sorted(p.name for p in (args.store / "demos").iterdir() if p.is_dir())
    ids = args.ids.split(",") if args.ids else [n for n in names if fnmatch.fnmatchcase(n, args.tag)]
    rows, cost = [], 0.0
    for id in ids:
        demo, passport = store.get_demo(id), store.get_passport(id)
        signals = align_signals(load_signals(store.episode_dir(id)), demo.trajectory.t)
        v = passport.verification
        if v.success:
            print(f"{id}: passed as recorded; nothing to repair")
            continue
        res = nr.repair_with_nemotron(demo, v, signals, None, tier=args.tier, think=not args.no_think,
                                      max_rounds=args.max_rounds)
        cost += res.cost_usd
        print(f"\n{id}: {nr.verdict_text(v)}")
        print(f"  {res.status} after {res.calls} call(s), ${res.cost_usd:.4f}")
        for r in res.rounds:
            for e in r.get("errors", []):
                print(f"  round {r['round']} rejected: {e}")
        if res.plan is not None:
            print(f"  why: {res.plan.why}")
            for e in res.plan.edits:
                print(f"  - {json.dumps(e.model_dump())}")
        if res.report is not None:
            print(f"  changed: {res.report.text()}")
        rows.append({"id": id, "verdict": v.model_dump(), **res.summary()})
    print(f"\n{len(rows)} demos, est. ${cost:.4f}")
    if args.out:
        args.out.write_text(json.dumps(rows, indent=1), encoding="utf-8")
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
