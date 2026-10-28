"""Nemotron as the failure analyst: a policy's measured episodes -> a DataRecipe for the next round of multiplying.

Code measures every episode (demo_pipeline.failure_features) and labels its failure by rules. Code also tabulates the
failure rate per scene condition (failure_table). Nemotron gets those numbers, never pixels, and its job is the part
code doesn't do: say which scene conditions the failures come from, why, and which scenes to generate more of. It
writes a DataRecipe as JSON; demo_pipeline.data_recipe.validate_recipe checks it (ranges, shares, failure classes that
occurred, evidence seeds that exist), and any problem goes back to the model with its own reply, as the scene creator
does.

Run-to-run variance (the repair A/B's plans changed between runs): analyse() asks `k` times independently and keeps
the recipe that agrees most with the others (agreement = mean overlap of their focus regions), reporting the
agreement so a reader can see how stable the diagnosis was.

The recipe is a hypothesis. Whether it helps is decided by training on its scenes against the same number of uniform
scenes (data_recipe.uniform_scenes) and evaluating both on the same unseen seeds.
"""
from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from pydantic import ValidationError

from demo_pipeline.data_recipe import (
    AXES, MAX_REGIONS, MIN_UNIFORM_SHARE, MIN_WIDTH_DEG, MIN_WIDTH_M, DataRecipe, _axis_limits, contrast_table,
    mechanism_errors, support_errors, validate_recipe,
)
from demo_pipeline.failure_features import FAILURE_CLASSES, EpisodeFeatures
from demo_pipeline.multiply import MIN_EDGE_GAP
from nebius_llm import TokenFactoryError, chat

TIER = "super"  # a text task over numbers (config.TIERS)
THINK = True
MAX_TOKENS = 12000  # thinking + the answer
TEMPERATURE = 0.6  # independent samples need some spread; consensus picks among them
RETRIES = 2
K = 3
N_BINS = 3

CLASS_TEXT = {
    "missed_reach": "the fingertips never got within 3 cm (xy) of the cube before closing",
    "missed_grasp": "reached and closed, but the cube was never in the fingers",
    "no_lift": "held the cube but never raised it 3 cm",
    "dropped": "lifted the cube, then lost it with the gripper still closed, not over the bin",
    "collision_table": "arm or gripper pressed the table above 5 N",
    "collision_bin": "arm or gripper pressed the bin above 5 N",
    "release_outside": "opened the gripper with the cube in it, not over the bin",
    "high_release": "opened over the bin with the cube more than 0.18 m up (dropped in, not placed)",
    "stuck": "none of the above and the cube not in the bin: stopped making progress",
    "collision": "the eval reported the arm pressing the table or bin above 5 N (no step trace: which one is unknown)",
}


def failure_table(episodes: list[EpisodeFeatures], robot: str = "franka", n_bins: int = N_BINS) -> list[dict]:
    """For each scene axis, the axis range split into n_bins equal bins: episodes, successes and first-failure
    counts per bin. These are the numbers a pattern claim has to agree with."""
    limits = _axis_limits(robot)
    rows = []
    for axis in AXES:
        lo, hi = limits[axis]
        edges = np.linspace(lo, hi, n_bins + 1)
        vals = np.array([getattr(e.scene, axis) for e in episodes])
        idx = np.clip(np.searchsorted(edges, vals, side="right") - 1, 0, n_bins - 1)
        for b in range(n_bins):
            members = [e for e, i in zip(episodes, idx, strict=True) if i == b]
            rows.append({"axis": axis, "bin": [round(float(edges[b]), 3), round(float(edges[b + 1]), 3)],
                         "n": len(members), "successes": sum(e.success for e in members),
                         "failures": dict(Counter(e.primary for e in members if e.primary is not None))})
    return rows


