"""Write web/src/site/results/scenes.json: the big test's 40 scenes, one row each, for the Results page's hero grid.

Read-only over the committed raw log (docs/superpowers/notes/2026-10-23-bigtest/results/final_test/
bigtest_final.episodes.jsonl). Each row keeps only what the page shows: seed, success, simulated seconds, reasons.

    uv run python scripts/build_scene_grid.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / "docs/superpowers/notes/2026-10-23-bigtest/results/final_test/bigtest_final.episodes.jsonl"
OUT = ROOT / "web/src/site/results/scenes.json"


def scene_rows(log: Path = LOG) -> list[dict]:
    """One row per seed; a resumed eval can write a seed twice, and the last row wins (as run_eval --resume does)."""
    latest: dict[int, dict] = {}
    for line in log.read_text(encoding="utf-8").splitlines():
        ep = json.loads(line).get("episode") if line.strip() else None
        if ep:
            latest[ep["seed"]] = {"seed": ep["seed"], "success": ep["success"], "sim_s": round(ep["sim_s"], 2), "reasons": ep["reasons"]}
    return [latest[s] for s in sorted(latest)]


def main() -> None:
    rows = scene_rows()
    OUT.write_text(json.dumps({"source": str(LOG.relative_to(ROOT)), "scenes": rows}, indent=1) + "\n", encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {sum(r['success'] for r in rows)}/{len(rows)}")


if __name__ == "__main__":
    main()
