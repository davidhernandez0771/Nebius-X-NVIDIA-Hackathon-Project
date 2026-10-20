"""sim_worker.robot_assets: the downloaded robot descriptions (C:\\dev\\assets\\robots, scripts/robot_asset_manifest.py)
as a manifest of links, meshes, rest poses and specs. Pure parts always; the real-asset checks skip when the
downloads aren't on this machine."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import numpy as np
import pytest

from sim_worker.robot_assets import (
    ASSETS, ROBOTS, build, manifest, mesh_info, xacro_number,
)
from sim_worker.urdf_import import parse_urdf
from sim_worker.urdf_kin import link_pose

REPO = Path(__file__).resolve().parents[1]
HAVE = ASSETS.exists()
real = pytest.mark.skipif(not HAVE, reason=f"the robot downloads aren't at {ASSETS}")


# --- triangle counts, units and up axes, from the files (never executed or imported) ----------------------

def test_binary_and_ascii_stl(tmp_path):
    b = tmp_path / "b.stl"
    b.write_bytes(b"\0" * 80 + struct.pack("<I", 3) + b"\0" * 50 * 3)
    assert mesh_info(b)["tris"] == 3 and mesh_info(b)["format"] == "stl"
    a = tmp_path / "a.STL"
    a.write_text("solid x\n" + "facet normal 0 0 1\n outer loop\n vertex 0 0 0\n endloop\nendfacet\n" * 2 + "endsolid x\n")
    assert mesh_info(a)["tris"] == 2


def test_collada_triangles_polylists_unit_and_up_axis(tmp_path):
    d = tmp_path / "m.dae"
    d.write_text('<COLLADA><asset><unit meter="0.001" name="mm"/><up_axis>Y_UP</up_axis></asset>'
                 '<triangles material="a" count="10"><p/></triangles>'
                 '<polylist count="2"><vcount>4 3</vcount><p/></polylist></COLLADA>')
    info = mesh_info(d)
    assert info["tris"] == 10 + 2 + 1 and info["unit_m"] == 0.001 and info["up_axis"] == "Y_UP"


def test_xacro_numbers_without_eval():
    assert xacro_number("${-2.0*pi}") == pytest.approx(-2 * math.pi)
    assert xacro_number("${pi}") == pytest.approx(math.pi)
    assert xacro_number("${-2.059}") == pytest.approx(-2.059)
    assert xacro_number("0.19198") == pytest.approx(0.19198)
    with pytest.raises(ValueError):
        xacro_number("${__import__('os')}")


# --- the real downloads ------------------------------------------------------------------------------------

@real
def test_franka_kinematics_yaml_is_the_panda_urdf_the_twin_loads():
    """franka_description's fer (Panda) kinematics.yaml, built into a chain, matches web/public's panda_arm_hand.urdf
    (franka_ros 0.7.1) joint for joint, so the two sources agree."""
    ours = build("franka").urdf
    theirs = parse_urdf((REPO / "web/public/robots/franka_description/robots/panda_arm_hand.urdf").read_text(encoding="utf-8"))
    rng = np.random.default_rng(0)
    for _ in range(20):
        q = {f"joint{i}": rng.uniform(-1, 1) for i in range(1, 8)}
        a = link_pose(ours, "link8", q, top="link0")
        b = link_pose(theirs, "panda_link8", {f"panda_joint{i}": v for i, v in ((int(k[5:]), v) for k, v in q.items())}, top="panda_link0")
        assert np.allclose(a, b, atol=1e-6)


@real
@pytest.mark.parametrize("name", list(ROBOTS))
def test_each_robot_has_its_arm_dof_limits_and_meshes(name):
    r = build(name)
    want = {"franka": 7, "fr3": 7, "ur5e": 6, "xarm6": 6, "so101": 5, "piper": 6, "openarm": 7}[name]
    assert r.dof == want
    for j in r.arm_joints:
        lim = r.urdf.joints[j].limits
        assert lim is not None and lim.lower < lim.upper
    assert r.meshes, name
    missing = [m["path"] for meshes in r.meshes.values() for m in meshes if m.get("missing")]
    assert missing == []


@real
def test_reaches_agree_with_what_the_repo_measured():
    # T2 status (2026-10-16): "the Franka's ~0.85 m reach"; OpenArm "shoulder (z ~ 0.12 above base) to wrist <= 0.44 m"
    # (its wrist frame is link7, the flange here).
    assert build("franka").reach() == pytest.approx(0.855, abs=0.02)
    assert build("openarm").reach() == pytest.approx(0.44, abs=0.02)


@real
def test_no_payload_is_claimed():
    # None of the six repos states a payload (searched every downloaded text file).
    for name in ROBOTS:
        assert build(name).payload is None


@real
def test_the_committed_manifest_is_what_the_downloads_give():
    committed = json.loads((REPO / "docs/design/robot-assets/manifest.json").read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(manifest()))
