"""Nemotron as the scene creator: a sentence ("2 bins, 3 cubes stacked in a pile, put the red one in the left bin")
-> a ScenePlan (demo_pipeline.scene_plan) to record demos in.

The model writes the plan as JSON. Code parses it with the strict schema and runs validate_plan; any problem (no
JSON, a schema error, an object out of reach, an overlap, a stack that would fall, a goal naming nothing) goes back
to the model with its own reply, up to `retries` times. The robot and its reach come from code, never the model.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Callable

from pydantic import ValidationError

from demo_pipeline.scene_plan import (
    BIN_HEIGHT_RANGE, BIN_SIDE_RANGE, BIN_WALL, COLORS, CUBE_SIZE_RANGE, MIN_GAP, STACK_CENTRE_FRAC, ScenePlan,
    robot_reach, validate_plan,
)
from nebius_llm import chat

TIER = "super"  # a text task; config.TIERS
MAX_TOKENS = 1500  # a 10-object plan is ~700 tokens
RETRIES = 3


def system_prompt(robot: str = "franka") -> str:
    r = robot_reach(robot)
    example = {
        "objects": [
            {"id": "cube_red", "kind": "cube", "color": "red", "size": 0.05, "pose": {"x": 0.50, "y": 0.10, "yaw_deg": 0}},
            {"id": "bin_blue", "kind": "bin", "color": "blue", "inner": [0.20, 0.20, 0.08],
             "pose": {"x": 0.55, "y": -0.20, "yaw_deg": 0}},
        ],
        "goals": [{"object": "cube_red", "bin": "bin_blue"}],
    }
    stacked = {"id": "cube_green", "kind": "cube", "color": "green", "size": 0.05, "on": "cube_red"}
    return f"""You design tabletop pick-and-place scenes for a {robot} robot arm in a simulator. The user describes a
scene in words; you reply with ONE JSON object (no prose, no code fence) that describes it.

Coordinates: metres. The robot base is at the origin and faces +x. +y is the robot's LEFT and -y its RIGHT, so
"left" means larger y and "right" smaller y. Larger x is farther from the robot. The table top is z = 0. Never
write heights; they follow from the table and the stacks.

JSON shape:
{json.dumps(example)}

Objects (2 to 10), each with a unique lowercase id (letters, digits, _):
- cube: "kind": "cube", "color", "size" = edge in m, {CUBE_SIZE_RANGE[0]} to {CUBE_SIZE_RANGE[1]} (default 0.05).
  On the table it has "pose": {{"x", "y", "yaw_deg"}}. To stack it, give "on": "<id of the cube below>" and no
  pose, e.g. {json.dumps(stacked)}. Only one cube can sit on another. A stack's top must stay below {r.z_max:.2f} m.
- bin: an open box, "kind": "bin", "color", "inner": [length, width, wall height] in m (sides {BIN_SIDE_RANGE[0]} to
  {BIN_SIDE_RANGE[1]}, height {BIN_HEIGHT_RANGE[0]} to {BIN_HEIGHT_RANGE[1]}; default [0.20, 0.20, 0.08]) and a
  "pose". Its walls are {BIN_WALL} m thick, so its outside is inner + {2 * BIN_WALL:.2f} m. Bins can't be stacked.
- color: one of {", ".join(COLORS)}.

Rules the scene must pass:
- Reach: every table object's centre has x from {r.x[0]:.2f} to {r.x[1]:.2f} and y from {r.y[0]:.2f} to {r.y[1]:.2f}.
- Space: objects on the table don't overlap, and their footprints are at least {MIN_GAP * 100:.0f} cm apart
  (room for the fingers).
- Stacks: a cube sits only on a cube, centred within {STACK_CENTRE_FRAC * 100:.0f}% of the smaller cube's size.
- Goals: the list of tasks in order, each {{"object": <cube id>, "bin": <bin id>}}. Each cube moves at most once;
  a cube with another cube on top can move only after that top cube has moved. A cube must fit in its bin.

If the user leaves something open (colours, exact places, sizes), choose sensibly within the rules. If the
description is impossible within the rules, make the closest valid scene. Reply with the JSON object only."""


SYSTEM_PROMPT = system_prompt()


class PlanReplyError(ValueError):
    """The reply isn't a plan: no JSON, or the schema rejects it. Its errors are readable lines for the model."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def _schema_errors(err: ValidationError) -> list[str]:
    return [f"{'.'.join(str(p) for p in e['loc']) or 'plan'}: {e['msg']}" for e in err.errors()]


def parse_plan(text: str, robot: str = "franka") -> ScenePlan:
    """The plan in a reply (the outermost {...}). The robot and its reach are set by code, whatever the reply says."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise PlanReplyError(["the reply has no JSON object"])
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise PlanReplyError([f"the JSON doesn't parse: {e}"]) from e
    if not isinstance(data, dict):
        raise PlanReplyError(["the reply must be one JSON object"])
    data = {k: v for k, v in data.items() if k not in ("reach", "robot")}
    try:
        return ScenePlan.model_validate({**data, "robot": robot})
    except ValidationError as e:
        raise PlanReplyError(_schema_errors(e)) from e


@dataclass
class PlanResult:
    plan: ScenePlan | None
    errors: list[str]  # the last attempt's problems; [] when plan is set
    calls: int = 0
    cost: float = 0.0
    model: str | None = None
    attempts: list[dict] = field(default_factory=list)  # {"reply", "errors"} per call

    @property
    def ok(self) -> bool:
        return self.plan is not None


def _retry_prompt(text: str, reply: str, errors: list[str]) -> str:
    problems = "\n".join(f"- {e}" for e in errors)
    return (f"Scene description: {text}\n\nYour previous reply:\n{reply.strip()}\n\nIt has these problems:\n{problems}\n\n"
            "Fix them and reply with the corrected JSON object only.")


def plan_from_text(text: str, *, robot: str = "franka", chat_fn: Callable = chat, tier: str = TIER,
                   retries: int = RETRIES, check_fn: Callable[[ScenePlan], list[str]] | None = None) -> PlanResult:
    """Ask Nemotron for a plan; schema and validator problems go back to it, at most `retries` more times.

    check_fn: a further check on a plan the validator passed, e.g. the physics settle in Isaac
    (sim_worker.settle.settle_in_isaac: a stack that slides off, a cube that tips). Its problems go back to the
    model the same way; it never runs on a plan the validator rejected."""
    res = PlanResult(plan=None, errors=[])
    system = SYSTEM_PROMPT if robot == "franka" else system_prompt(robot)
    prompt = f"Scene description: {text}"
    for _ in range(retries + 1):
        reply = chat_fn(prompt, tier=tier, system=system, max_tokens=MAX_TOKENS)
        res.calls += 1
        res.cost += reply.est_cost_usd
        res.model = getattr(reply, "model", None)
        try:
            plan = parse_plan(reply.text, robot)
            errors = validate_plan(plan)
            if not errors and check_fn is not None:
                errors = list(check_fn(plan))
        except PlanReplyError as e:
            plan, errors = None, e.errors
        res.attempts.append({"reply": reply.text, "errors": errors})
        res.errors = errors
        if not errors:
            res.plan = plan
            return res
        prompt = _retry_prompt(text, reply.text, errors)
    return res
