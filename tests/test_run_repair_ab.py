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
                "why": "lift the place 2 cm", "calls": 2,
                "rescues": [{"round": 1, "reason": "length"}] if id == "standin_02" else []}


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
    assert s["model_calls"] == 8
    assert s["rescues"] == {"total": 1, "length": 1, "no_json": 0, "demos": ["standin_02"]}
    root = tmp_path / "human_exp" / "ab1"
    row = json.loads((root / "ab" / "standin_01.json").read_text())
    assert row["order"] == ["nemotron-edits", "rules"] and row["raw"]["success"] is True
    assert json.loads((root / "ab_summary.json").read_text())["n"] == 4
    frozen = json.loads((root / "ab_config.json").read_text())
    assert frozen["prompt_sha256"] == ab.prompt_sha256() and frozen["arms"] == ["rules", "nemotron-edits"]
    prereg = (root / "preregistration.md").read_text(encoding="utf-8")
    assert prereg.startswith("# Pre-registration: repairer A/B `ab1`") and "standin_03" in prereg
    assert "Rescue: a thinking reply cut at the token cap" in prereg
    assert frozen["rescue_suffix_sha256"] == ab.hashlib.sha256(ab.nemotron_repair.RESCUE_SUFFIX.encode()).hexdigest()


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


def test_a_run_frozen_before_the_rescue_is_refused(ab, tmp_path):
    arms = Arms(rules=dict.fromkeys(IDS, "kept"), edits=dict.fromkeys(IDS, "kept"))
    run, _ = _setup(ab, tmp_path, arms)
    old = {k: v for k, v in ab.ab_settings().items() if not k.startswith("rescue")}  # what repair_ab1 froze
    (tmp_path / "human_exp" / "ab1" / "ab_config.json").write_text(json.dumps({**old, "commit": "1718f5f"}))
    with pytest.raises(ab.hx.Refused, match="rescue"):
        run.run()


def test_a_stop_file_ends_the_run_cleanly_after_the_current_demo_and_a_rerun_resumes(ab, tmp_path):
    arms = Arms(rules=dict.fromkeys(IDS, "kept"), edits=dict.fromkeys(IDS, "kept"))
    run, _ = _setup(ab, tmp_path, arms)
    stop = tmp_path / "human_exp" / "ab1" / "STOP"
    stop.write_text("")  # a stale stop file from an earlier run is cleared at the start
    original = arms.rules

    def rules_then_stop(*a, **kw):
        out = original(*a, **kw)
        if a[2] == "standin_01":
            stop.write_text("17:15")  # asked to stop while standin_01 runs: it still finishes
        return out

    run.perfect_rules = rules_then_stop
    with pytest.raises(ab.hx.Stop, match="stop file"):
        run.run()
    assert list(run.rows()) == ["standin_00", "standin_01"]
    stop.unlink()
    assert run.run()["n"] == 4


def test_hybrid_is_the_rules_result_else_the_blind_edits_run_and_is_the_primary_comparison(ab, tmp_path):
    arms = Arms(rules=dict(zip(IDS, ["perfected", "discarded", "discarded", "kept"])),
                edits=dict(zip(IDS, ["discarded", "perfected", "discarded", "discarded"])))
    run, sim = _setup(ab, tmp_path, arms)
    s = run.run()
    assert s["arms"]["hybrid"]["status"] == dict(zip(IDS, ["perfected", "perfected", "discarded", "kept"]))
    assert s["arms"]["hybrid"]["pass"] == 3 and s["arms"]["rules"]["pass"] == 2
    assert s["primary"] == {"arms": ["rules", "hybrid"], "both": 2, "only_rules": 0, "only_hybrid": 1,
                            "neither": 1, "mcnemar_p": 1.0}
    assert s["paired"]["only_edits"] == 1 and s["paired"]["only_rules"] == 2  # secondary: rules vs edits alone
    assert len(sim.requests) == len(IDS)  # hybrid adds no replay: it reuses both arms' runs
    root = tmp_path / "human_exp" / "ab1"
    assert "hybrid" in json.loads((root / "ab_summary.json").read_text())["arms"]
    prereg = (root / "preregistration.md").read_text(encoding="utf-8")
    assert "Primary: rules vs hybrid" in prereg and "Secondary: rules vs nemotron-edits" in prereg


def test_the_frozen_settings_carry_the_variance_fixes(ab):
    s = ab.ab_settings()
    assert s["temperature"] == 0.0 and s["prompt_fingerprint"] == ab.nemotron_repair.prompt_fingerprint()
    assert s["primary"].startswith("rules vs hybrid")


def test_select_forwards_input_only_when_given(ab):
    p = ab.build_parser()
    assert "input" not in ab.select_kwargs(p.parse_args(["--name", "x", "--tag", "human_*"]))
    kw = ab.select_kwargs(p.parse_args(["--name", "x", "--tag", "human_20261020*", "--input", "keyboard"]))
    assert kw == {"ids": None, "tag": "human_20261020*", "settings": ab.SETTINGS, "input": "keyboard"}
