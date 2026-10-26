"""A data recipe: which scenes to multiply into next, aimed at a policy's measured failures. numpy + pydantic only.

The failure analyst (app.ai.failure_analyst, Nemotron) writes one from the measured episodes
(demo_pipeline.failure_features); rules_recipe() writes the code-only baseline. Either way validate_recipe() decides
whether it is usable, and sample_recipe_scenes() turns it into the exact scenes for sim_worker's multiply
(MultiplyRequest.scenes). uniform_scenes() is the control arm: the same count, sample_scene as before.

A recipe is a few focus regions (boxes in cube x/y/yaw and bin x/y, inside the robot's SCENE_RANGES) with a share of
the scenes each, plus a uniform share that keeps covering the whole range. The uniform share is at least
MIN_UNIFORM_SHARE, so a wrong diagnosis can't take the whole dataset away from the scenes that already work.
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from .failure_features import FAILURE_CLASSES, EpisodeFeatures
from .multiply import BIN_Z, CUBE_Z, MIN_EDGE_GAP, SCENE_RANGES, _edge_gap, _yaw_quat, sample_scene
from .schemas import Pose, RobotName, Scene

MIN_UNIFORM_SHARE = 0.2
MAX_REGIONS = 4
MIN_WIDTH_M = 0.04  # a region narrower than this targets one scene, not a condition
MIN_WIDTH_DEG = 15.0
YAW_RANGE_DEG = (-45.0, 45.0)  # the cube looks the same every 90 degrees; regions use the nearest-face yaw
FEASIBLE_TRIES = 2000
SHARE_TOL = 0.01
TRAIN_SEED_MAX = 5000  # sim_eval.scenes.EVAL_SEED_MIN: generated scenes stay below the test seeds

AXES = ("cube_x", "cube_y", "cube_yaw_deg", "bin_x", "bin_y")


CONTRAST_FEATURES = ("grasp_offset_xy", "grasp_height", "n_closes", "carry_speed_median", "carry_speed_max",
                     "max_lift", "held_s", "t_first_close", "min_reach_dist")
MIN_GROUP = 3  # episodes per group for a contrast
MIN_EFFECT = 0.2  # |rank-biserial| a mechanism claim needs
CARRY_SPEED_RANGE = (0.05, 1.0)  # m/s a slow_carry cap may set


class Contrast(BaseModel):
    """One measured feature, failed vs successful episodes."""

    model_config = ConfigDict(extra="forbid")

    feature: str
    n_success: int
    n_failure: int
    median_success: float | None
    median_failure: float | None
    effect: float | None  # rank-biserial, + when the feature is higher in failures; None if a group is too small
    p_value: float | None  # two-sided Mann-Whitney U, normal approximation with tie correction


def _mann_whitney(fail: np.ndarray, ok: np.ndarray) -> tuple[float, float]:
    """(rank-biserial effect, + when fail is higher; two-sided p) for two samples."""
    allv = np.concatenate([fail, ok])
    order = allv.argsort(kind="mergesort")
    ranks = np.empty(len(allv))
    sorted_v = allv[order]
    i = 0
    while i < len(allv):  # average ranks over ties
        j = i
        while j + 1 < len(allv) and sorted_v[j + 1] == sorted_v[i]:
            j += 1
        ranks[order[i:j + 1]] = (i + j) / 2 + 1
        i = j + 1
    n1, n2 = len(fail), len(ok)
    u = ranks[:n1].sum() - n1 * (n1 + 1) / 2
    effect = 2 * u / (n1 * n2) - 1
    _, counts = np.unique(allv, return_counts=True)
    n = n1 + n2
    var = n1 * n2 / 12 * ((n + 1) - (counts ** 3 - counts).sum() / (n * (n - 1)))
    if var <= 0:
        return effect, 1.0
    z = (abs(u - n1 * n2 / 2) - 0.5) / math.sqrt(var)
    return effect, float(math.erfc(max(z, 0.0) / math.sqrt(2)))


def contrast_table(episodes: list[EpisodeFeatures]) -> list[Contrast]:
    out = []
    for f in CONTRAST_FEATURES:
        ok = np.array([getattr(e, f) for e in episodes if e.success and getattr(e, f) is not None], dtype=float)
        fail = np.array([getattr(e, f) for e in episodes if not e.success and getattr(e, f) is not None], dtype=float)
        enough = len(ok) >= MIN_GROUP and len(fail) >= MIN_GROUP
        effect, p = _mann_whitney(fail, ok) if enough else (None, None)
        out.append(Contrast(feature=f, n_success=len(ok), n_failure=len(fail),
                            median_success=float(np.median(ok)) if len(ok) else None,
                            median_failure=float(np.median(fail)) if len(fail) else None,
                            effect=None if effect is None else round(float(effect), 4),
                            p_value=None if p is None else round(p, 6)))
    return out


class MechanismClaim(BaseModel):
    """Why the failures happen, as a measured difference between failed and successful episodes."""

    model_config = ConfigDict(extra="forbid")

    feature: str
    direction: Literal["higher_in_failures", "lower_in_failures"]
    explanation: str


class Fix(BaseModel):
    """A change the pipeline can make. lever:
    filter_training   keep training episodes whose `feature` is below/above `threshold` (measured on them)
    recenter_grasp    run the repair's recenter op on the source demos before multiplying
    slow_carry        retime the source demos' carry so the fingertips stay under max_speed_mps
    """

    model_config = ConfigDict(extra="forbid")

    lever: Literal["filter_training", "recenter_grasp", "slow_carry"]
    addresses: list[str] = Field(min_length=1)  # mechanism features it acts on
    feature: str | None = None
    keep: Literal["below", "above"] | None = None
    threshold: float | None = None
    max_speed_mps: float | None = None
    rationale: str


class Hypothesis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim: str  # e.g. "drops happen on long carries toward -y"
    evidence_seeds: list[int] = Field(min_length=1)  # episodes that show it; must exist in the analysed set


class FocusRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    targets: list[str] = Field(min_length=1)  # failure classes this region is meant to fix
    cube_x: tuple[float, float]
    cube_y: tuple[float, float]
    cube_yaw_deg: tuple[float, float]
    bin_x: tuple[float, float]
    bin_y: tuple[float, float]
    share: float = Field(gt=0, le=1)
    rationale: str


class DataRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    hypotheses: list[Hypothesis] = Field(default_factory=list)
    mechanism: list[MechanismClaim] = Field(default_factory=list)
    fixes: list[Fix] = Field(default_factory=list)
    regions: list[FocusRegion] = Field(default_factory=list)  # empty: the failures don't depend on the scene
    uniform_share: float = Field(ge=0, le=1)


def _axis_limits(robot: RobotName) -> dict[str, tuple[float, float]]:
    r = SCENE_RANGES[robot]
    return {"cube_x": r.cube_x, "cube_y": r.cube_y, "cube_yaw_deg": YAW_RANGE_DEG, "bin_x": r.bin_x, "bin_y": r.bin_y}


def _draw(rng: np.random.Generator, region: FocusRegion) -> tuple[tuple[float, float], float, tuple[float, float]]:
    cube_xy = (float(rng.uniform(*region.cube_x)), float(rng.uniform(*region.cube_y)))
    yaw = math.radians(float(rng.uniform(*region.cube_yaw_deg)))
    bin_xy = (float(rng.uniform(*region.bin_x)), float(rng.uniform(*region.bin_y)))
    return cube_xy, yaw, bin_xy


def _region_scene(rng: np.random.Generator, region: FocusRegion, robot: RobotName, seed: int,
                  tries: int = FEASIBLE_TRIES) -> Scene | None:
    for _ in range(tries):
        cube_xy, yaw, bin_xy = _draw(rng, region)
        if _edge_gap(cube_xy, yaw, bin_xy) >= MIN_EDGE_GAP:
            return Scene(cube_pose=Pose(pos=(*cube_xy, CUBE_Z), quat_wxyz=_yaw_quat(yaw)),
                         bin_pose=Pose(pos=(*bin_xy, BIN_Z), quat_wxyz=(1.0, 0.0, 0.0, 0.0)), robot=robot, seed=seed)
    return None


def validate_recipe(recipe: DataRecipe, *, robot: RobotName = "franka", seen_seeds: set[int] | None = None,
                    observed_failures: set[str] | None = None, allow_no_change: bool = False) -> list[str]:
    """Problems that make the recipe unusable, as readable lines (they go back to the model). [] means usable.

    allow_no_change: a recipe with no region and no fix ("keep the data as it is") is a valid answer. The analyst
    allows it, since its checks reject any claim the numbers don't support, and then nothing may be left to change.

    seen_seeds: the analysed episodes' seeds; a hypothesis citing any other seed is made up.
    observed_failures: the failure classes that actually occurred; a region can't target one that never did."""
    errors: list[str] = []
    limits = _axis_limits(robot)
    if not recipe.regions and not recipe.fixes and not allow_no_change:
        errors.append("give at least one region or one fix; a recipe with neither changes nothing")
    if len(recipe.regions) > MAX_REGIONS:
        errors.append(f"at most {MAX_REGIONS} regions, got {len(recipe.regions)}")
    if recipe.uniform_share < MIN_UNIFORM_SHARE - 1e-9:
        errors.append(f"uniform_share must be at least {MIN_UNIFORM_SHARE}, got {recipe.uniform_share}")
    total = recipe.uniform_share + sum(r.share for r in recipe.regions)
    if abs(total - 1.0) > SHARE_TOL:
        errors.append(f"uniform_share plus the region shares must sum to 1, got {total:.3f}")
    names = [r.name for r in recipe.regions]
    if len(set(names)) != len(names):
        errors.append("region names must be unique")
    for r in recipe.regions:
        for axis in AXES:
            lo, hi = getattr(r, axis)
            lim_lo, lim_hi = limits[axis]
            unit, min_w = ("deg", MIN_WIDTH_DEG) if axis.endswith("deg") else ("m", MIN_WIDTH_M)
            if not lo < hi:
                errors.append(f"region {r.name!r}: {axis} must be [low, high] with low < high, got [{lo}, {hi}]")
                continue
            if lo < lim_lo - 1e-9 or hi > lim_hi + 1e-9:
                errors.append(f"region {r.name!r}: {axis} [{lo}, {hi}] is outside the allowed [{lim_lo}, {lim_hi}] {unit}")
            if hi - lo < min_w - 1e-9:
                errors.append(f"region {r.name!r}: {axis} is {hi - lo:.3f} {unit} wide; make it at least {min_w} {unit}")
        unknown = [t for t in r.targets if t not in FAILURE_CLASSES]
        if unknown:
            errors.append(f"region {r.name!r}: unknown failure classes {unknown}; use only {list(FAILURE_CLASSES)}")
        if observed_failures is not None:
            unseen = [t for t in r.targets if t in FAILURE_CLASSES and t not in observed_failures]
            if unseen:
                errors.append(f"region {r.name!r} targets {unseen}, which never occurred; observed: {sorted(observed_failures)}")
        if not errors and _region_scene(np.random.default_rng(0), r, robot, seed=0) is None:
            errors.append(f"region {r.name!r}: no scene in it keeps the cube and bin {MIN_EDGE_GAP} m apart; move the bin "
                          "range away from the cube range")
    if seen_seeds is not None:
        for h in recipe.hypotheses:
            made_up = sorted(set(h.evidence_seeds) - seen_seeds)
            if made_up:
                errors.append(f"hypothesis {h.claim!r} cites seeds {made_up}, which are not in the data")
    return errors


