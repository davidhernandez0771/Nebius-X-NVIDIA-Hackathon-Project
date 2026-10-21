"""T3's speed cap (rl_teacher.cap_speed, demo_v6c) holds in OUR teacher rollouts: driven through sim_eval.distill.rollout,
the RL teacher's consecutive targets step at most V_MAX x 0.02 s (1 cm) and YAW_RATE_MAX x 0.02 s (0.05 rad), the
first target of every rollout is capped from the tool (rollout resets the teacher), and the cap comes from the run's
params/env.yaml as make() reads it. The toy env's tool follows each target exactly (position and yaw), the case the
cap is for; a tool lagging more than a step behind is held by the one-step-from-the-tool bound instead (T3's tests)."""

from __future__ import annotations

import numpy as np
import pytest

from demo_pipeline import rl_teacher as rt
from demo_pipeline.multiply import sample_scene
from sim_eval.distill import RolloutConfig, rollout
from sim_eval.teacher import TeacherAction, TeacherState
from sim_eval.tests.test_distill import ToyEnv
from sim_worker import rl_policy

STEP_M = rt.V_MAX * rt.STEP_S  # 0.01 m
STEP_YAW = rt.YAW_RATE_MAX * rt.STEP_S  # 0.05 rad
TOL = 1e-9


class YawToyEnv(ToyEnv):
    """ToyEnv whose tool also turns to each target's yaw, so the teacher's next state starts from it."""

    def reset(self, scene):
        super().reset(scene)
        self.quat = np.array(rt.DOWN_WXYZ, dtype=float)

    def teacher_state(self, scene, k, gripper):
        s = super().teacher_state(scene, k, gripper)
        return TeacherState(**{**s.__dict__, "tcp_quat_wxyz": self.quat.copy()})

    def step_teacher(self, a: TeacherAction):
        self.quat = np.asarray(a.ee_quat_wxyz, dtype=float).copy()
        return super().step_teacher(a)


def fast_policy(seed: int = 0):
    """Full-scale steps every time: +x at 2 cm a step (twice the cap), y and yaw random at full scale, z still (clear
    of the soft floor), the gripper open."""
    rng = np.random.default_rng(seed)
    return lambda obs: np.array([1.0, rng.choice([-1.0, 1.0]), 0.0, rng.choice([-1.0, 1.0]), 1.0])


def steps(r):
    ee = r.teacher_ee
    d_pos = np.linalg.norm(np.diff(ee[:, :3], axis=0), axis=1)
    yaw = rt.tool_yaw(ee[:, 3:7])
    d_yaw = np.abs(np.arctan2(np.sin(np.diff(yaw)), np.cos(np.diff(yaw))))
    return d_pos, d_yaw


@pytest.fixture
def scene():
    return sample_scene(np.random.default_rng(4000), "franka", 4000)


def capped_teacher(tmp_path, policy):
    """Built as make() builds it, from a demo_v6c-style run's params/env.yaml (make() itself needs torch: below)."""
    run = tmp_path / "2026-10-21_demo_v6c"
    (run / "params").mkdir(parents=True)
    (run / "params" / "env.yaml").write_text(
        "actions:\n  arm_action:\n    v_max: 0.5\n    yaw_rate_max: 2.5\n  gripper_action:\n    deadband: 0.25\n",
        encoding="utf-8")
    ckpt = run / "exported" / "policy.pt"
    v_max, yaw_rate_max = rl_policy.run_speed_cap(ckpt)
    assert (v_max, yaw_rate_max) == (0.5, 2.5)
    return rl_policy.RLTeacher(policy, name="rl-demo_v6c", gripper_deadband=rl_policy.run_gripper_deadband(ckpt),
                               v_max=v_max, yaw_rate_max=yaw_rate_max)


def test_the_cap_holds_through_our_teacher_rollouts(tmp_path, scene):
    env, teacher = YawToyEnv(), capped_teacher(tmp_path, fast_policy())
    cfg = RolloutConfig(driver="teacher", max_seconds=0.8)  # 40 steps: x stays inside WORKSPACE (<= 0.80)
    for _ in range(2):  # the second rollout reuses the teacher object: rollout's reset must forget the last target
        r = rollout(env, scene, teacher, cfg)
        assert r.ended_by == "time_limit" and len(r.teacher_ee) == 40
        assert np.linalg.norm(r.teacher_ee[0, :3] - [0.45, 0.0, 0.35]) <= STEP_M + TOL  # from the tool, 1 cm
        d_pos, d_yaw = steps(r)
        assert d_pos.max() <= STEP_M + TOL and d_yaw.max() <= STEP_YAW + TOL
        assert d_pos.min() >= STEP_M - 1e-6  # the policy asks for more every step, so the cap is what binds
    # the same policy without the cap (a run before demo_v6c) steps up to one full step per axis
    r = rollout(YawToyEnv(), scene, rl_policy.RLTeacher(fast_policy(), name="rl-old"), cfg)
    d_pos, d_yaw = steps(r)
    assert d_pos.max() > 2 * STEP_M and d_yaw.max() == pytest.approx(rt.DELTA_YAW)


def test_make_reads_the_cap_from_the_run(tmp_path, scene):
    """make() itself, as distill_rollouts.py calls it (Isaac Lab's Python has torch; skipped elsewhere)."""
    torch = pytest.importorskip("torch")

    class Fast(torch.nn.Module):
        def forward(self, x):
            return torch.ones(x.shape[0], rt.ACTION_DIM)  # +x, +y, +z, +yaw at full scale; the gripper open

    teacher = capped_teacher(tmp_path, fast_policy())  # writes the run's params/env.yaml
    run = tmp_path / "2026-10-21_demo_v6c"
    (run / "exported").mkdir()
    torch.jit.script(Fast()).save(str(run / "exported" / "policy.pt"))
    teacher = rl_policy.make(checkpoint=run / "exported" / "policy.pt", device="cpu")
    assert (teacher.v_max, teacher.yaw_rate_max, teacher.gripper_deadband) == (0.5, 2.5, 0.25)
    r = rollout(YawToyEnv(), scene, teacher, RolloutConfig(driver="teacher", max_seconds=0.5))
    d_pos, d_yaw = steps(r)
    assert d_pos.max() <= STEP_M + TOL and d_yaw.max() <= STEP_YAW + TOL
