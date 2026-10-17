"""R6 prototype: turn a plain-language repair request into repair ops from the fixed menu.

The model (or the keyword baseline in repair_keywords.py) only proposes *intents*: which op, on
which named span or pause, with which coarse parameter. Code resolves the intents into the
pydantic RepairOp union using the demo's own measured times (DemoContext), so the model never
writes a timestamp it could get wrong. An invalid reply is retried once, then becomes no ops.

Not wired into the UI: a prototype for the user to judge (sprint 7 plan, T4).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Annotated, Callable, Literal, Union

import numpy as np
from pydantic import BaseModel, Field, TypeAdapter, ValidationError, field_validator

from demo_pipeline.measure import gripper_events
from nebius_llm import chat
from demo_pipeline.rules import detect_rules
from demo_pipeline.schemas import (
    Discard,
    RecenterGrasp,
    RemovePause,
    RepairOp,
    ReplanTransit,
    Retime,
    Smooth,
    Trajectory,
    Trim,
)

SpanName = Literal["approach", "carry", "retreat", "whole"]
Span = Union[SpanName, tuple[float, float]]
TIME_TOL = 1e-6


class RequestError(ValueError):
    """The reply is off the menu, or names something this demo doesn't have."""


# --- the intent menu (what a parser may propose) -------------------------------------

class _Intent(BaseModel):
    pass


class _SpanIntent(_Intent):
    span: Span

    @field_validator("span")
    @classmethod
    def _ordered(cls, v):
        if isinstance(v, tuple) and not (0 <= v[0] < v[1]):
            raise ValueError("a time span needs 0 <= t0 < t1")
        return v


class TrimIntent(_Intent):
    op: Literal["trim"]
    end: Literal["start", "end", "both"]


class RemovePauseIntent(_Intent):
    op: Literal["remove_pause"]
    pause: Union[Annotated[int, Field(ge=1)], Literal["all"]]


class SmoothIntent(_SpanIntent):
    op: Literal["smooth"]
    strength: Literal["low", "med", "high"] = "med"


class RetimeIntent(_SpanIntent):
    op: Literal["retime"]
    speed_factor: float = Field(gt=0, le=5)  # x the span's measured speed; > 1 is faster


class RecenterIntent(_Intent):
    op: Literal["recenter_grasp"]


class ReplanIntent(_Intent):
    op: Literal["replan_transit"]


class DiscardIntent(_Intent):
    op: Literal["discard"]


Intent = Annotated[
    Union[TrimIntent, RemovePauseIntent, SmoothIntent, RetimeIntent, RecenterIntent, ReplanIntent, DiscardIntent],
    Field(discriminator="op"),
]


class _Reply(BaseModel):
    ops: list[Intent]


_REPAIR_OPS = TypeAdapter(list[RepairOp])


def parse_intents(raw_text: str) -> list:
    """The intents in a reply. Like ai/commands.py, it only needs the outermost {...} to be JSON."""
    text = raw_text.strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise RequestError("the reply has no JSON object")
    try:
        return _Reply.model_validate(json.loads(text[start : end + 1])).ops
    except (json.JSONDecodeError, ValidationError) as error:
        raise RequestError(f"the reply is off the menu: {error}") from error


# --- the demo the request is about ----------------------------------------------------

