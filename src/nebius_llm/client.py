"""One-function chat client for NVIDIA Nemotron on Nebius Token Factory.

Usage:
    from nebius_llm import chat
    result = chat("Say hello", tier="nano")
    print(result.text, result.est_cost_usd)

Token Factory exposes an OpenAI-compatible API, so we use the official
`openai` SDK pointed at the Nebius base URL (this is what Nebius's own docs do).
The SDK's built-in retries are disabled so this module controls backoff and
error reporting itself.
"""

from __future__ import annotations

import os
import random
import time
from dataclasses import dataclass
from typing import Any

import openai

from .config import BASE_URL, ModelSpec, get_model  # config.py loads .env on import
from .usage import record_usage


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class TokenFactoryError(RuntimeError):
    """Base class for all errors raised by this module."""


class AuthError(TokenFactoryError):
    """401/403: the API key is missing, invalid, or lacks access."""


class RateLimitError(TokenFactoryError):
    """429: still rate-limited after all retries."""


class ModelNotFoundError(TokenFactoryError):
    """404: the model ID is not available on Token Factory (check config.py)."""


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChatResult:
    text: str
    tier: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    est_cost_usd: float
    latency_s: float
    finish_reason: str | None
    reasoning: str | None = None  # set if the model returned separate reasoning content


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

_client: openai.OpenAI | None = None


def _get_client() -> openai.OpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("NEBIUS_API_KEY", "").strip()
        if not api_key:
            raise AuthError(
                "NEBIUS_API_KEY is not set. Copy .env.example to .env and paste your key "
                "from https://tokenfactory.nebius.com"
            )
        _client = openai.OpenAI(base_url=BASE_URL, api_key=api_key, max_retries=0, timeout=120)
    return _client


def _retry_after_seconds(err: openai.APIStatusError, attempt: int) -> float:
    """Honor the Retry-After header if present, else exponential backoff with jitter."""
    try:
        header = err.response.headers.get("retry-after")
        if header:
            return min(float(header), 60.0)
    except Exception:
        pass
    return min(2 ** attempt + random.uniform(0, 0.5), 30.0)


def _request_with_retries(
    client: openai.OpenAI,
    *,
    model_id: str,
    messages: list[dict[str, Any]],
    max_tokens: int,
    temperature: float,
    retries: int,
    extra_body: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> tuple[Any, float]:
    """Shared retry/error-mapping loop, used by both text (chat()) and image
    (vision.chat_vision()) calls -- they differ only in message shape and
    model config, not in how errors or retries are handled."""
    extra = extra or {}
    for attempt in range(retries + 1):
        started = time.perf_counter()
        try:
            resp = client.chat.completions.create(
                model=model_id,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                **({"extra_body": extra_body} if extra_body else {}),
                **extra,
            )
            return resp, time.perf_counter() - started
        except openai.AuthenticationError as e:
            raise AuthError(
                f"Token Factory rejected the API key (HTTP {e.status_code}). "
                "Check NEBIUS_API_KEY in your .env."
            ) from e
        except openai.PermissionDeniedError as e:
            raise AuthError(
                f"Token Factory denied access (HTTP 403) for model {model_id!r}: {e.message}"
            ) from e
        except openai.NotFoundError as e:
            raise ModelNotFoundError(
                f"Model {model_id!r} not found on Token Factory (HTTP 404). "
                f"Run scripts/smoke_test.py to list available IDs. Server said: {e.message}"
            ) from e
        except openai.RateLimitError as e:
            if attempt >= retries:
                raise RateLimitError(
                    f"Rate limited by Token Factory (HTTP 429) after {retries + 1} attempts. "
                    "Slow down or wait for the limit window to reset."
                ) from e
            time.sleep(_retry_after_seconds(e, attempt))
        except (openai.APIConnectionError, openai.APITimeoutError, openai.InternalServerError) as e:
            if attempt >= retries:
                raise TokenFactoryError(
                    f"Token Factory unreachable or failing after {retries + 1} attempts: {e}"
                ) from e
            time.sleep(min(2 ** attempt + random.uniform(0, 0.5), 30.0))
        except openai.APIStatusError as e:
            raise TokenFactoryError(
                f"Token Factory returned HTTP {e.status_code} for {model_id!r}: {e.message}"
            ) from e
    raise TokenFactoryError("Request failed after retries")  # pragma: no cover


def chat(
    prompt: str,
    tier: str | None = None,
    *,
    system: str | None = None,
    max_tokens: int = 1024,
    temperature: float = 0.2,
    think: bool = False,
    retries: int = 3,
    log_usage: bool = True,
    **extra: Any,
) -> ChatResult:
    """Send one prompt to a Nemotron model tier and return the reply plus usage.

    Args:
        prompt: user message.
        tier: 'nano' (default), 'super', or 'ultra'. See config.TIERS.
        system: optional system prompt.
        max_tokens: cap on completion tokens (controls spend).
        temperature: sampling temperature.
        think: Nemotron 3 reasons out loud by default, which burns output tokens
            and can crowd out the actual answer. Off by default; set True for
            hard problems (usually paired with tier='ultra').
        retries: attempts on 429 / 5xx / connection errors before giving up.
        log_usage: append tokens + estimated cost to the local usage log.
        **extra: passed straight through to chat.completions.create (e.g. response_format).

    Raises:
        AuthError, RateLimitError, ModelNotFoundError, TokenFactoryError.
    """
    spec: ModelSpec = get_model(tier)
    client = _get_client()

    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    # Thinking toggle. Verified live on Token Factory 2026-09-13: with
    # enable_thinking=False, Nemotron-3.5-Lightning answers in 6 tokens instead
    # of spending the whole budget on a "thinking process". The "/no_think"
    # system-prompt trick from older Nemotron releases has no effect here.
    extra_body: dict[str, Any] = dict(extra.pop("extra_body", None) or {})
    template_kwargs = dict(extra_body.get("chat_template_kwargs") or {})
    template_kwargs.setdefault("enable_thinking", think)
    extra_body["chat_template_kwargs"] = template_kwargs

    resp, latency = _request_with_retries(
        client,
        model_id=spec.model_id,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        retries=retries,
        extra_body=extra_body,
        extra=extra,
    )

    choice = resp.choices[0]
    text = choice.message.content or ""
    reasoning = getattr(choice.message, "reasoning_content", None) or None

    usage = resp.usage
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", 0) or prompt_tokens + completion_tokens)
    cost = spec.estimate_cost(prompt_tokens, completion_tokens)

    if log_usage:
        record_usage(
            {
                "tier": spec.tier,
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
        tier=spec.tier,
        model=resp.model or spec.model_id,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        est_cost_usd=cost,
        latency_s=latency,
        finish_reason=choice.finish_reason,
        reasoning=reasoning,
    )
