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


def test_the_bonus_waits_for_check_successs_settle_time_whatever_physics_says_the_speed_is():
    """v5's bonus_agrees_with_check_success was 0.85: the body's velocity fell below 0.01 m/s a step before the
    position change did, so the bonus came at 0.48 s of check_success's settle time and the cut episode failed."""
    states, g, scene, _ = _episode("verified")
    mon = rc.EpisodeMonitor(1, "cpu", max_steps=len(states) + 5, track_every=1)
    # physics reporting the cube at rest throughout: the monitor must use the positions, as check_success does
    to_t = lambda s: rt.StepState(*(torch.as_tensor(np.asarray(v)) for v in s))._replace(  # noqa: E731
        cube_speed=torch.zeros(1, dtype=torch.float64))
    ended = None
    for k, s in enumerate(states):
        arm_bin, arm_table = (torch.as_tensor(g[f][k:k + 1]) for f in ("contact_arm_bin", "contact_arm_table"))
        mon.update(to_t(s), arm_bin, arm_table)
        if bool(mon.success[0]):
            ended = k
            break
    assert ended == rt.episode_return(states)["success_bonus_at"]
    w, x, y, z = scene["bin_pose"]["quat_wxyz"]
    mon.finish(torch.tensor([0]), torch.tensor([scene["bin_pose"]["pos"]]), torch.tensor([[x, y, z, w]]))
    (res,) = mon.results
    assert res["bonus"] and res["success"], res["reasons"]


def test_play_episodes_end_a_margin_after_the_bonus_and_training_ones_at_it():
    """The lead's decision A: the gate's trajectories run PLAY_SUCCESS_EXTRA_S past the bonus; training is unchanged."""
    assert rc.SantPickPlaceRLPlayEnvCfg().terminations.success.params == {"extra_s": 0.2}
    assert rc.SantPickPlaceRLEnvCfg().terminations.success.params == {}
    assert rc.SantPickPlaceRLLiftEnvCfg().terminations.success.params == {}
    states, g, scene, _ = _episode("verified")
    mon = rc.EpisodeMonitor(1, "cpu", max_steps=len(states) + 5, track_every=1)
    env = NS(_sant_rl_monitor=mon, common_step_counter=0)
    to_t = lambda s: rt.StepState(*(torch.as_tensor(np.asarray(v)) for v in s))  # noqa: E731
    bonus_at, play_end = None, None
    for k, s in enumerate(states):
        arm_bin, arm_table = (torch.as_tensor(g[f][k:k + 1]) for f in ("contact_arm_bin", "contact_arm_table"))
        mon.update(to_t(s), arm_bin, arm_table)
        mon.step = env.common_step_counter  # the monitor is up to date: done_success only reads it
        if bonus_at is None and bool(rc.done_success(env)[0]):
            bonus_at = k
            assert not bool(rc.done_success(env, extra_s=0.2)[0])
        if bool(rc.done_success(env, extra_s=0.2)[0]):
            play_end = k
            break
    assert bonus_at == rt.episode_return(states)["success_bonus_at"] and play_end == bonus_at + 10
    w, x, y, z = scene["bin_pose"]["quat_wxyz"]
    mon.finish(torch.tensor([0]), torch.tensor([scene["bin_pose"]["pos"]]), torch.tensor([[x, y, z, w]]))
    (res,) = mon.results
    assert res["success"] and res["bonus"] and res["steps"] == play_end + 1


def test_the_monitor_keeps_a_history_with_the_start_and_what_the_episode_reached():
    """log() (each step, in training) empties results; the eval scripts read history. Each verdict says where the
    episode started and whether it ever grasped or lifted (rl_start_breakdown.py)."""
    states, g, scene, _ = _episode("verified")
    mon = rc.EpisodeMonitor(1, "cpu", max_steps=len(states) + 5, track_every=1, keep_history=True)
    to_t = lambda s: rt.StepState(*(torch.as_tensor(np.asarray(v)) for v in s))  # noqa: E731
    for k, s in enumerate(states):
        arm_bin, arm_table = (torch.as_tensor(g[f][k:k + 1]) for f in ("contact_arm_bin", "contact_arm_table"))
        mon.update(to_t(s), arm_bin, arm_table)
        if bool(mon.success[0]):
            break
    w, x, y, z = scene["bin_pose"]["quat_wxyz"]
    mon.finish(torch.tensor([0]), torch.tensor([scene["bin_pose"]["pos"]]), torch.tensor([[x, y, z, w]]),
               start_rows=torch.tensor([17]))
    mon.log()  # what the training log does every step
    assert mon.results == []
    (r,) = mon.history
    assert r["success"] and r["grasped"] and r["lifted"] and r["start_row"] == 17
    assert not bool(mon.ever_lifted[0]) and not bool(mon.ever_grasped[0])  # cleared for the next episode
    assert rc.EpisodeMonitor(1, "cpu", max_steps=5).history is None  # training keeps no history


