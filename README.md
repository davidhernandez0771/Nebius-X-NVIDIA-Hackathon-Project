# [Project Name]

Submission for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/) (deadline Oct 30, 2026).

## What it does

_TODO: one paragraph on the problem and what this project does about it._

## How Nemotron and Nebius Token Factory are used

All model inference is a remote call to **Nebius Token Factory**
(`https://api.tokenfactory.nebius.com/v1/`, OpenAI-compatible) running
NVIDIA's open-weight **Nemotron 3** family. No local inference.

Requests are routed through three tiers defined in
[`src/nebius_llm/config.py`](src/nebius_llm/config.py):

| Tier | Model | Used for |
|---|---|---|
| `nano` (default) | `nvidia/Nemotron-3_5-Lightning` | everything unless there's a reason not to |
| `super` | `nvidia/nemotron-3-super-120b-a12b` | harder tasks that nano gets wrong |
| `ultra` | `nvidia/Nemotron-3-Ultra-550b-a55b` | heavy reasoning, used sparingly |

Every call logs prompt/completion tokens and an estimated cost to
`usage_log.jsonl` so spend stays visible. See
[`docs/token-factory-notes.md`](docs/token-factory-notes.md) for what the
Nebius docs say about endpoints, auth, rate limits and model IDs.

## Setup

Requirements: Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
uv sync
cp .env.example .env
```

Then open `.env` and paste your key from
[tokenfactory.nebius.com](https://tokenfactory.nebius.com) into
`NEBIUS_API_KEY`. The key is only ever read from the environment; `.env` is
git-ignored.

If `uv sync` fails with `invalid peer certificate: UnknownIssuer` (common behind
corporate or antivirus TLS proxies), run `uv sync --system-certs` instead.

## How to run

Confirm the connection end to end (one tiny nano call):

```bash
uv run python scripts/smoke_test.py
```

It lists the Nemotron models your key can see, checks the three configured
IDs exist, makes one call, and prints the response, token counts, estimated
cost and cumulative spend.

Ask the model anything from the terminal and see what each answer cost:

```bash
uv run python scripts/ask.py "Explain mixture-of-experts in one paragraph"
```

Run it with no question for an interactive prompt. Add `--tier super` or
`--tier ultra` to use a bigger model, and `--think` to let it reason first
(costs more tokens). Every call appends a line to `usage_log.jsonl`.

Use the client from your own code:

```python
from nebius_llm import chat

r = chat("Summarise this in one line: ...", tier="nano")
print(r.text, r.est_cost_usd)
```

Nemotron's built-in "thinking" is off by default because it bills reasoning
tokens as output. Pass `think=True` when a task actually needs it.

_TODO: how to run the actual app once it exists._

## Project layout

```
src/nebius_llm/
  config.py    model tiers, IDs, prices, base URL
  client.py    chat(prompt, tier) with retries and clear auth/rate-limit errors
  usage.py     per-call JSONL usage log + totals
scripts/
  smoke_test.py  one-call connection check
  ask.py         ask a question, see the answer and its cost
docs/
  token-factory-notes.md
```

## License

MIT, see [LICENSE](LICENSE).
