"""sim_worker.degraded: files written next to a rendered degraded demo (pure)."""

from __future__ import annotations

import json

from demo_pipeline.degrade import InjectedIssue
from demo_pipeline.schemas import Demo, Pose, Scene
from sim_worker.degraded import case_name, is_done, write_case_files
from sim_worker.scripted import scripted_expert

SCENE = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1, 0, 0, 0)),
              bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1, 0, 0, 0)), robot="franka", seed=7)
TRUTH = [InjectedIssue(type="pause", t0=2.0, t1=2.9), InjectedIssue(type="pause", t0=4.9, t1=5.4, dont_care=True)]


def test_case_names_are_prefix_and_padded_seed():
    assert case_name("degraded", 7) == "degraded_0007"


def test_case_files_hold_a_human_demo_and_the_ground_truth(tmp_path):
    traj = scripted_expert(SCENE)
    write_case_files(tmp_path, demo_id="degraded_0007", traj=traj, scene=SCENE, truth=TRUTH, seed=7, jitter_mm=2.0)
    demo = Demo.model_validate_json((tmp_path / "demo.json").read_text())
    assert (demo.id, demo.source, demo.parent_id) == ("degraded_0007", "human", None)
    assert demo.human_seconds == traj.duration and demo.scene == SCENE and demo.trajectory == traj
    truth = json.loads((tmp_path / "truth.json").read_text())
    assert truth["synthetic"] is True and truth["seed"] == 7 and truth["jitter_mm"] == 2.0
    assert [InjectedIssue.model_validate(i) for i in truth["issues"]] == TRUTH
    assert truth["generator"] == "scripts.score_rules_on_degraded.make_case"


def test_a_case_is_done_only_with_its_verification_and_truth(tmp_path):
    assert not is_done(tmp_path)
    (tmp_path / "verification.json").write_text("{}")
    assert not is_done(tmp_path)
    (tmp_path / "truth.json").write_text("{}")
    assert is_done(tmp_path)


# --- home start (sprint 5 Task 1) ---

import numpy as np  # noqa: E402
import pytest  # noqa: E402

from scripts.score_rules_on_degraded import make_case as t1_make_case  # noqa: E402
from sim_worker.degraded import make_case  # noqa: E402
from sim_worker.scripted import HOME_TCP  # noqa: E402


@pytest.mark.parametrize("seed", range(6))
def test_make_case_without_home_start_is_t1s_case_exactly(seed):
    assert make_case(seed, 2.0) == t1_make_case(seed, 2.0)


@pytest.mark.parametrize("seed", range(12))
def test_home_start_cases_all_start_at_home_up_to_the_grasp_offset(seed):
    traj, truth, scene = make_case(seed, 0.0, home_start=True)
    # degrade shifts the approach by the 4-12 mm grasp offset from the first step on; no tremor at 0 mm
    assert np.linalg.norm(np.asarray(traj.ee_pos[0]) - HOME_TCP) <= 0.012 + 1e-9
    plain, plain_truth, plain_scene = make_case(seed, 0.0)
    assert scene == plain_scene
    assert {i.type for i in truth if not i.dont_care} == {i.type for i in plain_truth if not i.dont_care}


def test_case_files_record_the_generator_and_home_start(tmp_path):
    traj, truth, scene = make_case(3, 2.0, home_start=True)
    write_case_files(tmp_path, demo_id="d", traj=traj, scene=scene, truth=truth, seed=3, jitter_mm=2.0,
                     home_start=True)
    body = json.loads((tmp_path / "truth.json").read_text())
    assert body["home_start"] is True and body["generator"] == "sim_worker.degraded.make_case"
