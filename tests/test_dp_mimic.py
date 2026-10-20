"""demo_pipeline.mimic: a SANT episode -> one Isaac Lab Mimic source demo (annotated layout), pure numpy."""
from __future__ import annotations

import numpy as np
import pytest

import mimic_episode as fx
from demo_pipeline import mimic


def _demo(**kw):
    a = fx.arrays(**kw)
    return mimic.episode_to_mimic(a["steps"], a["trajectory"], a["cube_pos"], a["scene"])


def test_quaternions_go_from_sants_wxyz_to_isaac_labs_xyzw():
    assert mimic.xyzw([0.1, 0.2, 0.3, 0.4]).tolist() == pytest.approx([0.2, 0.3, 0.4, 0.1])
    assert mimic.xyzw(np.array([[1.0, 0, 0, 0], [0, 1.0, 0, 0]])).tolist() == [[0, 0, 0, 1.0], [1.0, 0, 0, 0]]


def test_pose_matrices_are_4x4_with_the_rotation_and_the_position():
    m = mimic.pose_matrix(np.array([[0.1, 0.2, 0.3]]), np.array([fx.DOWN_WXYZ]))
    assert m.shape == (1, 4, 4)
    # The tool pointing down: 180 deg about x.
    assert m[0, :3, :3] == pytest.approx(np.diag([1.0, -1.0, -1.0]), abs=1e-12)
    assert m[0, :3, 3].tolist() == pytest.approx([0.1, 0.2, 0.3])
    assert m[0, 3].tolist() == [0, 0, 0, 1]


def test_the_gripper_command_becomes_isaac_labs_binary_action_negative_to_close():
    g = mimic.gripper_actions(np.array([0, 1, 1, 0], dtype=np.int8))
    assert g.shape == (4, 1)
    assert g[:, 0].tolist() == [1.0, -1.0, -1.0, 1.0]


def test_subtask_signals_come_from_sants_phases_grasp_at_the_lift_place_at_the_release():
    s = mimic.subtask_signals(["reach", "reach", "grasp", "carry", "carry", "place", "release", "release"])
    assert set(s) == {"grasp", "place"}
    assert s["grasp"].dtype == bool and s["place"].dtype == bool
    assert s["grasp"].tolist() == [False, False, False, True, True, True, True, True]
    assert s["place"].tolist() == [False] * 6 + [True, True]


@pytest.mark.parametrize(
    "phases, why",
    [
        (["reach", "grasp", "grasp", "release"], "never lifts"),
        (["reach", "grasp", "carry", "place"], "never lets go"),
        (["carry", "carry", "release"], "lifted at the first step"),
    ],
)
def test_a_demo_without_a_clean_grasp_then_release_has_no_subtasks(phases, why):
    with pytest.raises(ValueError):
        mimic.subtask_signals(phases)


def test_boundaries_follow_mimics_pool_the_grasp_ends_one_step_past_its_first_true_flag():
    s = mimic.subtask_signals(["reach"] * 3 + ["carry"] * 4 + ["release"] * 3)
    # DataGenInfoPool: end = (first 0->1 transition) + 1, the last subtask runs to the end.
    assert mimic.subtask_boundaries(s, 10) == [(0, 4), (4, 10)]


