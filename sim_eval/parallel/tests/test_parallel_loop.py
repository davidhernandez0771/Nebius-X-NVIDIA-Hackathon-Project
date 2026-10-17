"""The N-env eval loop against a fake vectorized env and fake per-env policies (no Isaac, no server).

The bar: every episode must come out exactly as sim_eval.eval_policy.run_episode scores it serially, whatever the
other envs are doing, and one env's failure must end only its own episode (a sim failure ends every live one).
"""

from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline.schemas import Scene
from lerobot_tools.policy_client import PolicyServerError
from sim_eval.eval_policy import Observation, StepRecord, gripper_command, run_episode
from sim_eval.parallel.vec_loop import evaluate_parallel
from sim_eval.scenes import eval_scenes

OPEN = np.array([0.0] * 7 + [0.04, 0.04], dtype=np.float32)
CLOSED = np.array([0.0] * 7 + [0.0, 0.0], dtype=np.float32)
START = np.full(9, 0.5)
WARMUP = 5


def _record(scene: Scene, mode: str, action) -> StepRecord:
    cube = np.asarray(scene.bin_pose.pos) + [0.0, 0.0, 0.035] if mode == "in_bin" else np.asarray(scene.cube_pose.pos)
    return StepRecord(tcp_pos=np.array([0.4, 0.0, 0.3]), tcp_quat_wxyz=np.array([0.0, 1.0, 0.0, 0.0]),
                      cube_pos=cube, gripper=gripper_command(action), contact_gripper_cube=False,
                      contact_arm_bin=False, contact_arm_table=False, max_contact_force=0.0)


class FakeVecEnv:
    """N envs stepped together. modes: {scene seed: "in_bin" | "stuck"} (default "stuck").
    Each env counts its own steps since its last reset (k), so observations show where that env is."""

    cameras = ["front", "wrist"]
    bin_inner = (0.20, 0.20, 0.08)

    def __init__(self, num_envs: int, modes: dict[int, str] | None = None, fail_at_step: int | None = None,
                 fail_reset_seed: int | None = None):
        self.num_envs, self.modes = num_envs, modes or {}
        self.fail_at_step, self.fail_reset_seed = fail_at_step, fail_reset_seed
        self.scene: list[Scene | None] = [None] * num_envs
        self.k = [0] * num_envs
        self.resets: list[tuple[int, int]] = []  # (global step, seed)
        self.actions: list[np.ndarray] = []  # (N, 9) per global step
        self.steps = 0

    def reset_envs(self, scenes: dict[int, Scene]) -> dict[int, np.ndarray]:
        for i, scene in scenes.items():
            if scene.seed == self.fail_reset_seed:
                raise RuntimeError("stage not ready")
            self.scene[i], self.k[i] = scene, 0
            self.resets.append((self.steps, scene.seed))
        return {i: START.copy() for i in scenes}

    def observe(self) -> list[Observation]:
        out = []
        for i in range(self.num_envs):
            img = np.full((128, 128, 3), self.k[i] % 256, dtype=np.uint8)
            out.append(Observation(joint_pos=np.full(9, float(self.k[i])), images={c: img for c in self.cameras}))
        return out

    def step(self, actions: np.ndarray) -> list[StepRecord]:
        actions = np.asarray(actions)
        assert actions.shape == (self.num_envs, 9)
        if self.fail_at_step is not None and self.steps == self.fail_at_step:
            self.fail_at_step = None  # fail once
            raise RuntimeError("PhysX went away")
        self.actions.append(actions.copy())
        self.steps += 1
        out = []
        for i in range(self.num_envs):
            self.k[i] += 1
            sc = self.scene[i]
            out.append(_record(sc, self.modes.get(sc.seed, "stuck"), actions[i]) if sc is not None else None)
        return out


class FakePolicy:
    def __init__(self, action=OPEN, raise_at: int | None = None, reset_raises: bool = False):
        self.action, self.raise_at, self.reset_raises = action, raise_at, reset_raises
        self.resets, self.calls = 0, []

    def reset(self) -> None:
        if self.reset_raises:
            raise PolicyServerError("POST /reset: cannot reach http://127.0.0.1:8766")
        self.resets += 1
        self.calls = []  # calls since the last reset: one episode's

    def act(self, state, images):
        if self.raise_at is not None and len(self.calls) == self.raise_at:
            raise PolicyServerError("POST /act -> 500: RuntimeError: CUDA error", status=500)
        self.calls.append((np.array(state), {k: v[0, 0, 0] for k, v in images.items()}))
        return self.action


