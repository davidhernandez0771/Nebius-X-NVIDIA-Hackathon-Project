"""The coverage report (workflow step 6): how well an experiment's verified data covers a task's scene set and the eval
distribution, and what to record next."""
from __future__ import annotations

import hashlib
import json
import math

import numpy as np
import pytest

from demo_pipeline import coverage
from demo_pipeline.multiply import sample_scene
from demo_pipeline.scene_library import STANDARD_SCENE, SceneLibrary, plan_hash, protocol_entries, standard_entry
from demo_pipeline.schemas import Demo, Passport, Pose, Scene, ScenePlanRef, VerificationResult
from demo_pipeline.store import DemoStore
from sim_worker.scripted import scripted_expert
from tests.test_dp_grasp_retime import _swoop

ENTRIES = [standard_entry(), *protocol_entries()]
S4 = next(e for e in ENTRIES if e.id == "s4")


def _v(ok: bool) -> VerificationResult:
    return VerificationResult(success=ok, reasons=[] if ok else ["not_in_bin"], duration=5.0, path_length=1.0,
                              max_contact_force=1.0)


def _save(store: DemoStore, id: str, source: str, traj, scene: Scene, ok: bool, parent: str | None = None,
          plan: ScenePlanRef | None = None, seed: int | None = None) -> None:
    store.save_demo(Demo(id=id, source=source, parent_id=parent, trajectory=traj, scene=scene,
                         human_seconds=10.0 if source == "human" else 0.0, scene_plan=plan))
    store.save_passport(id, Passport(demo_id=id, lineage=store.lineage(id), diagnosis_source="rules", robot="franka",
                                     verification=_v(ok), variant_seed=seed, pipeline_version="test"))


@pytest.fixture()
def store(tmp_path):
    """3 standard-scene takes (2 swoops, raw failed but repaired; 1 scripted-style, verified), 1 S4 take (failed,
    not repaired), 1 take in a scene the library doesn't have; variants of the first two takes, 1 of 4 failing."""
    st = DemoStore(tmp_path / "store")
    swoop, calm = _swoop(), scripted_expert(STANDARD_SCENE, home_start=True)
    _save(st, "h_a", "human", swoop, STANDARD_SCENE, False)
    _save(st, "h_a_rules", "repaired", calm, STANDARD_SCENE, True, parent="h_a")
    _save(st, "h_a_rules_home", "repaired", calm, STANDARD_SCENE, True, parent="h_a_rules")
    _save(st, "h_b", "human", swoop, STANDARD_SCENE, False)
    _save(st, "h_b_rules", "repaired", swoop, STANDARD_SCENE, True, parent="h_b")
    _save(st, "h_c", "human", calm, STANDARD_SCENE, True)
    s4_scene = STANDARD_SCENE.model_copy(update={"seed": 1})
    _save(st, "h_s4", "human", swoop, s4_scene, False, plan=ScenePlanRef(id="s4", hash=S4.hash, name=S4.name))
    odd = Scene(cube_pose=Pose(pos=(0.45, 0.12, 0.025), quat_wxyz=(1, 0, 0, 0)),
                bin_pose=Pose(pos=(0.55, -0.2, 0.0), quat_wxyz=(1, 0, 0, 0)), robot="franka", seed=2)
    _save(st, "h_odd", "human", calm, odd, True)
    for i, (parent, seed, ok) in enumerate([("h_a_rules_home", 3100, True), ("h_a_rules_home", 3101, True),
                                            ("h_b_rules", 3200, True), ("h_b_rules", 3201, False)]):
        dst = sample_scene(np.random.default_rng(seed), "franka", seed)
        _save(st, f"{parent}_m{seed}", "variant", calm, dst, ok, parent=parent, seed=seed)
    return st


def test_scenes_merge_standard_into_s1_and_say_what_lies_outside_the_eval_distribution():
    scenes = coverage.scene_set(ENTRIES)
    assert [s["id"] for s in scenes] == ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"]
    s1 = scenes[0]
    assert s1["aliases"] == ["standard"] and s1["in_eval"] and s1["outside"] == []
    why = {s["id"]: " ".join(s["outside"]) for s in scenes}
    assert "4 cm cube" in why["s4"] and "6 cm cube" in why["s5"] and "bin turned 90" in why["s3"]
    assert "cube x 0.63" in why["s2"] and "1 more object" in why["s7"] and "11 cm" in why["s8"]
    assert why["s6"] == ""  # a yawed cube is in the eval distribution (cube yaw +-90)


