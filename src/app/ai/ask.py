"""Ask SANT: Nemotron picks one tool for the site's 3D journey plus a one-line reply.

The tools live on the client (web/src/world/ask/registry.ts), which sends their names, what they
do and the values their one argument may take. The model only proposes a call; this module checks
it against that list, and the client checks it again and is the only thing that runs it. Anything
that doesn't validate comes back as no tool, and the client falls back to its own keyword rules.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from nebius_llm import chat

ASK_PROMPT = (
    "You steer a 3D website for SANT (one human robot demo, checked in physics, multiplied into "
    "training data) by choosing ONE tool for the visitor's message. Output ONLY a JSON object, no "
    'prose: {"tool": <tool name or null>, "arg": <one of that tool\'s values, or null if it takes '
    'none>, "reply": <one short plain sentence to the visitor, under 120 characters>}.\n'
    "Never state numbers, results or facts in the reply: the page shows those. Say what you are "
    "showing. Use null for the tool only if no tool fits.\nTools:\n"
)

MAX_TOOLS = 12
MAX_VALUES = 64
MAX_REPLY = 140


@dataclass
class ToolSpec:
    name: str
    description: str
    values: list[str] | None  # None: the tool takes no argument


@dataclass
class AskResult:
    tool: str | None
    arg: str | None
    reply: str


def build_prompt(tools: list[ToolSpec]) -> str:
    lines = []
    for t in tools[:MAX_TOOLS]:
        arg = "no argument" if t.values is None else "arg one of: " + ", ".join(t.values[:MAX_VALUES])
        lines.append(f"- {t.name}: {t.description} ({arg})")
    return ASK_PROMPT + "\n".join(lines)


def ask(text: str, tools: list[ToolSpec]) -> tuple[AskResult, float]:
    result = chat(text[:500], tier="nano", system=build_prompt(tools), max_tokens=160)
    return parse(result.text, tools), result.est_cost_usd


def parse(raw_text: str, tools: list[ToolSpec]) -> AskResult:
    text = raw_text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        text = text[start : end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        return AskResult(None, None, "")
    reply = _line(data.get("reply"))
    by_name = {t.name: t for t in tools}
    tool = by_name.get(data.get("tool")) if isinstance(data.get("tool"), str) else None
    if tool is None:
        return AskResult(None, None, reply)
    arg = data.get("arg")
    if tool.values is None:
        return AskResult(tool.name, None, reply)
    if not isinstance(arg, str) or arg not in tool.values:
        return AskResult(None, None, reply)
    return AskResult(tool.name, arg, reply)


def _line(value) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:MAX_REPLY]
