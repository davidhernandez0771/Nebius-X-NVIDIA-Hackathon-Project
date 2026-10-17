"""sim_worker.homeset: the home-start multiply dataset for T3 (sprint 6 Task 2), pure parts."""

from __future__ import annotations

import json

import numpy as np
import pytest

from demo_pipeline.episode_io import EpisodeMeta, load_episode, save_episode
from demo_pipeline.schemas import VerificationResult
from sim_worker.homeset import (EVAL_SEED_MIN, SOURCE_SEED0, VARIANT_SEED0, dataset_manifest, passport, source_name,
                                source_seeds, stamp, variant_seeds)

OK = VerificationResult(success=True, reasons=[], duration=9.0, path_length=1.0, max_contact_force=0.0,
                        settle_time=1.0)
BAD = VerificationResult(success=False, reasons=["not_in_bin"], duration=9.0, path_length=1.0,
                         max_contact_force=0.0, settle_time=1.0)


def test_training_seeds_stay_clear_of_t3s_eval_scenes_and_of_each_other():
    src = source_seeds(10)
    var = [s for i in range(10) for s in variant_seeds(i, 10)]
    assert src == list(range(SOURCE_SEED0, SOURCE_SEED0 + 10))
    assert len(set(src + var)) == 110
    assert max(src + var) < EVAL_SEED_MIN == 5000
    assert variant_seeds(3, 10) == list(range(VARIANT_SEED0 + 30, VARIANT_SEED0 + 40))


def test_variant_seeds_refuse_to_overlap_the_next_source_block():
    with pytest.raises(ValueError):
        variant_seeds(0, 11)


def test_source_names_are_padded_seeds():
    assert source_name(3000) == "home_src_3000"


def test_passport_lineage_starts_at_the_source():
    src = passport("home_src_3000", ["home_src_3000"], OK)
    var = passport("home_src_3000_3105", ["home_src_3000", "home_src_3000_3105"], OK, variant_seed=3105)
    assert src.lineage[0] == var.lineage[0] == "home_src_3000"
    assert (src.diagnosis_source, src.repairs_applied, src.variant_seed) == ("none", [], None)
    assert var.variant_seed == 3105 and var.robot == "franka"


def test_stamp_puts_the_passport_in_the_episode_meta(tmp_path):
    ep = tmp_path / "home_src_3000_3105"
    meta = EpisodeMeta(demo_id=ep.name, robot="franka", task_text="t", fps=50, n_steps=2, cameras=[])
    arrays = {"joint_pos": np.zeros((2, 9), np.float32), "action": np.zeros((2, 9), np.float32),
              "ee_pos": np.zeros((2, 3), np.float32), "ee_quat": np.zeros((2, 4), np.float32),
              "gripper": np.zeros(2, np.int8)}
    save_episode(ep, meta, arrays)
    pp = passport(ep.name, ["home_src_3000", ep.name], OK, variant_seed=3105)
    stamp(ep, pp)
    got, _, _ = load_episode(ep)
    assert got.passport == pp and got.demo_id == ep.name and got.n_steps == 2


