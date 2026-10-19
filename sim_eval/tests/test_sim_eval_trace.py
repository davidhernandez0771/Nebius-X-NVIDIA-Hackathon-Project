"""Per-step traces of eval rollouts (pure): what the policy commanded and what the sim did, every control step.
The sprint 7/8 evals kept only per-episode summaries, which can't say when or why a cube was dropped. No Isaac."""

from __future__ import annotations

import json

import numpy as np

from sim_eval.eval_policy import StepRecord, run_episode
from sim_eval.recording import FrameRecorder, StepTracer, load_trace
from sim_eval.scenes import eval_scenes
from sim_eval.tests.test_sim_eval_loop import CLOSED, FakeEnv, FakePolicy
from sim_eval.tests.test_sim_eval_taskA import ImageEnv


def test_tracer_saves_every_step_of_chosen_seeds(tmp_path):
    env = StepTracer(FakeEnv("stuck"), seeds={5001}, out_dir=tmp_path)
    for scene in eval_scenes(2):
        run_episode(env, FakePolicy(CLOSED), scene, fps=50, max_seconds=0.2, check_every=100)
    env.close()
    assert not (tmp_path / "seed_5000.npz").exists()
    tr = load_trace(tmp_path / "seed_5001.npz")
    assert tr["action"].shape == (10, 9) and tr["joint_pos"].shape == (10, 9)
    np.testing.assert_allclose(tr["action"][0], CLOSED)
    assert tr["joint_pos"][:, 0].tolist() == list(range(10))  # FakeEnv's state encodes the step: obs before action
    assert tr["tcp_pos"].shape == (10, 3) and tr["cube_pos"].shape == (10, 3)
    assert tr["gripper"].tolist() == [1] * 10
    assert tr["contact_gripper_cube"].dtype == bool and tr["max_contact_force"].shape == (10,)
    assert "cube_quat_wxyz" not in tr  # FakeEnv doesn't report it
    meta = json.loads((tmp_path / "seed_5001.json").read_text(encoding="utf-8"))
    assert meta == {"seed": 5001, "n_steps": 10, "fps": 50}


def test_tracer_with_no_seed_list_traces_every_seed(tmp_path):
    env = StepTracer(FakeEnv("stuck"), seeds=None, out_dir=tmp_path)
    for scene in eval_scenes(2):
        run_episode(env, FakePolicy(), scene, fps=50, max_seconds=0.1, check_every=100)
    env.close()
    assert (tmp_path / "seed_5000.npz").exists() and (tmp_path / "seed_5001.npz").exists()


class QuatEnv(FakeEnv):
    def step(self, action):
        rec = super().step(action)
        rec.cube_quat_wxyz = np.array([1.0, 0.0, 0.0, 0.0])
        return rec


def test_tracer_keeps_the_cube_orientation_when_the_env_reports_it(tmp_path):
    env = StepTracer(QuatEnv("stuck"), seeds=None, out_dir=tmp_path)
    run_episode(env, FakePolicy(), eval_scenes(1)[0], fps=50, max_seconds=0.1, check_every=100)
    env.close()
    assert load_trace(tmp_path / "seed_5000.npz")["cube_quat_wxyz"].shape == (5, 4)


def test_step_record_cube_orientation_is_optional():
    rec = StepRecord(tcp_pos=np.zeros(3), tcp_quat_wxyz=np.array([1.0, 0, 0, 0]), cube_pos=np.zeros(3), gripper=0,
                     contact_gripper_cube=False, contact_arm_bin=False, contact_arm_table=False, max_contact_force=0.0)
    assert rec.cube_quat_wxyz is None


def test_tracer_wraps_a_frame_recorder_and_exposes_its_attributes(tmp_path):
    inner = ImageEnv()
    inner.joint_names = ["panda_joint1"]
    env = StepTracer(FrameRecorder(inner, seeds={5000}, out_dir=tmp_path / "frames"), seeds=None,
                     out_dir=tmp_path / "traces")
    assert env.joint_names == ["panda_joint1"] and env.cameras == ["front"]
    run_episode(env, FakePolicy(), eval_scenes(1)[0], fps=50, max_seconds=0.1, check_every=100)
    env.close()
    assert (tmp_path / "frames" / "seed_5000.npz").exists() and (tmp_path / "traces" / "seed_5000.npz").exists()
