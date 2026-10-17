"""Parallel policy evaluation (sprint 7 T2 prototype): N envs in one Isaac process, one policy session per env.

Pure modules (vec_loop, compare, pool) import only the stdlib, numpy, pydantic, demo_pipeline and sim_eval's pure
modules, so they are tested without Isaac. Only isaac_vec_env.py and scripts/ import Isaac Lab.
"""