def system_prompt(robot: str = "franka") -> str:
    limits = _axis_limits(robot)
    classes = "\n".join(f"- {k}: {v}" for k, v in CLASS_TEXT.items())
    ranges = "\n".join(f"- {a}: [{lo}, {hi}]" for a, (lo, hi) in limits.items())
    example = {
        "summary": "Most failures are drops during long carries to bins on the robot's right; grasps are fine.",
        "hypotheses": [{"claim": "drops cluster where the bin is at y < -0.1 and the carry is > 0.35 m",
                        "evidence_seeds": [-1, -2]}],  # placeholders: a copied example is rejected
        "mechanism": [{"feature": "carry_speed_max", "direction": "higher_in_failures",
                       "explanation": "the cube slips out when the hand accelerates during the carry"}],
        "fixes": [{"lever": "slow_carry", "addresses": ["carry_speed_max"], "max_speed_mps": 0.3,
                   "rationale": "keep the carry below the speed where the failed episodes slipped"}],
        "regions": [{"name": "far_right_bin", "targets": ["dropped"],
                     "cube_x": [0.40, 0.60], "cube_y": [-0.05, 0.20], "cube_yaw_deg": [-45, 45],
                     "bin_x": [0.45, 0.65], "bin_y": [-0.30, -0.10], "share": 0.5,
                     "rationale": "more carries of this kind so the policy sees how to hold the cube on them"}],
        "uniform_share": 0.5,
    }
    return f"""You analyse why a learned robot policy fails, and decide which training scenes to generate next.

The robot is a {robot} arm in a simulator, putting a 5 cm cube into an open bin (20 x 20 cm inside, 8 cm walls).
Coordinates are metres, robot base at the origin facing +x; +y is the robot's LEFT. cube_yaw_deg is the cube's turn
to its nearest face, -45 to 45 degrees (the cube looks the same every 90 degrees). New training demos are made by
moving verified demos into new scenes. You can change two things: WHICH scenes (where the cube is, how it is
turned, where the bin is), and HOW the training demos move (fixes, below).

Code has already measured every episode and labelled its first failure with one of these classes:
{classes}

You get: one row per episode (scene and measurements); a table of first-failure counts per bin of each scene axis;
and a contrast table comparing failed and successful episodes on grasp and motion measurements (medians, a
rank-biserial effect where + means higher in failures, and a Mann-Whitney p-value). Use those numbers. Don't claim a
pattern the tables don't show. If the failures don't depend on the scene, give no regions (and uniform_share 1).

Measurements in the contrast table: grasp_offset_xy (m, fingertips to cube centre at the first close), grasp_height
(m, fingertips above the cube centre at the first close), n_closes (1 is a clean grasp, more is regrasping),
carry_speed_median and carry_speed_max (m/s while holding the lifted cube), max_lift (m), held_s (s holding the cube),
t_first_close (s), min_reach_dist (m).

mechanism: the measured differences that explain the failures, each a feature from the contrast table and the
direction it differs (higher_in_failures / lower_in_failures). Code checks each against the table.
fixes, from this menu only:
- filter_training: keep training episodes whose `feature` is `keep` (below/above) `threshold`, measured on them
- recenter_grasp: re-centre the grasp of the source demos before multiplying
- slow_carry: retime the carry so the fingertips stay under `max_speed_mps`
Each fix lists the mechanism features it `addresses`.

Reply with ONE JSON object (no prose, no code fence) shaped like this example:
{json.dumps(example)}

Rules:
- Give a region, mechanism or fix only where the tables support it. If nothing is clearly supported, reply with no
  regions, no mechanism, no fixes and uniform_share 1. That says "keep the data as it is", and it is a valid answer.
- regions: 0 to {MAX_REGIONS} boxes. Each axis is [low, high] inside these limits:
{ranges}
  Each box is at least {MIN_WIDTH_M} m wide on x/y axes and {MIN_WIDTH_DEG} degrees on yaw. Cube and bin must be
  able to sit {MIN_EDGE_GAP} m apart inside the box.
- targets: failure classes from the list above that actually occurred in the data.
- share: the fraction of new scenes from that region. uniform_share (at least {MIN_UNIFORM_SHARE}) keeps sampling
  the whole range. All shares plus uniform_share sum to 1.
- hypotheses: each claim cites evidence_seeds, the real seeds of episodes in the data that show it (the example's
  seeds are placeholders).
- Keep each axis at its full limits unless the per-bin table shows the failure rate changing along that axis. A box
  that is narrow on an axis the data doesn't support misses the failures it is meant to fix.
- Code checks every region against the episodes: it must contain at least 3 of the episodes that failed by its
  targets, at a failure rate clearly higher than outside it (one-sided Fisher exact p at most 0.1). With a few dozen
  episodes some box always holds a few extra failures by chance, so give no region without a clear scene effect.
- Prefer few, well-supported regions over many guesses. Reply with the JSON object only."""


