"""Semantic assist rules for a ScenePlan: which surfaces are placement targets and how high a held cube is released
over them, which objects are obstacles (a keep-out height over them, a speed cap near them). Nemotron proposes them
(app.ai.assist_planner); code validates them here, and rules_fallback() is the plan-only version when Nemotron is off.
zones_from_rules() turns them into assist zones (demo_pipeline.soft_floor) on top of the geometric floor: they can
raise a floor, never lower one.

Bounds (validate_rules):
- a release clearance (the held cube's bottom above the rim or the cube's top) is 0 to 5 cm, and the held cube's
  centre must stay under check_success's high-release limit (0.18 m above the bin origin);
- a keep-out clearance (the tool's lowest z above an obstacle's top) is 0 to 10 cm; a speed cap 0.02 to 0.5 m/s;
- only real object ids; every goal's bin is a target; a cube a goal moves can be neither a target nor a keep-out.
"""

from __future__ import annotations

import json
import math

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .scene_geometry import BIN_WALL, TABLE_TOP_Z
from .scene_plan import ObjectId, ScenePlan, resolve
from .soft_floor import FOOTPRINT_MARGIN, AssistZones, Zone, ZoneSource, zones_for_plan

CLEARANCE_RANGE = (0.0, 0.05)  # m, release clearance
KEEP_OUT_RANGE = (0.0, 0.10)  # m, keep-out clearance over an obstacle's top
SPEED_RANGE = (0.02, 0.5)  # m/s
HIGH_RELEASE_MAX = 0.18  # m: check_success's release_height_max (the held cube's centre over the bin origin)
TALL_STACK_M = 0.10  # m: a stack this tall gets the fallback's speed cap
FALLBACK_SPEED = 0.1  # m/s near a tall stack (rules fallback)
SLOW_MARGIN = 0.05  # m around an obstacle's footprint where its speed cap applies


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TargetRule(_Model):
    object: ObjectId  # a bin (or a cube to stack on)
    release_clearance_m: float | None = None  # None: the geometric floor only


class ObstacleRule(_Model):
    object: ObjectId
    keep_out_clearance_m: float | None = None
    speed_cap_mps: float | None = None


class AssistRules(_Model):
    targets: list[TargetRule] = Field(min_length=1)
    obstacles: list[ObstacleRule] = Field(default_factory=list)
    notes: str | None = None


def parse_rules(text: str) -> AssistRules:
    """The rules in a model reply (its outermost {...}); ValueError with readable lines if it isn't one."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("the reply has no JSON object")
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"the JSON doesn't parse: {e}") from e
    try:
        return AssistRules.model_validate(data)
    except ValidationError as e:
        raise ValueError("; ".join(f"{'.'.join(str(p) for p in x['loc']) or 'rules'}: {x['msg']}" for x in e.errors())) from e


def _moved_by(plan: ScenePlan) -> dict[str, int]:
    return {g.object: n for n, g in enumerate(plan.goals, start=1)}


def _held_size(plan: ScenePlan, target: str) -> float:
    """The largest cube that goes onto `target` (by the goals), else the largest a goal moves, else any cube."""
    sizes = {o.id: o.size for o in plan.objects if o.kind == "cube"}
    into = [sizes[g.object] for g in plan.goals if g.bin == target]
    moved = [sizes[g.object] for g in plan.goals]
    return max(into or moved or list(sizes.values()) or [0.0])


def _surface(plan: ScenePlan, obj_id: str) -> float:
    """A bin's rim height, or the top of a cube (of its whole stack for an obstacle)."""
    o = next(x for x in plan.objects if x.id == obj_id)
    placed = resolve(plan)
    if o.kind == "bin":
        return placed[obj_id].pos[2] + BIN_WALL + o.inner[2]
    return placed[obj_id].top_z


def _stack_top(plan: ScenePlan, obj_id: str) -> float:
    placed = resolve(plan)
    top, cur = placed[obj_id].top_z, obj_id
    while True:
        above = [k for k, p in placed.items() if p.support == cur]
        if not above:
            return top
        cur = above[0]
        top = placed[cur].top_z


