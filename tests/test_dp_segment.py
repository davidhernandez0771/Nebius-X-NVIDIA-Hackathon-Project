"""demo_pipeline.segment: a demo split into steps (reach, grasp, missed, regrasp, carry, place, drop, release), and
the one-line reading of it. On a single clean pick-place its per-step labels are exactly robota.phases'."""

from __future__ import annotations


import numpy as np
import pytest

import goal_scenes as gs
import test_dp_success as single
from demo_pipeline import robota
from demo_pipeline.goals import SceneSignals
from demo_pipeline.segment import describe, segments, step_labels


def kinds(segs):
    return [(s.kind, s.obj, s.container) for s in segs]


def test_one_clean_pick_place_matches_robota_phases_step_for_step():
    traj, sim = single._clean()
    sig = SceneSignals.single(traj, sim, single.BIN)
    labels = [lab.kind for lab in step_labels(sig)]
    want = robota.phases(traj.to_arrays()["gripper"], sim.cube_pos, single.BIN.pos, single.BIN.quat_wxyz)
    assert labels == want


def test_two_cubes_read_as_two_pick_places():
    segs = segments(gs.build(gs.two_in_order()))
    assert kinds(segs) == [
        ("reach", None, None),
        ("grasp", "red", None), ("carry", "red", None), ("place", "red", "left_bin"), ("release", "red", "left_bin"),
        ("reach", None, None),
        ("grasp", "blue", None), ("carry", "blue", None), ("place", "blue", "right_bin"), ("release", "blue", "right_bin"),
    ]
    assert segs[1].start == pytest.approx(1.0)
    assert segs[-1].end == pytest.approx(12.0)
    # "place" starts when the carried cube's centre crosses into the bin's inner footprint: red's y passes 0.15 at
    # 3/4 of its 2.0-3.5 s carry (3.125 s, first step 3.14); blue's passes -0.25 at 2/3 of 7.5-9.0 s (8.5 s).
    assert describe(segs) == "grasp red 1.0 s -> place left bin 3.1 s -> grasp blue 6.5 s -> place right bin 8.5 s"


def test_a_miss_then_a_regrasp():
    segs = segments(gs.build(gs.miss_then_regrasp()))
    assert kinds(segs)[:4] == [("reach", None, None), ("missed", "red", None), ("reach", None, None), ("regrasp", "red", None)]
    assert describe(segs) == "grasp red 1.0 s -> missed -> regrasp red 2.6 s -> place left bin 4.7 s"  # 3.6 + 1.125


def test_a_second_miss_on_the_same_cube_reads_as_a_regrasp():
    beside = (gs.RED[0], gs.RED[1] + 0.03)
    miss = [gs.Key(0.0, (*beside, gs.ABOVE), 0), gs.Key(1.0, (*beside, gs.CLOSE_Z), 1), gs.Key(1.4, (*beside, gs.ABOVE), 0)]
    again = [gs.Key(1.6, (*beside, gs.ABOVE), 0), gs.Key(2.6, (*beside, gs.CLOSE_Z), 1), gs.Key(3.0, (*beside, gs.ABOVE), 0)]
    s = gs.SceneScript(cubes={"red": gs.RED}, bins={"left_bin": gs.LEFT}, keys=miss + again + gs.pick_place(3.2, gs.RED, gs.LEFT) + [gs.end(9.0, gs.LEFT)])
    assert describe(segments(gs.build(s))).startswith("grasp red 1.0 s -> missed -> regrasp red 2.6 s -> missed -> regrasp red 4.2 s")


def test_a_drop_then_a_regrasp():
    segs = segments(gs.build(gs.drop_then_regrasp()))
    k = kinds(segs)
    assert ("drop", "red", None) in k
    assert k.index(("regrasp", "red", None)) > k.index(("drop", "red", None))
    assert describe(segs) == "grasp red 1.0 s -> dropped red 2.6 s -> regrasp red 5.0 s -> place left bin 6.9 s"  # 6.0 + 0.875


def test_a_slip_before_the_lift_is_a_miss():
    s = gs.SceneScript(cubes={"red": gs.RED}, bins={"left_bin": gs.LEFT}, keys=gs.pick_place(0.0, gs.RED, gs.LEFT) + [gs.end(6.0, gs.LEFT)],
                       drop_at={1.02: "red"})
    segs = segments(gs.build(s))
    assert kinds(segs)[1:3] == [("grasp", "red", None), ("missed", "red", None)]


def test_verbose_reading_has_every_step_with_its_span():
    text = describe(segments(gs.build(gs.two_in_order())), verbose=True)
    assert text.startswith("reach 0.0-1.0 s -> grasp red 1.0-")
    assert "carry red" in text and "release blue" in text


def test_display_names():
    segs = segments(gs.build(gs.two_in_order()))
    assert describe(segs, names={"red": "the red cube", "left_bin": "the left bin"}).startswith("grasp the red cube 1.0 s -> place the left bin")


def test_steps_and_labels_line_up():
    sig = gs.build(gs.three_with_drop())
    labels = step_labels(sig)
    assert len(labels) == len(sig.t)
    segs = segments(sig)
    assert segs[0].start == 0.0 and segs[-1].end == pytest.approx(sig.t[-1])
    assert all(a.end == pytest.approx(b.start) for a, b in zip(segs, segs[1:]))
    assert np.isclose(sum(s.end - s.start for s in segs), sig.t[-1])


REAL = gs.REAL


def _real(path):
    traj, sim, bin_pose, _tcp, _reasons = gs.load_real(path)
    return traj, sim, bin_pose


@pytest.mark.parametrize("path", REAL, ids=lambda p: p.name.split(".")[0])
def test_real_episodes_read_and_agree_with_robota_on_one_clean_hold(path):
    traj, sim, bin_pose = _real(path)
    sig = SceneSignals.single(traj, sim, bin_pose)
    segs = segments(sig)
    assert segs[0].start == pytest.approx(float(sig.t[0])) and segs[-1].end == pytest.approx(float(sig.t[-1]))
    assert describe(segs)  # every real demo has at least one close
    grip = traj.to_arrays()["gripper"].astype(bool)
    closes = np.flatnonzero(np.diff(grip.astype(int)) == 1).size + int(grip[0])
    # One close that holds the cube from first contact to the opening: robota's labels hold step for step.
    held = sim.contact_gripper_cube
    first = np.flatnonzero(held & grip)
    clean = closes == 1 and first.size and held[first[0]:np.flatnonzero(grip)[-1] + 1].all()
    if clean:
        want = robota.phases(grip.astype(int), sim.cube_pos, bin_pose.pos, bin_pose.quat_wxyz)
        assert [lab.kind for lab in step_labels(sig)] == want


def test_some_real_episode_is_a_clean_hold():
    clean = 0
    for path in REAL:
        traj, sim, _ = _real(path)
        grip = traj.to_arrays()["gripper"].astype(bool)
        first = np.flatnonzero(sim.contact_gripper_cube & grip)
        closes = np.flatnonzero(np.diff(grip.astype(int)) == 1).size + int(grip[0])
        clean += bool(closes == 1 and first.size and sim.contact_gripper_cube[first[0]:np.flatnonzero(grip)[-1] + 1].all())
    assert clean >= 1
