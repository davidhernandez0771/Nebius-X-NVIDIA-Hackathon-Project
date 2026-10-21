"""sim_worker/rl_env_cfg.py, rl_register.py, rl_ppo_cfg.py: the RL teacher's Isaac Lab env, checked without starting
Isaac.

Needs Isaac Lab (run with Isaac Lab's Python; SANT's venv skips the whole file). Nothing here launches the app or
builds a simulation: the configs are built and read, the registration is looked up, and the env's monitor and reset
event run on small torch tensors standing in for the scene.

    set PYTHONPATH=.;src
    C:\\isaac\\env_isaaclab\\Scripts\\python.exe -m pytest --noconftest -p no:cacheprovider tests/test_rl_env.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace as NS

import numpy as np
import pytest

MIMIC_SRC = os.environ.get("ISAACLAB_MIMIC_SRC", r"C:\isaac\IsaacLab\source\isaaclab_mimic")
torch = pytest.importorskip("torch")
pytest.importorskip("isaaclab.envs")
pytest.importorskip("isaaclab_rl")
if MIMIC_SRC not in sys.path and os.path.isdir(MIMIC_SRC):
    sys.path.insert(0, MIMIC_SRC)

from demo_pipeline import rl_demo_bank as bank_mod  # noqa: E402
from demo_pipeline import rl_teacher as rt  # noqa: E402
from sim_worker import rl_env_cfg as rc  # noqa: E402
from sim_worker import rl_ppo_cfg, rl_register  # noqa: E402

EPISODES = Path(__file__).parent / "data" / "rl_episodes"


@pytest.fixture(scope="module")
def cfg():
    return rc.SantPickPlaceRLEnvCfg()


def test_it_steps_at_sants_50_hz_with_many_envs_on_the_2_m_grid(cfg):
    assert cfg.sim.dt * cfg.decimation == pytest.approx(rt.STEP_S)
    assert cfg.episode_length_s == pytest.approx(rc.EPISODE_S)
    assert cfg.scene.num_envs == 4096 and cfg.scene.env_spacing % 2 == 0
    assert cfg.scene.front is None and cfg.scene.wrist is None  # state only


def test_the_action_is_an_absolute_tool_target_and_a_binary_gripper(cfg):
    arm, grip = cfg.actions.arm_action, cfg.actions.gripper_action
    assert arm.class_type == "sim_worker.rl_action:SantTcpTargetAction"
    assert arm.controller.command_type == "pose" and arm.controller.use_relative_mode is False
    assert arm.vel_ff  # SANT's replay tracking
    from sim_worker.robots import robot_spec

    assert arm.controller.joint_limit_avoidance_gain == robot_spec("franka").ik_limit_gain  # replay's IK settings
    assert grip.close_command_expr == {"panda_finger_.*": 0.0}


def test_rewards_terminations_and_the_two_arms(cfg):
    assert {k: v.weight for k, v in vars(cfg.rewards).items() if hasattr(v, "weight")} == {
        "progress": 1.0, "penalty": -1.0, "success": 1.0, "action_rate": -1e-3, "joint_vel": -1e-4}
    assert list(vars(cfg.terminations))[0] == "success"  # first: it brings the monitor up to the step
    p = cfg.events.reset_scene.params
    assert p["demo_prob"] == 0.5 and p["bank_path"].endswith("bank_mouse20261020.npz")
    no = rc.SantPickPlaceRLNoDemoEnvCfg().events.reset_scene.params
    assert no["demo_prob"] == 0.0 and no["bank_path"] == ""
    play = rc.SantPickPlaceRLPlayEnvCfg()
    assert play.scene.num_envs == 40 and play.events.reset_scene.params["demo_prob"] == 0.0
    obs = list(vars(cfg.observations.policy))
    for name in ("joint_pos", "tcp_pos", "cube_pos", "cube_quat", "bin", "cube_in_bin", "actions"):
        assert name in obs


def test_the_observation_is_rl_teachers_spec_in_order(cfg):
    """sim_worker/rl_policy.py rebuilds the observation from rl_teacher.OBS_SPEC: the env's terms must be exactly it."""
    terms = [k for k, v in vars(cfg.observations.policy).items() if hasattr(v, "func")]
    assert terms == [name for name, _ in rt.OBS_SPEC]
    import isaaclab.envs.mdp as mdp

    assert cfg.observations.policy.joint_pos.func is mdp.joint_pos  # absolute, as a TeacherState gives them
    assert cfg.observations.policy.joint_vel.func is mdp.joint_vel


