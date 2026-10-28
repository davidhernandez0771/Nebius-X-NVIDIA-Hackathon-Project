"""sim_worker.urdf_import.build_spec: from a URDF + roles to the RobotSpec the sim uses (tool point, gripper values,
IK link, start pose), and mesh reading for the tool point."""

from __future__ import annotations

import math
import struct

import numpy as np
import pytest

import urdf_samples as samples
from sim_worker.robots import hand_from_tool, robot_spec, tool_from_hand
from sim_worker.urdf_import import Roles, build_spec, mesh_vertices, parse_urdf, suggest_roles
from sim_worker.urdf_kin import link_pose, matrix_to_quat

FRANKA_ARM = [f"panda_joint{i}" for i in range(1, 8)]
FRANKA_ROLES = Roles(base="panda_link0", arm_joints=FRANKA_ARM, hand="panda_hand",
                     gripper_joints=["panda_finger_joint1", "panda_finger_joint2"])
SO101_ROLES = Roles(base="base_link", arm_joints=["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex",
                                                  "wrist_roll"], hand="gripper_link", gripper_joints=["gripper"])


@pytest.fixture(scope="module")
def franka():
    return build_spec(parse_urdf(samples.franka()), FRANKA_ROLES, "byor_0123456789")


def test_franka_tool_point_comes_from_the_finger_geometry(franka):
    tcp = franka.derived["tcp"]
    assert tcp["link"] == "panda_hand"
    assert tcp["offset"] == pytest.approx([0.0, 0.0, 0.1034], abs=2e-4)  # Isaac Lab's FRANKA tcp (robots.py)
    assert tcp["approach_axis"] == [0, 0, 1]
    assert "finger geometry" in tcp["source"]
    assert not [i for i in franka.issues if i.code == "tcp_estimated"]


def test_franka_hand_is_merged_into_link7_and_the_tool_frame_moves_with_it(franka):
    spec = franka.spec
    assert spec.name == "byor_0123456789" and spec.hand_body == "panda_link7"
    assert spec.tcp_offset == pytest.approx((0.0, 0.0, 0.107 + 0.1034), abs=2e-4)
    # panda_hand is turned -45 degrees about z from link7: link7 sits at +45 degrees in the tool frame
    assert spec.hand_in_tool_wxyz == pytest.approx((math.cos(math.pi / 8), 0, 0, math.sin(math.pi / 8)), abs=1e-6)
    assert "merge" in franka.sources["ik_link"]


def test_the_spec_maps_the_tool_onto_the_same_point_as_the_builtin_franka(franka):
    u = parse_urdf(samples.franka())
    q = {n: v for n, v in zip(FRANKA_ARM, (0.1, -0.5, 0.2, -2.0, 0.1, 1.8, 0.4))}
    link7 = link_pose(u, "panda_link7", q)
    hand = link_pose(u, "panda_hand", q)
    tool_new = tool_from_hand(franka.spec, link7[:3, 3], matrix_to_quat(link7[:3, :3]))
    tool_old = tool_from_hand(robot_spec("franka"), hand[:3, 3], matrix_to_quat(hand[:3, :3]))
    assert tool_new[0] == pytest.approx(tool_old[0], abs=2e-4)
    assert abs(float(np.dot(tool_new[1], tool_old[1]))) == pytest.approx(1.0, abs=1e-9)
    back_pos, back_q = hand_from_tool(franka.spec, *tool_new)
    assert back_pos == pytest.approx(link7[:3, 3], abs=1e-9)


def test_franka_gripper_values_and_driven_joints(franka):
    spec = franka.spec
    assert spec.finger_joints == ("panda_finger_joint1",)
    assert spec.passive_finger_joints == ("panda_finger_joint2",)
    assert (spec.gripper_open, spec.gripper_closed) == (0.04, 0.0)
    assert "farther" in franka.derived["gripper"]["source"]


def test_franka_spec_lists_the_bodies_for_contacts(franka):
    spec = franka.spec
    assert spec.finger_links == ("panda_leftfinger", "panda_rightfinger")
    assert spec.arm_links == tuple(f"panda_link{i}" for i in range(1, 8)) + ("panda_leftfinger", "panda_rightfinger")
    assert spec.arm_joints == "|".join(FRANKA_ARM)


def test_franka_start_pose_is_solved_above_the_workspace(franka):
    start = franka.spec.init_joint_pos
    assert set(start) == set(FRANKA_ARM) | {"panda_finger_joint1", "panda_finger_joint2"}
    assert start["panda_finger_joint1"] == 0.04
    assert "residual" in franka.sources["start_joint_pos"]
    assert not [i for i in franka.issues if i.code == "start_pose_unsolved"]
    u = parse_urdf(samples.franka())
    link7 = link_pose(u, "panda_link7", start)
    tool, q = tool_from_hand(franka.spec, link7[:3, 3], matrix_to_quat(link7[:3, :3]))
    assert tool == pytest.approx([0.45, 0.0, 0.35], abs=0.005)


