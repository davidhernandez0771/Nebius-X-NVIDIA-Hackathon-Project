"""End-to-end connection check: list Nemotron models, then make one nano call.

Run:  uv run python scripts/smoke_test.py
Cost: one tiny nano-tier call (well under $0.001).
"""

from __future__ import annotations

import sys

from dotenv import load_dotenv

load_dotenv()

import openai  # noqa: E402

from nebius_llm import TIERS, TokenFactoryError, chat, total_spend  # noqa: E402
from nebius_llm.client import _get_client  # noqa: E402
from nebius_llm.config import BASE_URL  # noqa: E402


def main() -> int:
    print(f"Base URL: {BASE_URL}")

    # 1) Free call: list models and check our configured IDs exist.
    try:
        client = _get_client()
        available = {m.id for m in client.models.list().data}
    except TokenFactoryError as e:
        print(f"\nFAILED: {e}")
        return 1
    except openai.AuthenticationError as e:
        print(f"\nFAILED: API key rejected (HTTP {e.status_code}). Check NEBIUS_API_KEY in .env.")
        return 1
    except openai.APIError as e:
        print(f"\nFAILED: could not list models: {e}")
        return 1

    nemotron = sorted(m for m in available if "nemotron" in m.lower())
    print(f"\nNemotron models available to this key ({len(nemotron)}):")
    for m in nemotron:
        print(f"  - {m}")

    print("\nConfigured tiers:")
    all_ok = True
    for spec in TIERS.values():
        ok = spec.model_id in available
        all_ok &= ok
        print(f"  {spec.tier:<6} {spec.model_id:<45} {'OK' if ok else 'NOT FOUND'}")
    if not all_ok:
        print("  -> Override missing IDs via NEBIUS_MODEL_<TIER> in .env using an ID listed above.")

    # 2) One cheap nano call.
    print("\nCalling nano tier...")
    try:
        r = chat(
            "Reply with exactly this sentence and nothing else: Token Factory connection OK.",
            tier="nano",
            max_tokens=64,
            temperature=0.0,
        )
    except TokenFactoryError as e:
        print(f"\nFAILED: {e}")
        return 1

    print(f"\nModel:    {r.model}")
    print(f"Response: {r.text.strip() or '<empty content>'}")
    if not r.text.strip() and r.reasoning:
        print("(model returned reasoning content but no final text; raise max_tokens)")
    print(f"Tokens:   {r.prompt_tokens} in / {r.completion_tokens} out   finish={r.finish_reason}")
    print(f"Latency:  {r.latency_s:.2f}s")
    print(f"Est cost: ${r.est_cost_usd:.6f}")

    t = total_spend()
    print(f"\nCumulative (usage_log.jsonl): {t['calls']} calls, "
          f"{t['prompt_tokens']} in / {t['completion_tokens']} out, est ${t['est_cost_usd']:.4f}")
    print("\nSMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
