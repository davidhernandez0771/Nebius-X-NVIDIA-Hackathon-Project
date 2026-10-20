"""scripts/run_repair_ab.py: the blind rules-vs-Nemotron-edits A/B, on a fake worker with fake repairers."""
from __future__ import annotations

import importlib.util
import json
import sys
from contextlib import contextmanager
from pathlib import Path

import pytest

from demo_pipeline.store import DemoStore
from fake_sim_worker import FakeSim
from nebius_llm import TokenFactoryError
from sim_worker.standin import standin_demo

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_repair_ab.py"
IDS = ["standin_00", "standin_01", "standin_02", "standin_03"]
SETTINGS = {"variants": 2, "steps": 2000, "save_freq": 2000, "eval_n": 5, "eval_seed0": 5020, "smoke": True,
            "raw_arm": "all", "judge_copies": 1, "nemotron": False, "max_cost_usd": 0.0,
            "replay_path": "commanded"}  # stand-ins have no live episode


@pytest.fixture(scope="module")
def ab():
    spec = importlib.util.spec_from_file_location("run_repair_ab", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


class Arms:
    """Fake perfect_stored_demo / perfect_stored_demo_edits: a status per (arm, id), every call recorded."""

    def __init__(self, rules, edits, cost=0.01, edits_error=None):
        self.statuses = {"rules": rules, "nemotron-edits": edits}
        self.cost, self.edits_error, self.calls = cost, edits_error, []

    def rules(self, store, client, id, diagnoser, *, raw, record_cameras):
        assert diagnoser == "rules" and raw is not None and record_cameras
        self.calls.append(("rules", id))
        return {"status": self.statuses["rules"][id], "repairs": []}

    def edits(self, store, client, id, *, raw, record_cameras, before_model_call):
        self.calls.append(("nemotron-edits", id))
        before_model_call()
        if self.edits_error is not None and id == self.edits_error:
            raise TokenFactoryError("503")
        return {"status": self.statuses["nemotron-edits"][id], "repairs": [], "cost_usd": self.cost,
                "why": "lift the place 2 cm"}


def _setup(ab, tmp_path, arms, *, max_cost_usd=1.0, name="ab1"):
    user = DemoStore(tmp_path)
    for i, id in enumerate(IDS):
        user.save_demo(standin_demo(7000 + i, id=id)[0])
    sim = FakeSim(tmp_path)

    @contextmanager
    def gpu_stage(task):
        yield

    @contextmanager
    def session():
        yield sim

    exp = ab.hx.Experiment(tmp_path, name, ab.hx.Deps(user_store=user, sim_session=session, gpu_stage=gpu_stage,
                                                      run=lambda c, p: 0, log=lambda m: None))
    exp.select(ids=None, tag="standin_*", settings=SETTINGS)
    return ab.RepairAB(exp, max_cost_usd=max_cost_usd, perfect_rules=arms.rules, perfect_edits=arms.edits), sim


def test_both_arms_run_on_the_same_raw_replay_in_alternating_order(ab, tmp_path):
    arms = Arms(rules=dict(zip(IDS, ["perfected", "discarded", "discarded", "kept"])),
                edits=dict(zip(IDS, ["perfected", "perfected", "discarded", "discarded"])))
    run, sim = _setup(ab, tmp_path, arms)
    s = run.run()
    assert [r.out_name for r in sim.requests] == [f"{id}_raw" for id in IDS]  # one physics replay per demo
    assert arms.calls[:4] == [("rules", "standin_00"), ("nemotron-edits", "standin_00"),
                              ("nemotron-edits", "standin_01"), ("rules", "standin_01")]
    assert s["arms"]["rules"]["pass"] == 2 and s["arms"]["nemotron-edits"]["pass"] == 2
    assert s["paired"] == {"both": 1, "only_rules": 1, "only_edits": 1, "neither": 1}
    assert s["mcnemar_p"] == 1.0 and s["nemotron_cost_usd"] == pytest.approx(0.04)
    root = tmp_path / "human_exp" / "ab1"
    row = json.loads((root / "ab" / "standin_01.json").read_text())
    assert row["order"] == ["nemotron-edits", "rules"] and row["raw"]["success"] is True
    assert json.loads((root / "ab_summary.json").read_text())["n"] == 4
    frozen = json.loads((root / "ab_config.json").read_text())
    assert frozen["prompt_sha256"] == ab.prompt_sha256() and frozen["arms"] == ["rules", "nemotron-edits"]
    prereg = (root / "preregistration.md").read_text(encoding="utf-8")
    assert prereg.startswith("# Pre-registration: repairer A/B `ab1`") and "standin_03" in prereg


def test_a_rerun_resumes_and_redoes_nothing(ab, tmp_path):
    arms = Arms(rules=dict.fromkeys(IDS, "discarded"), edits=dict.fromkeys(IDS, "perfected"))
    run, sim = _setup(ab, tmp_path, arms)
    run.run()
    n = len(arms.calls)
    s = run.run()
    assert len(arms.calls) == n and s["paired"]["only_edits"] == 4
    assert s["mcnemar_p"] == pytest.approx(2 / 16)


def test_the_spend_cap_stops_the_run_and_a_rerun_with_more_budget_carries_on(ab, tmp_path):
    arms = Arms(rules=dict.fromkeys(IDS, "kept"), edits=dict.fromkeys(IDS, "kept"), cost=0.5)
    run, _ = _setup(ab, tmp_path, arms, max_cost_usd=0.9)
    with pytest.raises(ab.hx.Stop, match="cap"):
        run.run()
    assert len(run.rows()) == 2  # standin_00 and _01 cost 1.0 together; _02 is refused before its model call
    run.max_cost_usd = 5.0
    assert run.run()["n"] == 4


def test_a_model_api_failure_stops_and_the_demo_is_redone_on_resume(ab, tmp_path):
    arms = Arms(rules=dict.fromkeys(IDS, "kept"), edits=dict.fromkeys(IDS, "kept"), edits_error="standin_01")
    run, _ = _setup(ab, tmp_path, arms)
    with pytest.raises(ab.hx.Stop, match="Nemotron API failed"):
        run.run()
    assert list(run.rows()) == ["standin_00"]
    arms.edits_error = None
    assert run.run()["n"] == 4


def test_changed_edits_settings_are_refused(ab, tmp_path, monkeypatch):
    arms = Arms(rules=dict.fromkeys(IDS, "kept"), edits=dict.fromkeys(IDS, "kept"))
    run, _ = _setup(ab, tmp_path, arms)
    run.run()
    monkeypatch.setattr(ab.nemotron_repair, "MAX_ROUNDS", 5)
    with pytest.raises(ab.hx.Refused, match="max_rounds"):
        run.run()
