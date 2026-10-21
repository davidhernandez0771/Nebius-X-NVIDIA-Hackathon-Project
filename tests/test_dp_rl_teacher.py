"""The RL teacher's reward and action space (demo_pipeline.rl_teacher), on recorded SANT episodes, without Isaac."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline import rl_teacher as rt
from demo_pipeline.schemas import Pose, SimSignals, Trajectory
from demo_pipeline.success import check_success

EPISODES = Path(__file__).parent / "data" / "rl_episodes"  # copied read-only from C:\dev\pm-t6\data\human_exp


def _load(name: str):
    d = EPISODES / name
    s, g = np.load(d / "steps.npz"), np.load(d / "signals.npz")
    scene = json.loads((d / "scene.json").read_text())
    return s, g, scene, json.loads((d / "verification.json").read_text())


def _states(name: str):
    s, g, scene, _ = _load(name)
    return rt.episode_states(s["ee_pos"], g["cube_pos"], s["gripper"], g["contact_gripper_cube"], g["contact_arm_bin"],
                             g["contact_arm_table"], g["max_contact_force"], scene["bin_pose"]["pos"],
                             scene["bin_pose"]["quat_wxyz"])


def test_a_verified_episode_scores_high_and_failed_ones_low():
    good = rt.episode_return(_states("verified"))
    assert good["success_bonus_at"] is not None and not good["fouled"]
    assert good["return"] > rt.SUCCESS_BONUS
    hit = rt.episode_return(_states("collision"))  # placed the cube, but pushed the arm into the bin (94 N)
    assert hit["success_bonus_at"] is None and hit["fouled"] and hit["events"]["collision"] > 0
    drop = rt.episode_return(_states("dropped"))
    assert drop["success_bonus_at"] is None and drop["events"]["dropped"] >= 1
    assert good["return"] > 10 * max(hit["return"], drop["return"], 1.0)


@pytest.mark.parametrize("name", ["verified", "collision", "dropped"])
def test_the_bonus_is_paid_exactly_when_check_success_passes(name):
    s, g, scene, verdict = _load(name)
    n = len(s["gripper"])
    traj = Trajectory.from_arrays(np.arange(n) * rt.STEP_S, s["ee_pos"], s["ee_quat"], s["gripper"])
    sim = SimSignals(cube_pos=g["cube_pos"], contact_gripper_cube=g["contact_gripper_cube"],
                     contact_arm_bin=g["contact_arm_bin"], contact_arm_table=g["contact_arm_table"],
                     max_contact_force=g["max_contact_force"])
    v = check_success(traj, sim, Pose(**scene["bin_pose"]))
    assert v.success == verdict["success"]  # the fixture is what SANT said
    assert (rt.episode_return(_states(name))["success_bonus_at"] is not None) == v.success


def test_progress_is_a_potential_so_hovering_earns_nothing():
    states = _states("verified")
    # hold the episode at its best carry step for 500 steps: a level reward would pile up, a potential pays once
    fine = [float(rt.reward_terms(s, states[i - 1] if i else None)["carry_fine"][0]) for i, s in enumerate(states)]
    k = int(np.argmax(fine))
    held = states[: k + 1] + [states[k]] * 500
    once = rt.episode_return(states[: k + 1])["return"]
    assert rt.episode_return(held)["return"] == pytest.approx(once, abs=1e-6)
    # and letting go in the bin is worth more than any held stage
    held = ("reach", "centred_grasp", "lifted", "carry", "carry_fine", "rim_clear", "low_over_bin")
    assert rt.POTENTIAL["placed"] > sum(rt.POTENTIAL[t] for t in held)


def test_a_demo_start_mid_task_earns_nothing_for_where_it_starts():
    states = _states("verified")
    mid = len(states) // 2
    tail = rt.episode_return(states[mid:])
    whole = rt.episode_return(states)
    assert whole["return"] - tail["return"] == pytest.approx(
        float(rt.potential(rt.reward_terms(states[mid], states[mid - 1]))[0]) -
        float(rt.potential(rt.reward_terms(states[0]))[0]), abs=1e-6)


def test_terms_on_hand_made_states():
    def st(tcp, cube, closed, contact, cube_b=(0.3, 0.3, 0.025), speed=0.0, arm_force=0.0):
        a = lambda v: np.asarray([v], dtype=np.float64)  # noqa: E731
        return rt.StepState(tcp=a(tcp), cube=a(cube), cube_speed=a(speed), cube_in_bin=a(cube_b),
                            closed=np.array([closed]), finger_contact=np.array([contact]),
                            arm_contact=np.array([arm_force > rt.CONTACT_N]), arm_force=a(arm_force))
    rest = (0.5, 0.0, 0.025)
    t = rt.reward_terms(st(rest, rest, True, True))
    assert t["reach"][0] == pytest.approx(1.0) and t["centred_grasp"][0] == pytest.approx(1.0) and t["lifted"][0] == 0
    up = (0.5, 0.0, 0.025 + rt.LIFT_M + 0.001)
    assert rt.reward_terms(st(up, up, True, True))["lifted"][0] == 1
    assert rt.reward_terms(st(up, up, False, True))["lifted"][0] == 0  # open fingers don't hold it
    placed = st((0.5, 0.3, 0.2), (0.5, 0.3, 0.03), False, False, cube_b=(0.0, 0.0, 0.035))
    assert rt.reward_terms(placed)["placed"][0] == 1
    assert rt.reward_terms(placed._replace(cube_speed=np.array([0.05])))["placed"][0] == 0  # not settled
    assert rt.reward_terms(st(rest, rest, False, False, arm_force=6.0))["collision"][0] == 1
    assert rt.reward_terms(st(rest, rest, False, False, arm_force=4.9))["collision"][0] == 0
    # a high release: open over the bin with the cube's centre above 0.18 m (bin frame)
    high_prev = st((0.5, 0.3, 0.3), (0.5, 0.3, 0.25), True, True, cube_b=(0.0, 0.0, 0.25))
    high_now = st((0.5, 0.3, 0.3), (0.5, 0.3, 0.25), False, True, cube_b=(0.0, 0.0, 0.25))
    assert rt.reward_terms(high_now, high_prev)["high_release"][0] == 1
    low_prev = high_prev._replace(cube_in_bin=np.array([[0.0, 0.0, 0.12]]))
    low_now = high_now._replace(cube_in_bin=np.array([[0.0, 0.0, 0.12]]))
    assert rt.reward_terms(low_now, low_prev)["high_release"][0] == 0
    # a drop outside the bin, with the gripper still closed
    lost = st(up, up, True, False)
    assert rt.reward_terms(lost, st(up, up, True, True))["dropped"][0] == 1


def test_the_action_maps_to_sant_tool_targets_and_back():
    a = np.array([[-1, -1, -1, 0, 1], [1, 1, 1, 0, -1], [0, 0, 0, 0.5, -0.2], [3, -3, 0, -9, 0.1]], dtype=np.float64)
    pos, quat, closed = rt.action_to_target(a)
    np.testing.assert_allclose(pos[0], [0.20, -0.45, 0.01])
    np.testing.assert_allclose(pos[1], [0.80, 0.45, 0.50])
    np.testing.assert_allclose(pos[3], [0.80, -0.45, 0.255])  # clipped
    np.testing.assert_allclose(quat[0], rt.DOWN_WXYZ, atol=1e-12)  # no yaw: SANT's pointing-down gripper
    assert closed.tolist() == [False, True, True, False]
    # a yaw of 0.5 * YAW_MAX (45 degrees) is the down gripper turned 45 degrees about the vertical
    yaw = 0.5 * rt.YAW_MAX
    want = np.array([0.0, math.cos(yaw / 2), math.sin(yaw / 2), 0.0])  # sim_worker.scripted._down_with_yaw
    np.testing.assert_allclose(quat[2], want, atol=1e-12)
    np.testing.assert_allclose(np.linalg.norm(quat, axis=1), 1.0)
    back = rt.target_to_action(pos[:3], [0.0, 0.0, yaw], closed[:3])
    np.testing.assert_allclose(back[:, :4], a[:3, :4], atol=1e-12)
    assert (back[:, 4] < 0).tolist() == closed[:3].tolist()


def test_the_same_functions_run_on_torch():
    torch = pytest.importorskip("torch")  # Isaac Lab's Python; the SANT venv has no torch
    states = _states("verified")
    for k in (0, 50, 150, 300):
        prev = states[k - 1] if k else None
        np_terms = rt.reward_terms(states[k], prev)
        to_t = lambda s: rt.StepState(*(torch.as_tensor(np.asarray(v)) for v in s))  # noqa: E731
        t_terms = rt.reward_terms(to_t(states[k]), to_t(prev) if prev else None)
        for name, v in np_terms.items():
            assert float(t_terms[name][0]) == pytest.approx(float(v[0]), abs=1e-6), name
    a = np.array([[0.2, -0.4, 0.6, 0.3, -0.5]])
    p_np, q_np, c_np = rt.action_to_target(a)
    p_t, q_t, c_t = rt.action_to_target(torch.as_tensor(a))
    np.testing.assert_allclose(p_t.numpy(), p_np, atol=1e-6)
    np.testing.assert_allclose(q_t.numpy(), q_np, atol=1e-6)
    assert c_t.tolist() == c_np.tolist()