def test_an_episode_becomes_actions_datagen_info_and_an_initial_state():
    a = fx.arrays()
    d = _demo()
    n = fx.N
    # Actions: the commanded tool pose (xyzw) and the gripper, as an IK-abs env takes them.
    assert d["actions"].shape == (n, 8) and d["actions"].dtype == np.float32
    assert d["actions"][:, :3] == pytest.approx(np.asarray(a["trajectory"]["ee_pos"]), abs=1e-6)
    assert d["actions"][:, 3:7] == pytest.approx(mimic.xyzw(np.asarray(a["trajectory"]["ee_quat"])), abs=1e-6)
    assert d["actions"][fx.CLOSE, 7] == -1 and d["actions"][0, 7] == 1

    info = d["obs"]["datagen_info"]
    eef = info["eef_pose"][mimic.EEF]
    target = info["target_eef_pose"][mimic.EEF]
    assert eef.shape == target.shape == (n, 4, 4)
    # The target is the action's pose; the eef pose is recorded before each step (the pose reached by the last).
    assert target[:, :3, 3] == pytest.approx(d["actions"][:, :3], abs=1e-6)
    assert eef[1:, :3, 3] == pytest.approx(a["steps"]["ee_pos"][:-1], abs=1e-6)
    assert eef[0, :3, 3] == pytest.approx(np.asarray(a["trajectory"]["ee_pos"][0]), abs=1e-6)

    cube, bin_ = info["object_pose"]["cube"], info["object_pose"]["bin"]
    assert cube.shape == bin_.shape == (n, 4, 4)
    assert cube[:, :3, 3] == pytest.approx(a["cube_pos"], abs=1e-6)
    # SANT tracks the cube's position only: its rotation stays the start pose's (Mimic reads it at subtask starts).
    assert np.allclose(cube[:, :3, :3], mimic.pose_matrix(np.zeros((1, 3)), np.array([fx.CUBE_QUAT]))[0, :3, :3])
    assert np.allclose(bin_, bin_[0])

    sig = info["subtask_term_signals"]
    assert sig["grasp"].argmax() == fx.LIFT and sig["place"].argmax() == fx.RELEASE

    st = d["initial_state"]
    robot = st["articulation"]["robot"]
    assert robot["root_pose"].shape == (1, 7) and robot["root_pose"][0, 3:].tolist() == [0, 0, 0, 1]
    assert robot["joint_position"].shape == (1, 9) and robot["joint_velocity"].shape == (1, 9)
    assert robot["joint_position"][0] == pytest.approx(a["steps"]["joint_pos"][0])
    # Every rigid object of SANT's Franka scene: InteractiveScene.reset_to (annotation's replay) reads them all.
    assert set(st["rigid_object"]) == set(mimic.SCENE_OBJECTS)
    for name in mimic.SCENE_OBJECTS:
        assert st["rigid_object"][name]["root_pose"].shape == (1, 7)
        assert st["rigid_object"][name]["root_velocity"].shape == (1, 6)
    assert st["rigid_object"]["cube"]["root_pose"][0, 3:] == pytest.approx(mimic.xyzw(fx.CUBE_QUAT))
    floor = st["rigid_object"]["bin_floor"]["root_pose"][0]
    assert floor[:3] == pytest.approx(fx.BIN + [0, 0, 0.005])

    assert d["obs"]["eef_quat"][0] == pytest.approx(mimic.xyzw(a["steps"]["ee_quat"][0]))
    assert d["obs"]["cube_pos"].shape == (n, 3)


def test_check_accepts_the_demo_and_names_what_is_wrong_with_a_broken_one():
    d = _demo()
    assert mimic.check(d) == [(0, fx.LIFT + 1), (fx.LIFT + 1, fx.N)]
    bad = _demo()
    bad["obs"]["datagen_info"]["eef_pose"][mimic.EEF] = bad["obs"]["datagen_info"]["eef_pose"][mimic.EEF][:-1]
    with pytest.raises(ValueError, match="eef_pose"):
        mimic.check(bad)


def test_check_leaves_room_for_mimics_largest_boundary_offset():
    # The grasp may end as late as (end + max offset): that must still fall before the demo's end.
    d = _demo()
    with pytest.raises(ValueError, match="offset"):
        mimic.check(d, term_offset=(10, fx.N))


def test_only_demos_that_start_at_the_robots_home_pose_can_be_mimic_sources():
    assert mimic.starts_at_home(fx.arrays()["trajectory"])
    assert not mimic.starts_at_home(fx.arrays(start=[0.3, 0.1, 0.2])["trajectory"])


