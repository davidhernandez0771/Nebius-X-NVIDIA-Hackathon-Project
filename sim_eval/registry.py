"""Write eval results into the experiment registry (DATA_DIR/results/registry.jsonl, see lerobot_tools.experiments).

A row matches when its cell name is `cell`, its training status is "ok", and (if given) its checkpoint resolves to
the same path as `checkpoint`. Several matches without a checkpoint is an error: the cell was trained more than once
and we must not guess which policy was evaluated. Only matching lines are rewritten; every other line is kept
byte for byte. The file is replaced atomically.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from sim_eval.results import EvalSummary

_REWRITE_TRIES = 3


def _same_path(a: str | None, b: str) -> bool:
    return a is not None and Path(a).resolve() == Path(b).resolve()


def _matches(lines: list[str], cell: str, checkpoint: str | None) -> list[tuple[int, dict]]:
    matches = []
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        row = json.loads(line)
        if (row.get("cell") or {}).get("name") != cell or row.get("status") != "ok":
            continue
        if checkpoint is not None and not _same_path(row.get("checkpoint"), checkpoint):
            continue
        matches.append((i, row))
    if not matches:
        where = f" with checkpoint {checkpoint}" if checkpoint else ""
        raise LookupError(f"no successfully trained row for cell {cell!r}{where}")
    if len(matches) > 1 and checkpoint is None:
        raise ValueError(f"cell {cell!r} has {len(matches)} rows (trained more than once); pass the checkpoint")
    return matches


def trained_rows(registry: Path, run_id: str) -> list[dict]:
    """Every successfully trained row of one experiment run, in file order."""
    rows = [json.loads(line) for line in Path(registry).read_text(encoding="utf-8").splitlines() if line.strip()]
    return [r for r in rows if r.get("run_id") == run_id and r.get("status") == "ok" and r.get("checkpoint")]


def find_row(registry: Path, cell: str, checkpoint: str | None = None) -> dict:
    """The successfully trained row for `cell` (matched like update_registry; the last if one checkpoint has several)."""
    return _matches(Path(registry).read_text(encoding="utf-8").splitlines(), cell, checkpoint)[-1][1]


def _apply(lines: list[str], cell: str, checkpoint: str | None, payload: dict) -> tuple[list[str], int]:
    matches = _matches(lines, cell, checkpoint)
    out = list(lines)
    for i, row in matches:
        row["eval_success"] = payload["success_rate"]
        row["eval"] = payload
        out[i] = json.dumps(row)
    return out, len(matches)


def update_registry(registry: Path, cell: str, summary: EvalSummary, *, seed0: int, checkpoint: str | None = None,
                    results_file: str | None = None) -> int:
    """Set eval_success (= successes / n) and an `eval` record on the matching row(s). Returns how many."""
    registry = Path(registry)
    payload = {
        "success_rate": summary.success_rate,
        "n": summary.n,
        "successes": summary.successes,
        "seed0": seed0,
        "reasons": summary.reasons,
        "ended_by": summary.ended_by,
        "results_file": results_file,
        "evaluated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    for _ in range(_REWRITE_TRIES):
        text = registry.read_text(encoding="utf-8")  # FileNotFoundError if missing
        lines, n = _apply(text.splitlines(), cell, checkpoint, payload)
        tmp = registry.with_name(registry.name + ".tmp")
        tmp.write_text("".join(line + "\n" for line in lines), encoding="utf-8")
        # The experiment runner appends rows; if one landed while we worked, redo it rather than drop that row.
        if registry.read_text(encoding="utf-8") == text:
            os.replace(tmp, registry)
            return n
        tmp.unlink()
    raise RuntimeError(f"{registry} kept changing while being updated; try again")
