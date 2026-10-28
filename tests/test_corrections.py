"""sim_worker.corrections (pure): the practice-and-correct loop's failure moments in a policy rollout, the state 1 s
before each, the human retake queue, and the corrections dataset cell. Synthetic StepTracer-shaped traces stand in
for Isaac rollouts."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, Scene
from sim_worker.corrections import (
    CorrectionCandidate,
    FailureMoment,
    RetakeQueue,
    correction_candidates,
    corrections_grid,
    failure_moments,
    provenance_rows,
    retake_item,
)
from sim_worker.recovery import RECOVERY_ROOT_PREFIX, recovery_trajectory

CUBE = np.array([0.50, 0.10, 0.025])
BIN = Pose(pos=(0.45, -0.25, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0))
SCENE = Scene(cube_pose=Pose(pos=tuple(CUBE), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), bin_pose=BIN, robot="franka", seed=5203)
DOWN = np.array([0.0, 1.0, 0.0, 0.0])
OPEN, CLOSED = 0.04, 0.0
HOME = [0.45, 0.0, 0.35]


def path(*legs):
    out = []
    for a, b, k in legs:
        a, b = np.asarray(a, float), np.asarray(b, float)
        out.append(a + (b - a) * np.linspace(0, 1, k, endpoint=False)[:, None])
    return np.vstack(out)


def trace(tcp, *, grip=None, contact=None, cube=None, fingers=None, arm_bin=None, force=None):
    tcp = np.asarray(tcp, dtype=float)
    n = len(tcp)
    grip = np.zeros(n, dtype=int) if grip is None else np.asarray(grip)
    fingers = np.where(grip == 1, CLOSED, OPEN) if fingers is None else np.asarray(fingers, dtype=float)
    q = np.zeros((n, 9))
    q[:, 0] = np.arange(n)  # joint 1 encodes the row: a state's joints come from row k + 1
    q[:, 7] = q[:, 8] = fingers
    return {
        "joint_pos": q, "action": np.zeros((n, 9)), "tcp_pos": tcp, "tcp_quat_wxyz": np.tile(DOWN, (n, 1)),
        "cube_pos": np.tile(CUBE, (n, 1)) if cube is None else np.asarray(cube, dtype=float),
        "cube_quat_wxyz": np.tile([1.0, 0.0, 0.0, 0.0], (n, 1)), "gripper": grip,
        "contact_gripper_cube": np.zeros(n, bool) if contact is None else np.asarray(contact, bool),
        "contact_arm_bin": np.zeros(n, bool) if arm_bin is None else np.asarray(arm_bin, bool),
        "contact_arm_table": np.zeros(n, bool), "max_contact_force": np.zeros(n) if force is None else np.asarray(force),
    }


def closes_at(n: int, k: int) -> np.ndarray:
    g = np.zeros(n, dtype=int)
    g[k:] = 1
    return g


AT_CUBE = CUBE + [0.0, 0.0, 0.0]
ABOVE = CUBE + [0.0, 0.0, 0.03]  # a "high close": 3 cm above the cube centre


def missed_grasp():
    """Over the cube, down to it, wait still for 3 s, close on nothing (the fingers shut)."""
    tcp = path((HOME, CUBE + [0, 0, 0.15], 60), (CUBE + [0, 0, 0.15], AT_CUBE, 40), (AT_CUBE, AT_CUBE, 150))
    return trace(tcp, grip=closes_at(len(tcp), 200))


# --- failure moments ---------------------------------------------------------------------------------------------

def test_a_close_on_nothing_is_a_failed_grasp():
    moments = failure_moments(missed_grasp(), SCENE)
    assert [(m.kind, m.k) for m in moments] == [("failed_grasp", 200)]
    assert moments[0].t == pytest.approx(4.0)


def test_a_close_well_above_the_cube_is_a_high_close_not_also_a_failed_grasp():
    tcp = path((HOME, ABOVE, 100), (ABOVE, ABOVE, 100))
    moments = failure_moments(trace(tcp, grip=closes_at(len(tcp), 150)), SCENE)
    assert [(m.kind, m.k) for m in moments] == [("high_close", 150)]
    assert "30 mm above" in moments[0].detail


def test_a_drop_on_the_way_is_found_where_the_fingers_lose_the_cube():
    n = 300
    lift = path((HOME, AT_CUBE, 100), (AT_CUBE, AT_CUBE, 50), (AT_CUBE, AT_CUBE + [0, 0, 0.2], 50), (AT_CUBE + [0, 0, 0.2], AT_CUBE + [0, -0.15, 0.2], 100))
    cube = np.tile(CUBE, (n, 1))
    cube[150:230] = lift[150:230]  # carried
    cube[230:] = [lift[229][0], lift[229][1], 0.025]  # fell back onto the table, off the bin
    contact = np.zeros(n, bool)
    contact[120:230] = True
    moments = failure_moments(trace(lift, grip=closes_at(n, 120), contact=contact, cube=cube), SCENE)
    assert [(m.kind, m.k) for m in moments] == [("drop", 230)]


def test_a_push_on_the_bin_over_5_newtons_is_a_rim_hit():
    n = 200
    tcp = path((HOME, [0.45, -0.14, 0.10], n))
    arm_bin = np.zeros(n, bool)
    force = np.zeros(n)
    arm_bin[120:140], force[120:140] = True, 3.0  # a touch: under the limit
    arm_bin[160:170], force[160:170] = True, 85.0
    moments = failure_moments(trace(tcp, arm_bin=arm_bin, force=force), SCENE)
    assert [(m.kind, m.k) for m in moments] == [("rim_hit", 160)]
    assert "85 N" in moments[0].detail


def test_closing_near_the_bin_with_nothing_held_is_an_empty_at_bin():
    at_bin = np.array([0.45, -0.12, 0.12])  # 13 cm from the bin centre, outside its footprint, within 15 cm
    tcp = path((HOME, at_bin, 100), (at_bin, at_bin, 100))
    moments = failure_moments(trace(tcp, grip=closes_at(200, 150)), SCENE)
    assert [m.kind for m in moments] == ["empty_at_bin"]


def test_a_clean_rollout_has_no_failure_moment():
    assert failure_moments(trace(path((HOME, HOME, 100))), SCENE) == []


def test_only_the_first_of_each_kind_counts():
    tcp = path((HOME, AT_CUBE, 100), (AT_CUBE, AT_CUBE, 300))
    g = np.zeros(400, dtype=int)
    g[150:200] = 1
    g[300:] = 1  # a second empty close
    moments = failure_moments(trace(tcp, grip=g), SCENE)
    assert [(m.kind, m.k) for m in moments] == [("failed_grasp", 150)]


# --- rewind 1 s, restore, candidates -------------------------------------------------------------------------------

def test_the_candidate_starts_one_second_before_the_failure():
    (cand,) = correction_candidates(missed_grasp(), SCENE, source="perfected_multiply_10")
    assert cand.moment.kind == "failed_grasp" and cand.skipped is None
    st = cand.state
    assert st.k == 150 and st.t == pytest.approx(3.0) and st.joint_pos[0] == 151  # row k + 1's joints
    assert st.name == "corr_5203_failed_grasp" and st.mode == "rewind_failed_grasp" and st.source == "perfected_multiply_10"
    traj = recovery_trajectory(st, BIN)  # the scripted expert can finish from it
    assert traj.gripper[-1] == 0 and len(traj.t) > 100


def test_a_moving_hand_one_second_before_steps_further_back_to_a_still_one():
    tcp = path((HOME, CUBE + [0, 0, 0.15], 60), (CUBE + [0, 0, 0.15], AT_CUBE, 40), (AT_CUBE, AT_CUBE, 150))
    tcp[145:155] += np.linspace(0, 0.05, 10)[:, None] * [1, 0, 0]  # a quick jerk around k = 150
    (cand,) = correction_candidates(trace(tcp, grip=closes_at(250, 200)), SCENE, source="p")
    assert cand.state is not None and cand.state.k <= 145  # stepped back from k = 150, where the hand jerks


def test_a_failure_with_the_cube_in_the_hand_for_too_long_is_skipped_with_a_reason():
    n = 500
    carry = path((HOME, AT_CUBE, 50), (AT_CUBE, AT_CUBE, 20), (AT_CUBE, AT_CUBE + [0, 0, 0.2], 50), (AT_CUBE + [0, 0, 0.2], AT_CUBE + [0, -0.15, 0.2], 380))
    cube = np.tile(CUBE, (n, 1))
    cube[70:450] = carry[70:450]
    cube[450:] = [carry[449][0], carry[449][1], 0.025]
    contact = np.zeros(n, bool)
    contact[60:450] = True
    (cand,) = correction_candidates(trace(carry, grip=closes_at(n, 60), contact=contact, cube=cube), SCENE, source="p")
    assert cand.moment.kind == "drop" and cand.state is None
    assert "no restorable state" in cand.skipped and "3.0 s" in cand.skipped


def test_two_failures_that_rewind_to_the_same_state_give_one_candidate():
    tcp = path((HOME, AT_CUBE, 100), (AT_CUBE, AT_CUBE, 150))
    n = 250
    arm_bin, force = np.zeros(n, bool), np.zeros(n)
    arm_bin[200:202], force[200:202] = True, 40.0  # a rim hit at the same moment as the empty close
    cands = correction_candidates(trace(tcp, grip=closes_at(n, 200), arm_bin=arm_bin, force=force), SCENE, source="p")
    assert [c.moment.kind for c in cands if c.state is not None] == ["failed_grasp"]
    assert any(c.skipped and "same state as" in c.skipped for c in cands)


def test_candidates_round_trip_as_json():
    (cand,) = correction_candidates(missed_grasp(), SCENE, source="p")
    assert CorrectionCandidate.model_validate_json(cand.model_dump_json()) == cand


# --- the human retake queue ----------------------------------------------------------------------------------------

def test_the_queue_keeps_each_candidate_once_and_lists_them(tmp_path):
    (cand,) = correction_candidates(missed_grasp(), SCENE, source="perfected_multiply_10")
    q = RetakeQueue(tmp_path)
    item = retake_item(cand, SCENE, checkpoint="ckpt/030000", trace_path="traces/seed_5203.npz", round_id="r1")
    assert q.add(item) is True and q.add(item) is False  # the same state isn't queued twice
    (listed,) = q.list()
    assert listed.name == "corr_5203_failed_grasp" and listed.status == "open" and listed.scene == SCENE
    assert listed.state.k == 150 and listed.failure.kind == "failed_grasp" and listed.round_id == "r1"
    assert q.list(status="done") == []
    assert (tmp_path / "corrections" / "queue" / "corr_5203_failed_grasp.json").is_file()


def test_a_queue_item_can_be_marked_done_with_its_demo(tmp_path):
    (cand,) = correction_candidates(missed_grasp(), SCENE, source="p")
    q = RetakeQueue(tmp_path)
    q.add(retake_item(cand, SCENE, checkpoint="c", trace_path="t", round_id="r1"))
    q.mark("corr_5203_failed_grasp", "done", demo_id="human_x")
    assert q.get("corr_5203_failed_grasp").status == "done" and q.get("corr_5203_failed_grasp").demo_id == "human_x"
    with pytest.raises(KeyError):
        q.get("../etc")


# --- the corrections cell ------------------------------------------------------------------------------------------

BASE_GRID = {"name": "base", "cells": [{"condition": "perfected_multiply", "n_human": 10, "label": "perfected_multiply_10",
                                         "episode_dirs": ["d/a", "d/b"]}]}


def test_the_cell_is_the_base_cell_plus_every_verified_correction():
    rows = [{"name": "corr_1_drop", "success": True, "ep_dir": "e/corr_1_drop"},
            {"name": "corr_2_failed_grasp", "success": False, "ep_dir": "e/corr_2"},
            {"name": "corr_3_rim_hit", "success": True, "ep_dir": "e/corr_3_rim_hit"}]
    g = corrections_grid(BASE_GRID, rows, name="corr_round_1", min_corrections=1)
    (cell,) = g["cells"]
    assert g["name"] == "corr_round_1" and cell["label"] == "corrections_2" and cell["n_human"] == 10
    assert cell["episode_dirs"] == ["d/a", "d/b", "e/corr_1_drop", "e/corr_3_rim_hit"]
    assert cell["condition"] == "perfected_multiply"
    with pytest.raises(ValueError, match="only 2 verified"):
        corrections_grid(BASE_GRID, rows, name="x", min_corrections=5)


def test_provenance_ties_each_correction_to_its_failure_rollout_and_verdict():
    (cand,) = correction_candidates(missed_grasp(), SCENE, source="perfected_multiply_10")
    rows = [{"name": cand.state.name, "seed": 5203, "mode": cand.state.mode, "success": True, "reasons": [],
             "ep_dir": "e/x"}]
    (p,) = provenance_rows(rows, [cand], checkpoint="ckpt", traces_dir="traces", round_id="r1")
    assert p["lineage_root"] == RECOVERY_ROOT_PREFIX + "perfected_multiply_10"
    assert p["failure"] == {"kind": "failed_grasp", "k": 200, "t": 4.0, "detail": cand.moment.detail}
    assert p["rewind"] == {"k": 150, "t": 3.0, "back_s": 1.0}
    assert p["rollout"] == {"seed": 5203, "trace": "traces/seed_5203.npz", "checkpoint": "ckpt"}
    assert p["verified"] is True and p["retake"] == "scripted" and p["round"] == "r1"
    json.dumps(p)


def test_failure_moment_kinds_are_the_documented_ones():
    from sim_worker.corrections import FAILURE_KINDS

    assert FAILURE_KINDS == ("failed_grasp", "high_close", "drop", "rim_hit", "empty_at_bin")
    FailureMoment(kind="drop", k=1, t=0.02, detail="")
    assert math.isclose(0.02, 1 / 50)


def test_a_grid_without_labels_names_its_cells_condition_n_human():
    """The experiment grids (data/human_exp/<name>/grid.json) carry no label: a cell is "<condition>_<n_human>"."""
    grid = {"name": "hx", "cells": [{"condition": "raw", "n_human": 10, "episode_dirs": ["r"]},
                                    {"condition": "perfected_multiply", "n_human": 10, "episode_dirs": ["p"]}]}
    rows = [{"name": "corr_1_drop", "success": True, "ep_dir": "e/1"}]
    (cell,) = corrections_grid(grid, rows, name="x", min_corrections=1, cell_label="perfected_multiply_10")["cells"]
    assert cell["episode_dirs"] == ["p", "e/1"]
    with pytest.raises(ValueError, match="exactly one cell"):
        corrections_grid(grid, rows, name="x", min_corrections=1)
