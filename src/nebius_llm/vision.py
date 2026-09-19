"""Vision itemization calls: one image + prompt -> a Nebius-hosted vision model.

Deliberately separate from chat() (see docs/ARCHITECTURE.md §5): vision models
have their own price table and message shape (an image content part), and must
not reuse the nano/super/ultra text-tier config. Untested against a real photo
as of 2026-09-18 -- see docs/ARCHITECTURE.md §4/§9 for the test plan and budget.
"""

from __future__ import annotations

import base64
from typing import Any

from .client import ChatResult, _get_client, _request_with_retries
from .config import VisionModelSpec, get_vision_model
from .usage import record_usage


def _image_content_part(image_bytes: bytes, mime_type: str) -> dict[str, Any]:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}}


def chat_vision(
    prompt: str,
    image_bytes: bytes,
    *,
    mime_type: str = "image/jpeg",
    tier: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.2,
    retries: int = 0,
    log_usage: bool = True,
) -> ChatResult:
    """Send one image + prompt to a vision model tier. See config.VISION_TIERS.

    retries defaults to 0, unlike chat()'s 3: image requests are larger and a
    silent retry storm is a worse failure mode than a fast, visible error while
    this path is unverified.

    Raises: AuthError, RateLimitError, ModelNotFoundError, TokenFactoryError.
    """
    spec: VisionModelSpec = get_vision_model(tier)
    client = _get_client()

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                _image_content_part(image_bytes, mime_type),
            ],
        }
    ]

    resp, latency = _request_with_retries(
        client,
        model_id=spec.model_id,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        retries=retries,
    )

    choice = resp.choices[0]
    text = choice.message.content or ""
    usage = resp.usage
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", 0) or prompt_tokens + completion_tokens)
    cost = spec.estimate_cost(prompt_tokens, completion_tokens)

    if log_usage:
        record_usage(
            {
                "tier": f"vision:{spec.tier}",
                "model": resp.model or spec.model_id,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "est_cost_usd": round(cost, 6),
                "latency_s": round(latency, 3),
                "finish_reason": choice.finish_reason,
            }
        )

    return ChatResult(
        text=text,
        tier=f"vision:{spec.tier}",
        model=resp.model or spec.model_id,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        est_cost_usd=cost,
        latency_s=latency,
        finish_reason=choice.finish_reason,
    )