MIN_SUPPORT = 3  # a region must contain at least this many of its target failures
MAX_REGION_P = 0.1  # and hold them at a higher rate than outside it, one-sided Fisher exact p at most this


def fisher_greater(a: int, b: int, c: int, d: int) -> float:
    """One-sided Fisher exact p for the table [[a, b], [c, d]]: P(top-left >= a) with the margins fixed.
    Here a/b = target failures / other episodes inside a region, c/d = the same outside it."""
    row1, col1, n = a + b, a + c, a + b + c + d
    total = math.comb(n, row1)
    return sum(math.comb(col1, k) * math.comb(n - col1, row1 - k) for k in range(a, min(row1, col1) + 1)) / total


class RegionSupport(BaseModel):
    """What the analysed episodes say about one region: measured, so a box drawn around nothing shows up."""

    model_config = ConfigDict(extra="forbid")

    region: str
    episodes_inside: int
    target_failures_inside: int
    target_failures_total: int
    coverage: float  # target failures inside / all target failures
    rate_inside: float  # target failures inside / episodes inside (0 if empty)
    rate_overall: float  # all target failures / all episodes
    p_value: float  # one-sided Fisher exact: target failures more common inside than outside
    seeds_inside: list[int]


def _inside(scene, region: FocusRegion) -> bool:
    return all(lo - 1e-9 <= getattr(scene, axis) <= hi + 1e-9 for axis in AXES for lo, hi in [getattr(region, axis)])


