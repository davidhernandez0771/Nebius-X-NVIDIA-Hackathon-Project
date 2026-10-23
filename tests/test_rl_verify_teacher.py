"""scripts/rl_verify_teacher.py's pure parts: reading step 1's output, the summary, the agreement count."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest

from demo_pipeline.multiply import sample_scene
from demo_pipeline.schemas import Trajectory

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rl_verify_teacher.py"


@pytest.fixture(scope="module")
def vt():
    spec = importlib.util.spec_from_file_location("rl_verify_teacher", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_runs_are_read_by_seed_with_their_scenes(vt, tmp_path):
    (tmp_path / "trajectories").mkdir()
    (tmp_path / "scenes").mkdir()
    for seed in (5021, 5020, 5030):
        traj = Trajectory.from_arrays(np.arange(3) * 0.02, np.zeros((3, 3)) + 0.3, np.tile([0, 1, 0, 0], (3, 1)),
                                      [0, 1, 0])
        (tmp_path / "trajectories" / f"{seed}.json").write_text(traj.model_dump_json())
        (tmp_path / "scenes" / f"{seed}.json").write_text(sample_scene(np.random.default_rng(seed), "franka", seed)
                                                          .model_dump_json())
    runs = vt.runs_of(tmp_path)
    assert [s for s, _, _ in runs] == [5020, 5021, 5030]
    assert all(scene.seed == s for s, _, scene in runs)
    with pytest.raises(ValueError, match="rl_eval_teacher"):
        vt.runs_of(tmp_path / "nothing")


def test_summary_and_agreement(vt):
    verdicts = {5020: {"success": True, "reasons": []}, 5021: {"success": False, "reasons": ["not_in_bin", "dropped"]},
                5022: {"success": True, "reasons": []}, 5023: {"success": False, "reasons": ["collision"]}}
    s = vt.summarize(verdicts)
    assert (s["successes"], s["n"], s["rate"]) == (2, 4, 0.5) and s["successful_seeds"] == [5020, 5022]
    assert s["failures"] == {"not_in_bin": 1, "dropped": 1, "collision": 1}
    assert 0 < s["ci95"][0] < 0.5 < s["ci95"][1] < 1
    in_env = {"5020": {"success": True}, "5021": {"success": True}, "5022": None, "5023": {"success": False}}
    assert vt.agreement(in_env, verdicts) == 2  # 5020 and 5023 agree; 5021 differs; 5022 has no in-env verdict
    assert vt.agreement({}, verdicts) is None


def test_the_train_command_is_isaac_labs_trainer_on_our_registered_task():
    spec = importlib.util.spec_from_file_location("rl_train", SCRIPT.parent / "rl_train.py")
    rl_train = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rl_train)
    cmd = rl_train.train_command(demos=True, num_envs=64, max_iterations=20, run_name="smoke")
    assert cmd[1].endswith(r"scripts\reinforcement_learning\train.py") or cmd[1].endswith("reinforcement_learning/train.py")
    joined = " ".join(cmd)
    assert "--rl_library rsl_rl" in joined and "--task SANT-PickPlace-Franka-RL-v0" in joined
    assert "--external_callback sim_worker.rl_register.register" in joined and "--num_envs 64 --max_iterations 20" in joined
    no = rl_train.train_command(demos=False, num_envs=4096, max_iterations=1500, run_name="nodemo", checkpoint="ck.pt",
                                overrides=["env.events.reset_scene.params.demo_prob=0.8"])
    assert "SANT-PickPlace-Franka-RL-NoDemo-v0" in no and no[-3:] == ["--checkpoint", "ck.pt",
                                                                      "env.events.reset_scene.params.demo_prob=0.8"]
    env = rl_train.child_env()
    assert env["PYTHONPATH"].split(";")[:2] == [str(rl_train.REPO), str(rl_train.REPO / "src")]
    assert rl_train.main(["--smoke", "--dry-run"]) == 0  # no lock, no Isaac


def test_the_lift_reward_preset_is_its_own_task_and_off_by_default():
    spec = importlib.util.spec_from_file_location("rl_train", SCRIPT.parent / "rl_train.py")
    rl_train = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rl_train)
    default = rl_train.train_command(demos=True, num_envs=64, max_iterations=20, run_name="smoke")
    assert default[default.index("--task") + 1] == "SANT-PickPlace-Franka-RL-v0"
    lift = rl_train.train_command(demos=True, num_envs=64, max_iterations=20, run_name="v6", reward="lift")
    assert lift[lift.index("--task") + 1] == rl_train.LIFT_TASK == "SANT-PickPlace-Franka-RL-Lift-v0"
    with pytest.raises(ValueError):
        rl_train.train_command(demos=False, num_envs=64, max_iterations=20, run_name="x", reward="lift")
    assert rl_train.main(["--smoke", "--reward", "lift", "--dry-run"]) == 0


def test_the_stock_sanity_run_is_isaac_labs_task_unchanged():
    spec = importlib.util.spec_from_file_location("rl_train", SCRIPT.parent / "rl_train.py")
    rl_train = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rl_train)
    cmd = rl_train.stock_command("IsaacContrib-Lift-Cube-Franka", num_envs=4096, max_iterations=400,
                                 run_name="stock_lift")
    assert cmd[cmd.index("--task") + 1] == "IsaacContrib-Lift-Cube-Franka" and "--external_callback" not in cmd
    assert cmd[cmd.index("--max_iterations") + 1] == "400"
    assert rl_train.main(["--stock-task", "IsaacContrib-Lift-Cube-Franka", "--run-name", "stock_lift",
                          "--max-iterations", "400", "--dry-run"]) == 0


def test_ppo_from_a_bc_checkpoint_loads_it_with_a_fresh_optimizer(tmp_path):
    spec = importlib.util.spec_from_file_location("rl_train", SCRIPT.parent / "rl_train.py")
    rl_train = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rl_train)
    ck = tmp_path / "model_0.pt"
    ck.write_bytes(b"")
    cmd = rl_train.train_command(demos=True, num_envs=64, max_iterations=20, run_name="bc", checkpoint=str(ck),
                                 fresh_optimizer=True)
    i = cmd.index("--checkpoint")
    assert cmd[i + 1] == str(ck.resolve()) and cmd[i + 2] == "--no-resume_optimizer_state"
    assert "--no-resume_optimizer_state" not in rl_train.train_command(
        demos=True, num_envs=64, max_iterations=20, run_name="r", checkpoint=str(ck))


# the commands the gated teacher was trained with (data/rl/demo_v6.log, data/rl/demo_v6c2.log, 2026-10-21)
V6_LOGGED = ["env.events.reset_scene.params.held_grace_steps=10", "env.events.reset_scene.params.curriculum_steps=24000",
             "env.events.reset_scene.params.uniform_share=0.5", "agent.actor.distribution_cfg.init_std=0.6",
             "agent.actor.distribution_cfg.std_range=[0.3,1.0]", "agent.algorithm.entropy_coef=0.005",
             "env.actions.gripper_action.deadband=0.25"]
V6C2_LOGGED = ["env.events.reset_scene.params.held_grace_steps=10", "env.events.reset_scene.params.curriculum_start=0.0",
               "env.events.reset_scene.params.uniform_share=0.5", "env.rewards.action_rate.weight=-0.1",
               "env.rewards.joint_vel.weight=-0.1", "agent.actor.distribution_cfg.std_range=[0.1,0.5]",
               "agent.algorithm.entropy_coef=0.005", "env.actions.gripper_action.deadband=0.25"]


def _rl_train():
    spec = importlib.util.spec_from_file_location("rl_train", SCRIPT.parent / "rl_train.py")
    rl_train = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rl_train)
    return rl_train


def test_the_teacher_presets_are_the_gated_teachers_logged_commands():
    rl_train = _rl_train()
    v6, v6c2 = rl_train.PRESETS["teacher_v6"], rl_train.PRESETS["teacher_v6c2"]
    assert (v6["reward"], v6["max_iterations"], v6["resume_std"]) == ("lift", 1500, None)
    # stage 1 trained before the speed cap existed: the preset turns the (now default) cap off
    assert v6["overrides"] == V6_LOGGED + ["env.actions.arm_action.v_max=0.0", "env.actions.arm_action.yaw_rate_max=0.0"]
    assert (v6c2["reward"], v6c2["max_iterations"], v6c2["resume_std"]) == ("lift", 600, 0.3)
    assert v6c2["overrides"] == V6C2_LOGGED  # the cap at its defaults (0.5 m/s, 2.5 rad/s)


def test_overrides_on_a_preset_replace_the_same_key_and_add_the_rest():
    rl_train = _rl_train()
    merged = rl_train.merge_overrides(["a.b=1", "c=2"], ["c=3", "d=4"])
    assert merged == ["a.b=1", "c=3", "d=4"]
    assert rl_train.merge_overrides(["a=1"], []) == ["a=1"]


def test_preset_stage_1_dry_run_is_the_v6_command(capsys):
    rl_train = _rl_train()
    assert rl_train.main(["--preset", "teacher_v6", "--dry-run"]) == 0
    cmd = capsys.readouterr().out.strip().splitlines()[-1].split(" ")
    assert cmd[cmd.index("--task") + 1] == rl_train.LIFT_TASK
    assert cmd[cmd.index("--num_envs") + 1] == "4096" and cmd[cmd.index("--max_iterations") + 1] == "1500"
    assert cmd[cmd.index("--run_name") + 1] == "teacher_v6" and "--checkpoint" not in cmd
    assert cmd[-9:] == rl_train.PRESETS["teacher_v6"]["overrides"]


def test_preset_stage_2_resets_the_std_then_resumes_from_the_copy(tmp_path, capsys):
    rl_train = _rl_train()
    with pytest.raises(SystemExit):  # a resume preset needs the stage-1 checkpoint
        rl_train.main(["--preset", "teacher_v6c2", "--dry-run"])
    ck = tmp_path / "model_1499.pt"
    ck.write_bytes(b"")
    assert rl_train.main(["--preset", "teacher_v6c2", "--checkpoint", str(ck), "--run-name", "r2",
                          "--override", "agent.algorithm.entropy_coef=0.001", "--dry-run"]) == 0
    std_line, train_line = capsys.readouterr().out.strip().splitlines()[-2:]
    out = rl_train.WORKDIR / "resume" / "r2" / "model_1499.pt"
    std = std_line.split(" ")
    assert std[1].endswith("rl_checkpoint_std.py") and std[std.index("--std") + 1] == "0.3"
    assert std[std.index("--checkpoint") + 1] == str(ck.resolve()) and std[std.index("--out") + 1] == str(out)
    cmd = train_line.split(" ")
    assert cmd[cmd.index("--checkpoint") + 1] == str(out) and "--no-resume_optimizer_state" not in cmd
    assert cmd[cmd.index("--max_iterations") + 1] == "600"
    assert "agent.algorithm.entropy_coef=0.001" in cmd and "agent.algorithm.entropy_coef=0.005" not in cmd
    assert not out.exists()  # a dry run writes nothing


def test_the_held_fine_tune_preset_is_stage_2_executed_as_the_student():
    rl_train = _rl_train()
    v6h = rl_train.PRESETS["teacher_v6h"]
    assert (v6h["reward"], v6h["max_iterations"], v6h["resume_std"]) == ("lift", 600, 0.3)
    assert v6h["overrides"] == V6C2_LOGGED + ["env.actions.arm_action.held_target=True"]
    assert rl_train.PRESETS["teacher_v6c2"]["overrides"] == V6C2_LOGGED  # unchanged
