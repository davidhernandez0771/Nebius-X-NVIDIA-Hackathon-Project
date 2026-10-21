"""Demo starts for the RL teacher (demo_pipeline.rl_demo_bank): restorable states along SANT-verified episodes."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline import rl_demo_bank as bank_mod
from demo_pipeline.schemas import Demo, Passport, Scene, Trajectory, VerificationResult
from demo_pipeline.store import DemoStore

EPISODES = Path(__file__).parent / "data" / "rl_episodes"


def _arrays(name):
    d = EPISODES / name
    return dict(np.load(d / "steps.npz")), dict(np.load(d / "signals.npz")), json.loads((d / "scene.json").read_text())


def _qmul(a, b):
    return bank_mod._qmul(np.asarray(a, float), np.asarray(b, float))


def test_only_restorable_states_free_then_held_never_after_the_release():
    steps, sig, scene = _arrays("verified")
    st = bank_mod.episode_states(steps, sig, scene, stride=1)
    grip = steps["gripper"].astype(int)
    k_close = int(np.flatnonzero(grip == 1)[0])
    k_open = k_close + int(np.flatnonzero(grip[k_close:] == 0)[0])
    free, held = st["phase"] == bank_mod.FREE, st["phase"] == bank_mod.HELD
    assert free.sum() > 0 and held.sum() > 0
    assert st["step"][free].max() < k_close <= st["step"][held].min() and st["step"][held].max() < k_open
    # free: the cube exactly where the scene put it, in the scene's orientation, nothing touching it
    np.testing.assert_allclose(st["cube_quat_wxyz"][free], np.tile(scene["cube_pose"]["quat_wxyz"], (free.sum(), 1)),
                               atol=1e-6)
    assert np.all(np.linalg.norm(st["cube_pos"][free] - np.asarray(scene["cube_pose"]["pos"]), axis=1) <= 0.002 + 1e-6)
    # held: closed, the fingers on the cube; at the close the cube's orientation is still the scene's
    assert st["closed"][held].all() and sig["contact_gripper_cube"][st["step"][held]].all()
    first = np.flatnonzero(held)[0]
    np.testing.assert_allclose(np.abs(st["cube_quat_wxyz"][first]), np.abs(scene["cube_pose"]["quat_wxyz"]), atol=2e-3)
    np.testing.assert_allclose(np.linalg.norm(st["cube_quat_wxyz"], axis=1), 1.0, atol=1e-5)
    # the rest of the state, straight from the episode
    np.testing.assert_allclose(st["joint_pos"], steps["joint_pos"][st["step"]], atol=1e-6)
    np.testing.assert_allclose(st["bin_pos"], np.tile(scene["bin_pose"]["pos"], (len(st["step"]), 1)), atol=1e-6)
    assert np.all(np.diff(st["progress"]) > 0) and 0 <= st["progress"].min() and st["progress"].max() <= 1


def test_a_held_cube_turns_with_the_hand():
    steps, sig, scene = _arrays("verified")
    st = bank_mod.episode_states(steps, sig, scene, stride=1)
    held = np.flatnonzero(st["phase"] == bank_mod.HELD)
    k0, k1 = st["step"][held[0]], st["step"][held[-1]]
    turn = _qmul(steps["ee_quat"][k1], bank_mod._qconj(steps["ee_quat"][k0].astype(float)))
    want = _qmul(turn, scene["cube_pose"]["quat_wxyz"])
    np.testing.assert_allclose(np.abs(st["cube_quat_wxyz"][held[-1]]), np.abs(want / np.linalg.norm(want)), atol=2e-3)


def _store(tmp_path) -> DemoStore:
    """A store with the verified fixture as a variant, the failed fixture as a variant, and a raw take's _home."""
    st = DemoStore(tmp_path / "store")
    steps, _, scene_d = _arrays("verified")
    scene = Scene.model_validate(scene_d)
    traj = Trajectory.from_arrays(np.arange(len(steps["gripper"])) * 0.02, steps["ee_pos"], steps["ee_quat"],
                                  steps["gripper"])

    def save(id, source, parent, ok, fixture):
        st.save_demo(Demo(id=id, source=source, parent_id=parent, trajectory=traj, scene=scene,
                          human_seconds=1.0 if source == "human" else 0.0))
        st.save_passport(id, Passport(demo_id=id, lineage=st.lineage(id), diagnosis_source="rules", robot="franka",
                                      verification=VerificationResult(success=ok, duration=1.0, path_length=1.0,
                                                                      max_contact_force=0.0), pipeline_version="t"))
        if fixture:
            ep = st.episode_dir(id)
            ep.mkdir(parents=True, exist_ok=True)
            for f in ("steps.npz", "signals.npz", "scene.json"):
                shutil.copy(EPISODES / fixture / f, ep / f)

    save("h", "human", None, True, "verified")
    save("h_home", "repaired", "h", True, "verified")  # the raw take aligned: not a training episode by default
    save("h_rules", "repaired", "h", True, None)
    save("h_rules_home", "repaired", "h_rules", True, "verified")
    save("h_rules_home_m3100", "variant", "h_rules_home", True, "verified")
    save("h_rules_home_m3101", "variant", "h_rules_home", False, "collision")  # failed: never a demo start
    return st


