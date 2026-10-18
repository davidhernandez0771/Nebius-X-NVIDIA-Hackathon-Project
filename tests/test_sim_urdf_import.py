"""sim_worker.urdf_import: parse a URDF, suggest roles, validate them (pure Python)."""

from __future__ import annotations

import pytest

import urdf_samples as samples
from sim_worker.urdf_import import Roles, UrdfError, parse_urdf, suggest_roles, validate_roles

FRANKA_ARM = [f"panda_joint{i}" for i in range(1, 8)]
FRANKA_ROLES = Roles(base="panda_link0", arm_joints=FRANKA_ARM, hand="panda_hand",
                     gripper_joints=["panda_finger_joint1", "panda_finger_joint2"])


def codes(issues, severity=None):
    return [i.code for i in issues if severity is None or i.severity == severity]


# --- parse -------------------------------------------------------------------------------------------------------

def test_parse_reads_links_joints_limits_axes_and_mimic():
    u = parse_urdf(samples.franka())
    assert u.name == "panda"
    assert list(u.links)[:2] == ["panda_link0", "panda_link1"]
    assert len(u.links) == 12 and len(u.joints) == 11
    j4 = u.joints["panda_joint4"]
    assert (j4.type, j4.parent, j4.child) == ("revolute", "panda_link3", "panda_link4")
    assert j4.origin.xyz == (0.0825, 0.0, 0.0)
    assert j4.origin.rpy == pytest.approx((1.57079632679, 0.0, 0.0))
    assert (j4.limits.lower, j4.limits.upper, j4.limits.effort, j4.limits.velocity) == (-3.0718, -0.0698, 87.0, 2.175)
    f2 = u.joints["panda_finger_joint2"]
    assert f2.axis == (0.0, -1.0, 0.0)
    assert (f2.mimic.joint, f2.mimic.multiplier, f2.mimic.offset) == ("panda_finger_joint1", 1.0, 0.0)
    assert u.joints["panda_joint8"].type == "fixed" and u.joints["panda_joint8"].limits is None
    assert u.root == "panda_link0"
    assert u.child_joints("panda_hand") == ["panda_finger_joint1", "panda_finger_joint2"]
    assert u.parent_joint("panda_link0") is None
    assert u.links["panda_link8"].collisions == () and u.links["panda_hand"].collisions[0].kind == "box"


def test_parse_reads_axis_default_and_mesh_geometry():
    u = parse_urdf('<robot name="r"><link name="a"><visual><geometry><mesh filename="package://p/m.stl" '
                   'scale="0.001 0.001 0.001"/></geometry></visual></link><link name="b"/>'
                   '<joint name="j" type="continuous"><parent link="a"/><child link="b"/></joint></robot>')
    assert u.joints["j"].axis == (1.0, 0.0, 0.0)  # URDF default
    assert u.joints["j"].origin.xyz == (0.0, 0.0, 0.0)
    g = u.links["a"].visuals[0]
    assert (g.kind, g.filename, g.scale) == ("mesh", "package://p/m.stl", (0.001, 0.001, 0.001))


@pytest.mark.parametrize("text, code, words", [
    ("<robot name='r'><link name='a'>", "urdf_parse", "XML"),
    ("<notrobot/>", "urdf_parse", "<robot>"),
    ("<robot name='r'><link name='a'/><joint name='j' type='fixed'><child link='a'/></joint></robot>", "urdf_parse", "parent"),
    ("<robot name='r'><link name='a'/><joint name='j' type='fixed'><parent link='a'/><child link='zz'/></joint></robot>",
     "urdf_parse", "zz"),
    ("<robot name='r'><link name='a'/><joint name='j' type='hinge'><parent link='a'/><child link='a'/></joint></robot>",
     "urdf_parse", "hinge"),
    ("<robot name='r'><link name='a'/><link name='b'/></robot>", "multiple_roots", "a, b"),
    ("<robot name='r'><link name='a'/><link name='b'/>"
     "<joint name='j1' type='fixed'><parent link='a'/><child link='b'/></joint>"
     "<joint name='j2' type='fixed'><parent link='b'/><child link='a'/></joint></robot>", "cycle", ""),
    ('<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="r"><xacro:include filename="x.xacro"/></robot>',
     "xacro", "xacro"),
])
def test_parse_errors_name_the_problem(text, code, words):
    with pytest.raises(UrdfError) as e:
        parse_urdf(text)
    assert e.value.issue.code == code and e.value.issue.severity == "error"
    assert words in e.value.issue.message


def test_xacro_output_with_the_xacro_namespace_still_parses():
    text = samples.franka().replace('<robot name="panda">', '<robot name="panda" xmlns:xacro="http://www.ros.org/wiki/xacro">')
    assert parse_urdf(text).name == "panda"


def test_a_link_with_two_parents_is_an_error():
    text = ("<robot name='r'><link name='a'/><link name='b'/><link name='c'/>"
            "<joint name='j1' type='fixed'><parent link='a'/><child link='c'/></joint>"
            "<joint name='j2' type='fixed'><parent link='b'/><child link='c'/></joint></robot>")
    with pytest.raises(UrdfError) as e:
        parse_urdf(text)
    assert e.value.issue.code == "urdf_parse" and "c" in e.value.issue.message and "two parent" in e.value.issue.message


