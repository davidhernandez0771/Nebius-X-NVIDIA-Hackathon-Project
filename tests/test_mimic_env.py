"""sim_worker/mimic_env.py: SANT's pick-place as an Isaac Lab Mimic env, checked without starting Isaac.

Needs Isaac Lab (run with Isaac Lab's Python; SANT's venv skips the whole file). Nothing here launches the app or
builds a simulation: the config is built and read, the gym registration is looked up, and the env's Mimic methods
and terms run on small torch tensors standing in for the scene.

    set PYTHONPATH=.;src;C:\\isaac\\IsaacLab\\source\\isaaclab_mimic
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe -m pytest --noconftest -p no:cacheprovider tests/test_mimic_env.py
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace as NS

import numpy as np
import pytest

MIMIC_SRC = os.environ.get("ISAACLAB_MIMIC_SRC", r"C:\isaac\IsaacLab\source\isaaclab_mimic")
torch = pytest.importorskip("torch")
pytest.importorskip("isaaclab.envs")
if MIMIC_SRC not in sys.path and os.path.isdir(MIMIC_SRC):
    sys.path.insert(0, MIMIC_SRC)
pytest.importorskip("isaaclab_mimic")

import isaaclab.utils.math as PoseUtils  # noqa: E402

from demo_pipeline import mimic  # noqa: E402
from sim_worker import mimic_env as me  # noqa: E402
from sim_worker import scene_cfg  # noqa: E402

DOWN_XYZW = torch.tensor([1.0, 0.0, 0.0, 0.0])  # 180 deg about x: the tool pointing down


@pytest.fixture(scope="module")
def cfg():
    return me.SantPickPlaceMimicEnvCfg()


def test_the_action_is_absolute_ik_on_the_tool_centre_and_a_binary_gripper(cfg):
    arm, grip = cfg.actions.arm_action, cfg.actions.gripper_action
    assert arm.body_name == "panda_hand"
    assert tuple(arm.body_offset.pos) == pytest.approx(mimic.TCP_OFFSET)
    assert arm.controller.command_type == "pose" and arm.controller.use_relative_mode is False
    assert grip.open_command_expr == {"panda_finger_.*": 0.04} and grip.close_command_expr == {"panda_finger_.*": 0.0}


def test_it_steps_at_sants_50_hz_with_sants_time_limit(cfg):
    assert cfg.sim.dt * cfg.decimation == pytest.approx(1 / 50)
    assert cfg.episode_length_s == pytest.approx(30.0)


def test_the_scene_is_sants_without_cameras_and_its_rigid_objects_are_the_exports(cfg):
    from isaaclab.assets import RigidObjectCfg

    rigid = {k for k, v in vars(cfg.scene).items() if isinstance(v, RigidObjectCfg)}
    assert rigid == set(mimic.SCENE_OBJECTS)
    assert cfg.scene.front is None and cfg.scene.wrist is None


def test_the_exports_scene_poses_match_scene_cfg():
    assert tuple(mimic.TABLE_CENTER) == pytest.approx(scene_cfg.TABLE_CENTER)
    for name, (_size, center) in scene_cfg.BIN_PARTS.items():
        assert tuple(mimic.BIN_PART_CENTERS[name]) == pytest.approx(center), name


def test_the_subtasks_are_the_exports(cfg):
    subs = cfg.subtask_configs[mimic.EEF]
    assert [s.object_ref for s in subs] == [s["object_ref"] for s in mimic.SUBTASKS]
    assert [s.subtask_term_signal for s in subs] == [s["term_signal"] for s in mimic.SUBTASKS]
    assert [tuple(s.subtask_term_offset_range) for s in subs] == [tuple(s["term_offset"]) for s in mimic.SUBTASKS]
    assert cfg.datagen_config.generation_select_src_per_subtask is True


def test_it_has_the_terms_mimic_needs(cfg):
    assert cfg.terminations.success.func is me.sant_success
    assert cfg.terminations.time_out.time_out is True
    assert {"eef_pos", "eef_quat", "joint_pos", "cube_pos"} <= set(vars(cfg.observations.policy))
    assert cfg.observations.subtask_terms.grasp.func is me.grasp_signal


def test_register_adds_the_env_to_gym_and_its_config_loads_from_the_registry():
    import gymnasium as gym

    from sim_worker import mimic_register

    assert mimic_register.register() is None  # nothing for generate_dataset's own argument check
    spec = gym.spec(mimic.ENV_NAME)
    assert spec.entry_point == "sim_worker.mimic_env:SantPickPlaceMimicEnv"
    from isaaclab_tasks.utils.parse_cfg import load_cfg_from_registry

    assert isinstance(load_cfg_from_registry(mimic.ENV_NAME, "env_cfg_entry_point"), me.SantPickPlaceMimicEnvCfg)


# --- the Mimic methods and terms on stand-in tensors ------------------------------------------------------


class _Scene(dict):
    """scene["cube"] etc., plus env_origins, as InteractiveScene offers them."""

    env_origins = None


def _stub(cfg, *, cube=(0.5, 0.3, 0.035), cube_vel=(0.0, 0.0, 0.0), bin_=(0.5, 0.3, 0.0), gripper=1.0):
    """A stand-in env with one environment at origin (1, 2, 0): just what the methods and terms read."""
    origin = torch.tensor([[1.0, 2.0, 0.0]])
    unit = torch.tensor([[0.0, 0.0, 0.0, 1.0]])

    def body(pos, vel=(0.0, 0.0, 0.0)):
        p = torch.tensor([pos]) + origin
        return NS(data=NS(root_pos_w=NS(torch=p), root_quat_w=NS(torch=unit), root_lin_vel_w=NS(torch=torch.tensor([vel]))))

    floor = (bin_[0], bin_[1], bin_[2] + mimic.BIN_PART_CENTERS["bin_floor"][2])
    hand = torch.cat([torch.tensor([[0.45, 0.0, 0.35 + 0.1034]]) + origin, DOWN_XYZW[None]], 1)
    robot = NS(data=NS(body_pose_w=NS(torch=hand[:, None, :])), find_bodies=lambda name: ([0], [name]))
    scene = _Scene(cube=body(cube, cube_vel), bin_floor=body(floor), robot=robot)
    scene.env_origins = origin
    terms = {"gripper_action": NS(raw_actions=torch.tensor([[gripper]]))}
    return NS(scene=scene, cfg=cfg, action_manager=NS(get_term=lambda n: terms[n]), num_envs=1)


def test_the_tool_pose_observation_is_the_hand_plus_the_offset_in_the_env_frame(cfg):
    e = _stub(cfg)
    pos, quat = me.tcp_pos(e), me.tcp_quat(e)
    assert pos[0].tolist() == pytest.approx([0.45, 0.0, 0.35], abs=1e-6)
    assert quat[0].tolist() == pytest.approx(DOWN_XYZW.tolist())


def test_actions_and_target_poses_round_trip(cfg):
    e = NS(cfg=cfg)
    q = torch.tensor([[0.9, 0.3, -0.1, 0.2]])
    q = q / q.norm()  # any rotation, (x, y, z, w)
    action = torch.cat([torch.tensor([[0.5, -0.1, 0.2]]), q, torch.tensor([[-1.0]])], 1)
    poses = me.SantPickPlaceMimicEnv.action_to_target_eef_pose(e, action)
    back = me.SantPickPlaceMimicEnv.target_eef_pose_to_action(e, {mimic.EEF: poses[mimic.EEF][0]}, {mimic.EEF: action[0, 7:]})
    assert back[:3].tolist() == pytest.approx(action[0, :3].tolist(), abs=1e-6)
    # The same rotation (a quaternion and its negative are one rotation).
    assert abs(float(torch.dot(back[3:7], action[0, 3:7]))) == pytest.approx(1.0, abs=1e-6)
    assert back[7].item() == -1.0
    grip = me.SantPickPlaceMimicEnv.actions_to_gripper_actions(e, action[None].repeat(1, 3, 1)[0])
    assert grip[mimic.EEF].shape == (3, 1)


def test_the_eef_pose_comes_from_the_tool_observations(cfg):
    e = NS(cfg=cfg, obs_buf={"policy": {"eef_pos": torch.tensor([[0.4, 0.1, 0.3]]), "eef_quat": DOWN_XYZW[None]}})
    m = me.SantPickPlaceMimicEnv.get_robot_eef_pose(e, mimic.EEF)
    assert m.shape == (1, 4, 4)
    assert m[0, :3, 3].tolist() == pytest.approx([0.4, 0.1, 0.3])
    assert torch.allclose(m[0, :3, :3], PoseUtils.matrix_from_quat(DOWN_XYZW))


def test_object_poses_are_the_cube_and_the_bin_frame_in_the_env_frame(cfg):
    e = _stub(cfg, cube=(0.55, -0.1, 0.025), bin_=(0.5, 0.3, 0.0))
    poses = me.SantPickPlaceMimicEnv.get_object_poses(e)
    assert set(poses) == {"cube", "bin"}
    assert poses["cube"][0, :3, 3].tolist() == pytest.approx([0.55, -0.1, 0.025], abs=1e-6)
    assert poses["bin"][0, :3, 3].tolist() == pytest.approx([0.5, 0.3, 0.0], abs=1e-6)


@pytest.mark.parametrize(
    "kw, want",
    [
        ({}, True),
        ({"cube": (0.5, 0.45, 0.035)}, False),  # beside the bin
        ({"cube": (0.5, 0.3, 0.25)}, False),  # above the rim
        ({"cube_vel": (0.0, 0.0, -0.3)}, False),  # still falling
        ({"gripper": -1.0}, False),  # still holding it
    ],
)
def test_success_is_placed_settled_and_released(cfg, kw, want):
    assert bool(me.sant_success(_stub(cfg, **kw))[0]) is want


def test_the_grasp_signal_is_on_once_the_cube_is_held_a_centimetre_up(cfg):
    assert bool(me.grasp_signal(_stub(cfg, cube=(0.5, 0.0, 0.04), gripper=-1.0))[0])
    assert not bool(me.grasp_signal(_stub(cfg, cube=(0.5, 0.0, 0.025), gripper=-1.0))[0])
    assert not bool(me.grasp_signal(_stub(cfg, cube=(0.5, 0.0, 0.04), gripper=1.0))[0])
    sig = me.SantPickPlaceMimicEnv.get_subtask_term_signals(NS(obs_buf={"subtask_terms": {"grasp": torch.tensor([True])}}))
    assert set(sig) == {"grasp"}


def test_the_reset_scene_is_sampled_in_sants_ranges_with_the_bin_boxes_round_it():
    poses = me.sampled_scene_poses(np.random.default_rng(3))
    assert set(poses) == {"cube", *mimic.BIN_PART_CENTERS}
    cx, cy, _ = poses["cube"][0]
    assert 0.40 <= cx <= 0.60 and -0.20 <= cy <= 0.20
    fx, fy, fz = poses["bin_floor"][0]
    assert 0.40 <= fx <= 0.65 and -0.30 <= fy <= 0.30 and fz == pytest.approx(0.005)


# --- what the env records for SANT's re-verification -------------------------------------------------------


def test_the_sant_group_and_its_recorder_ride_along_with_mimics_default_recording(cfg):
    assert set(vars(cfg.observations.sant)) >= {"cube_pos", "contact_forces"}
    rec = cfg.mimic_recorder_config
    assert isinstance(rec, me.SantRecorderManagerCfg)
    # Isaac Lab's own recording stays (generation writes actions, policy obs, states and the initial state).
    assert rec.record_pre_step_actions is not None and rec.record_initial_state is not None
    assert rec.record_post_step_sant.class_type is me.SantSignalsRecorder


def test_the_recorder_writes_the_sant_group_after_each_step():
    sant = {"cube_pos": torch.zeros(1, 3), "contact_forces": torch.zeros(1, 3)}
    key, value = me.SantSignalsRecorder.record_post_step(NS(_env=NS(obs_buf={"sant": sant})))
    assert key == "obs/sant" and value is sant


def _sensor(*forces_n):
    """A contact sensor whose filtered pair forces over the substeps have these magnitudes (newtons, along z)."""
    f = torch.zeros(1, len(forces_n), 1, 1, 3)
    f[0, :, 0, 0, 2] = torch.tensor(forces_n)
    return NS(data=NS(normal_force_matrix_w_history=NS(torch=f), normal_force_matrix_w=None))


def test_contact_forces_are_the_largest_pair_force_per_group_as_replay_reads_them(cfg):
    e = _stub(cfg)
    e.scene.update({"cube_contact": _sensor(0.5, 1.5), "table_contact": _sensor(0.0, 0.0)})
    for i, name in enumerate(scene_cfg.ARM_CONTACT_SENSORS["bin"]):
        e.scene[name] = _sensor(0.0, 3.0 if i == 2 else 0.1)
    f = me.sant_contact_forces(e)
    assert f.shape == (1, 3)
    assert f[0].tolist() == pytest.approx([1.5, 3.0, 0.0])


def test_the_contact_threshold_is_replays():
    try:
        from sim_worker import replay
    except Exception as e:  # replay needs more of Isaac Sim than the config does
        pytest.skip(f"sim_worker.replay doesn't import without the app: {e}")
    assert mimic.CONTACT_N == replay.CONTACT_N
