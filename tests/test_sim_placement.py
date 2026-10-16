"""sim_worker.placement.place_scene: the public scene placement (replay and sim_eval share it).

Runs in Isaac's python without launching the app (isaaclab modules import fine); skipped elsewhere.
"""

from __future__ import annotations

import math
from types import SimpleNamespace

import numpy as np
import pytest

pytest.importorskip("isaaclab")
torch = pytest.importorskip("torch")

from demo_pipeline.schemas import Pose, Scene  # noqa: E402
from sim_worker.placement import place_scene  # noqa: E402
from sim_worker.scene_cfg import BIN_PARTS, FRONT_EYE, FRONT_TARGET  # noqa: E402

ORIGIN = (3.0, -1.0, 0.0)


class _Body:
    def __init__(self):
        self.pose = None
        self.vel = None

    def write_root_pose_to_sim_index(self, *, root_pose):
        self.pose = root_pose.clone()

    def write_root_velocity_to_sim_index(self, *, root_velocity):
        self.vel = root_velocity.clone()


class _Robot:
    def __init__(self):
        self.data = SimpleNamespace(default_joint_pos=SimpleNamespace(torch=torch.arange(9.0)[None]),
                                    default_joint_vel=SimpleNamespace(torch=torch.zeros(1, 9)))
        self.q = self.qd = None

    def write_joint_position_to_sim_index(self, *, position):
        self.q = position.clone()

    def write_joint_velocity_to_sim_index(self, *, velocity):
        self.qd = velocity.clone()


class _Camera:
    def __init__(self):
        self.view = None

    def set_world_poses_from_view(self, eye, target):
        self.view = (eye.clone(), target.clone())


class _Scene(dict):
    def __init__(self):
        super().__init__(robot=_Robot(), cube=_Body(), front=_Camera(), **{n: _Body() for n in BIN_PARTS})
        self.env_origins = torch.tensor([ORIGIN])
        self.resets = 0

    def reset(self):
        self.resets += 1


def _spec(yaw=0.0) -> Scene:
    q = (math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2))
    return Scene(cube_pose=Pose(pos=(0.45, -0.1, 0.025), quat_wxyz=q),
                 bin_pose=Pose(pos=(0.55, 0.25, 0.0), quat_wxyz=q), robot="franka", seed=3)


def test_robot_goes_to_its_default_pose_at_rest():
    sc = _Scene()
    place_scene(sc, _spec(), aim_front_camera=False)
    assert torch.equal(sc["robot"].q, torch.arange(9.0)[None])
    assert torch.equal(sc["robot"].qd, torch.zeros(1, 9))


def test_cube_is_placed_in_the_env_frame_with_an_xyzw_quaternion():
    sc = _Scene()
    yaw = 0.7
    place_scene(sc, _spec(yaw), aim_front_camera=False)
    pose = sc["cube"].pose[0].numpy()
    assert np.allclose(pose[:3], np.add((0.45, -0.1, 0.025), ORIGIN), atol=1e-6)
    assert np.allclose(pose[3:], (0.0, 0.0, math.sin(yaw / 2), math.cos(yaw / 2)), atol=1e-6)  # xyzw
    assert torch.equal(sc["cube"].vel, torch.zeros(1, 6))


def test_bin_parts_follow_the_bin_yaw():
    sc = _Scene()
    place_scene(sc, _spec(math.pi / 2), aim_front_camera=False)
    _size, (cx, cy, cz) = BIN_PARTS["bin_wall_px"]
    got = sc["bin_wall_px"].pose[0, :3].numpy()
    # +x wall center rotates to +y under a 90 degree yaw
    assert np.allclose(got, np.add((0.55 - cy, 0.25 + cx, cz), ORIGIN), atol=1e-6)


def test_scene_reset_once_and_front_camera_aimed_only_when_asked():
    sc = _Scene()
    place_scene(sc, _spec(), aim_front_camera=False)
    assert sc.resets == 1 and sc["front"].view is None
    place_scene(sc, _spec(), aim_front_camera=True)
    eye, target = sc["front"].view
    assert np.allclose(eye[0].numpy(), np.add(FRONT_EYE, ORIGIN))
    assert np.allclose(target[0].numpy(), np.add(FRONT_TARGET, ORIGIN))


def test_replay_keeps_the_names_sim_eval_imports():
    import sim_worker.replay as replay
    from sim_worker.robots import robot_spec

    for name in ("CAMERA_WARMUP_STEPS", "CONTACT_N", "DECIMATION", "PHYSICS_DT", "TCP_OFFSET", "make_sim_cfg"):
        assert hasattr(replay, name), name
    assert replay.TCP_OFFSET == robot_spec("franka").tcp_offset[2]


def test_sim_eval_isaac_env_imports():
    pytest.importorskip("sim_eval")
    import importlib

    importlib.import_module("sim_eval.isaac_env")