def test_the_start_breakdown_groups_first_episodes_by_start_type():
    import importlib.util

    spec = importlib.util.spec_from_file_location("rl_start_breakdown",
                                                  Path(__file__).parents[1] / "scripts" / "rl_start_breakdown.py")
    bd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bd)
    phase = np.array([bank_mod.FREE, bank_mod.HELD])
    res = [{"env": 0, "start_row": -1, "success": True, "bonus": True, "grasped": True, "lifted": True, "reasons": []},
           {"env": 0, "start_row": 1, "success": False, "bonus": False, "grasped": False, "lifted": False,
            "reasons": ["not_in_bin"]},  # env 0's second episode: not counted
           {"env": 1, "start_row": 0, "success": False, "bonus": False, "grasped": True, "lifted": False,
            "reasons": ["not_in_bin"]},
           {"env": 2, "start_row": 1, "success": True, "bonus": True, "grasped": False, "lifted": True, "reasons": []}]
    s = bd.summarize(res, phase)
    assert (s["home"]["episodes"], s["home"]["check_success"], s["home"]["lifted"]) == (1, 1, 1)
    assert (s["demo_free"]["episodes"], s["demo_free"]["grasped"], s["demo_free"]["reasons"]) == (1, 1, {"not_in_bin": 1})
    assert (s["demo_held"]["episodes"], s["demo_held"]["check_success"]) == (1, 1)
    assert "home" in bd.table(s)


# --- BC-initialised RL: the pretraining and the obs check (scripts/rl_bc_pretrain.py, rl_bc_check.py) ------------


