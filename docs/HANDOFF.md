# Handoff brief for any AI coding assistant working on this repo

You are taking over as the coding assistant on this project. Read this whole
file before touching anything. The owner (David) is a beginner with LLM APIs
and wants to work one step at a time with plain explanations. Do not build
ahead of what he has agreed to.

## The project

### Current direction and authorized experiment (2026-09-15)

David chose a room-organizing website concept: phone photos, user-confirmed
item labels/locations, and Nemotron organization suggestions. Custom icons,
digital activity modes, and projection are possible later additions. The
tennis idea below is historical and was never accepted; do not build it.

David authorized an NVIDIA-hosted Cosmos development API experiment.
`NVIDIA_API_KEY` is private in `.env`, separate from `NEBIUS_API_KEY`.
Run `uv run python scripts/cosmos_test.py` after he enters the key. This is
a text-only connection test, not verified vision or production deployment.
All calls still go through `nebius_llm.chat()` and usage logging; the explicit
`provider="nvidia"` route makes one request without retries and tags its log.
Default calls still use Nebius nano. No local model installation is needed.
The NVIDIA $0 development estimate does not consume Nebius credits and does
not promise unlimited access. Do not provision cloud GPUs without agreement.

Correction to the older rules summary below: the published general rules
require an NVIDIA open model and a runtime Token Factory call or AI Cloud
compute, not exclusively Nebius-hosted inference for every model. Track
requirements and development-provider terms still need checking for the
final submission: https://nebiusglobalaihackathon.devpost.com/rules


Entry for the Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents track.
Deadline: October 30, 2026, 10:00 a.m. PDT.
Repo: https://github.com/davidhernandez0771/Nebius-X-NVIDIA-Hackathon-Project
Local clone: `C:\Users\dhrce\source\repos\nebius-hackathon` (Windows 11, VS Code).

Hard rules from the hackathon:
- Every model call at runtime must go to NVIDIA Nemotron hosted on Nebius
  Token Factory (remote API). No local inference in the submitted product.
- Public repo with MIT license at the root (done), README with setup and run
  instructions and a section on how Nemotron and Token Factory are used.
- Submission also needs: a hosted demo URL, a public YouTube video under 3
  minutes narrating how Token Factory and Nemotron are used, a project
  description, and written feedback on Nebius/NVIDIA tools.
- Judging: pass/fail viability check, then 1-5 on four equal criteria:
  Technological Implementation, Design, Potential Impact, Quality of Idea.
  Organizers said a single API call demo is the floor; a multi-step workflow
  with memory and tier routing stands out.

## Budget

$25 in Token Factory credits (another $25 may arrive later). Every call must
go through `nebius_llm.chat()` so it is logged to `usage_log.jsonl`. Default
to the `nano` tier. Use `ultra` only for the one step that needs reasoning.
Never write loops that call the model without a hard cap on iterations.

## What already exists and is verified working

- `src/nebius_llm/config.py`: three tiers. nano = `nvidia/Nemotron-3_5-Lightning`,
  super = `nvidia/nemotron-3-super-120b-a12b`, ultra = `nvidia/Nemotron-3-Ultra-550b-a55b`.
  Base URL `https://api.tokenfactory.nebius.com/v1/`. All overridable via `.env`.
- `src/nebius_llm/client.py`: `chat(prompt, tier=None, *, system=None,
  max_tokens=1024, temperature=0.2, think=False, retries=3, log_usage=True, **extra)`
  returns a `ChatResult` with `.text`, token counts, `.est_cost_usd`.
  Retries on 429/5xx honoring Retry-After. Raises `AuthError`,
  `RateLimitError`, `ModelNotFoundError`, `TokenFactoryError`.
- Thinking mode is OFF by default via `chat_template_kwargs.enable_thinking=false`.
  Verified live: without it Nemotron spends the whole token budget narrating a
  "thinking process". The `/no_think` system-prompt trick does nothing here.
- `src/nebius_llm/usage.py`: JSONL log + `total_spend()`.
- `scripts/smoke_test.py` (passes), `scripts/ask.py` (interactive Q&A with
  cost per call), `scripts/hello.py` (minimal example).
- `docs/token-factory-notes.md`: everything found in the Nebius docs, with sources.
- Secrets: `NEBIUS_API_KEY` lives only in `.env`, which is git-ignored. Never
  print it, commit it, or move it.

Environment quirks:
- No system Python. Use `uv` for everything: `uv sync --system-certs` (a TLS
  proxy on this machine breaks plain `uv sync`), `uv run python ...`.
- `openai` SDK is v3.x. `gh` CLI is not installed; use git over HTTPS.
- Git identity is set per-repo ("David" <dhrcello07@gmail.com>).

## The idea (proposed; confirm with David before building)

**Tennis post-match mental debrief.** After a match, David types a messy
brain-dump: score, momentum swings, moments focus broke, self-talk, tilt.
The app returns a structured debrief and one cue for the next match, and
builds a history so patterns across matches emerge.

Pipeline (each step is one `chat()` call):
1. nano: extract structured facts from the brain-dump as JSON
   (score, key moments, emotional triggers, self-talk quotes, what went well).
2. Save that record to a local JSON file (the memory).
3. ultra with `think=True`: given the full history, identify recurring mental
   patterns and the single highest-leverage thing to work on. Cap `max_tokens`.
4. nano: write the user-facing debrief: 3-5 bullet summary, one pre-match cue,
   one in-match reset routine. Plain language, no jargon.

Build order (one step per session, show David the output of each):
1. `IDEA.md` at repo root: one paragraph, the pipeline above, and what the
   demo video will show.
2. `scripts/debrief.py`: terminal version of the pipeline. Paste notes, print
   each step's output and cost. Get the prompts good here before any UI.
3. A minimal web page (single page, one textarea, one result panel, a
   history list). Keep dependencies tiny; FastAPI + one HTML file, or
   Streamlit, are both fine.
4. Hosting so the page has a public URL. Nebius Serverless Endpoints is
   suggested by organizers but not required; any free host works.
5. README: fill the "what it does" and "how to run" sections, add screenshots.
6. Demo video and submission.

## How to work with David

- One step at a time. Explain what you are about to do and why in plain
  language before doing it. No walls of code in chat; put code in files.
- After every change, run it and show the actual output and the cost line.
- Commit small, descriptive commits and push to `main` so the repo is always
  the current state.
- If something in the docs or API contradicts this file, trust the live API
  (`GET /v1/models`) and the notes in `docs/token-factory-notes.md`, and
  update this file.
