"""scripts/replay_experiment_store.py: a finished experiment store played back into a new folder at its own pace
(sped up), so the data showcase's live mode can be watched without the GPU."""
from __future__ import annotations

import importlib.util
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "replay_experiment_store.py"


@pytest.fixture(scope="module")
def rp():
    spec = importlib.util.spec_from_file_location("replay_experiment_store", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _at(path: Path, text: str, when: datetime) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    ts = when.timestamp()
    os.utime(path, (ts, ts))


DAY = datetime(2026, 10, 20)


@pytest.fixture
def src(tmp_path):
    s = tmp_path / "src" / "exp1"
    _at(s / "config.json", '{"ids": ["h1"]}', DAY.replace(hour=15, minute=4, second=0))
    _at(s / "stages" / "physics" / "h1.json", "{}", DAY.replace(hour=15, minute=5, second=23))
    _at(s / "store" / "demos" / "h1_m1" / "episode" / "front" / "000000.png", "png", DAY.replace(hour=15, minute=15))
    _at(s / "store" / "demos" / "h1_m1" / "passport.json", "{}", DAY.replace(hour=15, minute=15, second=2))
    _at(s / "run.log", "[human-exp 15:04:31] select: 1 demos: h1 (replaying the achieved path)\n"
                       "[human-exp 15:05:23] physics h1: verified\n"
                       "[mp4 @ 01] noise without a time\n"
                       "[human-exp 15:15:31] multiply h1: 1/1 variants verified\n", DAY.replace(hour=15, minute=16))
    live = tmp_path / "src" / "live" / "h1" / "demo.json"
    _at(live, "{}", DAY.replace(hour=14))
    return s


def test_the_plan_puts_every_file_and_log_line_at_its_time(rp, src):
    plan = rp.plan(src, live_dirs=[src.parent / "live" / "h1"])
    kinds = [(round(s.at), s.kind, s.rel) for s in plan]
    # The live recordings first (they existed before the run), then everything at its own second from the start.
    assert kinds[0] == (0, "file", "demos/h1/demo.json")
    rest = kinds[1:]
    assert rest == sorted(rest, key=lambda k: k[0])
    assert (0, "file", "human_exp/exp1/config.json") in rest
    assert (31, "log", "human_exp/exp1/run.log") in rest
    assert (83, "file", "human_exp/exp1/stages/physics/h1.json") in rest
    assert (660, "file", "human_exp/exp1/store/demos/h1_m1/episode/front/000000.png") in rest
    assert (662, "file", "human_exp/exp1/store/demos/h1_m1/passport.json") in rest
    logs = [s.line for s in plan if s.kind == "log"]
    assert len(logs) == 4 and logs[2].startswith("[mp4")  # a line without a time keeps its place
    assert not any(s.rel == "human_exp/exp1/run.log" and s.kind == "file" for s in plan)


def test_running_it_rebuilds_the_store_sped_up(rp, src, tmp_path):
    waits: list[float] = []
    dest = tmp_path / "dest"
    rp.run(rp.plan(src, live_dirs=[src.parent / "live" / "h1"]), dest, speed=60, sleep=waits.append)
    assert (dest / "demos" / "h1" / "demo.json").is_file()
    exp = dest / "human_exp" / "exp1"
    assert (exp / "store" / "demos" / "h1_m1" / "passport.json").is_file()
    assert (exp / "run.log").read_text(encoding="utf-8").count("\n") == 4
    assert abs(sum(waits) - 691 / 60) < 0.05  # until the last step, the log line at 15:15:31


def test_it_refuses_to_write_over_an_existing_store(rp, src, tmp_path):
    dest = tmp_path / "dest"
    (dest / "human_exp" / "exp1").mkdir(parents=True)
    with pytest.raises(SystemExit):
        rp.main(["--src", str(src), "--data", str(dest), "--speed", "60"])
