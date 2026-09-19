"""Run 10 sample chat commands through the real Nemotron command parser and
compare each parsed action to the expected one. Ambiguous or out-of-scope
commands must come back as "unknown" (the app then says "I didn't understand").

Spend: exactly len(CASES) nano calls (10), no retries loop beyond chat()'s
default, hard-capped below. Every call is logged to usage_log.jsonl.

Run:  uv run python scripts/command_eval.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app.ai.commands import parse_command  # noqa: E402
from nebius_llm import TokenFactoryError  # noqa: E402

# (text, expected action, expected item_name substring or None, expected location substring or None)
CASES = [
    ("send the lamp to trash", "trash", "lamp", None),
    ("throw away the old phone charger", "trash", "charger", None),
    ("organize my desk", "organize", None, "desk"),
    ("move the scissors to the top drawer", "move", "scissors", "drawer"),
    ("where are my keys?", "query", None, None),
    ("do the thing with the stuff", "unknown", None, None),
    ("trash it", "unknown", None, None),
    ("move the lamp", "unknown", None, None),
    ("what's the weather today?", "unknown", None, None),
    ("delete everything", "unknown", None, None),
]
MAX_CALLS = 10


def main() -> int:
    assert len(CASES) <= MAX_CALLS
    passed = 0
    total_cost = 0.0
    for text, want_action, want_item, want_loc in CASES[:MAX_CALLS]:
        try:
            parsed, cost = parse_command(text)
        except TokenFactoryError as error:
            print(f"STOP: {error}")
            return 1
        total_cost += cost
        ok = parsed.action == want_action
        if ok and want_item:
            ok = want_item in (parsed.item_name or "").lower()
        if ok and want_loc:
            ok = want_loc in (parsed.location_name or "").lower()
        passed += ok
        print(f"{'PASS' if ok else 'FAIL'}  {text!r}\n      want={want_action}  got={parsed}")
    print(f"\n{passed}/{len(CASES)} correct. Cost ${total_cost:.6f}.")
    return 0 if passed == len(CASES) else 2


if __name__ == "__main__":
    raise SystemExit(main())