def region_support(recipe: DataRecipe, episodes: list[EpisodeFeatures]) -> list[RegionSupport]:
    out = []
    for r in recipe.regions:
        targets = set(r.targets)
        inside = [e for e in episodes if _inside(e.scene, r)]
        hit_in = sum(e.primary in targets for e in inside)
        hit_all = sum(e.primary in targets for e in episodes)
        p = fisher_greater(hit_in, len(inside) - hit_in, hit_all - hit_in, len(episodes) - len(inside) - (hit_all - hit_in))
        out.append(RegionSupport(region=r.name, episodes_inside=len(inside), target_failures_inside=hit_in,
                                 target_failures_total=hit_all, coverage=hit_in / hit_all if hit_all else 0.0,
                                 rate_inside=hit_in / len(inside) if inside else 0.0,
                                 rate_overall=hit_all / len(episodes) if episodes else 0.0,
                                 p_value=round(p, 6), seeds_inside=[e.seed for e in inside]))
    return out


def support_errors(recipe: DataRecipe, episodes: list[EpisodeFeatures], min_support: int = MIN_SUPPORT,
                   max_p: float = MAX_REGION_P) -> list[str]:
    """A region must hold at least min_support of its target failures, at a higher rate than outside it
    (one-sided Fisher p <= max_p). With a few dozen episodes some box always holds a few more failures by chance;
    this keeps regions to where the data shows a scene effect."""
    errors = []
    for s in region_support(recipe, episodes):
        where = (f"region {s.region!r} contains {s.episodes_inside} episodes, {s.target_failures_inside} of the "
                 f"{s.target_failures_total} episodes that failed by its targets")
        if s.target_failures_inside < min(min_support, s.target_failures_total):
            errors.append(f"{where}; it must contain at least {min_support}. Widen it to where those failures are")
        elif s.episodes_inside and s.rate_inside <= s.rate_overall + 1e-9:
            errors.append(f"{where}: a rate of {s.rate_inside:.2f}, no higher than {s.rate_overall:.2f} over all "
                          "episodes, so the failures don't concentrate there")
        elif s.p_value > max_p:
            errors.append(f"{where}: a rate of {s.rate_inside:.2f} vs {s.rate_overall:.2f} overall, but a difference "
                          f"this size is likely chance (one-sided Fisher p = {s.p_value:.3f} > {max_p}). Drop the "
                          "region unless a wider one shows a clear scene effect")
    return errors