def test_ppo_is_the_lifts_with_a_longer_horizon():
    ppo = rl_ppo_cfg.SantRLTeacherPPOCfg()
    assert ppo.num_steps_per_env == 24 and ppo.max_iterations == 1500 and ppo.clip_actions == 1.0
    assert ppo.algorithm.gamma == 0.99 and ppo.actor.obs_normalization
    assert rl_ppo_cfg.SantRLTeacherNoDemoPPOCfg().experiment_name.endswith("nodemo")


def test_registration_and_no_usd_before_isaac_sim_starts():
    import subprocess

    import gymnasium as gym

    rl_register.register()
    for task, (env_cfg, ppo) in rl_register.TASKS.items():
        kw = gym.spec(task).kwargs
        assert kw["env_cfg_entry_point"].endswith(env_cfg) and kw["rsl_rl_cfg_entry_point"].endswith(ppo)
    code = "\n".join([
        "import sys",
        "from sim_worker.rl_register import register",
        "register()",
        "from isaaclab_tasks.utils.parse_cfg import parse_env_cfg",
        "parse_env_cfg('SANT-PickPlace-Franka-RL-v0', device='cpu', num_envs=2)",
        "print('PXR', 'pxr' in sys.modules)",
    ])
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = dict(os.environ, PYTHONPATH=os.pathsep.join([root, os.path.join(root, "src"), MIMIC_SRC]))
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=600)
    assert "PXR False" in out.stdout, out.stdout[-2000:] + out.stderr[-2000:]


# --- the monitor: reward parts per step, and check_success on finished episodes ------------------------------


def _episode(name):
    d = EPISODES / name
    s, g = np.load(d / "steps.npz"), np.load(d / "signals.npz")
    scene = json.loads((d / "scene.json").read_text())
    states = rt.episode_states(s["ee_pos"], g["cube_pos"], s["gripper"], g["contact_gripper_cube"],
                               g["contact_arm_bin"], g["contact_arm_table"], g["max_contact_force"],
                               scene["bin_pose"]["pos"], scene["bin_pose"]["quat_wxyz"])
    return states, g, scene, json.loads((d / "verification.json").read_text())


@pytest.mark.parametrize("name", ["verified", "collision", "dropped"])
def test_the_monitor_pays_the_reward_and_runs_check_success_like_the_episode_says(name):
    states, g, scene, verdict = _episode(name)
    mon = rc.EpisodeMonitor(1, "cpu", max_steps=len(states) + 5, track_every=1)
    to_t = lambda s: rt.StepState(*(torch.as_tensor(np.asarray(v)) for v in s))  # noqa: E731
    total, ended = 0.0, None
    for k, s in enumerate(states):
        arm_bin, arm_table = (torch.as_tensor(g[f][k:k + 1]) for f in ("contact_arm_bin", "contact_arm_table"))
        mon.update(to_t(s), arm_bin, arm_table)
        total += float(mon.progress[0] - mon.penalty[0] + mon.bonus[0])
        if bool(mon.success[0]):
            ended = k
            break
    pure = rt.episode_return(states)
    assert ended == pure["success_bonus_at"]
    assert total == pytest.approx(pure["return"], abs=1e-3)
    # the episode ends: check_success on the record (the whole recorded episode when it never succeeded)
    w, x, y, z = scene["bin_pose"]["quat_wxyz"]
    mon.finish(torch.tensor([0]), torch.tensor([scene["bin_pose"]["pos"]]), torch.tensor([[x, y, z, w]]))
    (res,) = mon.results
    if ended is None:  # the full record: exactly SANT's verdict
        assert res["success"] == verdict["success"] and set(res["reasons"]) >= set(verdict["reasons"]) - {"unreachable"}
    else:  # ended at the bonus: check_success passes on the episode as the env cuts it
        assert res["success"] and res["bonus"]
    assert mon.log()["Metrics/check_success"] == float(res["success"]) and mon.results == []
    assert bool(mon.fresh[0]) and int(mon.length[0]) == 0  # cleared for the next episode


