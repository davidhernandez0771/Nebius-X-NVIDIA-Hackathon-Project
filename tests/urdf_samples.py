"""Small URDFs for the BYOR tests (sim_worker.urdf_import, sim_worker.urdf_kin).

FRANKA: the kinematics, limits and mimic of Isaac Sim's franka_description/robots/panda_arm_hand.urdf, with boxes
for geometry. Each finger's box ends 0.054 m along the finger's +z (the real finger.stl ends at 0.0539 m), so the
fingertips are 0.1124 m below panda_hand.
SO101: the SO-101's layout (5 revolute arm joints, a revolute jaw named "gripper", a fixed gripper_frame_link at
the grasp point); the numbers are made up.
"""

from __future__ import annotations


def _box_link(name: str, size="0.05 0.05 0.05", xyz="0 0 0", inertial=True) -> str:
    inert = '<inertial><mass value="1.0"/><inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.01"/></inertial>'
    return (f'<link name="{name}"><collision><origin xyz="{xyz}" rpy="0 0 0"/><geometry><box size="{size}"/>'
            f'</geometry></collision>{inert if inertial else ""}</link>')


def _joint(name, type_, parent, child, xyz="0 0 0", rpy="0 0 0", axis="0 0 1", limit=None, mimic=None) -> str:
    lim = "" if limit is None else f'<limit lower="{limit[0]}" upper="{limit[1]}" effort="{limit[2]}" velocity="{limit[3]}"/>'
    mim = "" if mimic is None else f'<mimic joint="{mimic}"/>'
    ax = "" if type_ == "fixed" else f'<axis xyz="{axis}"/>'
    return (f'<joint name="{name}" type="{type_}"><parent link="{parent}"/><child link="{child}"/>'
            f'<origin xyz="{xyz}" rpy="{rpy}"/>{ax}{lim}{mim}</joint>')


_H = 1.57079632679
_FRANKA_ARM = [  # (xyz, rpy, (lower, upper, effort, velocity)) of panda_joint1..7
    ("0 0 0.333", "0 0 0", (-2.8973, 2.8973, 87, 2.175)),
    ("0 0 0", f"-{_H} 0 0", (-1.7628, 1.7628, 87, 2.175)),
    ("0 -0.316 0", f"{_H} 0 0", (-2.8973, 2.8973, 87, 2.175)),
    ("0.0825 0 0", f"{_H} 0 0", (-3.0718, -0.0698, 87, 2.175)),
    ("-0.0825 0.384 0", f"-{_H} 0 0", (-2.8973, 2.8973, 12, 2.61)),
    ("0 0 0", f"{_H} 0 0", (-0.0175, 3.7525, 12, 2.61)),
    ("0.088 0 0", f"{_H} 0 0", (-2.8973, 2.8973, 12, 2.61)),
]


def franka(joint7_limits=None) -> str:
    parts = [_box_link("panda_link0")]
    for i, (xyz, rpy, lim) in enumerate(_FRANKA_ARM, start=1):
        if i == 7 and joint7_limits is not None:
            lim = (*joint7_limits, 12, 2.61)
        parts.append(_box_link(f"panda_link{i}"))
        parts.append(_joint(f"panda_joint{i}", "revolute", f"panda_link{i - 1}", f"panda_link{i}", xyz, rpy, limit=lim))
    parts.append('<link name="panda_link8"/>')
    parts.append(_joint("panda_joint8", "fixed", "panda_link7", "panda_link8", "0 0 0.107"))
    parts.append(_box_link("panda_hand", "0.05 0.2 0.06", "0 0 0.03"))
    parts.append(_joint("panda_hand_joint", "fixed", "panda_link8", "panda_hand", rpy="0 0 -0.785398163397"))
    parts.append(_box_link("panda_leftfinger", "0.02 0.02 0.054", "0 0.01 0.027"))
    parts.append(_box_link("panda_rightfinger", "0.02 0.02 0.054", "0 -0.01 0.027"))
    parts.append(_joint("panda_finger_joint1", "prismatic", "panda_hand", "panda_leftfinger", "0 0 0.0584",
                        axis="0 1 0", limit=(0.0, 0.04, 20, 0.2)))
    parts.append(_joint("panda_finger_joint2", "prismatic", "panda_hand", "panda_rightfinger", "0 0 0.0584",
                        axis="0 -1 0", limit=(0.0, 0.04, 20, 0.2), mimic="panda_finger_joint1"))
    return '<?xml version="1.0"?><robot name="panda">' + "".join(parts) + "</robot>"


def so101(with_tcp_link=True) -> str:
    parts = [_box_link("base_link")]
    chain = [("shoulder_pan", "shoulder_link", "0 0 0.06", "0 0 1"),
             ("shoulder_lift", "upper_arm_link", "0 0 0.05", "0 1 0"),
             ("elbow_flex", "lower_arm_link", "0.11 0 0", "0 1 0"),
             ("wrist_flex", "wrist_link", "0.13 0 0", "0 1 0"),
             ("wrist_roll", "gripper_link", "0.06 0 0", "1 0 0")]
    parent = "base_link"
    for name, child, xyz, axis in chain:
        parts.append(_box_link(child))
        parts.append(_joint(name, "revolute", parent, child, xyz, axis=axis, limit=(-1.9, 1.9, 3, 4.7)))
        parent = child
    # the jaw pivots at the hand's side and its tip reaches 0.06 m forward (+x)
    parts.append(_box_link("moving_jaw_link", "0.06 0.01 0.01", "0.03 0 0"))
    parts.append(_joint("gripper", "revolute", "gripper_link", "moving_jaw_link", "0.02 0 -0.02", axis="0 1 0",
                        limit=(-0.1745, 1.7453, 3, 4.7)))
    if with_tcp_link:
        parts.append('<link name="gripper_frame_link"/>')
        parts.append(_joint("gripper_frame_joint", "fixed", "gripper_link", "gripper_frame_link", "0.07 0 0"))
    return '<?xml version="1.0"?><robot name="so101">' + "".join(parts) + "</robot>"


def short_arm() -> str:
    """3 revolute joints and a prismatic finger."""
    parts = [_box_link("base")]
    parent = "base"
    for i in range(1, 4):
        parts.append(_box_link(f"l{i}"))
        parts.append(_joint(f"j{i}", "revolute", parent, f"l{i}", "0 0 0.2", axis="0 1 0", limit=(-2, 2, 10, 2)))
        parent = f"l{i}"
    parts.append(_box_link("finger"))
    parts.append(_joint("finger_joint", "prismatic", parent, "finger", "0 0 0.05", axis="0 1 0", limit=(0, 0.03, 10, 0.1)))
    return '<robot name="short">' + "".join(parts) + "</robot>"


def no_gripper() -> str:
    """6 revolute joints ending in a plain flange."""
    parts = [_box_link("base")]
    parent = "base"
    for i in range(1, 7):
        parts.append(_box_link(f"l{i}"))
        parts.append(_joint(f"j{i}", "revolute", parent, f"l{i}", "0 0 0.2", axis="0 1 0" if i % 2 else "0 0 1",
                            limit=(-2, 2, 10, 2)))
        parent = f"l{i}"
    return '<robot name="flange">' + "".join(parts) + "</robot>"


def with_world_root(urdf: str, base: str) -> str:
    """Prefix a URDF's links with a geometry-less "world" link bolted to `base`."""
    head, tail = urdf.split("<robot", 1)
    name_end = tail.index(">") + 1
    extra = '<link name="world"/>' + _joint("world_joint", "fixed", "world", base)
    return head + "<robot" + tail[:name_end] + extra + tail[name_end:]
