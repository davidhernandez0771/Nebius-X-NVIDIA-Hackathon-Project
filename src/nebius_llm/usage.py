"""Append-only JSONL log of token usage and estimated cost per API call."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _log_path() -> Path:
    return Path(os.environ.get("USAGE_LOG_PATH") or "usage_log.jsonl")


def record_usage(entry: dict[str, Any]) -> None:
    """Append one call's usage as a JSON line. Never raises (logging must not break calls)."""
    entry = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), **entry}
    try:
        path = _log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass


def total_spend() -> dict[str, Any]:
    """Sum the log: calls, tokens and estimated USD, overall and per tier."""
    totals: dict[str, Any] = {
        "calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "est_cost_usd": 0.0,
        "by_tier": {},
    }
    path = _log_path()
    if not path.exists():
        return totals
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            tier = e.get("tier", "?")
            bucket = totals["by_tier"].setdefault(
                tier, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "est_cost_usd": 0.0}
            )
            for b in (totals, bucket):
                b["calls"] += 1
                b["prompt_tokens"] += int(e.get("prompt_tokens") or 0)
                b["completion_tokens"] += int(e.get("completion_tokens") or 0)
                b["est_cost_usd"] += float(e.get("est_cost_usd") or 0.0)
    return totals
