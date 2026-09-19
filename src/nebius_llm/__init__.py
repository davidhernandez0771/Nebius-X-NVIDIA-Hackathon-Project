"""Thin wrapper around NVIDIA Nemotron models on Nebius Token Factory."""

from .client import (
    AuthError,
    ChatResult,
    ModelNotFoundError,
    RateLimitError,
    TokenFactoryError,
    chat,
)
from .config import DEFAULT_TIER, DEFAULT_VISION_TIER, TIERS, VISION_TIERS, ModelSpec, VisionModelSpec, get_model, get_vision_model
from .usage import total_spend
from .vision import chat_vision

__all__ = [
    "AuthError",
    "ChatResult",
    "DEFAULT_TIER",
    "DEFAULT_VISION_TIER",
    "ModelNotFoundError",
    "ModelSpec",
    "RateLimitError",
    "TIERS",
    "TokenFactoryError",
    "VISION_TIERS",
    "VisionModelSpec",
    "chat",
    "chat_vision",
    "get_model",
    "get_vision_model",
    "total_spend",
]
