"""Render a frozen demo set (T1's set v2, sprint 5 Task 3) and tabulate verification per demo type. Pure.

<set>/manifest.json  {"demos": [{"id", "type", "seed", ...}, ...]}   (T1's builder; order kept)
<set>/<id>/demo.json, truth.json                                    (copied verbatim next to the episode)

A demo must fail verification when its truth holds a drop or bad_release issue (read from the truth, not the type
name). A must-fail demo that verified is a violation: the injection did not do what its truth says (plan: fix it
with T1 through the notes).
"""

from __future__ import annotations

import collections
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from demo_pipeline.schemas import Demo

MUST_FAIL_TYPES = frozenset({"drop", "bad_release"})


@dataclass(frozen=True)
class SetEntry:
    id: str
    type: str
    dir: Path
    demo: Demo
    truth: dict
    meta: dict


def set_entries(set_dir: Path) -> list[SetEntry]:
    set_dir = Path(set_dir)
    manifest = json.loads((set_dir / "manifest.json").read_text(encoding="utf-8"))
    out = []
    for m in manifest["demos"]:
        d = set_dir / m["id"]
        demo = Demo.model_validate_json((d / "demo.json").read_text(encoding="utf-8"))
        truth = json.loads((d / "truth.json").read_text(encoding="utf-8"))
        out.append(SetEntry(id=m["id"], type=m.get("type", "unknown"), dir=d, demo=demo, truth=truth, meta=m))
    return out


def must_fail(truth: dict) -> bool:
    return any(i["type"] in MUST_FAIL_TYPES and not i.get("dont_care", False) for i in truth.get("issues", []))


def copy_case_files(entry: SetEntry, ep: Path) -> None:
    ep = Path(ep)
    ep.mkdir(parents=True, exist_ok=True)
    for name in ("demo.json", "truth.json"):
        shutil.copyfile(entry.dir / name, ep / name)


def outcome_table(rows: list[dict]) -> dict[str, dict]:
    """rows: {"id", "type", "must_fail", "success", "reasons"} per rendered demo -> per-type counts."""
    table: dict[str, dict] = {}
    for r in rows:
        t = table.setdefault(r["type"], {"n": 0, "verified": 0, "failed": 0, "reasons": collections.Counter(),
                                         "must_fail": 0, "violations": [], "sim_errors": []})
        t["n"] += 1
        t["verified" if r["success"] else "failed"] += 1
        t["reasons"].update(r["reasons"])
        t["must_fail"] += bool(r["must_fail"])
        if r["must_fail"] and r["success"]:
            t["violations"].append(r["id"])
        if "sim_error" in r["reasons"]:
            t["sim_errors"].append(r["id"])
    for t in table.values():
        t["reasons"] = dict(t["reasons"])
    return table
