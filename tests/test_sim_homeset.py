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


def test_thirty_variants_per_source_keep_the_first_ten_and_stay_clear_of_everything():
    # sprint 7: 10 x 30. The first 10 of each source are sprint 6's seeds, so those episodes are reused.
    var = {i: variant_seeds(i, 30) for i in range(10)}
    for i in range(10):
        assert var[i][:10] == variant_seeds(i, 10)
    assert var[3][10:20] == list(range(VARIANT_SEED0 + 100 + 30, VARIANT_SEED0 + 100 + 40))
    every = source_seeds(10) + [s for v in var.values() for s in v]
    assert len(set(every)) == 310 and max(every) < EVAL_SEED_MIN


def test_variant_seeds_refuse_an_eleventh_source_that_would_overlap_the_next_block():
    with pytest.raises(ValueError):
        variant_seeds(10, 1)


def test_variant_seeds_refuse_to_reach_the_eval_scenes():
    with pytest.raises(ValueError):
        variant_seeds(9, 200)


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


# --- Neaten: centered approach (grasp fix, 2026-10-18) -------------------------------------------------------------
# Traced evals: the policy arrives above the cube ~2 cm off in a random direction and with its wrist yaw ~25 deg off,
# and corrects neither on the way down (the demos are always perfectly aligned, so they never show a correction).
# Off along the closing axis (> 15 mm): a finger lands on the cube top and the grasp closes 3 cm too high. Off in
# yaw (~45 deg): the fingers close on the cube's edges and squeeze it out. Both end as a drop.

@pytest.mark.parametrize("seed", [3100, 3133])
def test_centered_approach_arrives_off_then_centers_over_the_cube_before_the_descent(seed):
    from sim_worker.homeset import CENTER_MIN_S
    scene, traj = _src()
    dst = sample_scene(np.random.default_rng(seed), "franka", seed)
    raw = transform_trajectory(traj, scene, dst)
    k = first_move_steps(scene)
    above = np.asarray(raw.ee_pos[k])
    offset = np.array([0.012, -0.016])  # 2 cm
    out = rehome(raw, k, approach_offset=offset, approach_yaw=np.radians(25))
    pos = np.asarray(out.ee_pos)
    tail = len(raw.t) - k
    # the variant from above the cube on is untouched: same descent, grasp, lift, carry, release
    assert np.allclose(pos[-tail:], np.asarray(raw.ee_pos)[k:]) and list(out.gripper[-tail:]) == list(raw.gripper[k:])
    assert np.allclose(pos[0], HOME_TCP) and not any(out.gripper[:-tail])
    # it passes through the off-center hover, at the above-cube height, turned 25 deg past the grasp yaw
    i = int(np.argmin(np.linalg.norm(pos[: len(pos) - tail] - (above + [*offset, 0.0]), axis=1)))
    assert np.linalg.norm(pos[i] - (above + [*offset, 0.0])) < 1e-9
    turn = (_yaw(out.ee_quat[i]) - _yaw(raw.ee_quat[k]) + np.pi) % (2 * np.pi) - np.pi
    assert np.degrees(turn) == pytest.approx(25.0, abs=1e-6)
    assert abs(np.asarray(out.ee_quat[i])[[0, 3]]).max() < 1e-9  # still pointing straight down
    # then centers and aligns: a horizontal move at the hover height, slow and at least CENTER_MIN_S long
    center = pos[i: len(pos) - tail + 1]
    assert np.allclose(center[:, 2], above[2]) and len(center) - 1 >= round(CENTER_MIN_S * 50)
    assert np.allclose(np.diff(out.t), 0.02) and out.t[0] == 0.0


def test_a_zero_approach_offset_is_the_plain_rehome():
    scene, traj = _src()
    dst = sample_scene(np.random.default_rng(3105), "franka", 3105)
    raw = transform_trajectory(traj, scene, dst)
    k = first_move_steps(scene)
    a, b = rehome(raw, k), rehome(raw, k, approach_offset=(0.0, 0.0), approach_yaw=0.0)
    assert np.allclose(a.ee_pos, b.ee_pos) and np.allclose(a.ee_quat, b.ee_quat) and a.gripper == b.gripper


def _yaw(q):  # of a pointing-down gripper quaternion (0, cos(y/2), sin(y/2), 0)
    return (2 * np.arctan2(q[2], q[1]) + np.pi) % (2 * np.pi) - np.pi  # q and -q are the same rotation


def test_a_yaw_only_misalignment_turns_the_wrist_at_the_hover_without_moving_it():
    scene, traj = _src()
    k = first_move_steps(scene)
    out = rehome(traj, k, approach_yaw=np.radians(-30))
    tail = len(traj.t) - k
    yaws = np.degrees([_yaw(q) for q in np.asarray(out.ee_quat)[: len(out.t) - tail + 1]])
    assert yaws.min() == pytest.approx(np.degrees(_yaw(traj.ee_quat[k])) - 30, abs=1e-6)
    assert np.allclose(np.asarray(out.ee_pos)[-tail:], np.asarray(traj.ee_pos)[k:])


