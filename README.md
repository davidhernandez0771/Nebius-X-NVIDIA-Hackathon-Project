# [Project Name]

Submission for the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/) (deadline Oct 30, 2026).

## What it does

Log in, and after a short animated 3D entry scene, land in the main app.
Upload a LiDAR scan of a room (captured with a third-party scanning app like
Polycam or Scaniverse — no app of our own to install) for spatial context,
then photograph a shelf or drawer. A vision model proposes what's in the
photo; you sort each candidate into **organize**, **unknown**, or **trash**.
Nemotron then suggests how to arrange your confirmed inventory, and a chat
command bar lets you control all of it in plain language — "send the lamp to
trash", "organize my desk" — parsed into validated actions, never guessed.

**Status: foundation built (backend API + DB schema + frontend shell for every
screen), core AI logic wired but unverified against real photos/commands.**
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full plan, screen
list, data model and build order.

## How Nemotron and Nebius Token Factory are used

Default model inference is a remote call to **Nebius Token Factory**
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

Run the backend API:

```bash
uv run uvicorn app.main:app --reload --app-dir src
```

Creates `app.db` (SQLite, git-ignored) and `uploads/` (git-ignored) on first
run. Visit `http://localhost:8000/docs` for the interactive API docs.

Run the frontend, in a separate terminal (requires [Node.js](https://nodejs.org/) 20+):

```bash
cd web
npm install
npm run dev
```

Opens at `http://localhost:5173` and talks to the backend above. Every screen
in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §3 exists and is wired to a
real endpoint except the decorative 3D entry scene (not built yet — see §10).
Uploading a photo and hitting "Analyze," or asking Organize/Chat anything,
makes a real, billed Token Factory call — nothing here has been run against
the live API yet (only against mocked responses in `tests/test_app_api.py`),
so the first real run is also the first real test of the vision/command
prompts. Start small.

## Vision itemization (planned, not yet implemented)

Candidate models for the "photo → item list" step, from Nebius's live model
catalog (2026-09-15). None has been tested yet on a real photo:

| Model ID | Input / output per 1M tokens | Role |
|---|---|---|
| `openbmb/MiniCPM-V-4_5` | $0.658 / $1.11 | First candidate |
| `zai-org/GLM-5.3-Flash` | $0.15 / $0.50 | Cheapest candidate |
| `moonshotai/Kimi-K2.6` | $0.95 / $4.00 | Fallback |
| `moonshotai/Kimi-K3` | $3.00 / $15.00 | Deferred |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §4 and §9 for the test plan.

An earlier experiment tried NVIDIA's hosted Cosmos vision API as an
alternative. It returned HTTP 404 on every tested model ID (NVIDIA staff
confirmed the API was disabled for this account), so it's been removed from
the repo. The vision shortlist above replaces it.

## Project layout

```
src/nebius_llm/
  config.py    text-tier + vision-tier model IDs, prices, base URL
  client.py    chat(prompt, tier) with retries and clear auth/rate-limit errors
  vision.py    chat_vision(prompt, image_bytes, tier) -- same retry/error path
  usage.py     per-call JSONL usage log + totals
src/app/            FastAPI backend (see docs/ARCHITECTURE.md §5/§7)
  main.py        app + routers
  models.py      SQLAlchemy tables
  schemas.py     Pydantic request/response shapes
  db.py          SQLite session (no migration tool yet, see db.py's docstring)
  storage.py     local photo/scan file storage (dev only)
  routers/       rooms, scans, photos, candidates, items, organize, chat
  ai/            prompts + parsing for vision itemization, organize, chat commands
web/                 React + Vite frontend shell (see docs/ARCHITECTURE.md §3)
  src/pages/       one page per screen, wired to the backend above
  src/api/client.ts  fetch wrapper
scripts/
  smoke_test.py  one-call connection check
  ask.py         ask a question, see the answer and its cost
  hello.py       minimal single-call example
tests/
  test_client.py test_config.py test_usage.py   nebius_llm unit tests (mocked)
  test_app_api.py                               backend API tests (mocked AI calls)
docs/
  ARCHITECTURE.md          current build plan
  HANDOFF.md               brief for whoever (human or AI) picks this up next
  token-factory-notes.md   Nebius API research notes
```

## License

MIT, see [LICENSE](LICENSE).
