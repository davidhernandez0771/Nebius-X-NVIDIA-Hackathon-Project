"""The whole SANT pipeline from the site: a run wraps scripts/run_human_demo_experiment.py (select -> physics check ->
repair -> align -> multiply -> grid -> train -> eval -> results), then exports what it made for download.

- recipe.py: what the site asks for, and the runner's command line.
- progress.py: each stage's state, per-item progress and time left, read from the run's files.
- timings.py: the time estimates, learned from earlier runs.
- runs.py: the runs, one at a time in a queue, cancel and resume.
- export.py: the downloads (dataset, Robota-Embed, results, report, provenance).
The routes are in app/routers/pipeline.py; starting runs is off unless SANT_PIPELINE=1.
"""