def _script(name):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_bc_fits_the_actor_ppo_builds_and_saves_a_checkpoint_it_loads_strictly(tmp_path):
    from demo_pipeline import rl_bc

    bc = _script("rl_bc_pretrain")
    d = EPISODES / "verified"
    s, g = dict(np.load(d / "steps.npz")), dict(np.load(d / "signals.npz"))
    scene = json.loads((d / "scene.json").read_text())
    obs, act = rl_bc.episode_pairs(s, g, scene, s["ee_pos"], s["ee_quat"], s["gripper"])
    episode = np.repeat(np.arange(4), len(obs) // 4 + 1)[:len(obs)]
    train, val = bc.split_episodes(episode, 0.25, groups=["a", "a", "b", "c"])
    assert not (train & val).any() and (train | val).all()
    assert len({episode[i] for i in np.flatnonzero(val)} & {0, 1}) in (0, 2)  # a take's variants stay together
    actor, critic, cfg = bc.build_models(rt.OBS_DIM, init_std=0.3)
    rep = bc.fit(actor, obs, act, train, val | train, epochs=20, lr=1e-3, batch=128)
    assert sum(rep["val_mse"]) < 0.5 * sum(rep["zero_action_mse"])
    assert actor.distribution.std_param.detach().tolist() == pytest.approx([0.3] * rt.ACTION_DIM)  # BC leaves it
    path = tmp_path / "model_0.pt"
    torch.save({"actor_state_dict": actor.state_dict(), "critic_state_dict": critic.state_dict(), "iter": 0,
                "infos": None}, path)
    fresh_actor, fresh_critic, _ = bc.build_models(rt.OBS_DIM, init_std=1.0)
    ck = torch.load(path, weights_only=False)
    fresh_actor.load_state_dict(ck["actor_state_dict"], strict=True)  # what Isaac Lab's trainer does on --checkpoint
    fresh_critic.load_state_dict(ck["critic_state_dict"], strict=True)
    assert bc.root_of("human_x_00ab_rules_home_m3100") == bc.root_of("human_x_00ab_rules_home") == "human_x_00ab"


def test_the_obs_check_compares_terms_and_quaternions_up_to_sign():
    chk = _script("rl_bc_check")
    a = np.zeros((3, rt.OBS_DIM))
    b = a.copy()
    lo, hi = chk._offset("tcp_quat")
    a[:, lo:hi] = [0.0, 1.0, 0.0, 0.0]
    b[:, lo:hi] = [0.0, -1.0, 0.0, 0.0]  # the same rotation
    b[0, slice(*chk._offset("cube_pos"))] = [0.01, 0.0, 0.0]
    e = chk.term_errors(a, b)
    assert e["tcp_quat"].max() == 0 and e["tcp_quat_sign_flips"] == 3
    assert e["cube_pos"].tolist() == pytest.approx([0.01, 0.0, 0.0])
    assert chk.summarize(e)["cube_pos"]["n"] == 3


def test_a_checkpoint_copy_gets_the_std_set_on_the_motion_dims_only():
    ck_std = _script("rl_checkpoint_std")
    ck = {"actor_state_dict": {"distribution.std_param": torch.tensor([1.0, 1.0, 1.0, 1.0, 0.3]), "w": torch.ones(2)},
          "critic_state_dict": {}, "optimizer_state_dict": {}, "iter": 1499, "infos": None}
    out = ck_std.set_std(ck, 0.3, [0, 1, 2, 3])
    assert out["actor_state_dict"]["distribution.std_param"].tolist() == pytest.approx([0.3] * 5)
    assert ck["actor_state_dict"]["distribution.std_param"].tolist()[0] == 1.0  # the original untouched
    assert out["iter"] == 1499 and out["actor_state_dict"]["w"] is ck["actor_state_dict"]["w"]


def test_new_runs_train_with_the_speed_cap_on():
    arm = rc.SantPickPlaceRLEnvCfg().actions.arm_action
    assert (arm.v_max, arm.yaw_rate_max) == (rt.V_MAX, rt.YAW_RATE_MAX) == (0.5, 2.5)
    lift = rc.SantPickPlaceRLLiftEnvCfg().actions.arm_action
    assert (lift.v_max, lift.yaw_rate_max) == (0.5, 2.5)


def test_the_tcp_target_terms_own_buffers_dont_shadow_the_tracking_ik_bases():
    """demo_v6c's first launch: the speed cap's _prev_valid was the base's feed-forward flag, set True before the
    base's first feed-forward ran from its zero command (a zero quaternion): NaN joints on step 0."""
    import re

    src = (Path(__file__).parents[1] / "sim_worker" / "rl_action.py").read_text(encoding="utf-8")
    base = (Path(__file__).parents[1] / "sim_worker" / "mimic_tracking.py").read_text(encoding="utf-8")
    cls = src.split("class SantTcpTargetAction", 1)[1].split("\nclass ", 1)[0]
    mine = set(re.findall(r"self\.(_\w+)\s*=", cls))
    theirs = set(re.findall(r"self\.(_\w+)\s*=", base))
    assert not (mine & theirs), sorted(mine & theirs)


def test_every_teacher_preset_override_names_a_real_setting():
    """scripts/rl_train.py's PRESETS (the gated teacher's commands): a renamed setting must fail here, not at 4096 envs."""
    import importlib.util
    import inspect

    spec = importlib.util.spec_from_file_location("rl_train", Path(__file__).parents[1] / "scripts" / "rl_train.py")
    rl_train = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rl_train)
    env_name, ppo_name = rl_register.TASKS[rl_train.LIFT_TASK]
    roots = {"env": getattr(rc, env_name)(), "agent": getattr(rl_ppo_cfg, ppo_name)()}
    for name, preset in rl_train.PRESETS.items():
        for o in preset["overrides"]:
            root, *path = o.split("=", 1)[0].split(".")
            node, parent = roots[root], None
            for part in path:
                if isinstance(node, dict):
                    # a term's params: Isaac Lab's Hydra also takes the term function's other keyword arguments
                    known = set(node) | set(inspect.signature(parent.func).parameters if parent else ())
                    assert part in known, (name, o, part)
                    node, parent = node.get(part), None
                else:
                    assert hasattr(node, part), (name, o, part)
                    node, parent = getattr(node, part), node


def _teacher_ik():
    """T6's numpy IK (sim_eval/teacher_ik.py, pm/distill-dagger): this repo's copy once merged, else T6's worktree."""
    import importlib.util

    for path in (Path(__file__).parents[1] / "sim_eval" / "teacher_ik.py", Path(r"C:\dev\pm-t6\sim_eval\teacher_ik.py")):
        if path.is_file():
            spec = importlib.util.spec_from_file_location("t6_teacher_ik", path)
            mod = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = mod  # its dataclass looks its module up
            spec.loader.exec_module(mod)
            return mod
    pytest.skip("sim_eval/teacher_ik.py (pm/distill-dagger) not found")