# --- suggest -----------------------------------------------------------------------------------------------------

def test_suggests_franka_roles():
    s = suggest_roles(parse_urdf(samples.franka()))
    assert s.roles == {"base": "panda_link0", "arm_joints": FRANKA_ARM, "hand": "panda_hand",
                       "gripper_joints": ["panda_finger_joint1", "panda_finger_joint2"]}
    assert codes(s.issues, "error") == []
    assert set(s.why) == {"base", "arm_joints", "hand", "gripper_joints"}
    assert "7" in s.why["arm_joints"] and "mimic" in s.why["gripper_joints"]


def test_a_trailing_revolute_jaw_goes_to_the_gripper():
    s = suggest_roles(parse_urdf(samples.so101()))
    assert s.roles["arm_joints"] == ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll"]
    assert s.roles["hand"] == "gripper_link"
    assert s.roles["gripper_joints"] == ["gripper"]
    assert codes(s.issues, "error") == []


def test_a_geometryless_world_root_is_skipped():
    s = suggest_roles(parse_urdf(samples.with_world_root(samples.franka(), "panda_link0")))
    assert s.roles["base"] == "panda_link0"
    assert s.roles["arm_joints"] == FRANKA_ARM


def test_a_short_arm_is_suggested_but_flagged():
    s = suggest_roles(parse_urdf(samples.short_arm()))
    assert s.roles["arm_joints"] == ["j1", "j2", "j3"]
    assert s.roles["gripper_joints"] == ["finger_joint"]
    err = [i for i in s.issues if i.code == "arm_too_short"]
    assert err and err[0].severity == "error" and "3 DOF" in err[0].message and "at least 5" in err[0].message


def test_no_gripper_is_flagged():
    s = suggest_roles(parse_urdf(samples.no_gripper()))
    assert s.roles["arm_joints"] == [f"j{i}" for i in range(1, 7)]
    assert s.roles["hand"] == "l6"
    assert s.roles["gripper_joints"] is None
    assert "no_gripper" in codes(s.issues, "error")


def test_no_revolute_joints_is_no_arm():
    s = suggest_roles(parse_urdf("<robot name='r'><link name='a'/><link name='b'/>"
                                 "<joint name='j' type='fixed'><parent link='a'/><child link='b'/></joint></robot>"))
    assert s.roles["arm_joints"] is None and "no_arm" in codes(s.issues, "error")


def test_a_link_with_geometry_but_no_inertial_is_a_warning():
    text = samples.franka().replace(samples._box_link("panda_link3"), samples._box_link("panda_link3", inertial=False))
    s = suggest_roles(parse_urdf(text))
    warn = [i for i in s.issues if i.code == "no_inertial"]
    assert warn and warn[0].severity == "warning" and "panda_link3" in warn[0].message


# --- validate ----------------------------------------------------------------------------------------------------

def test_the_suggested_franka_roles_validate():
    assert codes(validate_roles(parse_urdf(samples.franka()), FRANKA_ROLES), "error") == []


@pytest.mark.parametrize("change, code, words", [
    ({"arm_joints": FRANKA_ARM[:4]}, "arm_too_short", "4 DOF"),
    ({"arm_joints": FRANKA_ARM[:3] + FRANKA_ARM[4:]}, "arm_not_chain", "panda_joint4"),
    ({"arm_joints": FRANKA_ARM[::-1]}, "arm_not_chain", "base"),
    ({"arm_joints": FRANKA_ARM[:6] + ["nope"]}, "unknown_joint", "nope"),
    ({"base": "nope"}, "unknown_link", "nope"),
    ({"hand": "panda_link5"}, "arm_not_chain", "panda_link5"),
    ({"gripper_joints": []}, "no_gripper", "gripper"),
    ({"gripper_joints": ["panda_joint7"]}, "role_overlap", "panda_joint7"),
    ({"gripper_joints": ["panda_joint8"]}, "no_gripper", "panda_joint8"),
])
def test_bad_roles_say_what_is_wrong(change, code, words):
    issues = validate_roles(parse_urdf(samples.franka()), FRANKA_ROLES.model_copy(update=change))
    hit = [i for i in issues if i.code == code]
    assert hit, issues
    assert hit[0].severity == "error" and words in hit[0].message


def test_gripper_joints_must_be_below_the_hand():
    text = samples.franka()
    roles = FRANKA_ROLES.model_copy(update={"arm_joints": FRANKA_ARM[:5], "hand": "panda_link5",
                                            "gripper_joints": ["panda_finger_joint1"]})
    hit = [i for i in validate_roles(parse_urdf(text), roles) if i.code == "no_gripper"]
    assert hit and "below the hand" in hit[0].message


def test_an_arm_joint_without_limits_is_an_error():
    text = samples.franka().replace('<limit lower="-2.8973" upper="2.8973" effort="12" velocity="2.61"/></joint>'
                                    '<link name="panda_link8"/>', '</joint><link name="panda_link8"/>')
    hit = [i for i in validate_roles(parse_urdf(text), FRANKA_ROLES) if i.code == "joint_no_limits"]
    assert hit and "panda_joint7" in hit[0].message


def test_roles_reject_unknown_fields():
    with pytest.raises(ValueError):
        Roles(base="a", arm_joints=[], hand="h", gripper_joints=[], colour="red")
