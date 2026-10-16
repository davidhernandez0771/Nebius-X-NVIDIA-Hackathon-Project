"""The eval control loop against a fake env and a fake policy client (no Isaac, no server)."""

from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.schemas import Scene
from lerobot_tools.policy_client import PolicyServerError
from sim_eval.eval_policy import FINGER_IDS, Observation, StepRecord, evaluate, gripper_command, run_episode
from sim_eval.scenes import eval_scenes

OPEN = np.array([0.0] * 7 + [0.04, 0.04], dtype=np.float32)
CLOSED = np.array([0.0] * 7 + [0.0, 0.0], dtype=np.float32)


class FakeEnv:
    """The cube is either already resting in the bin ("in_bin") or stays where the scene put it ("stuck")."""

    cameras = ["front", "wrist"]
    bin_inner = (0.20, 0.20, 0.08)

    def __init__(self, mode: str = "in_bin", fail_at: int | None = None):
        self.mode, self.fail_at = mode, fail_at
        self.scenes, self.actions, self.k = [], [], 0

    def reset(self, scene: Scene) -> None:
        self.scenes.append(scene)
        self.scene, self.k = scene, 0

    def observe(self) -> Observation:
        img = np.full((128, 128, 3), self.k % 256, dtype=np.uint8)
        return Observation(joint_pos=np.full(9, float(self.k)), images={c: img for c in self.cameras})

    def step(self, action: np.ndarray) -> StepRecord:
        if self.fail_at is not None and self.k == self.fail_at:
            raise RuntimeError("PhysX went away")
        self.actions.append(np.array(action))
        self.k += 1
        if self.mode == "in_bin":
            cube = np.asarray(self.scene.bin_pose.pos) + [0.0, 0.0, 0.035]
        else:
            cube = np.asarray(self.scene.cube_pose.pos)
        return StepRecord(tcp_pos=np.array([0.4, 0.0, 0.3]), tcp_quat_wxyz=np.array([0.0, 1.0, 0.0, 0.0]),
                          cube_pos=cube, gripper=gripper_command(action), contact_gripper_cube=False,
                          contact_arm_bin=False, contact_arm_table=False, max_contact_force=0.0)


class FakePolicy:
    def __init__(self, action=OPEN, raise_at: int | None = None):
        self.action, self.raise_at = action, raise_at
        self.resets, self.calls = 0, []

    def reset(self) -> None:
        self.resets += 1

    def act(self, state, images):
        if self.raise_at is not None and len(self.calls) == self.raise_at:
            raise PolicyServerError("POST /act -> 500: RuntimeError: CUDA error", status=500)
        self.calls.append((np.array(state), {k: v.copy() for k, v in images.items()}))
        return self.action


@pytest.fixture
def scene():
    return eval_scenes(1)[0]


def test_gripper_command_reads_the_finger_targets():
    assert FINGER_IDS == (7, 8)
    assert gripper_command(OPEN) == 0 and gripper_command(CLOSED) == 1
    assert gripper_command(np.array([0.0] * 7 + [0.03, 0.03])) == 0
    assert gripper_command(np.array([0.0] * 7 + [0.01, 0.01])) == 1


def test_success_stops_the_episode_at_the_first_passing_check(scene):
    env, policy = FakeEnv("in_bin"), FakePolicy()
    r = run_episode(env, policy, scene, check_every=25)
    # 25 steps = 0.48 s of settling, short of 0.5 s; the 50-step check is the first that passes.
    assert (r.success, r.ended_by, r.steps, r.reasons) == (True, "success", 50, [])
    assert r.sim_s == pytest.approx(49 / 50)
    assert r.seed == scene.seed and r.wall_s > 0
    assert r.final_cube_pos == pytest.approx(list(np.asarray(scene.bin_pose.pos) + [0, 0, 0.035]))


