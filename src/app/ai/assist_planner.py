"""Nemotron as the assist planner: a scene's sentence and its ScenePlan -> semantic assist rules (which surfaces are
placement targets and how high to release over them; which objects are obstacles, with a keep-out height and/or a
speed cap near them), as strict JSON (demo_pipeline.assist_rules). Code validates them; problems go back to the model
with its own reply, at most ROUNDS calls in all. If Nemotron is off, errors, or never gives valid rules, the rules
fallback (assist_rules.rules_fallback) is used and the reason is kept. The geometric soft floor
(demo_pipeline.soft_floor) is always under whatever comes out, and so are the rules' protections
(assist_rules.rules_floor: a speed cap near every tall stack): Nemotron can add or tighten, never remove.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Callable

from demo_pipeline.assist_rules import (
    HIGH_RELEASE_MAX, AssistRules, parse_rules, rules_fallback, validate_rules, zones_from_rules,
)
from demo_pipeline.scene_plan import ScenePlan, resolve
from demo_pipeline.soft_floor import AssistZones
from nebius_llm import chat

TIER = "super"
MAX_TOKENS = 800
ROUNDS = 3  # model calls in all

# Placeholders, not ids: the model copied a concrete example id once ("bin_blue" for a scene without one).
_EXAMPLE = {"targets": [{"object": "<a bin id>", "release_clearance_m": 0.015}],
            "obstacles": [{"object": "<an object id>", "keep_out_clearance_m": 0.02, "speed_cap_mps": 0.1}],
            "notes": "one line: why"}

SYSTEM_PROMPT = f"""You plan the assist zones for recording a robot demo by teleoperation in a simulated tabletop scene.
A soft floor already stops the hand from pressing into the table and into bins (geometry). You add the meaning:
where things get placed, and what to stay away from. Reply with ONE JSON object only (no prose, no code fence):
{json.dumps(_EXAMPLE)}

- targets: every place something gets put down. Every goal's bin MUST be a target. A cube can be a target (stacking
  on it) only if no goal moves it. release_clearance_m (optional): the held cube's bottom stops this far above the
  bin's rim or the cube's top, 0 to 5 cm (e.g. 0.015 = "release 1.5 cm above the rim"); omit it to rely on the
  soft floor alone. The held cube's centre at the release must stay under {HIGH_RELEASE_MAX} m above the bin's base
  (higher counts as dropping it in).
- obstacles: objects the hand should avoid (a tall stack, something fragile, a bin that isn't a target).
  keep_out_clearance_m: the hand stays this far above the object's top over its footprint, 0 to 10 cm.
  speed_cap_mps: the hand moves no faster than this near it, 0.02 to 0.5 m/s. Give one or both.
  Never make a keep-out over a cube (or a stack holding a cube) that a goal moves: it must be grasped.
- Use only the object ids given. Leave out anything that needs no rule."""



def describe_plan(plan: ScenePlan) -> str:
    """The scene as the model sees it: every object with its id, kind, size, where it is and what it sits on, then
    the goals in order."""
    placed = resolve(plan)
    lines = []
    for o in plan.objects:
        p = placed[o.id]
        size = f"{o.size * 100:.0f} cm cube" if o.kind == "cube" else (
            f"bin {o.inner[0] * 100:.0f} x {o.inner[1] * 100:.0f} cm inside, walls {o.inner[2] * 100:.0f} cm")
        on = f"on {p.support}" if p.support else "on the table"
        lines.append(f"- {o.id}: {o.color} {size}, at x {p.pos[0]:.2f}, y {p.pos[1]:.2f}, top {p.top_z:.3f} m, {on}")
    goals = "; ".join(f"{n}. {g.object} -> {g.bin}" for n, g in enumerate(plan.goals, start=1))
    return "Objects:\n" + "\n".join(lines) + f"\nGoals, in order: {goals}"


@dataclass
class AssistResult:
    rules: AssistRules
    zones: AssistZones
    source: str  # "nemotron" | "rules"
    errors: list[str]  # the last model attempt's problems ([] when Nemotron's rules are used)
    fallback_reason: str | None = None
    calls: int = 0
    cost: float = 0.0
    model: str | None = None
    attempts: list[dict] = field(default_factory=list)
    floor_rules: AssistRules | None = None  # the rules kept under Nemotron's (None when the rules fallback is used)


def _fallback(plan: ScenePlan, reason: str, res: AssistResult | None = None) -> AssistResult:
    rules = rules_fallback(plan)
    out = res or AssistResult(rules, None, "rules", [])  # type: ignore[arg-type]
    out.rules, out.zones, out.source, out.fallback_reason = rules, zones_from_rules(plan, rules, "rules"), "rules", reason
    return out


def plan_assist(text: str, plan: ScenePlan, *, chat_fn: Callable | None = chat, tier: str = TIER,
                rounds: int = ROUNDS) -> AssistResult:
    if chat_fn is None:
        return _fallback(plan, "Nemotron is off: the rules fallback")
    res = AssistResult(rules_fallback(plan), None, "rules", [])  # type: ignore[arg-type]
    scene = describe_plan(plan)
    prompt = f"Scene description: {text}\n\n{scene}"
    for _ in range(rounds):
        try:
            reply = chat_fn(prompt, tier=tier, system=SYSTEM_PROMPT, max_tokens=MAX_TOKENS)
        except Exception as e:  # network, quota, no key: the rules fallback, without blaming the plan
            res.calls += 1
            return _fallback(plan, f"Nemotron failed ({type(e).__name__}); the rules fallback", res)
        res.calls += 1
        res.cost += getattr(reply, "est_cost_usd", 0.0)
        res.model = getattr(reply, "model", None)
        try:
            rules = parse_rules(reply.text)
            errors = validate_rules(plan, rules)
        except ValueError as e:
            rules, errors = None, [str(e)]
        res.attempts.append({"reply": reply.text, "errors": errors})
        res.errors = errors
        if not errors:
            res.floor_rules = rules_fallback(plan)
            res.rules, res.source = rules, "nemotron"
            res.zones = zones_from_rules(plan, rules, "nemotron", floor=res.floor_rules)
            return res
        problems = "\n".join(f"- {e}" for e in errors)
        prompt = (f"Scene description: {text}\n\n{scene}\n\nYour previous reply:\n{reply.text.strip()}\n\n"
                  f"It has these problems:\n{problems}\n\nFix them and reply with the corrected JSON object only.")
    return _fallback(plan, f"Nemotron's rules never validated in {rounds} calls; the rules fallback", res)
