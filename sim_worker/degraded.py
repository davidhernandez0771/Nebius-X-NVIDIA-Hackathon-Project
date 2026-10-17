"""Rendered degraded demos (T2 sprint 3, Task 4): the files written next to each replayed episode. Pure.

<ep>/demo.json  = the degraded Trajectory as a human Demo (human_seconds = its duration), like T1's experiment sets;
<ep>/truth.json = the injected issues (InjectedIssue, dont_care expert stops included) + {"synthetic": true}.
make_case = T1's case mix with an optional home start for the scripted expert (sprint 5 Task 1).
The episode itself (frames, steps, signals, scene/trajectory/verification.json) comes from sim_worker.jobs.run_replay.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from demo_pipeline.degrade import InjectedIssue, degrade
from demo_pipeline.multiply import sample_scene
from demo_pipeline.schemas import Demo, Scene, Trajectory
from sim_worker.scripted import scripted_expert

GENERATOR = "scripts.score_rules_on_degraded.make_case"  # T1's case mix, so frames match the rules baseline
HOME_GENERATOR = "sim_worker.degraded.make_case"


def make_case(seed: int, jitter_mm: float, *,
              home_start: bool = False) -> tuple[Trajectory, list[InjectedIssue], Scene]:
    """scripts.score_rules_on_degraded.make_case (T1's file), with the expert optionally starting from HOME_TCP.

    The settings are drawn from the seed in T1's order, so home_start=False gives T1's case exactly (tested).
    Same scene and issue types either way; with home_start the times shift by the extra home -> cube move.
    """
    rng = np.random.default_rng(seed)
    scene = sample_scene(rng, "franka", seed)
    settings = dict(
        n_pauses=int(rng.integers(0, 3)),
        grasp_offset_mm=float(rng.uniform(4.0, 12.0)),
        slow_factor=1.0 if rng.random() < 0.5 else float(rng.uniform(1.2, 1.6)),
        idle_start_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
        idle_end_s=0.0 if rng.random() < 0.5 else float(rng.uniform(0.5, 1.5)),
    )
    expert = scripted_expert(scene, home_start=home_start)
    traj, truth = degrade(expert, rng, jitter_mm=jitter_mm, expert_stops=True, **settings)
    return traj, truth, scene


def case_name(prefix: str, seed: int) -> str:
    return f"{prefix}_{seed:04d}"


def is_done(ep: Path) -> bool:
    ep = Path(ep)
    return (ep / "verification.json").exists() and (ep / "truth.json").exists()


def write_case_files(ep: Path, *, demo_id: str, traj: Trajectory, scene: Scene, truth: list[InjectedIssue],
                     seed: int, jitter_mm: float, home_start: bool = False) -> None:
    ep = Path(ep)
    ep.mkdir(parents=True, exist_ok=True)
    demo = Demo(id=demo_id, source="human", trajectory=traj, scene=scene, human_seconds=traj.duration)
    (ep / "demo.json").write_text(demo.model_dump_json(), encoding="utf-8")
    body = {"synthetic": True, "generator": HOME_GENERATOR if home_start else GENERATOR, "seed": seed,
            "jitter_mm": jitter_mm, "home_start": home_start, "issues": [i.model_dump() for i in truth]}
    (ep / "truth.json").write_text(json.dumps(body, indent=1), encoding="utf-8")
