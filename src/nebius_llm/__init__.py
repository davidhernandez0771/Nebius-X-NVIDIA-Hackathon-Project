"""Thin wrapper around NVIDIA Nemotron models on Nebius Token Factory."""

from .client import (
    AuthError,
    ChatResult,
    ModelNotFoundError,
    RateLimitError,
    TokenFactoryError,
    chat,
)
from .config import DEFAULT_TIER, TIERS, ModelSpec, get_model
from .usage import total_spend

__all__ = [
    "AuthError",
    "ChatResult",
    "DEFAULT_TIER",
    "ModelNotFoundError",
    "ModelSpec",
    "RateLimitError",
    "TIERS",
    "TokenFactoryError",
    "chat",
    "get_model",
    "total_spend",
]
