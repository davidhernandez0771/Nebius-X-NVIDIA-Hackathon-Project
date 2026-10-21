"""sim_worker.object_record: the replay's per-step readings of every cube -> goals.py's SceneSignals (and today's
SimSignals for the primary cube), saved beside an episode. Pure; fed here from the synthetic two-cube scene."""

from __future__ import annotations

import numpy as np
import pytest

import goal_scenes as gs
from demo_pipeline.goals import Goal, check_goals
from demo_pipeline.scene_plan import ScenePlan
from demo_pipeline.schemas import Pose, Scene
from sim_worker.object_record import ObjectRecorder, load_scene_signals, save_scene_signals
from sim_worker.plan_layout import layout_for_plan, layout_for_scene


def _plan() -> ScenePlan:
    return ScenePlan.model_validate({
        "objects": [
            {"id": "red", "kind": "cube", "color": "red", "pose": {"x": gs.RED[0], "y": gs.RED[1]}},
            {"id": "blue", "kind": "cube", "color": "blue", "pose": {"x": gs.BLUE[0], "y": gs.BLUE[1]}},
            {"id": "left_bin", "kind": "bin", "color": "yellow", "pose": {"x": gs.LEFT[0], "y": gs.LEFT[1]}},
            {"id": "right_bin", "kind": "bin", "color": "purple", "pose": {"x": gs.RIGHT[0], "y": gs.RIGHT[1]}},
        ],
        "goals": [{"object": "red", "bin": "left_bin"}, {"object": "blue", "bin": "right_bin"}],
        # goal_scenes' right bin (y -0.35) is past the Franka's tested ranges; the recorder doesn't care.
        "reach": {"x": [0.3, 0.7], "y": [-0.4, 0.4]},
    })


def _record():
    """Feed the recorder step by step, as replay does, from the synthetic two-cube demo."""
    src = gs.build(gs.two_in_order())
    lay = layout_for_plan(_plan())
    rec = ObjectRecorder(lay)
    for i in range(len(src.t)):
        rec.add({c: (src.objects[c].pos[i], bool(src.objects[c].gripper_contact[i])) for c in ("red", "blue")},
                arm_bin=False, arm_table=False, force=0.0)
    return src, lay, rec


def test_the_recorder_gives_the_goal_checker_every_cube():
    src, lay, rec = _record()
    sig = rec.scene_signals(src.t, src.ee_pos, src.gripper)
    assert set(sig.objects) == {"red", "blue"} and set(sig.containers) == {"left_bin", "right_bin"}
    assert np.array_equal(sig.objects["red"].pos, src.objects["red"].pos)
    rep = check_goals([Goal("red", "left_bin"), Goal("blue", "right_bin")], sig)
    assert rep.success, rep.reasons


def test_the_primary_cube_still_makes_todays_sim_signals():
    src, lay, rec = _record()
    sim = rec.sim_signals("red")
    assert np.array_equal(sim.cube_pos, src.objects["red"].pos)
    assert np.array_equal(sim.contact_gripper_cube, src.objects["red"].gripper_contact)
    assert sim.n_steps == len(src.t) and not sim.contact_arm_bin.any()


def test_todays_scene_records_one_cube_named_cube():
    scene = Scene(cube_pose=Pose(pos=(0.5, 0.0, 0.025), quat_wxyz=(1, 0, 0, 0)), bin_pose=Pose(pos=(0.5, 0.3, 0.0), quat_wxyz=(1, 0, 0, 0)), robot="franka", seed=0)
    rec = ObjectRecorder(layout_for_scene(scene))
    assert rec.cube_ids == ["cube"]
    with pytest.raises(ValueError, match="readings for"):
        rec.add({"red": ((0, 0, 0), False)}, arm_bin=False, arm_table=False, force=0.0)


def test_arm_contacts_and_forces_reach_both_signal_kinds():
    src, lay, rec = _record()
    rec2 = ObjectRecorder(lay)
    for i in range(len(src.t)):
        rec2.add({c: (src.objects[c].pos[i], False) for c in ("red", "blue")}, arm_bin=i == 5, arm_table=i == 9, force=7.0 if i in (5, 9) else 0.0)
    sig = rec2.scene_signals(src.t, src.ee_pos, src.gripper)
    assert sig.arm_contact[5] and sig.arm_contact[9] and sig.arm_contact.sum() == 2
    assert sig.max_contact_force.max() == 7.0
    sim = rec2.sim_signals("blue")
    assert sim.contact_arm_bin[5] and sim.contact_arm_table[9]


def test_saved_beside_the_episode_and_read_back(tmp_path):
    src, lay, rec = _record()
    sig = rec.scene_signals(src.t, src.ee_pos, src.gripper, tcp_error=np.full(len(src.t), 0.001))
    save_scene_signals(tmp_path, sig)
    back = load_scene_signals(tmp_path)
    for k in ("t", "ee_pos", "gripper", "arm_contact", "max_contact_force", "tcp_error"):
        assert np.array_equal(getattr(back, k), getattr(sig, k)), k
    for c in sig.objects:
        assert np.array_equal(back.objects[c].pos, sig.objects[c].pos)
        assert np.array_equal(back.objects[c].gripper_contact, sig.objects[c].gripper_contact)
    assert back.containers == sig.containers
    assert load_scene_signals(tmp_path / "nothing") is None
