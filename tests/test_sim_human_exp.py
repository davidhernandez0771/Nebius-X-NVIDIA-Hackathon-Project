"""sim_worker.human_exp + sim_worker.standin: the pure half of the one-command human-demo experiment."""
from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.multiply import sample_scene, transform_trajectory
from demo_pipeline.schemas import Demo, Pose, Scene, Trajectory
from demo_pipeline.stats import fisher_exact, wilson_ci
from demo_pipeline.store import DemoStore
from sim_worker.human_exp import (align_home, cells, compare, config_diff, demo_sha256, headline, select_ids,
                                  variant_seed, variant_trajectory)
from sim_worker.scripted import DOWN_WXYZ, HOME_TCP, scripted_expert
from sim_worker.standin import TELEOP_SCENE, late_close, standin_demo

IDENTITY = (1.0, 0.0, 0.0, 0.0)


def _scene(seed=0):
    return Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=IDENTITY),
                 bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=IDENTITY), robot="franka", seed=seed)


def _human_like():
    """The plain expert (starts 15 cm above the cube, not at home), shifted a bit: where a hand might start."""
    t = scripted_expert(_scene()).to_arrays()
    return Trajectory.from_arrays(t["t"], t["ee_pos"] + [0.0, 0.02, 0.01], t["ee_quat"], t["gripper"])


# --- align_home and the variants ------------------------------------------------------------------

def test_align_home_starts_at_home_and_keeps_the_demo():
    traj = _human_like()
    aligned, k = align_home(traj)
    a, b = aligned.to_arrays(), traj.to_arrays()
    assert np.allclose(a["ee_pos"][0], HOME_TCP) and np.allclose(a["ee_quat"][0], DOWN_WXYZ)
    assert k == len(aligned.t) - len(traj.t) and k >= 20  # MIN_MOVE_S 0.4 s at 50 Hz
    assert np.allclose(a["ee_pos"][k:], b["ee_pos"]) and (a["gripper"][k:] == b["gripper"]).all()
    assert (a["gripper"][:k] == 0).all()
    assert np.allclose(np.diff(a["t"]), 0.02)


def test_align_rejects_closed_start():
    t = _human_like().to_arrays()
    g = t["gripper"].copy()
    g[0] = 1
    with pytest.raises(ValueError, match="gripper"):
        align_home(Trajectory.from_arrays(t["t"], t["ee_pos"], t["ee_quat"], g))


def test_variant_trajectory_is_rehomed_transform():
    aligned, k = align_home(_human_like())
    dst = sample_scene(np.random.default_rng(3100), "franka", 3100)
    v = variant_trajectory(aligned, k, _scene(), dst).to_arrays()
    moved = transform_trajectory(aligned, _scene(), dst).to_arrays()
    assert np.allclose(v["ee_pos"][0], HOME_TCP)
    j = len(v["t"]) - (len(moved["t"]) - k)  # where the rehomed move hands over to the transformed demo
    assert np.allclose(v["ee_pos"][j:], moved["ee_pos"][k:])


def test_multiply_skips_source_without_grasp():
    t = _human_like().to_arrays()
    aligned, k = align_home(Trajectory.from_arrays(t["t"], t["ee_pos"], t["ee_quat"], np.zeros_like(t["gripper"])))
    with pytest.raises(ValueError, match="grasp"):
        variant_trajectory(aligned, k, _scene(), sample_scene(np.random.default_rng(1), "franka", 1))


def test_variant_seeds_distinct_and_below_eval():
    seeds = [variant_seed(i, k) for i in range(12) for k in range(10)]
    assert len(set(seeds)) == len(seeds) and max(seeds) < 5000 and min(seeds) >= 3100
    assert variant_seed(0, 0) == 3100 and variant_seed(2, 7) == 3307
    with pytest.raises(ValueError):
        variant_seed(0, 100)
    with pytest.raises(ValueError):
        variant_seed(19, 0)  # 3100 + 1900 = 5000: an eval scene


# --- selection -------------------------------------------------------------------------------------

def _store(tmp_path, ids=("human_a", "human_b", "standin_00", "standin_01")):
    store = DemoStore(tmp_path)
    for id in ids:
        store.save_demo(Demo(id=id, source="human", trajectory=_human_like(), scene=_scene(), human_seconds=3.0))
    store.save_demo(Demo(id="standin_00_rules", source="repaired", parent_id="standin_00",
                         trajectory=_human_like(), scene=_scene(), human_seconds=0.0))
    return store


