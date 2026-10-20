"""The GPU smoke test of the scene creator's Isaac side: every example plan (sim_worker/scene_examples/*.json)
built in Isaac, settled for 1 s and photographed by the front camera, one Isaac process per plan
(sim_worker/scripts/settle_plan.py, which takes the shared GPU lock). This script itself doesn't import Isaac.

Usage (Isaac's python, so the children run in it too; about a minute per plan):
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe sim_worker\\scripts\\scene_smoke.py --out data\\scene_smoke

Writes <out>/<plan>.json (settle result), <out>/<plan>.png (front camera) and <out>/summary.json. Exits 1 if a run
failed (Isaac error); a plan that doesn't settle is reported, not a failure of the smoke test.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EXAMPLES = REPO / "sim_worker" / "scene_examples"
SETTLE = REPO / "sim_worker" / "scripts" / "settle_plan.py"


def commands(out: Path, python: str = sys.executable, examples: Path = EXAMPLES) -> list[tuple[str, list[str]]]:
    """(plan name, command) per example plan, in name order."""
    return [(p.stem, [python, str(SETTLE), "--plan", str(p), "--out", str(out / f"{p.stem}.json"),
                      "--screenshot", str(out / f"{p.stem}.png")]) for p in sorted(examples.glob("*.json"))]


def main(argv: list[str] | None = None, run=subprocess.run) -> int:
    ap = argparse.ArgumentParser(description="Settle and photograph the example ScenePlans in Isaac.")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    rows, failed = [], False
    for name, cmd in commands(args.out):
        print(f"[smoke] {name}: {' '.join(cmd)}", flush=True)
        code = run(cmd).returncode
        result_path = args.out / f"{name}.json"
        if code != 0 or not result_path.exists():
            failed = True
            rows.append({"plan": name, "ran": False, "exit": code})
            continue
        res = json.loads(result_path.read_text(encoding="utf-8"))
        rows.append({"plan": name, "ran": True, "settled": not res["errors"], "errors": res["errors"],
                     "max_moved_m": max(res["moved"].values(), default=0.0)})
    (args.out / "summary.json").write_text(json.dumps(rows, indent=1), encoding="utf-8")
    for r in rows:
        state = "FAILED TO RUN" if not r["ran"] else "settled" if r["settled"] else "; ".join(r["errors"])
        print(f"[smoke] {r['plan']}: {state}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
