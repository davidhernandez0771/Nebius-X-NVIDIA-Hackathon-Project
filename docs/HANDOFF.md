# Handoff brief for any AI coding assistant working on this repo

Read this whole file before touching anything.

## Current direction (2026-09-18)

The product is a personal room webapp: log in through a decorative animated
3D entry scene (atmosphere only, no user data), then in the main app upload a
LiDAR scan of a room (captured with an existing third-party scanning app —
Polycam, Scaniverse, etc. — exported as GLB; no native app of our own),
photograph areas, review AI-proposed items by sorting each into organize /
unknown / trash, get Nemotron organization suggestions, and control all of it
through a chat command bar (voice planned later, not in the first build).

This supersedes the earlier "room organizer" architecture (which had no
photo-review UX and conflated a 3D world with the scan itself) and the even
earlier tennis-debrief idea. Both are historical; do not build either. The
full, current plan — screens, data model, tech choices, build order — is in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md); trust that file over this
paragraph if they ever disagree, and update this file when they do.

NVIDIA's hosted Cosmos vision API was tried and abandoned (every tested model
ID returned HTTP 404; NVIDIA staff confirmed the API disabled) — its code has
been removed from the repo. Don't reintroduce it without a confirmed working
endpoint; the Nebius vision shortlist in `docs/ARCHITECTURE.md` §4 covers
itemization instead.

## How to work on this project

- The owner wants real technical documentation, not simplified
  explanations — this is a working codebase for a developer, not a
  beginner's tutorial.
- Product direction gets worked out collaboratively before big doc or code
  rewrites: surface the open decisions, propose a few concrete options with
  a recommendation, and confirm before committing significant work —
  especially before changing architecture or product scope. Once a
  direction is confirmed, implement it directly rather than re-litigating
  it.
- Commit small, descriptive commits.

## Hackathon constraints (unchanged)

Entry for the Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track.
Deadline: October 30, 2026, 10:00 a.m. PDT.

- Every model call at runtime must go to an NVIDIA open model hosted on
  Nebius Token Factory (or Nebius AI Cloud compute). No local inference in
  the submitted product.
- Public repo, MIT license at root (done), README with setup/run
  instructions and a section on how Nemotron and Token Factory are used.
- Submission also needs: a hosted demo URL, a public YouTube video under 3
  minutes narrating how Token Factory and Nemotron are used, a project
  description, and written feedback on Nebius/NVIDIA tools.
- Judging: pass/fail viability check, then 1-5 on four equal criteria —
  Technological Implementation, Design, Potential Impact, Quality of Idea.
  A single API call demo is the floor; a multi-step workflow with memory and
  tier routing stands out.
- Verify these terms again close to submission:
  https://nebiusglobalaihackathon.devpost.com/rules

## Budget

$25 in Token Factory credits (more may arrive later). Every call must go
through `nebius_llm.chat()` (text) or `nebius_llm.chat_vision()` (image) so
it's logged to `usage_log.jsonl`. Default to the `nano` text tier; use
`super`/`ultra` only where measured quality needs it. Never write a loop that
calls the model without a hard iteration cap.

## What already exists

**Verified against the real API** (live calls actually made and checked):

- `src/nebius_llm/config.py`: three text tiers. nano = `nvidia/Nemotron-3_5-Lightning`,
  super = `nvidia/nemotron-3-super-120b-a12b`, ultra = `nvidia/Nemotron-3-Ultra-550b-a55b`.
  Base URL `https://api.tokenfactory.nebius.com/v1/`. All overridable via `.env`.
- `src/nebius_llm/client.py`: `chat(prompt, tier=None, *, system=None,
  max_tokens=1024, temperature=0.2, think=False, retries=3, log_usage=True, **extra)`
  returns a `ChatResult` with `.text`, token counts, `.est_cost_usd`. Retries
  on 429/5xx honoring Retry-After. Raises `AuthError`, `RateLimitError`,
  `ModelNotFoundError`, `TokenFactoryError`.
- Thinking mode is OFF by default via `chat_template_kwargs.enable_thinking=false`
  — verified live: without it, Nemotron spends the whole token budget
  narrating a "thinking process." Pass `think=True` to enable it deliberately.
- `src/nebius_llm/usage.py`: JSONL log + `total_spend()`.
- `scripts/smoke_test.py` (passes), `scripts/ask.py` (interactive Q&A with
  cost per call), `scripts/hello.py` (minimal example).
- `docs/token-factory-notes.md`: Nebius API research findings, with sources.
- Secrets: `NEBIUS_API_KEY` lives only in `.env`, git-ignored. Never print,
  commit, or move it.

**Built and unit-tested, but never run against the real API** (passes
`uv run python -m unittest discover -s tests -v` — 29 tests, all mocked, zero
network calls; that is a different, weaker claim than "works"):

- `src/nebius_llm/vision.py`: `chat_vision(prompt, image_bytes, tier=None, ...)`,
  the image-call sibling of `chat()`, sharing its retry/error-mapping via
  `_request_with_retries`. `VISION_TIERS` in `config.py` (`minicpm`, `glm-flash`)
  are the two vision-model candidates from `docs/ARCHITECTURE.md` §4.
- `src/app/`: full FastAPI backend -- SQLAlchemy models for every record in
  `docs/ARCHITECTURE.md` §7, routers for every route implied by §3 (rooms,
  locations, scan upload, photo upload + `/analyze`, candidate review,
  item CRUD + moves, organize, chat), and `src/app/ai/` holding the actual
  prompts (`vision.py` itemization, `organize.py`, `commands.py` command
  parsing) plus their JSON-response parsing. Run with
  `uv run uvicorn app.main:app --reload --app-dir src`.
- `web/`: React + Vite frontend, one page per screen in §3 except the entry
  scene, wired to the backend above. Run with `cd web && npm install && npm run dev`
  -- **not verified in this environment** (no Node.js available when this was
  built); check that `npm install` and `npm run build` succeed before relying
  on it.
- `tests/test_app_api.py`: exercises the whole backend against a temp SQLite
  DB with `app.ai.vision.chat_vision`, `app.ai.organize.chat`, and
  `app.ai.commands.chat` all mocked. This proves the plumbing (routing, DB
  writes, the organize/trash/unknown state machine) is correct. It proves
  nothing about whether the actual prompts produce good output on a real
  photo or a real spoken command -- that's still completely open, and is the
  real content of `docs/ARCHITECTURE.md` §10 step 1.

**Not built at all**: the decorative 3D entry scene, scan rendering in the
browser (upload works, display doesn't), EXIF stripping, real auth, voice
input, usage/cost visible anywhere but the JSONL log. See
`docs/ARCHITECTURE.md` §10 for what's next and in what order.

## Environment

- Use `uv` for everything: `uv sync`, `uv run python ...`. If `uv sync` fails
  with a certificate error (common behind corporate/antivirus TLS proxies),
  run `uv sync --system-certs`.
- `openai` SDK is v3.x.
- Git identity and local clone path vary by machine — don't hard-code either
  into project docs; check `git remote -v` and `pwd` if you need them.

## If docs disagree

Trust the live API (`GET /v1/models`) and `docs/token-factory-notes.md` over
any narrative description of model IDs or prices. Trust `docs/ARCHITECTURE.md`
over this file for product scope, and update this file when they diverge.
