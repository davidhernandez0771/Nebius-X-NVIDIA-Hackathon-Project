"""sim_worker.urdf_kin: forward and inverse kinematics on a parsed URDF (numpy only)."""

from __future__ import annotations

import math

import numpy as np
import pytest

import urdf_samples as samples
from sim_worker.urdf_import import parse_urdf
from sim_worker.urdf_kin import Chain, link_pose, matrix_to_quat, quat_to_matrix

ARM = [f"panda_joint{i}" for i in range(1, 8)]
DOWN = np.array([[1.0, 0, 0], [0, -1.0, 0], [0, 0, -1.0]])  # tool +z pointing down (wxyz (0, 1, 0, 0))


@pytest.fixture(scope="module")
def franka():
    return parse_urdf(samples.franka())


def test_franka_zero_pose_puts_the_flange_where_franka_documents_it(franka):
    # at q = 0 the Panda's flange (panda_link8) is at (0.088, 0, 0.926), pointing down
    t = link_pose(franka, "panda_link8", {})
    assert t[:3, 3] == pytest.approx([0.088, 0.0, 0.926], abs=1e-6)
    assert t[:3, :3] @ [0, 0, 1] == pytest.approx([0, 0, -1], abs=1e-6)


def test_link_pose_moves_with_revolute_and_prismatic_joints_and_mimics(franka):
    t0 = link_pose(franka, "panda_link8", {})
    t1 = link_pose(franka, "panda_link8", {"panda_joint1": math.pi / 2})
    assert t1[:3, 3] == pytest.approx([0.0, 0.088, 0.926], abs=1e-6)
    assert t0[:3, 3] != pytest.approx(t1[:3, 3])
    left = link_pose(franka, "panda_leftfinger", {"panda_finger_joint1": 0.03}, top="panda_hand")
    right = link_pose(franka, "panda_rightfinger", {"panda_finger_joint1": 0.03}, top="panda_hand")
    assert left[:3, 3] == pytest.approx([0, 0.03, 0.0584])
    assert right[:3, 3] == pytest.approx([0, -0.03, 0.0584])  # the mimic follows, along its own -y axis


def test_quaternion_round_trip():
    for q in ([1, 0, 0, 0], [0, 1, 0, 0], [math.cos(0.3), 0, 0, math.sin(0.3)], [0.5, 0.5, -0.5, 0.5]):
        assert matrix_to_quat(quat_to_matrix(q)) == pytest.approx(q, abs=1e-12) or \
            matrix_to_quat(quat_to_matrix(q)) == pytest.approx(-np.asarray(q), abs=1e-12)


def test_ik_reaches_a_top_down_pose_inside_the_limits(franka):
    chain = Chain(franka, "panda_link0", "panda_link7", ARM)
    target = np.eye(4)
    target[:3, :3] = DOWN
    target[:3, 3] = [0.5, 0.1, 0.3]
    sol = chain.solve(target, chain.mid())
    assert sol.ok, (sol.pos_err, sol.rot_err)
    assert sol.pos_err < 1e-3 and sol.rot_err < 1e-3
    lo, hi = chain.limits.T
    assert np.all(sol.q >= lo - 1e-12) and np.all(sol.q <= hi + 1e-12)
    assert chain.fk(sol.q)[:3, 3] == pytest.approx([0.5, 0.1, 0.3], abs=1e-3)


def test_ik_says_no_for_a_point_out_of_reach(franka):
    chain = Chain(franka, "panda_link0", "panda_link7", ARM)
    target = np.eye(4)
    target[:3, :3] = DOWN
    target[:3, 3] = [1.5, 0.0, 0.3]
    sol = chain.solve(target, chain.mid())
    assert not sol.ok and sol.pos_err > 0.2


def test_ik_respects_a_narrow_wrist_limit():
    # with panda_joint7 pinned to +-0.05 rad, a top-down pose turned 80 degrees about z is out of reach
    u = parse_urdf(samples.franka(joint7_limits=(-0.05, 0.05)))
    chain = Chain(u, "panda_link0", "panda_link7", ARM)
    yaw = math.radians(80)
    rz = np.array([[math.cos(yaw), -math.sin(yaw), 0], [math.sin(yaw), math.cos(yaw), 0], [0, 0, 1]])
    target = np.eye(4)
    target[:3, :3] = rz @ DOWN
    target[:3, 3] = [0.5, 0.0, 0.3]
    free = Chain(parse_urdf(samples.franka()), "panda_link0", "panda_link7", ARM).solve(target, chain.mid())
    pinned = chain.solve(target, chain.mid())
    assert free.ok
    assert abs(pinned.q[6]) <= 0.05 + 1e-12
    # pinned may still find a pose by turning the other joints; whatever it finds stays inside the limits


def test_chain_rejects_joints_that_are_not_the_path(franka):
    with pytest.raises(ValueError, match="panda_joint4"):
        Chain(franka, "panda_link0", "panda_link7", ARM[:3] + ARM[4:])


def test_real_franka_urdf_zero_pose():
    path = ("C:/isaac/env_isaaclab/Lib/site-packages/isaacsim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/"
            "franka_description/robots/panda_arm_hand.urdf")
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        pytest.skip("Isaac Sim's franka_description is not installed here")
    u = parse_urdf(text)
    assert link_pose(u, "panda_hand", {})[:3, 3] == pytest.approx([0.088, 0.0, 0.926], abs=1e-6)
