"""app.jobs.perfect_stored_demo_edits: Nemotron's edits as the perfect loop's alternative repairer (fake worker,
scripted model)."""
from __future__ import annotations

import json
from functools import partial

import pytest

from app.ai.nemotron_repair import repair_with_nemotron
from app.jobs import EDITS_REPAIRER, perfect_stored_demo_edits
from app.sim_client import SimWorkerError, SimWorkerUnavailable
from demo_pipeline.sim_protocol import ReplayRequest
from demo_pipeline.store import DemoStore
from fake_sim_worker import FakeSim, verification
from test_nemotron_repair import GOOD, Model, _demo

COLLISION = verification(False, ["collision"])
BAD = {"edits": [{"op": "shift_segment", "t0": 6.2, "t1": 7.0, "dz": 0.001}]}


@pytest.fixture
def store(tmp_path):
    s = DemoStore(tmp_path / "store")
    s.save_demo(_demo())
    return s


def _run(store, sim, model, **kw):
    return perfect_stored_demo_edits(store, sim, "human_test", sleep=lambda s: None,
                                     repair=partial(repair_with_nemotron, chat_fn=model), **kw)


def test_a_verified_edit_is_stored_as_the_repaired_demo(store, tmp_path):
    sim = FakeSim(tmp_path / "worker", results=[COLLISION, verification()])
    out = _run(store, sim, Model(GOOD))
    assert out["status"] == "perfected" and out["diagnoser"] == EDITS_REPAIRER
    assert out["output_demo_id"] == "human_test_edits" and out["attempts"] == 1 and out["calls"] == 1
    assert out["rescues"] == []
    assert [r.out_name for r in sim.requests] == ["human_test_raw", "human_test_edits_v1"]
    rep = store.get_demo("human_test_edits")
    assert (rep.source, rep.parent_id) == ("repaired", "human_test")
    assert sim.requests[-1].trajectory == rep.trajectory  # what was verified is what was stored
    pp = store.get_passport("human_test_edits")
    assert (pp.diagnosis_source, pp.model_id, pp.repairs_applied) == ("nemotron", "fake-nemotron", [])
    assert pp.lineage == ["human_test", "human_test_edits"] and pp.verification.success
    plan = json.loads((store.root / "demos" / "human_test_edits" / "edit_plan.json").read_text())
    assert plan["parent"] == "human_test" and plan["plan"]["edits"][0]["dz"] == 0.025
    assert out["repairs"][0]["op"] == "shift_segment" and out["report"]["max_moved_cm"] == pytest.approx(2.5)
    assert (store.episode_dir("human_test_edits") / "signals.npz").is_file()
    assert json.loads((store.root / "demos" / "human_test" / "edit_repair.json").read_text())["status"] == "perfected"


def test_a_raw_replay_that_passes_is_kept_without_a_model_call(store, tmp_path):
    sim = FakeSim(tmp_path / "worker")
    out = _run(store, sim, Model())  # no replies: a call would fail
    assert out["status"] == "kept" and out["calls"] == 0 and out["diagnosis_source"] == "none"
    assert store.get_demo("human_test_edits").trajectory == _demo().trajectory


def test_edits_that_never_verify_are_discarded_and_nothing_is_stored(store, tmp_path):
    sim = FakeSim(tmp_path / "worker", results=[COLLISION])
    out = _run(store, sim, Model(BAD, BAD, BAD))
    assert out["status"] == "discarded" and out["output_demo_id"] is None and out["attempts"] == 3
    assert not store.has_demo("human_test_edits")
    assert any("failed after 3 call(s)" in n for n in out["notes"])
    kept = json.loads((store.root / "demos" / "human_test" / "edit_repair.json").read_text())
    assert len(kept["rounds"]) == 3  # why it was discarded stays visible


def test_a_given_raw_replay_is_not_replayed_again(store, tmp_path):
    sim = FakeSim(tmp_path / "worker", results=[COLLISION, verification()])
    raw = sim.replay(ReplayRequest(trajectory=_demo().trajectory, scene=_demo().scene, record_cameras=False,
                                   out_name="human_test_raw"))
    sim.requests.clear()
    sim.results = [verification()]
    out = _run(store, sim, Model(GOOD), raw=raw)
    assert [r.out_name for r in sim.requests] == ["human_test_edits_v1"] and out["status"] == "perfected"


def test_a_worker_that_cannot_do_the_job_fails_it_but_a_sim_error_discards(store, tmp_path):
    down = FakeSim(tmp_path / "w1", results=[COLLISION], errors={1: SimWorkerUnavailable("gone")})
    with pytest.raises(SimWorkerUnavailable):
        _run(store, down, Model(GOOD))
    sim_error = SimWorkerError("PhysX blew up", error="sim_error")
    out = _run(store, FakeSim(tmp_path / "w2", results=[COLLISION], errors={1: sim_error}), Model(GOOD))
    assert out["status"] == "discarded" and any("the sim failed on an edited demo" in n for n in out["notes"])
