"""scripts/make_standin_demos.py: stand-ins land in the DemoStore as human demos with their truth beside them."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from demo_pipeline.store import DemoStore

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_standin_demos.py"


def _load():
    spec = importlib.util.spec_from_file_location("make_standin_demos", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_writes_human_demos_with_truth_and_keeps_existing(tmp_path):
    mod = _load()
    store = DemoStore(tmp_path)
    rows = mod.make_standins(store, 3, "standin")
    assert [r["id"] for r in rows] == ["standin_00", "standin_01", "standin_02"]
    assert all(r["status"] == "written" for r in rows)
    demo = store.get_demo("standin_01")
    assert demo.source == "human"
    truth = json.loads((tmp_path / "demos" / "standin_01" / "standin.json").read_text(encoding="utf-8"))
    assert truth["seed"] == 7001 and truth["issues"]
    before = (tmp_path / "demos" / "standin_01" / "demo.json").read_bytes()
    again = mod.make_standins(store, 3, "standin")
    assert [r["status"] for r in again] == ["kept"] * 3
    assert (tmp_path / "demos" / "standin_01" / "demo.json").read_bytes() == before