def test_each_demo_goes_to_its_scene(store):
    scenes = coverage.scene_set(ENTRIES)
    by_id = {d.id: coverage.assign_scene(d, scenes) for d in store.list_demos(source="human")}
    assert by_id == {"h_a": "s1", "h_b": "s1", "h_c": "s1", "h_s4": "s4", "h_odd": None}
    # a ref whose plan changed since is still that scene, flagged
    d = store.get_demo("h_s4").model_copy(update={"scene_plan": ScenePlanRef(id="s4", hash="0" * 16, name="S4")})
    assert coverage.assign_scene(d, scenes) == "s4"


def test_the_report_counts_takes_repairs_and_variants_per_scene(store):
    rep = coverage.coverage_report(store, ENTRIES, eval_n=40, eval_seed0=5020)
    s1 = rep["scenes"]["s1"]
    assert (s1["takes"], s1["raw_verified"], s1["repaired_verified"], s1["verified_takes"]) == (3, 1, 2, 3)
    assert (s1["variants"], s1["variants_verified"]) == (4, 3)
    assert s1["grasp"]["takes"]["swoops"] == 2 and s1["grasp"]["takes"]["n"] == 3
    s4 = rep["scenes"]["s4"]
    assert (s4["takes"], s4["verified_takes"], s4["variants"]) == (1, 0, 0)
    assert rep["scenes"]["s2"]["takes"] == 0
    assert rep["unassigned"] == ["h_odd"]
    # the verified pool: the repaired takes (one each), the verified raw take, the verified variants
    assert rep["pool"]["n"] == 3 + 3 + 1  # h_a, h_b, h_c (+ h_odd), 3 variants
    assert rep["eval"]["n"] == 40 and rep["eval"]["seeds"] == [5020, 5059]


def test_the_eval_coverage_finds_axis_gaps_and_uncovered_eval_scenes(store):
    rep = coverage.coverage_report(store, ENTRIES, eval_n=40, eval_seed0=5020)
    axes = rep["eval"]["axes"]
    assert set(axes) == {"cube_x", "cube_y", "cube_face_yaw", "bin_x", "bin_y"}
    for rows in axes.values():
        assert sum(r["eval"] for r in rows) == 40
        assert all(r["gap"] == (r["eval"] > 0 and r["pool"] == 0) for r in rows)
        assert not any(r["gap"] and r["thin"] for r in rows)
    assert any(r["gap"] for rows in axes.values() for r in rows)  # 7 episodes can't cover 40 scenes
    near = rep["eval"]["nearest"]
    assert near["covered"] + len(near["uncovered_seeds"]) == 40
    assert set(near["tolerance"]) == {"cube_m", "bin_m", "cube_face_yaw_deg"}


def test_requests_name_the_scene_and_the_numbers(store):
    rep = coverage.coverage_report(store, ENTRIES, eval_n=40, eval_seed0=5020, takes_per_scene=2)
    texts = [r["text"] for r in rep["requests"]]
    s4 = next(t for t in texts if "S4 Small cube" in t)
    assert s4.startswith("Record 2 more takes in S4 Small cube: 0 verified of 1 recorded")
    assert "not in the eval distribution" in s4
    assert any(t.startswith("Record 2 more takes in S2 ") for t in texts)
    assert not any(t.startswith("Record") and "S1 " in t for t in texts)  # 3 verified >= 2
    # eval-distribution scenes come before the generalization ones
    kinds = [(r["kind"], r.get("in_eval")) for r in rep["requests"] if r["kind"] == "record"]
    assert kinds == sorted(kinds, key=lambda k: not k[1])
    # S4's one take swoops and nothing verified yet; S1's takes swoop (2 of 3) but its verified episodes mostly don't
    swoops = [t for t in texts if "while still moving" in t]
    assert len(swoops) == 1 and swoops[0].startswith("In S4 Small cube, 1 of 1 take closes while still moving")
    assert any(r["kind"] == "eval_gap" for r in rep["requests"])
    assert any(r["kind"] == "variant_yield" for r in rep["requests"]) is False  # 1 of 2 failing is 50%: fine


def test_the_report_reads_the_store_and_writes_nothing(store):
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in store.root.rglob("*") if p.is_file()}
    coverage.coverage_report(store, ENTRIES, eval_n=10, eval_seed0=5020)
    after = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in store.root.rglob("*") if p.is_file()}
    assert after == before


def test_the_markdown_table_shows_every_scene_and_request(store):
    rep = coverage.coverage_report(store, ENTRIES, eval_n=40, eval_seed0=5020)
    md = coverage.render_markdown(rep)
    for s in coverage.scene_set(ENTRIES):
        assert s["name"] in md
    for r in rep["requests"]:
        assert r["text"] in md
    assert "| S1 Standard | yes | 3 | 1 | 2 | 3 | 3 / 4 |" in md
    json.dumps(rep)  # JSON-able


