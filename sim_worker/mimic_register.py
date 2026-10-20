"""Register SANT's Isaac Lab Mimic env with gym, for Mimic's scripts' --external_callback:

    generate_dataset.py ... --external_callback sim_worker.mimic_register.register

Mimic calls this before the app launches, so it registers by name only: the env and its config
(sim_worker/mimic_env.py) are imported when gym makes the env, after Isaac Sim is up.
"""

from __future__ import annotations

ENTRY_POINT = "sim_worker.mimic_env:SantPickPlaceMimicEnv"
CFG_ENTRY_POINT = "sim_worker.mimic_env:SantPickPlaceMimicEnvCfg"


def register() -> None:
    """Add SANT-PickPlace-Franka-IK-Abs-Mimic-v0. Returns None: it consumes no command-line arguments, so Mimic's own
    argument check stays strict."""
    import gymnasium as gym

    from demo_pipeline.mimic import ENV_NAME

    if ENV_NAME in gym.registry:
        return None
    gym.register(id=ENV_NAME, entry_point=ENTRY_POINT, kwargs={"env_cfg_entry_point": CFG_ENTRY_POINT}, disable_env_checker=True)
    return None