def mechanism_errors(recipe: DataRecipe, episodes: list[EpisodeFeatures], min_effect: float = MIN_EFFECT
                     ) -> list[str]:
    """Each mechanism claim must match the measured contrast (direction, and |effect| >= min_effect); each fix must
    act on a claimed mechanism and have settings the pipeline can apply."""
    errors: list[str] = []
    table = {c.feature: c for c in contrast_table(episodes)}
    claimed = set()
    for m in recipe.mechanism:
        c = table.get(m.feature)
        if c is None:
            errors.append(f"mechanism feature {m.feature!r} is not measured; use one of {list(CONTRAST_FEATURES)}")
            continue
        claimed.add(m.feature)
        if c.effect is None:
            errors.append(f"mechanism {m.feature!r}: too few episodes to compare ({c.n_failure} failed, "
                          f"{c.n_success} succeeded with a value; {MIN_GROUP} each needed)")
            continue
        measured = "higher_in_failures" if c.effect > 0 else "lower_in_failures"
        nums = (f"median {c.median_failure:.4g} in failures vs {c.median_success:.4g} in successes, "
                f"effect {c.effect:+.2f}, p {c.p_value:.3g}")
        if abs(c.effect) < min_effect:
            errors.append(f"mechanism {m.feature!r}: the difference is too small to claim ({nums}; "
                          f"|effect| must be at least {min_effect})")
        elif m.direction != measured:
            errors.append(f"mechanism {m.feature!r} says {m.direction}, but the measurement is the opposite: {nums}")
    for i, f in enumerate(recipe.fixes):
        where = f"fix {i + 1} ({f.lever})"
        unclaimed = [a for a in f.addresses if a not in claimed]
        if unclaimed:
            errors.append(f"{where} addresses {unclaimed}, which no mechanism claim names")
        if f.lever == "filter_training":
            if f.feature not in CONTRAST_FEATURES or f.keep is None or f.threshold is None or not math.isfinite(f.threshold):
                errors.append(f"{where} needs feature (one of {list(CONTRAST_FEATURES)}), keep (below/above) and a "
                              "finite threshold")
        elif f.lever == "slow_carry":
            lo, hi = CARRY_SPEED_RANGE
            if f.max_speed_mps is None or not lo <= f.max_speed_mps <= hi:
                errors.append(f"{where} needs max_speed_mps between {lo} and {hi}")
    return errors