def test_manifest_counts_yield_and_builds_t3_cells_from_successes_only():
    sources = [{"name": "home_src_3000", "seed": 3000, "success": True, "reasons": [], "ep_dir": "E/s0"},
               {"name": "home_src_3001", "seed": 3001, "success": False, "reasons": ["not_in_bin"], "ep_dir": "E/s1"}]
    variants = [{"name": "home_src_3000_3100", "source": "home_src_3000", "seed": 3100, "success": True,
                 "reasons": [], "ep_dir": "E/v0"},
                {"name": "home_src_3000_3101", "source": "home_src_3000", "seed": 3101, "success": False,
                 "reasons": ["dropped"], "ep_dir": "E/v1"},
                {"name": "home_src_3001_3110", "source": "home_src_3001", "seed": 3110, "success": True,
                 "reasons": [], "ep_dir": "E/v2"}]
    m = dataset_manifest(sources, variants)
    assert m["sources_verified"] == 1 and m["variant_attempts"] == 3 and m["variant_successes"] == 2
    assert m["yield"] == pytest.approx(2 / 3) and m["variant_reasons"] == {"dropped": 1}
    assert m["per_source"]["home_src_3000"] == {"attempts": 2, "successes": 1}
    cells = {c["condition"]: c for c in m["grid"]["cells"]}
    assert cells["raw"] == {"condition": "raw", "n_human": 2, "episode_dirs": ["E/s0"]}
    # a variant of a source that failed verification is still a verified episode of that human root
    assert cells["raw_multiply"]["episode_dirs"] == ["E/s0", "E/v0", "E/v2"]
    assert cells["raw_multiply"]["n_human"] == 2
    json.dumps(m)


# --- rehome: multiplied variants of a home-start source start at home too ---

from demo_pipeline.multiply import sample_scene, transform_trajectory  # noqa: E402
from sim_worker.homeset import first_move_steps, rehome  # noqa: E402
from sim_worker.scripted import DOWN_WXYZ, HOME_TCP, scripted_expert  # noqa: E402


def _src():
    scene = sample_scene(np.random.default_rng(3000), "franka", 3000)
    return scene, scripted_expert(scene, home_start=True)


def test_first_move_steps_is_where_the_home_demo_reaches_the_plain_demos_start():
    scene, traj = _src()
    k = first_move_steps(scene)
    assert np.allclose(traj.ee_pos[k], scripted_expert(scene).ee_pos[0])


@pytest.mark.parametrize("seed", [3100, 3105, 3133, 3177])
def test_rehomed_variants_start_at_home_pointing_down(seed):
    scene, traj = _src()
    dst = sample_scene(np.random.default_rng(seed), "franka", seed)
    raw = transform_trajectory(traj, scene, dst)
    assert np.linalg.norm(np.asarray(raw.ee_pos[0]) - HOME_TCP) > 0.05  # the leak this fixes
    out = rehome(raw, first_move_steps(scene))
    assert np.allclose(out.ee_pos[0], HOME_TCP) and np.allclose(out.ee_quat[0], DOWN_WXYZ)
    assert np.allclose(np.diff(out.t), 0.02) and out.t[0] == 0.0


@pytest.mark.parametrize("seed", [3100, 3105, 3133])
def test_rehome_keeps_the_variant_from_above_the_cube_on(seed):
    scene, traj = _src()
    dst = sample_scene(np.random.default_rng(seed), "franka", seed)
    raw = transform_trajectory(traj, scene, dst)
    k = first_move_steps(scene)
    out = rehome(raw, k)
    tail = len(raw.t) - k
    assert np.allclose(np.asarray(out.ee_pos)[-tail:], np.asarray(raw.ee_pos)[k:])
    assert np.allclose(np.asarray(out.ee_quat)[-tail:], np.asarray(raw.ee_quat)[k:])
    assert list(out.gripper[-tail:]) == list(raw.gripper[k:]) and not any(out.gripper[:-tail])
    speed = np.linalg.norm(np.diff(np.asarray(out.ee_pos)[: len(out.t) - tail + 1], axis=0), axis=1) / 0.02
    assert speed.max() <= 1.875 * 0.15 + 1e-3


def test_rehoming_the_source_itself_changes_nothing():
    scene, traj = _src()
    out = rehome(traj, first_move_steps(scene))
    assert np.allclose(out.ee_pos, traj.ee_pos) and np.allclose(out.ee_quat, traj.ee_quat)
    assert out.gripper == traj.gripper and np.allclose(out.t, traj.t)


def test_rehome_refuses_a_first_move_with_the_gripper_closed():
    scene, traj = _src()
    with pytest.raises(ValueError):
        rehome(traj, len(traj.t) - 5)
