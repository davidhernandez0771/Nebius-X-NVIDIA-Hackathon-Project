"""Sprint 6 Task A pieces (pure): training scenes with their own start pose, a mixed scene plan, per-group summaries,
and frame recording for a few seeds. No Isaac."""

from __future__ import annotations

import json

import numpy as np
import pytest

from demo_pipeline.schemas import Pose, Scene
from sim_eval.eval_policy import Observation, run_episode
from sim_eval.recording import FrameRecorder, load_frames
from sim_eval.results import EpisodeResult
from sim_eval.scenes import scene_plan, training_scenes
from sim_eval.tests.test_sim_eval_loop import FakeEnv, FakePolicy  # the loop tests' fakes


def _demo(root, name, seed, q0):
    d = root / name
    d.mkdir(parents=True)
    scene = Scene(cube_pose=Pose(pos=(0.5, 0.1 * seed, 0.025), quat_wxyz=(1, 0, 0, 0)),
                  bin_pose=Pose(pos=(0.45, -0.2, 0.0), quat_wxyz=(1, 0, 0, 0)), robot="franka", seed=seed)
    (d / "scene.json").write_text(scene.model_dump_json(), encoding="utf-8")
    jp = np.tile(np.asarray(q0, dtype=np.float32), (4, 1))
    jp[1:] += 0.5  # only frame 0 is the start
    np.savez(d / "steps.npz", joint_pos=jp)
    return d, scene


Q0 = [0.1, 0.2, -0.1, -2.2, 0.0, 2.4, 0.7, 0.04, 0.04]


def test_training_scenes_bring_their_own_start_pose(tmp_path):
    d0, s0 = _demo(tmp_path, "ep_0000", 0, Q0)
    d1, s1 = _demo(tmp_path, "ep_0003", 3, [x + 0.01 for x in Q0])
    got = training_scenes([d0, d1])
    assert [s for s, _ in got] == [s0, s1]
    np.testing.assert_allclose(got[0][1], Q0, rtol=1e-6)
    np.testing.assert_allclose(got[1][1], [x + 0.01 for x in Q0], rtol=1e-6)


def test_scene_plan_puts_training_scenes_first_with_per_seed_starts(tmp_path):
    d0, _ = _demo(tmp_path, "ep_0000", 0, Q0)
    d2, _ = _demo(tmp_path, "ep_0002", 2, Q0)
    scenes, starts, groups = scene_plan(n=3, seed0=5000, train_episode_dirs=[d0, d2])
    assert [s.seed for s in scenes] == [0, 2, 5000, 5001, 5002]
    assert set(starts) == {0, 2}  # unseen scenes use the run's start pose
    assert groups == {"train": [0, 2], "unseen": [5000, 5001, 5002]}


def test_scene_plan_without_training_scenes_is_the_plain_eval():
    scenes, starts, groups = scene_plan(n=2, seed0=5000, train_episode_dirs=[])
    assert [s.seed for s in scenes] == [5000, 5001] and starts == {} and groups == {"unseen": [5000, 5001]}


def test_scene_plan_allows_only_training_scenes(tmp_path):
    d0, _ = _demo(tmp_path, "ep_0000", 0, Q0)
    scenes, _, groups = scene_plan(n=0, seed0=5000, train_episode_dirs=[d0])
    assert [s.seed for s in scenes] == [0] and groups == {"train": [0]}
    with pytest.raises(ValueError):
        scene_plan(n=0, seed0=5000, train_episode_dirs=[])


def test_scene_plan_refuses_duplicate_seeds(tmp_path):
    d0, _ = _demo(tmp_path, "a", 7, Q0)
    d1, _ = _demo(tmp_path, "b", 7, Q0)
    with pytest.raises(ValueError, match="7"):
        scene_plan(n=1, seed0=5000, train_episode_dirs=[d0, d1])


def test_group_summaries_split_by_seed():
    from sim_eval.report import group_summaries

    def ep(seed, ok):
        return EpisodeResult(seed=seed, success=ok, reasons=[] if ok else ["not_in_bin"],
                             ended_by="success" if ok else "time_limit", steps=5, sim_s=0.1, wall_s=1.0)

    out = group_summaries([ep(0, True), ep(2, False), ep(5000, False)], {"train": [0, 2], "unseen": [5000]})
    assert out["train"]["successes"] == 1 and out["train"]["n"] == 2
    assert out["unseen"]["successes"] == 0 and out["unseen"]["n"] == 1


# --- frame recording ------------------------------------------------------------------------------------------------

class ImageEnv(FakeEnv):
    """FakeEnv whose observations carry a front image that encodes the step count."""

    cameras = ["front"]

    def observe(self) -> Observation:
        obs = super().observe()
        k = getattr(self, "_k", 0)
        self._k = k + 1
        return Observation(joint_pos=obs.joint_pos, images={"front": np.full((4, 6, 3), k % 256, dtype=np.uint8)})

    def reset(self, scene):
        self._k = 0
        return super().reset(scene)


def test_recorder_saves_every_kth_frame_for_chosen_seeds_only(tmp_path):
    from sim_eval.scenes import eval_scenes

    env = FrameRecorder(ImageEnv(), seeds={5001}, out_dir=tmp_path, every=2)
    for scene in eval_scenes(2):
        run_episode(env, FakePolicy(), scene, fps=50, max_seconds=0.2, check_every=100)
    env.close()
    assert not (tmp_path / "seed_5000.npz").exists()
    frames = load_frames(tmp_path / "seed_5001.npz")
    assert frames["front"].shape[1:] == (4, 6, 3)
    assert frames["front"][:, 0, 0, 0].tolist() == list(range(0, 10, 2))  # 10 observations, every 2nd kept
    meta = json.loads((tmp_path / "seed_5001.json").read_text(encoding="utf-8"))
    assert meta["every"] == 2 and meta["n_frames"] == 5 and meta["seed"] == 5001