class _HeldAsset:
    """The articulation data a held-target solve reads (Isaac Lab 3.0 names, .torch views), and the targets it sets."""

    def __init__(self, root_pos, root_q, hand_pos, hand_q, jac_w, joint_pos):
        def t(x):
            return NS(torch=x)

        self.data = NS(root_pos_w=t(root_pos), root_quat_w=t(root_q), body_pos_w=t(hand_pos[:, None]),
                       body_quat_w=t(hand_q[:, None]), body_link_jacobian_w=t(jac_w[:, None]), joint_pos=t(joint_pos))
        self.pos_targets, self.vel_targets = [], []

    def set_joint_position_target_index(self, target, joint_ids):
        self.pos_targets.append(target.clone())

    def set_joint_velocity_target_index(self, target, joint_ids):
        self.vel_targets.append(target.clone())


def _held_term(asset, n, offset, held=True):
    """A SantTcpTargetAction with Isaac Lab's real IK controller and frame maths, on _HeldAsset (no simulation)."""
    from isaaclab.controllers import DifferentialIKController, DifferentialIKControllerCfg

    from sim_worker.rl_action import SantTcpTargetAction

    term = object.__new__(SantTcpTargetAction)
    ik_cfg = DifferentialIKControllerCfg(command_type="pose", use_relative_mode=False, ik_method="dls")
    term.cfg = NS(held_target=held, body_offset=NS(pos=offset), vel_ff=True, controller=ik_cfg)
    term._asset, term._joint_ids, term._body_idx = asset, list(range(7)), 0
    term._jacobi_body_idx, term._jacobi_joint_ids = 0, list(range(7))
    term._offset_pos = torch.tensor([offset] * n, dtype=torch.float32)
    term._offset_rot = torch.tensor([[0.0, 0.0, 0.0, 1.0]] * n)  # xyzw
    term._jacobian_b = torch.zeros(n, 6, 7)
    term._ik_controller = DifferentialIKController(ik_cfg, num_envs=n, device="cpu")
    term._held_q, term._held_zero_vel = torch.zeros(n, 7), torch.zeros(n, 7)
    term._limits_injected, term._joint_vel = True, torch.full((n, 7), 0.5)
    return term


def _random_arm(n, seed):
    from isaaclab.utils.math import quat_from_euler_xyz

    g = torch.Generator().manual_seed(seed)

    def r(*s):
        return torch.rand(*s, generator=g) * 2 - 1

    root_q = quat_from_euler_xyz(0.1 * r(n), 0.1 * r(n), 3.0 * r(n))  # xyzw (Isaac Lab 3.0)
    hand_q = quat_from_euler_xyz(3.1 + 0.2 * r(n), 0.2 * r(n), 3.0 * r(n))
    return dict(root_pos=0.3 * r(n, 3), root_q=root_q, hand_pos=0.5 * r(n, 3) + torch.tensor([0.4, 0.0, 0.5]),
                hand_q=hand_q, joint_pos=torch.cat([r(n, 7), torch.full((n, 2), 0.04)], dim=1),
                # well conditioned, as an arm away from singularities (a random 6x7 can be near-singular: radians)
                jac_w=0.6 * torch.eye(6, 7).expand(n, 6, 7) + 0.2 * r(n, 6, 7))


def _counting(term):
    calls = []
    real = term._ik_controller.compute

    def compute(*a):
        calls.append(1)
        return real(*a)

    term._ik_controller.compute = compute
    return calls


def test_held_target_solves_once_per_control_step_and_holds_it_with_zero_velocity():
    from isaaclab.utils.math import quat_from_euler_xyz

    n, offset = 3, (0.0, 0.0, 0.1034)
    arm = _random_arm(n, 1)
    asset = _HeldAsset(**arm)
    term = _held_term(asset, n, offset)
    calls = _counting(term)
    ee_pos, ee_quat = term._compute_frame_pose()
    cmd = torch.cat([ee_pos + 0.01, quat_from_euler_xyz(torch.full((n,), 3.1), torch.zeros(n), torch.zeros(n))], 1)
    term._ik_controller.set_command(cmd, ee_pos, ee_quat)
    term._solve_held(ee_pos, ee_quat)
    for _ in range(2):  # the two physics substeps of a control step
        term.apply_actions()
    assert len(calls) == 1  # one solve, at the start of the step
    assert torch.equal(asset.pos_targets[0], asset.pos_targets[1]) and torch.equal(asset.pos_targets[0], term._held_q)
    assert not torch.equal(term._held_q, arm["joint_pos"][:, :7])  # it moved
    assert len(asset.vel_targets) == 2 and all(torch.count_nonzero(v) == 0 for v in asset.vel_targets)
    # off (every run before demo_v6h): Isaac Lab's IK re-solved at every substep, plus the feed-forward
    asset2 = _HeldAsset(**arm)
    off = _held_term(asset2, n, offset, held=False)
    off._ik_controller.set_command(cmd, ee_pos, ee_quat)
    calls2 = _counting(off)
    for _ in range(2):
        off.apply_actions()
    assert len(calls2) == 2 and all(torch.all(v == 0.5) for v in asset2.vel_targets)
    assert torch.allclose(asset2.pos_targets[0], term._held_q, atol=1e-6)  # the same first solve


