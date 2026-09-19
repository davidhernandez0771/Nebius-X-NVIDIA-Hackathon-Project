"""Model routing config: three tiers of NVIDIA Nemotron on Nebius Token Factory,
plus a separate shortlist of Nebius-hosted vision models.

Model IDs and prices come from Nebius's official sources as of 2026-09-13:
  - https://docs.tokenfactory.nebius.com/
  - https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/README.md
Vision model IDs/prices come from a live `GET /v1/models?verbose=true` call on
2026-09-15 (see docs/ARCHITECTURE.md §4) -- untested on a real photo as of
2026-09-18.
Prices are USD per 1M tokens and are only used for *estimated* spend in the
local usage log. Check the Token Factory console for actual billing.

Every ID can be overridden with an environment variable (see .env.example) so
you can swap models without touching code, e.g. if the smoke test reports a
different ID in `GET /v1/models`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

# Load .env before reading any override below. This module is imported by
# client.py, so callers that never call load_dotenv() themselves (e.g. a plain
# `from nebius_llm import chat`) still get their .env overrides applied.
load_dotenv()

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


@dataclass(frozen=True)
class VisionModelSpec:
    tier: str
    model_id: str
    input_price_per_m: float
    output_price_per_m: float
    notes: str

    def estimate_cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return (
            prompt_tokens * self.input_price_per_m
            + completion_tokens * self.output_price_per_m
        ) / 1_000_000


DEFAULT_VISION_TIER = "minicpm"

VISION_TIERS: dict[str, VisionModelSpec] = {
    "minicpm": VisionModelSpec(
        tier="minicpm",
        model_id=os.environ.get("NEBIUS_MODEL_VISION_MINICPM") or "openbmb/MiniCPM-V-4_5",
        input_price_per_m=0.658,
        output_price_per_m=1.11,
        notes="First candidate for item extraction (docs/ARCHITECTURE.md §4).",
    ),
    "glm-flash": VisionModelSpec(
        tier="glm-flash",
        model_id=os.environ.get("NEBIUS_MODEL_VISION_GLM") or "zai-org/GLM-5.3-Flash",
        input_price_per_m=0.15,
        output_price_per_m=0.50,
        notes="Cheapest candidate; compare quality against minicpm.",
    ),
}


def get_vision_model(tier: str | None = None) -> VisionModelSpec:
    """Resolve a vision tier name ('minicpm' | 'glm-flash') to its VisionModelSpec."""
    name = (tier or DEFAULT_VISION_TIER).lower()
    try:
        return VISION_TIERS[name]
    except KeyError:
        raise ValueError(
            f"Unknown vision tier {tier!r}. Choose one of: {', '.join(VISION_TIERS)}"
        ) from None