def _allocate(shares: list[float], n: int) -> list[int]:
    """Largest-remainder split of n by shares."""
    raw = [s * n for s in shares]
    counts = [int(math.floor(x)) for x in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - counts[i], reverse=True)[: n - sum(counts)]:
        counts[i] += 1
    return counts


def _check_seeds(n: int, seed0: int) -> None:
    if n < 1:
        raise ValueError(f"n must be at least 1, got {n}")
    if seed0 < 0 or seed0 + n > TRAIN_SEED_MAX:
        raise ValueError(f"seeds {seed0}..{seed0 + n - 1} must stay in 0..{TRAIN_SEED_MAX - 1}, clear of the test scenes")


def sample_recipe_scenes(recipe: DataRecipe, n: int, seed0: int, robot: RobotName = "franka"
                         ) -> list[tuple[Scene, str]]:
    """n scenes with seeds seed0.., each with the region it came from ("uniform" for the uniform share).
    Deterministic in (recipe, n, seed0). Raises if a region turns out infeasible (validate_recipe checks first)."""
    _check_seeds(n, seed0)
    counts = _allocate([r.share for r in recipe.regions] + [recipe.uniform_share], n)
    out: list[tuple[Scene, str]] = []
    seed = seed0
    for region, k in zip([*recipe.regions, None], counts):
        for _ in range(k):
            rng = np.random.default_rng(seed)
            if region is None:
                out.append((sample_scene(rng, robot, seed), "uniform"))
            else:
                scene = _region_scene(rng, region, robot, seed)
                if scene is None:
                    raise ValueError(f"region {region.name!r} has no feasible scene for seed {seed}")
                out.append((scene, region.name))
            seed += 1
    return out


