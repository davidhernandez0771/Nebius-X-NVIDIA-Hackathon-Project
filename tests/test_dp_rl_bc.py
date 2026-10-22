"""BC data for the RL teacher's actor (demo_pipeline/rl_bc.py) on the recorded fixture episodes."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline import rl_bc
from demo_pipeline import rl_demo_bank as bank_mod
from demo_pipeline import rl_teacher as rt

EPISODES = Path(__file__).parent / "data" / "rl_episodes"
OFF = {}
_o = 0
for _name, _n in rt.OBS_SPEC:
    OFF[_name] = slice(_o, _o + _n)
    _o += _n


def _load(name):
    d = EPISODES / name
    s, g = dict(np.load(d / "steps.npz")), dict(np.load(d / "signals.npz"))
    return s, g, json.loads((d / "scene.json").read_text())


def _pairs(name, lead=1):
    """Targets: the reached pose `lead` steps on (the fixtures keep no trajectory.json)."""
    s, g, scene = _load(name)
    n = len(s["gripper"])
    idx = np.minimum(np.arange(n) + lead - 1, n - 1)
    return s, g, scene, rl_bc.episode_pairs(s, g, scene, s["ee_pos"][idx], s["ee_quat"][idx], s["gripper"])


def test_pairs_follow_the_replays_step_convention():
    s, g, scene, (obs, act) = _pairs("verified", lead=2)
    n = len(s["gripper"])
    assert obs.shape == (n, rt.OBS_DIM) and act.shape == (n, rt.ACTION_DIM)
    assert np.all(np.abs(act) <= 1.0)
    # the observation before step k is the reached state k-1; its previous action is step k-1's
    k = 100
    assert np.allclose(obs[k, OFF["tcp_pos"]], s["ee_pos"][k - 1])
    assert np.allclose(obs[k, OFF["cube_pos"]], g["cube_pos"][k - 1])
    assert np.allclose(obs[k, OFF["actions"]], act[k - 1]) and np.allclose(obs[0, OFF["actions"]], 0)
    assert np.allclose(obs[k, OFF["joint_vel"]], (s["joint_pos"][k - 1] - s["joint_pos"][k - 2]) / rt.STEP_S)
    assert np.allclose(obs[1, OFF["joint_vel"]], 0)  # an episode starts at rest
    # the gripper is +-1 as the target says
    assert np.array_equal(act[:, 4] < 0, s["gripper"].astype(int) == 1)


def test_the_action_steps_the_env_from_the_state_to_the_target():
    s, _, _, (obs, act) = _pairs("verified", lead=1)
    ok = np.all(np.abs(act[:, :4]) < 1.0, axis=1)
    for k in np.flatnonzero(ok)[1:200:7]:
        tcp, yaw = s["ee_pos"][k - 1], float(rt.tool_yaw(s["ee_quat"][k - 1]))
        target, quat, closed = rt.action_to_target(act[k][None], tcp[None], np.array([yaw]))
        assert np.allclose(target[0], s["ee_pos"][k], atol=1e-6)  # lead 1: target k is reached state k
        assert bool(closed[0]) == bool(s["gripper"][k])
        assert abs(rt.tool_yaw(quat[0]) - rt.tool_yaw(s["ee_quat"][k])) < 1e-6 or \
            abs(abs(rt.tool_yaw(quat[0]) - rt.tool_yaw(s["ee_quat"][k])) - 2 * np.pi) < 1e-6


def test_the_cube_turns_with_the_hand_as_the_bank_says():
    s, g, scene = _load("verified")
    cq = rl_bc.cube_quats(s["ee_quat"], s["gripper"], scene["cube_pose"]["quat_wxyz"])
    bank = bank_mod.episode_states(s, g, scene, stride=1)
    for k, q in zip(bank["step"], bank["cube_quat_wxyz"]):
        assert np.allclose(cq[k], q, atol=1e-6) or np.allclose(cq[k], -q, atol=1e-6)
    first_close = int(np.flatnonzero(s["gripper"] == 1)[0])
    assert np.allclose(cq[:first_close], scene["cube_pose"]["quat_wxyz"])


def test_yaw_steps_wrap_round_pi():
    s, g, scene = _load("verified")
    n = len(s["gripper"])
    # a target turned 0.05 rad past +pi from a tool at +pi - 0.02: one small step, not a full turn
    yaw = np.pi - 0.02
    q = np.array([0.0, np.cos(yaw / 2), np.sin(yaw / 2), 0.0])  # pointing down, heading yaw (rt.tool_yaw)
    assert rt.tool_yaw(q) == pytest.approx(yaw)
    ee_quat = np.tile(q, (n, 1))
    t_yaw = yaw + 0.05
    tq = np.tile([0.0, np.cos(t_yaw / 2), np.sin(t_yaw / 2), 0.0], (n, 1))
    _, act = rl_bc.episode_pairs({**s, "ee_quat": ee_quat}, g, scene, s["ee_pos"], tq, s["gripper"])
    assert np.allclose(act[5:, 3], 0.05 / rt.DELTA_YAW, atol=1e-6)
