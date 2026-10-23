"""Human demos re-executed held (sim_eval.held_human): the slowed path, the cap and its lag, the k rule, the teacher,
and the written episode, against test_distill's kinematic toy env (no Isaac)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline import rl_teacher as rt
from demo_pipeline.episode_io import EpisodeMeta, load_episode
from demo_pipeline.multiply import sample_scene
from demo_pipeline.schemas import Trajectory
from lerobot_tools.assemble import source_of
from lerobot_tools.experiments import Grid
from sim_eval.distill import RolloutConfig, rollout
from sim_eval.held_human import (
    HumanPath, HumanPathTeacher, cap_lag, choose_k, human_grid, max_seconds, pilot_decision,
    rollout_diagnostics, write_held_episode,
)
from sim_eval.teacher import TeacherState, check_action, execution_mismatch
from sim_worker.homeset import passport

_spec = importlib.util.spec_from_file_location("_toy_distill", Path(__file__).with_name("test_distill.py"))
_toy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_toy)
ToyEnv = _toy.ToyEnv

DOWN_YAW0 = rt._down_turned(np.array([0.0]))[0]


def path_of(points, gripper, demo_id="human_x"):
    t = np.arange(len(points)) * 0.02
    q = np.tile(DOWN_YAW0, (len(points), 1))
    return HumanPath.from_trajectory(demo_id, Trajectory.from_arrays(t, points, q, gripper))


def straight(speed, seconds, start=(0.45, 0.0, 0.35)):
    n = int(round(seconds / 0.02)) + 1
    pts = np.asarray(start) + np.outer(np.arange(n) * 0.02 * speed, [1.0, 0.0, 0.0])
    return pts


def state(k, tcp, yaw=0.0):
    return TeacherState(seed=1, k=k, joint_pos=np.zeros(9), joint_vel=np.zeros(9), tcp_pos=np.asarray(tcp, float),
                        tcp_quat_wxyz=rt._down_turned(np.array([yaw]))[0], gripper=0, cube_pos=np.zeros(3),
                        cube_quat_wxyz=np.array([1.0, 0, 0, 0]), cube_lin_vel=np.zeros(3), bin_pos=np.zeros(3),
                        bin_quat_wxyz=np.array([1.0, 0, 0, 0]), contact_gripper_cube=False)


def test_the_path_slowed_by_k_interpolates_and_holds_its_end():
    p = path_of(straight(0.5, 0.1), [0, 0, 1, 1, 1, 0])
    assert p.steps(1.0) == 6 and p.steps(2.0) == 11
    pos, yaw, g = p.at(3, 2.0)  # human time 0.03 s: halfway between points 1 and 2
    assert pos[0] == pytest.approx(0.45 + 0.015) and yaw == pytest.approx(0.0) and g == 0  # gripper: point 1's
    assert p.at(4, 2.0)[2] == 1
    assert p.at(99, 1.0)[0][0] == pytest.approx(0.50) and p.at(99, 1.0)[2] == 0
    assert p.tilt_deg == pytest.approx(0.0, abs=1e-5)


def test_the_yaw_is_unwrapped_across_pi():
    t = np.arange(3) * 0.02
    q = rt._down_turned(np.array([3.1, -3.1, -3.0]))
    p = HumanPath.from_trajectory("h", Trajectory.from_arrays(t, np.zeros((3, 3)), q, [0, 0, 0]))
    assert np.diff(p.yaw) == pytest.approx([2 * np.pi - 6.2, 0.1], abs=1e-6)


def test_the_cap_lags_a_fast_path_and_slowing_it_removes_the_lag():
    fast = path_of(straight(1.0, 0.4), [0] * 21)  # 1 m/s, twice the cap
    lag1 = cap_lag(fast, 1.0, fast.pos[0], 0.0)
    # 20 steps of 1 cm instead of 2: at the path's end the capped target is 20 cm behind
    assert lag1["max_lag_m"] == pytest.approx(0.20, abs=1e-6)
    assert cap_lag(fast, 2.0, fast.pos[0], 0.0)["max_lag_m"] == pytest.approx(0.0, abs=1e-9)
    assert cap_lag(fast, 1.5, fast.pos[0], 0.0)["max_lag_m"] < 0.2
    # from a tool 3 cm away the first steps catch up at 1 cm per step
    slow = path_of(straight(0.0, 0.1), [0] * 6)
    assert cap_lag(slow, 1.0, slow.pos[0] + [0.03, 0, 0], 0.0)["lag_m"][:3] == pytest.approx([0.02, 0.01, 0.0], abs=1e-9)


def test_the_yaw_lag_is_measured_too():
    t = np.arange(3) * 0.02
    q = rt._down_turned(np.array([0.0, 0.2, 0.4]))  # 10 rad/s, the cap is 2.5 (0.05 per step)
    p = HumanPath.from_trajectory("h", Trajectory.from_arrays(t, np.zeros((3, 3)), q, [0, 0, 0]))
    assert cap_lag(p, 1.0, np.zeros(3), 0.0)["max_yaw_lag_rad"] == pytest.approx(0.3, abs=1e-6)


def test_k_is_the_smallest_choice_whose_95th_percentile_lag_is_within_2_cm():
    lags = {1.0: [0.01] * 90 + [0.05] * 10, 1.25: [0.01] * 95 + [0.05] * 5, 1.5: [0.0] * 100, 2.0: [0.0] * 100}
    assert choose_k(lags) == 1.25
    assert choose_k({1.0: [0.03] * 10, 2.0: [0.021] * 10}) is None
    assert choose_k({1.0: [0.02] * 10}) == 1.0  # at most the limit


def test_the_teacher_caps_from_the_tool_first_then_from_its_own_target_and_holds_the_end():
    p = path_of(straight(1.0, 0.1), [0, 0, 0, 1, 1, 1])
    t = HumanPathTeacher(p, 1.0)
    assert t.name == "held-human-k1" and execution_mismatch(t, "held") is None
    assert execution_mismatch(t, "tracking") is not None
    t.reset(None)
    a0 = check_action(t.act(state(0, [0.45, 0.0, 0.35])))
    assert a0.ee_pos == pytest.approx([0.45, 0.0, 0.35]) and a0.ee_quat_wxyz == pytest.approx(DOWN_YAW0)
    a1 = t.act(state(1, [0.40, 0.0, 0.35]))  # the tool lags; the cap runs from the previous target (0.45), then
    assert a1.ee_pos[0] == pytest.approx(0.40 + rt.DELTA_M)  # within DELTA_M of the tool, as the RL env
    a2 = t.act(state(2, [0.43, 0.0, 0.35]))
    assert a2.ee_pos[0] == pytest.approx(0.42 + 0.01)  # 0.5 m/s from its own previous target
    assert [t.act(state(k, [0.47, 0.0, 0.35])).gripper for k in (3, 50)] == [1, 1]
    t.reset(None)  # a new rollout caps from the tool again
    assert t.act(state(0, [0.30, 0.0, 0.35])).ee_pos[0] == pytest.approx(0.30 + 0.01)


def toy_human_path(scene):
    """What a human might command in the toy: over the cube, down, close, over the bin, open; 0.4 m/s."""
    cube, b = np.asarray(scene.cube_pose.pos, float), np.asarray(scene.bin_pose.pos, float)
    way = [np.array([0.45, 0.0, 0.35]), cube + [0, 0, 0.10], cube, cube, b + [0, 0, 0.12], b + [0, 0, 0.12]]
    pts, grip = [way[0]], [0]
    for i, (a, c) in enumerate(zip(way, way[1:])):
        n = max(2, int(np.ceil(np.linalg.norm(c - a) / 0.008)))
        g = 1 if 2 <= i <= 3 else 0
        for s in range(1, n + 1):
            pts.append(a + (c - a) * s / n)
            grip.append(g)
    pts += [pts[-1]] * 10
    grip += [0] * 10
    return np.asarray(pts), grip


def source_episode(tmp_path, scene, demo_id="human_20261020183738_00ab_rules_home_m3100"):
    pts, grip = toy_human_path(scene)
    src = tmp_path / "store" / demo_id / "episode"
    src.mkdir(parents=True)
    traj = Trajectory.from_arrays(np.arange(len(pts)) * 0.02, pts, np.tile(DOWN_YAW0, (len(pts), 1)), grip)
    (src / "trajectory.json").write_text(traj.model_dump_json())
    from demo_pipeline.schemas import VerificationResult

    v = VerificationResult(success=True, reasons=[], duration=1.0, path_length=1.0, max_contact_force=0.0,
                           settle_time=0.5)
    meta = EpisodeMeta(demo_id=demo_id, robot="franka", task_text="t", fps=50, n_steps=len(pts),
                       cameras=["front", "wrist"],
                       passport=passport(demo_id, ["human_20261020183738_00ab", demo_id], v, variant_seed=3100))
    (src / "episode.json").write_text(meta.model_dump_json())
    return src


def test_a_passing_held_rollout_is_written_as_a_human_episode_with_its_achieved_path(tmp_path):
    scene = sample_scene(np.random.default_rng(3100), "franka", 3100)
    src = source_episode(tmp_path, scene)
    path = HumanPath.from_episode(src)
    teacher = HumanPathTeacher(path, 1.25)
    env = ToyEnv()
    r = rollout(env, scene, teacher, RolloutConfig(driver="teacher", teacher_execution="held",
                                                   max_seconds=max_seconds(path, 1.25)))
    assert r.success and env.teacher_steps == []  # held: every step through env.step, never step_teacher
    row = write_held_episode(tmp_path / "out", r, scene, source=src, k=1.25, teacher_name=teacher.name,
                             extra={"grip_waits": [0, 2]}, save_image=lambda p, img: p.write_bytes(b""))
    ep = Path(row["ep_dir"])
    assert ep.name == "held_human_20261020183738_00ab_rules_home_m3100"
    meta, steps, _ = load_episode(ep)
    assert meta.passport.lineage == ["human_20261020183738_00ab", "human_20261020183738_00ab_rules_home_m3100",
                                     ep.name]
    assert source_of(meta.passport.lineage[0]) == "human" and meta.passport.variant_seed == 3100
    n = len(r.records) - 1  # "after": the last step has no later observation
    assert meta.n_steps == row["n_steps"] == n and sorted(meta.cameras) == ["front", "wrist"]
    assert np.allclose(steps["joint_pos"], r.joint_pos[1:n + 1]) and np.allclose(steps["action"], r.label[:n])
    assert set(np.unique(steps["action"][:, 7:])) <= {0.0, np.float32(0.04)}  # the fingers stay two-valued
    achieved = Trajectory.model_validate_json((ep / "trajectory.json").read_text())
    assert np.allclose(achieved.ee_pos, r.tcp_pos[1:n + 1]) and achieved.gripper == steps["gripper"].tolist()
    assert json.loads((ep / "scene.json").read_text())["seed"] == 3100
    prov = json.loads((ep / "distill.json").read_text())
    assert (prov["kind"], prov["k"], prov["pairing"], prov["teacher_execution"], prov["v_max"]) == (
        "held_human", 1.25, "after", "held", rt.V_MAX)
    assert prov["source_demo_id"] == "human_20261020183738_00ab_rules_home_m3100" and prov["grip_waits"] == [0, 2]
    tnpz = np.load(ep / "teacher.npz")
    assert (tnpz["obs_step"] == tnpz["label_step"] + 1).all()


def test_a_failed_rollout_writes_nothing(tmp_path):
    scene = sample_scene(np.random.default_rng(3101), "franka", 3101)
    src = source_episode(tmp_path, scene)
    path = HumanPath.from_episode(src)
    r = rollout(ToyEnv(), scene, HumanPathTeacher(path, 1.0),
                RolloutConfig(driver="teacher", teacher_execution="held", max_seconds=0.5))
    assert not r.success
    assert write_held_episode(tmp_path / "out", r, scene, source=src, k=1.0, teacher_name="x") is None
    assert not (tmp_path / "out").exists()


def test_the_grid_is_one_valid_cell_of_the_passing_episodes(tmp_path):
    g = human_grid([tmp_path / "a", tmp_path / "b"], n_human=10, name="held_human_mouse20261020")
    grid = Grid.model_validate(g)
    assert grid.cells[0].name == "held_human_10" and len(grid.cells[0].episode_dirs) == 2
    with pytest.raises(ValueError):
        human_grid([], n_human=10, name="x")


def test_the_grasp_wait_pauses_the_path_at_a_gripper_change_until_the_tool_arrives():
    p = path_of(straight(0.25, 0.1), [0, 0, 0, 1, 1, 1])  # 5 mm per step; the human closes at point 3
    t = HumanPathTeacher(p, 1.0, grip_settle_m=0.005, grip_settle_max_s=0.06)  # at most 3 steps
    assert t.name == "held-human-k1-settle5mm"
    acts = [t.act(state(0, [0.45, 0.0, 0.35]))]
    acts += [t.act(state(k, [0.45 + 0.005 * (k - 1), 0.0, 0.35])) for k in (1, 2)]  # the tool one step behind
    assert [a.gripper for a in acts] == [0, 0, 0] and acts[-1].ee_pos[0] == pytest.approx(0.46)
    far = t.act(state(3, [0.452, 0.0, 0.35]))  # 8 mm from the target: wait, the previous target and gripper held
    assert far.gripper == 0 and far.ee_pos[0] == pytest.approx(0.46)
    near = t.act(state(4, [0.457, 0.0, 0.35]))  # within 5 mm: the change runs, the path resumes at point 3
    assert near.gripper == 1 and near.ee_pos[0] == pytest.approx(0.465) and t.waits == [1]
    t2 = HumanPathTeacher(p, 1.0, grip_settle_m=0.005, grip_settle_max_s=0.06)
    for k in range(3):
        t2.act(state(k, [0.45, 0.0, 0.35]))
    stuck = [t2.act(state(k, [0.40, 0.0, 0.35])).gripper for k in range(3, 7)]
    assert stuck == [0, 0, 0, 1] and t2.waits == [3]  # never more than the longest wait
    t2.reset(None)
    assert t2.waits == [] and t2.act(state(0, [0.45, 0.0, 0.35])).gripper == 0


def test_without_the_flag_the_gripper_changes_on_the_humans_clock():
    p = path_of(straight(0.25, 0.1), [0, 0, 0, 1, 1, 1])
    t = HumanPathTeacher(p, 1.0)
    assert [t.act(state(k, [0.30, 0.0, 0.35])).gripper for k in range(5)] == [0, 0, 0, 1, 1] and t.waits == []


def test_the_time_limit_grows_by_the_longest_wait_per_gripper_change():
    p = path_of(straight(0.25, 0.1), [0, 1, 1, 0, 0, 1])
    assert max_seconds(p, 2.0) == pytest.approx(0.2 + 4.0)
    assert max_seconds(p, 2.0, 1.0) == pytest.approx(0.2 + 4.0 + 3 * 1.0)


def test_a_grasp_wait_rollout_still_passes_in_the_toy(tmp_path):
    scene = sample_scene(np.random.default_rng(3102), "franka", 3102)
    path = HumanPath.from_episode(source_episode(tmp_path, scene))
    teacher = HumanPathTeacher(path, 2.0, grip_settle_m=0.005)
    r = rollout(ToyEnv(), scene, teacher, RolloutConfig(driver="teacher", teacher_execution="held",
                                                       max_seconds=max_seconds(path, 2.0, 1.0)))
    assert r.success and teacher.waits == [0, 0]  # the toy's tool is always at its target


def test_the_diagnostics_say_where_a_rollout_touched_what(tmp_path):
    scene = sample_scene(np.random.default_rng(3103), "franka", 3103)
    path = HumanPath.from_episode(source_episode(tmp_path, scene))
    r = rollout(ToyEnv(), scene, HumanPathTeacher(path, 1.0), RolloutConfig(driver="teacher", teacher_execution="held",
                                                                            max_seconds=max_seconds(path, 1.0)))
    d = rollout_diagnostics(r)
    assert (d["first_arm_bin"], d["arm_bin_steps"], d["first_arm_table"]) == (None, 0, None)
    assert d["grip_cube_contact_steps"] > 0 and d["cube_z_max"] > d["cube_z_start"] + 0.05
    assert [c["to"] for c in d["grip_changes"]] == [1, 0]
    assert all(c["tool_target_mm"] < 1e-3 for c in d["grip_changes"])
    assert json.loads(json.dumps(d)) == d  # a jsonl row
    assert rollout_diagnostics(r.__class__(**{**r.__dict__, "records": []})) == {}


def test_the_pilot_continues_only_with_enough_passes_once_every_pilot_episode_ran():
    assert pilot_decision([True] * 16 + [None] * 6, 16) is None
    assert pilot_decision([True] * 16 + [False] * 6, 16) == "continue"
    assert pilot_decision([True] * 15 + [False] * 7, 16) == "stop"


def test_the_diagnostics_only_read_a_finished_rollout(tmp_path):
    """Run 1's code (c799064) and the rerun's give the same commands: diagnostics are computed after the rollout."""
    scene = sample_scene(np.random.default_rng(3104), "franka", 3104)
    path = HumanPath.from_episode(source_episode(tmp_path, scene))
    cfg = RolloutConfig(driver="teacher", teacher_execution="held", max_seconds=max_seconds(path, 2.0))
    a = rollout(ToyEnv(), scene, HumanPathTeacher(path, 2.0), cfg)
    before = (a.teacher_ee.copy(), a.executed.copy(), a.label.copy())
    rollout_diagnostics(a)
    b = rollout(ToyEnv(), scene, HumanPathTeacher(path, 2.0), cfg)
    for x, y in zip(before, (a.teacher_ee, a.executed, a.label)):
        assert np.array_equal(x, y)
    assert np.array_equal(a.teacher_ee, b.teacher_ee) and np.array_equal(a.executed, b.executed)