def recipe_scene(recipe: DataRecipe, seed: int, robot: RobotName = "franka") -> tuple[Scene, str]:
    """One scene for one seed, for pipelines that name variants by seed (scripts/run_human_demo_experiment.py):
    the seed's own draw picks a region by share (or the uniform share, which is sample_scene exactly), then a scene
    in it. Deterministic in (recipe, seed). Over many seeds the regions get their shares on average; for exact
    counts use sample_recipe_scenes."""
    rng = np.random.default_rng([seed, 0x5EC1])  # a stream of its own: sample_scene(seed) stays untouched
    u = float(rng.uniform())
    acc = 0.0
    for region in recipe.regions:
        acc += region.share
        if u < acc:
            scene = _region_scene(np.random.default_rng(seed), region, robot, seed)
            if scene is None:
                raise ValueError(f"region {region.name!r} has no feasible scene for seed {seed}")
            return scene, region.name
    return sample_scene(np.random.default_rng(seed), robot, seed), "uniform"


def uniform_scenes(n: int, seed0: int, robot: RobotName = "franka") -> list[Scene]:
    """The control arm: n scenes exactly as sim_worker's multiply has always sampled them."""
    _check_seeds(n, seed0)
    return [sample_scene(np.random.default_rng(s), robot, s) for s in range(seed0, seed0 + n)]


def rules_recipe(episodes: list[EpisodeFeatures], robot: RobotName = "franka", *, share: float = 0.7,
                 min_count: int = 3, pad_m: float = 0.03, pad_deg: float = 10.0) -> DataRecipe | None:
    """The code-only baseline: one region, the padded bounding box of the scenes where the most common failure
    happened. None when no failure class has min_count episodes (nothing to aim at)."""
    counts = Counter(e.primary for e in episodes if e.primary is not None)
    if not counts:
        return None
    kind, k = counts.most_common(1)[0]
    if k < min_count:
        return None
    limits = _axis_limits(robot)
    hit = [e for e in episodes if e.primary == kind]
    box = {}
    for axis in AXES:
        vals = [getattr(e.scene, axis) for e in hit]
        pad, min_w = (pad_deg, MIN_WIDTH_DEG) if axis.endswith("deg") else (pad_m, MIN_WIDTH_M)
        lim_lo, lim_hi = limits[axis]
        lo, hi = max(lim_lo, min(vals) - pad), min(lim_hi, max(vals) + pad)
        if hi - lo < min_w:  # widen around the centre, inside the limits
            mid = min(max((lo + hi) / 2, lim_lo + min_w / 2), lim_hi - min_w / 2)
            lo, hi = mid - min_w / 2, mid + min_w / 2
        box[axis] = (round(lo, 4), round(hi, 4))
    region = FocusRegion(name=f"rules_{kind}", targets=[kind], share=share,
                         rationale=f"bounding box (padded) of the {k} scenes whose first failure was {kind}", **box)
    return DataRecipe(summary=f"rules baseline: {k}/{len(episodes)} episodes failed first by {kind}",
                      hypotheses=[], regions=[region], uniform_share=round(1 - share, 6))


def rules_mechanism(episodes: list[EpisodeFeatures], *, max_p: float = 0.05, min_effect: float = MIN_EFFECT
                    ) -> list[Contrast]:
    """The code-only baseline for the mechanism: every contrast with p <= max_p and |effect| >= min_effect."""
    return [c for c in contrast_table(episodes)
            if c.p_value is not None and c.p_value <= max_p and abs(c.effect) >= min_effect]