def validate_rules(plan: ScenePlan, rules: AssistRules) -> list[str]:
    """Readable problems with the rules; [] = fine."""
    errors: list[str] = []
    by_id = {o.id: o for o in plan.objects}
    moved = _moved_by(plan)
    seen: set[str] = set()
    lo, hi = CLEARANCE_RANGE
    for t in rules.targets:
        if t.object not in by_id:
            errors.append(f"target {t.object!r}: there is no object {t.object!r} (objects: {', '.join(by_id)})")
            continue
        if t.object in seen:
            errors.append(f"{t.object} is listed twice")
        seen.add(t.object)
        if t.object in moved:
            errors.append(f"{t.object} is moved by goal {moved[t.object]}, so it can't also be a place to put things")
        c = t.release_clearance_m
        if c is not None:
            if not lo <= c <= hi:
                errors.append(f"{t.object}: release_clearance_m {c} is outside {lo * 100:.0f} to {hi * 100:.0f} cm")
            if c < 0:
                errors.append(f"{t.object}: release_clearance_m {c} would let the hand go lower than the soft floor")
            if by_id[t.object].kind == "bin":
                centre = _surface(plan, t.object) + c + _held_size(plan, t.object) / 2
                if centre > HIGH_RELEASE_MAX + 1e-9:
                    errors.append(f"{t.object}: release_clearance_m {c} puts the held cube's centre {centre:.3f} m up at the "
                                  f"release, over {HIGH_RELEASE_MAX} m: check_success would fail it as a high release; use at most "
                                  f"{max(0.0, HIGH_RELEASE_MAX - centre + c):.3f}")
    targets = {t.object for t in rules.targets}
    for n, g in enumerate(plan.goals, start=1):
        if g.bin not in targets:
            errors.append(f"goal {n} puts {g.object} into {g.bin}, but {g.bin} isn't a placement target")
    klo, khi = KEEP_OUT_RANGE
    slo, shi = SPEED_RANGE
    for ob in rules.obstacles:
        if ob.object not in by_id:
            errors.append(f"obstacle {ob.object!r}: there is no object {ob.object!r} (objects: {', '.join(by_id)})")
            continue
        if ob.object in seen:
            errors.append(f"{ob.object} is listed twice")
        seen.add(ob.object)
        if ob.keep_out_clearance_m is None and ob.speed_cap_mps is None:
            errors.append(f"{ob.object}: an obstacle needs a keep-out clearance, a speed cap, or both")
        if ob.keep_out_clearance_m is not None:
            if not klo <= ob.keep_out_clearance_m <= khi:
                errors.append(f"{ob.object}: keep_out_clearance_m {ob.keep_out_clearance_m} is outside 0 to {khi * 100:.0f} cm")
            stack = _stack_members(plan, ob.object)
            hit = [c for c in stack if c in moved]
            if hit:
                errors.append(f"{hit[0]} is moved by goal {moved[hit[0]]}; a keep-out over {ob.object} would block it "
                              "(a speed cap near it is fine)")
        if ob.speed_cap_mps is not None and not slo <= ob.speed_cap_mps <= shi:
            errors.append(f"{ob.object}: speed_cap_mps {ob.speed_cap_mps} is outside {slo} to {shi} m/s")
    return errors


def _stack_members(plan: ScenePlan, obj_id: str) -> list[str]:
    """obj_id and every cube above it."""
    placed = resolve(plan)
    out, cur = [obj_id], obj_id
    while True:
        above = [k for k, p in placed.items() if p.support == cur]
        if not above:
            return out
        cur = above[0]
        out.append(cur)


def rules_fallback(plan: ScenePlan) -> AssistRules:
    """Without Nemotron: every goal's bin is a target on the geometric floor alone, and a speed cap near any stack
    TALL_STACK_M or taller (no keep-out: its cubes may be the ones to move)."""
    targets, seen = [], set()
    for g in plan.goals:
        if g.bin not in seen:
            seen.add(g.bin)
            targets.append(TargetRule(object=g.bin))
    placed = resolve(plan)
    obstacles = [ObstacleRule(object=oid, speed_cap_mps=FALLBACK_SPEED) for oid, p in placed.items()
                 if p.support is None and any(o.id == oid and o.kind == "cube" for o in plan.objects)
                 and _stack_top(plan, oid) - TABLE_TOP_Z >= TALL_STACK_M - 1e-9]
    return AssistRules(targets=targets, obstacles=obstacles, notes="rules fallback (no Nemotron)")


def zones_from_rules(plan: ScenePlan, rules: AssistRules, source: ZoneSource) -> AssistZones:
    """The geometric zones (every bin, plus the tops of cube targets) and, on top, a release floor per target with a
    clearance, a keep-out and/or a speed-capped zone per obstacle. Call validate_rules first."""
    by_id = {o.id: o for o in plan.objects}
    cube_targets = [t.object for t in rules.targets if by_id[t.object].kind == "cube"]
    geo = zones_for_plan(plan, cube_targets=cube_targets)
    placed = resolve(plan)
    extra: list[Zone] = []
    for t in rules.targets:
        if t.release_clearance_m is None:
            continue
        base = geo.zone(f"bin:{t.object}" if by_id[t.object].kind == "bin" else f"top:{t.object}")
        floor = _surface(plan, t.object) + t.release_clearance_m + _held_size(plan, t.object) / 2
        extra.append(Zone(f"release:{t.object}", "release", base.center, base.yaw, base.half, floor, source))
    for ob in rules.obstacles:
        o, p = by_id[ob.object], placed[ob.object]
        if o.kind == "bin":
            half = (o.inner[0] / 2 + BIN_WALL + FOOTPRINT_MARGIN, o.inner[1] / 2 + BIN_WALL + FOOTPRINT_MARGIN)
        else:
            half = (o.size / 2 + FOOTPRINT_MARGIN,) * 2
        yaw = math.radians(p.yaw_deg)
        if ob.keep_out_clearance_m is not None:
            top = _stack_top(plan, ob.object) if o.kind == "cube" else _surface(plan, ob.object)
            extra.append(Zone(f"keep_out:{ob.object}", "keep_out", p.pos[:2], yaw, half, top + ob.keep_out_clearance_m, source))
        if ob.speed_cap_mps is not None:
            extra.append(Zone(f"slow:{ob.object}", "slow", p.pos[:2], yaw, (half[0] + SLOW_MARGIN, half[1] + SLOW_MARGIN),
                              TABLE_TOP_Z, source, ob.speed_cap_mps))
    zones = tuple(geo.zones) + tuple(Zone(z.id, z.kind, (float(z.center[0]), float(z.center[1])), z.yaw, z.half, z.floor,
                                          z.source, z.speed_cap) for z in extra)
    return AssistZones(zones, source=source if extra else "geometry")
