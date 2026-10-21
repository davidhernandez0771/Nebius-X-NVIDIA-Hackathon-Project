"""app.pipeline.timings: how long each stage's items take, learned from earlier runs' run.log, with defaults."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.pipeline.timings import DEFAULTS, Timings, learn, samples_from_log

LOG = """\
[human-exp 15:04:40] select: 2 demos: human_a, human_b (replaying the achieved path)
[human-exp 15:04:40] [gpu.lock] acquired: T4 13548 human-exp:x:sim 2026-10-20T15:04:40
[human-exp 15:04:42] sim: starting C:\\isaac\\python.exe -m sim_worker.server --port 8770
[human-exp 15:04:56] sim: worker pid 26876 healthy
[human-exp 15:05:16] physics human_a: verified
[human-exp 15:05:42] physics human_b: failed collision
[human-exp 15:06:22] repair human_a: perfected (2 repairs, 1 verification(s))
[human-exp 15:07:12] repair human_b: kept (0 repairs, 1 verification(s))
[human-exp 15:07:32] align human_a: raw True, repaired True
[human-exp 15:07:56] align human_b: raw True, repaired True
[human-exp 15:10:26] multiply human_a: 10/10 variants verified
[human-exp 15:12:56] multiply human_b: 9/10 variants verified
[human-exp 15:12:57] [gpu.lock] released: T4 13548 human-exp:x:sim 2026-10-20T15:04:40
[human-exp 15:12:57] grid: raw 2 episodes, perfected_multiply 21 episodes
[human-exp 23:30:00] train: C:\\venvs\\lerobot\\Scripts\\python.exe -m lerobot_tools.experiments --grid g.json --steps 30000
[human-exp 23:35:00] [gpu.lock] acquired: T4 1 human-exp:x:train 2026-10-20T23:35:00
[human-exp 00:25:00] [gpu.lock] released: T4 1 human-exp:x:train 2026-10-20T23:35:00
[human-exp 00:25:00] train: run hx_x_1: raw_2 loss 0.04, perfected_multiply_2 loss 0.08
[human-exp 00:25:00] eval: C:\\isaac\\python.exe eval_cells.py --run-id hx_x_1
[human-exp 00:25:00] [gpu.lock] acquired: T4 1 human-exp:x:eval 2026-10-21T00:25:00
[human-exp 01:25:00] eval: raw_2 1/30, perfected_multiply_2 4/30
[human-exp 01:25:00] done through 'results'
"""


def test_samples_come_from_the_logs_own_timestamps():
    s = samples_from_log(LOG.splitlines(), steps=30000)
    assert s["sim_start_s"] == [14]  # starting -> healthy
    assert s["physics_s"] == [20, 26]  # healthy -> first, then line to line
    assert s["repair_s"] == [40, 50]
    assert s["align_s"] == [20, 24]
    assert s["multiply_s"] == pytest.approx([15.0, 15.0])  # 150 s over 10 variants each
    # training: from the lock (not the wait for it), across midnight, per cell and per 10k steps
    assert s["train_s_per_10k"] == pytest.approx([3000 / 2 / 3])
    assert s["eval_s"] == pytest.approx([3600 / 60])  # 60 episodes in an hour


def test_learned_timings_are_medians_of_history_with_defaults_for_the_rest(tmp_path: Path):
    for name, log in (("a", LOG), ("b", LOG.replace("15:05:16] physics human_a", "15:05:56] physics human_a"))):
        root = tmp_path / "human_exp" / name
        root.mkdir(parents=True)
        (root / "run.log").write_text(log, encoding="utf-8")
        (root / "config.json").write_text(json.dumps({"steps": 30000}), encoding="utf-8")
    t = learn(tmp_path)
    assert isinstance(t, Timings)
    # a: 20, 26; b: 60 (its next physics line comes "before" it, a negative gap, which is dropped)
    assert t.per("physics_s") == pytest.approx(26.0)
    assert t.source("physics_s").startswith("measured")
    assert t.per("nemotron_s") == DEFAULTS["nemotron_s"] and t.source("nemotron_s") == "default"
    assert t.to_dict()["physics_s"]["n"] >= 3


def test_no_history_means_the_defaults():
    t = learn(Path("Z:/nowhere"))
    for k, v in DEFAULTS.items():
        assert t.per(k) == v