def test_overrides_win_and_are_named(franka):
    roles = Roles(**{**FRANKA_ROLES.model_dump(), "tcp_offset": (0.0, 0.0, 0.1), "gripper_open": 0.03,
                     "gripper_closed": 0.001, "mount": {"pos": (0.1, 0.0, 0.0)},
                     "start_joint_pos": {"panda_joint4": -2.0}})
    r = build_spec(parse_urdf(samples.franka()), roles, "byor_0123456789")
    assert r.spec.tcp_offset == pytest.approx((0.0, 0.0, 0.207))
    assert (r.spec.gripper_open, r.spec.gripper_closed) == (0.03, 0.001)
    assert r.spec.base_pos == (0.1, 0.0, 0.0)
    # joints left out of start_joint_pos start at 0, clipped to their limits
    assert r.spec.init_joint_pos["panda_joint4"] == -2.0 and r.spec.init_joint_pos["panda_joint1"] == 0.0
    assert r.spec.init_joint_pos["panda_joint6"] == 0.0 and r.spec.init_joint_pos["panda_finger_joint1"] == 0.03
    assert all("roles" in r.sources[k] for k in ("tcp_offset", "gripper", "start_joint_pos"))


def test_so101_tool_point_is_its_gripper_frame_link_and_the_jaw_opens_away_from_it():
    r = build_spec(parse_urdf(samples.so101()), SO101_ROLES, "byor_aaaaaaaaaa")
    assert r.derived["tcp"]["offset"] == pytest.approx([0.07, 0.0, 0.0])
    assert r.derived["tcp"]["approach_axis"] == [1, 0, 0]
    assert "gripper_frame_link" in r.derived["tcp"]["source"]
    assert r.spec.hand_body == "gripper_link"
    assert (r.spec.gripper_open, r.spec.gripper_closed) == (1.7453, -0.1745)
    assert r.spec.finger_joints == ("gripper",) and r.spec.passive_finger_joints == ()


def test_so101_without_a_tcp_link_estimates_from_the_jaw_and_warns():
    r = build_spec(parse_urdf(samples.so101(with_tcp_link=False)), SO101_ROLES, "byor_aaaaaaaaaa")
    assert "tcp_estimated" in [i.code for i in r.issues if i.severity == "warning"]
    assert r.derived["tcp"]["approach_axis"] == [1, 0, 0]


def test_build_spec_refuses_invalid_roles():
    with pytest.raises(ValueError, match="arm_too_short"):
        build_spec(parse_urdf(samples.franka()), FRANKA_ROLES.model_copy(update={"arm_joints": FRANKA_ARM[:3]}),
                   "byor_0123456789")


def test_mesh_geometry_is_read_through_the_loader():
    text = samples.franka().replace('<box size="0.02 0.02 0.054"/>', '<mesh filename="package://fd/finger.stl"/>')
    seen = []

    def loader(name):
        seen.append(name)
        return np.array([[0.0, 0.0, -0.027], [0.01, 0.02, 0.027]])  # at the box's origin: tip 0.054 m out

    r = build_spec(parse_urdf(text), FRANKA_ROLES, "byor_0123456789", mesh_loader=loader)
    assert "package://fd/finger.stl" in seen
    assert r.derived["tcp"]["offset"][2] == pytest.approx(0.1034, abs=2e-4)


def test_binary_and_ascii_stl_and_obj_vertices(tmp_path):
    tri = [(0, 0, 0), (1, 0, 0), (0, 2, 3)]
    binary = b"x" * 80 + struct.pack("<I", 1) + struct.pack("<12fH", 0, 0, 1, *[c for v in tri for c in v], 0)
    (tmp_path / "a.stl").write_bytes(binary)
    (tmp_path / "b.stl").write_text("solid s\nfacet normal 0 0 1\nouter loop\n" +
                                    "".join(f"vertex {x} {y} {z}\n" for x, y, z in tri) + "endloop\nendfacet\nendsolid s\n")
    (tmp_path / "c.obj").write_text("# x\nv 0 0 0\nv 1 0 0\nv 0 2 3\nf 1 2 3\n")
    for name in ("a.stl", "b.stl", "c.obj"):
        v = mesh_vertices(tmp_path / name)
        assert v.min(axis=0) == pytest.approx([0, 0, 0]) and v.max(axis=0) == pytest.approx([1, 2, 3]), name


def test_dae_vertices_use_the_unit(tmp_path):
    (tmp_path / "d.dae").write_text(
        '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema"><asset><unit meter="0.001"/></asset>'
        '<library_geometries><geometry><mesh><source id="p"><float_array count="6">0 0 0 1000 2000 3000'
        '</float_array></source><vertices id="v"><input semantic="POSITION" source="#p"/></vertices></mesh>'
        '</geometry></library_geometries></COLLADA>')
    v = mesh_vertices(tmp_path / "d.dae")
    assert v.max(axis=0) == pytest.approx([1, 2, 3])


def test_real_franka_urdf_with_its_meshes():
    root = ("C:/isaac/env_isaaclab/Lib/site-packages/isaacsim/exts/isaacsim.asset.importer.urdf/data/urdf/robots/"
            "franka_description/")
    try:
        text = open(root + "robots/panda_arm_hand.urdf", encoding="utf-8").read()
    except OSError:
        pytest.skip("Isaac Sim's franka_description is not installed here")
    u = parse_urdf(text)
    s = suggest_roles(u)
    roles = Roles(**s.roles)

    def loader(name):
        return mesh_vertices(root + name.removeprefix("package://franka_description/"))

    r = build_spec(u, roles, "byor_0123456789", mesh_loader=loader)
    assert r.derived["tcp"]["offset"] == pytest.approx([0.0, 0.0, 0.1034], abs=5e-4)
    assert r.spec.hand_body == "panda_link7"
    assert (r.spec.gripper_open, r.spec.gripper_closed) == (0.04, 0.0)


def test_the_spec_lists_the_arm_joints_by_name(franka):
    assert franka.spec.arm_joint_names == tuple(FRANKA_ARM) and franka.spec.usd_dir is None