def test_select_by_ids_and_tag(tmp_path):
    store = _store(tmp_path)
    assert select_ids(store, ids=["human_b", "human_a"]) == ["human_b", "human_a"]  # the user's order
    assert select_ids(store, tag="standin_*") == ["standin_00", "standin_01"]  # human demos only, sorted
    with pytest.raises(ValueError, match="no human demo"):
        select_ids(store, tag="nope_*")
    with pytest.raises(ValueError, match="not found"):
        select_ids(store, ids=["human_a", "missing"])
    with pytest.raises(ValueError, match="not a human demo"):
        select_ids(store, ids=["standin_00_rules"])
    with pytest.raises(ValueError, match="exactly one"):
        select_ids(store)


def test_demo_sha256_tracks_content(tmp_path):
    store = _store(tmp_path)
    h = demo_sha256(store, "human_a")
    assert len(h) == 64 and h == demo_sha256(store, "human_a")
    assert h != demo_sha256(store, "human_b")  # different created_at / id


# --- cells, headline, compare, config ---------------------------------------------------------------

def test_cells_names_and_conditions():
    out = cells(["r1", "r2"], ["m1", "m2", "m3"], n_human=2)
    assert out == [{"condition": "raw", "n_human": 2, "episode_dirs": ["r1", "r2"]},
                   {"condition": "perfected_multiply", "n_human": 2, "episode_dirs": ["m1", "m2", "m3"]}]
    with pytest.raises(ValueError, match="empty"):
        cells([], ["m1"], n_human=2)


def _ep(seed, ok, ended_by=None):
    return {"seed": seed, "success": ok, "ended_by": ended_by or ("success" if ok else "timeout")}


def test_headline_counts_only_registered_seeds():
    eps = [_ep(5019, True), _ep(5020, True), _ep(5021, False), _ep(5022, True), _ep(5023, False, "sim_error"),
           _ep(5025, True)]
    h = headline(eps, seed0=5020, n=5)
    assert h["n_registered"] == 5 and h["n"] == 3 and h["successes"] == 2
    assert h["missing_seeds"] == [5023, 5024]  # sim_error says nothing about the policy; 5024 never ran
    assert h["complete"] is False
    full = headline([_ep(s, s % 2 == 0) for s in range(5020, 5025)], seed0=5020, n=5)
    assert full["complete"] and full["successes"] == 3 and full["rate"] == 0.6


def test_compare_uses_fisher_and_wilson():
    raw = {"successes": 3, "n": 40}
    mult = {"successes": 17, "n": 40}
    c = compare(raw, mult)
    assert c["fisher_p"] == fisher_exact(3, 40, 17, 40)
    assert c["raw"]["ci"] == list(wilson_ci(3, 40)) and c["multiplied"]["ci"] == list(wilson_ci(17, 40))
    assert c["test"] == "fisher_exact_two_sided" and c["alpha"] == 0.05 and c["significant"] is True
    assert compare({"successes": 0, "n": 0}, mult)["fisher_p"] is None


def test_config_change_refused():
    old = {"ids": ["a", "b"], "steps": 30000, "variants": 10}
    assert config_diff(old, dict(old)) == []
    assert config_diff(old, {**old, "steps": 2000, "ids": ["a"]}) == ["ids", "steps"]


# --- stand-ins ------------------------------------------------------------------------------------

def test_late_close_holds_open_at_the_grasp():
    traj = scripted_expert(_scene(), home_start=True)
    out = late_close(traj, 0.6)
    a, b = traj.to_arrays(), out.to_arrays()
    i = int(np.argmax(a["gripper"] == 1))
    j = int(np.argmax(b["gripper"] == 1))
    assert j - i == 30 and len(b["t"]) == len(a["t"]) + 30
    assert np.allclose(b["ee_pos"][i:j], a["ee_pos"][i]) and (b["gripper"][i:j] == 0).all()
    assert np.allclose(b["ee_pos"][j:], a["ee_pos"][i:]) and np.allclose(np.diff(b["t"]), 0.02)


def test_standin_demo_is_human_like_and_deterministic():
    d1, truth1 = standin_demo(7, id="standin_07")
    d2, _ = standin_demo(7, id="standin_07")
    assert d1.source == "human" and d1.parent_id is None and d1.scene == TELEOP_SCENE
    assert d1.trajectory == d2.trajectory and d1.human_seconds == pytest.approx(d1.trajectory.duration)
    kinds = {i["type"] for i in truth1["issues"]}
    assert {"jitter", "pause", "idle_start_end"} <= kinds and truth1["late_close_s"] > 0
    assert d1.trajectory != standin_demo(8, id="standin_08")[0].trajectory
    assert np.linalg.norm(np.asarray(d1.trajectory.ee_pos[0]) - HOME_TCP) < 0.02  # starts near home, jittered


def test_select_skips_discarded_demos(tmp_path):
    store = _store(tmp_path)
    store.discard("standin_01")
    assert select_ids(store, tag="standin_*") == ["standin_00"]
    with pytest.raises(ValueError, match="not found"):
        select_ids(store, ids=["standin_01"])
