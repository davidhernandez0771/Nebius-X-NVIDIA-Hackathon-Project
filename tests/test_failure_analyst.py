"""The failure analyst: measured failures (failure_features) -> a recipe (data_recipe, app.ai.failure_analyst, Nemotron
faked) -> scenes for multiply (MultiplyRequest.scenes, sim_worker.jobs) -> scripts/analyze_failures.py."""
from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
from types import SimpleNamespace as NS

import numpy as np
import pytest
from pydantic import ValidationError

from app.ai import failure_analyst as fa
from demo_pipeline.data_recipe import (
    MIN_UNIFORM_SHARE, DataRecipe, FocusRegion, rules_recipe, sample_recipe_scenes, uniform_scenes, validate_recipe,
)
from demo_pipeline.failure_features import FAILURE_CLASSES, episode_features
from demo_pipeline.multiply import _edge_gap, _yaw, sample_scene
from demo_pipeline.schemas import Pose, Scene
from demo_pipeline.sim_protocol import MultiplyRequest
from sim_worker.jobs import multiply_seeds, run_multiply
from sim_worker.scripted import scripted_expert

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "analyze_failures.py"
IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _scene(cube=(0.5, 0.1), bin_=(0.55, -0.2), seed=5300) -> Scene:
    return Scene(cube_pose=Pose(pos=(*cube, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(*bin_, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=seed)


def _lerp(a, b, n):
    return np.linspace(np.asarray(a, float), np.asarray(b, float), n)


def _trace(scene: Scene, kind: str = "success", carry_n: int = 60, offset: float = 0.0) -> dict[str, np.ndarray]:
    """A 50 Hz pick-and-place: approach 50, close, lift 30, carry carry_n (fewer = faster), lower 20, open, rest.
    kind: success | dropped (lost mid-carry) | missed_reach (stops 10 cm short) | collision_table | collision_bin.
    offset: the grasp's x offset from the cube centre (m)."""
    c = np.array(scene.cube_pose.pos)
    b = np.array(scene.bin_pose.pos)
    start, above_cube = np.array([0.3, 0.0, 0.3]), c + [0, 0, 0.2]
    grasp = c + [offset, 0, 0] if kind != "missed_reach" else c + [-0.10, 0, 0]
    above_bin, place = np.r_[b[:2], 0.2], np.r_[b[:2], 0.1]
    tcp = np.vstack([_lerp(start, grasp, 50), _lerp(grasp, above_cube, 30), _lerp(above_cube, above_bin, carry_n),
                     _lerp(above_bin, place, 20), np.repeat(place[None], 101 - carry_n, 0)])
    n = len(tcp)
    grip = np.zeros(n, np.int8)
    grip[50:160] = 1
    touch = np.zeros(n, bool)
    cube = np.repeat(c[None], n, 0)
    if kind != "missed_reach":
        touch[50:160] = True
        cube[50:160] = tcp[50:160] - [offset, 0, 0.0]
        cube[160:] = np.r_[b[:2], 0.025]
    if kind == "dropped":
        k = 110
        touch[k:] = False
        cube[k:] = np.r_[tcp[k, :2], 0.025]
    on_table, on_bin, force = np.zeros(n, bool), np.zeros(n, bool), np.zeros(n)
    if kind == "collision_table":
        on_table[45:50], force[45:50] = True, 12.0
    if kind == "collision_bin":
        on_bin[150:160], force[150:160] = True, 40.0
    return {"tcp_pos": tcp, "cube_pos": cube, "gripper": grip, "contact_gripper_cube": touch,
            "contact_arm_bin": on_bin, "contact_arm_table": on_table, "max_contact_force": force,
            "tcp_quat_wxyz": np.tile([0.0, 1.0, 0.0, 0.0], (n, 1))}


# ---- failure_features ------------------------------------------------------------------------------------------

def test_a_success_has_no_events_and_measures_the_grasp():
    f = episode_features(_trace(_scene()), _scene(), success=True)
    assert f.primary is None and f.events == []
    assert f.held and f.max_lift > 0.15 and f.final_in_bin
    assert f.grasp_offset_xy == pytest.approx(0.0, abs=1e-9) and f.t_first_close == pytest.approx(1.0)
    assert f.gripper_toggles == 2


def test_a_drop_mid_carry_is_dropped_in_the_carry_phase():
    f = episode_features(_trace(_scene(), "dropped"), _scene(), success=False)
    assert f.primary == "dropped"
    ev = f.events[0]
    assert ev.phase == "carry" and ev.t == pytest.approx(110 / 50)
    assert ev.detail["cube_height"] == pytest.approx(0.0, abs=1e-9)  # the cube is back on the table


@pytest.mark.parametrize("kind,phase", [("collision_table", "approach"), ("collision_bin", "place")])
def test_collisions_are_classed_by_what_was_hit_and_when(kind, phase):
    f = episode_features(_trace(_scene(), kind), _scene(), success=False)
    hits = [e for e in f.events if e.kind == kind]
    assert hits and hits[0].phase == phase and hits[0].detail["force"] > 5


def test_a_grasp_10cm_short_is_missed_reach():
    f = episode_features(_trace(_scene(), "missed_reach"), _scene(), success=False)
    assert f.primary == "missed_reach" and f.min_reach_dist == pytest.approx(0.10, abs=1e-6)


def test_a_failure_with_no_event_is_stuck():
    s = _scene()
    tr = _trace(s, "missed_reach")
    tr["tcp_pos"][:] = np.r_[s.cube_pose.pos[:2], 0.3]  # hovering over the cube, never closing
    tr["gripper"][:] = 0
    f = episode_features(tr, s, success=False)
    assert f.primary == "stuck"


def test_a_trace_missing_a_field_is_refused():
    tr = _trace(_scene())
    del tr["contact_arm_bin"]
    with pytest.raises(ValueError, match="contact_arm_bin"):
        episode_features(tr, _scene(), success=True)


def test_the_row_is_flat_and_json_safe():
    f = episode_features(_trace(_scene(), "dropped"), _scene(), success=False)
    json.dumps(f.row(), allow_nan=False)


# ---- data_recipe -------------------------------------------------------------------------------------------------

def _region(**kw) -> dict:
    base = dict(name="far_right_bin", targets=["dropped"], cube_x=(0.40, 0.60), cube_y=(0.0, 0.20),
                cube_yaw_deg=(-45, 45), bin_x=(0.45, 0.65), bin_y=(-0.30, -0.10), share=0.6, rationale="r")
    return {**base, **kw}


def _recipe(regions=None, uniform=0.4, hyps=None) -> DataRecipe:
    return DataRecipe(summary="s", hypotheses=hyps or [], regions=[FocusRegion(**r) for r in (regions or [_region()])],
                      uniform_share=uniform)


def test_a_sound_recipe_validates():
    assert validate_recipe(_recipe(), observed_failures={"dropped"}, seen_seeds={1}) == []


@pytest.mark.parametrize("bad,needle", [
    (dict(bin_y=(-0.5, -0.1)), "outside the allowed"),
    (dict(cube_x=(0.50, 0.51)), "at least 0.04 m"),
    (dict(cube_yaw_deg=(10, 5)), "low < high"),
    (dict(targets=["fell_over"]), "unknown failure classes"),
])
def test_bad_regions_are_explained(bad, needle):
    errors = validate_recipe(_recipe([_region(**bad)]))
    assert any(needle in e for e in errors), errors


def test_shares_must_sum_to_one_and_keep_a_uniform_floor():
    assert any("sum to 1" in e for e in validate_recipe(_recipe(uniform=0.2)))
    assert any(f"at least {MIN_UNIFORM_SHARE}" in e for e in validate_recipe(_recipe([_region(share=0.9)], uniform=0.1)))


def test_targets_must_have_occurred_and_evidence_must_exist():
    from demo_pipeline.data_recipe import Hypothesis
    r = _recipe(hyps=[Hypothesis(claim="c", evidence_seeds=[5300, 9999])])
    errors = validate_recipe(r, seen_seeds={5300}, observed_failures={"collision_bin"})
    assert any("never occurred" in e for e in errors)
    assert any("[9999]" in e for e in errors)


def test_an_infeasible_region_is_caught():
    # cube and bin boxes on top of each other: never 0.15 m apart
    errors = validate_recipe(_recipe([_region(cube_x=(0.45, 0.50), cube_y=(0.0, 0.05), bin_x=(0.45, 0.50),
                                              bin_y=(0.0, 0.05))]))
    assert any("0.15 m apart" in e for e in errors)


def test_recipe_scenes_split_by_share_stay_in_their_boxes_and_are_deterministic():
    r = _recipe()
    pairs = sample_recipe_scenes(r, 10, 3000)
    assert [p[1] for p in pairs].count("far_right_bin") == 6 and [p[1] for p in pairs].count("uniform") == 4
    assert [s.seed for s, _ in pairs] == list(range(3000, 3010))
    for s, region in pairs:
        cube, bin_ = s.cube_pose.pos, s.bin_pose.pos
        assert _edge_gap(cube[:2], _yaw(s.cube_pose.quat_wxyz), bin_[:2]) >= 0.15
        if region == "far_right_bin":
            assert 0.40 <= cube[0] <= 0.60 and 0.0 <= cube[1] <= 0.20 and -0.30 <= bin_[1] <= -0.10
            assert abs(math.degrees(_yaw(s.cube_pose.quat_wxyz))) <= 45 + 1e-6
    assert sample_recipe_scenes(r, 10, 3000) == pairs


def test_recipe_scene_is_per_seed_deterministic_and_its_uniform_share_is_sample_scene():
    from demo_pipeline.data_recipe import recipe_scene
    r = _recipe()
    picks = [recipe_scene(r, s) for s in range(3100, 3300)]
    assert picks == [recipe_scene(r, s) for s in range(3100, 3300)]
    share = sum(g == "far_right_bin" for _, g in picks) / len(picks)
    assert 0.5 < share < 0.7  # 0.6 on average
    for (scene, g), s in zip(picks, range(3100, 3300)):
        if g == "uniform":
            assert scene == sample_scene(np.random.default_rng(s), "franka", s)
        else:
            assert -0.30 <= scene.bin_pose.pos[1] <= -0.10
    only_fixes = DataRecipe(summary="s", regions=[], uniform_share=1.0)
    assert recipe_scene(only_fixes, 3100)[0] == sample_scene(np.random.default_rng(3100), "franka", 3100)


def test_uniform_scenes_are_multiplys_own_and_seeds_stay_clear_of_the_test():
    assert uniform_scenes(3, 100) == [sample_scene(np.random.default_rng(s), "franka", s) for s in (100, 101, 102)]
    with pytest.raises(ValueError, match="clear of the test"):
        uniform_scenes(10, 4995)


def _features(kinds_scenes):
    return [episode_features(_trace(s, k), s, success=k == "success") for k, s in kinds_scenes]


def test_the_rules_baseline_boxes_the_most_common_failure():
    eps = _features([("dropped", _scene(bin_=(0.55, -0.25), seed=5300 + i)) for i in range(3)]
                    + [("success", _scene(seed=5310)), ("collision_bin", _scene(seed=5311))])
    r = rules_recipe(eps)
    assert r is not None and r.regions[0].targets == ["dropped"]
    assert validate_recipe(r) == []
    assert r.regions[0].bin_y[0] <= -0.25 <= r.regions[0].bin_y[1]


def test_the_rules_baseline_needs_three_of_a_kind():
    assert rules_recipe(_features([("dropped", _scene(seed=5300)), ("success", _scene(seed=5301))])) is None


# ---- the analyst (Nemotron faked) ---------------------------------------------------------------------------------

def _fake(*replies):
    calls = []

    def chat_fn(prompt, **kw):
        calls.append({"prompt": prompt, **kw})
        return NS(text=replies[len(calls) - 1], est_cost_usd=0.002, model="nvidia/fake")

    chat_fn.calls = calls
    return chat_fn


def _eps():
    return _features([("dropped", _scene(bin_=(0.55, -0.25), seed=5300 + i)) for i in range(4)]
                     + [("success", _scene(bin_=(0.55, 0.25), seed=5310 + i)) for i in range(3)])


def _reply(**region_kw) -> str:
    return json.dumps({"summary": "drops on right bins",
                       "hypotheses": [{"claim": "drops with the bin at y<-0.1", "evidence_seeds": [5300, 5301]}],
                       "regions": [_region(**region_kw)], "uniform_share": 0.4})


def test_the_prompt_carries_the_measurements_and_the_per_bin_table():
    p = fa.build_prompt(_eps())
    assert "7 episodes, 3 succeeded, 4 failed" in p and '"dropped":4' in p.replace(" ", "")
    assert '"axis":"bin_y"' in p and '"seed":5300' in p


def test_one_good_sample_is_the_recipe():
    chat_fn = _fake(_reply())
    res = fa.analyse(_eps(), k=1, chat_fn=chat_fn)
    assert res.ok and res.recipe.regions[0].targets == ["dropped"] and res.agreement is None
    assert res.calls == 1 and chat_fn.calls[0]["tier"] == "super" and chat_fn.calls[0]["think"] is True


def test_problems_go_back_to_the_model_and_a_no_json_reply_is_asked_again_without_thinking():
    chat_fn = _fake("I think the drops...", _reply(bin_y=(-0.6, -0.1)), _reply())
    res = fa.analyse(_eps(), k=1, chat_fn=chat_fn, retries=2)
    assert res.ok and res.calls == 3
    assert chat_fn.calls[1]["think"] is False
    assert "outside the allowed" in chat_fn.calls[2]["prompt"]
    assert [bool(a.errors) for a in res.attempts] == [True, True, False]


def test_made_up_evidence_and_unseen_failures_are_rejected():
    bad = json.dumps({"summary": "s", "hypotheses": [{"claim": "c", "evidence_seeds": [1234]}],
                      "regions": [_region(targets=["collision_table"])], "uniform_share": 0.4})
    res = fa.analyse(_eps(), k=1, chat_fn=_fake(bad), retries=0)
    assert not res.ok
    errs = " ".join(res.attempts[0].errors)
    assert "[1234]" in errs and "never occurred" in errs


def test_a_box_drawn_around_no_failures_goes_back_with_the_counts():
    # the 2026-10-23 live smoke: Nemotron's narrow box held 1 of 13 drops
    chat_fn = _fake(_reply(bin_y=(0.10, 0.30), cube_y=(-0.20, -0.05)), _reply())
    res = fa.analyse(_eps(), k=1, chat_fn=chat_fn)
    assert res.ok and res.calls == 2
    assert "0 of the 4 episodes that failed by its targets" in chat_fn.calls[1]["prompt"]


def test_a_box_where_failures_are_no_more_common_than_anywhere_is_rejected():
    from demo_pipeline.data_recipe import support_errors
    whole = _recipe([_region(cube_y=(-0.2, 0.2), bin_x=(0.40, 0.65), bin_y=(-0.30, 0.30))])
    assert any("don't concentrate" in e for e in support_errors(whole, _eps()))


def test_fisher_greater_matches_known_values():
    from demo_pipeline.data_recipe import fisher_greater
    assert fisher_greater(4, 0, 0, 3) == pytest.approx(1 / 35)  # all 4 failures inside, 3 successes outside
    assert fisher_greater(0, 3, 4, 0) == pytest.approx(1.0)
    # scipy.stats.fisher_exact([[3, 2], [1, 4]], alternative="greater") -> p = 0.2619
    assert fisher_greater(3, 2, 1, 4) == pytest.approx(0.2619, abs=1e-4)


def test_a_box_with_a_chance_excess_of_failures_is_rejected():
    from demo_pipeline.data_recipe import support_errors
    eps = _eps()  # 4 drops at bin y -0.25, 3 successes at bin y +0.25
    for i, e in enumerate(eps[4:]):  # move the successes into the box too: 4 of 7 inside fail, no outside
        e.scene.bin_y = -0.25
    eps += _features([("success", _scene(bin_=(0.55, 0.25), seed=5320))])
    errs = support_errors(_recipe(), eps)
    assert any("likely chance" in e for e in errs), errs


def test_region_support_counts_what_is_inside():
    from demo_pipeline.data_recipe import region_support
    (s,) = region_support(_recipe(), _eps())
    assert (s.episodes_inside, s.target_failures_inside, s.target_failures_total) == (4, 4, 4)
    assert s.coverage == 1.0 and s.rate_inside == 1.0 and s.rate_overall == pytest.approx(4 / 7)


def test_consensus_keeps_the_recipe_the_others_agree_with():
    odd = _reply(name="odd", cube_y=(-0.20, 0.20), bin_x=(0.40, 0.65), bin_y=(-0.30, 0.0))
    chat_fn = _fake(_reply(), odd, _reply(bin_y=(-0.28, -0.12)))
    res = fa.analyse(_eps(), k=3, chat_fn=chat_fn)
    assert len(res.candidates) == 3 and res.recipe.regions[0].name == "far_right_bin"
    assert res.recipe.regions[0].bin_y[1] < 0 and 0 < res.agreement < 1
    assert res.candidate_agreement[1] == min(res.candidate_agreement)


def test_an_api_outage_costs_one_sample_not_the_run():
    from nebius_llm import TokenFactoryError
    good = _fake(_reply(), _reply())
    n = {"calls": 0}

    def flaky(prompt, **kw):
        n["calls"] += 1
        if n["calls"] == 1:
            raise TokenFactoryError("Connection error.")
        return good(prompt, **kw)

    res = fa.analyse(_eps(), k=3, chat_fn=flaky)
    assert res.api_errors == 1 and len(res.candidates) == 2 and res.ok
    assert res.attempts[0].errors[0].startswith("api_error")


def test_nothing_to_analyse_is_refused():
    with pytest.raises(ValueError, match="every episode succeeded"):
        fa.analyse(_features([("success", _scene())]), chat_fn=_fake())


def test_every_failure_class_is_described_to_the_model():
    assert set(fa.CLASS_TEXT) == set(FAILURE_CLASSES)
    assert all(c in fa.system_prompt() for c in FAILURE_CLASSES)


# ---- the grasp mechanism -----------------------------------------------------------------------------------------

def test_carry_speed_closes_and_hold_time_are_measured():
    s = _scene()
    slow, fast = (episode_features(_trace(s, carry_n=n), s, success=True) for n in (60, 20))
    assert slow.n_closes == 1 and slow.held_s == pytest.approx(110 / 50)
    assert fast.carry_speed_max > 2 * slow.carry_speed_max
    tr = _trace(s)
    tr["gripper"][60:62] = 0  # a regrasp
    assert episode_features(tr, s, success=True).n_closes == 2


def _mech_eps():
    """Fast carries drop, slow ones succeed; grasp offsets the same in both."""
    eps = []
    for i in range(6):
        s = _scene(seed=5300 + i)
        eps.append(episode_features(_trace(s, "dropped", carry_n=20 + i), s, success=False))
        s = _scene(seed=5310 + i)
        eps.append(episode_features(_trace(s, carry_n=60 + i), s, success=True))
    return eps


def test_the_contrast_finds_the_planted_difference_and_not_a_flat_one():
    from demo_pipeline.data_recipe import contrast_table
    t = {c.feature: c for c in contrast_table(_mech_eps())}
    assert t["carry_speed_max"].effect == pytest.approx(1.0) and t["carry_speed_max"].p_value < 0.01
    assert t["grasp_offset_xy"].effect == pytest.approx(0.0) and t["grasp_offset_xy"].p_value > 0.5


def test_mann_whitney_matches_a_known_value():
    from demo_pipeline.data_recipe import _mann_whitney
    # scipy.stats.mannwhitneyu([1,2,3,4,5], [6,7,8,9,10], method="asymptotic") -> U = 0, p = 0.01219
    effect, p = _mann_whitney(np.array([1, 2, 3, 4, 5.0]), np.array([6, 7, 8, 9, 10.0]))
    assert effect == -1.0 and p == pytest.approx(0.01219, abs=1e-4)


def _mech_recipe(direction="higher_in_failures", feature="carry_speed_max", **fix) -> DataRecipe:
    fix = {"lever": "slow_carry", "addresses": [feature], "max_speed_mps": 0.3, "rationale": "r", **fix}
    return DataRecipe.model_validate({"summary": "s", "uniform_share": 1.0, "regions": [],
                                      "mechanism": [{"feature": feature, "direction": direction, "explanation": "e"}],
                                      "fixes": [fix]})


def test_a_true_mechanism_with_a_sound_fix_passes_and_needs_no_region():
    from demo_pipeline.data_recipe import mechanism_errors
    r = _mech_recipe()
    assert validate_recipe(r) == [] and mechanism_errors(r, _mech_eps()) == []
    assert {g for _, g in sample_recipe_scenes(r, 5, 3000)} == {"uniform"}


def test_a_backwards_mechanism_is_answered_with_the_measured_numbers():
    from demo_pipeline.data_recipe import mechanism_errors
    (err,) = mechanism_errors(_mech_recipe("lower_in_failures"), _mech_eps())
    assert "the opposite" in err and "median" in err and "effect +1.00" in err


def test_a_mechanism_with_no_measured_difference_is_too_small_to_claim():
    from demo_pipeline.data_recipe import mechanism_errors
    errs = mechanism_errors(_mech_recipe(feature="grasp_offset_xy", lever="recenter_grasp", max_speed_mps=None),
                            _mech_eps())
    assert any("too small to claim" in e for e in errs)


@pytest.mark.parametrize("fix,needle", [
    (dict(max_speed_mps=3.0), "between 0.05 and 1.0"),
    (dict(addresses=["n_closes"]), "no mechanism claim names"),
    (dict(lever="filter_training", max_speed_mps=None), "needs feature"),
])
def test_fixes_must_act_on_a_claim_with_settings_the_pipeline_can_apply(fix, needle):
    from demo_pipeline.data_recipe import mechanism_errors
    assert any(needle in e for e in mechanism_errors(_mech_recipe(**fix), _mech_eps()))


def test_a_recipe_with_no_region_and_no_fix_changes_nothing():
    r = DataRecipe(summary="s", regions=[], uniform_share=1.0)
    assert any("changes nothing" in e for e in validate_recipe(r))
    assert validate_recipe(r, allow_no_change=True) == []


def test_the_analyst_may_answer_keep_the_data_as_it_is():
    keep = json.dumps({"summary": "no clear pattern", "regions": [], "uniform_share": 1.0})
    res = fa.analyse(_eps(), k=2, chat_fn=_fake(keep, keep))
    assert res.ok and res.calls == 2 and not res.recipe.regions and not res.recipe.fixes
    assert res.agreement == pytest.approx(1.0)


def test_the_rules_mechanism_baseline_keeps_only_clear_differences():
    from demo_pipeline.data_recipe import rules_mechanism
    feats = {c.feature for c in rules_mechanism(_mech_eps())}
    assert {"carry_speed_max", "carry_speed_median"} <= feats and "grasp_offset_xy" not in feats


def test_the_analyst_sees_the_contrast_and_a_wrong_mechanism_goes_back():
    good = _mech_recipe().model_dump_json()
    chat_fn = _fake(_mech_recipe("lower_in_failures").model_dump_json(), good)
    res = fa.analyse(_mech_eps(), k=1, chat_fn=chat_fn)
    assert res.ok and res.calls == 2
    assert '"feature":"carry_speed_max"' in chat_fn.calls[0]["prompt"].replace(" ", "")
    assert "the opposite" in chat_fn.calls[1]["prompt"]


def test_similarity_counts_mechanism_and_fixes():
    a, b = _mech_recipe(), _mech_recipe(feature="carry_speed_median")
    assert fa.recipe_similarity(a, a) == pytest.approx(1.0)
    assert fa.recipe_similarity(a, b) == pytest.approx((1 + 0 + 1) / 3)


# ---- multiply into given scenes ----------------------------------------------------------------------------------

class _FakeReplay:
    def __init__(self):
        self.scenes = []

    def __call__(self, traj, scene, ep_dir, record_cameras):
        from demo_pipeline.schemas import SimSignals, VerificationResult
        self.scenes.append(scene)
        n = len(traj.to_arrays()["t"])
        ep_dir.mkdir(parents=True, exist_ok=True)
        z = np.zeros(n, bool)
        return (VerificationResult(success=True, reasons=[], duration=traj.duration, path_length=1.0,
                                   max_contact_force=0.0, settle_time=1.0),
                SimSignals(cube_pos=np.zeros((n, 3)), contact_gripper_cube=z, contact_arm_bin=z, contact_arm_table=z,
                           max_contact_force=np.zeros(n)), traj)


def _mult(scenes=None, n=None):
    src = _scene(cube=(0.5, 0.0), bin_=(0.5, 0.3), seed=0)
    return MultiplyRequest(trajectory=scripted_expert(src), scene=src, robot="franka",
                           n=n if n is not None else len(scenes), seed0=0, out_prefix="t", scenes=scenes)


def test_multiply_runs_exactly_the_given_scenes(tmp_path):
    scenes = [s for s, _ in sample_recipe_scenes(_recipe(), 3, 3000)]
    replay = _FakeReplay()
    resp = run_multiply(_mult(scenes), replay, root=tmp_path, worker_robot="franka", worker_cameras=False,
                        log=lambda s: None)
    assert replay.scenes == scenes and [v.seed for v in resp.variants] == [3000, 3001, 3002]
    assert multiply_seeds(_mult(scenes)) == [3000, 3001, 3002]


def test_multiply_without_scenes_is_unchanged():
    req = MultiplyRequest(**{**_mult([sample_scene(np.random.default_rng(1), "franka", 1)]).model_dump(),
                             "scenes": None, "n": 2, "seed0": 7})
    assert multiply_seeds(req) == [7, 8]


@pytest.mark.parametrize("make,needle", [
    (lambda s: dict(scenes=s, n=len(s) + 1), "scenes were given"),
    (lambda s: dict(scenes=[s[0], s[0]], n=2), "unique"),
])
def test_given_scenes_must_match_n_and_have_unique_seeds(make, needle):
    s = [sample_scene(np.random.default_rng(i), "franka", i) for i in range(2)]
    with pytest.raises(ValidationError, match=needle):
        _mult(**make(s))


# ---- the script --------------------------------------------------------------------------------------------------

def _load_script():
    spec = importlib.util.spec_from_file_location("analyze_failures", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _eval_dir(tmp_path, kinds: dict[int, str]) -> Path:
    ev = tmp_path / "cell.json"
    traces = tmp_path / "cell_traces"
    traces.mkdir()
    rows = []
    for seed, kind in kinds.items():
        scene = sample_scene(np.random.default_rng(seed), "franka", seed)
        np.savez(traces / f"seed_{seed}.npz", **_trace(scene, kind))
        ok = kind == "success"
        rows.append({"seed": seed, "success": ok, "reasons": [] if ok else ["dropped"],
                     "ended_by": "success" if ok else "time_limit"})
    ev.write_text(json.dumps({"run": {}, "summary": {}, "episodes": rows}), encoding="utf-8")
    return ev


def test_the_script_without_the_model_writes_features_rules_and_the_control(tmp_path):
    ev = _eval_dir(tmp_path, {5300: "dropped", 5301: "dropped", 5302: "dropped", 5303: "success", 4001: "dropped"})
    out = tmp_path / "out"
    assert _load_script().main(["--eval", str(ev), "--out", str(out), "--no-model", "--n", "20"]) == 0
    feats = json.loads((out / "features.json").read_text(encoding="utf-8"))
    assert sorted(f["seed"] for f in feats) == [5300, 5301, 5302, 5303]  # the training-scene seed is skipped
    assert json.loads((out / "recipe_rules.json").read_text(encoding="utf-8"))["regions"][0]["targets"] == ["dropped"]
    for arm in ("rules", "uniform"):
        data = json.loads((out / f"scenes_{arm}.json").read_text(encoding="utf-8"))
        assert data["n"] == 20 and len(data["scenes"]) == 20
        MultiplyRequest(**_mult(n=20, scenes=[Scene.model_validate(s) for s in data["scenes"]]).model_dump())
    assert not (out / "analysis.json").exists() and "Not asked" in (out / "report.md").read_text(encoding="utf-8")


def test_the_script_reads_an_episode_log_and_marks_a_post_hoc_test_diagnosis(tmp_path):
    ev = _eval_dir(tmp_path, {5020: "dropped", 5021: "dropped", 5022: "dropped", 5023: "success"})
    rows = json.loads(ev.read_text(encoding="utf-8"))["episodes"]
    log = tmp_path / "final.episodes.jsonl"
    log.write_text("\n".join([json.dumps({"header": {}}), *(json.dumps({"episode": r}) for r in rows)]) + "\n", encoding="utf-8")
    (tmp_path / "cell_traces").rename(tmp_path / "final_traces")
    out = tmp_path / "out"
    assert _load_script().main(["--eval", str(log), "--out", str(out), "--no-model", "--protect", "none"]) == 0
    assert len(json.loads((out / "features.json").read_text(encoding="utf-8"))) == 4
    report = (out / "report.md").read_text(encoding="utf-8")
    assert "Post-hoc" in report and "fresh seeds" in report and "carry_speed_max" in report


@pytest.mark.parametrize("seed", [5020, 5439])  # the distill final test and the big test
def test_the_script_refuses_the_preregistered_test_seeds(tmp_path, seed):
    ev = _eval_dir(tmp_path, {seed: "dropped"})
    with pytest.raises(ValueError, match="pre-registered test seed"):
        _load_script().main(["--eval", str(ev), "--out", str(tmp_path / "o"), "--no-model"])


# ---- without traces: the eval's result rows only ----------------------------------------------------------------

def test_a_result_row_becomes_an_untraced_record_classed_by_its_reasons():
    from demo_pipeline.failure_features import result_features
    scene = _scene(bin_=(0.55, -0.2))
    row = {"seed": 5300, "success": False, "reasons": ["not_in_bin", "collision", "dropped"], "sim_s": 29.98,
           "final_cube_pos": [0.55, -0.05, 0.025]}
    e = result_features(row, scene)
    assert e.source == "result" and e.primary == "dropped" and e.reasons == row["reasons"]
    assert e.final_cube_to_bin_xy == pytest.approx(0.15) and not e.final_in_bin
    assert e.grasp_offset_xy is None and e.held is None and e.carry_speed_max is None
    assert result_features({**row, "reasons": ["not_in_bin", "collision"]}, scene).primary == "collision"
    assert result_features({**row, "reasons": ["not_in_bin"]}, scene).primary == "stuck"
    ok = result_features({**row, "success": True, "reasons": [], "final_cube_pos": [0.55, -0.2, 0.03]}, scene)
    assert ok.primary is None and ok.events == [] and ok.final_in_bin
    json.dumps(e.row(), allow_nan=False)
    assert {c.n_failure for c in fa.contrast_table([e, ok])} == {0}  # nothing measured, nothing contrasted


def _result_eval(tmp_path, name, rows: dict[int, list[str]]) -> Path:
    ev = tmp_path / f"{name}.episodes.jsonl"
    lines = [json.dumps({"header": {}})]
    for seed, reasons in rows.items():
        lines.append(json.dumps({"episode": {"seed": seed, "success": not reasons, "reasons": reasons,
                                             "ended_by": "time_limit" if reasons else "success", "sim_s": 10.0,
                                             "final_cube_pos": [0.5, 0.0, 0.025]}}))
    ev.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return ev


def test_the_script_pools_evals_without_traces_and_says_so(tmp_path):
    a = _result_eval(tmp_path, "select", {5500: ["dropped"], 5501: [], 5502: ["not_in_bin", "dropped"]})
    b = _result_eval(tmp_path, "test", {5400: ["dropped"], 5401: [], 5402: ["collision"]})
    out = tmp_path / "out"
    with pytest.raises(FileNotFoundError, match="--results-only"):
        _load_script().main(["--eval", str(a), "--out", str(out), "--no-model"])
    with pytest.raises(ValueError, match="pre-registered test seed"):
        _load_script().main(["--eval", str(a), "--eval", str(b), "--out", str(out), "--no-model", "--results-only"])
    assert _load_script().main(["--eval", str(a), "--eval", str(b), "--out", str(out), "--no-model",
                                "--results-only", "--protect", "none"]) == 0
    feats = json.loads((out / "features.json").read_text(encoding="utf-8"))
    assert [f["seed"] for f in feats] == [5400, 5401, 5402, 5500, 5501, 5502]
    assert [f["primary"] for f in feats] == ["dropped", None, "collision", "dropped", None, "dropped"]
    report = (out / "report.md").read_text(encoding="utf-8")
    assert "No traces" in report and "Post-hoc" in report and "5400–5439" in report


def test_the_script_refuses_a_seed_in_two_evals(tmp_path):
    a = _result_eval(tmp_path, "a", {5500: ["dropped"]})
    b = _result_eval(tmp_path, "b", {5500: []})
    with pytest.raises(ValueError, match="more than one eval"):
        _load_script().main(["--eval", str(a), "--eval", str(b), "--out", str(tmp_path / "o"), "--no-model",
                             "--results-only"])


def test_the_prompt_tells_the_model_what_an_untraced_episode_lacks():
    from demo_pipeline.failure_features import result_features
    rows = [{"seed": 5300 + i, "success": i % 2 == 0, "reasons": [] if i % 2 == 0 else ["dropped"], "sim_s": 9.0,
             "final_cube_pos": [0.5, 0.0, 0.025]} for i in range(4)]
    p = fa.build_prompt([result_features(r, _scene(seed=r["seed"])) for r in rows])
    assert "4 of these episodes have no step trace" in p and '"reasons":["dropped"]' in p


def test_the_script_with_the_model_writes_its_recipe_and_scenes(tmp_path, monkeypatch):
    # sample_scene: 5300, 5302 and 5313 put the cube at y < 0 and the bin at y > 0.2; 5301 and 5312 the other way
    ev = _eval_dir(tmp_path, {5300: "dropped", 5302: "dropped", 5313: "dropped", 5301: "success", 5312: "success"})
    out = tmp_path / "out"
    reply = json.dumps({"summary": "s", "hypotheses": [{"claim": "c", "evidence_seeds": [5300, 5302]}],
                        "regions": [_region(cube_y=(-0.2, 0.0), bin_x=(0.40, 0.65), bin_y=(0.15, 0.30))],
                        "uniform_share": 0.4})
    monkeypatch.setattr(fa, "chat", _fake(reply, reply, reply))
    monkeypatch.setattr(fa.analyse, "__kwdefaults__", {**fa.analyse.__kwdefaults__, "chat_fn": fa.chat})
    assert _load_script().main(["--eval", str(ev), "--out", str(out), "--n", "10"]) == 0
    analysis = json.loads((out / "analysis.json").read_text(encoding="utf-8"))
    assert analysis["calls"] == 3 and analysis["agreement"] == pytest.approx(1.0)
    assert json.loads((out / "scenes_nemotron.json").read_text(encoding="utf-8"))["regions"].count("far_right_bin") == 6
    assert "Nemotron's recipe" in (out / "report.md").read_text(encoding="utf-8")