def test_the_bank_takes_only_verified_training_episodes_and_only_reads_the_store(tmp_path):
    st = _store(tmp_path)
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in st.root.rglob("*") if p.is_file()}
    assert bank_mod.training_episode_ids(st) == ["h_rules_home", "h_rules_home_m3100"]
    assert bank_mod.training_episode_ids(st, include_raw=True) == ["h_home", "h_rules_home", "h_rules_home_m3100"]
    bank, meta = bank_mod.build_bank(st, stride=5)
    assert meta["episodes"] == ["h_rules_home", "h_rules_home_m3100"] and meta["states"] == len(bank["phase"])
    assert set(bank["episode"].tolist()) == {0, 1} and set(bank) == set(bank_mod.FIELDS)
    after = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in st.root.rglob("*") if p.is_file()}
    assert after == before
    out = tmp_path / "bank.npz"
    bank_mod.save_bank(out, bank, meta)
    back = bank_mod.load_bank(out)
    for k in bank_mod.FIELDS:
        np.testing.assert_array_equal(back[k], bank[k])
    assert json.loads(out.with_suffix(".json").read_text())["states"] == meta["states"]


def test_the_curriculum_moves_demo_starts_from_late_to_early():
    assert bank_mod.min_progress(0) == pytest.approx(0.75)
    assert bank_mod.min_progress(12_000) == pytest.approx(0.375)
    assert bank_mod.min_progress(10**9) == pytest.approx(0.0)
    progress = np.linspace(0, 1, 101)
    rng = np.random.default_rng(0)
    late = bank_mod.sample_states(rng, progress, 1000, bank_mod.min_progress(0))
    assert progress[late].min() >= 0.75
    early = bank_mod.sample_states(rng, progress, 1000, bank_mod.min_progress(10**9))
    assert progress[early].min() < 0.05  # by the end, starts come from the whole episode
    assert len(bank_mod.sample_states(rng, progress, 3, 2.0)) == 3  # nothing that late: any row


def test_a_store_without_training_episodes_is_refused(tmp_path):
    with pytest.raises(ValueError, match="no verified training episodes"):
        bank_mod.build_bank(DemoStore(tmp_path / "empty"))


def test_resets_mix_demo_states_and_home_starts_in_sant_scenes(tmp_path):
    bank, _ = bank_mod.build_bank(_store(tmp_path), stride=5)
    home = np.array([0.0, -0.57, 0.0, -2.81, 0.0, 3.04, 0.74, 0.04, 0.04], dtype=np.float32)
    rng = np.random.default_rng(1)
    plan = bank_mod.plan_resets(rng, 400, bank, demo_prob=0.5, floor=0.6, home_joints=home)
    demo = plan["demo"]
    assert 150 < demo.sum() < 250  # about half
    assert np.all(bank["progress"][plan["row"][demo]] >= 0.6) and np.all(plan["row"][~demo] == -1)
    np.testing.assert_allclose(plan["joint_pos"][demo], bank["joint_pos"][plan["row"][demo]])
    np.testing.assert_allclose(plan["cube_pos"][demo], bank["cube_pos"][plan["row"][demo]])
    np.testing.assert_allclose(plan["joint_pos"][~demo], np.tile(home, ((~demo).sum(), 1)))
    # home starts: SANT's sampled scenes (cube on the table, inside the Franka's ranges)
    c = plan["cube_pos"][~demo]
    assert np.all((c[:, 0] >= 0.40) & (c[:, 0] <= 0.60) & (np.abs(c[:, 1]) <= 0.20)) and np.allclose(c[:, 2], 0.025)
    np.testing.assert_allclose(np.linalg.norm(plan["cube_quat_wxyz"], axis=1), 1.0, atol=1e-6)
    # "RL without demos": no bank, or demo_prob 0 -> every start from home
    for b, p in ((None, 0.5), (bank, 0.0)):
        assert not bank_mod.plan_resets(rng, 50, b, demo_prob=p, floor=0.0, home_joints=home)["demo"].any()
