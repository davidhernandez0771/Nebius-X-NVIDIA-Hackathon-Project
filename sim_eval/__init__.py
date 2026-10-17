"""Policy evaluation in Isaac Lab: N seeded test scenes -> success out of N per trained policy.

Pure modules (scenes, results, registry, eval_policy) import only the stdlib, numpy, pydantic and demo_pipeline, so
they are tested in the SANT venv. Only isaac_env.py and scripts/run_eval.py import Isaac Lab.
"""
