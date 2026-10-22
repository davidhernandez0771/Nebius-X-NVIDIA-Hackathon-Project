"""sim_worker/rl_policy.py: the RL teacher behind T6's teacher interface (pm/distill-dagger sim_eval/teacher.py)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline import rl_teacher as rt
from demo_pipeline import soft_floor
from demo_pipeline.multiply import sample_scene
from demo_pipeline.schemas import Pose
from sim_worker import rl_policy


@dataclass(frozen=True)
class TeacherState:
    """sim_eval.teacher.TeacherState's fields, as T6 defines them (pm/distill-dagger 9e69a50)."""

    seed: int
    k: int
    joint_pos: np.ndarray
    joint_vel: np.ndarray
    tcp_pos: np.ndarray
    tcp_quat_wxyz: np.ndarray
    gripper: int
    cube_pos: np.ndarray
    cube_quat_wxyz: np.ndarray
    cube_lin_vel: np.ndarray
    bin_pos: np.ndarray
    bin_quat_wxyz: np.ndarray
    contact_gripper_cube: bool
    extra: dict = field(default_factory=dict)


def _state(seed=5020, tcp=(0.45, 0.0, 0.35)) -> TeacherState:
    s = sample_scene(np.random.default_rng(seed), "franka", seed)
    return TeacherState(seed=seed, k=0, joint_pos=np.asarray(rt.HOME_JOINTS), joint_vel=np.zeros(9),
                        tcp_pos=np.asarray(tcp), tcp_quat_wxyz=np.asarray(rt.DOWN_WXYZ),
                        gripper=0, cube_pos=np.asarray(s.cube_pose.pos), cube_quat_wxyz=np.asarray(s.cube_pose.quat_wxyz),
                        cube_lin_vel=np.zeros(3), bin_pos=np.asarray(s.bin_pose.pos),
                        bin_quat_wxyz=np.asarray(s.bin_pose.quat_wxyz), contact_gripper_cube=False)


def _check_action(a):
    """sim_eval.teacher.check_action's rules."""
    assert np.asarray(a.ee_pos).shape == (3,) and np.asarray(a.ee_quat_wxyz).shape == (4,)
    assert np.isfinite(a.ee_pos).all() and abs(np.linalg.norm(a.ee_quat_wxyz) - 1) < 1e-6
    assert a.gripper in (0, 1)


def test_the_factory_contract_name_reset_act():
    seen = []

    def policy(obs):
        seen.append(obs.copy())
        return np.array([0.0, 0.2, 0.5, 0.3, -0.4])

    t = rl_policy.RLTeacher(policy, name="rl-test")
    assert isinstance(t.name, str) and t.name
    t.reset(sample_scene(np.random.default_rng(5020), "franka", 5020))
    a = t.act(_state())
    _check_action(a)
    assert a.gripper == 1  # < 0 closes, as the env's binary gripper
    # a step from the state's tool pose (0.45, 0, 0.35), pointing down (yaw 0)
    pos, quat, _ = rt.action_to_target(np.array([[0.0, 0.2, 0.5, 0.3, -0.4]]), np.array([[0.45, 0.0, 0.35]]),
                                       np.zeros(1))
    np.testing.assert_allclose(a.ee_pos, pos[0]) and np.testing.assert_allclose(a.ee_quat_wxyz, quat[0])
    # the observation: OBS_SPEC's layout, the previous action fed back, zeroed by reset
    assert seen[0].shape == (rt.OBS_DIM,) and np.all(seen[0][-rt.ACTION_DIM:] == 0)
    t.act(_state())
    np.testing.assert_allclose(seen[1][-rt.ACTION_DIM:], [0.0, 0.2, 0.5, 0.3, -0.4])
    t.reset(None)
    t.act(_state())
    assert np.all(seen[2][-rt.ACTION_DIM:] == 0)


def test_the_observation_is_the_envs_layout():
    st = _state(tcp=(0.5, 0.1, 0.2))
    obs = rt.policy_observation(st, np.arange(5.0))
    at, i = {}, 0
    for name, n in rt.OBS_SPEC:
        at[name] = obs[i : i + n]
        i += n
    assert i == rt.OBS_DIM == 48
    np.testing.assert_allclose(at["joint_pos"], rt.HOME_JOINTS)
    np.testing.assert_allclose(at["tcp_quat"], [1.0, 0.0, 0.0, 0.0])  # DOWN (wxyz 0,1,0,0) as Isaac's xyzw
    np.testing.assert_allclose(at["cube_from_tcp"], st.cube_pos - st.tcp_pos)
    np.testing.assert_allclose(at["bin"][:3], st.bin_pos) and np.testing.assert_allclose(at["bin"][3:], [1.0, 0.0])
    np.testing.assert_allclose(at["cube_in_bin"], st.cube_pos - st.bin_pos)  # an unrotated bin
    np.testing.assert_allclose(at["actions"], np.arange(5.0))
    with pytest.raises(ValueError, match="joint_pos"):
        rt.policy_observation(TeacherState(**{**st.__dict__, "joint_pos": np.zeros(7)}), np.zeros(5))