class SerialFake:
    """The serial env equivalent of one FakeVecEnv env, for scoring the same episode with run_episode."""

    cameras = FakeVecEnv.cameras
    bin_inner = FakeVecEnv.bin_inner

    def __init__(self, mode):
        self.mode = mode

    def reset(self, scene):
        self.scene = scene

    def observe(self):
        return Observation(joint_pos=np.zeros(9), images={})

    def step(self, action):
        return _record(self.scene, self.mode, action)


def _strip(ep):
    return ep.model_dump(exclude={"wall_s"})


def test_two_envs_score_every_episode_exactly_like_the_serial_loop():
    scenes = eval_scenes(4)
    modes = {5000: "in_bin", 5001: "stuck", 5002: "stuck", 5003: "in_bin"}
    env = FakeVecEnv(2, modes)
    episodes, summary = evaluate_parallel(env, [FakePolicy(), FakePolicy()], scenes, max_seconds=2.0,
                                          warmup_steps=WARMUP)
    serial = [run_episode(SerialFake(modes[s.seed]), FakePolicy(), s, max_seconds=2.0) for s in scenes]
    assert [_strip(e) for e in episodes] == [_strip(e) for e in serial]
    assert (summary.n, summary.successes, summary.seeds) == (4, 2, [5000, 5001, 5002, 5003])


def test_each_env_needs_its_own_policy_session():
    with pytest.raises(ValueError, match="own policy session"):
        evaluate_parallel(FakeVecEnv(2), [FakePolicy()], eval_scenes(2))


def test_a_limit_shorter_than_two_steps_is_refused():
    with pytest.raises(ValueError):
        evaluate_parallel(FakeVecEnv(1), [FakePolicy()], eval_scenes(1), max_seconds=0.02)


def test_new_envs_hold_their_start_pose_for_the_warmup_before_the_policy_sees_them():
    env, policy = FakeVecEnv(1), FakePolicy()
    evaluate_parallel(env, [policy], eval_scenes(1), max_seconds=0.2, warmup_steps=WARMUP)
    for a in env.actions[:WARMUP]:
        np.testing.assert_array_equal(a[0], START)
    np.testing.assert_array_equal(env.actions[WARMUP][0], OPEN)
    state0, imgs0 = policy.calls[0]
    np.testing.assert_array_equal(state0, np.full(9, float(WARMUP)))  # first observation is after the warmup
    assert imgs0 == {"front": WARMUP, "wrist": WARMUP}
    assert len(policy.calls) == 10 and len(env.actions) == WARMUP + 10


def test_a_freed_env_takes_the_next_scene_while_the_others_keep_running():
    scenes = eval_scenes(3)
    # 5000 succeeds at its 50th step; 5001 runs the full 100; 5002 must start in env 0 as soon as 5000 ends.
    env = FakeVecEnv(2, {5000: "in_bin"})
    episodes, _ = evaluate_parallel(env, [FakePolicy(), FakePolicy()], scenes, max_seconds=2.0, warmup_steps=WARMUP)
    assert env.resets == [(0, 5000), (0, 5001), (WARMUP + 50, 5002)]
    assert env.steps == (WARMUP + 50) + (WARMUP + 100)  # 5002 runs after 5000, in parallel with 5001
    assert [e.steps for e in episodes] == [50, 100, 100]


def test_each_env_slot_is_served_by_its_own_policy_reset_once_per_episode():
    env = FakeVecEnv(2, {5000: "in_bin", 5002: "in_bin"})
    p0, p1 = FakePolicy(), FakePolicy(CLOSED)
    episodes, _ = evaluate_parallel(env, [p0, p1], eval_scenes(3), max_seconds=2.0, warmup_steps=WARMUP)
    assert (p0.resets, p1.resets) == (2, 1)  # env 0 ran 5000 then 5002; env 1 ran 5001
    assert [e.success for e in episodes] == [True, False, True]
    assert "gripper_closed" in episodes[1].reasons  # only env 1's policy closes the gripper


def test_a_policy_error_ends_only_that_envs_episode():
    env = FakeVecEnv(2, {5000: "in_bin", 5001: "in_bin"})
    episodes, _ = evaluate_parallel(env, [FakePolicy(raise_at=10), FakePolicy()], eval_scenes(2), max_seconds=2.0,
                                    warmup_steps=WARMUP)
    bad, good = episodes
    assert (bad.ended_by, bad.steps, bad.reasons) == ("policy_error", 10, ["policy_error"])
    assert "CUDA error" in bad.error
    assert (good.ended_by, good.steps) == ("success", 50)