def test_after_a_reset_the_first_step_pays_nothing_for_where_it_starts():
    states, g, _, _ = _episode("verified")
    to_t = lambda s: rt.StepState(*(torch.as_tensor(np.asarray(v)) for v in s))  # noqa: E731
    mon = rc.EpisodeMonitor(1, "cpu", max_steps=50, track_every=1)
    mon.update(to_t(states[0]), torch.zeros(1, dtype=torch.bool), torch.zeros(1, dtype=torch.bool))
    mon.reset(torch.tensor([0]))
    mid = len(states) // 2  # a demo start mid-carry: a high potential, but no reward for it
    mon.update(to_t(states[mid]), torch.zeros(1, dtype=torch.bool), torch.zeros(1, dtype=torch.bool))
    assert float(mon.progress[0]) == 0.0 and float(mon.bonus[0]) == 0.0


# --- the reset event on a stand-in env ---------------------------------------------------------------------


class _Obj:
    def __init__(self, n, joints=0):
        self.calls = []
        q = torch.tensor([[0.0, 0.0, 0.0, 1.0]]).repeat(n, 1)
        self.data = NS(root_quat_w=NS(torch=q), root_pos_w=NS(torch=torch.zeros(n, 3)),
                       default_joint_pos=NS(torch=torch.arange(joints, dtype=torch.float32).repeat(n, 1)))

    def __getattr__(self, name):
        if name.startswith(("write_", "set_")):
            return lambda **kw: self.calls.append((name, kw))
        raise AttributeError(name)


class _Scene(dict):
    """env.scene: objects by name, plus env_origins."""


def test_the_reset_writes_every_object_in_one_batch_from_the_plan(tmp_path):
    from tests.test_dp_rl_demo_bank import _store

    bank, meta = bank_mod.build_bank(_store(tmp_path), stride=5)
    path = tmp_path / "bank.npz"
    bank_mod.save_bank(path, bank, meta)
    n = 6
    objs = _Scene({k: _Obj(n, joints=9 if k == "robot" else 0) for k in ["robot", "cube", *rc.mimic.BIN_PART_CENTERS]})
    objs.env_origins = torch.arange(n, dtype=torch.float32)[:, None].repeat(1, 3) * 8.0
    env = NS(num_envs=n, device="cpu", common_step_counter=0, extras={}, scene=objs)
    ids = torch.tensor([1, 3, 4])
    rc.reset_rl_scene(env, ids, bank_path=str(path), demo_prob=1.0, curriculum_start=0.5)
    robot_calls = dict((c, kw) for c, kw in objs["robot"].calls)
    assert set(robot_calls) == {"write_joint_position_to_sim_index", "write_joint_velocity_to_sim_index",
                                "set_joint_position_target_index"}
    q = robot_calls["write_joint_position_to_sim_index"]["position"]
    assert q.shape == (3, 9) and torch.equal(robot_calls["set_joint_position_target_index"]["target"], q)
    rows = [np.flatnonzero(np.all(np.isclose(bank["joint_pos"], r.numpy()), axis=1)) for r in q]
    assert all(r.size and bank["progress"][r].max() >= 0.5 for r in rows)  # demo states past the curriculum floor
    for name in ["cube", *rc.mimic.BIN_PART_CENTERS]:
        [(_, kw)] = [c for c in objs[name].calls if c[0] == "write_root_pose_to_sim_index"]  # one batched write
        pose = kw["root_pose"]
        assert pose.shape == (3, 7) and torch.equal(kw["env_ids"], ids)
        # in each env's own frame: the env origin added
        assert torch.all(pose[:, 0] > objs.env_origins[ids, 0])
    assert any(c[0] == "write_root_velocity_to_sim_index" for c in objs["cube"].calls)
    assert not any(c[0] == "write_root_velocity_to_sim_index" for c in objs["bin_floor"].calls)  # kinematic
    assert env.extras["log"]["Curriculum/demo_start_share"] == 1.0
    # home starts: no bank needed, the robot's default joints
    env2 = NS(num_envs=n, device="cpu", common_step_counter=0, extras={}, scene=_Scene(
        {k: _Obj(n, joints=9 if k == "robot" else 0) for k in ["robot", "cube", *rc.mimic.BIN_PART_CENTERS]}))
    env2.scene.env_origins = torch.zeros(n, 3)
    rc.reset_rl_scene(env2, None, bank_path="", demo_prob=0.0)
    q2 = dict(env2.scene["robot"].calls)["write_joint_position_to_sim_index"]["position"]
    assert q2.shape == (n, 9) and torch.allclose(q2[0], torch.tensor(rt.HOME_JOINTS))  # SANT's home, not Isaac's default


