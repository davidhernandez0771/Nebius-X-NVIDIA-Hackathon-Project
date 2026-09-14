# Nebius Token Factory: what the docs say (checked 2026-09-13)

Sources read:
- https://docs.tokenfactory.nebius.com/ (docs.nebius.com/studio/* redirects here)
- https://docs.tokenfactory.nebius.com/quickstart.md
- https://docs.tokenfactory.nebius.com/ai-models-inference/rate-limits.md
- https://docs.tokenfactory.nebius.com/api-reference/examples/text-generation.md
- https://docs.tokenfactory.nebius.com/api-reference/examples/list-of-models.md
- https://github.com/nebius/token-factory-cookbook/blob/main/models/nemotron/README.md
- https://nebius.com/services/token-factory/nemotron

## Endpoint and auth

| Item | Value |
|---|---|
| Base URL | `https://api.tokenfactory.nebius.com/v1/` |
| Chat endpoint | `POST /chat/completions` (OpenAI-compatible) |
| List models | `GET /models` |
| Auth header | `Authorization: Bearer $NEBIUS_API_KEY` |
| Get a key | https://tokenfactory.nebius.com (sign in with Google/GitHub, then API keys) |
| Python | Official docs use the `openai` SDK with `base_url` set to the URL above |

Nebius's Nemotron marketing page shows a regional base URL,
`https://api.tokenfactory.us-central1.nebius.com/v1/`. The docs use the
non-regional one, so that is our default; override with `NEBIUS_BASE_URL`.

## Nemotron model IDs (from Nebius's cookbook)

| Tier | Model ID | Size | Context | Price in/out per 1M |
|---|---|---|---|---|
| nano | `nvidia/Nemotron-3_5-Lightning` | 30B / 3B active | 1M | $0.06 / $0.24 |
| super | `nvidia/nemotron-3-super-120b-a12b` | 120B / 12B active | 256K | $0.30 / $0.90 |
| ultra | `nvidia/Nemotron-3-Ultra-550b-a55b` | 550B / 55B active | 1M | $1.00 / $3.00 |

Note the inconsistent capitalisation across IDs. It is copied exactly from
Nebius's cookbook. Prices come from third-party listings of Nebius pricing
(mastra.ai, openrouter.ai) since the docs pages don't publish a price table.
Other Nemotron IDs seen in the wild on Token Factory:
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/Nemotron-3-Nano-Omni`.
The smoke test prints whatever `GET /models` returns for your key, which is
the authoritative list.

## Rate limits

- Exceeding the limit returns HTTP 429 with a `Retry-After` header.
- Extra headers: `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`,
  `x-ratelimit-reset-*`, and `x-ratelimit-over-limit: yes` as an early warning.
- Defaults are shown in the console's Rate Limits section, not in the docs.

## Usage / billing

- Every chat response includes `usage.prompt_tokens`, `usage.completion_tokens`,
  `usage.total_tokens`. We log these per call to `usage_log.jsonl`.
- Real spend is on the console's Organisation > Usage tab.

## Thinking mode

Nemotron 3 reasons out loud by default and bills those tokens as output.
NVIDIA's NIM docs say to pass `chat_template_kwargs: {"enable_thinking": false}`
in the request body. Verified live on Token Factory 2026-09-13 on
Nemotron-3.5-Lightning: the same prompt went from 64 tokens (cut off
mid-"thinking process") to a 6-token clean answer. The older `/no_think`
system-prompt trick had no effect. The client defaults to thinking off;
pass `think=True` to `chat()` to enable it.

## Not found in the docs

- Appending `-fast` to a model ID selects a lower-latency flavor (documented
  generally, not confirmed for Nemotron).

## Hackathon rules (Devpost, checked 2026-09-13)

- Must run on Nebius Token Factory or Nebius AI Cloud and use at least one
  NVIDIA open-source model. A runtime call to the Token Factory API counts.
- Public open-source repo with README, working demo, English materials.
- Deadline: October 30, 2026, 10:00 a.m. PDT.
- Judging: technological implementation, design, potential impact, quality of idea.
