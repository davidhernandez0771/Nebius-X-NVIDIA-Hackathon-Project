"""The pure half of the one-command human-demo experiment (scripts/run_human_demo_experiment.py). No Isaac.

Start alignment. A webcam teleop demo starts wherever the hand was when the person pressed Start, so its first
pose differs per demo, and the start state would tell a policy something about the demo (the sprint 3 leak). Every
training episode, raw and multiplied alike, therefore gets a min-jerk move from the home pose to the demo's first
pose: align_home = homeset.rehome(traj, 0), which adds k steps and keeps the demo itself step for step. A variant is
rehome(transform_trajectory(aligned, src, dst), k), exactly as sim_worker/scripts/home_dataset.py makes sprint 6's
home-start variants, so the variants start at home too and never at home moved with the cube.

Variant seeds: source i, variant k -> 3100 + 100 i + k (k < 100), all below the eval scenes (5000+).

The statistics: headline() counts only the pre-registered eval seeds (an episode that ended in sim_error or
policy_error says nothing about the policy and is reported as missing); compare() is the two-sided Fisher exact
test and Wilson 95% CIs from demo_pipeline.stats.
"""

from __future__ import annotations

import fnmatch
import hashlib

from demo_pipeline.multiply import transform_trajectory
from demo_pipeline.schemas import INPUT_MODES, Scene, Trajectory
from demo_pipeline.stats import fisher_exact, wilson_ci
from demo_pipeline.store import DemoStore
from sim_worker.homeset import EVAL_SEED_MIN, rehome

VARIANT_SEED0 = 3100
VARIANTS_MAX = 100  # variants per source: one block of 100 seeds each
ALPHA = 0.05
INFRA_ENDINGS = ("sim_error", "policy_error")
RAW_CONDITION, MULT_CONDITION = "raw", "perfected_multiply"


def select_ids(store: DemoStore, ids: list[str] | None = None, tag: str | None = None,
               input: str | None = None) -> list[str]:
    """The human demos to use: `ids` as given (in that order), or every human demo whose id matches the fnmatch
    pattern `tag`, sorted. With `input` ("camera" | "keyboard" | "mouse"), only demos recorded with that input
    (Demo.input; strict, so older demos without one never match). ValueError for a missing or derived demo, an
    id recorded with another input, or a tag that matches nothing."""
    if (ids is None) == (tag is None):
        raise ValueError("give exactly one of ids or tag")
    if input is not None and input not in INPUT_MODES:
        raise ValueError(f"input must be one of {INPUT_MODES}, got {input!r}")
    if ids is not None:
        for id in ids:
            if not store.has_demo(id):
                raise ValueError(f"demo {id!r} not found in {store.root}")
            if store.get_demo(id).source != "human":
                raise ValueError(f"demo {id!r} is not a human demo ({store.get_demo(id).source})")
            if input is not None and store.get_demo(id).input != input:
                raise ValueError(f"demo {id!r} was recorded with input {store.get_demo(id).input!r}, not {input!r}")
        if len(set(ids)) != len(ids):
            raise ValueError("a demo id is listed twice")
        return list(ids)
    found = sorted(d.id for d in store.list_demos(source="human")
                   if fnmatch.fnmatchcase(d.id, tag) and (input is None or d.input == input))
    if not found:
        raise ValueError(f"no human demo in {store.root} matches {tag!r}" + (f" with input {input!r}" if input else ""))
    return found


def demo_sha256(store: DemoStore, id: str) -> str:
    return hashlib.sha256((store.root / "demos" / id / "demo.json").read_bytes()).hexdigest()


def align_home(traj: Trajectory) -> tuple[Trajectory, int]:
    """(the demo with a move from home to its first pose in front, k = the number of steps that move added)."""
    aligned = rehome(traj, 0)
    return aligned, len(aligned.t) - len(traj.t)


def variant_trajectory(aligned: Trajectory, k: int, src: Scene, dst: Scene) -> Trajectory:
    return rehome(transform_trajectory(aligned, src, dst), k)


def variant_seed(i: int, k: int) -> int:
    if not 0 <= k < VARIANTS_MAX:
        raise ValueError(f"variant {k}: at most {VARIANTS_MAX} variants per source")
    seed = VARIANT_SEED0 + VARIANTS_MAX * i + k
    if i < 0 or seed >= EVAL_SEED_MIN:
        raise ValueError(f"source {i}: seed {seed} would reach the eval scenes ({EVAL_SEED_MIN}+)")
    return seed


def cells(raw_dirs: list[str], mult_dirs: list[str], n_human: int) -> list[dict]:
    """The two training cells, in lerobot_tools.experiments' grid format (names raw_<n>, perfected_multiply_<n>)."""
    if not raw_dirs or not mult_dirs:
        raise ValueError(f"a cell is empty: raw {len(raw_dirs)} episodes, multiplied {len(mult_dirs)}")
    return [{"condition": RAW_CONDITION, "n_human": n_human, "episode_dirs": list(raw_dirs)},
            {"condition": MULT_CONDITION, "n_human": n_human, "episode_dirs": list(mult_dirs)}]


def headline(episodes: list[dict], seed0: int, n: int) -> dict:
    """Successes over the pre-registered seeds seed0..seed0+n-1 only (sim_eval results 'episodes' rows)."""
    registered = list(range(seed0, seed0 + n))
    valid: dict[int, dict] = {}
    for e in episodes:
        if e["seed"] in registered and e["ended_by"] not in INFRA_ENDINGS:
            valid[e["seed"]] = e  # a later row for the same seed (a resume) wins
    k = sum(bool(e["success"]) for e in valid.values())
    missing = [s for s in registered if s not in valid]
    return {"seed0": seed0, "n_registered": n, "n": len(valid), "successes": k,
            "rate": k / len(valid) if valid else None, "complete": not missing, "missing_seeds": missing,
            "successful_seeds": sorted(s for s, e in valid.items() if e["success"])}


def _arm(counts: dict) -> dict:
    k, n = counts["successes"], counts["n"]
    return {"successes": k, "n": n, "rate": k / n if n else None, "ci": list(wilson_ci(k, n)) if n else None}


def compare(raw: dict, mult: dict, alpha: float = ALPHA) -> dict:
    """Raw vs multiplied ({"successes", "n"} each): rates, Wilson 95% CIs and the two-sided Fisher exact p."""
    p = (fisher_exact(raw["successes"], raw["n"], mult["successes"], mult["n"])
         if raw["n"] and mult["n"] else None)
    return {"raw": _arm(raw), "multiplied": _arm(mult), "fisher_p": p, "test": "fisher_exact_two_sided",
            "alpha": alpha, "significant": None if p is None else p < alpha}


def config_diff(old: dict, new: dict) -> list[str]:
    return sorted(k for k in set(old) | set(new) if old.get(k) != new.get(k))