def test_approach_misalignments_are_seeded_bounded_and_horizontal():
    from sim_worker.homeset import APPROACH_OFFSET_MAX, APPROACH_YAW_MAX, approach_misalignment
    pairs = [approach_misalignment(s) for s in range(3000, 3400)]
    offs, yaws = np.array([o for o, _ in pairs]), np.array([y for _, y in pairs])
    assert offs.shape == (400, 2) and yaws.shape == (400,)
    again = [approach_misalignment(s) for s in range(3000, 3400)]
    assert np.allclose(offs, [o for o, _ in again]) and np.allclose(yaws, [y for _, y in again])  # seeded
    assert np.abs(yaws).max() <= APPROACH_YAW_MAX and (yaws > 0).mean() == pytest.approx(0.5, abs=0.1)
    r = np.linalg.norm(offs, axis=1)
    assert r.max() <= APPROACH_OFFSET_MAX + 1e-12 and r.min() >= 0.0
    ang = np.arctan2(offs[:, 1], offs[:, 0])
    assert np.histogram(ang, bins=4, range=(-np.pi, np.pi))[0].min() > 70  # every direction
    assert (r > APPROACH_OFFSET_MAX / 2).mean() > 0.6  # uniform over the disc's area: mostly large


# --- the centered approach for human variants, at the retimed grasp's hover (2026-10-20 research note) ---------

from demo_pipeline.grasp_retime import HOVER_S, retime_grasp  # noqa: E402
from demo_pipeline.measure import gripper_events  # noqa: E402
from sim_worker.homeset import CENTER_MIN_S, approach_misalignment, center_from_hover, find_hover  # noqa: E402

# approach_misalignment(seed) before offset_max existed: the default must not change (sprint grasp-fix datasets)
_OLD_MISALIGNMENT = {3100: (0.027200475925161196, 0.009811417189268843, 0.06847432446719204),
                     3101: (-0.011817461369116301, -0.006903062672123079, -0.11734827539336318),
                     3457: (0.0046227006939681915, -0.010847143871559044, 0.41904509123159195),
                     4999: (-0.0015707303376078171, 0.01726575739472404, -0.053726087704181635)}


@pytest.mark.parametrize("seed", sorted(_OLD_MISALIGNMENT))
def test_the_default_misalignment_is_unchanged_and_offset_max_scales_only_the_radius(seed):
    off, yaw = approach_misalignment(seed)
    assert (float(off[0]), float(off[1]), yaw) == _OLD_MISALIGNMENT[seed]
    off4, yaw4 = approach_misalignment(seed, offset_max=0.04)
    np.testing.assert_allclose(off4, off * 4 / 3, atol=1e-15)
    assert yaw4 == yaw


def _swooped():
    """A human-like swoop (tests/test_dp_grasp_retime) and its retimed version, which has a hover."""
    from tests.test_dp_grasp_retime import _swoop

    src = _swoop()
    return src, retime_grasp(src, gripper_events(src)[0]).trajectory


def test_find_hover_finds_the_retimed_hover_and_nothing_in_a_swoop_or_the_expert():
    src, retimed = _swooped()
    assert find_hover(src) is None
    assert find_hover(scripted_expert(_src()[0], home_start=True)) is None
    i0, i1 = find_hover(retimed)
    p = np.asarray(retimed.ee_pos)
    assert i1 - i0 + 1 >= round(HOVER_S / 0.02) and np.ptp(p[i0 : i1 + 1], axis=0).max() < 1e-9
    assert p[i0, 2] == pytest.approx(p[np.flatnonzero(np.asarray(retimed.gripper))[0], 2] + 0.10)


def test_center_from_hover_arrives_off_and_turned_then_centers_before_the_descent():
    _, retimed = _swooped()
    off, yaw = np.array([0.03, -0.025]), 0.5
    out = center_from_hover(retimed, off, yaw)
    p, q = np.asarray(out.ee_pos), np.asarray(out.ee_quat)
    p0, q0 = np.asarray(retimed.ee_pos), np.asarray(retimed.ee_quat)
    i0, i1 = find_hover(retimed)
    hover = p0[i0]
    np.testing.assert_allclose(p[0], p0[0], atol=1e-12)  # still starts at home
    np.testing.assert_allclose(p[i0 : i1 + 1], np.tile(hover + [off[0], off[1], 0], (i1 - i0 + 1, 1)), atol=1e-12)
    assert _yaw(q[i0]) - _yaw(q0[i0]) == pytest.approx(yaw, abs=1e-9)
    n_center = len(out.t) - len(retimed.t)
    assert n_center >= round(CENTER_MIN_S / 0.02)
    # after the centering it is the retimed demo again, step for step, from the hover on down
    np.testing.assert_allclose(p[i1 + n_center :], p0[i1:], atol=1e-12)
    np.testing.assert_allclose(np.abs(q[i1 + n_center :]), np.abs(q0[i1:]), atol=1e-12)
    assert np.all(np.asarray(out.gripper)[: i1 + n_center] == 0)
    assert np.linalg.norm(np.diff(p, axis=0), axis=1).max() < 0.01  # no jump anywhere


def test_center_from_hover_without_a_hover_or_a_misalignment():
    src, retimed = _swooped()
    assert center_from_hover(src, np.array([0.03, 0.0]), 0.2) is None  # no hover: the caller decides
    assert center_from_hover(retimed, np.zeros(2), 0.0) == retimed
