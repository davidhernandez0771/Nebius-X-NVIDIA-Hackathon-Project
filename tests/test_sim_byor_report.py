"""sim_worker.byor_report: drive gains, reach map, joint-limit hits, verdict and the report JSON (byor-api.md 6)."""

from __future__ import annotations

import numpy as np
import pytest

import urdf_samples as samples
from sim_worker import byor_report as br
from sim_worker.urdf_import import Mount, Roles, build_spec, parse_urdf

FRANKA_ARM = [f"panda_joint{i}" for i in range(1, 8)]
FRANKA_ROLES = Roles(base="panda_link0", arm_joints=FRANKA_ARM, hand="panda_hand",
                     gripper_joints=["panda_finger_joint1", "panda_finger_joint2"])


@pytest.fixture(scope="module")
def franka():
    u = parse_urdf(samples.franka())
    return u, build_spec(u, FRANKA_ROLES, "byor_0123456789").spec


def test_actuator_groups_use_high_pd_gains_and_urdf_limits(franka):
    u, spec = franka
    g = br.actuator_groups(u, spec, FRANKA_ARM)
    assert set(g) == {"arm", "gripper", "gripper_passive"}
    assert g["arm"]["joints"] == FRANKA_ARM and (g["arm"]["stiffness"], g["arm"]["damping"]) == (400.0, 80.0)
    assert g["arm"]["effort"]["panda_joint1"] == 87.0 and g["arm"]["effort"]["panda_joint7"] == 12.0
    assert g["gripper"]["joints"] == ["panda_finger_joint1"] and g["gripper"]["stiffness"] == 2e3
    assert g["gripper_passive"] == {"joints": ["panda_finger_joint2"], "stiffness": 0.0, "damping": 0.0,
                                    "effort": {"panda_finger_joint2": 20.0}, "velocity": {"panda_finger_joint2": 0.2}}


def test_actuator_groups_leave_out_empty_groups():
    u = parse_urdf(samples.so101())
    roles = Roles(base="base_link", arm_joints=["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex",
                                                "wrist_roll"], hand="gripper_link", gripper_joints=["gripper"])
    spec = build_spec(u, roles, "byor_0123456789").spec
    assert set(br.actuator_groups(u, spec, roles.arm_joints)) == {"arm", "gripper"}


def test_reach_map_layers_and_grid(franka):
    u, spec = franka
    m = br.reach_map(u, spec, FRANKA_ROLES)
    assert m["grid"] == {"x": [0.4, 0.45, 0.5, 0.55, 0.6, 0.65], "y": pytest.approx(list(np.arange(-0.3, 0.301, 0.05)))}
    assert [(lay["name"], lay["z"], lay["yaw_deg"]) for lay in m["layers"]] == [
        ("grasp", 0.025, 0), ("grasp", 0.025, 45), ("grasp", 0.025, -45), ("release", 0.10, 0), ("carry", 0.25, 0)]
    assert all(np.shape(lay["reachable"]) == (6, 13) for lay in m["layers"])
    assert m["fraction"]["value"] == 1.0 and "source" in m["fraction"] and "solve_best" in m["source"]


def test_reach_map_shrinks_when_the_robot_sits_too_far_back():
    u = parse_urdf(samples.franka())
    roles = FRANKA_ROLES.model_copy(update={"mount": Mount(pos=(-0.15, 0.0, 0.0))})
    spec = build_spec(u, roles, "byor_0123456789").spec
    m = br.reach_map(u, spec, roles)
    assert 0.5 < m["fraction"]["value"] < 1.0  # measured 0.82
    grasp = np.asarray(m["layers"][0]["reachable"])
    assert grasp[0].all() and not grasp[-1].all()  # the near row is reachable, the far one is not
    assert "[-0.15, 0.0, 0.0]" in m["source"]


def test_joint_limit_hits_count_scenes_and_steps(franka):
    u, _ = franka
    names = FRANKA_ARM + ["panda_finger_joint1", "panda_finger_joint2"]
    a = np.zeros((10, 9))
    a[:3, 3] = -3.0718 + 0.005  # panda_joint4 lower, within 0.01 rad
    b = np.zeros((5, 9))
    b[4, 3] = -3.0718
    b[:2, 0] = 2.8973  # panda_joint1 upper
    b[:, 7] = 0.04  # a finger at its limit: not an arm joint
    hits = br.joint_limit_hits(u, FRANKA_ARM, names, [a, b])
    assert hits == [{"joint": "panda_joint1", "limit": "upper", "value": 2.8973, "scenes": 1, "steps": 2},
                    {"joint": "panda_joint4", "limit": "lower", "value": -3.0718, "scenes": 2, "steps": 4}]


@pytest.mark.parametrize("ok, n, value", [(24, 30, "ready"), (23, 30, "partial"), (6, 30, "partial"),
                                          (5, 30, "not_ready"), (0, 30, "not_ready"), (1, 1, "ready")])
def test_verdict(ok, n, value):
    v = br.verdict(ok, n)
    assert v["value"] == value and "24 of 30" in v["source"]


def _row(seed, success, reasons=(), mm=2.0, n=100):
    return {"seed": seed, "success": success, "reasons": list(reasons), "tracking_mean_mm": mm, "n_steps": n}


def test_pick_place_summary_counts_failures_and_weights_tracking_by_steps():
    rows = [_row(100, True, mm=1.0, n=100), _row(101, False, ["unreachable", "dropped"], mm=4.0, n=300),
            _row(102, False, ["unreachable"], mm=None, n=0)]
    s = br.pick_place_summary(rows)
    assert (s["successes"]["value"], s["successes"]["of"]) == (1, 3)
    assert s["failure_reasons"]["value"] == {"dropped": 1, "unreachable": 2}
    assert s["tracking_mean_mm"]["value"] == pytest.approx(3.25)


def _values_have_sources(node, path="report"):
    if isinstance(node, dict):
        if "value" in node:  # a sourced number or table: its source covers what is inside the value
            assert "source" in node, f"{path} has a value but no source"
        for k, v in node.items():
            if k != "value" or "source" not in node:
                _values_have_sources(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _values_have_sources(v, f"{path}[{i}]")


def test_build_report_shape_and_every_value_has_a_source(franka):
    u, spec = franka
    rows = [_row(100, True), _row(101, False, ["unreachable"])]
    rep = br.build_report(robot={"id": "byor_0123456789", "name": "panda", "dof": 7}, roles={"base": "panda_link0"},
                          spec={"name": "byor_0123456789"}, seeds=(100, 101), rows=rows,
                          reach=br.reach_map(u, spec, FRANKA_ROLES), limit_hits=[],
                          provenance={"git_commit": "abc"})
    assert rep["schema"] == "sant.robot_report/1"
    assert rep["task"]["seeds"] == [100, 101] and rep["task"]["workspace"]["cube_x"] == [0.40, 0.60]
    assert rep["verdict"]["value"] == "partial"
    assert rep["pick_place"]["successes"]["value"] == 1 and rep["scenes"]["rows"] == rows
    assert {"source", "rows"} <= set(rep["scenes"]) and "source" in rep["joint_limit_hits"]
    _values_have_sources(rep)
