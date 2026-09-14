"""Ask Nemotron a question from the terminal and see exactly what it cost.

Run:
    uv run python scripts/ask.py "What is a mixture-of-experts model?"
    uv run python scripts/ask.py                 # interactive: type questions, 'q' to quit
    uv run python scripts/ask.py --tier super "..."
    uv run python scripts/ask.py --think "..."   # let the model reason first (more tokens)

Every answer is followed by the token count and estimated cost of that call,
plus the running total from usage_log.jsonl.
"""

from __future__ import annotations

import argparse
import sys

from dotenv import load_dotenv

load_dotenv()

from nebius_llm import TIERS, TokenFactoryError, chat, total_spend  # noqa: E402


def ask_once(question: str, tier: str, think: bool, max_tokens: int) -> None:
    try:
        r = chat(question, tier=tier, think=think, max_tokens=max_tokens)
    except TokenFactoryError as e:
        print(f"\nERROR: {e}")
        return

    print(f"\n{r.text.strip() or '<empty reply>'}")
    if r.finish_reason == "length":
        print("\n(cut off: hit max_tokens; rerun with --max-tokens to allow a longer answer)")

    t = total_spend()
    print(
        f"\n--- {r.model} | {r.prompt_tokens} in + {r.completion_tokens} out tokens"
        f" | this call ~${r.est_cost_usd:.5f} | all time ~${t['est_cost_usd']:.4f}"
        f" over {t['calls']} calls ---"
    )


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("question", nargs="*", help="question text (omit for interactive mode)")
    p.add_argument("--tier", choices=list(TIERS), default="nano")
    p.add_argument("--think", action="store_true", help="enable Nemotron reasoning mode")
    p.add_argument("--max-tokens", type=int, default=512)
    args = p.parse_args()

    if args.question:
        ask_once(" ".join(args.question), args.tier, args.think, args.max_tokens)
        return 0

    print(f"Talking to the {args.tier} tier ({TIERS[args.tier].model_id}). Type 'q' to quit.")
    while True:
        try:
            q = input("\nyou> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if q.lower() in {"q", "quit", "exit"}:
            return 0
        if q:
            ask_once(q, args.tier, args.think, args.max_tokens)


if __name__ == "__main__":
    sys.exit(main())
