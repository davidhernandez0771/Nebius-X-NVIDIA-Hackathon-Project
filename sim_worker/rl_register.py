"""Register the RL teacher's envs with gym, for Isaac Lab's RL scripts' --external_callback:

    python C:\\isaac\\IsaacLab\\scripts\\reinforcement_learning\\train.py --rl_library rsl_rl \\
        --task SANT-PickPlace-Franka-RL-v0 --external_callback sim_worker.rl_register.register ...

The callback runs before Isaac Sim starts, so it registers by name only (as sim_worker/mimic_register.py); gym
imports the config (sim_worker/rl_env_cfg.py, no USD) and the action term (sim_worker/rl_action.py) later. It
returns None: it consumes no command-line arguments.
"""

from __future__ import annotations

TASKS = {
    # demo starts from SANT-verified episodes (data/rl/bank_mouse20261020.npz) + home starts
    "SANT-PickPlace-Franka-RL-v0": ("SantPickPlaceRLEnvCfg", "SantRLTeacherPPOCfg"),
    # the control arm: home starts only, no human demo
    "SANT-PickPlace-Franka-RL-NoDemo-v0": ("SantPickPlaceRLNoDemoEnvCfg", "SantRLTeacherNoDemoPPOCfg"),
    # the "lift" reward preset: Isaac Lab's stock lift level rewards + our placed term, fouls and success bonus
    "SANT-PickPlace-Franka-RL-Lift-v0": ("SantPickPlaceRLLiftEnvCfg", "SantRLTeacherPPOCfg"),
    # playing a checkpoint: 40 envs, home starts
    "SANT-PickPlace-Franka-RL-Play-v0": ("SantPickPlaceRLPlayEnvCfg", "SantRLTeacherPPOCfg"),
}


def register() -> None:
    import gymnasium as gym

    from sim_worker.own_code import check_own_code

    check_own_code()  # the Isaac venv's editable install points at another worktree: fail loudly, not quietly
    for task, (env_cfg, ppo_cfg) in TASKS.items():
        if task in gym.registry:
            continue
        gym.register(id=task, entry_point="isaaclab.envs:ManagerBasedRLEnv", disable_env_checker=True,
                     kwargs={"env_cfg_entry_point": f"sim_worker.rl_env_cfg:{env_cfg}",
                             "rsl_rl_cfg_entry_point": f"sim_worker.rl_ppo_cfg:{ppo_cfg}"})
    return None
