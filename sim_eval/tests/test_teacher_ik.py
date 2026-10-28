"""sim_eval.teacher_ik: the RL teacher's tracking (Isaac Lab's absolute DLS IK on the tool frame + SANT's velocity
feed-forward) in numpy, checked on a small spatial arm against finite differences."""

from __future__ import annotations

import math

import numpy as np
import pytest

from sim_eval.teacher_ik import (
    LAMBDA, TeacherTracker, axis_angle_from_quat, dls, feedforward, ik_target, pose_error, quat_mul, quat_rotate,
    tool_jacobian, tool_pose,
)

OFFSET = np.array([0.0, 0.0, 0.1034])  # Franka panda_hand -> fingertip centre


def qz(a):
    return np.array([math.cos(a / 2), 0.0, 0.0, math.sin(a / 2)])


def qy(a):
    return np.array([math.cos(a / 2), 0.0, math.sin(a / 2), 0.0])


def fk(q):
    """A 3-joint spatial arm: yaw at the base, then two pitch joints with 0.4 m and 0.3 m links; the hand points along
    its own z axis (turned down by a fixed pitch), so the tool offset is not along a link."""
    rot = quat_mul(qz(q[0]), qy(q[1]))
    p = np.array([0.0, 0.0, 0.3]) + quat_rotate(rot, [0.4, 0.0, 0.0])
    rot = quat_mul(rot, qy(q[2]))
    p = p + quat_rotate(rot, [0.3, 0.0, 0.0])
    return p, quat_mul(rot, qy(math.pi / 2))


def numeric_jacobian(f, q, h=1e-6):
    """Geometric Jacobian [6, J] of the frame f(q) -> (pos, quat) by central differences."""
    cols = []
    for i in range(len(q)):
        dq = np.zeros(len(q))
        dq[i] = h
        (p1, r1), (p0, r0) = f(q + dq), f(q - dq)
        w = axis_angle_from_quat(quat_mul(r1, np.array([r0[0], *-r0[1:]])))
        cols.append(np.r_[(p1 - p0) / (2 * h), w / (2 * h)])
    return np.array(cols).T


def tool_fk(q):
    return tool_pose(*fk(q), OFFSET)


Q0 = np.array([0.3, -0.4, 0.9])


def test_pose_error_is_isaac_labs_axis_angle():
    err = pose_error(np.zeros(3), np.array([1.0, 0, 0, 0]), [0.1, 0.0, -0.2], qz(math.pi / 2))
    assert np.allclose(err, [0.1, 0.0, -0.2, 0.0, 0.0, math.pi / 2])
    assert np.allclose(pose_error(np.zeros(3), qz(0.2), np.zeros(3), -qz(0.5)), [0, 0, 0, 0, 0, 0.3])  # same rotation
    assert np.allclose(axis_angle_from_quat([1.0, 0, 0, 0]), 0.0)


def test_tool_jacobian_matches_finite_differences_of_the_tool_point():
    j_hand = numeric_jacobian(fk, Q0)
    _, hand_q = fk(Q0)
    assert np.allclose(tool_jacobian(j_hand, hand_q, OFFSET), numeric_jacobian(tool_fk, Q0), atol=1e-6)
    assert not np.allclose(j_hand[:3], numeric_jacobian(tool_fk, Q0)[:3], atol=1e-3)  # the offset matters


def test_dls_is_the_damped_pseudo_inverse():
    j = np.random.default_rng(0).normal(size=(6, 7))
    e = np.arange(6.0)
    want = j.T @ np.linalg.inv(j @ j.T + LAMBDA**2 * np.eye(6)) @ e
    assert np.allclose(dls(j, e), want)


def test_repeated_ik_steps_reach_a_reachable_tool_pose():
    """Once per physics substep the arm target is one DLS step from the current joints; repeated, it converges."""
    goal_pos, goal_q = tool_fk(np.array([0.5, -0.2, 0.7]))
    goal_pos = goal_pos  # a 3-joint arm can't hold every orientation: track the position, keep its own pose error
    q = Q0.copy()
    errs = []
    for _ in range(30):
        pos, quat = tool_fk(q)
        j = tool_jacobian(numeric_jacobian(fk, q), fk(q)[1], OFFSET)
        q = ik_target(q, j, pos, quat, goal_pos, goal_q)
        errs.append(float(np.linalg.norm(tool_fk(q)[0] - goal_pos)))
    assert errs[-1] < 1e-4 and errs[-1] < errs[0] / 100


def test_feedforward_clamps_jumps_and_passes_smooth_moves():
    j = np.eye(6)
    q0 = np.array([1.0, 0, 0, 0])
    smooth = feedforward(np.zeros(3), q0, [0.01, 0.0, 0.0], q0, j)  # 1 cm in 20 ms = 0.5 m/s
    assert np.allclose(smooth[:3], [0.5, 0.0, 0.0], atol=1e-3) and np.allclose(smooth[3:], 0.0)
    jump = feedforward(np.zeros(3), q0, [0.1, 0.0, 0.0], q0, j)  # 5 m/s -> 1 m/s
    assert np.allclose(jump[:3], [1.0, 0.0, 0.0], atol=1e-3)
    spin = feedforward(np.zeros(3), q0, np.zeros(3), qz(1.0), j)  # 50 rad/s -> 3 rad/s
    assert np.allclose(spin[3:], [0.0, 0.0, 3.0], atol=1e-3)


def test_tracker_has_no_feedforward_after_a_reset():
    t, j, q = TeacherTracker(), np.eye(6), np.array([1.0, 0, 0, 0])
    assert np.allclose(t.command([0.0, 0, 0], q, j), 0.0)
    assert t.command([0.01, 0, 0], q, j)[0] == pytest.approx(0.5, abs=1e-3)
    t.reset()
    assert np.allclose(t.command([0.5, 0, 0], q, j), 0.0)
