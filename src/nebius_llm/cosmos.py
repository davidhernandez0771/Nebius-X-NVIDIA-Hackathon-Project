"""NVIDIA-hosted Cosmos experiment; called only through nebius_llm.chat()."""

import os
import time

import openai

from .client import AuthError, ChatResult, TokenFactoryError
from .usage import record_usage


def cosmos_chat(prompt, *, system, max_tokens, temperature, log_usage):
    key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not key or key == "PASTE_YOUR_NVIDIA_KEY_HERE":
        raise AuthError("Set NVIDIA_API_KEY in the repo's .env, save it, then rerun this test.")
    if not 1 <= max_tokens <= 2048:
        raise ValueError("Cosmos experiments require max_tokens between 1 and 2048.")
    model = os.environ.get("NVIDIA_COSMOS_MODEL") or "nvidia/cosmos-reason2-8b"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    started = time.perf_counter()
    entry = {"provider": "nvidia", "tier": "cosmos", "model": model,
             "est_cost_usd": 0.0,
             "cost_basis": "NVIDIA free development endpoint; not a billing receipt"}
    try:
        with openai.OpenAI(base_url="https://integrate.api.nvidia.com/v1",
                           api_key=key, max_retries=0, timeout=90) as client:
            response = client.chat.completions.create(
                model=model, messages=messages, max_tokens=max_tokens,
                temperature=temperature, stream=False)
    except openai.APIError as error:
        status = getattr(error, "status_code", None)
        entry.update(status="error", http_status=status,
                     latency_s=round(time.perf_counter() - started, 3))
        if log_usage:
            record_usage(entry)
        hints = {401: "Check NVIDIA_API_KEY in .env.",
                 403: "This NVIDIA account/key may not have access to Cosmos.",
                 404: "The model or hosted endpoint is unavailable for this key. "
                      "A model listed in NVIDIA's catalog may still have its API disabled. "
                      "No automatic retry was made.",
                 429: "NVIDIA rate limited this request. Wait before trying again."}
        # Never print provider response bodies, request headers or credentials.
        raise TokenFactoryError(
            f"NVIDIA request failed ({'HTTP ' + str(status) if status else 'connection or timeout'}). "
            + hints.get(status, "Try again later; no automatic retry was made.")) from None
    usage = response.usage
    latency = time.perf_counter() - started
    choice = response.choices[0] if response.choices else None
    text = (choice.message.content or "") if choice else ""
    finish = choice.finish_reason if choice else None
    prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
    completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(usage, "total_tokens", 0) or prompt_tokens + completion_tokens)
    entry.update(status="ok" if text.strip() else "empty", prompt_tokens=prompt_tokens,
                 completion_tokens=completion_tokens, total_tokens=total_tokens,
                 usage_reported=usage is not None, finish_reason=finish,
                 latency_s=round(latency, 3))
    if log_usage:
        record_usage(entry)
    return ChatResult(text, "cosmos", response.model or model, prompt_tokens,
                      completion_tokens, total_tokens, 0.0, latency, finish)