def test_the_soft_floor_is_the_sim_workers():
    rng = np.random.default_rng(3)
    for _ in range(300):
        yaw = rng.uniform(-math.pi, math.pi)
        bin_pose = Pose(pos=(rng.uniform(0.4, 0.65), rng.uniform(-0.3, 0.3), 0.0),
                        quat_wxyz=(math.cos(yaw / 2), 0.0, 0.0, math.sin(yaw / 2)))
        p = np.array([bin_pose.pos[0] + rng.uniform(-0.2, 0.2), bin_pose.pos[1] + rng.uniform(-0.2, 0.2),
                      rng.uniform(0.0, 0.2)])
        got = rt.soft_floor_z(p[None], np.asarray(bin_pose.pos)[None], np.array([yaw]))[0]
        assert got == pytest.approx(soft_floor.floor_z(p, bin_pose), abs=1e-9)
        clamped = rt.clamp_to_soft_floor(p[None], np.asarray(bin_pose.pos)[None], np.array([yaw]))[0]
        assert tuple(clamped) == pytest.approx(soft_floor.clamp_to_floor(p, bin_pose)[0], abs=1e-9)


def test_a_target_into_the_bin_is_held_at_the_soft_floor():
    st0 = _state()
    st = TeacherState(**{**st0.__dict__, "tcp_pos": np.array([st0.bin_pos[0], st0.bin_pos[1], 0.09])})  # over the bin
    t = rl_policy.RLTeacher(lambda obs: np.array([0.0, 0.0, -1.0, 0.0, 1.0]), name="rl-test")  # down a full step
    a = t.act(st)
    assert a.ee_pos[2] == pytest.approx(soft_floor.floor_z(a.ee_pos, Pose(pos=tuple(st.bin_pos),
                                                                          quat_wxyz=tuple(st.bin_quat_wxyz))))
    assert a.ee_pos[2] > 0.05 and a.gripper == 0


def test_checkpoints_resolve_to_the_exported_policy(tmp_path):
    run = tmp_path / "2026-10-21_demo_v1"
    with pytest.raises(FileNotFoundError, match="rl_eval_teacher"):
        rl_policy.resolve_checkpoint(run)
    (run / "exported").mkdir(parents=True)
    (run / "exported" / "policy.pt").write_bytes(b"x")
    assert rl_policy.resolve_checkpoint(run) == run / "exported" / "policy.pt"


def test_make_loads_the_torchscript_export_and_refuses_a_raw_checkpoint(tmp_path):
    torch = pytest.importorskip("torch")  # Isaac Lab's Python
    run = tmp_path / "2026-10-21_demo_v1"
    (run / "exported").mkdir(parents=True)
    net = torch.nn.Sequential(torch.nn.Linear(rt.OBS_DIM, rt.ACTION_DIM), torch.nn.Tanh())
    torch.jit.script(net).save(str(run / "exported" / "policy.pt"))
    t = rl_policy.make(checkpoint=run, device="cpu")
    assert t.name == "rl-2026-10-21_demo_v1"
    _check_action(t.act(_state()))
    torch.save({"model_state_dict": net.state_dict()}, run / "model_100.pt")
    with pytest.raises(ValueError, match="TorchScript"):
        rl_policy.make(checkpoint=run / "model_100.pt", device="cpu")


def test_no_scripted_or_recovery_teacher_anywhere():
    """The user's rule (T6 has the same test): the teacher is the trained policy, nothing hand-written."""
    root = Path(__file__).resolve().parents[1]
    for f in ("sim_worker/rl_policy.py", "sim_worker/rl_env_cfg.py", "sim_worker/rl_action.py",
              "src/demo_pipeline/rl_teacher.py", "src/demo_pipeline/rl_demo_bank.py"):
        src = (root / f).read_text(encoding="utf-8")
        assert "scripted_expert" not in src and "recovery_trajectory" not in src, f


def test_t6s_teacher_protocol_when_its_module_is_here():
    teacher_mod = pytest.importorskip("sim_eval.teacher")
    t = rl_policy.RLTeacher(lambda obs: np.zeros(rt.ACTION_DIM), name="rl-test")
    assert isinstance(t, teacher_mod.Teacher)
    teacher_mod.check_action(t.act(_state()))