def build_prompt(episodes: list[EpisodeFeatures], robot: str = "franka") -> str:
    n_fail = sum(not e.success for e in episodes)
    counts = Counter(e.primary for e in episodes if e.primary is not None)
    rows = "\n".join(json.dumps(e.row(), separators=(",", ":")) for e in episodes)
    table = "\n".join(json.dumps(r, separators=(",", ":")) for r in failure_table(episodes, robot))
    contrast = "\n".join(c.model_dump_json() for c in contrast_table(episodes))
    untraced = sum(e.source == "result" for e in episodes)
    note = ""
    if untraced:
        note = (f"{untraced} of these episodes have no step trace: only the scene, the eval's reason codes and where "
                "the cube ended (final_cube_to_bin_xy) are known. Their failure class comes from the reason codes, and "
                "they have no grasp or motion measurements, so the contrast table has nothing from them. Give no "
                "mechanism or fix that the contrast table doesn't support.\n\n")
    return (f"{len(episodes)} episodes, {len(episodes) - n_fail} succeeded, {n_fail} failed.\n{note}"
            f"First-failure counts: {json.dumps(dict(counts))}\n\n"
            f"Episodes (one JSON row each):\n{rows}\n\n"
            f"First-failure counts per scene-axis bin:\n{table}\n\n"
            f"Failed vs successful episodes (contrast table):\n{contrast}\n\n"
            "Write the data recipe.")


class RecipeReplyError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def parse_recipe(text: str) -> DataRecipe:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise RecipeReplyError(["the reply has no JSON object"])
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise RecipeReplyError([f"the JSON doesn't parse: {e}"]) from e
    try:
        return DataRecipe.model_validate(data)
    except ValidationError as e:
        raise RecipeReplyError([f"{'.'.join(str(p) for p in x['loc']) or 'recipe'}: {x['msg']}"
                                for x in e.errors()]) from e


def _retry_prompt(prompt: str, reply: str, errors: list[str]) -> str:
    problems = "\n".join(f"- {e}" for e in errors)
    return (f"{prompt}\n\nYour previous reply:\n{reply.strip()[-4000:]}\n\nIt has these problems:\n{problems}\n\n"
            "Fix them and reply with the corrected JSON object only.")


def _box_iou(a, b) -> float:
    """Overlap of two focus regions as a fraction of their union, over the five scene axes (each axis normalised)."""
    inter, va, vb = 1.0, 1.0, 1.0
    for axis in AXES:
        (alo, ahi), (blo, bhi) = getattr(a, axis), getattr(b, axis)
        inter *= max(0.0, min(ahi, bhi) - max(alo, blo))
        va *= ahi - alo
        vb *= bhi - blo
    union = va + vb - inter
    return inter / union if union > 0 else 0.0


def _jaccard(x: set, y: set) -> float:
    return 1.0 if not x and not y else len(x & y) / len(x | y)


def recipe_similarity(a: DataRecipe, b: DataRecipe) -> float:
    """Symmetric, 0..1: the mean of three agreements.
    regions: for each region, its best overlap in the other recipe (counted only if they target a common failure
    class), averaged over both recipes' regions (1 if both have none, 0 if only one does);
    mechanism: Jaccard of the (feature, direction) claims; fixes: Jaccard of the levers."""
    def one_way(x: DataRecipe, y: DataRecipe) -> float:
        return float(np.mean([max((_box_iou(r, s) for s in y.regions if set(r.targets) & set(s.targets)), default=0.0)
                              for r in x.regions]))
    if a.regions and b.regions:
        regions = (one_way(a, b) + one_way(b, a)) / 2
    else:
        regions = float(not a.regions and not b.regions)
    mech = _jaccard({(m.feature, m.direction) for m in a.mechanism}, {(m.feature, m.direction) for m in b.mechanism})
    fixes = _jaccard({f.lever for f in a.fixes}, {f.lever for f in b.fixes})
    return (regions + mech + fixes) / 3