def test_loop_feeds_observations_to_the_policy_and_actions_to_the_env(scene):
    env, policy = FakeEnv("stuck"), FakePolicy()
    run_episode(env, policy, scene, max_seconds=0.2)
    assert env.scenes == [scene] and policy.resets == 1
    assert len(policy.calls) == len(env.actions) == 10
    state3, imgs3 = policy.calls[3]
    np.testing.assert_array_equal(state3, np.full(9, 3.0))  # observation taken before step 3's action
    assert set(imgs3) == {"front", "wrist"} and imgs3["front"][0, 0, 0] == 3
    np.testing.assert_array_equal(env.actions[0], OPEN)


def test_time_limit_ends_a_failing_episode_with_check_success_reasons(scene):
    r = run_episode(FakeEnv("stuck"), FakePolicy(), scene, max_seconds=2.0)
    assert (r.success, r.ended_by, r.steps) == (False, "time_limit", 100)
    assert "not_in_bin" in r.reasons


def test_closed_gripper_at_the_end_is_a_failure(scene):
    r = run_episode(FakeEnv("in_bin"), FakePolicy(CLOSED), scene, max_seconds=2.0)
    assert r.ended_by == "time_limit" and r.reasons == ["gripper_closed"]


def test_default_limit_is_30_s_at_50_hz(scene):
    r = run_episode(FakeEnv("stuck"), FakePolicy(), scene, check_every=500)
    assert r.steps == 1500 and r.sim_s == pytest.approx(29.98)
    assert "too_slow" not in r.reasons


def test_policy_server_error_is_recorded_not_raised(scene):
    r = run_episode(FakeEnv("stuck"), FakePolicy(raise_at=10), scene)
    assert (r.success, r.ended_by, r.steps, r.reasons) == (False, "policy_error", 10, ["policy_error"])
    assert "CUDA error" in r.error


@pytest.mark.parametrize("bad", [np.zeros(8), np.array([np.nan] * 9), np.zeros((1, 9)) + [[np.inf] * 9]])
def test_malformed_actions_are_policy_errors(scene, bad):
    env = FakeEnv("stuck")
    r = run_episode(env, FakePolicy(bad), scene)
    assert r.ended_by == "policy_error" and r.steps == 0 and env.actions == []


def test_a_single_batch_dim_is_accepted(scene):
    r = run_episode(FakeEnv("in_bin"), FakePolicy(OPEN[None, :]), scene)
    assert r.success


def test_simulator_exception_is_recorded_not_raised(scene):
    r = run_episode(FakeEnv("stuck", fail_at=7), FakePolicy(), scene)
    assert (r.ended_by, r.steps, r.reasons) == ("sim_error", 7, ["sim_error"])
    assert "PhysX" in r.error


def test_evaluate_runs_every_scene_and_aggregates():
    scenes = eval_scenes(3)
    env, seen = FakeEnv("in_bin"), []
    episodes, summary = evaluate(env, FakePolicy(), scenes, on_episode=lambda i, ep: seen.append((i, ep.seed)))
    assert env.scenes == scenes
    assert seen == [(0, 5000), (1, 5001), (2, 5002)]
    assert (summary.n, summary.successes, summary.seeds) == (3, 3, [5000, 5001, 5002])
    assert [e.success for e in episodes] == [True] * 3


def test_server_down_at_reset_is_a_policy_error(scene):
    class DownPolicy(FakePolicy):
        def reset(self):
            raise PolicyServerError("POST /reset: cannot reach http://127.0.0.1:8765")

    env = FakeEnv("stuck")
    r = run_episode(env, DownPolicy(), scene)
    assert (r.ended_by, r.steps, r.reasons) == ("policy_error", 0, ["policy_error"])
    assert "cannot reach" in r.error


def test_env_reset_failure_is_a_sim_error(scene):
    class BadEnv(FakeEnv):
        def reset(self, scene):
            raise RuntimeError("stage not ready")

    r = run_episode(BadEnv(), FakePolicy(), scene)
    assert (r.ended_by, r.reasons) == ("sim_error", ["sim_error"]) and "stage" in r.error


def test_a_limit_shorter_than_two_steps_is_refused(scene):
    with pytest.raises(ValueError):
        run_episode(FakeEnv(), FakePolicy(), scene, max_seconds=0.02)