def test_a_policy_that_cannot_reset_is_a_policy_error_and_the_run_goes_on():
    env = FakeVecEnv(1, {5001: "in_bin"})

    class FlakyPolicy(FakePolicy):
        def reset(self):
            if self.resets == 0 and not hasattr(self, "failed"):
                self.failed = True
                raise PolicyServerError("POST /reset: cannot reach http://127.0.0.1:8765")
            super().reset()

    episodes, _ = evaluate_parallel(env, [FlakyPolicy()], eval_scenes(2), max_seconds=2.0, warmup_steps=WARMUP)
    assert (episodes[0].ended_by, episodes[0].steps, episodes[0].reasons) == ("policy_error", 0, ["policy_error"])
    assert "cannot reach" in episodes[0].error
    assert episodes[1].ended_by == "success"


def test_a_simulator_exception_ends_every_live_episode_and_later_scenes_still_run():
    env = FakeVecEnv(2, {5002: "in_bin"}, fail_at_step=WARMUP + 7)
    episodes, summary = evaluate_parallel(env, [FakePolicy(), FakePolicy()], eval_scenes(3), max_seconds=2.0,
                                          warmup_steps=WARMUP)
    assert [(e.ended_by, e.steps) for e in episodes[:2]] == [("sim_error", 7), ("sim_error", 7)]
    assert all("PhysX" in e.error for e in episodes[:2])
    assert episodes[2].ended_by == "success"
    assert summary.ended_by == {"sim_error": 2, "success": 1}


def test_a_scene_that_fails_to_reset_is_a_sim_error_for_that_scene_only():
    env = FakeVecEnv(1, {5001: "in_bin"}, fail_reset_seed=5000)
    episodes, _ = evaluate_parallel(env, [FakePolicy()], eval_scenes(2), max_seconds=2.0, warmup_steps=WARMUP)
    assert (episodes[0].ended_by, episodes[0].steps) == ("sim_error", 0) and "stage" in episodes[0].error
    assert episodes[1].ended_by == "success"


def test_a_finished_env_holds_its_last_target_instead_of_snapping_to_zero():
    env = FakeVecEnv(2, {5000: "in_bin"})
    evaluate_parallel(env, [FakePolicy(), FakePolicy(CLOSED)], eval_scenes(2), max_seconds=2.0, warmup_steps=WARMUP)
    after = env.actions[WARMUP + 50:]  # env 0 finished at its 50th step; env 1 still runs
    assert after and all(np.array_equal(a[0], OPEN) for a in after)


def test_episodes_are_reported_as_they_end_and_returned_in_scene_order():
    env = FakeVecEnv(2, {5001: "in_bin"})
    seen = []
    episodes, _ = evaluate_parallel(env, [FakePolicy(), FakePolicy()], eval_scenes(2), max_seconds=2.0,
                                    warmup_steps=WARMUP, on_episode=lambda i, ep: seen.append((i, ep.seed)))
    assert seen == [(1, 5001), (0, 5000)]
    assert [e.seed for e in episodes] == [5000, 5001]


def test_more_envs_than_scenes_leaves_the_spare_envs_idle():
    env = FakeVecEnv(3, {5000: "in_bin"})
    episodes, _ = evaluate_parallel(env, [FakePolicy() for _ in range(3)], eval_scenes(1), max_seconds=2.0,
                                    warmup_steps=WARMUP)
    assert [e.ended_by for e in episodes] == ["success"] and env.resets == [(0, 5000)]


def test_the_threaded_map_queries_policies_concurrently_and_keeps_the_order():
    import threading

    from sim_eval.parallel.vec_loop import threaded_act_map

    barrier = threading.Barrier(3, timeout=5)  # deadlocks (BrokenBarrierError) unless all 3 calls overlap

    def call(i):
        barrier.wait()
        return i * 10

    act_map, pool = threaded_act_map(3)
    try:
        assert act_map(call, [2, 0, 1]) == [20, 0, 10]
    finally:
        pool.shutdown()


def test_a_simulator_exception_also_ends_an_episode_that_is_still_warming_up():
    # 5000 succeeds at its 50th step; 5002 then starts in env 0 and the sim fails during its warmup.
    fail = WARMUP + 50 + 2
    env = FakeVecEnv(2, {5000: "in_bin"}, fail_at_step=fail)
    episodes, _ = evaluate_parallel(env, [FakePolicy(), FakePolicy()], eval_scenes(3), max_seconds=2.0,
                                    warmup_steps=WARMUP)
    assert [(e.ended_by, e.steps) for e in episodes] == [("success", 50), ("sim_error", fail - WARMUP),
                                                         ("sim_error", 0)]
