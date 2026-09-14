"""Model routing config: three tiers of NVIDIA Nemotron on Nebius Token Factory.

Model IDs and prices come from Nebius's official sources as of 2026-09-13:
  - https://docs.tokenfactory.nebius.com/
  - https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/README.md
Prices are USD per 1M tokens and are only used for *estimated* spend in the
local usage log. Check the Token Factory console for actual billing.

Every ID can be overridden with an environment variable (see .env.example) so
you can swap models without touching code, e.g. if the smoke test reports a
different ID in `GET /v1/models`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

BASE_URL = os.environ.get("NEBIUS_BASE_URL") or "https://api.tokenfactory.nebius.com/v1/"

DEFAULT_TIER = "nano"


@dataclass(frozen=True)
class ModelSpec:
    tier: str
    model_id: str
    input_price_per_m: float   # USD per 1M prompt tokens
    output_price_per_m: float  # USD per 1M completion tokens
    context_window: int
    notes: str

    def estimate_cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return (
            prompt_tokens * self.input_price_per_m
            + completion_tokens * self.output_price_per_m
        ) / 1_000_000


TIERS: dict[str, ModelSpec] = {
    "nano": ModelSpec(
        tier="nano",
        model_id=os.environ.get("NEBIUS_MODEL_NANO") or "nvidia/Nemotron-3_5-Lightning",
        input_price_per_m=0.06,
        output_price_per_m=0.24,
        context_window=1_000_000,
        notes="30B MoE / 3B active. Cheap and fast. Default for everything.",
    ),
    "super": ModelSpec(
        tier="super",
        model_id=os.environ.get("NEBIUS_MODEL_SUPER") or "nvidia/nemotron-3-super-120b-a12b",
        input_price_per_m=0.30,
        output_price_per_m=0.90,
        context_window=262_144,
        notes="120B MoE / 12B active. Mid tier for harder tasks.",
    ),
    "ultra": ModelSpec(
        tier="ultra",
        model_id=os.environ.get("NEBIUS_MODEL_ULTRA") or "nvidia/Nemotron-3-Ultra-550b-a55b",
        input_price_per_m=1.00,
        output_price_per_m=3.00,
        context_window=1_000_000,
        notes="550B MoE / 55B active. Reasoning flagship. Use sparingly.",
    ),
}


def get_model(tier: str | None = None) -> ModelSpec:
    """Resolve a tier name ('nano' | 'super' | 'ultra') to its ModelSpec."""
    name = (tier or DEFAULT_TIER).lower()
    try:
        return TIERS[name]
    except KeyError:
        raise ValueError(
            f"Unknown model tier {tier!r}. Choose one of: {', '.join(TIERS)}"
        ) from None