@dataclass(frozen=True)
class DemoContext:
    duration: float
    t_close: float | None
    t_open: float | None
    idle_start: tuple[float, float] | None
    idle_end: tuple[float, float] | None
    pauses: tuple[tuple[float, float], ...]
    speeds: dict[str, float] = field(default_factory=dict)  # mean hand speed per span, m/s

    @classmethod
    def from_dict(cls, d: dict) -> "DemoContext":
        pair = lambda v: None if v is None else (float(v[0]), float(v[1]))  # noqa: E731
        return cls(duration=float(d["duration"]), t_close=d.get("t_close"), t_open=d.get("t_open"),
                   idle_start=pair(d.get("idle_start")), idle_end=pair(d.get("idle_end")),
                   pauses=tuple(pair(p) for p in d.get("pauses", [])),
                   speeds={k: float(v) for k, v in d.get("speeds", {}).items()})

    @classmethod
    def from_trajectory(cls, traj: Trajectory) -> "DemoContext":
        """Times from the rules detector (pauses, idle ends) and the gripper events; no jitter windows needed."""
        t = np.asarray(traj.t)
        start = float(t[0])
        diag = detect_rules(traj, [])
        idle_start = idle_end = None
        for issue in diag.issues:
            if issue.type == "idle_start_end":
                if abs(issue.t0 - start) <= TIME_TOL:
                    idle_start = (issue.t0 - start, issue.t1 - start)
                else:
                    idle_end = (issue.t0 - start, issue.t1 - start)
        pauses = tuple((i.t0 - start, i.t1 - start) for i in diag.issues if i.type == "pause")
        t_close, t_open = gripper_events(traj)
        ctx = cls(duration=float(t[-1] - start),
                  t_close=None if t_close is None else t_close - start,
                  t_open=None if t_open is None else t_open - start,
                  idle_start=idle_start, idle_end=idle_end, pauses=pauses)
        pos = np.asarray(traj.ee_pos)
        step = np.concatenate([[0.0], np.linalg.norm(np.diff(pos, axis=0), axis=1)])
        rel = t - start
        for name, (a, b) in ctx.spans().items():
            inside = (rel > a + TIME_TOL) & (rel <= b + TIME_TOL)
            ctx.speeds[name] = float(step[inside].sum() / (b - a))
        return ctx

    def spans(self) -> dict[str, tuple[float, float]]:
        out = {}
        if self.t_close is not None:
            out["approach"] = (0.0, self.t_close)
            out["carry"] = (self.t_close, self.t_open if self.t_open is not None else self.duration)
            if self.t_open is not None and self.t_open < self.duration:
                out["retreat"] = (self.t_open, self.duration)
        out["whole"] = (0.0, self.duration)
        return out

    def describe(self) -> str:
        """The demo, in the words the prompt uses."""
        lines = [f"Demo length: {self.duration:.2f} s."]
        lines += [f"{name}: {a:.2f}-{b:.2f} s" for name, (a, b) in self.spans().items()]
        lines.append(f"gripper closes on the cube at {self.t_close:.2f} s" if self.t_close is not None
                     else "the gripper never closes")
        if self.t_open is not None:
            lines.append(f"gripper opens over the bin at {self.t_open:.2f} s")
        for label, span in (("idle at the start", self.idle_start), ("idle at the end", self.idle_end)):
            if span is not None:
                lines.append(f"{label}: {span[0]:.2f}-{span[1]:.2f} s")
        lines += [f"pause {k}: {a:.2f}-{b:.2f} s" for k, (a, b) in enumerate(self.pauses, start=1)]
        if not self.pauses:
            lines.append("no pauses")
        return "\n".join(lines)


# --- intents -> RepairOps -------------------------------------------------------------

def _span_times(span, ctx: DemoContext) -> tuple[float, float]:
    if isinstance(span, tuple):
        if span[1] > ctx.duration + TIME_TOL:
            raise RequestError(f"span {span} is past the demo end ({ctx.duration:.2f} s)")
        return float(span[0]), float(span[1])
    spans = ctx.spans()
    if span not in spans:
        raise RequestError(f"this demo has no {span} span")
    return spans[span]


def _span_speed(span, ctx: DemoContext) -> float:
    name = span if isinstance(span, str) else "whole"
    if name not in ctx.speeds:
        raise RequestError(f"no measured speed for the {name} span")
    return ctx.speeds[name]


def resolve(intents: list, ctx: DemoContext) -> list:
    """RepairOps for the intents, with times from the demo. Raises RequestError if one can't apply."""
    try:
        return _resolve(intents, ctx)
    except ValidationError as error:
        raise RequestError(f"the ops don't fit the repair menu for this demo: {error}") from error