def test_held_starts_get_a_grace_and_closed_fingers_and_the_start_rows_are_kept(tmp_path):
    from tests.test_dp_rl_demo_bank import _store

    bank, meta = bank_mod.build_bank(_store(tmp_path), stride=5)
    path = tmp_path / "bank.npz"
    bank_mod.save_bank(path, bank, meta)
    n = 6

    def env_with():
        objs = _Scene({k: _Obj(n, joints=9 if k == "robot" else 0) for k in ["robot", "cube", *rc.mimic.BIN_PART_CENTERS]})
        objs.env_origins = torch.zeros(n, 3)
        return NS(num_envs=n, device="cpu", common_step_counter=0, extras={}, scene=objs)

    env = env_with()
    rc.reset_rl_scene(env, None, bank_path=str(path), demo_prob=1.0, curriculum_start=0.0, bank_phase="held",
                      held_grace_steps=10)
    rows, used = env._sant_rl_start_row.numpy(), env._sant_rl_bank  # rows index the env's (filtered) bank
    assert np.all(rows >= 0) and np.all(used["phase"] == bank_mod.HELD) and len(used["phase"]) < len(bank["phase"])
    assert env._sant_rl_grace.tolist() == [10] * n
    calls = dict(env.scene["robot"].calls)
    q, target = calls["write_joint_position_to_sim_index"]["position"], calls["set_joint_position_target_index"]["target"]
    np.testing.assert_allclose(q.numpy(), used["joint_pos"][rows], atol=1e-6)  # restored as recorded
    assert torch.all(target[:, 7:] == 0.0) and torch.equal(target[:, :7], q[:, :7])  # fingers commanded closed
    assert env.extras["log"]["Curriculum/held_start_share"] == 1.0
    # without the grace (the default), nothing changes: the targets are the restored joints
    env = env_with()
    rc.reset_rl_scene(env, None, bank_path=str(path), demo_prob=1.0, curriculum_start=0.0, bank_phase="held")
    calls = dict(env.scene["robot"].calls)
    assert torch.equal(calls["set_joint_position_target_index"]["target"], calls["write_joint_position_to_sim_index"]["position"])
    assert env._sant_rl_grace.tolist() == [0] * n


def test_the_gripper_deadband_is_off_by_default(cfg):
    grip = cfg.actions.gripper_action
    assert grip.class_type == "sim_worker.rl_action:SantGraceGripperAction" and grip.deadband == 0.0


# --- the "lift" reward preset (demo_v6) ---------------------------------------------------------------------


def test_the_lift_preset_has_the_stock_lift_penalties_and_curriculum():
    lift = rc.SantPickPlaceRLLiftEnvCfg()
    assert {k: v.weight for k, v in vars(lift.rewards).items() if hasattr(v, "weight")} == {
        "level": 1.0, "penalty": -1.0, "success": 1.0, "action_rate": -1e-4, "joint_vel": -1e-4}
    for term in ("action_rate", "joint_vel"):  # stock lift_env_cfg.py lines 180-186
        c = getattr(lift.curriculum, term)
        assert c.params == {"term_name": term, "weight": -1e-1, "num_steps": 10000}
    assert lift.events.reset_scene.params == rc.SantPickPlaceRLEnvCfg().events.reset_scene.params  # demo starts
    assert vars(rc.SantPickPlaceRLEnvCfg().rewards).keys() >= {"progress"}  # the default is unchanged


@pytest.mark.parametrize("name", ["verified", "collision", "dropped"])
def test_the_monitor_pays_the_lift_preset_like_the_pure_return(name):
    states, g, _, _ = _episode(name)
    max_steps = 600
    mon = rc.EpisodeMonitor(1, "cpu", max_steps=max_steps + 5, track_every=1)
    to_t = lambda s: rt.StepState(*(torch.as_tensor(np.asarray(v)) for v in s))  # noqa: E731
    total, ended = 0.0, None
    for k, s in enumerate(states[:max_steps]):
        arm_bin, arm_table = (torch.as_tensor(g[f][k:k + 1]) for f in ("contact_arm_bin", "contact_arm_table"))
        mon.update(to_t(s), arm_bin, arm_table, remaining=torch.tensor([max_steps - (k + 1)]))
        total += float(mon.lift_level[0] - mon.lift_penalty[0] + mon.lift_bonus[0])
        if bool(mon.success[0]):
            ended = k
            break
    pure = rt.episode_return_lift(states, max_steps=max_steps)
    assert ended == pure["success_bonus_at"]
    assert total == pytest.approx(pure["return"], rel=1e-5, abs=1e-2)