def test_the_home_pose_is_the_scripted_experts():
    from sim_worker.scripted import DOWN_WXYZ, HOME_TCP

    assert mimic.HOME_TCP == pytest.approx(HOME_TCP)
    assert mimic.HOME_WXYZ == pytest.approx(DOWN_WXYZ)


# --- the pieces the SANT Mimic env (sim_worker/mimic_env.py) shares with the export --------------------


def test_the_env_name_and_the_tool_offset_are_sants():
    from sim_worker.robots import robot_spec

    assert mimic.ENV_NAME == "SANT-PickPlace-Franka-IK-Abs-Mimic-v0"
    assert mimic.TCP_OFFSET == pytest.approx(robot_spec("franka").tcp_offset)


def test_scene_objects_puts_the_five_bin_boxes_round_the_bin_frame_turned_with_it():
    yaw90 = [np.cos(np.pi / 4), 0, 0, np.sin(np.pi / 4)]
    poses = mimic.scene_objects({"pos": [0.5, 0.0, 0.025], "quat_wxyz": [1, 0, 0, 0]},
                                {"pos": [0.5, 0.3, 0.0], "quat_wxyz": yaw90})
    assert set(poses) == set(mimic.SCENE_OBJECTS)
    pos = {k: np.asarray(v[0]) for k, v in poses.items()}
    # +x wall's centre is 0.105 m along the bin's own x, which the 90 deg yaw turns to world +y.
    assert pos["bin_wall_px"] == pytest.approx([0.5, 0.3 + 0.105, 0.05])
    assert pos["bin_floor"] == pytest.approx([0.5, 0.3, 0.005])
    assert poses["bin_wall_px"][1] == pytest.approx(yaw90)
    assert pos["table"] == pytest.approx(mimic.TABLE_CENTER)


def test_placed_is_check_successs_end_state_cube_inside_the_bin_settled_gripper_open():
    inside = np.array([[0.0, 0.0, 0.035], [0.09, -0.09, 0.03], [0.0, 0.0, 0.2], [0.12, 0.0, 0.03], [0.0, 0.0, 0.035]])
    speed = np.array([0.0, 0.005, 0.0, 0.0, 0.05])
    gripper_open = np.array([True, True, True, True, True])
    assert mimic.placed(inside, speed, gripper_open).tolist() == [True, True, False, False, False]
    assert not mimic.placed(inside[:1], speed[:1], np.array([False]))[0]


def test_placed_agrees_with_check_success_on_where_the_bin_is():
    from demo_pipeline.schemas import Pose, SimSignals, Trajectory
    from demo_pipeline.success import check_success

    rng = np.random.default_rng(1)
    bin_pose = Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1.0, 0.0, 0.0, 0.0))
    for p in rng.uniform([0.35, 0.15, -0.02], [0.65, 0.45, 0.12], size=(40, 3)):
        n = 60  # still for > 0.5 s, gripper open: only where the cube is can fail
        traj = Trajectory(t=[i / 50 for i in range(n)], ee_pos=[(0.5, 0.3, 0.3)] * n, ee_quat=[(0.0, 1.0, 0.0, 0.0)] * n,
                          gripper=[0] * n)
        sim = SimSignals(cube_pos=np.tile(p, (n, 1)), contact_gripper_cube=np.zeros(n, bool),
                         contact_arm_bin=np.zeros(n, bool), contact_arm_table=np.zeros(n, bool), max_contact_force=np.zeros(n))
        want = check_success(traj, sim, bin_pose).success
        got = mimic.placed((p - np.array(bin_pose.pos))[None], np.zeros(1), np.array([True]))[0]
        assert bool(got) == want, p


def test_grasped_is_the_exports_grasp_signal_closed_and_the_cube_a_centimetre_up():
    z = np.array([0.025, 0.034, 0.036, 0.2])
    assert mimic.grasped(z, np.array([True, True, True, False])).tolist() == [False, False, True, False]
