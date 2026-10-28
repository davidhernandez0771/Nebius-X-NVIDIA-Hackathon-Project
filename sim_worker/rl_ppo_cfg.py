"""PPO for the RL teacher (rsl_rl through Isaac Lab), modelled on IsaacContrib-Lift-Cube-Franka's LiftCubePPORunnerCfg
(24 steps per env, adaptive lr from 1e-4, entropy 0.006, 5 epochs x 4 mini-batches), with what our longer task
needs: gamma 0.99 (the success bonus comes ~300 steps after a home start, where the lift's 0.98 would discount it
to nothing), bigger networks, observation normalisation (metres, radians and velocities mixed), and actions clipped
to [-1, 1] (rl_teacher's action space).

1,500 iterations x 24 steps x 4,096 envs = 147M transitions, the stock lift's budget; the research note's estimate
for it on the RTX 5080 is 20-60 min. scripts/rl_commands.md has the smoke test that measures it first.
"""

from __future__ import annotations

from isaaclab.utils import configclass

from isaaclab_rl.rsl_rl import RslRlMLPModelCfg, RslRlOnPolicyRunnerCfg, RslRlPpoAlgorithmCfg


@configclass
class SantRLTeacherPPOCfg(RslRlOnPolicyRunnerCfg):
    num_steps_per_env = 24
    max_iterations = 1500
    save_interval = 50
    experiment_name = "sant_rl_teacher"
    clip_actions = 1.0
    actor = RslRlMLPModelCfg(
        hidden_dims=[512, 256, 128],
        activation="elu",
        obs_normalization=True,
        distribution_cfg=RslRlMLPModelCfg.GaussianDistributionCfg(init_std=1.0),
    )
    critic = RslRlMLPModelCfg(
        hidden_dims=[512, 256, 128],
        activation="elu",
        obs_normalization=True,
    )
    algorithm = RslRlPpoAlgorithmCfg(
        value_loss_coef=1.0,
        use_clipped_value_loss=True,
        clip_param=0.2,
        entropy_coef=0.006,
        num_learning_epochs=5,
        num_mini_batches=4,
        learning_rate=1.0e-4,
        schedule="adaptive",
        gamma=0.99,
        lam=0.95,
        desired_kl=0.01,
        max_grad_norm=1.0,
    )


@configclass
class SantRLTeacherNoDemoPPOCfg(SantRLTeacherPPOCfg):
    experiment_name = "sant_rl_teacher_nodemo"