class _Reply:
    def __init__(self, text):
        self.text, self.model, self.est_cost_usd = text, "fake-nemotron", 0.0001


def test_nemotron_phrasing_keeps_only_rewrites_whose_numbers_are_facts():
    reqs = [{"kind": "record", "text": "Record 2 more takes in S4 Small cube: 0 verified of 1 recorded."},
            {"kind": "record", "text": "Record 1 more take in S2 Cube at the edge of reach: 1 verified of 1 recorded."}]

    def renamed(prompt, **kw):
        return _Reply(json.dumps({"requests": ["Record 2 more takes in S4 (the small cube).",
                                               "Record 1 more take in S2 Cube at the edge of reach."]}))

    named = [{**r, "scene_name": n} for r, n in zip(reqs, ["S4 Small cube", "S2 Cube at the edge of reach"])]
    out = coverage.phrase_requests(named, chat_fn=renamed)  # the Record page lists scenes by these names
    assert out["provenance"]["kept"] == [False, True] and "scene name" in out["provenance"]["rejected"][0]["reason"]

    def chat_fn(prompt, **kw):
        assert kw["temperature"] == 0.0 and "S4 Small cube" in prompt
        return _Reply(json.dumps({"requests": [
            "Please record 2 more takes in S4 (small cube): none of the 1 recorded verified yet.",  # 0 -> "none"
            "Record 3 more takes in S2 Cube at the edge of reach.",  # 3: not a fact
        ]}))

    def dropped(prompt, **kw):
        return _Reply(json.dumps({"requests": ["Record more takes in S4 Small cube.", "S2: record 1 more take."]}))

    out = coverage.phrase_requests(reqs, chat_fn=chat_fn)
    assert out["texts"][0].startswith("Please record 2 more takes in S4")
    assert out["texts"][1] == reqs[1]["text"]  # fell back to the rules' wording
    assert out["provenance"]["kept"] == [True, False] and "3" in out["provenance"]["rejected"][0]["reason"]
    assert out["provenance"]["model"] == "fake-nemotron"
    out = coverage.phrase_requests(reqs, chat_fn=dropped)  # the count is what to do: it must stay
    assert out["provenance"]["kept"] == [False, True] and "count 2" in out["provenance"]["rejected"][0]["reason"]


def test_nemotron_phrasing_falls_back_entirely_on_a_bad_reply_or_no_model():
    reqs = [{"kind": "record", "text": "Record 2 more takes in S4 Small cube: 0 verified of 1 recorded."}]
    assert coverage.phrase_requests(reqs, chat_fn=None)["texts"] == [reqs[0]["text"]]
    bad = coverage.phrase_requests(reqs, chat_fn=lambda p, **k: _Reply("sure! here you go"))
    assert bad["texts"] == [reqs[0]["text"]] and bad["provenance"]["error"]

    def boom(p, **k):
        raise RuntimeError("api down")

    assert coverage.phrase_requests(reqs, chat_fn=boom)["texts"] == [reqs[0]["text"]]


def test_numbers_are_compared_as_numbers():
    assert coverage.numbers("0.050 m and 15 degrees, 2 takes") == {0.05, 15.0, 2.0}
    assert coverage.numbers("S4, seeds 5020-5059") == {5020.0, 5059.0}  # a name's digit is not a number; a range is two
    assert math.isclose(min(coverage.numbers("-0.20")), -0.2)


def test_the_eval_scenes_are_the_evals():
    from sim_eval.scenes import eval_scenes

    assert coverage.eval_scene_list(40, 5020) == eval_scenes(40, 5020)


def test_a_thin_bin_asks_for_more_where_the_eval_puts_many_scenes():
    rep = {"takes_per_scene": 0, "scenes": {}, "pool": {"n": 20}, "sources": {},
           "eval": {"n": 40, "nearest": {"uncovered_seeds": list(range(5020, 5040))},
                    "axes": {"bin_x": [{"lo": 0.55, "hi": 0.6, "eval": 11, "pool": 1, "gap": False, "thin": True}]}}}
    texts = [r["text"] for r in coverage.requests(rep, [])]
    assert texts[0] == ("Only 1 of 20 verified episodes have the bin x between 0.55 and 0.6 m, where 11 of 40 eval "
                        "scenes put it: add variants or takes there.")
    assert texts[1].endswith("seeds 5020, 5021, 5022, 5023, 5024, 5025, 5026, 5027, 5028, 5029, 5030, 5031 and 8 more.")