@dataclass
class Attempt:
    sample: int
    reply: str
    errors: list[str]
    think: bool


@dataclass
class AnalysisResult:
    recipe: DataRecipe | None
    agreement: float | None  # the chosen recipe's mean similarity to the other valid ones; None with < 2 valid
    candidates: list[DataRecipe] = field(default_factory=list)
    candidate_agreement: list[float] = field(default_factory=list)
    attempts: list[Attempt] = field(default_factory=list)
    calls: int = 0
    cost: float = 0.0
    model: str | None = None
    api_errors: int = 0  # samples lost to Token Factory errors (after the client's own retries)

    @property
    def ok(self) -> bool:
        return self.recipe is not None


def _one_sample(i: int, prompt: str, system: str, res: AnalysisResult, check: Callable[[DataRecipe], list[str]], *,
                chat_fn: Callable, tier: str, retries: int, think: bool) -> DataRecipe | None:
    ask, thinking = prompt, think
    for _ in range(retries + 1):
        used = thinking
        reply = chat_fn(ask, tier=tier, system=system, max_tokens=MAX_TOKENS, think=used, temperature=TEMPERATURE)
        res.calls += 1
        res.cost += getattr(reply, "est_cost_usd", 0.0)
        res.model = getattr(reply, "model", None)
        try:
            recipe = parse_recipe(reply.text)
            errors = check(recipe)
        except RecipeReplyError as e:
            recipe, errors = None, e.errors
            thinking = False  # a thinking reply with no usable JSON: ask again plainly (as nemotron_repair does)
        res.attempts.append(Attempt(sample=i, reply=reply.text, errors=errors, think=used))
        if not errors:
            return recipe
        ask = _retry_prompt(prompt, reply.text, errors)
    return None


def analyse(episodes: list[EpisodeFeatures], *, robot: str = "franka", k: int = K, chat_fn: Callable = chat,
            tier: str = TIER, retries: int = RETRIES, think: bool = THINK) -> AnalysisResult:
    """k independent recipes (each with up to `retries` fixes), then the consensus one."""
    if not episodes:
        raise ValueError("no episodes to analyse")
    if all(e.success for e in episodes):
        raise ValueError("every episode succeeded; there is no failure to analyse")
    if k < 1:
        raise ValueError(f"k must be at least 1, got {k}")
    seen = {e.seed for e in episodes}
    observed = {e.primary for e in episodes if e.primary is not None}

    def check(recipe: DataRecipe) -> list[str]:
        return (validate_recipe(recipe, robot=robot, seen_seeds=seen, observed_failures=observed,
                                allow_no_change=True)
                or support_errors(recipe, episodes) + mechanism_errors(recipe, episodes))

    res = AnalysisResult(recipe=None, agreement=None)
    system, prompt = system_prompt(robot), build_prompt(episodes, robot)
    for i in range(k):
        try:
            recipe = _one_sample(i, prompt, system, res, check, chat_fn=chat_fn, tier=tier, retries=retries,
                                 think=think)
        except TokenFactoryError as e:  # the API is down for this sample: record it, keep the others
            res.attempts.append(Attempt(sample=i, reply="", errors=[f"api_error: {e}"], think=think))
            res.api_errors += 1
            continue
        if recipe is not None:
            res.candidates.append(recipe)
    if not res.candidates:
        return res
    if len(res.candidates) == 1:
        res.recipe = res.candidates[0]
        res.candidate_agreement = [float("nan")]
        return res
    scores = [float(np.mean([recipe_similarity(a, b) for j, b in enumerate(res.candidates) if j != i]))
              for i, a in enumerate(res.candidates)]
    best = int(np.argmax(scores))
    res.recipe, res.agreement, res.candidate_agreement = res.candidates[best], scores[best], scores
    return res


assert set(CLASS_TEXT) == set(FAILURE_CLASSES), "CLASS_TEXT must describe every failure class"