def test_held_target_is_t6s_student_label_arithmetic():
    """Parity with T6 (2026-10-21): the arm target this term holds == sim_eval.teacher_ik.ik_target, the student's
    label and execution, from the same state: tool = hand + offset, tool Jacobian in the root frame, DLS lambda 0.01."""
    from isaaclab.utils.math import matrix_from_quat, quat_from_euler_xyz, quat_inv, subtract_frame_transforms

    tik = _teacher_ik()
    n, offset = 16, (0.0, 0.0, 0.1034)
    arm = _random_arm(n, 2)
    term = _held_term(_HeldAsset(**arm), n, offset)
    ee_pos, ee_quat = term._compute_frame_pose()
    g = torch.Generator().manual_seed(3)
    tgt_p = ee_pos + 0.02 * (torch.rand(n, 3, generator=g) * 2 - 1)
    tgt_q = quat_from_euler_xyz(3.1 + 0.1 * torch.rand(n, generator=g), 0.1 * torch.rand(n, generator=g),
                                torch.rand(n, generator=g) * 3)
    term._ik_controller.set_command(torch.cat([tgt_p, tgt_q], 1), ee_pos, ee_quat)
    term._solve_held(ee_pos, ee_quat)

    def wxyz(q):
        return np.asarray([q[3], q[0], q[1], q[2]], dtype=np.float64)

    hand_pb, hand_qb = subtract_frame_transforms(arm["root_pos"], arm["root_q"], arm["hand_pos"], arm["hand_q"])
    rot = matrix_from_quat(quat_inv(arm["root_q"]))
    jac = arm["jac_w"].clone()
    jac[:, :3], jac[:, 3:] = torch.bmm(rot, jac[:, :3]), torch.bmm(rot, jac[:, 3:])
    off = np.asarray(offset, dtype=np.float64)
    for i in range(n):
        hq = wxyz(hand_qb[i].numpy())
        tool_p, tool_q = tik.tool_pose(hand_pb[i].numpy().astype(np.float64), hq, off)
        j_tool = tik.tool_jacobian(jac[i].numpy().astype(np.float64), hq, off)
        want = tik.ik_target(arm["joint_pos"][i, :7].numpy().astype(np.float64), j_tool, tool_p, tool_q,
                             tgt_p[i].numpy().astype(np.float64), wxyz(tgt_q[i].numpy()))
        assert np.allclose(term._held_q[i].numpy(), want, atol=1e-5), (i, term._held_q[i].numpy() - want)


def test_new_runs_execute_as_before_unless_held_target_is_set():
    assert rc.SantPickPlaceRLEnvCfg().actions.arm_action.held_target is False
    assert rc.SantPickPlaceRLLiftEnvCfg().actions.arm_action.held_target is False
    assert rc.SantPickPlaceRLPlayEnvCfg().actions.arm_action.held_target is False


def test_the_breakdown_takes_env_overrides_on_top_of_the_runs_settings():
    import importlib.util

    spec = importlib.util.spec_from_file_location("rl_start_breakdown",
                                                  Path(__file__).parents[1] / "scripts" / "rl_start_breakdown.py")
    bd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bd)
    cfg = rc.SantPickPlaceRLEnvCfg()
    bd.apply_overrides(cfg, ["env.actions.arm_action.held_target=True", "env.events.reset_scene.params.demo_prob=0.2",
                             "env.actions.arm_action.v_max=0.25"])
    assert cfg.actions.arm_action.held_target is True and cfg.actions.arm_action.v_max == 0.25
    assert cfg.events.reset_scene.params["demo_prob"] == 0.2
    for bad in ("agent.algorithm.gamma=0.9", "env.actions.arm_action.no_such=1", "env.actions.arm_action.v_max"):
        with pytest.raises(ValueError):
            bd.apply_overrides(cfg, [bad])