def _resolve(intents: list, ctx: DemoContext) -> list:
    ops: list = []
    trim_start = trim_end = False
    pauses: list[tuple[float, float]] = []
    for it in intents:
        if it.op == "trim":
            trim_start |= it.end in ("start", "both")
            trim_end |= it.end in ("end", "both")
        elif it.op == "remove_pause":
            wanted = range(1, len(ctx.pauses) + 1) if it.pause == "all" else [it.pause]
            for k in wanted:
                if k > len(ctx.pauses):
                    raise RequestError(f"pause {k} does not exist (this demo has {len(ctx.pauses)})")
                if ctx.pauses[k - 1] not in pauses:
                    pauses.append(ctx.pauses[k - 1])
        elif it.op == "smooth":
            t0, t1 = _span_times(it.span, ctx)
            ops.append(Smooth(op="smooth", t0=t0, t1=t1, strength=it.strength))
        elif it.op == "retime":
            t0, t1 = _span_times(it.span, ctx)
            ops.append(Retime(op="retime", t0=t0, t1=t1, target_speed=it.speed_factor * _span_speed(it.span, ctx)))
        elif it.op in ("recenter_grasp", "replan_transit"):
            if ctx.t_close is None or (it.op == "replan_transit" and ctx.t_open is None):
                raise RequestError(f"{it.op} needs a grasp (and a release), and this demo has none")
            ops.append(RecenterGrasp(op="recenter_grasp", t=ctx.t_close) if it.op == "recenter_grasp"
                       else ReplanTransit(op="replan_transit", t0=ctx.t_close, t1=ctx.t_open))
        else:
            ops.append(Discard(op="discard"))
    keep_from = ctx.idle_start[1] if trim_start and ctx.idle_start else 0.0
    keep_to = ctx.idle_end[0] if trim_end and ctx.idle_end else ctx.duration
    head = [Trim(op="trim", t0=keep_from, t1=keep_to)] if (keep_from, keep_to) != (0.0, ctx.duration) else []
    head += [RemovePause(op="remove_pause", t0=a, t1=b) for a, b in sorted(pauses)]
    return _REPAIR_OPS.validate_python([op.model_dump() for op in head + ops])


# --- the model path -----------------------------------------------------------------

TIER = "super"  # Nemotron text tier (config.TIERS); the request is text, so no VL model is needed
MAX_TOKENS = 300

REPAIR_PROMPT = (
    "You turn a user's request about one recorded robot pick-and-place demo into repair ops from "
    "a fixed menu. Output ONLY a JSON object, no prose:\n"
    '{"ops": [ ...zero or more ops... ]}\n'
    "The menu (nothing else is allowed):\n"
    '- {"op": "trim", "end": "start"|"end"|"both"}: cut idle time at the start and/or end.\n'
    '- {"op": "remove_pause", "pause": <pause number from the demo>|"all"}: cut a pause.\n'
    '- {"op": "smooth", "span": <span>, "strength": "low"|"med"|"high"}: smooth shaky motion.\n'
    '- {"op": "retime", "span": <span>, "speed_factor": <number>}: change speed; 2 = twice as '
    "fast, 0.5 = half speed, about 1.5 for a vague 'faster', about 0.7 for a vague 'slower'.\n"
    '- {"op": "recenter_grasp"}: the gripper closes off-center on the cube.\n'
    '- {"op": "replan_transit"}: carry the cube on a higher path over the bin rim.\n'
    '- {"op": "discard"}: throw the whole demo away.\n'
    '<span> is "approach", "carry", "retreat", "whole", or [t0, t1] in seconds if the user gives '
    "times.\n"
    "Rules: include only what the user asks for. If they say not to do something, or that "
    'something is fine, leave it out. Use smooth strength "med" unless they say a little or a '
    "lot. If the request is a question, asks for no change, is too vague, or asks for something "
    'not on the menu, output {"ops": []}. Use the demo facts to pick pause numbers and spans.'
)


@dataclass
class RequestResult:
    intents: list
    ops: list
    calls: int
    cost: float
    error: str | None = None
    raw: list[str] = field(default_factory=list)


def _prompt(text: str, ctx: DemoContext) -> str:
    return f"Demo facts:\n{ctx.describe()}\n\nUser request: {text}"


def parse_repair_request(text: str, ctx: DemoContext, *, chat_fn: Callable = chat, retries: int = 1) -> RequestResult:
    """Ask the model for intents and resolve them. An invalid reply is retried `retries` times, then gives no ops."""
    res = RequestResult(intents=[], ops=[], calls=0, cost=0.0)
    prompt = _prompt(text, ctx)
    for _ in range(retries + 1):
        reply = chat_fn(prompt, tier=TIER, system=REPAIR_PROMPT, max_tokens=MAX_TOKENS)
        res.calls += 1
        res.cost += reply.est_cost_usd
        res.raw.append(reply.text)
        try:
            intents = parse_intents(reply.text)
            res.ops, res.intents, res.error = resolve(intents, ctx), intents, None
            return res
        except RequestError as error:
            res.error = str(error)
            prompt = (f"{_prompt(text, ctx)}\n\nYour previous reply was invalid: {error}\n"
                      "Reply again with only the JSON object, using only the menu.")
    return res
