"""Assemble one LeRobot dataset per experiment cell, with a lineage manifest.

A cell is one bar of the chart: a condition (raw, raw + multiply, perfected + multiply, rules-only + multiply) at a
number of human demos. `assemble(cell, out_root)` exports the cell's episodes to `out_root/<condition>_<n_human>/`
(lerobot_tools.export) and writes `manifest.json` next to LeRobot's files: the episode dirs, and for each episode
its lineage, human root, repairs and diagnosis source, read from the episode's passport.

Integrity checks, so a cell can't quietly use more human data than its label says:
- the episodes may descend from at most `n_human` distinct human demos (fewer is fine: some may be discarded);
- `raw` and `raw_multiply` episodes must carry no repairs.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from demo_pipeline.episode_io import load_episode

MANIFEST_FILE = "manifest.json"
Condition = Literal["raw", "raw_multiply", "perfected_multiply", "rules_multiply"]
UNREPAIRED_CONDITIONS = ("raw", "raw_multiply")


class Cell(BaseModel):
    model_config = ConfigDict(extra="forbid")

    condition: Condition
    n_human: int = Field(gt=0)
    episode_dirs: list[Path] = Field(min_length=1)

    @property
    def name(self) -> str:
        return f"{self.condition}_{self.n_human}"


def build_manifest(cell: Cell) -> dict:
    """Read every episode's meta + passport and check the cell's integrity. Raises ValueError on a violation."""
    rows = []
    for i, ep_dir in enumerate(cell.episode_dirs):
        meta, _, _ = load_episode(Path(ep_dir))
        pp = meta.passport
        lineage = list(pp.lineage) if pp else [meta.demo_id]
        repairs = [r.op for r in pp.repairs_applied] if pp else []
        if cell.condition in UNREPAIRED_CONDITIONS and repairs:
            raise ValueError(f"{cell.name}: episode {meta.demo_id} has repairs {repairs}; "
                             f"{cell.condition} cells take unrepaired demos only")
        rows.append({
            "episode_index": i,
            "episode_dir": str(Path(ep_dir).resolve()),
            "demo_id": meta.demo_id,
            "n_steps": meta.n_steps,
            "robot": meta.robot,
            "has_passport": pp is not None,
            "lineage": lineage,
            "human_root": lineage[0],
            "repairs": repairs,
            "diagnosis_source": pp.diagnosis_source if pp else None,
            "variant_seed": pp.variant_seed if pp else None,
        })
    roots = sorted({r["human_root"] for r in rows})
    if len(roots) > cell.n_human:
        raise ValueError(f"{cell.name}: episodes descend from {len(roots)} human demos {roots}, "
                         f"but the cell says n_human={cell.n_human}")
    return {
        "cell": {"condition": cell.condition, "n_human": cell.n_human, "name": cell.name},
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "n_episodes": len(rows),
        "n_frames": sum(r["n_steps"] for r in rows),
        "human_roots": roots,
        "diagnosis_sources": dict(Counter(r["diagnosis_source"] for r in rows if r["diagnosis_source"])),
        "episodes": rows,
    }


def assemble(cell: Cell, out_root: Path, fps: int = 50) -> Path:
    """Export the cell to `out_root/<cell.name>/` (must not exist yet) and write its manifest. Returns that path."""
    from lerobot_tools.export import export_episodes

    manifest = build_manifest(cell)  # validate before writing anything
    out = Path(out_root) / cell.name
    if out.exists():
        raise FileExistsError(f"{out} already exists; each cell is exported once")
    repo_id = f"local/{cell.name}"
    export_episodes(list(cell.episode_dirs), out, repo_id=repo_id, fps=fps)
    manifest = {"dataset": str(out.resolve()), "repo_id": repo_id, "fps": fps, **manifest}
    (out / MANIFEST_FILE).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return out
