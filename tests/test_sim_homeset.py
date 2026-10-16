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