def test_the_adapter_applies_the_runs_gripper_deadband(tmp_path):
    st = _state()
    holding = TeacherState(**{**st.__dict__, "gripper": 1})
    t = rl_policy.RLTeacher(lambda obs: np.array([0.0, 0.0, 0.0, 0.0, 0.3]), name="rl-test", gripper_deadband=0.5)
    assert t.act(holding).gripper == 1  # +0.3 is inside the band: it stays closed
    assert t.act(st).gripper == 0  # and stays open when it was open
    assert rl_policy.RLTeacher(lambda obs: np.array([0, 0, 0, 0, 0.3]), name="rl-test").act(holding).gripper == 0
    run = tmp_path / "2026-10-21_demo_v4"
    (run / "params").mkdir(parents=True)
    (run / "params" / "env.yaml").write_text("actions:\n  gripper_action:\n    deadband: 0.5\n", encoding="utf-8")
    assert rl_policy.run_gripper_deadband(run / "exported" / "policy.pt") == 0.5
    assert rl_policy.run_gripper_deadband(tmp_path / "other" / "exported" / "policy.pt") == 0.0


def test_the_deadband_is_read_from_a_real_isaac_lab_env_yaml(tmp_path):
    """Isaac Lab dumps tuples as !!python/tuple, which yaml.safe_load refuses: demo_v4's own env.yaml (2026-10-21)."""
    import shutil

    real = Path(__file__).resolve().parents[1] / "docs/superpowers/notes/2026-10-20-rl-teacher/demo_v4/env.yaml"
    assert "!!python/tuple" in real.read_text(encoding="utf-8")
    (tmp_path / "run" / "params").mkdir(parents=True)
    shutil.copy(real, tmp_path / "run" / "params" / "env.yaml")
    assert rl_policy.run_gripper_deadband(tmp_path / "run" / "exported" / "policy.pt") == 0.5


def test_the_adapter_applies_the_runs_speed_cap_from_the_previous_target(tmp_path):
    """make() gives T6's rollouts the cap the run trained with (rl_teacher.cap_speed): the targets step at most
    V_MAX * STEP_S apart however fast the tool runs; a reset forgets the previous target."""
    full_x = lambda obs: np.array([1.0, 0.0, 0.0, 0.0, 1.0])  # noqa: E731
    t = rl_policy.RLTeacher(full_x, name="rl-test", v_max=rt.V_MAX, yaw_rate_max=rt.YAW_RATE_MAX)
    t.reset(None)
    first = t.act(_state(tcp=(0.45, 0.0, 0.35))).ee_pos
    assert first[0] == pytest.approx(0.45 + rt.V_MAX * rt.STEP_S)  # from the tool after a reset: 1 cm, not 2
    second = t.act(_state(tcp=(0.465, 0.0, 0.35))).ee_pos  # the tool 1.5 cm on: a full step would be 2.5 cm
    assert np.linalg.norm(second - first) == pytest.approx(rt.V_MAX * rt.STEP_S)
    third = t.act(_state(tcp=(0.53, 0.0, 0.35))).ee_pos  # the tool ran 5 cm past: one step from it wins
    assert np.all(np.abs(third - np.array([0.53, 0.0, 0.35])) <= rt.DELTA_M + 1e-9)
    t.reset(None)
    assert t.act(_state(tcp=(0.45, 0.0, 0.35))).ee_pos[0] == pytest.approx(first[0])
    uncapped = rl_policy.RLTeacher(full_x, name="rl-test").act(_state(tcp=(0.45, 0.0, 0.35))).ee_pos
    assert uncapped[0] == pytest.approx(0.45 + rt.DELTA_M)
    run = tmp_path / "2026-10-21_demo_v6c"
    (run / "params").mkdir(parents=True)
    (run / "params" / "env.yaml").write_text("actions:\n  arm_action:\n    v_max: 0.5\n    yaw_rate_max: 2.5\n",
                                             encoding="utf-8")
    assert rl_policy.run_speed_cap(run / "exported" / "policy.pt") == (0.5, 2.5)
    assert rl_policy.run_speed_cap(tmp_path / "old" / "exported" / "policy.pt") == (0.0, 0.0)  # before the cap


def test_a_run_says_whether_it_trained_with_held_targets(tmp_path):
    run = tmp_path / "2026-10-21_demo_v6h"
    (run / "params").mkdir(parents=True)
    (run / "params" / "env.yaml").write_text("actions:\n  arm_action:\n    v_max: 0.5\n    held_target: true\n",
                                             encoding="utf-8")
    assert rl_policy.run_held_target(run / "exported" / "policy.pt") is True
    assert rl_policy.run_held_target(run / "model_100.pt") is True
    assert rl_policy.run_held_target(tmp_path / "old" / "model_2098.pt") is False  # demo_v6c2 and before
