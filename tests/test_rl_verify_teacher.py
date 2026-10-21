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
