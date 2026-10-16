"""Rendered degraded demos (T2 sprint 3, Task 4): the files written next to each replayed episode. Pure.

<ep>/demo.json  = the degraded Trajectory as a human Demo (human_seconds = its duration), like T1's experiment sets;
<ep>/truth.json = the injected issues (InjectedIssue, dont_care expert stops included) + {"synthetic": true}.
The episode itself (frames, steps, signals, scene/trajectory/verification.json) comes from sim_worker.jobs.run_replay.
"""

from __future__ import annotations

import json
from pathlib import Path

from demo_pipeline.degrade import InjectedIssue
from demo_pipeline.schemas import Demo, Scene, Trajectory

GENERATOR = "scripts.score_rules_on_degraded.make_case"  # T1's case mix, so frames match the rules baseline


def case_name(prefix: str, seed: int) -> str:
    return f"{prefix}_{seed:04d}"


def is_done(ep: Path) -> bool:
    ep = Path(ep)
    return (ep / "verification.json").exists() and (ep / "truth.json").exists()


def write_case_files(ep: Path, *, demo_id: str, traj: Trajectory, scene: Scene, truth: list[InjectedIssue],
                     seed: int, jitter_mm: float) -> None:
    ep = Path(ep)
    ep.mkdir(parents=True, exist_ok=True)
    demo = Demo(id=demo_id, source="human", trajectory=traj, scene=scene, human_seconds=traj.duration)
    (ep / "demo.json").write_text(demo.model_dump_json(), encoding="utf-8")
    body = {"synthetic": True, "generator": GENERATOR, "seed": seed, "jitter_mm": jitter_mm,
            "issues": [i.model_dump() for i in truth]}
    (ep / "truth.json").write_text(json.dumps(body, indent=1), encoding="utf-8")
